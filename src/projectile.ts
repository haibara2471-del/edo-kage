import type { Rect } from './types';

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

/** 敌方箭矢：水平射出，带轻微下坠（远距离能威胁地面目标） */
export class Arrow {
  dead = false;
  vy = 0;
  readonly w = 14;
  readonly h = 3;
  readonly dmg = 8;

  constructor(
    public x: number,
    public y: number,
    public vx: number,
  ) {}

  get rect(): Rect {
    return { x: this.x - 7, y: this.y - 1.5, w: 14, h: 3 };
  }

  update(stage: { width: number; groundY: number; platforms: Rect[] }): void {
    this.x += this.vx;
    this.vy += 0.05;
    this.y += this.vy;
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

