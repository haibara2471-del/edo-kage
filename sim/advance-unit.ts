/**
 * 单元冒烟：直接驱动 GameEnv（不走 server），验证 v0.45 的 advance 机制：
 * 清场 → 设 advanceTarget → 右移 → 刷下一波 + 推进奖励。
 */
import { GameEnv } from './env';

async function main(): Promise<void> {
  const env = new GameEnv('waves');
  env.reset(100);
  const anyEnv = env as any;

  // 强制击杀所有敌人，多步等死亡动画播完（removable 需 deadTimer>40）→ 触发"清场→设 advanceTarget"
  for (const e of anyEnv.world.enemies) e.takeHit(999, 1, 0, 0, 0);
  let cleared = false;
  for (let i = 0; i < 20; i++) {
    await env.step(0);
    if (anyEnv.world.enemies.length === 0) { cleared = true; break; }
  }
  console.log(`强制清场: ${cleared ? '✓' : '✗'} waveIdx=${anyEnv.waveIdx} advanceTarget=${anyEnv.advanceTarget} enemies=${anyEnv.world.enemies.length}`);
  if (!cleared || anyEnv.advanceTarget <= 0) { console.log('✗ 清场后没设 advanceTarget'); return; }

  // 按住右走，看推进奖励与下一波触发
  let spawned = false;
  for (let i = 0; i < 60; i++) {
    const x0 = anyEnv.player.centerX;
    const r = await env.step(2); // 右
    const dx = anyEnv.player.centerX - x0;
    if (anyEnv.waveIdx >= 2) { spawned = true; }
    if (i % 10 === 0 || spawned) {
      console.log(`右移${i}步: x ${x0.toFixed(0)}→${anyEnv.player.centerX.toFixed(0)} (Δ${dx.toFixed(0)}) reward=${r.reward.toFixed(2)} wave=${anyEnv.waveIdx} target=${anyEnv.advanceTarget.toFixed(0)} 敌=${anyEnv.world.enemies.length}`);
    }
    if (spawned) { console.log('✓ 右移到推进目标后刷出了下一波'); break; }
    if (anyEnv.advanceTarget <= 0) break;
  }
  if (!spawned) console.log('✗ 60 步内没触发下一波');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
