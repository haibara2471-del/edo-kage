import type { Input } from './input';
import type { Stage } from './stage';
import { drawNinja } from './characters';

interface Petal { x: number; y: number; vy: number; phase: number; }

const JP_FONT = '"Yu Mincho","YuMincho","MS Mincho","Hiragino Mincho ProN",serif';

/** 标题画面：月夜庭院 + 屋檐忍者剪影 + 掠月瞬身演出 + 樱花 + 日文标题 */
export class Title {
  private t = 0;
  private petals: Petal[] = [];

  constructor() {
    for (let i = 0; i < 18; i++) {
      this.petals.push({
        x: Math.random() * 960,
        y: Math.random() * 540,
        vy: 0.4 + Math.random() * 0.6,
        phase: Math.random() * 6.28,
      });
    }
  }

  /** 返回 true 表示玩家确认开始 */
  update(input: Input): boolean {
    this.t++;
    for (const p of this.petals) {
      p.y += p.vy;
      p.x -= 0.35 + Math.sin(this.t * 0.02 + p.phase) * 0.3;
      if (p.y > 550) { p.y = -10; p.x = Math.random() * 1000; }
      if (p.x < -10) p.x = 970;
    }
    return input.consume('attack') || input.consume('jump');
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage, W: number, H: number): void {
    stage.drawBackground(ctx, 0, W, H, this.t);
    stage.drawGround(ctx);

    // 假山上的忍者剪影（待机演出）
    drawNinja(ctx, 920, 264, 20, 36, 1, { state: 'idle', t: this.t }, true);

    // 周期性掠过月亮的瞬身剪影
    const dashT = this.t % 300;
    if (dashT < 24) {
      const dx = 240 + (dashT / 24) * 560;
      for (let i = 3; i >= 0; i--) {
        ctx.globalAlpha = 0.12 + (0.22 * (3 - i)) / 3;
        drawNinja(ctx, dx - i * 18, 88, 20, 36, 1, { state: 'dash', t: this.t }, true);
      }
      ctx.globalAlpha = 1;
    }

    // 樱花花瓣
    for (const p of this.petals) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(this.t * 0.03 + p.phase);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#d9a7b6';
      ctx.fillRect(-2.5, -1.5, 5, 3);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 主标题
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e4c8';
    ctx.shadowColor = 'rgba(232,228,200,0.5)';
    ctx.shadowBlur = 24;
    ctx.font = `bold 96px ${JP_FONT}`;
    ctx.fillText('江戸影', W / 2, 210);
    ctx.shadowBlur = 0;

    // 红印「忍」
    ctx.fillStyle = '#b03040';
    ctx.fillRect(W / 2 + 130, 148, 44, 44);
    ctx.fillStyle = '#f5ead8';
    ctx.font = `bold 30px ${JP_FONT}`;
    ctx.fillText('忍', W / 2 + 152, 181);

    // 副标题
    ctx.fillStyle = 'rgba(232,228,200,0.75)';
    ctx.font = `20px ${JP_FONT}`;
    ctx.fillText('〜 月夜に刃を交えて 〜', W / 2, 258);

    ctx.fillStyle = 'rgba(200,208,240,0.4)';
    ctx.font = '13px monospace';
    ctx.fillText('E D O   N O   K A G E', W / 2, 286);

    // 开始提示（闪烁）
    if (this.t % 70 < 45) {
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('— PRESS J / 按 J 出阵 —', W / 2, 380);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px monospace';
    ctx.fillText('A/D 移动  W 跳/二段跳  J 刀  K 镖  L 瞬身  U 昇月  H 乱舞  O 水月  B 图鉴', W / 2, 500);
  }
}
