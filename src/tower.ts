import { Boss } from './boss';
import { KyoshiroBoss } from './boss-kyoshiro';
import { MaiBoss } from './boss-mai';
import { MusashiBoss } from './boss-musashi';
import type { World } from './world';

/** 塔竞技场边界：左墙可见石墙，右墙即舞台尽头（无隐形空气墙） */
const ARENA_L = 2300;
const ARENA_R = 2750;
const ARENA_CX = (ARENA_L + ARENA_R) / 2; // 2525
const FLOOR_NAMES = ['真龍', '橘右京', '不知火舞', '宮本武藏'];

/**
 * Boss 塔·千刃の試練：杀戮尖塔式逐层 Boss 挑战。
 * HP/气跨层保留 + 每层开始回 20；死亡从当前层重开（回满）。
 * 层序：真龙(1) → 橘右京(2) → 不知火舞(3) → 宫本武藏(4)=塔顶。
 */
export class Tower {
  floor = 0; // 0-based
  readonly total = 4;
  active = false;
  state: 'enter' | 'fight' | 'done' = 'enter';
  announce = 0;
  done = false;
  barrierL: number | null = null;
  barrierR: number | null = null;
  bossName = '';
  private respawn = -1; // >=0 时死亡重开倒计时

  get label(): string {
    if (this.state === 'done') return '塔頂・試練達成';
    return `試練 第${this.floor + 1}層 · ${FLOOR_NAMES[this.floor]}`;
  }

  /** 塔内固定相机：竞技场居中（不随玩家平移，营造独立 Boss 房） */
  get camX(): number { return ARENA_CX - 480; }

  /** 从第 floor 层开始爬塔（0 起） */
  start(w: World, floor: number): void {
    this.floor = Math.max(0, Math.min(this.total - 1, floor));
    this.active = true;
    this.barrierL = ARENA_L;
    this.barrierR = ARENA_R;
    this.respawn = -1;
    this.enterFloor(w, false);
  }

  private enterFloor(w: World, fullHeal: boolean): void {
    w.enemies = w.enemies.filter((e) => e.dead);
    w.enemies = [];
    const cx = (ARENA_L + ARENA_R) / 2;
    const gy = w.stage.groundY;

    // 玩家复位到竞技场左侧
    w.player.x = ARENA_L + 30;
    w.player.y = gy - w.player.h;
    w.player.vx = 0;
    w.player.vy = 0;
    w.player.state = 'idle';
    w.player.hitTimer = 0;
    w.player.invTimer = 0;

    // 状态管理：跨层保留 + 每层 +20；死亡重开回满
    if (fullHeal) {
      w.player.hp = w.player.maxHp;
      w.player.ki = w.player.maxKi;
    } else {
      w.player.hp = Math.min(w.player.maxHp, w.player.hp + 20);
      w.player.ki = Math.min(w.player.maxKi, w.player.ki + 20);
    }

    this.bossName = FLOOR_NAMES[this.floor];
    if (this.floor === 0) {
      w.enemies.push(new Boss(cx, gy - 40, { hp: 300, dodge: 0.35 })); // 真龙（强化龙）
    } else if (this.floor === 1) {
      w.enemies.push(new KyoshiroBoss(cx, gy - 34));
    } else if (this.floor === 2) {
      w.enemies.push(new MaiBoss(cx, gy - 34));
    } else {
      w.enemies.push(new MusashiBoss(cx, gy - 34));
    }

    this.state = 'fight';
    this.announce = 120;
  }

  update(w: World): void {
    if (this.announce > 0) this.announce--;
    if (this.state === 'done') return;

    // 死亡 → 重开当前层
    if (w.player.state === 'dead') {
      if (this.respawn < 0) this.respawn = 120;
      if (--this.respawn <= 0) {
        this.respawn = -1;
        this.enterFloor(w, true);
      }
      return;
    }

    if (this.state === 'fight' && w.enemies.length === 0) {
      if (this.floor >= this.total - 1) {
        this.state = 'done';
        this.done = true;
        this.barrierL = null;
        this.barrierR = null;
      } else {
        this.floor++;
        this.enterFloor(w, false);
      }
    }
  }

  /** 塔内背景：深色石室 + 石柱 + 火把（区别于横板庭院的独立场景风格） */
  drawBackdrop(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, t: number): void {
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, '#17131f');
    g.addColorStop(0.55, '#221c2e');
    g.addColorStop(1, '#0f0c18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);

    // 拱顶暗带
    ctx.fillStyle = 'rgba(8,6,14,0.65)';
    ctx.fillRect(0, 0, viewW, 74);
    // 远景石柱
    for (let i = 0; i < 4; i++) {
      const px = 60 + i * 250;
      ctx.fillStyle = i % 2 ? '#2c2838' : '#332e42';
      ctx.fillRect(px, 84, 36, viewH - 84);
      ctx.fillStyle = '#241f30';
      ctx.fillRect(px + 28, 84, 8, viewH - 84);
    }
    // 火把（闪烁）
    for (let i = 0; i < 3; i++) {
      const fx = 40 + i * 440;
      ctx.fillStyle = '#5a4630';
      ctx.fillRect(fx - 2, 200, 4, 54);
      const fl = 0.5 + 0.5 * Math.sin(t * 0.25 + i * 2.1);
      ctx.fillStyle = `rgba(255,${Math.round(150 + fl * 60)},60,${0.75 + fl * 0.25})`;
      ctx.beginPath();
      ctx.arc(fx, 194, 5 + fl * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 塔内竞技场：石砖地板 + 左右可见石墙（不再有隐形空气墙） */
  drawArena(ctx: CanvasRenderingContext2D, camX: number, viewW: number, groundY: number, t: number): void {
    // 地板（竞技场范围，其余为背景石室）
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(ARENA_L, groundY, ARENA_R - ARENA_L, 46);
    ctx.fillStyle = '#4a4a58';
    ctx.fillRect(ARENA_L, groundY, ARENA_R - ARENA_L, 3);
    ctx.strokeStyle = '#2e2e3a';
    ctx.lineWidth = 1;
    for (let x = ARENA_L; x < ARENA_R; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x, groundY + 46);
      ctx.stroke();
    }
    // 左右石墙（可见边界，替代隐形空气墙）
    for (const wx of [ARENA_L, ARENA_R]) {
      ctx.fillStyle = '#4a4658';
      ctx.fillRect(wx - 6, groundY - 224, 12, 224);
      ctx.fillStyle = '#3a3846';
      ctx.fillRect(wx - 6, groundY - 224, 4, 224);
      ctx.fillStyle = '#5a5668';
      ctx.fillRect(wx - 10, groundY - 230, 20, 10);
    }
  }

  /** 塔内 UI：层数横幅 + 塔顶达成 */
  draw(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    if (this.state === 'done') {
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 30px "Yu Mincho","MS Mincho",serif';
      ctx.textAlign = 'center';
      ctx.fillText('千刃の試練 達成', viewW / 2, 140);
      ctx.font = '14px monospace';
      ctx.fillStyle = '#e8e4c8';
      ctx.fillText('按 R 重新开始', viewW / 2, 176);
      return;
    }
    if (this.announce > 0) {
      ctx.globalAlpha = Math.min(1, this.announce / 40);
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 26px "Yu Mincho","MS Mincho",serif';
      ctx.textAlign = 'center';
      ctx.fillText(`第${this.floor + 1}層 · ${this.bossName}`, viewW / 2, 130);
      ctx.globalAlpha = 1;
    }
  }
}
