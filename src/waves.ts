import { clamp } from './types';
import { Enemy } from './enemy';
import { Flyer } from './flyer';
import { Archer } from './archer';
import { HookSoldier } from './hooksoldier';
import { Bruiser } from './bruiser';
import { Shaman } from './shaman';
import { Boss } from './boss';
import type { World } from './world';

type Phase = 'start' | 'fight' | 'advance' | 'gatefight' | 'gateopen' | 'done';

/** 战区边界（造梦西游式区域封锁；地面已连通，不再依赖地形分段） */
const ZONES = [
  { x0: 0, x1: 1050 },
  { x0: 1350, x1: 1950 },
  { x0: 2310, x1: 2750 },
];

/**
 * 造梦西游式区域封锁：每个战区刷一波怪，清完结界才打开；
 * 走进下一战区触发下一波。
 */
export class Waves {
  wave = 0;
  readonly total = 3;
  private comps: { ash: number; crow: number; bat: number; archer: number; hook: number; bruiser: number; shaman: number }[] = [
    { ash: 3, crow: 0, bat: 0, archer: 0, hook: 0, bruiser: 0, shaman: 0 }, // 第一战区：纯足轻教学
    { ash: 3, crow: 1, bat: 0, archer: 1, hook: 1, bruiser: 0, shaman: 0 }, // 第二战区：乌鸦+弓兵+钩使
    { ash: 2, crow: 0, bat: 1, archer: 1, hook: 0, bruiser: 1, shaman: 1 }, // 第三战区：金刚+蛊师压阵
  ];
  /** 每战区弓箭手的高台位置（与 stage.platforms 对应） */
  private archerSpots: { x: number; y: number }[][] = [
    [],
    [{ x: 1485, y: 346 - 34 }],
    [{ x: 2470, y: 350 - 34 }],
  ];

  private phase: Phase = 'start';
  private timer = 60;

  /** 修練場置 false：不刷怪、不报波次 */
  enabled = true;

  /** 结界位置（封锁右路），null 表示开放 */
  barrierX: number | null = null;
  /** 左结界（Boss 战封场） */
  barrierL: number | null = null;
  announceTimer = 0;
  done = false;
  /** 守门「龙」已击败，大门开启（主场景据此触发进塔） */
  gateOpen = false;

  update(w: World): void {
    if (!this.enabled) return;
    if (this.announceTimer > 0) this.announceTimer--;

    switch (this.phase) {
      case 'start':
        if (--this.timer <= 0) this.startWave(w, 0);
        break;

      case 'fight':
        if (w.enemies.length === 0) {
          this.phase = 'advance';
          this.barrierX = null;
        }
        break;

      case 'advance':
        if (this.wave >= this.total) {
          // 清完三波：继续往前走，走到大门口触发守门战（不原地开 boss）
          if (w.player.centerX > 2540) {
            this.phase = 'gatefight';
            this.spawnGateBoss(w);
          }
        } else {
          const next = ZONES[this.wave]; // 下一战区（wave 为已完成的波数）
          if (w.player.centerX > next.x0 + 80) this.startWave(w, this.wave);
        }
        break;

      case 'gatefight': // 守门「龙」被击败 → 大门开启
        if (w.enemies.length === 0) {
          this.phase = 'gateopen';
          this.gateOpen = true;
          this.barrierX = null;
          this.announceTimer = 90;
        }
        break;

      case 'gateopen': // 玩家走向大门 → main.ts 检测触发进塔
        break;

      case 'done':
        break;
    }
  }

  /** 大门守卫战：「龙」携双钩使守在大门前，结界封两侧。击败后大门开启（真龙已移入塔第一层） */
  private spawnGateBoss(w: World): void {
    this.phase = 'gatefight';
    this.announceTimer = 120;
    const zone = ZONES[2];
    this.barrierL = zone.x0 + 12;
    this.barrierX = zone.x1 - 12;
    const cx = zone.x1 - 150; // 大门口（鸟居下）
    w.player.hp = Math.min(w.player.maxHp, w.player.hp + 20); // 守门战回复 20 血
    w.player.ki = Math.min(w.player.maxKi, w.player.ki + 20); // 同时回 20 气
    w.enemies.push(new Boss(cx + 100, w.stage.groundY - 40));
    w.enemies.push(new HookSoldier(cx - 120, w.stage.groundY - 34));
    w.enemies.push(new HookSoldier(cx + 220, w.stage.groundY - 34));
  }

  private startWave(w: World, zoneIdx: number): void {
    this.wave++;
    this.phase = 'fight';
    this.announceTimer = 90;

    const zone = ZONES[zoneIdx];
    this.barrierX = zone.x1 - 12; // 结界封住右出口（最后一区即关卡尽头，无实际限制）

    const comp = this.comps[zoneIdx];
    for (let i = 0; i < comp.ash; i++) {
      const t = (i + 1) / (comp.ash + 1);
      const x = clamp(zone.x0 + 120 + t * (zone.x1 - zone.x0 - 260), zone.x0 + 30, zone.x1 - 60);
      w.enemies.push(Enemy.ashigaru(x, w.stage.groundY));
    }
    for (let i = 0; i < comp.crow; i++) {
      w.enemies.push(new Flyer(zone.x0 + 240 + i * 160, w.stage.groundY - 220, 'crow'));
    }
    for (let i = 0; i < comp.bat; i++) {
      w.enemies.push(new Flyer(zone.x1 - 240 - i * 140, w.stage.groundY - 160, 'bat'));
    }
    for (let i = 0; i < comp.archer; i++) {
      const spot = this.archerSpots[zoneIdx][i];
      if (spot) w.enemies.push(new Archer(spot.x, spot.y));
    }
    for (let i = 0; i < comp.hook; i++) {
      w.enemies.push(new HookSoldier(zone.x1 - 320 - i * 120, w.stage.groundY - 34));
    }
    for (let i = 0; i < comp.bruiser; i++) {
      w.enemies.push(new Bruiser(zone.x0 + 260 + i * 200, w.stage.groundY - 46));
    }
    for (let i = 0; i < comp.shaman; i++) {
      w.enemies.push(new Shaman(zone.x1 - 140 - i * 120, w.stage.groundY - 32));
    }
  }

