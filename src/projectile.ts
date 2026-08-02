import type { Rect } from './types';
import { rectsOverlap } from './types';
import { explodeOrb } from './combat';
import type { World } from './world';

/** 手里剑：直线飞行（扇形三连时带纵向分量），旋转动画，命中或超时消失 */
export class Projectile {
  dead = false;
  life = 80;
  spin = 0;
  readonly w = 12;
  readonly h = 12;
  readonly dmg = 6;

  constructor(
    public x: number,
    public y: number,
    public vx: number,
    public vy = 0,
  ) {}

  get rect(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  update(levelW: number): void {
    this.x += this.vx;
    this.y += this.vy;
    this.spin += 0.35;
    if (--this.life <= 0 || this.x < -20 || this.x > levelW + 20 || this.y < -20) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);
    ctx.fillStyle = '#dfe8ff';
    ctx.fillRect(-6, -1.5, 12, 3);
    ctx.fillRect(-1.5, -6, 3, 12);
    ctx.restore();
  }
}

/** 敌方箭矢/钩索：水平射出，带轻微下坠（远距离能威胁地面目标） */
export class Arrow {
  dead = false;
  vy = 0;
  readonly w = 14;
  readonly h = 3;
  readonly dmg: number;
  readonly pull: boolean;
  private readonly ox: number; // 发射原点（钩索画锁链用）
  private readonly oy: number;

  constructor(
    public x: number,
    public y: number,
    public vx: number,
    opts: { dmg?: number; pull?: boolean; origin?: { x: number; y: number } } = {},
  ) {
    this.dmg = opts.dmg ?? 8;
    this.pull = opts.pull ?? false;
    this.ox = opts.origin?.x ?? x;
    this.oy = opts.origin?.y ?? y;
  }

  get rect(): Rect {
    return { x: this.x - 7, y: this.y - 1.5, w: 14, h: 3 };
  }

  update(stage: { width: number; groundY: number; platforms: Rect[] }): void {
    this.x += this.vx;
    if (!this.pull) {
      // 箭矢带轻微下坠；钟馗钩锁链绷直，不受重力
      this.vy += 0.05;
      this.y += this.vy;
    }
    if (this.x < -20 || this.x > stage.width + 20 || this.y > stage.groundY) {
      this.dead = true;
      return;
    }
    for (const p of stage.platforms) {
      if (this.x > p.x && this.x < p.x + p.w && this.y > p.y && this.y < p.y + p.h) {
        this.dead = true;
        return;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const dir = Math.sign(this.vx);
    const tx = this.x - dir * 7; // 箭尾
    const ty = this.y - this.vy * 4;
    if (this.pull) {
      // 钟馗钩：镰刀钩 + 从发射者连过来的整条锁链
      ctx.fillStyle = '#8a94a8';
      const dx = this.x - this.ox;
      const dy = this.y - this.oy;
      const dist = Math.hypot(dx, dy);
      const links = Math.floor(dist / 7);
      for (let i = 0; i <= links; i++) {
        const t = links === 0 ? 0 : i / links;
        ctx.fillRect(this.ox + dx * t - 1.5, this.oy + dy * t - 1.5, 3, 3);
      }
      // 钩爪：弯月形镰刀（朝飞行方向开口）
      const dir = Math.sign(this.vx);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(dir, 1);
      ctx.strokeStyle = '#d8e0f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 6, -1.4, 1.2);
      ctx.stroke();
      ctx.beginPath(); // 倒刺
      ctx.moveTo(5.5, 3);
      ctx.lineTo(9, 5);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.strokeStyle = '#c09860';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
    ctx.fillStyle = '#f0f4ff'; // 箭头
    ctx.fillRect(this.x - 1.5, this.y - 1.5, 3, 3);
    ctx.fillStyle = '#e05060'; // 尾羽
    ctx.fillRect(tx - 1.5, ty - 2.5, 3, 2);
  }
}

/** 水月の術：缓慢前行的水弹，二段施法/命中/到限时引爆（AoE） */
export class WaterOrb {
  dead = false;
  detonate = false;
  life = 200;
  t = 0;
  readonly w = 16;
  readonly h = 16;

  constructor(
    public x: number,
    public y: number,
    public vx: number,
  ) {}

  get rect(): Rect {
    return { x: this.x - 8, y: this.y - 8, w: 16, h: 16 };
  }

  get radius(): number {
    return Math.min(16, 8 + this.t * 0.05);
  }

  update(w: World): void {
    this.t++;
    this.x += this.vx;
    if (--this.life <= 0) this.detonate = true;
    if (!this.detonate) {
      for (const e of w.enemies) {
        if (!e.dead && rectsOverlap(this.rect, e.rect)) {
          this.detonate = true;
          break;
        }
      }
    }
    if (this.x < 20 || this.x > w.stage.width - 20) this.detonate = true;
    if (this.detonate) {
      explodeOrb(w, this);
      this.dead = true;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.radius;
    const pulse = Math.sin(this.t * 0.15) * 1.5;
    ctx.fillStyle = 'rgba(90,160,255,0.35)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, r + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,210,255,0.8)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, (r + pulse) * 0.6, 0, Math.PI * 2);
    ctx.fill();
    // 内部漩涡
    ctx.strokeStyle = '#e0f0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.4, this.t * 0.2, this.t * 0.2 + 3.5);
    ctx.stroke();
  }
}

