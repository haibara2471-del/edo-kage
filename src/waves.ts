import { clamp } from './types';
import { Enemy } from './enemy';
import { Flyer } from './flyer';
import type { World } from './world';

/** 波次刷怪：3 波，逐波加入足轻、乌鸦、蝙蝠，清场后间隔 1.5 秒出下一波 */
export class Waves {
  wave = 0;
  readonly total = 3;
  private composition: { ash: number; crow: number; bat: number }[] = [
    { ash: 3, crow: 0, bat: 0 },
    { ash: 3, crow: 2, bat: 0 },
    { ash: 4, crow: 1, bat: 2 },
  ];
  private idle = true;
  private timer = 60; // 开场 1 秒后出第一波
  done = false;

  /** 用于 HUD 提示新一波 */
  announceTimer = 0;

  update(w: World): void {
    if (this.announceTimer > 0) this.announceTimer--;
    if (this.done) return;

    if (this.idle) {
      if (--this.timer <= 0) this.spawn(w);
      return;
    }

    if (w.enemies.length === 0) {
      if (this.wave >= this.total) {
        this.done = true;
      } else {
        this.idle = true;
        this.timer = 90;
      }
    }
  }

  private spawn(w: World): void {
    this.wave++;
    this.idle = false;
    this.announceTimer = 90;
    const comp = this.composition[this.wave - 1];
    const px = w.player.centerX;
    const gy = w.stage.groundY;

    for (let i = 0; i < comp.ash; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = w.stage.nearestGroundX(clamp(px + side * (420 + i * 80), 30, w.stage.width - 60));
      w.enemies.push(Enemy.ashigaru(x, gy));
    }
    for (let i = 0; i < comp.crow; i++) {
      const x = clamp(px + (i % 2 === 0 ? -1 : 1) * (300 + i * 160), 60, w.stage.width - 60);
      w.enemies.push(new Flyer(x, gy - 220, 'crow'));
    }
    for (let i = 0; i < comp.bat; i++) {
      const x = clamp(px + (i % 2 === 0 ? 1 : -1) * (260 + i * 140), 60, w.stage.width - 60);
      w.enemies.push(new Flyer(x, gy - 160, 'bat'));
    }
  }

  get label(): string {
    if (this.done) return '任務完了 · 按 R 重开';
    if (this.wave === 0) return '敵襲……';
    return `第 ${this.wave} / ${this.total} 波`;
  }
}
