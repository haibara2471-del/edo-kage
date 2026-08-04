import { rand } from './rng';
import { clamp } from './types';
import type { Rect } from './types';
import { Arrow } from './projectile';
import { TowerBoss } from './tower-boss';
import { drawMai } from './characters';
import type { World } from './world';

/**
 * 不知火舞（凤凰扇舞）：蝶舞三扇 / 焰舞地火 / 必杀忍蜂突进 / 凤凰之舞对空。
 * 打法：扇和火都是水平弹道——跳躲；忍蜂前摇瞬身穿背后；别在她面前乱二段跳。
 */
export class MaiBoss extends TowerBoss {
  readonly name = '不知火舞';
  readonly codexId = 'mai' as const;

  constructor(x: number, y: number) {
    super(x, y, 200);
  }

  get contactDamage(): number {
    switch (this.state) {
      case 'charge': return 10;
      case 'airCombo': return 6;
      default: return 0;
    }
  }

  getAttackHitbox(): Rect | null {
    switch (this.state) {
      case 'charge':
        if (this.timer < 3 || this.timer > 14) return null;
        return { x: this.facing > 0 ? this.x : this.x - 12, y: this.y + 4, w: this.w + 12, h: 34 };
      case 'airCombo': // 腾空乱扇，覆盖上方与周身
        if (this.timer > 16) return null;
        return { x: this.x - 34, y: this.y - 34, w: this.w + 68, h: 64 };
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
    const playerAir = player.centerY < this.y - 24;
    this.facing = dx > 0 ? 1 : -1;

    switch (this.state) {
      case 'fanWindup':
        this.vx = 0;
        if (--this.timer <= 0) {
          // 蝶舞·扇：正面扇形三扇
          const px = this.centerX + this.facing * 12;
          const py = this.y + 14;
          for (const a of [-0.22, 0, 0.22]) {
            w.arrows.push(new Arrow(px, py, Math.cos(a) * 5.5 * this.facing, { dmg: 5 }));
            const last = w.arrows[w.arrows.length - 1];
            last.vy = Math.sin(a) * 5.5;
          }
          this.state = 'recover';
          this.timer = 18;
          this.atkCd = this.phase2 ? 26 : 36;
        }
        break;

      case 'fireWindup':
        this.vx = 0;
        if (--this.timer <= 0) {
          // 焰舞·地火：贴地火线
          const a = new Arrow(this.centerX + this.facing * 10, this.y + this.h - 4, this.facing * 4.5, { dmg: 7 });
          a.vy = 0;
          w.arrows.push(a);
          this.state = 'recover';
          this.timer = 22;
          this.atkCd = this.phase2 ? 30 : 40;
        }
        break;

      case 'chargeWindup': // 必杀·忍蜂：下蹲蓄力
        this.vx = 0;
        if (--this.timer <= 0) {
          this.state = 'charge';
          this.timer = 18;
        }
        break;

      case 'charge':
        this.vx = this.facing * 11;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 26;
          this.atkCd = this.phase2 ? 26 : 38;
        }
        break;

      case 'airCombo': // 凤凰之舞：腾空乱扇
        if (this.timer === 18) {
          this.vy = -8;
          this.onGround = false;
        }
        if (this.timer < 16) this.vx = this.facing * 1.5;
        if (--this.timer <= 0 || this.y + this.h >= stage.groundY) {
          this.state = 'recover';
          this.timer = 18;
          this.atkCd = this.phase2 ? 24 : 34;
        }
        break;

      case 'recover':
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'walk';
        break;

      default: {
        this.state = 'walk';
        if (this.atkCd <= 0) {
          if (playerAir && adx < 100) {
            // 对空惩罚
            this.state = 'airCombo';
            this.timer = 18;
            this.vx = 0;
          } else if (adx > 140 && adx < 420 && rand() < 0.5) {
            this.state = 'fireWindup';
            this.timer = 22;
            this.vx = 0;
          } else if (adx > 60 && adx < 380 && rand() < 0.45) {
            this.state = 'fanWindup';
            this.timer = 18;
            this.vx = 0;
          } else if (adx < 300 && rand() < 0.5) {
            this.state = 'chargeWindup';
            this.timer = 16;
            this.vx = 0;
          } else {
            this.vx = adx > 40 ? this.facing * 2.2 : 0;
          }
        } else {
          this.vx = adx > 40 ? this.facing * 2.2 : 0;
        }
      }
    }
    this.x = clamp(this.x, 0, stage.width - this.w);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 70);
    }
    drawMai(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
    });
    ctx.globalAlpha = 1;
  }
}
