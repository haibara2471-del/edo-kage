/**
 * AI 回放追踪：逐帧记录模型在某个场景的行为（位置/血量/动作/敌人状态），
 * 用于"看回放"式地分析失败原因，而不是只看汇总数字。
 * 运行：npx tsx sim/ai-replay.ts [模型名] [场景] [seed]
 *
 * 场景 key：ashigaru 单足轻 / wave1 足轻×3同侧 / both 足轻×3两侧散开（真局wave1站位）
 *          mixed 足轻×2+弓+钩 / air 足轻×3+乌鸦×2 / wave2 真局wave2
 *          waves 完整三波 / boss Boss单 / bossSquad Boss+双钩使
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Enemy } from '../src/enemy';
import { Boss } from '../src/boss';
import { Flyer } from '../src/flyer';
import { Archer } from '../src/archer';
import { HookSoldier } from '../src/hooksoldier';
import { Bruiser } from '../src/bruiser';
import { Shaman } from '../src/shaman';
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

type ScenarioKey = 'ashigaru' | 'wave1' | 'both' | 'mixed' | 'air' | 'wave2' | 'waves' | 'boss' | 'bossSquad';

const SCENARIOS: Record<ScenarioKey, { label: string; spawn: (w: World, stage: Stage, px: number) => void; maxT: number }> = {
  ashigaru: {
    label: '单足轻',
    maxT: 1800,
    spawn: (w, stage, px) => { w.enemies.push(Enemy.ashigaru(px + 90, stage.groundY)); },
  },
  wave1: {
    label: '足轻×3（同侧）',
    maxT: 3000,
    spawn: (w, stage, px) => { for (let i = 0; i < 3; i++) w.enemies.push(Enemy.ashigaru(px + 140 + i * 120, stage.groundY)); },
  },
  both: {
    label: '足轻×3（两侧散开·真局wave1站位）',
    maxT: 3000,
    spawn: (w, stage, px) => {
      const both = (i: number): number => px + (i % 2 === 0 ? -1 : 1) * (400 + i * 80);
      for (let i = 0; i < 3; i++) w.enemies.push(Enemy.ashigaru(both(i), stage.groundY));
    },
  },
  mixed: {
    label: '足轻×2+弓+钩',
    maxT: 3000,
    spawn: (w, stage, px) => {
      w.enemies.push(Enemy.ashigaru(px + 120, stage.groundY));
      w.enemies.push(Enemy.ashigaru(px + 240, stage.groundY));
      w.enemies.push(new Archer(px + 300, stage.groundY - 34));
      w.enemies.push(new HookSoldier(px + 380, stage.groundY - 34));
    },
  },
  air: {
    label: '足轻×3+乌鸦×2',
    maxT: 3000,
    spawn: (w, stage, px) => {
      for (let i = 0; i < 3; i++) w.enemies.push(Enemy.ashigaru(px + 120 + i * 120, stage.groundY));
      w.enemies.push(new Flyer(px - 200, stage.groundY - 220, 'crow'));
      w.enemies.push(new Flyer(px + 200, stage.groundY - 220, 'crow'));
    },
  },
  wave2: {
    label: '真局wave2（足轻×3+乌鸦+弓+钩）',
    maxT: 5400,
    spawn: (w, stage, px) => {
      const both = (i: number): number => px + (i % 2 === 0 ? -1 : 1) * (400 + i * 80);
      for (let i = 0; i < 3; i++) w.enemies.push(Enemy.ashigaru(both(i), stage.groundY));
      w.enemies.push(new Flyer(px - 240, stage.groundY - 220, 'crow'));
      w.enemies.push(new Archer(px + 300, stage.groundY - 34));
      w.enemies.push(new HookSoldier(px + 380, stage.groundY - 34));
    },
  },
  waves: {
    label: '完整三波（训练目标场景）',
    maxT: 5400,
    spawn: (w, stage, px) => { spawnWave(w, 1, px); },
  },
  boss: {
    label: 'Boss 单',
    maxT: 7200,
    spawn: (w, stage, px) => { w.enemies.push(new Boss(px + 90, stage.groundY - 40)); },
  },
  bossSquad: {
    label: 'Boss 团（Boss+双钩使）',
    maxT: 7200,
    spawn: (w, stage, px) => {
      const cx = 2530;
      w.enemies.push(new Boss(cx + 100, stage.groundY - 40));
      w.enemies.push(new HookSoldier(cx - 120, stage.groundY - 34));
      w.enemies.push(new HookSoldier(cx + 220, stage.groundY - 34));
      w.player.x = 2370;
      w.player.y = 300;
    },
  },
};

function spawnWave(w: World, idx: number, px: number): void {
  const gy = w.stage.groundY;
  const E = w.enemies;
  const both = (i: number): number => px + (i % 2 === 0 ? -1 : 1) * (400 + i * 80);
  if (idx === 1) {
    for (let i = 0; i < 3; i++) E.push(Enemy.ashigaru(both(i), gy));
  } else if (idx === 2) {
    for (let i = 0; i < 3; i++) E.push(Enemy.ashigaru(both(i), gy));
    E.push(new Flyer(px - 240, gy - 220, 'crow'));
    E.push(new Archer(px + 300, gy - 34));
    E.push(new HookSoldier(px + 380, gy - 34));
  } else if (idx === 3) {
    for (let i = 0; i < 2; i++) E.push(Enemy.ashigaru(both(i), gy));
    E.push(new Flyer(px + 220, gy - 160, 'bat'));
    E.push(new Archer(px - 320, gy - 34));
    E.push(new Bruiser(px + 260, gy - 46));
    E.push(new Shaman(px + 400, gy - 32));
  }
}

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
  consumeDir(a: string): { consumed: boolean; dir: number } {
    return { consumed: this.consume(a), dir: 0 }; // AI 用当前朝向
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
  const key = (process.argv[3] ?? 'both') as ScenarioKey;
  const seed = Number(process.argv[4] ?? 1);
  const sc = SCENARIOS[key];
  if (!sc) {
    console.log(`未知场景 ${key}。可选：${Object.keys(SCENARIOS).join(' / ')}`);
    return;
  }
  const modelPath = `sim/rl/${modelName}.onnx`;
  if (!fs.existsSync(modelPath)) { console.log('模型不存在', modelPath); return; }
  const session = await ort.InferenceSession.create(modelPath);
  console.log(`[回放] ${modelName} @ ${key}(${sc.label}) seed=${seed} 上限=${sc.maxT} 帧\n`);

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
  sc.spawn(world, stage, player.centerX);

  let waveIdx = 1;
  let advanceTarget = -1;
  let lastDmg = 0;
  let totalDmg = 0;
  for (let f = 0; f < sc.maxT; f++) {
    driver.tick();
    const isBoss = world.enemies.some((e) => e.codexId === 'boss');
    if (f % (isBoss ? 2 : 4) === 0) {
      // 与训练 env.ts observe() 对齐：waves 场景传真实 advanceTarget（wave 训练恒 0，防 OOD）
      const obs = buildObs(
        world,
        undefined,
        key === 'waves' ? (advanceTarget > 0 ? (advanceTarget - player.centerX) / 1000 : -1) : undefined,
      );
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
    // waves 推进：清波后向右走 260px 刷下一波
    if (key === 'waves') {
      if (world.enemies.length === 0 && waveIdx < 3 && advanceTarget < 0) {
        advanceTarget = player.centerX + 260;
        console.log(`f=${String(f).padStart(4)} —— 波 ${waveIdx} 清空，推进至 x=${advanceTarget.toFixed(0)}`);
      }
      if (advanceTarget > 0 && player.centerX >= advanceTarget) {
        advanceTarget = -1;
        waveIdx++;
        spawnWave(world, waveIdx, player.centerX);
        console.log(`f=${String(f).padStart(4)} —— 波 ${waveIdx} 刷新`);
      }
    }
    // 统计伤害
    for (const h of world.lastHits) { lastDmg += h.dmg; totalDmg += h.dmg; }
    world.lastHits = [];
    if (f % 60 === 0 && lastDmg > 0) {
      console.log(`    —— 近 60 帧造成伤害 ${lastDmg.toFixed(0)}（累计 ${totalDmg.toFixed(0)}）`);
    }
    if (f % 60 === 0) lastDmg = 0;
    if (player.state === 'dead') {
      console.log(`\n[死亡] 第 ${f} 帧, x=${player.x.toFixed(0)}, 累计伤害 ${totalDmg.toFixed(0)}`);
      return;
    }
    if (world.enemies.length === 0 && (key !== 'waves' || waveIdx >= 3)) {
      console.log(`\n[清场] 第 ${f} 帧, hp=${player.hp}, 累计伤害 ${totalDmg.toFixed(0)}`);
      return;
    }
  }
  console.log(`\n[timeout] ${sc.maxT} 帧, 玩家 hp=${player.hp} x=${player.x.toFixed(0)}, 累计伤害 ${totalDmg.toFixed(0)}`);
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
