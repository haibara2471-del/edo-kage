/**
 * 诊断（玩家反馈：击飞连招平推）：第三段击飞把人打飞后，空中/落点立刻再吃一次击飞，
 * 敌人硬直被无限重置、永远起不了身。测 takeHit 机制：
 * 击飞 → 下落 5 帧 → 空中再吃一次击飞 —— 敌人是否被重新击飞（vy 重置 -6 / 硬直刷新）。
 * 运行：npx tsx sim/diag-juggle.ts
 */
import { Enemy } from '../src/enemy';
import { HookSoldier } from '../src/hooksoldier';
import { integrate } from '../src/physics';
import type { StageLike } from '../src/physics';

const GY = 480;
const STAGE_LIKE: StageLike = { groundY: GY, width: 2750, platforms: [], hasGroundAt: () => true };

function check(name: string, cond: boolean, detail: string): void {
  console.log(`  ${cond ? '✓' : '✗'} ${name} — ${detail}`);
}

function main(): void {
  // —— 足轻：击飞后下落 5 帧再吃一次击飞 ——
  {
    const e = Enemy.ashigaru(450, GY);
    e.takeHit(1, 1, 6.5, -6, 20);                 // 第三段：击飞
    for (let i = 0; i < 5; i++) integrate(e, STAGE_LIKE); // 下落 5 帧
    const vyFalling = e.vy, t0 = e.timer;
    e.takeHit(1, 1, 6.5, -6, 20);                 // 空中再吃第三段
    const reLaunched = e.vy <= -5 && e.timer >= t0; // vy 又被打成 -6 且硬直刷新 → 重新击飞
    console.log(`[足轻] 下落中 vy=${vyFalling.toFixed(1)} t=${t0} → 再吃第三段 vy=${e.vy.toFixed(1)} t=${e.timer} immune=${e.launchImmune}`);
    check('足轻 被击飞后不会被立即重新击飞（起身免疫生效）', !reLaunched, `再吃后 vy=${e.vy.toFixed(1)} t=${e.timer}`);
  }
  // —— 钩使：同样 ——
  {
    const h = new HookSoldier(450, GY - 34);
    h.takeHit(1, 1, 6.5, -6, 20);
    for (let i = 0; i < 5; i++) integrate(h, STAGE_LIKE);
    const vyFalling = h.vy, t0 = h.timer;
    h.takeHit(1, 1, 6.5, -6, 20);
    const reLaunched = h.vy <= -5 && h.timer >= t0;
    console.log(`[钩使] 下落中 vy=${vyFalling.toFixed(1)} t=${t0} → 再吃第三段 vy=${h.vy.toFixed(1)} t=${h.timer} immune=${h.launchImmune}`);
    check('钩使 被击飞后不会被立即重新击飞（起身免疫生效）', !reLaunched, `再吃后 vy=${h.vy.toFixed(1)} t=${h.timer}`);
  }
  // —— 对照：起身免疫窗口过后（40+帧）可再次击飞 ——
  {
    const e = Enemy.ashigaru(450, GY);
    e.takeHit(1, 1, 6.5, -6, 20);
    e.launchImmune = 0; // 模拟免疫窗口已过
    e.takeHit(1, 1, 6.5, -6, 20);
    check('足轻 免疫窗口过后可再次击飞（非永久免疫）', e.vy <= -5, `再吃后 vy=${e.vy.toFixed(1)} immune=${e.launchImmune}`);
  }
}

main();
