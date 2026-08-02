import type { Rect } from './types';

/** 手里剑：水平直线飞行，旋转动画，命中或超时消失 */
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
  ) {}

  get rect(): Rect {
    return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h };
  }

  update(levelW: number): void {
    this.x += this.vx;
    this.spin += 0.35;
    if (--this.life <= 0 || this.x < -20 || this.x > levelW + 20) this.dead = true;
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
