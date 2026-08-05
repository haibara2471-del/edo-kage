import type { Rect } from './types';
import { integrate } from './physics';
import { drawAshigaru } from './characters';
import type { World } from './world';

type State = 'idle' | 'chase' | 'windup' | 'thrust' | 'recover' | 'hit' | 'dead';

const AGGRO_RANGE = 300;
const ATTACK_RANGE = 70;
const CHASE_SPEED = 1.5;
const WINDUP_TIME = 18;
const THRUST_TIME = 8;
const RECOVER_TIME = 26;
const ATK_CD = 30;

/** 足轻（长枪兵）：发现玩家 → 追击 → 蓄力突刺。正面长枪判定比短刀长，教玩家绕后/跳跃 */
export class Enemy {
  readonly w = 22;
  readonly h = 34;
  vx = 0;
  vy = 0;
  facing = -1;
  onGround = false;

  hp = 30;
  readonly maxHp = 30;
  readonly thrustDmg = 10;
  readonly codexId = 'ashigaru' as const;

  state: State = 'idle';
  timer = 0;
  atkCd = 0;
  flash = 0;         // 受击白闪
  deadTimer = 0;
  lastHitId = 0;     // 玩家 attackId，防止一段攻击重复命中
  t = 0;             // 动画时钟

  constructor(
    public x: number,
    public y: number,
  ) {}

  static ashigaru(x: number, groundY: number): Enemy {
    const e = new Enemy(x, groundY - 34);
    return e;
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get contactDamage(): number { return this.thrustDmg; }

  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }
  get dead(): boolean { return this.state === 'dead'; }
  /** 死亡动画播完，可以移除 */
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
    // 突刺前摇/判定霸体：出招不被打断（玩家反馈：平推迎面会被刺中，只能躲开再打收招）。
    // 轻攻击（kby>-5）无效，重击/挑空（kby≤-5，如第三段、昇月斬）可破霸体——玩家有技能型反制。
    // 仍掉血、仍可被击杀；收招（recover）无霸体，是唯一反击窗口
    if ((this.state === 'windup' || this.state === 'thrust') && kby > -5) {
      this.vx = 0;
      this.vy = 0;
      return false;
    }
    this.state = 'hit';
    this.timer = hitstun;
    this.vx = dirX * kbx;
    this.vy = kby;
    return false;
  }

  /** 长枪突刺判定框 */
  getAttackHitbox(): Rect | null {
    if (this.state !== 'thrust') return null;
    return {
      x: this.facing > 0 ? this.x + this.w : this.x - 36,
      y: this.y + 10,
      w: 36,
      h: 10,
    };
  }

  update(w: World): void {
    const { stage, player } = w;

    this.t++;
    if (this.flash > 0) this.flash--;

    if (this.state === 'dead') {
      this.deadTimer++;
      // 尸体短暂倒地滑行
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
      if (this.y > stage.groundY + 40) this.state = 'dead'; // 被打落深沟
      return;
    }

    if (this.atkCd > 0) this.atkCd--;

    const dx = player.centerX - this.centerX;
    const adx = Math.abs(dx);
    const playerAlive = player.state !== 'dead';

    switch (this.state) {
      case 'windup':
        this.vx = 0;
        this.facing = dx > 0 ? 1 : -1; // 蓄力时锁定方向
        if (--this.timer <= 0) {
          this.state = 'thrust';
          this.timer = THRUST_TIME;
        }
        break;

      case 'thrust':
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
        // idle / chase
        if (playerAlive && adx < AGGRO_RANGE) {
          this.state = 'chase';
          this.facing = dx > 0 ? 1 : -1;
          if (adx <= ATTACK_RANGE && this.atkCd <= 0) {
            this.state = 'windup';
            this.timer = WINDUP_TIME;
            this.vx = 0;
          } else if (adx > 40) {
            // 深沟边缘停步，不会自己走下去
            const aheadX = this.centerX + this.facing * 24;
            this.vx = stage.hasGroundAt(aheadX) ? this.facing * CHASE_SPEED : 0;
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
      this.state = 'dead'; // 坠落深沟
      this.deadTimer = 30;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 40);
    }
    drawAshigaru(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
    });
    ctx.globalAlpha = 1;
  }
}
