/**
 * AI 实测脚本：Node 里跑真实游戏 + 真实 ONNX 模型（不依赖浏览器）。
 * 复刻 ?ai=boss 的场景：Boss + 双钩使，AI 驱动玩家。
 * 运行：npx tsx sim/ai-test.ts
 *
 * 输出：AI 是否加载模型 / 每 120 帧玩家状态 / 选的动作 / 敌血变化
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Boss } from '../src/boss';
import { HookSoldier } from '../src/hooksoldier';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { resolveCombat } from '../src/combat';
import { reseed } from '../src/rng';
import { buildObs } from '../src/ai';
import * as ort from 'onnxruntime-node';
import type { World } from '../src/world';

const OBS_SIZE = 42;
const ACTIONS: string[][] = [
  [], ['left'], ['right'], ['jump'], ['attack'], ['shuriken'], ['dash'],
  ['skillU'], ['skillH'], ['skillO'],
  ['left', 'attack'], ['right', 'attack'], ['left', 'jump'], ['right', 'jump'],
];

/** 仿 AiInput 的输入驱动 */
class AiDriver {
  held = new Set<string>();
  buffer: { action: string; frame: number }[] = [];
  frame = 0;
  decisions = 0;
  errors = 0;

  tick(): void {
    this.frame++;
  }
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

function makeWorld(): { world: World; driver: AiDriver; player: Player; boss: Boss } {
  reseed(7);
  const stage = new Stage();
  const driver = new AiDriver();
  const player = new Player();
  player.x = 2370;
  player.y = 300;

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
  const boss = new Boss(2530 + 100, stage.groundY - 40);
  world.enemies.push(boss);
  world.enemies.push(new HookSoldier(2530 - 120, stage.groundY - 34));
  world.enemies.push(new HookSoldier(2530 + 220, stage.groundY - 34));
  return { world, driver, player, boss };
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

async function main(): Promise<void> {
  const modelPath = 'public/models/ppo_boss.onnx';
  const session = await ort.InferenceSession.create(modelPath);
  console.log(`[OK] 模型加载成功: ${modelPath}`);
  console.log(`     输入: ${session.inputNames.join(',')} 输出: ${session.outputNames.join(',')}`);

  const { world, driver, player, boss } = makeWorld();
  let lastAct = -1;

  for (let f = 0; f < 7200; f++) {
    driver.tick();

    // Boss 场 2 帧一决策（与 AiInput 一致）
    if (f % 2 === 0) {
      try {
        const obs = buildObs(world);
        const feeds = { obs: new ort.Tensor('float32', obs, [1, OBS_SIZE]) };
        const out = await session.run(feeds);
        const action = Number(out.action.data[0]);
        driver.apply(action);
        lastAct = action;
        driver.decisions++;
      } catch (e) {
        driver.errors++;
        if (driver.errors === 1) console.log('[ERR] 决策失败:', e);
      }
    }

    step(world);

    if (f % 120 === 0 || world.enemies.length === 0) {
      const bossHp = boss.dead ? 0 : boss.hp;
      console.log(
        `t=${f} 玩家(x=${player.centerX.toFixed(0)},y=${player.centerY.toFixed(0)}) ` +
        `state=${player.state} hp=${player.hp} | 动作=${lastAct}(${ACTIONS[lastAct]?.join('+') ?? '?'}) ` +
        `| BossHP=${bossHp} 敌数=${world.enemies.length}`,
      );
    }
    if (boss.dead || player.state === 'dead') {
      console.log(`\n[结束] ${boss.dead ? 'AI 斩龙成功' : '玩家死亡'}  | 决策数=${driver.decisions} 错误=${driver.errors}`);
      break;
    }
  }
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
