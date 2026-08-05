/**
 * 诊断（玩家反馈：后摇太长）：普攻判定结束后的后摇能否被移动/跳跃打断（中断机制）。
 * 复刻 main.ts 时序：input.tick() → player.update()。缓冲窗口 9 帧（与 Input 一致）。
 * 运行：npx tsx sim/diag-attack-cancel.ts
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import type { World } from '../src/world';

/** 复刻 Input 的缓冲语义：press 记录按下帧，consume 在 9 帧内可消费 */
class FakeInput {
  frame = 0;
  private heldSet = new Set<string>();
  private buffer: { a: string; f: number }[] = [];
  isHeld(a: string): boolean { return this.heldSet.has(a); }
  hold(a: string, on: boolean): void { on ? this.heldSet.add(a) : this.heldSet.delete(a); }
  press(a: string): void { this.buffer.push({ a, f: this.frame }); }
  consume(a: string): boolean {
    const i = this.buffer.findIndex((p) => p.a === a && this.frame - p.f <= 9);
    if (i >= 0) { this.buffer.splice(i, 1); return true; }
    return false;
  }
  consumeDir(): { consumed: boolean; dir: number } { return { consumed: false, dir: 0 }; }
  tick(): void { this.frame++; this.buffer = this.buffer.filter((p) => this.frame - p.f <= 9); }
}

