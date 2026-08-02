import type { Rect } from './types';

interface Star { x: number; y: number; r: number; }
interface Cloud { x: number; y: number; w: number; speed: number; }
interface GrassTuft { x: number; h: number; }
interface RockBump { dx: number; rx: number; ry: number; }

/** 抓钩锚点（石尖/櫓顶/横梁），绳索靠近自动吸附 */
export interface Anchor { x: number; y: number; }

/**
 * 江户庭院黄昏景（和风卡通亮色调）：夕阳 / 云 / 远山+五重塔 / 日式建筑群+鸟居 /
 * 松树石灯笼 / 苔庭假山 / 深沟+吊索横梁（忍者突袭式摆荡路段）
 */
export class Stage {
  readonly width: number = 2750;
  readonly groundY = 480;

  /** 地面分段——间隙即天堑，坠落即任务失败（三段战区被两条深沟隔开） */
  readonly grounds: { x0: number; x1: number }[] = [
    { x0: 0, x1: 1050 },
    { x0: 1350, x1: 1950 },
    { x0: 2310, x1: 2750 },
  ];

  /** 吊在深沟上方的横梁（单杠），每条沟两根，摆荡支点 */
  readonly beams: Rect[] = [
    { x: 1080, y: 218, w: 100, h: 10 },
    { x: 1230, y: 218, w: 100, h: 10 },
    { x: 1980, y: 218, w: 100, h: 10 },
    { x: 2130, y: 218, w: 100, h: 10 },
  ];

  /** 深沟前的警示木牌 */
  readonly signs: { x: number }[] = [{ x: 1000 }, { x: 1890 }];

  readonly platforms: Rect[] = [
    { x: 380, y: 362, w: 130, h: 16 },
    { x: 880, y: 300, w: 130, h: 16 },
    { x: 1420, y: 346, w: 130, h: 16 },
    { x: 1780, y: 288, w: 150, h: 16 },
    { x: 2410, y: 350, w: 120, h: 16 },
  ];

  /** 前景櫓（木瞭望台）：可站立的塔 + 顶部锚点 */
  readonly towers: { x: number; topY: number }[] = [
    { x: 680, topY: 250 },
    { x: 1660, topY: 240 },
  ];

  readonly anchors: Anchor[] = [];
  /** 绳索可钩的实体（点判定，含横梁、平台、櫓柱） */
  readonly ropeTargets: Rect[] = [];

  readonly isTraining: boolean;
  readonly spawnPoint = { x: 60, y: 400 };
  goalZone: Rect = { x: -9999, y: 0, w: 1, h: 1 };
  hints: { x: number; y: number; text: string }[] = [];

  private stars: Star[] = [];
  private clouds: Cloud[] = [];
  private grass: GrassTuft[] = [];
  private rockBumps: RockBump[][] = [];
  private pines: { x: number; s: number }[] = [];
  private lanterns: { x: number }[] = [];

  constructor(mode: 'level' | 'training' = 'level') {
    this.isTraining = mode === 'training';
    if (this.isTraining) {
      // —— 飞索修練場：单屏，无地面可走，只能靠绳索移动 ——
      this.width = 960;
      this.grounds = [
        { x0: 0, x1: 120 },     // 起点台
        { x0: 430, x1: 560 },   // 矮台（下落练习目标）
      ];
      this.beams = [
        // 下排：左右移动练习
        { x: 165, y: 265, w: 90, h: 10 },
        { x: 295, y: 265, w: 90, h: 10 },
        { x: 425, y: 265, w: 90, h: 10 },
        { x: 555, y: 265, w: 90, h: 10 },
        { x: 685, y: 265, w: 90, h: 10 },
        // 上排：升高练习
        { x: 235, y: 155, w: 90, h: 10 },
        { x: 435, y: 155, w: 90, h: 10 },
        { x: 635, y: 155, w: 90, h: 10 },
      ];
      this.signs = [];
      this.platforms = [{ x: 840, y: 250, w: 100, h: 16 }]; // 终点高台
      this.towers = [];
      this.goalZone = { x: 845, y: 190, w: 90, h: 70 };
      this.hints = [
        { x: 60, y: 420, text: '起点' },
        { x: 240, y: 245, text: '按住 I 钩梁 · A/D 左右荡' },
        { x: 480, y: 135, text: '上行：钩更高的梁，越荡越高' },
        { x: 495, y: 462, text: '下行：松开 I 落到矮台' },
        { x: 890, y: 180, text: '终点' },
      ];
    }
    for (let i = 0; i < 70; i++) {
      this.stars.push({ x: Math.random() * this.width, y: Math.random() * 200, r: Math.random() < 0.2 ? 2 : 1 });
    }
    for (let i = 0; i < 5; i++) {
      this.clouds.push({
        x: Math.random() * this.width,
        y: 40 + Math.random() * 90,
        w: 120 + Math.random() * 140,
        speed: 0.08 + Math.random() * 0.12,
      });
    }
    for (let i = 0; i < 50; i++) {
      this.grass.push({ x: Math.random() * this.width, h: 3 + Math.random() * 4 });
    }
    this.pines = [
      { x: 180, s: 1.1 }, { x: 640, s: 0.9 }, { x: 1450, s: 1.25 },
      { x: 1800, s: 1.0 }, { x: 2420, s: 1.1 }, { x: 2620, s: 0.95 },
    ];
    this.lanterns = [{ x: 340 }, { x: 760 }, { x: 1420 }, { x: 1900 }, { x: 2600 }];

    // 塔顶台面可站立（假山 bump 只给前 5 个岩石平台生成）
    for (const t of this.towers) this.platforms.push({ x: t.x - 8, y: t.topY, w: 44, h: 8 });

    for (const p of this.platforms.slice(0, 5)) {
      const bumps: RockBump[] = [];
      const n = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        bumps.push({ dx: (i / (n - 1) - 0.5) * p.w * 0.8, rx: (p.w / n) * 0.75, ry: 6 + Math.random() * 8 });
      }
      this.rockBumps.push(bumps);
    }

