/**
 * 诊断（问题1）：玩家处于 attack 状态（行进挥砍）时，敌人攻击/受击交互是否正常。
 * 场景 B：敌人位于玩家背后（脱离玩家刀光范围），强制进入 thrust，检查玩家是否受伤。
 * 运行：npx tsx sim/diag-walkattack.ts
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Enemy } from '../src/enemy';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { resolveCombat } from '../src/combat';
import type { World } from '../src/world';

const driver = { tick() {}, isHeld: () => false, consume: () => false };

function makeWorld(): { world: World; player: Player; enemy: Enemy } {
  const stage = new Stage();
  const player = new Player();
  player.x = 400;
  player.y = stage.groundY - player.h;
  const enemy = Enemy.ashigaru(348, stage.groundY); // 玩家左后方，面向右（thrust 朝玩家）
  enemy.facing = 1;

  const world: World = {
    input: driver as never,
    effects: new Effects(),
    stage,
    player,
    enemies: [enemy],
    projectiles: [],
    arrows: [],
    orbs: [],
    clouds: [],
    codex: new Codex(),
    camX: 0,
    lastHits: [],
  };
  return { world, player, enemy };
}

function main(): void {
  // —— 场景 A：玩家不在攻击态（对照） ——
  {
    const { world, player, enemy } = makeWorld();
    enemy.state = 'thrust'; enemy.timer = 4;
    const before = player.hp;
    resolveCombat(world);
    console.log(`[A 对照/非攻击态] hp ${before}→${player.hp} 受伤=${before - player.hp} state=${player.state} vx=${player.vx.toFixed(1)}`);
  }
  // —— 场景 B：玩家 attack 状态、判定帧内（attackTimer=5，第1段 active 4..7），背对敌人 ——
  {
    const { world, player, enemy } = makeWorld();
    player.state = 'attack';
    player.attackStage = 1;
    player.attackTimer = 5;
    player.facing = 1;
    enemy.state = 'thrust'; enemy.timer = 4;
    const before = player.hp;
    resolveCombat(world);
    console.log(`[B 攻击态/判定帧] hp ${before}→${player.hp} 受伤=${before - player.hp} state=${player.state} vx=${player.vx.toFixed(1)}`);
  }
  // —— 场景 C：玩家 attack 状态、收招帧（attackTimer=12，第1段 end=16，判定已结束） ——
  {
    const { world, player, enemy } = makeWorld();
    player.state = 'attack';
    player.attackStage = 1;
    player.attackTimer = 12;
    player.facing = 1;
    enemy.state = 'thrust'; enemy.timer = 4;
    const before = player.hp;
    resolveCombat(world);
    console.log(`[C 攻击态/收招帧] hp ${before}→${player.hp} 受伤=${before - player.hp} state=${player.state} vx=${player.vx.toFixed(1)}`);
  }
  // —— 场景 D：完整帧模拟——玩家 attack 状态 + 敌人正前方 thrust（判定框重叠互拼） ——
  {
    const { world, player, enemy } = makeWorld();
    player.state = 'attack';
    player.attackStage = 1;
    player.attackTimer = 5;
    player.facing = 1;
    // 敌人放到玩家正前方 30px（刀光范围边缘），thrust 朝玩家
    enemy.x = player.x + player.w + 30; // 450
    enemy.facing = -1;
    enemy.state = 'thrust'; enemy.timer = 4;
    const before = player.hp;
    const enemyBefore = enemy.hp;
    resolveCombat(world);
    console.log(`[D 正面对拼/敌在刀光边缘] 玩家hp ${before}→${player.hp}(伤${before - player.hp}) state=${player.state} | 敌hp ${enemyBefore}→${enemy.hp} 敌state=${enemy.state}`);
  }
  // —— 场景 E：玩家 attack + 敌人 thrust 双方判定都重叠（刀光能中敌人、刺击能中玩家）——同帧互拼谁先结算 ——
  {
    const { world, player, enemy } = makeWorld();
    player.state = 'attack';
    player.attackStage = 1;
    player.attackTimer = 5;
    player.facing = 1;
    player.attackId++; // 模拟 startAttack：递增 attackId，否则 enemy.lastHitId(=0) 撞 0 跳过命中
    enemy.x = player.x + player.w + 10; // 430：刀光(420..450) 中敌(430..452)，刺击朝左(394..430) 中玩家(400..420)
    enemy.facing = -1;
    enemy.state = 'thrust'; enemy.timer = 4;
    const before = player.hp;
    const enemyBefore = enemy.hp;
    resolveCombat(world);
    console.log(`[E 同帧互拼] 玩家hp ${before}→${player.hp}(伤${before - player.hp}) state=${player.state} | 敌hp ${enemyBefore}→${enemy.hp} 敌state=${enemy.state} 敌timer=${enemy.timer}`);
  }
  // —— 场景 F：同帧互拼，但敌人先于玩家 update（模拟真实 tick 顺序：敌先攻击再玩家砍）——
  {
    const { world, player, enemy } = makeWorld();
    // 先推进敌人一帧：让敌人保持 thrust 状态
    player.state = 'attack';
    player.attackStage = 1;
    player.attackTimer = 5;
    player.facing = 1;
    enemy.x = player.x + player.w + 10; // 430
    enemy.facing = -1;
    enemy.state = 'thrust'; enemy.timer = 6;
    const before = player.hp;
    resolveCombat(world);
    console.log(`[F 同帧互拼/enemy先结算] 玩家hp ${before}→${player.hp}(伤${before - player.hp}) state=${player.state} | 敌state=${enemy.state}`);
  }
}

main();
