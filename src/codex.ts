import { drawAshigaru, drawFlyer, drawArcher, drawHookSoldier, drawBruiser, drawShaman } from './characters';
import type { Input } from './input';

export type CodexId = 'ashigaru' | 'archer' | 'hook' | 'bruiser' | 'shaman' | 'crow' | 'bat';

interface Entry {
  id: CodexId;
  jp: string;
  cn: string;
  hp: number;
  atk: number;
  flavor: string[];
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
    desc: ['横斩→回斩→突刺击飞。', '命中回气；第三段挑空', '可接昇月斬与朧乱舞。'],
  },
  {
    key: 'K', jp: '手裏剣', cn: '扇形三连镖',
    desc: ['耗气 10，上中下三发。', '纵向覆盖，打飞行物利器。'],
  },
  {
    key: 'L', jp: '瞬身', cn: '瞬身术',
    desc: ['带无敌帧的短距冲刺。', '可空中使用，穿敌穿枪穿钩。'],
  },
  {
    key: 'U', jp: '昇月斬', cn: '升月斩',
    desc: ['耗气 10，拔刀上挑。', '人随刀起，把敌人挑到空中。'],
  },
  {
    key: 'H', jp: '朧乱舞', cn: '胧乱舞',
    desc: ['耗气 20，空中九段连斩。', '挑空后衔接，就是经典连招。'],
  },
  {
    key: 'O', jp: '水月の術', cn: '水月之术',
    desc: ['耗气 25，放出缓行水弹。', '再按 O / 命中 / 到限引爆，', '大范围高伤害。'],
  },
  {
    key: 'W', jp: '跳び・飛索', cn: '跳 / 飞索',
    desc: ['空中按 W：附近有锚点自动', '抛索钩住；再按 W 松手飞出。', '无锚点则二段跳；A/D 泵摆加速。'],
  },
];

