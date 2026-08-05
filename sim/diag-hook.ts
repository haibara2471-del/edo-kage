/**
 * 诊断（玩家反馈：钩子勾中后人物漂移而不是被拉到钩使身边）。
 * 钩使 550 钩中玩家 400 → 玩家最终停在哪？运行：npx tsx sim/diag-hook.ts
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Enemy } from '../src/enemy';
import { HookSoldier } from '../src/hooksoldier';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { reseed } from '../src/rng';
import { resolveCombat } from '../src/combat';
import type { World } from '../src/world';

class FakeInput {
  isHeld(): boolean { return false; }
  consume(): boolean { return false; }
  consumeDir(): { consumed: boolean; dir: number } { return { consumed: false, dir: 0 }; }
  tick(): void {}
}

function makeWorld(): { world: World; player: Player } {
  const stage = new Stage();
  const player = new Player();
  player.x = 400;
  player.y = stage.groundY - player.h;
  player.onGround = true;
  const hook = new HookSoldier(550, stage.groundY - 34);
  hook.atkCd = 0; // 立即出钩（默认 60 帧等待期间会走近贴脸导致不出钩，不是本次测的拉拽）
  const ally = Enemy.ashigaru(640, stage.groundY); // 队友接应 → 钩使才会出钩
  const world: World = {
    input: new FakeInput() as never,
    effects: new Effects(),
    stage,
    player,
    enemies: [hook, ally],
    projectiles: [],
    arrows: [],
    orbs: [],
    clouds: [],
    codex: new Codex(),
    camX: 0,
    lastHits: [],
  };
  return { world, player };
}

function step(w: World): void {
  w.player.update(w);
  for (const e of w.enemies) e.update(w);
  w.enemies = w.enemies.filter((e) => !e.removable);
  for (const p of w.projectiles) p.update(w.stage.width);
  w.projectiles = w.projectiles.filter((p) => !p.dead);
  for (const a of w.arrows) a.update(w);
  w.arrows = w.arrows.filter((a) => !a.dead);
  resolveCombat(w);
}

function main(): void {
  reseed(3);
  const { world, player } = makeWorld();
  const hook = world.enemies[0] as HookSoldier;
  let hooked = -1;         // 被钩中的帧
  let pullEnd = -1;        // 拉拽结束（pull 清除）的帧
  let maxX = -1e9;         // 拉拽期间玩家达到的最大 x（检查是否冲过钩使）
  let settleDist = 0;      // 拉拽结束时玩家到钩使的距离

  for (let f = 0; f < 70; f++) { // 只测拉拽阶段（f<70，足轻还没机会命中：玩家无敌到 f=76）
    step(world);
    if (hooked < 0 && player.hp < 100) hooked = f;
    if (hooked >= 0) maxX = Math.max(maxX, player.x);
    if (player.pull === null && hooked >= 0 && pullEnd < 0) {
      pullEnd = f;
      settleDist = Math.abs(player.centerX - hook.centerX);
    }
  }

  console.log(`[钩子拉拽] 被钩中帧=${hooked} 拉拽结束帧=${pullEnd} 钩使x=${hook.x.toFixed(0)} 玩家初始x=400`);
  console.log(`  拉拽结束时玩家x=${(player.x).toFixed(0)} 距钩使=${settleDist.toFixed(0)}px 拉拽期间最大x=${maxX.toFixed(0)}`);
  const overshoot = maxX > hook.x + 20; // 冲过钩使 20px 以上 = 漂移
  const arrived = settleDist <= 30;     // 停在钩使身边 30px 内
  console.log(arrived && !overshoot
    ? `  结论：玩家被拉到钩使身边并停住（距 ${settleDist.toFixed(0)}px，未冲过）`
    : `  结论：拉拽异常 —— 到位=${arrived} 冲过=${overshoot}`);
}

main();