    // 锚点：石尖 + 櫓顶 + 横梁两端与中心（半径吸附，宽容判定）
    for (const p of this.platforms.slice(0, 5)) this.anchors.push({ x: p.x + p.w / 2, y: p.y - 10 });
    for (const t of this.towers) this.anchors.push({ x: t.x + 14, y: t.topY - 8 });
    for (const b of this.beams) {
      this.anchors.push(
        { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        { x: b.x + 6, y: b.y + b.h / 2 },
        { x: b.x + b.w - 6, y: b.y + b.h / 2 },
      );
    }

    // 绳索可钩实体：横梁 + 全部平台 + 櫓柱
    this.ropeTargets.push(...this.beams, ...this.platforms);
    for (const t of this.towers) {
      this.ropeTargets.push(
        { x: t.x - 2, y: t.topY, w: 4, h: this.groundY - t.topY },
        { x: t.x + 26, y: t.topY, w: 4, h: this.groundY - t.topY },
      );
    }
  }

  hasGroundAt(x: number): boolean {
    return this.grounds.some((g) => x >= g.x0 && x <= g.x1);
  }

  /** 把 x 吸附到最近的有效地面（用于刷怪，避免刷进沟里） */
  nearestGroundX(x: number): number {
    if (this.hasGroundAt(x)) return x;
    let best = this.grounds[0].x1 - 30;
    let bestD = Infinity;
    for (const g of this.grounds) {
      for (const edge of [g.x0 + 30, g.x1 - 30]) {
        const d = Math.abs(edge - x);
        if (d < bestD) {
          bestD = d;
          best = edge;
        }
      }
    }
    return best;
  }

