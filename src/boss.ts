import type { Rect } from './types';
import { clamp } from './types';
import { integrate } from './physics';
import { rand } from './rng';
import { drawBoss } from './characters';
import type { CodexId } from './codex';
import type { World } from './world';

type State =
  | 'idle' | 'walk' | 'combo' | 'dashWindup' | 'dashKick'
  | 'rising' | 'sweepWindup' | 'sweep' | 'recover' | 'hit' | 'dead';

const COMBO_FRAMES = [
  { startup: 4, activeEnd: 7, end: 12, range: 30, dmg: 4 },
  { startup: 4, activeEnd: 7, end: 12, range: 32, dmg: 5 },
  { startup: 5, activeEnd: 9, end: 16, range: 36, dmg: 8 },
];

/**
 * 终极 Boss「龙」（异邦武僧）：死神vs火影式——每招有前摇、每招有解。
 * 三连踢（镜像玩家连段）/ 飞踢突进（闪白蓄力）/ 升龙踢（对空）/ 残像步（受击闪避）/
 * 二阶段：加速 + 双节棍横扫 + 残像概率提升。三连受击强制残像（防无限连）。
 */
export class Boss {
  readonly w = 22;
  readonly h = 40;
  vx = 0;
  vy = 0;
  facing = -1;
  onGround = false;

  hp: number;
  readonly maxHp: number;
  readonly codexId: CodexId; // 'boss'=守门龙 / 'dragonPlus'=真龙（塔第一层）

  state: State = 'idle';
  timer = 0;
  atkCd = 40;
  comboStage = 1;
  flash = 0;
  lastHitId = 0;
  deadTimer = 0;
  t = 0;

  dodgeCd = 0;      // 残像后的短暂无敌
  private hitChain = 0;   // 短时间内连续受击计数
  private lastHitT = -99;
  private readonly dodgeBase: number;
  private readonly noPhase2: boolean;

  constructor(
    public x: number,
    public y: number,
    opts: { hp?: number; dodge?: number; noPhase2?: boolean; codexId?: CodexId } = {},
  ) {
    // 难度参数：RL 课程用（弱化版 → 完全版），游戏本体用默认值
    this.maxHp = opts.hp ?? 200;
    this.hp = this.maxHp;
    this.dodgeBase = opts.dodge ?? 0.25;
    this.noPhase2 = opts.noPhase2 ?? false;
    this.codexId = opts.codexId ?? 'boss';
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }
  get dead(): boolean { return this.state === 'dead'; }
  get removable(): boolean { return this.state === 'dead' && this.deadTimer > 70; }
  get phase2(): boolean { return !this.noPhase2 && this.hp <= this.maxHp / 2; }

  get contactDamage(): number {
    switch (this.state) {
      case 'combo': return COMBO_FRAMES[this.comboStage - 1].dmg;
      case 'dashKick': return 10;
      case 'rising': return 12;
      case 'sweep': return 12;
      default: return 0;
    }
  }

  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    if (this.state === 'dead' || this.dodgeCd > 0) return false;

    // 残像步：概率闪避；短时间三连受击强制触发（防无限连）
    if (this.t - this.lastHitT < 90) this.hitChain++;
    else this.hitChain = 1;
    this.lastHitT = this.t;

