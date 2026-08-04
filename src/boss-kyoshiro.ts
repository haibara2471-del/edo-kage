import { rand } from './rng';
import { clamp } from './types';
import type { Rect } from './types';
import { TowerBoss } from './tower-boss';
import { drawKyoshiro } from './characters';
import type { World } from './world';

/**
 * 橘右京（拔刀剑士）：居合突进 / 燕返反击 / 拔刀蓄力（可打断）/ 一闪残影突刺。
 * 打法：见下蹲闪白就瞬身穿背后打收招；蓄力是活靶子冲上去打断。
 */
export class KyoshiroBoss extends TowerBoss {
  readonly name = '橘右京';
  readonly codexId = 'kyoshiro' as const;
  private thrustTwice = false; // 二阶段二连突第二段

  constructor(x: number, y: number) {
    super(x, y, 220);
  }

  get contactDamage(): number {
    switch (this.state) {
      case 'slashDash': return 10;
      case 'counter': return 8;
      case 'heavySlash': return 16;
      case 'thrust': return 8;
      default: return 0;
    }
  }

  getAttackHitbox(): Rect | null {
    switch (this.state) {
      case 'slashDash':
        if (this.timer < 4 || this.timer > 13) return null;
        return { x: this.facing > 0 ? this.x + this.w : this.x - 70, y: this.y + 6, w: 70, h: 28 };
      case 'counter':
        if (this.timer < 2 || this.timer > 8) return null;
        return { x: this.facing > 0 ? this.x + this.w : this.x - 55, y: this.y + 6, w: 55, h: 26 };
      case 'heavySlash':
        if (this.timer < 2 || this.timer > 9) return null;
        return { x: this.facing > 0 ? this.x + this.w : this.x - 80, y: this.y - 6, w: 80, h: 44 };
      case 'thrust':
        if (this.timer < 1 || this.timer > 17) return null;
        return { x: this.facing > 0 ? this.x + this.w : this.x - 95, y: this.y + 4, w: 95, h: 26 };
      default:
        return null;
    }
  }

  protected ai(w: World): void {
    const { player, stage } = w;
    if (player.state === 'dead') {
      this.state = 'idle';
      this.vx = 0;
      return;
    }
    const dx = player.centerX - this.centerX;
    const adx = Math.abs(dx);
    this.facing = dx > 0 ? 1 : -1;

    switch (this.state) {
      case 'slashWindup': // 居合·细雪：下蹲闪白蓄力
        this.vx = 0;
        if (--this.timer <= 0) {
          this.state = 'slashDash';
          this.timer = 18;
        }
        break;

      case 'slashDash': // 前冲拔刀横斩
        this.vx = this.facing * 7;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 22;
          this.atkCd = this.phase2 ? 26 : 38;
        }
        break;

      case 'counter': // 秘剑·燕返：先小后撤再反手横斩
        this.vx = -this.facing * 2.5;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 24;
          this.atkCd = this.phase2 ? 22 : 32;
        }
        break;

      case 'chargeUp': // 拔刀蓄力（活靶子，可打断）
        this.vx = 0;
        if (--this.timer <= 0) {
          this.state = 'heavySlash';
          this.timer = 12;
        }
        break;

      case 'heavySlash':
        this.vx = this.timer > 6 ? this.facing * 1 : 0;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 30;
          this.atkCd = this.phase2 ? 30 : 44;
        }
        break;

      case 'thrustWindup': // 一闪·残影：短前摇
        this.vx = 0;
        if (--this.timer <= 0) {
          this.state = 'thrust';
          this.timer = this.phase2 ? 26 : 18;
          this.thrustTwice = false;
        }
        break;

      case 'thrust':
        this.vx = this.facing * 12;
        if (--this.timer <= 0) {
          if (this.phase2 && !this.thrustTwice) {
            this.thrustTwice = true;
            this.state = 'thrust';
            this.timer = 22;
            this.vx = 0;
          } else {
            this.state = 'recover';
            this.timer = 18;
            this.atkCd = this.phase2 ? 28 : 34;
          }
        }
        break;

      case 'recover':
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'walk';
        break;

      default: {
        // idle / walk：追近并决策
        this.state = 'walk';
        if (this.atkCd <= 0) {
          if (adx < 360 && rand() < 0.28) {
            this.state = 'thrustWindup';
            this.timer = 10;
            this.vx = 0;
          } else if (adx < 130) {
            if (rand() < 0.35) {
              this.state = 'counter';
              this.timer = 7;
            } else if (this.phase2 && rand() < 0.3) {
              this.state = 'chargeUp';
              this.timer = 50;
            } else {
              this.state = 'slashWindup';
              this.timer = 14;
            }
            this.vx = 0;
          } else if (adx < 340 && rand() < 0.45) {
            this.state = 'slashWindup';
            this.timer = 14;
            this.vx = 0;
          } else {
            this.vx = adx > 40 ? this.facing * 2.4 : 0;
          }
        } else {
          this.vx = adx > 40 ? this.facing * 2.4 : 0;
        }
      }
    }
    this.x = clamp(this.x, 0, stage.width - this.w);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 70);
    }
    drawKyoshiro(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
    });
    ctx.globalAlpha = 1;

    // 蓄力/前摇闪白已在 draw 内处理；拔刀蓄力时显示拔刀读条
    if (this.state === 'chargeUp') {
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 12px "Yu Mincho","MS Mincho",serif';
      ctx.textAlign = 'center';
      ctx.fillText('拔刀…', this.centerX, this.y - 10);
    }
  }
}