function makeWorld(): { world: World; player: Player; input: FakeInput } {
  const stage = new Stage();
  const player = new Player();
  player.x = 400;
  player.y = stage.groundY - player.h;
  player.onGround = true; // 出生即落地：避免首帧"落地过渡"触发落地取消挥刀，干扰测试
  const input = new FakeInput();
  const world: World = {
    input: input as never,
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
  return { world, player, input };
}

/** 一步：press 按键 → hold 修改 → tick → player.update */
function step(world: World, input: FakeInput, press?: string[], hold?: [string, boolean][]): void {
  for (const a of press ?? []) input.press(a);
  for (const [a, on] of hold ?? []) input.hold(a, on);
  input.tick();
  world.player.update(world);
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail: string): void {
  if (cond) { pass++; console.log(`  ✓ ${name} — ${detail}`); }
  else { fail++; console.log(`  ✗ ${name} — ${detail}`); }
}

function main(): void {
  // A. 站立无输入：三段后摇锁定到 spec.end 才自动收招（16 帧内不可离场）
  {
    const { world, player, input } = makeWorld();
    step(world, input, ['attack']);
    let inAttack = 1, exitFrame = -1;
    for (let f = 1; f <= 20; f++) {
      step(world, input);
      if (player.state === 'attack') inAttack++;
      else { exitFrame = f; break; }
    }
    console.log(`[A 无打断连击] attack 持续 ${inAttack} 帧, 第 ${exitFrame} 帧自动收招回 ${player.state}`);
    check('A 无打断时后摇锁满 spec.end', inAttack === 16 && exitFrame === 16, `attack=${inAttack}帧 exit=${exitFrame}`);
  }

  // B. 后摇跳跃取消（地面）：第 8 帧（判定结束）按跳 → 提前出招
  {
    const { world, player, input } = makeWorld();
    step(world, input, ['attack']); // attackTimer=0
    for (let f = 1; f < 8; f++) step(world, input); // timer 1..7（判定期间）
    step(world, input, ['jump']);   // timer=8（后摇第1帧）按跳
    console.log(`[B 后摇跳跃取消] state=${player.state} vy=${player.vy.toFixed(1)} onGround=${player.onGround} timer=${player.attackTimer}`);
    check('B 跳跃取消后摇→空中起跳', player.state === 'air' && !player.onGround && player.vy < 0,
      `state=${player.state} vy=${player.vy.toFixed(1)}`);
  }

  // C. 判定期间按跳不取消，缓冲到后摇第一帧生效（输入缓冲）
  {
    const { world, player, input } = makeWorld();
    step(world, input, ['attack']);          // timer=0
    step(world, input, ['jump']);            // timer=1 判定期间按跳（应缓冲不生效）
    const duringActive = player.state;
    step(world, input); step(world, input); step(world, input); // timer 2..4 仍判定
    const stillActive = player.state;
    for (let f = 0; f < 4; f++) step(world, input); // timer 5..8 → 后摇第1帧消费缓冲
    const afterRecovery = player.state;
    console.log(`[C 缓冲取消] 判定期间=${duringActive}/${stillActive} → 后摇=${afterRecovery} vy=${player.vy.toFixed(1)}`);
    check('C 判定期间不可取消', duringActive === 'attack' && stillActive === 'attack', `during=${duringActive}`);
    check('C 缓冲跳到后摇第一帧生效', afterRecovery === 'air' && player.vy < 0, `after=${afterRecovery}`);
  }

  // D. 后摇移动取消：按住方向 → 判定后解除攻击态进跑动
  {
    const { world, player, input } = makeWorld();
    step(world, input, ['attack']);          // timer=0
    for (let f = 1; f < 4; f++) step(world, input); // timer 1..3
    step(world, input, [], [['right', true]]);      // timer=4 按住右（判定内：行进挥刀，不取消）
    const duringActive = player.state;
    for (let f = 0; f < 4; f++) step(world, input); // timer 5..8 → 后摇移动取消
    const after = player.state;
    console.log(`[D 后摇移动取消] 判定中=${duringActive} → 后摇=${after} facing=${player.facing} vx=${player.vx.toFixed(1)}`);
    check('D 判定期间移动不取消攻击', duringActive === 'attack', `during=${duringActive}`);
    check('D 后摇移动取消→跑动', after === 'run' && player.facing === 1 && player.vx > 0, `after=${after} vx=${player.vx.toFixed(1)}`);
  }

  // E. 连招优先于移动打断：判定期间行进，后摇第 1 帧同时按 J + 按住方向 → 接下一段而非进跑
  {
    const { world, player, input } = makeWorld();
    step(world, input, ['attack']);                       // timer=0 stage1
    for (let f = 1; f < 8; f++) step(world, input, [], [['right', true]]); // timer 1..7 判定中行进挥刀
    step(world, input, ['attack'], [['right', true]]);    // timer=8 后摇第1帧：按J+按住右，连招应优先
    console.log(`[E 连招优先] stage=${player.attackStage} state=${player.state}`);
    check('E 按住方向+按J→接下一段', player.attackStage === 2 && player.state === 'attack',
      `stage=${player.attackStage} state=${player.state}`);
  }

  // F. 空中后摇二段跳取消：判定结束后按跳 → 二段跳
  {
    const { world, player, input } = makeWorld();
    player.onGround = false; player.airJumps = 1; player.vy = -5;
    player.y = world.stage.groundY - player.h - 30;
    step(world, input, ['attack']);
    for (let f = 1; f < 8; f++) step(world, input);
    step(world, input, ['jump']); // 后摇
    console.log(`[F 空中二段跳取消] state=${player.state} airJumps=${player.airJumps} vy=${player.vy.toFixed(1)}`);
    check('F 空中后摇→二段跳取消', player.state === 'air' && player.airJumps === 0 && player.vy < -5,
      `state=${player.state} airJumps=${player.airJumps} vy=${player.vy.toFixed(1)}`);
  }

  // G. 空中无跳可跳时按跳不取消（与普通跳跃一致）
  {
    const { world, player, input } = makeWorld();
    player.onGround = false; player.airJumps = 0; player.vy = -3;
    player.y = world.stage.groundY - player.h - 30;
    step(world, input, ['attack']);
    for (let f = 1; f < 8; f++) step(world, input);
    step(world, input, ['jump']); // 后摇但无跳可用
    console.log(`[G 无跳可跳] state=${player.state} airJumps=${player.airJumps}`);
    check('G 无跳不可跳跃取消', player.state === 'attack', `state=${player.state}`);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main();
