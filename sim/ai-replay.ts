/**
 * AI 回放追踪：逐帧记录模型在某个场景的行为（位置/血量/动作/敌人状态），
 * 用于"看回放"式地分析失败原因，而不是只看汇总数字。
 * 运行：npx tsx sim/ai-replay.ts [模型名] [场景] [seed]
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Enemy } from '../src/enemy';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { resolveCombat } from '../src/combat';
import { reseed } from '../src/rng';
import { buildObs } from '../src/ai';
import * as ort from 'onnxruntime-node';
import * as fs from 'node:fs';
import type { World } from '../src/world';

const OBS_SIZE = 42;
const ACTIONS: string[][] = [
  [], ['left'], ['right'], ['jump'], ['attack'], ['shuriken'], ['dash'],
  ['skillU'], ['skillH'], ['skillO'], ['vamp'],
  ['left', 'attack'], ['right', 'attack'], ['left', 'jump'], ['right', 'jump'],
];
const ACT_LABEL = ['空', '左', '右', '跳', '攻击', '镖', '瞬身', '昇月', '乱舞', '水月', '吸血',
  '左攻', '右攻', '左跳', '右跳'];

class Driver {
  held = new Set<string>();
  buffer: { action: string; frame: number }[] = [];
  frame = 0;
  tick(): void { this.frame++; }
  isHeld(a: string): boolean { return this.held.has(a); }
  consume(a: string): boolean {
    const i = this.buffer.findIndex((p) => p.action === a && this.frame - p.frame <= 9);
    if (i >= 0) { this.buffer.splice(i, 1); return true; }
    return false;
  }
  apply(action: number): void {
    const combo = ACTIONS[action] ?? [];
    this.held.clear();
    for (const act of combo) {
      if (act === 'left' || act === 'right') this.held.add(act);
      else this.buffer.push({ action: act, frame: this.frame });
    }
  }
}

function step(w: World): void {
  if (w.effects.freeze > 0) { w.effects.freeze--; w.effects.update(); return; }
  w.player.update(w);
  for (const e of w.enemies) e.update(w);
  w.enemies = w.enemies.filter((e) => !e.removable);
  for (const p of w.projectiles) p.update(w.stage.width);
  w.projectiles = w.projectiles.filter((p) => !p.dead);
  for (const a of w.arrows) a.update(w);
  w.arrows = w.arrows.filter((a) => !a.dead);
  for (const o of w.orbs) o.update(w);
  w.orbs = w.orbs.filter((o) => !o.dead);
  for (const c of w.clouds) c.update(w);
  w.clouds = w.clouds.filter((c) => !c.dead);
  resolveCombat(w);
  w.effects.update();
}

async function main(): Promise<void> {
  const modelName = process.argv[2] ?? 'ppo_random';
  const key = process.argv[3] ?? 'wave1'; // wave1 = 足轻×3
  const seed = Number(process.argv[4] ?? 1);
  const modelPath = `sim/rl/${modelName}.onnx`;
  if (!fs.existsSync(modelPath)) { console.log('模型不存在', modelPath); return; }
  const session = await ort.InferenceSession.create(modelPath);
  console.log(`[回放] ${modelName} @ ${key} seed=${seed}\n`);

  reseed(seed);
  const stage = new Stage();
  const driver = new Driver();
  const player = new Player();
  player.x = 400;
  player.y = stage.groundY - player.h;
  const world: World = {
    input: driver as never, effects: new Effects(), stage, player, enemies: [],
    projectiles: [], arrows: [], orbs: [], clouds: [], codex: new Codex(), camX: 0, lastHits: [],
  };

  // 与 ai-analyze wave1 一致：3 足轻同侧
  for (let i = 0; i < 3; i++) world.enemies.push(Enemy.ashigaru(player.centerX + 140 + i * 120, stage.groundY));

  let lastDmg = 0;
  let totalDmg = 0;
  const maxT = 3000;
  for (let f = 0; f < maxT; f++) {
    driver.tick();
    if (f % 4 === 0) {
      const obs = buildObs(world);
      const out = await session.run({ obs: new ort.Tensor('float32', obs, [1, OBS_SIZE]) });
      const a = Number(out.action.data[0]);
      driver.apply(a);
      if (f % 60 === 0) {
        const es = world.enemies.map((e) => `${e.codexId}@${e.x.toFixed(0)}/${(e as { hp: number }).hp}`).join(' ');
        console.log(
          `f=${String(f).padStart(4)} 玩家 x=${player.x.toFixed(0)} hp=${player.hp} 动=${ACT_LABEL[a]} 状态=${player.state}` +
          ` | ${es}`,
        );
      }
    }
    step(world);
    // 统计伤害
    for (const h of world.lastHits) { lastDmg += h.dmg; totalDmg += h.dmg; }
    world.lastHits = [];
    if (f % 60 === 0 && lastDmg > 0) {
      console.log(`    —— 近 60 帧造成伤害 ${lastDmg}（累计 ${totalDmg}）`);
    }
    if (f % 60 === 0) lastDmg = 0;
    if (player.state === 'dead') {
      console.log(`\n[死亡] 第 ${f} 帧, x=${player.x.toFixed(0)}, 累计伤害 ${totalDmg}`);
      return;
    }
    if (world.enemies.length === 0) {
      console.log(`\n[清场] 第 ${f} 帧, 累计伤害 ${totalDmg}`);
      return;
    }
  }
  console.log(`\n[timeout] 3000 帧, 玩家 hp=${player.hp} x=${player.x.toFixed(0)}, 累计伤害 ${totalDmg}`);
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
