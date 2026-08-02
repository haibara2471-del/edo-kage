import type { Rect } from './types';
import { integrate } from './physics';
import { Arrow } from './projectile';
import { drawHookSoldier } from './characters';
import type { World } from './world';

type State = 'idle' | 'chase' | 'windup' | 'recover' | 'hit' | 'dead';

const HOOK_RANGE = 260;   // 甩钩距离
const HOOK_MIN = 120;     // 贴脸不出钩
const WINDUP_TIME = 18;
const RECOVER_TIME = 40;
const HOOK_CD = 140;
const HOOK_SPEED = 9;

/** 鉤使（钟馗钩）：中距离甩锁链钩，命中把玩家拽到他面前挨打。解法：瞬身穿钩/跳过/拉近距离 */
export class HookSoldier {
  readonly w = 22;
  readonly h = 34;
  vx = 0;
  vy = 0;
  facing = -1;
  onGround = false;

  hp = 26;
  readonly maxHp = 26;
  readonly contactDamage = 0;
  readonly codexId = 'hook' as const;

  state: State = 'idle';
  timer = 0;
  atkCd = 60;
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
  get removable(): boolean { return this.state === 'dead' && this.deadTimer > 40; }

  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    if (this.state === 'dead') return false;
    this.hp -= dmg;
    this.flash = 6;
    if (this.hp <= 0) {
      this.state = 'dead';
      this.deadTimer = 0;
      this.vx = dirX * kbx;
      this.vy = kby;
      return true;
    }
    this.state = 'hit';
    this.timer = hitstun;
    this.vx = dirX * kbx;
    this.vy = kby;
    return false;
  }

  getAttackHitbox(): Rect | null {
    return null; // 伤害来自钩索飞行物
  }

  update(w: World): void {
    this.t++;
    if (this.flash > 0) this.flash--;

    const { stage, player } = w;

    if (this.state === 'dead') {
      this.deadTimer++;
      if (this.deadTimer < 20) {
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
          this.state = 'recover';
          this.timer = RECOVER_TIME;
          this.atkCd = HOOK_CD;
          w.arrows.push(
            new Arrow(this.centerX + this.facing * 14, this.y + 12, this.facing * HOOK_SPEED, { dmg: 6, pull: true }),
          );
        }
        break;

      case 'recover':
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'chase';
        break;

      default: {
        if (player.state !== 'dead' && adx < 400) {
          this.state = 'chase';
          this.facing = dx > 0 ? 1 : -1;
          if (adx > HOOK_MIN && adx < HOOK_RANGE && this.atkCd <= 0) {
            this.state = 'windup';
            this.timer = WINDUP_TIME;
            this.vx = 0;
          } else if (adx > HOOK_MIN) {
            const aheadX = this.centerX + this.facing * 24;
            this.vx = stage.hasGroundAt(aheadX) ? this.facing * 1.2 : 0;
          } else {
            this.vx = 0; // 贴脸束手（钩使近战弱，近身是解法之一）
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
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 40);
    }
    drawHookSoldier(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
    });
    ctx.globalAlpha = 1;
  }
}
