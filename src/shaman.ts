import type { Rect } from './types';
import { clamp } from './types';
import { integrate } from './physics';
import { drawShaman } from './characters';
import type { World } from './world';

type State = 'idle' | 'chase' | 'retreat' | 'windup' | 'recover' | 'hit' | 'dead';

const KEEP_MIN = 190;   // 玩家近于此距离就后退
const KEEP_MAX = 320;   // 远于此距离就靠近
const CAST_CD = 150;
const WINDUP_TIME = 22;

/** 蛊球：抛物线抛出，落地/命中生成毒雾 */
class PoisonGlob {
  dead = false;
  vy: number;
  constructor(
    public x: number,
    public y: number,
    public vx: number,
  ) {
    this.vy = -6;
  }

  update(w: World): void {
    this.vy += 0.3;
    this.x += this.vx;
    this.y += this.vy;
    const stage = w.stage;
    let landed = this.y >= stage.groundY - 2;
    if (!landed) {
      for (const p of stage.platforms) {
        if (this.x > p.x && this.x < p.x + p.w && this.y > p.y && this.y < p.y + p.h) {
          landed = true;
          break;
        }
      }
    }
    if (landed) {
      w.clouds.push(new PoisonCloud(this.x, Math.min(this.y, stage.groundY - 2)));
      this.dead = true;
      return;
    }
    // 直接糊脸也算
    if (this.y > stage.groundY + 60 || this.x < 0 || this.x > stage.width) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#7ee060';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a9030';
    ctx.beginPath();
    ctx.arc(this.x - 1, this.y - 1, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 毒雾：范围持续伤害 + 减速（玩家进入即中毒 2 秒） */
export class PoisonCloud {
  life = 240;
  t = 0;
  readonly r = 90;

  constructor(
    public x: number,
    public y: number,
  ) {}

  update(w: World): void {
    this.t++;
    this.life--;
    const p = w.player;
    if (Math.abs(p.centerX - this.x) < this.r && Math.abs(p.centerY - this.y) < 60) {
      p.poisonTimer = Math.max(p.poisonTimer, 120);
    }
  }

  get dead(): boolean {
    return this.life <= 0;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const fade = Math.min(1, this.life / 60);
    for (let i = 0; i < 5; i++) {
      const ox = Math.sin(this.t * 0.03 + i * 1.7) * this.r * 0.5;
      const oy = -8 - ((this.t * 0.5 + i * 22) % 40);
      ctx.globalAlpha = 0.22 * fade;
      ctx.fillStyle = i % 2 === 0 ? '#5aa040' : '#7a50a0';
      ctx.beginPath();
      ctx.arc(this.x + ox, this.y + oy, 14 + Math.sin(this.t * 0.1 + i) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/** 蠱師（蛊术师）：远程毒蛊，保持距离。近身很脆——贴脸打 */
export class Shaman {
  readonly w = 20;
  readonly h = 32;
  vx = 0;
  vy = 0;
  facing = -1;
  onGround = false;

  hp = 20;
  readonly maxHp = 20;
  readonly contactDamage = 0;
  readonly codexId = 'shaman' as const;

  state: State = 'idle';
  timer = 0;
  castCd = 80;
  flash = 0;
  lastHitId = 0;
  deadTimer = 0;
  t = 0;
  private globs: PoisonGlob[] = [];

  constructor(
    public x: number,
    public y: number,
  ) {}

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }
  get dead(): boolean { return this.state === 'dead'; }
  get removable(): boolean { return this.state === 'dead' && this.deadTimer > 40; }

  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    if (this.state === 'dead') return false;
    this.hp -= dmg;
    this.flash = 6;
    if (this.hp <= 0) {
      this.state = 'dead';
      this.deadTimer = 0;
      return true;
    }
    this.state = 'hit';
    this.timer = hitstun;
    this.vx = dirX * kbx;
    this.vy = kby;
    return false;
  }

  getAttackHitbox(): Rect | null {
    return null;
  }

  update(w: World): void {
    this.t++;
    if (this.flash > 0) this.flash--;

    const { stage, player } = w;

    // 蛊球
    for (const g of this.globs) g.update(w);
    this.globs = this.globs.filter((g) => !g.dead);

    if (this.state === 'dead') {
      this.deadTimer++;
      return;
    }

    if (this.state === 'hit') {
      this.timer--;
      integrate(this, stage);
      if (this.timer <= 0) this.state = 'idle';
      if (this.y > stage.groundY + 40) this.state = 'dead';
      return;
    }

    if (this.castCd > 0) this.castCd--;

    const dx = player.centerX - this.centerX;
    const adx = Math.abs(dx);

    switch (this.state) {
      case 'windup':
        this.vx = 0;
        this.facing = dx > 0 ? 1 : -1;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 30;
          this.castCd = CAST_CD;
          // 朝玩家方向抛物线抛出（力度按飞行时间反推距离，保证落到玩家脚下）
          const power = clamp(adx / 40, 2, 7);
          this.globs.push(new PoisonGlob(this.centerX + this.facing * 10, this.y + 6, this.facing * power));
        }
        break;

      case 'recover':
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'idle';
        break;

      default: {
        if (player.state !== 'dead' && adx < 460) {
          this.facing = dx > 0 ? 1 : -1;
          if (adx < KEEP_MIN) {
            // 后退（沟边不退）
            this.state = 'retreat';
            const awayX = this.centerX - this.facing * 20;
            this.vx = stage.hasGroundAt(awayX) ? -this.facing * 1.1 : 0;
          } else if (adx > KEEP_MAX) {
            this.state = 'chase';
            const aheadX = this.centerX + this.facing * 20;
            this.vx = stage.hasGroundAt(aheadX) ? this.facing * 1.1 : 0;
          } else {
            this.state = 'idle';
            this.vx = 0;
            if (this.castCd <= 0) {
              this.state = 'windup';
              this.timer = WINDUP_TIME;
            }
          }
        } else {
          this.state = 'idle';
          this.vx = 0;
        }
      }
    }

    integrate(this, stage);
    if (this.y > stage.groundY + 40) {
      this.state = 'dead';
      this.deadTimer = 30;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const g of this.globs) g.draw(ctx);
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 40);
    }
    drawShaman(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
    });
    ctx.globalAlpha = 1;
  }
}