    const dodgeChance = this.phase2 ? Math.min(0.5, this.dodgeBase + 0.15) : this.dodgeBase;
    if (this.hitChain >= 3 || rand() < dodgeChance) {
      this.hitChain = 0;
      this.dodgeCd = 25;
      this.x = clamp(this.x - dirX * 70, 0, 2750 - this.w);
      this.vx = 0;
      this.state = 'idle';
      return false; // 闪掉了，无伤害
    }

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
    this.timer = Math.min(Math.floor(hitstun * 0.7), 12);
    this.vx = dirX * kbx * 0.7;
    this.vy = kby;
    return false;
  }

  getAttackHitbox(): Rect | null {
    switch (this.state) {
      case 'combo': {
        const f = COMBO_FRAMES[this.comboStage - 1];
        if (this.timer < f.startup || this.timer > f.activeEnd) return null;
        return {
          x: this.facing > 0 ? this.x + this.w : this.x - f.range,
          y: this.y + 6,
          w: f.range,
          h: 26,
        };
      }
      case 'dashKick':
        return { x: this.facing > 0 ? this.x : this.x - 10, y: this.y + 4, w: this.w + 10, h: 30 };
      case 'rising':
        return { x: this.x - 4, y: this.y - 20, w: this.w + 8, h: 34 };
      case 'sweep':
        if (this.timer > 8) return null;
        return { x: this.facing > 0 ? this.x + this.w : this.x - 55, y: this.y + 4, w: 55, h: 28 };
      default:
        return null;
    }
  }

  update(w: World): void {
    this.t++;
    if (this.flash > 0) this.flash--;
    if (this.dodgeCd > 0) this.dodgeCd--;
    if (this.atkCd > 0) this.atkCd--;

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
      if (this.timer <= 0) this.state = 'walk';
      return;
    }

    const dx = player.centerX - this.centerX;
    const adx = Math.abs(dx);

    switch (this.state) {
      case 'combo': {
        const f = COMBO_FRAMES[this.comboStage - 1];
        this.timer++;
        this.vx = this.timer <= f.activeEnd ? this.facing * 1.5 : 0;
        if (this.timer >= f.end) {
          if (this.comboStage < 3) {
            this.comboStage++;
            this.timer = 0;
          } else {
            this.state = 'recover';
            this.timer = this.phase2 ? 18 : 26;
            this.atkCd = this.phase2 ? 30 : 44;
          }
        }
        integrate(this, stage);
        return;
      }

      case 'dashWindup':
        this.vx = 0;
        this.facing = dx > 0 ? 1 : -1;
        if (--this.timer <= 0) {
          this.state = 'dashKick';
          this.timer = 14;
        }
        break;

      case 'dashKick':
        this.vx = this.facing * 10;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 22;
          this.atkCd = this.phase2 ? 28 : 40;
        }
        integrate(this, stage);
        return;

      case 'rising':
        this.vy = Math.min(this.vy + 0.55, 13);
        this.x = clamp(this.x + this.vx, 0, stage.width - this.w);
        this.y += this.vy;
        if (this.y + this.h >= stage.groundY) {
          this.y = stage.groundY - this.h;
          this.vy = 0;
          this.onGround = true;
          this.state = 'recover';
          this.timer = 18;
          this.atkCd = this.phase2 ? 28 : 40;
        }
        return;

      case 'sweepWindup':
        this.vx = 0;
        this.facing = dx > 0 ? 1 : -1;
        if (--this.timer <= 0) {
          this.state = 'sweep';
          this.timer = 8;
        }
        break;

      case 'sweep':
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 26;
          this.atkCd = this.phase2 ? 26 : 36;
        }
        break;

      case 'recover':
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'walk';
        break;

      default: {
        // idle / walk：追近并决策下一招
        if (player.state === 'dead') {
          this.state = 'idle';
          this.vx = 0;
          break;
        }
        this.state = 'walk';
        this.facing = dx > 0 ? 1 : -1;
        const speed = this.phase2 ? 2.8 : 2.2;
        const playerAir = player.centerY < this.y - 24;

        if (this.atkCd <= 0) {
          if (playerAir && adx < 90) {
            // 升龙踢：惩罚空中目标
            this.state = 'rising';
            this.vy = -12;
            this.vx = this.facing * 2;
            this.onGround = false;
            return;
          }
          if (adx < 52) {
            if (this.phase2 && rand() < 0.35) {
              this.state = 'sweepWindup';
              this.timer = 16;
            } else {
              this.state = 'combo';
              this.comboStage = 1;
              this.timer = 0;
            }
            this.vx = 0;
            return;
          }
          if (adx < 300 && rand() < 0.55) {
            this.state = 'dashWindup';
            this.timer = 20;
            this.vx = 0;
            return;
          }
        }
        this.vx = adx > 40 ? this.facing * speed : 0;
      }
    }

    integrate(this, stage);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead') {
      ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 70);
    }
    drawBoss(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
      comboStage: this.comboStage,
    });
    ctx.globalAlpha = 1;

    // 怪叫演出
    if (this.state === 'dashWindup') {
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('アチョー!', this.centerX, this.y - 10);
    }
    // 二阶段气场
    if (this.phase2 && this.state !== 'dead') {
      ctx.globalAlpha = 0.25 + Math.sin(this.t * 0.2) * 0.1;
      ctx.strokeStyle = '#ff8040';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
