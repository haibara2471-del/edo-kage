import type { Rect } from './types';
import { integrate } from './physics';
import { drawBruiser } from './characters';
import type { World } from './world';

type State = 'idle' | 'chase' | 'windup' | 'smash' | 'recover' | 'hit' | 'dead';

const WINDUP_TIME = 30;
const SMASH_TIME = 8;
const RECOVER_TIME = 40;
const ATK_CD = 50;
const ATTACK_RANGE = 60;

/**
 * 大力金刚：赤膊巨汉。带刚体——普通攻击打不出硬直（照常吃伤害），
 * 只有挑空类（三段重击/昇月斬）能打出浮空。砸地重击高伤，跳起躲避。
 */
export class Bruiser {
  readonly w = 30;
  readonly h = 46;
  vx = 0;
  vy = 0;
  facing = -1;
  onGround = false;

  hp = 80;
  readonly maxHp = 80;
  readonly contactDamage = 0;
  readonly codexId = 'bruiser' as const;
  readonly smashDmg = 18;

  state: State = 'idle';
  timer = 0;
  atkCd = 0;
  flash = 0;
  lastHitId = 0;
  deadTimer = 0;
  t = 0;

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
  get removable(): boolean { return this.state === 'dead' && this.deadTimer > 50; }

  /** 刚体：只有挑空（kby ≤ -5）能打出硬直 */
  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    if (this.state === 'dead') return false;
    this.hp -= dmg;
    this.flash = 4;
    if (this.hp <= 0) {
      this.state = 'dead';
      this.deadTimer = 0;
      this.vx = dirX * kbx;
      this.vy = kby;
      return true;
    }
    if (kby <= -5) {
      this.state = 'hit';
      this.timer = hitstun + 6;
      this.vx = dirX * kbx;
      this.vy = kby;
    }
    return false;
  }

  getAttackHitbox(): Rect | null {
    if (this.state !== 'smash') return null;
    return {
      x: this.facing > 0 ? this.x + this.w : this.x - 46,
      y: this.y + 8,
      w: 46,
      h: 34,
    };
  }

  update(w: World): void {
    this.t++;
    if (this.flash > 0) this.flash--;

    const { stage, player } = w;

    if (this.state === 'dead') {
      this.deadTimer++;
      if (this.deadTimer < 24) {
        this.vx *= 0.85;
        integrate(this, stage);
      }
      return;
    }

    if (this.state === 'hit') {
      this.timer--;
      integrate(this, stage);
      if (this.timer <= 0) this.state = 'chase';
      if (this.y > stage.groundY + 40) this.state = 'dead';
      return;
    }

    if (this.atkCd > 0) this.atkCd--;

    const dx = player.centerX - this.centerX;
    const adx = Math.abs(dx);

    switch (this.state) {
      case 'windup':
        this.vx = 0;
        this.facing = dx > 0 ? 1 : -1;
        if (--this.timer <= 0) {
          this.state = 'smash';
          this.timer = SMASH_TIME;
          w.effects.shake = Math.max(w.effects.shake, 5); // 砸地震屏
        }
        break;

      case 'smash':
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = RECOVER_TIME;
          this.atkCd = ATK_CD;
        }
        break;

      case 'recover':
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'chase';
        break;

      default: {
        if (player.state !== 'dead' && adx < 340) {
          this.state = 'chase';
          this.facing = dx > 0 ? 1 : -1;
          if (adx <= ATTACK_RANGE && this.atkCd <= 0) {
            this.state = 'windup';
            this.timer = WINDUP_TIME;
            this.vx = 0;
          } else if (adx > 30) {
            const aheadX = this.centerX + this.facing * 26;
            this.vx = stage.hasGroundAt(aheadX) ? this.facing * 0.8 : 0;
          } else {
            this.vx = 0;
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
      this.deadTimer = 35;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 50);
    }
    drawBruiser(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
    });
    ctx.globalAlpha = 1;
  }
}
