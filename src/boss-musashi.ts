import { rand } from './rng';
import { clamp } from './types';
import type { Rect } from './types';
import { Arrow } from './projectile';
import { TowerBoss } from './tower-boss';
import { drawMusashi } from './characters';
import type { World } from './world';

/**
 * 宫本武藏（二天一流·剑圣）：神速突刺（带无敌帧）/ 二连斩+上挑 / 奥义无双大乱舞 / 剑气横扫。
 * 打法：神速的无敌帧也是破绽——穿过后背打硬直；奥义前摇长，跑出范围等他舞完。
 */
export class MusashiBoss extends TowerBoss {
  readonly name = '宮本武藏';
  readonly codexId = 'musashi' as const;
  private comboStage = 1;
  private ultHit = 0;
  private ultSecond = false; // 二阶段奥义是否已连放第二次
  private invuln = 0; // 神速突刺的无敌帧

  constructor(x: number, y: number) {
    super(x, y, 280);
  }

  get contactDamage(): number {
    switch (this.state) {
      case 'thrust': return 10;
      case 'combo': return this.comboStage === 3 ? 9 : 5;
      case 'ult': return 6;
      case 'slash': return 8;
      default: return 0;
    }
  }

  getAttackHitbox(): Rect | null {
    switch (this.state) {
      case 'thrust':
        if (this.timer < 2 || this.timer > 16) return null;
        return { x: this.facing > 0 ? this.x + this.w : this.x - 100, y: this.y + 4, w: 100, h: 28 };
      case 'combo': {
        const f = this.comboStage === 3
          ? { x: this.facing > 0 ? this.x + this.w - 8 : this.x - 42, y: this.y - 30, w: 50, h: 60 }
          : { x: this.facing > 0 ? this.x + this.w : this.x - 48, y: this.y + 4, w: 48, h: 30 };
        if (this.timer < 3 || this.timer > 9) return null;
        return f;
      }
      case 'ult':
        if (this.ultHit % 4 > 2) return null;
        return { x: this.x - 36, y: this.y - 6, w: this.w + 72, h: 52 };
      case 'slash':
        if (this.timer < 2 || this.timer > 8) return null;
        return { x: this.facing > 0 ? this.x + this.w : this.x - 62, y: this.y + 4, w: 62, h: 30 };
      default:
        return null;
    }
  }

  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    if (this.invuln > 0) return false; // 神速突刺无敌帧
    return super.takeHit(dmg, dirX, kbx, kby, hitstun);
  }

  protected ai(w: World): void {
    const { player, stage } = w;
    if (player.state === 'dead') {
      this.state = 'idle';
      this.vx = 0;
      return;
    }
    if (this.invuln > 0) this.invuln--;
    const dx = player.centerX - this.centerX;
    const adx = Math.abs(dx);
    this.facing = dx > 0 ? 1 : -1;

    switch (this.state) {
      case 'thrustWindup': // 神速·突：极短前摇
        this.vx = 0;
        if (--this.timer <= 0) {
          this.state = 'thrust';
          this.timer = 20;
          this.invuln = 10;
        }
        break;

      case 'thrust':
        this.vx = this.facing * 13;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 22;
          this.atkCd = this.phase2 ? 22 : 30;
        }
        break;

      case 'combo': // 二天一流·连斩：横→横→上挑
        this.vx = this.timer <= 6 ? this.facing * 2 : 0;
        if (--this.timer <= 0) {
          if (this.comboStage < 3) {
            this.comboStage++;
            this.timer = 14;
          } else {
            this.state = 'recover';
            this.timer = 26;
            this.atkCd = this.phase2 ? 26 : 36;
          }
        }
        break;

      case 'ultWindup': // 奥义·无双：转身长前摇（活靶子）
        this.vx = 0;
        if (--this.timer <= 0) {
          this.state = 'ult';
          this.timer = 36;
          this.ultHit = 0;
          this.ultSecond = false;
        }
        break;

      case 'ult': // 大范围多段乱舞，命中全吃
        this.vx = this.facing * 1;
        this.ultHit++;
        if (--this.timer <= 0) {
          if (this.phase2 && !this.ultSecond) {
            // 二阶段：奥义连放第二次
            this.ultSecond = true;
            this.state = 'ult';
            this.timer = 36;
          } else {
            this.state = 'recover';
            this.timer = 42;
            this.atkCd = this.phase2 ? 34 : 48;
          }
        }
        break;

      case 'slashWindup':
        this.vx = 0;
        if (--this.timer <= 0) {
          this.state = 'slash';
          this.timer = 12;
          // 剑气
          w.arrows.push(new Arrow(this.centerX + this.facing * 20, this.y + 16, this.facing * 6, { dmg: 6 }));
        }
        break;

      case 'slash':
        this.vx = 0;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 20;
          this.atkCd = this.phase2 ? 24 : 32;
        }
        break;

      case 'recover':
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'walk';
        break;

      default: {
        this.state = 'walk';
        if (this.atkCd <= 0) {
          if (adx > 120 && adx < 380 && rand() < 0.42) {
            this.state = 'thrustWindup';
            this.timer = 8;
            this.vx = 0;
          } else if (adx < 110) {
            if (this.phase2 && rand() < 0.28) {
              this.state = 'ultWindup';
              this.timer = 55;
            } else {
              this.state = 'combo';
              this.comboStage = 1;
              this.timer = 14;
            }
            this.vx = 0;
          } else if (adx < 340 && rand() < 0.4) {
            this.state = 'slashWindup';
            this.timer = 14;
            this.vx = 0;
          } else {
            this.vx = adx > 40 ? this.facing * 2.5 : 0;
          }
        } else {
          this.vx = adx > 40 ? this.facing * 2.5 : 0;
        }
      }
    }
    this.x = clamp(this.x, 0, stage.width - this.w);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 70);
    }
    drawMusashi(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
      comboStage: this.comboStage,
      invuln: this.invuln,
    });
    ctx.globalAlpha = 1;

    if (this.state === 'ultWindup') {
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 13px "Yu Mincho","MS Mincho",serif';
      ctx.textAlign = 'center';
      ctx.fillText('奥義…', this.centerX, this.y - 10);
    }
  }
}
