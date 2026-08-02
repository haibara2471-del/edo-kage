import type { World } from './world';
import type { Waves } from './waves';

function bar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  ratio: number, color: string, label: string,
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 4, y + h - 2);
}

/** Boss 血条：顶部居中宽条 + 名字 */
export function drawBossBar(
  ctx: CanvasRenderingContext2D,
  name: string,
  hp: number,
  maxHp: number,
  viewW: number,
): void {
  const w = 320;
  const x = (viewW - w) / 2;
  const y = 44;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 3, y - 3, w + 6, 16);
  ctx.fillStyle = '#3a0d14';
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = '#e04040';
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, hp / maxHp)), 10);
  ctx.strokeStyle = '#8a5a60';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, 10);
  ctx.fillStyle = '#e8e4c8';
  ctx.font = 'bold 14px "Yu Mincho","MS Mincho",serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, viewW / 2, y - 6);
}

/** HUD：血条 / 气条 / 波次 / 操作提示 */
export function drawHUD(ctx: CanvasRenderingContext2D, w: World, waves: Waves, viewW: number): void {
  const p = w.player;

  bar(ctx, 16, 14, 180, 14, p.hp / p.maxHp, '#e04040', `HP ${p.hp}`);
  bar(ctx, 16, 34, 140, 10, p.ki / p.maxKi, '#4ad0e0', `气 ${Math.floor(p.ki)}`);

  // 瞬身冷却指示
  ctx.fillStyle = p.dashCd <= 0 ? '#5f7cff' : '#3a4055';
  ctx.fillRect(16, 52, 10, 10);
  ctx.fillStyle = '#fff';
  ctx.font = '9px monospace';
  ctx.fillText('L', 18, 60);

  // 波次
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8e4c8';
  ctx.fillText(waves.label, viewW / 2, 30);

  if (waves.announceTimer > 0 && !waves.done) {
    const kanji = ['壱', '弐', '参'][waves.wave - 1] ?? String(waves.wave);
    ctx.globalAlpha = Math.min(1, waves.announceTimer / 30);
    ctx.font = 'bold 28px "Yu Mincho","MS Mincho",serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText(`第${kanji}波・襲来`, viewW / 2, 120);
    ctx.globalAlpha = 1;
  }

  if (p.state === 'dead') {
    ctx.font = 'bold 32px "Yu Mincho","MS Mincho",serif';
    ctx.fillStyle = '#ff5566';
    ctx.fillText('任務失敗', viewW / 2, 200);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('按 R 重新开始', viewW / 2, 236);
  }

  // 操作提示
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('A/D 移动  W 跳/二段跳  J 刀  K 镖  L 瞬身  U 昇月  H 乱舞  O 水月  B 图鉴  R 重开', 16, 526);
}