  /** debug：直接进入第 zi 个战区（0 起），跳过前面的波次并立即刷出该波。
   *  修掉了"传送到战区但波次计数器不同步"的问题（旧做法只清场+移动，不触发波次）。 */
  startAtZone(w: World, zi: number): void {
    this.wave = zi; // startWave 内部会 ++ → 波次与战区对齐
    this.barrierL = null;
    this.startWave(w, zi);
  }

  /** 结界绘制（世界坐标系下调用）：紫色封印墙 + 上浮符咒粒子 */
  draw(ctx: CanvasRenderingContext2D, groundY: number, t: number): void {
    for (const x of [this.barrierX, this.barrierL]) {
      if (x === null) continue;
      this.drawBarrier(ctx, x, groundY, t);
    }
    // 大门（红色大鸟居）：清完三波就能看见，走到门下触发守门战
    if (this.wave >= this.total && this.phase !== 'done') {
      this.drawGate(ctx, 2590, groundY, t);
    }
  }

  /** 大门：红色大鸟居（双柱 + 双檐 + 匾额）；开启时门内泛光 */
  private drawGate(ctx: CanvasRenderingContext2D, x: number, groundY: number, t: number): void {
    const open = this.phase === 'gateopen';
    ctx.fillStyle = '#b03040';
    // 两根粗主柱（更高更宽）
    ctx.fillRect(x, groundY - 270, 12, 270);
    ctx.fillRect(x + 118, groundY - 270, 12, 270);
    ctx.fillStyle = '#c84850';
    ctx.fillRect(x + 3, groundY - 270, 4, 270);
    ctx.fillRect(x + 121, groundY - 270, 4, 270);
    // 笠木（上弧横梁，外展更宽）
    ctx.fillStyle = '#c84850';
    ctx.beginPath();
    ctx.moveTo(x - 32, groundY - 276);
    ctx.quadraticCurveTo(x + 59, groundY - 318, x + 168, groundY - 276);
    ctx.lineTo(x + 168, groundY - 260);
    ctx.quadraticCurveTo(x + 59, groundY - 302, x - 32, groundY - 260);
    ctx.closePath();
    ctx.fill();
    // 岛木（下横梁）
    ctx.fillStyle = '#b03040';
    ctx.fillRect(x - 14, groundY - 240, 158, 8);
    // 匾额
    ctx.fillStyle = '#1c2440';
    ctx.fillRect(x + 22, groundY - 231, 74, 15);
    ctx.fillStyle = '#e8d8a0';
    ctx.font = 'bold 14px "Yu Mincho","MS Mincho",serif';
    ctx.textAlign = 'center';
    ctx.fillText('試練の門', x + 59, groundY - 219);

    if (open) {
      // 开启：门内泛光 + 符咒上浮
      ctx.globalAlpha = 0.35 + Math.sin(t * 0.15) * 0.12;
      const g = ctx.createLinearGradient(x - 6, 0, x + 96, 0);
      g.addColorStop(0, 'rgba(160,200,255,0)');
      g.addColorStop(0.5, 'rgba(160,200,255,0.9)');
      g.addColorStop(1, 'rgba(160,200,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 6, groundY - 260, 102, 260);
      ctx.globalAlpha = 1;
      for (let i = 0; i < 6; i++) {
        const yy = groundY - 20 - ((t * 1.5 + i * 40) % 170);
        ctx.fillStyle = '#f5ead8';
        ctx.fillRect(x + 10 + i * 14, yy, 9, 4);
      }
    }
  }

  private drawBarrier(ctx: CanvasRenderingContext2D, x: number, groundY: number, t: number): void {
    ctx.globalAlpha = 0.3 + Math.sin(t * 0.12) * 0.08;
    ctx.fillStyle = '#8a5aff';
    ctx.fillRect(x - 3, groundY - 190, 6, 190);
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 6; i++) {
      const yy = groundY - 16 - ((t * 2 + i * 34) % 180);
      ctx.fillRect(x - 1.5, yy, 3, 8);
    }
    ctx.globalAlpha = 1;

    // 顶部封印札
    ctx.fillStyle = '#b03040';
    ctx.fillRect(x - 8, groundY - 198, 16, 10);
    ctx.fillStyle = '#f5ead8';
    ctx.fillRect(x - 5, groundY - 195, 10, 4);
  }

  get label(): string {
    if (!this.enabled) return '飛索修練場';
    switch (this.phase) {
      case 'start': return '敵襲……';
      case 'fight': return `第 ${this.wave} / ${this.total} 波`;
      case 'advance': return this.wave >= this.total ? '大門へ →' : '前進 →';
      case 'gatefight': return '門番「龍」';
      case 'gateopen': return '大門・開け！';
      case 'done': return '任務完了 · 按 R 重开';
    }
  }
}
