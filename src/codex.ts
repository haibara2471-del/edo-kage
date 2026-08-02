import { drawAshigaru, drawFlyer } from './characters';
import type { Input } from './input';

export type CodexId = 'ashigaru' | 'crow' | 'bat';

interface Entry {
  id: CodexId;
  jp: string;        // 日文名
  cn: string;        // 中文名
  hp: number;
  atk: number;
  flavor: string[];  // 两行以内的描述
}

interface Skill {
  key: string;
  jp: string;
  cn: string;
  desc: string[];
}

/** 玩家技能（常驻可见，作为操作指南） */
const SKILLS: Skill[] = [
  {
    key: 'J', jp: '三連斬', cn: '短刀三连',
    desc: ['横斩 → 回斩 → 突刺击飞。', '命中回复「气」。', '第三段可把敌人轰下深沟。'],
  },
  {
    key: 'K', jp: '手裏剣', cn: '手里剑',
    desc: ['耗气 10 的远程攻击。', '够不着的飞行敌人，射下来。', '气靠短刀命中回复。'],
  },
  {
    key: 'L', jp: '瞬身', cn: '瞬身术',
    desc: ['带无敌帧的短距冲刺。', '可空中使用，穿过敌阵与枪尖。'],
  },
  {
    key: 'W', jp: '二段跳び', cn: '二段跳',
    desc: ['空中可再跳一次。', '坠落前最后的补救机会。'],
  },
  {
    key: 'I', jp: '飛索', cn: '飞索',
    desc: ['45° 抛出，钩住横梁或岩石后', '自动摆荡，到最高点自动松手飞出。', '绳索只能支撑 1 秒——断了就完了。'],
  },
];

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
const JP_FONT = '"Yu Mincho","YuMincho","MS Mincho","Hiragino Mincho ProN",serif';

type Page = 'skills' | 'monsters';

/** 图鉴：技能页（玩家操作指南）+ 敌人页（首次命中解锁，localStorage 持久化）。B 开关，A/D 翻页 */
export class Codex {
  private seen = new Set<CodexId>();
  private page: Page = 'skills';

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

  /** 返回 true 表示关闭图鉴 */
  update(input: Input): boolean {
    if (input.consume('left') || input.consume('right')) {
      this.page = this.page === 'skills' ? 'monsters' : 'skills';
    }
    return input.consume('codex') || input.consume('attack');
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
    ctx.fillStyle = 'rgba(8,10,22,0.9)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e4c8';
    ctx.font = `bold 32px ${JP_FONT}`;
    ctx.fillText('図 鑑', W / 2, 64);

    // 页签
    const tabs: { id: Page; label: string }[] = [
      { id: 'skills', label: '技 能' },
      { id: 'monsters', label: '敵 人' },
    ];
    tabs.forEach((tab, i) => {
      const tx = W / 2 + (i === 0 ? -110 : 110);
      const active = this.page === tab.id;
      ctx.fillStyle = active ? 'rgba(90,98,122,0.5)' : 'rgba(40,46,70,0.5)';
      ctx.fillRect(tx - 70, 88, 140, 34);
      if (active) {
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = 2;
        ctx.strokeRect(tx - 70, 88, 140, 34);
      }
      ctx.fillStyle = active ? '#ffd24a' : 'rgba(255,255,255,0.45)';
      ctx.font = `bold 18px ${JP_FONT}`;
      ctx.fillText(tab.label, tx, 112);
    });

    if (this.page === 'skills') this.drawSkills(ctx, W);
    else this.drawMonsters(ctx, W, t);

    if (t % 80 < 55) {
      ctx.fillStyle = '#ffd24a';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('— A/D 翻页 · 按 B 关闭 —', W / 2, H - 32);
    }
  }

  private drawSkills(ctx: CanvasRenderingContext2D, W: number): void {
    const cardW = 258;
    const cardH = 138;
    const gap = 26;
    const rowW = 3 * cardW + 2 * gap;
    const x0 = (W - rowW) / 2;
    const y0 = 152;

    SKILLS.forEach((s, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      // 第二行只有 2 张，居中
      const rowCount = row === 0 ? 3 : 2;
      const rowX = x0 + (3 - rowCount) * (cardW + gap) / 2;
      const x = rowX + col * (cardW + gap);
      const y = y0 + row * (cardH + gap);

      ctx.fillStyle = 'rgba(24,30,58,0.9)';
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeStyle = '#4a5474';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cardW, cardH);

      // 键位徽标
      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(x + 14, y + 14, 36, 36);
      ctx.fillStyle = '#1a1408';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(s.key, x + 32, y + 40);

      ctx.fillStyle = '#e8e4c8';
      ctx.font = `bold 20px ${JP_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(s.jp, x + 62, y + 32);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px monospace';
      ctx.fillText(s.cn, x + 62, y + 50);

      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '11px monospace';
      s.desc.forEach((line, li) => {
        ctx.fillText(line, x + 16, y + 74 + li * 18);
      });
    });

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A/D 移动 · 坠落深沟即任务失败 · R 重开', W / 2, y0 + 2 * (cardH + 26) + 18);
  }

  private drawMonsters(ctx: CanvasRenderingContext2D, W: number, t: number): void {
    ctx.fillStyle = 'rgba(232,228,200,0.5)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`已遭遇 ${this.seen.size} / ${ENTRIES.length}（命中过一次即解锁）`, W / 2, 144);

    const cardW = 200;
    const cardH = 268;
    const gap = 40;
    const totalW = ENTRIES.length * cardW + (ENTRIES.length - 1) * gap;
    const x0 = (W - totalW) / 2;
    const y0 = 166;

    ENTRIES.forEach((e, i) => {
      const x = x0 + i * (cardW + gap);
      const seen = this.seen.has(e.id);

      ctx.fillStyle = 'rgba(24,30,58,0.9)';
      ctx.fillRect(x, y0, cardW, cardH);
      ctx.strokeStyle = seen ? '#59627a' : '#2a3044';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y0, cardW, cardH);

      if (seen) {
        ctx.save();
        ctx.translate(x + cardW / 2, y0 + 90);
        ctx.scale(2.6, 2.6);
        if (e.id === 'ashigaru') {
          drawAshigaru(ctx, -11, -17, 22, 34, 1, { state: 'idle', t, timer: 0, flash: 0 });
        } else {
          drawFlyer(ctx, -9, -6, 18, 12, 1, e.id, t, 'circle', 0);
        }
        ctx.restore();

        ctx.fillStyle = '#e8e4c8';
        ctx.font = `bold 24px ${JP_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(e.jp, x + cardW / 2, y0 + 148);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '13px monospace';
        ctx.fillText(e.cn, x + cardW / 2, y0 + 170);
        ctx.fillStyle = '#9fd8ff';
        ctx.fillText(`HP ${e.hp}   攻 ${e.atk}`, x + cardW / 2, y0 + 194);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '11px monospace';
        e.flavor.forEach((line, li) => {
          ctx.fillText(line, x + cardW / 2, y0 + 220 + li * 17);
        });
      } else {
        ctx.fillStyle = '#2a3044';
        ctx.font = 'bold 60px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('？', x + cardW / 2, y0 + 116);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = `18px ${JP_FONT}`;
        ctx.fillText('？？？', x + cardW / 2, y0 + 170);
        ctx.font = '11px monospace';
        ctx.fillText('尚未遭遇', x + cardW / 2, y0 + 194);
      }
    });
  }
}
