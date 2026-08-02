import { clamp } from './types';
import { Enemy } from './enemy';
import { Flyer } from './flyer';
import type { World } from './world';

type Phase = 'start' | 'fight' | 'advance' | 'done';

/**
 * 造梦西游式区域封锁：每个战区刷一波怪，清完结界才打开；
 * 推进阶段（过深沟）刷守卫飞行敌人骚扰；进入下一战区触发下一波。
 */
export class Waves {
  wave = 0;
  readonly total = 3;
  private comps: { ash: number; crow: number; bat: number }[] = [
    { ash: 3, crow: 0, bat: 0 },   // 第一战区：纯足轻教学
    { ash: 3, crow: 1, bat: 0 },   // 第二战区：混入一只乌鸦
    { ash: 4, crow: 0, bat: 1 },   // 第三战区：足轻群 + 蝙蝠
  ];
  /** 深沟守卫：清波后推进时刷出，悬在沟上方骚扰摆荡中的玩家 */
  private gapGuards: { crow: number; bat: number }[] = [
    { crow: 1, bat: 0 },
    { crow: 1, bat: 1 },
  ];

  private phase: Phase = 'start';
  private timer = 60;
  private guarded = 0;

  /** 结界位置（封锁右路），null 表示开放 */
  barrierX: number | null = null;
  announceTimer = 0;
  done = false;

  update(w: World): void {
    if (this.announceTimer > 0) this.announceTimer--;
    const zones = w.stage.grounds;

    switch (this.phase) {
      case 'start':
        if (--this.timer <= 0) this.startWave(w, 0);
        break;

      case 'fight':
        if (w.enemies.length === 0) {
          if (this.wave >= this.total) {
            this.phase = 'done';
            this.done = true;
            this.barrierX = null;
          } else {
            this.phase = 'advance';
            this.barrierX = null;
            this.spawnGapGuards(w);
          }
        }
        break;

      case 'advance': {
        const next = zones[this.wave]; // 下一战区（wave 为已完成的波数）
        if (w.player.centerX > next.x0 + 80) this.startWave(w, this.wave);
        break;
      }

      case 'done':
        break;
    }
  }

  private spawnGapGuards(w: World): void {
    if (this.guarded >= this.gapGuards.length) return;
    const zones = w.stage.grounds;
    const gapL = zones[this.wave - 1].x1;
    const gapR = zones[this.wave].x0;
    const cx = (gapL + gapR) / 2;
    const g = this.gapGuards[this.guarded];
    this.guarded++;
    for (let i = 0; i < g.crow; i++) {
      w.enemies.push(new Flyer(cx - 40 + i * 80, w.stage.groundY - 230, 'crow'));
    }
    for (let i = 0; i < g.bat; i++) {
      w.enemies.push(new Flyer(cx + 30 + i * 70, w.stage.groundY - 170, 'bat'));
    }
  }

  private startWave(w: World, zoneIdx: number): void {
    this.wave++;
    this.phase = 'fight';
    this.announceTimer = 90;

    const zone = w.stage.grounds[zoneIdx];
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
  }

  /** 结界绘制（世界坐标系下调用）：紫色封印墙 + 上浮符咒粒子 */
  draw(ctx: CanvasRenderingContext2D, groundY: number, t: number): void {
    if (this.barrierX === null) return;
    const x = this.barrierX;

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
    switch (this.phase) {
      case 'start': return '敵襲……';
      case 'fight': return `第 ${this.wave} / ${this.total} 波`;
      case 'advance': return '前進 →';
      case 'done': return '任務完了 · 按 R 重开';
    }
  }
}
