/**
 * 诊断（玩家反馈：站在角落 Boss 停止攻击）：Boss 被逼到左结界角落贴脸时，
 * 其朝左的近战判定框 [x-range, x] 与贴墙玩家 [x, x+w] 是否因严格 `>` 永不重叠 → 连击空挥。
 * 复刻 gatefight：arena=[2970,3280]。运行：npx tsx sim/diag-boss-corner.ts
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Boss } from '../src/boss';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { reseed } from '../src/rng';
import { resolveCombat } from '../src/combat';
import type { World } from '../src/world';

const ARENA = { min: 2970, max: 3280 };

class FakeInput {
  isHeld(): boolean { return false; }
  consume(): boolean { return false; }
  consumeDir(): { consumed: boolean; dir: number } { return { consumed: false, dir: 0 }; }
  tick(): void {}
}

function makeWorld(bossX: number): { world: World; player: Player; boss: Boss } {
  reseed(11);
  const stage = new Stage(4740); // 与 main.ts 一致：游戏真实舞台宽 4740（默认 2750 是 RL 环境宽）
  const player = new Player();
  player.x = ARENA.min; // 玩家贴左结界角落
  player.y = stage.groundY - player.h;
  player.onGround = true;
  const boss = new Boss(bossX, stage.groundY - 40, { arena: ARENA });
  const world: World = {
    input: new FakeInput() as never,
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

/** 结界夹取（模拟 main.ts clampBarriers） */
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

function step(world: World, bL: number | null, bR: number | null): void {
  clampBarriers(world, bL, bR);
  world.player.update(world); // 玩家正常更新：受击硬直/无敌帧递减/被击退（否则第一次受击后 invTimer 永不递减=永久无敌）
  for (const e of world.enemies) e.update(world);
  world.enemies = world.enemies.filter((e) => !e.removable);
  resolveCombat(world);
  clampBarriers(world, bL, bR);
}

function run(bossX: number, frames: number, label: string): void {
  const { world, player, boss } = makeWorld(bossX);
  const hits: { f: number; dmg: number }[] = [];
  const stateCount = new Map<string, number>();
  let lastHp = player.hp;
  let flushAt: number | null = null; // Boss 贴左结界（x<=arenaMin）的帧
  let whiffFrames = 0;               // Boss 在 combo/dashKick/sweep 判定帧但打不中玩家

  for (let f = 0; f < frames; f++) {
    step(world, ARENA.min, ARENA.max);
    stateCount.set(boss.state, (stateCount.get(boss.state) ?? 0) + 1);
    if (boss.x <= ARENA.min && flushAt === null) flushAt = f;
    // Boss 攻击判定帧存在但未命中玩家 → 空挥
    const hb = boss.getAttackHitbox();
    if (hb) {
      const overlap = hb.x + hb.w > player.x && hb.x < player.x + player.w;
      if (!overlap) whiffFrames++;
    }
    if (player.hp < lastHp) { hits.push({ f, dmg: lastHp - player.hp }); lastHp = player.hp; }
    if (player.dead) break;
  }

  const states = [...stateCount.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join(' ');
  console.log(`[${label} ${frames}帧] 玩家HP=${player.hp} 受击=${hits.length}次 ${JSON.stringify(hits.slice(0, 4))}`);
  console.log(`  贴结界帧=${flushAt ?? '无'} 攻击判定空挥帧=${whiffFrames} Boss末x=${boss.x.toFixed(0)}`);
  console.log(`  状态分布: ${states}`);
}

function main(): void {
  // A. 自然流程：Boss 从右侧 3230 追来，玩家贴左角不动 —— 观察是否贴脸后空挥
  run(3230, 1200, 'A 自然追进');
  // B. 强制贴脸：Boss 直接被击退到左结界（x=2970）与玩家贴死 —— 复现角落空挥
  run(ARENA.min, 400, 'B 强制贴脸');
}

main();
