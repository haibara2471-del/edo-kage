/**
 * 诊断（问题2）：Boss 被逼到左屏障角落时，残像瞬移不应闪出屏障再被拽回。
 * 模拟真实 gatefight 场景：barrierL=2970, barrierX=3280，玩家在 Boss 左侧攻击。
 * 运行：npx tsx sim/diag-boss-barrier.ts
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Boss } from '../src/boss';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { resolveCombat } from '../src/combat';
import { reseed } from '../src/rng';
import type { World } from '../src/world';

const driver = { tick() {}, isHeld: () => false, consume: () => false };

const ARENA = { min: 2970, max: 3280 }; // gatefight 结界

function makeWorld(bossX: number, withArena: boolean): { world: World; player: Player; boss: Boss } {
  reseed(42);
  const stage = new Stage();
  const player = new Player();
  player.x = 2960; // 玩家卡在左屏障内缘（左侧）
  player.y = stage.groundY - player.h;
  const boss = new Boss(bossX, stage.groundY - 40, withArena ? { arena: ARENA } : {});

  const world: World = {
    input: driver as never,
    effects: new Effects(),
    stage,
    player,
    enemies: [boss],
    projectiles: [],
    arrows: [],
    orbs: [],
    clouds: [],
    codex: new Codex(),
    camX: 0,
    lastHits: [],
  };
  return { world, player, boss };
}

/** 屏障夹取（模拟 main.ts clampBarriers） */
function clampBarriers(world: World, bL: number | null, bR: number | null): void {
  const { player } = world;
  if (bR !== null) {
    if (player.x + player.w > bR) { player.x = bR - player.w; if (player.vx > 0) player.vx = 0; }
    for (const e of world.enemies) {
      if (e.x + e.w > bR) { e.x = bR - e.w; if (e.vx > 0) e.vx = 0; }
    }
  }
  if (bL !== null) {
    if (player.x < bL) { player.x = bL; if (player.vx < 0) player.vx = 0; }
    for (const e of world.enemies) {
      if (e.x < bL) { e.x = bL; if (e.vx < 0) e.vx = 0; }
    }
  }
}

/** onlyOnce=true：结算后不夹取（模拟旧 bug 时序），专测 arena 感知能否自愈 */
function step(world: World, bL: number | null, bR: number | null, onlyOnce: boolean): void {
  clampBarriers(world, bL, bR);
  for (const e of world.enemies) e.update(world);
  world.enemies = world.enemies.filter((e) => !e.removable);
  resolveCombat(world);
  if (!onlyOnce) clampBarriers(world, bL, bR);
}

function main(): void {
  // 场景：Boss 在左屏障（x=2990，距 barrierL 2970 很近），玩家在左侧攻击（facing=+1）
  // 攻击方向 dirX=+1 → 残像瞬移原本 x-70=2920 < barrierL → 闪出屏障
  for (const onlyOnce of [true, false]) {
    for (const withArena of [false, true]) {
      const { world, player, boss } = makeWorld(2990, withArena);
      let minX = 1e9, minXFrame = -1;
      let escaped = false;
      for (let f = 0; f < 600; f++) {
        // 玩家持续攻击（刀光覆盖 Boss）
        player.state = 'attack';
        player.attackStage = 1;
        player.attackTimer = 5;
        player.attackId++;
        player.facing = 1;
        step(world, ARENA.min, ARENA.max, onlyOnce);
        if (boss.x < minX) { minX = boss.x; minXFrame = f; }
        if (boss.x < ARENA.min) { escaped = true; break; }
        if (boss.dead) break;
        if (boss.state === 'idle') boss.state = 'walk';
      }
      console.log(
        `[onlyOnce=${onlyOnce} arena=${withArena}] 最低 x=${minX.toFixed(0)} escaped=${escaped}` +
        ` dead=${boss.dead} hp=${boss.hp} finalX=${boss.x.toFixed(0)}`,
      );
    }
  }
}

main();