  drawBackground(ctx: CanvasRenderingContext2D, camX: number, viewW: number, viewH: number, time: number): void {
    // 黄昏天空（和风卡通）
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, '#2c3270');
    g.addColorStop(0.6, '#554a92');
    g.addColorStop(1, '#c06a8a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);

    // 夕阳 + 光晕
    const sunX = viewW * 0.72 - camX * 0.05;
    const sunY = 150;
    const glow = ctx.createRadialGradient(sunX, sunY, 40, sunX, sunY, 170);
    glow.addColorStop(0, 'rgba(255,170,110,0.5)');
    glow.addColorStop(1, 'rgba(255,170,110,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 170, sunY - 170, 340, 340);
    ctx.fillStyle = '#ffb070';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffc890';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 38, 0, Math.PI * 2);
    ctx.fill();

    // 晚霞云
    ctx.save();
    ctx.translate(-camX * 0.08, 0);
    ctx.fillStyle = '#f0b8c8';
    for (const c of this.clouds) {
      const cx = ((c.x + time * c.speed) % (this.width + 500)) - 250;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.ellipse(cx, c.y, c.w / 2, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - c.w * 0.2, c.y + 6, c.w / 3, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 早星
    ctx.save();
    ctx.translate(-camX * 0.1, 0);
    ctx.fillStyle = '#d0d4f0';
    ctx.globalAlpha = 0.7;
    for (const s of this.stars) ctx.fillRect(s.x, s.y, s.r, s.r);
    ctx.globalAlpha = 1;
    ctx.restore();

    // 远山 + 五重塔（视差 0.15）
    ctx.save();
    ctx.translate(-camX * 0.15, 0);
    ctx.fillStyle = '#333a70';
    this.mountain(ctx, -100, 420, 200);
    this.mountain(ctx, 240, 300, 140);
    this.mountain(ctx, 620, 480, 230);
    this.mountain(ctx, 1150, 340, 160);
    this.mountain(ctx, 1600, 460, 210);
    this.mountain(ctx, 2150, 320, 150);
    this.mountain(ctx, 2450, 380, 170);
    this.drawPagoda(ctx, 460, this.groundY, 1.0);
    ctx.restore();

    // 日式建筑群 + 围墙 + 鸟居（视差 0.45）
    ctx.save();
    ctx.translate(-camX * 0.45, 0);
    this.drawBuilding(ctx, 260, 420, 150);
    this.drawWall(ctx, 720, 700);
    this.drawBuilding(ctx, 1450, 360, 120);
    this.drawTorii(ctx, 2080, this.groundY, 1.1, '#2c3560');
    this.drawWall(ctx, 1850, 450);
    this.drawBuilding(ctx, 2350, 340, 130);
    ctx.restore();

    // 近景：松树 + 石灯笼（视差 0.7）
    ctx.save();
    ctx.translate(-camX * 0.7, 0);
    for (const p of this.pines) this.drawPine(ctx, p.x, this.groundY, p.s);
    for (const l of this.lanterns) this.drawLantern(ctx, l.x, this.groundY);
    ctx.restore();
  }

  private mountain(ctx: CanvasRenderingContext2D, x: number, w: number, h: number): void {
    ctx.beginPath();
    ctx.moveTo(x, this.groundY);
    ctx.lineTo(x + w / 2, this.groundY - h);
    ctx.lineTo(x + w, this.groundY);
    ctx.closePath();
    ctx.fill();
  }

  private drawPagoda(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number): void {
    let y = baseY;
    for (let i = 0; i < 5; i++) {
      const bw = (46 - i * 6) * s;
      const rw = bw + 26 * s;
      ctx.fillStyle = '#1c2350';
      ctx.fillRect(x - bw / 2, y - 20 * s, bw, 20 * s);
      ctx.fillStyle = '#161b40';
      ctx.beginPath();
      ctx.moveTo(x - rw / 2, y - 19 * s);
      ctx.quadraticCurveTo(x, y - 30 * s, x + rw / 2, y - 19 * s);
      ctx.lineTo(x + rw / 2 - 4 * s, y - 15 * s);
      ctx.lineTo(x - rw / 2 + 4 * s, y - 15 * s);
      ctx.closePath();
      ctx.fill();
      y -= 26 * s;
    }
    ctx.fillStyle = '#161b40';
    ctx.fillRect(x - 1.5 * s, y - 12 * s, 3 * s, 12 * s);
  }

  private drawBuilding(ctx: CanvasRenderingContext2D, x: number, w: number, h: number): void {
    const y0 = this.groundY - h;
    ctx.fillStyle = '#4a3a5e';
    ctx.fillRect(x, y0, w, h);
    ctx.fillStyle = '#332844';
    for (let fx = x + 30; fx < x + w - 10; fx += 44) ctx.fillRect(fx, y0, 4, h);
    // 障子窗带（部分亮灯）
    const winY = y0 + 26;
    const winH = 34;
    for (let wx = x + 12, i = 0; wx < x + w - 30; wx += 34, i++) {
      const lit = i % 4 !== 1;
      ctx.fillStyle = lit ? '#ffd89a' : '#413559';
      ctx.fillRect(wx, winY, 26, winH);
      ctx.fillStyle = lit ? 'rgba(120,80,50,0.8)' : '#2e2544';
      ctx.fillRect(wx + 12, winY, 2, winH);
      ctx.fillRect(wx, winY + winH / 2, 26, 2);
    }
    ctx.fillStyle = '#382c4c';
    ctx.fillRect(x, y0 + h * 0.62, w, h * 0.38);
    // 大屋顶
    ctx.fillStyle = '#2c3560';
    ctx.beginPath();
    ctx.moveTo(x - 20, y0 + 2);
    ctx.quadraticCurveTo(x + w * 0.22, y0 - 22, x + w / 2, y0 - 27);
    ctx.quadraticCurveTo(x + w * 0.78, y0 - 22, x + w + 20, y0 + 2);
    ctx.lineTo(x + w, y0 + 9);
    ctx.lineTo(x, y0 + 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#232c50';
    ctx.fillRect(x + w / 2 - 40, y0 - 31, 80, 5);
    ctx.fillStyle = '#252e55';
    ctx.fillRect(x - 14, y0 + 2, w + 28, 6);
  }

  private drawWall(ctx: CanvasRenderingContext2D, x: number, w: number): void {
    ctx.fillStyle = '#333f6e';
    ctx.fillRect(x, this.groundY - 46, w, 46);
    ctx.fillStyle = '#2c3560';
    ctx.fillRect(x - 4, this.groundY - 52, w + 8, 8);
  }

  private drawTorii(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(x - 34 * s, baseY - 66 * s, 7 * s, 66 * s);
    ctx.fillRect(x + 27 * s, baseY - 66 * s, 7 * s, 66 * s);
    ctx.beginPath();
    ctx.moveTo(x - 46 * s, baseY - 72 * s);
    ctx.quadraticCurveTo(x, baseY - 66 * s, x + 46 * s, baseY - 72 * s);
    ctx.lineTo(x + 46 * s, baseY - 65 * s);
    ctx.quadraticCurveTo(x, baseY - 59 * s, x - 46 * s, baseY - 65 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 40 * s, baseY - 56 * s, 80 * s, 5 * s);
  }

  private drawPine(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number): void {
    ctx.fillStyle = '#2a3a26';
    ctx.beginPath();
    ctx.moveTo(x - 3 * s, baseY);
    ctx.quadraticCurveTo(x - 6 * s, baseY - 30 * s, x + 2 * s, baseY - 44 * s);
    ctx.lineTo(x + 7 * s, baseY - 44 * s);
    ctx.quadraticCurveTo(x, baseY - 28 * s, x + 4 * s, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#26503a';
    const blob = (cx: number, cy: number, rx: number, ry: number): void => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * s, ry * s, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(x - 8 * s, baseY - 46 * s, 24, 7);
    blob(x + 10 * s, baseY - 58 * s, 20, 6.5);
    ctx.fillStyle = '#2e5c42';
    blob(x - 2 * s, baseY - 70 * s, 15, 6);
  }

  private drawLantern(ctx: CanvasRenderingContext2D, x: number, baseY: number): void {
    ctx.fillStyle = '#454e6e';
    ctx.fillRect(x - 8, baseY - 5, 16, 5);
    ctx.fillStyle = '#5a6484';
    ctx.fillRect(x - 3, baseY - 19, 6, 14);
    ctx.fillStyle = '#454e6e';
    ctx.fillRect(x - 7, baseY - 29, 14, 10);
    ctx.fillStyle = '#ffd89a';
    ctx.fillRect(x - 4, baseY - 27, 8, 6);
    ctx.fillStyle = '#5a6484';
    ctx.beginPath();
    ctx.moveTo(x - 10, baseY - 29);
    ctx.lineTo(x + 10, baseY - 29);
    ctx.lineTo(x, baseY - 37);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 1.5, baseY - 41, 3, 4);
  }

  /** 世界坐标系下绘制：分段苔庭 + 深沟 + 横梁 + 假山 + 櫓（相机平移之后调用） */
  drawGround(ctx: CanvasRenderingContext2D): void {
    // 分段苔庭
    for (const seg of this.grounds) {
      const w = seg.x1 - seg.x0;
      ctx.fillStyle = '#24402e';
      ctx.fillRect(seg.x0, this.groundY, w, 60);
      ctx.fillStyle = '#3a5a42';
      ctx.fillRect(seg.x0, this.groundY, w, 3);
      // 断口岩石
      ctx.fillStyle = '#4a5468';
      for (const ex of [seg.x0, seg.x1]) {
        if (ex === 0 || ex === this.width) continue;
        ctx.beginPath();
        ctx.moveTo(ex - 6, this.groundY + 60);
        ctx.lineTo(ex, this.groundY);
        ctx.lineTo(ex + 6, this.groundY + 60);
        ctx.closePath();
        ctx.fill();
      }
    }
    // 飞石小径
    ctx.fillStyle = '#5a6488';
    for (let x = 20, i = 0; x < this.width; x += 76, i++) {
      if (!this.hasGroundAt(x)) continue;
      ctx.beginPath();
      ctx.ellipse(x + (i % 2) * 14, this.groundY + 24 + (i % 3) * 8, 22, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 草丛
    ctx.strokeStyle = '#3a5c40';
    ctx.lineWidth = 1.5;
    for (const g of this.grass) {
      if (!this.hasGroundAt(g.x)) continue;
      ctx.beginPath();
      ctx.moveTo(g.x, this.groundY);
      ctx.lineTo(g.x - 2, this.groundY - g.h);
      ctx.moveTo(g.x + 2, this.groundY);
      ctx.lineTo(g.x + 3, this.groundY - g.h - 1);
      ctx.stroke();
    }

    // 深沟（漆黑无底的暗示）
    for (let i = 0; i < this.grounds.length - 1; i++) {
      const gx = this.grounds[i].x1;
      const gw = this.grounds[i + 1].x0 - gx;
      const grad = ctx.createLinearGradient(0, this.groundY, 0, this.groundY + 60);
      grad.addColorStop(0, '#101830');
      grad.addColorStop(1, '#05070f');
      ctx.fillStyle = grad;
      ctx.fillRect(gx, this.groundY, gw, 60);
    }

    // 警示木牌
    for (const s of this.signs) {
      ctx.fillStyle = '#5a4630';
      ctx.fillRect(s.x + 10, this.groundY - 26, 4, 26);
      ctx.fillStyle = '#6a5238';
      ctx.fillRect(s.x, this.groundY - 44, 26, 20);
      ctx.fillStyle = '#ff5560';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('！', s.x + 13, this.groundY - 29);
    }

    // 横梁（锁链吊挂的单杠）
    for (const b of this.beams) {
      ctx.strokeStyle = '#4a4a5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x + 10, 0);
      ctx.lineTo(b.x + 10, b.y + 2);
      ctx.moveTo(b.x + b.w - 10, 0);
      ctx.lineTo(b.x + b.w - 10, b.y + 2);
      ctx.stroke();
      ctx.fillStyle = '#6a5238';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#8a6c48';
      ctx.fillRect(b.x, b.y, b.w, 3);
      ctx.fillStyle = '#4a4a5a';
      ctx.fillRect(b.x + 6, b.y - 2, 8, 4);
      ctx.fillRect(b.x + b.w - 14, b.y - 2, 8, 4);
    }

    // 修練場：提示文字 + 终点鸟居
    if (this.isTraining) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      for (const h of this.hints) ctx.fillText(h.text, h.x, h.y);
      this.drawTorii(ctx, 890, 250, 0.8, '#b03040');
    }

    // 假山平台
    this.platforms.forEach((p, i) => {
      if (!this.rockBumps[i]) return;
      const cx = p.x + p.w / 2;
      ctx.fillStyle = '#5e6884';
      for (const b of this.rockBumps[i]) {
        ctx.beginPath();
        ctx.ellipse(cx + b.dx, p.y + p.h - 2, b.rx, b.ry + p.h * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#8a94b0';
      ctx.fillRect(p.x + 6, p.y - 1, p.w - 12, 2);
      ctx.strokeStyle = '#424a64';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - p.w * 0.2, p.y + 6);
      ctx.lineTo(cx - p.w * 0.15, p.y + p.h + 6);
      ctx.moveTo(cx + p.w * 0.25, p.y + 4);
      ctx.lineTo(cx + p.w * 0.2, p.y + p.h + 8);
      ctx.stroke();
    });

    // 櫓（木瞭望台）
    for (const t of this.towers) {
      const { x, topY } = t;
      ctx.strokeStyle = '#4a3826';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, this.groundY); ctx.lineTo(x, topY);
      ctx.moveTo(x + 28, this.groundY); ctx.lineTo(x + 28, topY);
      ctx.moveTo(x - 6, this.groundY - 60); ctx.lineTo(x + 34, this.groundY - 130);
      ctx.moveTo(x + 34, this.groundY - 60); ctx.lineTo(x - 6, this.groundY - 130);
      ctx.stroke();
      ctx.fillStyle = '#5a4630';
      ctx.fillRect(x - 8, topY, 44, 8);
      ctx.fillStyle = '#8a6c48';
      ctx.fillRect(x - 8, topY, 44, 3);
      ctx.fillStyle = '#2c3560';
      ctx.beginPath();
      ctx.moveTo(x - 14, topY - 18);
      ctx.quadraticCurveTo(x + 14, topY - 34, x + 42, topY - 18);
      ctx.lineTo(x + 38, topY - 14);
      ctx.lineTo(x - 10, topY - 14);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8a94b0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + 14, topY - 8, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