const ENTRIES: Entry[] = [
  {
    id: 'ashigaru', jp: '足軽', cn: '长枪足轻', hp: 30, atk: 10,
    flavor: ['枪比你的刀长。', '跳过去，或瞬身绕后。'],
  },
  {
    id: 'archer', jp: '弓兵', cn: '高台弓箭手', hp: 15, atk: 8,
    flavor: ['占据高台，箭走水平。', '跳箭、瞬身，或对射。'],
  },
  {
    id: 'hook', jp: '鉤使い', cn: '钩使', hp: 26, atk: 6,
    flavor: ['甩锁链钩把你拽过去。', '瞬身穿钩，或贴脸快攻。'],
  },
  {
    id: 'bruiser', jp: '金剛', cn: '大力金刚', hp: 80, atk: 18,
    flavor: ['刚体：普通攻击无硬直。', '挑空类才打得动他。', '砸地时跳起躲避。'],
  },
  {
    id: 'shaman', jp: '蠱師', cn: '蛊术师', hp: 20, atk: 8,
    flavor: ['抛毒蛊，雾中持续掉血。', '他会保持距离——贴脸打。'],
  },
  {
    id: 'crow', jp: '烏', cn: '不祥乌鸦', hp: 12, atk: 8,
    flavor: ['高空盘旋，俯冲有警告。', '扇形镖射下来。'],
  },
  {
    id: 'bat', jp: '蝙蝠', cn: '檐下魔蝠', hp: 8, atk: 5,
    flavor: ['飞得低、扑得快。', '二段跳时小心头顶。'],
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
    ctx.fillStyle = 'rgba(8,10,22,0.92)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e4c8';
    ctx.font = `bold 30px ${JP_FONT}`;
    ctx.fillText('図 鑑', W / 2, 54);

    const tabs: { id: Page; label: string }[] = [
      { id: 'skills', label: '技 能' },
      { id: 'monsters', label: '敵 人' },
    ];
    tabs.forEach((tab, i) => {
      const tx = W / 2 + (i === 0 ? -110 : 110);
      const active = this.page === tab.id;
      ctx.fillStyle = active ? 'rgba(90,98,122,0.5)' : 'rgba(40,46,70,0.5)';
      ctx.fillRect(tx - 70, 70, 140, 30);
      if (active) {
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = 2;
        ctx.strokeRect(tx - 70, 70, 140, 30);
      }
      ctx.fillStyle = active ? '#ffd24a' : 'rgba(255,255,255,0.45)';
      ctx.font = `bold 17px ${JP_FONT}`;
      ctx.fillText(tab.label, tx, 92);
    });

    if (this.page === 'skills') this.drawSkills(ctx, W);
    else this.drawMonsters(ctx, W, t);

    if (t % 80 < 55) {
      ctx.fillStyle = '#ffd24a';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('— A/D 翻页 · 按 B 关闭 —', W / 2, H - 18);
    }
  }

  private drawSkills(ctx: CanvasRenderingContext2D, W: number): void {
    const cardW = 250;
    const cardH = 116;
    const gap = 16;
    const rowW = 3 * cardW + 2 * gap;
    const x0 = (W - rowW) / 2;
    const y0 = 118;

    SKILLS.forEach((s, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = x0 + col * (cardW + gap);
      const y = y0 + row * (cardH + gap);

      ctx.fillStyle = 'rgba(24,30,58,0.9)';
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeStyle = '#4a5474';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, cardW, cardH);

      ctx.fillStyle = '#ffd24a';
      ctx.fillRect(x + 10, y + 10, 30, 30);
      ctx.fillStyle = '#1a1408';
      ctx.font = 'bold 19px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(s.key, x + 25, y + 32);

      ctx.fillStyle = '#e8e4c8';
      ctx.font = `bold 17px ${JP_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(s.jp, x + 50, y + 24);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '11px monospace';
      ctx.fillText(s.cn, x + 50, y + 40);

      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10.5px monospace';
      s.desc.forEach((line, li) => {
        ctx.fillText(line, x + 12, y + 62 + li * 16);
      });
    });

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A/D 移动 · 坠落深沟即任务失败 · R 重开', W / 2, y0 + 3 * (cardH + gap) + 14);
  }

  private drawMonsters(ctx: CanvasRenderingContext2D, W: number, t: number): void {
    const cardW = 165;
    const cardH = 196;
    const gap = 18;
    const cols = 4;
    const totalW = cols * cardW + (cols - 1) * gap;
    const x0 = (W - totalW) / 2;
    const y0 = 118;

    ENTRIES.forEach((e, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = x0 + col * (cardW + gap);
      const y = y0 + row * (cardH + gap);
      const seen = this.seen.has(e.id);

      ctx.fillStyle = 'rgba(24,30,58,0.9)';
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeStyle = seen ? '#59627a' : '#2a3044';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, cardW, cardH);

      if (seen) {
        ctx.save();
        ctx.translate(x + cardW / 2, y + 72);
        ctx.scale(2.0, 2.0);
        switch (e.id) {
          case 'ashigaru':
            drawAshigaru(ctx, -11, -17, 22, 34, 1, { state: 'idle', t, timer: 0, flash: 0 });
            break;
          case 'archer':
            drawArcher(ctx, -10, -17, 20, 34, 1, { state: 'idle', t, timer: 0, flash: 0 });
            break;
          case 'hook':
            drawHookSoldier(ctx, -11, -17, 22, 34, 1, { state: 'idle', t, timer: 0, flash: 0 });
            break;
          case 'bruiser':
            drawBruiser(ctx, -15, -23, 30, 46, 1, { state: 'idle', t, timer: 0, flash: 0 });
            break;
          case 'shaman':
            drawShaman(ctx, -10, -16, 20, 32, 1, { state: 'idle', t, timer: 0, flash: 0 });
            break;
          default:
            drawFlyer(ctx, -9, -6, 18, 12, 1, e.id, t, 'circle', 0);
        }
        ctx.restore();

        ctx.fillStyle = '#e8e4c8';
        ctx.font = `bold 20px ${JP_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(e.jp, x + cardW / 2, y + 116);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '11px monospace';
        ctx.fillText(e.cn, x + cardW / 2, y + 134);
        ctx.fillStyle = '#9fd8ff';
        ctx.fillText(`HP ${e.hp}  攻 ${e.atk}`, x + cardW / 2, y + 152);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '10px monospace';
        e.flavor.forEach((line, li) => {
          ctx.fillText(line, x + cardW / 2, y + 168 + li * 13);
        });
      } else {
        ctx.fillStyle = '#2a3044';
        ctx.font = 'bold 48px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('？', x + cardW / 2, y + 92);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = `15px ${JP_FONT}`;
        ctx.fillText('？？？', x + cardW / 2, y + 134);
      }
    });
  }
}
