import { drawAshigaru, drawFlyer } from './characters';

export type CodexId = 'ashigaru' | 'crow' | 'bat';

interface Entry {
  id: CodexId;
  jp: string;        // 日文名
  cn: string;        // 中文名
  hp: number;
  atk: number;
  flavor: string[];  // 两行以内的描述
}

const ENTRIES: Entry[] = [
  {
    id: 'ashigaru', jp: '足軽', cn: '长枪足轻', hp: 30, atk: 10,
    flavor: ['大名的杂兵，但枪比你的刀长。', '别正面硬拼——跳过去，或瞬身绕后。'],
  },
  {
    id: 'crow', jp: '烏', cn: '不祥乌鸦', hp: 12, atk: 8,
    flavor: ['在高空盘旋，俯冲前会发出警告。', '够不着？用手里剑把它射下来。'],
  },
  {
    id: 'bat', jp: '蝙蝠', cn: '檐下魔蝠', hp: 8, atk: 5,
    flavor: ['巢居在檐下，飞得低、扑得快。', '二段跳的时候，小心头顶。'],
  },
];

const STORAGE_KEY = 'edo-kage-codex';
const JP_FONT = '"Yu Mincho","MS Mincho",serif';

/** 敌人图鉴：首次命中某类敌人后解锁（localStorage 持久化），B 键开关 */
export class Codex {
  private seen = new Set<CodexId>();

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) for (const id of JSON.parse(raw) as CodexId[]) this.seen.add(id);
    } catch { /* 隐私模式等场景下静默降级 */ }
  }

  mark(id: CodexId): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.seen]));
    } catch { /* 忽略 */ }
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
    ctx.fillStyle = 'rgba(5,7,15,0.88)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e4c8';
    ctx.font = `bold 34px ${JP_FONT}`;
    ctx.fillText('図 鑑', W / 2, 70);
    ctx.fillStyle = 'rgba(232,228,200,0.5)';
    ctx.font = '12px monospace';
    ctx.fillText(`已遭遇 ${this.seen.size} / ${ENTRIES.length}`, W / 2, 94);

    const cardW = 200;
    const cardH = 280;
    const gap = 40;
    const totalW = ENTRIES.length * cardW + (ENTRIES.length - 1) * gap;
    const x0 = (W - totalW) / 2;
    const y0 = 130;

    ENTRIES.forEach((e, i) => {
      const x = x0 + i * (cardW + gap);
      const seen = this.seen.has(e.id);

      // 卡片
      ctx.fillStyle = 'rgba(20,26,56,0.9)';
      ctx.fillRect(x, y0, cardW, cardH);
      ctx.strokeStyle = seen ? '#59627a' : '#2a3044';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y0, cardW, cardH);

      if (seen) {
        // 立绘（2.6 倍放大，居中偏上）
        ctx.save();
        ctx.translate(x + cardW / 2, y0 + 96);
        ctx.scale(2.6, 2.6);
        if (e.id === 'ashigaru') {
          drawAshigaru(ctx, -11, -17, 22, 34, 1, { state: 'idle', t, timer: 0, flash: 0 });
        } else {
          drawFlyer(ctx, -9, -6, 18, 12, 1, e.id, t, 'circle', 0);
        }
        ctx.restore();

        ctx.fillStyle = '#e8e4c8';
        ctx.font = `bold 24px ${JP_FONT}`;
        ctx.fillText(e.jp, x + cardW / 2, y0 + 156);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '13px monospace';
        ctx.fillText(e.cn, x + cardW / 2, y0 + 178);
        ctx.fillStyle = '#9fd8ff';
        ctx.fillText(`HP ${e.hp}   攻 ${e.atk}`, x + cardW / 2, y0 + 202);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '11px monospace';
        e.flavor.forEach((line, li) => {
          ctx.fillText(line, x + cardW / 2, y0 + 228 + li * 17);
        });
      } else {
        ctx.fillStyle = '#2a3044';
        ctx.font = 'bold 60px monospace';
        ctx.fillText('？', x + cardW / 2, y0 + 120);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = `18px ${JP_FONT}`;
        ctx.fillText('？？？', x + cardW / 2, y0 + 178);
        ctx.font = '11px monospace';
        ctx.fillText('尚未遭遇', x + cardW / 2, y0 + 202);
      }
    });

    if (t % 80 < 55) {
      ctx.fillStyle = '#ffd24a';
      ctx.font = '13px monospace';
      ctx.fillText('— 按 B 关闭 —', W / 2, H - 40);
    }
  }
}
