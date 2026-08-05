/**
 * 烟测（乐邦·摊母私）：玩家（无敌）持续 3 段连招攻击，验证三阶段/认父/惊天一跪一分雨/
 * 流窜抱团召唤巨头/七脏诀/控制免疫 是否都触发。运行：npx tsx sim/diag-lebron.ts
 */
import { Stage } from '../src/stage';
import { Player, BLADE } from '../src/player';
import { LebronBoss, LebronGiant } from '../src/boss-lebron';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { reseed } from '../src/rng';
import { resolveCombat } from '../src/combat';
import type { World } from '../src/world';

const ARENA = { L: 4780, R: 5100 };

class FakeInput {
  private heldSet = new Set<string>();
  private buf: { a: string; f: number }[] = [];
  frame = 0;
  isHeld(a: string): boolean { return this.heldSet.has(a); }
  hold(a: string, on: boolean): void { on ? this.heldSet.add(a) : this.heldSet.delete(a); }
  press(a: string): void { this.buf.push({ a, f: this.frame }); }
  consume(a: string): boolean {
    const i = this.buf.findIndex((p) => p.a === a && this.frame - p.f <= 9);
    if (i >= 0) { this.buf.splice(i, 1); return true; }
    return false;
  }
  consumeDir(): { consumed: boolean; dir: number } { return { consumed: false, dir: 0 }; }
  tick(): void { this.frame++; this.buf = this.buf.filter((p) => this.frame - p.f <= 9); }
}

function makeWorld(): { world: World; player: Player; input: FakeInput; boss: LebronBoss } {
  const stage = new Stage(5140);
  const player = new Player();
  player.x = ARENA.L + 30;
  player.y = stage.groundY - player.h;
  player.onGround = true;
  player.god = true; // 烟测：玩家无敌，专注看 Boss 机制触发
  const input = new FakeInput();
  const boss = new LebronBoss(ARENA.L + 200, stage.groundY - 42);
  const world: World = {
    input: input as never,
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
  return { world, player, input, boss };
}

function clampBarriers(world: World): void {
  const { player } = world;
  for (const e of world.enemies) {
    if (e.x < ARENA.L) { e.x = ARENA.L; if (e.vx < 0) e.vx = 0; }
    if (e.x + e.w > ARENA.R) { e.x = ARENA.R - e.w; if (e.vx > 0) e.vx = 0; }
  }
  if (player.x < ARENA.L) { player.x = ARENA.L; if (player.vx < 0) player.vx = 0; }
  if (player.x + player.w > ARENA.R) { player.x = ARENA.R - player.w; if (player.vx > 0) player.vx = 0; }
}

function step(w: World, input: FakeInput, press?: string[]): void {
  for (const a of press ?? []) input.press(a);
  input.tick();
  w.player.update(w);
  for (const e of w.enemies) e.update(w);
  w.enemies = w.enemies.filter((e) => !e.removable);
  for (const a of w.arrows) a.update(w);
  w.arrows = w.arrows.filter((a) => !a.dead);
  resolveCombat(w);
  clampBarriers(w);
}

function main(): void {
  reseed(9);
  const { world, player, input, boss } = makeWorld();
  let lastStage = 0;
  let sawPhase2 = false, sawPhase3 = false, sawKneel = false, sawRain = false, sawGiants = false, sawQijue = false, sawMark = false;
  let hitStateFrames = 0; // Boss 进 hit 态帧数（狂野应=0）

  for (let f = 0; f < 9000; f++) {
    // 玩家 3 段连招节奏（无脑打）
    const presses: string[] = [];
    if (player.state === 'attack') {
      const spec = BLADE[player.attackStage - 1];
      if (player.attackStage < 3 && player.attackTimer >= spec.cancelFrom && player.attackTimer <= spec.cancelTo && player.attackStage !== lastStage) {
        presses.push('attack');
        lastStage = player.attackStage;
      }
    } else if (player.state === 'idle' || player.state === 'run') {
      lastStage = 0;
      if (Math.abs(boss.centerX - player.centerX) < 50) presses.push('attack');
    }
    step(world, input, presses);

    if (boss.phase >= 2) sawPhase2 = true;
    if (boss.phase >= 3) sawPhase3 = true;
    if (boss.state === 'kneel') sawKneel = true;
    if (boss.rainTimer > 0) sawRain = true;
    if (world.enemies.some((e) => e instanceof LebronGiant)) sawGiants = true;
    if (boss.state === 'qijue') sawQijue = true;
    if (player.lebronMark > 0) sawMark = true;
    if (boss.state === 'hit') hitStateFrames++;
    if (boss.dead) break;
  }

  console.log(`[乐邦烟测 9000帧] BossHP=${boss.hp} 死亡=${boss.dead} phase=${boss.phase}`);
  console.log(`  触发：二阶段=${sawPhase2} 三阶段=${sawPhase3} 惊天一跪=${sawKneel} 一分雨=${sawRain}`);
  console.log(`  触发：召唤巨头=${sawGiants} 七脏诀=${sawQijue} 父爱印记=${sawMark}`);
  console.log(`  狂野：Boss 进 hit 态帧数=${hitStateFrames}（应=0，不吃硬直）`);
  const pass = sawPhase2 && sawPhase3 && sawKneel && sawRain && sawMark && hitStateFrames === 0;
  console.log(pass ? '  结论：阶段/下跪/雨/印记/控制免疫 全部触发 ✓' : '  结论：有机制未触发 ✗');
  if (!pass) process.exit(1);

  // —— 直接验证两个技能状态机（AI 决策依赖长 CD + rand，单独强制触发） ——
  {
    // 流窜抱团：强制 team → 应召唤两个巨头
    const { world, boss } = makeWorld();
    world.enemies = [boss];
    boss.state = 'team';
    boss.timer = 1;
    boss.phase = 2;
    step(world, world.input as never, []);
    const giants = world.enemies.filter((e) => e instanceof LebronGiant).length;
    console.log(`  流窜抱团：召唤巨头数=${giants}（应=2） ${giants === 2 ? '✓' : '✗'}`);
    if (giants !== 2) process.exit(1);
  }
  {
    // 七脏诀：强制 qijue，timer 就绪 → 玩家应掉血（5% 当前生命，min 1）
    const { world, player, boss } = makeWorld();
    player.god = false;
    player.hp = 100;
    world.enemies = [boss];
    boss.state = 'qijue';
    boss.qijueHit = 0;
    boss.qijueTimer = 17; // 下一帧触发第 1 段
    const before = player.hp;
    for (let f = 0; f < 40; f++) step(world, world.input as never, []);
    const dmg = before - player.hp;
    console.log(`  七脏诀：40 帧内玩家掉血=${dmg}（应≈5×2=10，5%当前生命） ${dmg >= 5 ? '✓' : '✗'}`);
    if (dmg < 5) process.exit(1);
  }
}

main();
