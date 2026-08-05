/**
 * 诊断（玩家反馈：无脑平推）：玩家行进挥刀顶着 3 个足轻推，敌人能否还手？
 * 复刻 main.ts 时序。运行：npx tsx sim/diag-pingtui.ts
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Enemy } from '../src/enemy';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { reseed } from '../src/rng';
import { resolveCombat } from '../src/combat';
import type { World } from '../src/world';

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

function makeWorld(): { world: World; player: Player; input: FakeInput } {
  const stage = new Stage();
  const player = new Player();
  player.x = 380;
  player.y = stage.groundY - player.h;
  player.onGround = true;
  const input = new FakeInput();
  const world: World = {
    input: input as never,
    effects: new Effects(),
    stage,
    player,
    enemies: [
      Enemy.ashigaru(440, stage.groundY),
      Enemy.ashigaru(470, stage.groundY),
      Enemy.ashigaru(500, stage.groundY),
    ],
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

function step(w: World, input: FakeInput, hold?: [string, boolean][], press?: string[]): void {
  for (const [a, on] of hold ?? []) input.hold(a, on);
  for (const a of press ?? []) input.press(a);
  input.tick();
  w.player.update(w);
  for (const e of w.enemies) e.update(w);
  w.enemies = w.enemies.filter((e) => !e.removable);
  resolveCombat(w);
}

function main(): void {
  reseed(7);
  const { world, player, input } = makeWorld();
  const hits: { f: number; dmg: number }[] = [];
  let enemyThrusts = 0;   // 敌人进入 thrust 主动判定帧且命中玩家的次数
  let lastHp = player.hp;

  for (let f = 0; f < 600; f++) {
    // 无脑平推：一直按住右 + 每 9 帧按一次攻击（贴合取消窗口的连按）
    step(world, input, [['right', true]], f % 9 === 0 ? ['attack'] : []);
    if (player.hp < lastHp) {
      hits.push({ f, dmg: lastHp - player.hp });
      lastHp = player.hp;
    }
    // 统计敌人是否真正把突刺打出来
    for (const e of world.enemies) {
      if (e.state === 'thrust' && e.getAttackHitbox()) {
        const hb = e.getAttackHitbox()!;
        if (hb.x + hb.w > player.x && hb.x < player.x + player.w) enemyThrusts++;
      }
    }
    if (player.dead) break;
  }

  console.log(`[平推 600帧] 玩家HP=${player.hp} 受击次数=${hits.length} 受击详情=${JSON.stringify(hits.slice(0, 6))}`);
  console.log(`  敌人剩余=${world.enemies.length} 敌人突刺判定命中帧=${enemyThrusts} 玩家state=${player.state}`);
  if (world.enemies.length > 0) {
    console.log(`  敌HP=${world.enemies.map((e) => e.hp).join(',')} 敌位置=${world.enemies.map((e) => e.x.toFixed(0)).join(',')} 玩家位置=${player.x.toFixed(0)}`);
  }
  const stunlocked = hits.length === 0;
  console.log(stunlocked
    ? '  结论：玩家全程无伤 —— 平推成立（敌人攻击被打断，永远打不中）'
    : `  结论：玩家受击 ${hits.length} 次 —— 敌人能还手`);
}

main();
