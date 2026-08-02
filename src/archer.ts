import type { Rect } from './types';
import { integrate } from './physics';
import { Arrow } from './projectile';
import { drawArcher } from './characters';
import type { World } from './world';

type State = 'idle' | 'aim' | 'recover' | 'hit' | 'dead';

const AIM_TIME = 35;      // 瞄准（拉弓）帧数，最后 12 帧闪白警告
const RECOVER_TIME = 85;  // 放箭后的装填间隔
const RANGE = 520;        // 索敌距离
const LANE = 46;          // 只对高度相近的目标放箭（水平箭的"射界"）
const ARROW_SPEED = 7.5;

/** 弓箭手：驻守高台的固定炮台，水平放箭。箭可跳过/瞬身穿，本体用镖射或爬台击杀 */
export class Archer {
  readonly w = 20;
  readonly h = 34;
  vx = 0;
  vy = 0;
  facing = -1;
  onGround = true;

  hp = 15;
  readonly maxHp = 15;
  readonly contactDamage = 0; // 本体无碰撞伤害
  readonly codexId = 'archer' as const;

  state: State = 'idle';
  timer = 50;
  t = 0;
  flash = 0;
  lastHitId = 0;
  deadTimer = 0;

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

  /** 伤害来自箭矢，本体无攻击判定 */
  getAttackHitbox(): Rect | null {
    return null;
  }

  update(w: World): void {
    this.t++;
    if (this.flash > 0) this.flash--;

    const { stage, player } = w;

    if (this.state === 'dead') {
      this.deadTimer++;
      return;
    }

    if (this.state === 'hit') {
      this.timer--;
      integrate(this, stage);
      if (this.timer <= 0) this.state = 'idle';
      return;
    }

    const dx = player.centerX - this.centerX;
    const inLane = Math.abs(player.centerY - (this.y + 12)) < LANE;
    const inRange = Math.abs(dx) < RANGE;

    switch (this.state) {
      case 'idle':
        if (player.state !== 'dead' && inRange) {
          this.facing = dx > 0 ? 1 : -1;
          if (inLane && --this.timer <= 0) {
            this.state = 'aim';
            this.timer = AIM_TIME;
          }
        }
        break;

      case 'aim':
        this.facing = dx > 0 ? 1 : -1; // 瞄准时持续锁定方向
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = RECOVER_TIME;
          w.arrows.push(new Arrow(this.centerX + this.facing * 14, this.y + 12, this.facing * ARROW_SPEED));
        }
        break;

      case 'recover':
        if (--this.timer <= 0) {
          this.state = 'idle';
          this.timer = 30;
        }
        break;
    }

    integrate(this, stage); // 站定，仅处理重力/击退位移
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 40);
    }
    drawArcher(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
    });
    ctx.globalAlpha = 1;
  }
}
