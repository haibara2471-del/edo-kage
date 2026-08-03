/**
 * AI 分析工具：检测 → 分析 → 迭代 闭环的第一环。
 * 跑当前模型在各场景的多局对战，输出结构化失败模式报告。
 * 运行：npx tsx sim/ai-analyze.ts [模型名，如 ppo_waves_run3]
 *
 * 报告内容：
 * - 各场景胜率（多 seed 方差）
 * - 死亡原因归类（被什么杀死的）
 * - 死亡位置/时间、卡住不动的帧
 * - 动作分布（是否只用一个动作）
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
  ['skillU'], ['skillH'], ['skillO'],
  ['left', 'attack'], ['right', 'attack'], ['left', 'jump'], ['right', 'jump'],
];

type ScenarioKey = 'ashigaru' | 'wave1' | 'mixed' | 'air' | 'wave2' | 'waves' | 'boss' | 'bossSquad';

const SCENARIOS: Record<ScenarioKey, { label: string; spawn: (w: World, stage: Stage, px: number) => void; maxT: number }> = {
  ashigaru: {
    label: '单足轻',
    maxT: 1800,
    spawn: (w, stage, px) => { w.enemies.push(Enemy.ashigaru(px + 90, stage.groundY)); },
  },
  wave1: {
    label: '足轻×3',
    maxT: 3000,
    spawn: (w, stage, px) => { for (let i = 0; i < 3; i++) w.enemies.push(Enemy.ashigaru(px + 140 + i * 120, stage.groundY)); },
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
      for (let i = 0; i < 3; i++) w.enemies.push(Enemy.ashigaru(px + (i % 2 === 0 ? -1 : 1) * (400 + i * 80), stage.groundY));
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

function makeWorld(key: ScenarioKey, seed: number): { world: World; driver: Driver } {
  reseed(seed);
  const stage = new Stage();
  const driver = new Driver();
  const player = new Player();
  player.x = 400;
  player.y = stage.groundY - player.h;
  const world: World = {
    input: driver as never,
    effects: new Effects(),
    stage,
    player,
    enemies: [],
    projectiles: [],
    arrows: [],
    orbs: [],
    clouds: [],
    codex: new Codex(),
    camX: 0,
    lastHits: [],
  };
  SCENARIOS[key].spawn(world, stage, player.centerX);
  return { world, driver };
}

function step(w: World): void {
  if (w.effects.freeze > 0) {
    w.effects.freeze--;
    w.effects.update();
    return;
  }
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

interface EpisodeResult {
  win: boolean;
  ticks: number;
  playerHp: number;
  deathBy: string;   // 死亡时最近敌人类型
  deathX: number;    // 死亡位置
  actionCounts: Record<number, number>;
  idleFrames: number; // 玩家中心 x 连续 60 帧没动
}

async function runEpisode(
  session: ort.InferenceSession,
  key: ScenarioKey,
  seed: number,
): Promise<EpisodeResult> {
  const { world, driver } = makeWorld(key, seed);
  const { player } = world;
  const actionCounts: Record<number, number> = {};
  let idleFrames = 0;
  let lastX = player.centerX;
  let lastMoveFrame = 0;
  let waveIdx = 1;
  let advanceTarget = -1;

  for (let f = 0; f < SCENARIOS[key].maxT; f++) {
    driver.tick();
    const isBoss = world.enemies.some((e) => e.codexId === 'boss');
    if (f % (isBoss ? 2 : 4) === 0) {
      const obs = buildObs(world);
      const out = await session.run({ obs: new ort.Tensor('float32', obs, [1, OBS_SIZE]) });
      const a = Number(out.action.data[0]);
      driver.apply(a);
      actionCounts[a] = (actionCounts[a] ?? 0) + 1;
    }
    step(world);

    // waves 场景：清波后需向右推进 260px 才刷下一波
    if (key === 'waves') {
      if (world.enemies.length === 0 && waveIdx < 3 && advanceTarget < 0) {
        advanceTarget = player.centerX + 260;
      }
      if (advanceTarget > 0 && player.centerX >= advanceTarget) {
        advanceTarget = -1;
        waveIdx++;
        spawnWave(world, waveIdx, player.centerX);
      }
    }

    if (Math.abs(player.centerX - lastX) > 2) {
      lastX = player.centerX;
      lastMoveFrame = f;
    } else if (f - lastMoveFrame > 60 && player.state !== 'dead') {
      idleFrames++;
    }

    if (player.state === 'dead') {
      const nearest = world.enemies.length
        ? world.enemies.reduce((a, b) =>
            Math.abs(a.centerX - player.centerX) < Math.abs(b.centerX - player.centerX) ? a : b,
          )
        : null;
      return {
        win: false,
        ticks: f,
        playerHp: 0,
        deathBy: nearest ? nearest.codexId : 'unknown',
        deathX: player.centerX,
        actionCounts,
        idleFrames,
      };
    }
    if (world.enemies.length === 0 && (key !== 'waves' || waveIdx >= 3)) {
      return { win: true, ticks: f, playerHp: player.hp, deathBy: '-', deathX: player.centerX, actionCounts, idleFrames };
    }
  }
  return { win: false, ticks: SCENARIOS[key].maxT, playerHp: player.hp, deathBy: 'timeout', deathX: player.centerX, actionCounts, idleFrames };
}

function analyze(episodes: EpisodeResult[], label: string, n: number): void {
  const wins = episodes.filter((e) => e.win).length;
  const timeouts = episodes.filter((e) => e.deathBy === 'timeout').length;
  const deathCounts: Record<string, number> = {};
  for (const e of episodes) {
    if (!e.win) deathCounts[e.deathBy] = (deathCounts[e.deathBy] ?? 0) + 1;
  }
  const avgTicks = episodes.reduce((s, e) => s + e.ticks, 0) / n;
  const avgIdle = episodes.reduce((s, e) => s + e.idleFrames, 0) / n;

  console.log(`\n=== ${label} ===`);
  console.log(`胜率: ${wins}/${n} (${((wins / n) * 100).toFixed(0)}%)  超时: ${timeouts}  平均帧数: ${avgTicks.toFixed(0)}  平均卡住帧: ${avgIdle.toFixed(0)}`);
  if (Object.keys(deathCounts).length) {
    console.log(`死亡原因:`, Object.entries(deathCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' '));
  }
}

async function main(): Promise<void> {
  const modelName = process.argv[2] ?? 'ppo_waves_run3';
  const modelPath = `sim/rl/${modelName}.zip.onnx`;
  const altPath = `sim/rl/${modelName}.onnx`;
  let session: ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(fs.existsSync(modelPath) ? modelPath : altPath);
  } catch {
    console.log(`模型 ${modelName} 找不到，尝试 public/models/ppo_waves.onnx`);
    session = await ort.InferenceSession.create('public/models/ppo_waves.onnx');
  }
  console.log(`[模型] ${modelName} 加载成功`);

  const allResults: Record<string, EpisodeResult[]> = {};
  const n = 10;
  for (const key of Object.keys(SCENARIOS) as ScenarioKey[]) {
    const results: EpisodeResult[] = [];
    for (let ep = 0; ep < n; ep++) {
      results.push(await runEpisode(session, key, 100 + ep * 37));
    }
    allResults[key] = results;
    analyze(results, SCENARIOS[key].label, n);
  }

  const outDir = 'sim/analysis';
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = `${outDir}/${modelName}_${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2));
  console.log(`\n[报告已存] ${outFile}`);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
