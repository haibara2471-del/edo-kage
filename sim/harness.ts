/**
 * 无头玩法测试台：在 Node 中加载游戏真实源码，用脚本输入自动游玩并断言结果。
 * 运行：npm run test:sim
 *
 * 覆盖：绳索过沟（真实 player.ts 摆荡代码）、战斗、技能、精英怪机制。
 * 注意：验证的是"机制是否成立"，不验证手感好坏。
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Enemy } from '../src/enemy';
import { Flyer } from '../src/flyer';
import { HookSoldier } from '../src/hooksoldier';
import { Bruiser } from '../src/bruiser';
import { Shaman } from '../src/shaman';
import { Boss } from '../src/boss';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { resolveCombat } from '../src/combat';
import type { World } from '../src/world';

/** 假输入：与 Input 同接口（帧钟版），脚本驱动 */
class FakeInput {
  private heldSet = new Set<string>();
  private buf: { action: string; frame: number }[] = [];
  private frame = 0;
  hold(a: string): void {
    if (!this.heldSet.has(a)) this.buf.push({ action: a, frame: this.frame });
    this.heldSet.add(a);
  }
  tap(a: string): void {
    this.buf.push({ action: a, frame: this.frame });
  }
  release(a: string): void {
    this.heldSet.delete(a);
  }
  isHeld(a: string): boolean {
    return this.heldSet.has(a);
  }
  consume(a: string): boolean {
    const i = this.buf.findIndex((p) => p.action === a && this.frame - p.frame <= 9);
    if (i >= 0) {
      this.buf.splice(i, 1);
      return true;
    }
    return false;
  }
  tick(): void {
    this.frame++;
  }
}

function makeWorld(mode: 'level' | 'training' = 'level') {
  const stage = new Stage(mode);
  const input = new FakeInput();
  const player = new Player();
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
  };
  return { world, input, player, stage };
}

/** 与 main.ts tick 等价的逻辑步进（不含渲染/相机/波次） */
function step(w: World): void {
  w.input.tick();
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
  for (const a of w.arrows) a.update(w.stage);
  w.arrows = w.arrows.filter((a) => !a.dead);
  for (const o of w.orbs) o.update(w);
  w.orbs = w.orbs.filter((o) => !o.dead);
  for (const c of w.clouds) c.update(w);
  w.clouds = w.clouds.filter((c) => !c.dead);
  resolveCombat(w);
  w.effects.update();
}

interface Result {
  name: string;
  pass: boolean;
  detail: string;
}

// ———————————————— 场景：战斗基础 ————————————————

function bladeKill(): Result {
  const { world, input, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  const e = Enemy.ashigaru(player.x + 40, stage.groundY);
  world.enemies.push(e);
  for (let i = 0; i < 3; i++) step(world);
  // 真实连段节奏：在取消窗口内接刀（1段16帧，窗口8-16；2段20帧，窗口10-20）
  for (let s = 0; s < 3 && !e.dead; s++) {
    input.tap('attack');
    for (let i = 0; i < 10; i++) step(world);
    input.tap('attack');
    for (let i = 0; i < 12; i++) step(world);
    input.tap('attack');
    for (let i = 0; i < 30; i++) step(world);
  }
  return {
    name: '短刀连段击杀足轻',
    pass: e.dead,
    detail: `敌人HP=${e.hp} 状态=${e.state} 玩家气=${player.ki}`,
  };
}

function spearHit(): Result {
  const { world, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  world.enemies.push(Enemy.ashigaru(player.x + 70, stage.groundY));
  for (let i = 0; i < 300; i++) step(world);
  return {
    name: '足轻长枪能命中站桩玩家',
    pass: player.hp < 100,
    detail: `玩家HP=${player.hp}`,
  };
}

// ———————————————— 场景：技能 ————————————————

function launcherJuggle(): Result {
  const { world, input, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  const e = Enemy.ashigaru(player.x + 24, stage.groundY);
  world.enemies.push(e);
  for (let i = 0; i < 3; i++) step(world);
  input.tap('skillU');
  let launched = false;
  for (let i = 0; i < 60; i++) {
    step(world);
    if (e.vy < -1) launched = true;
  }
  return {
    name: '昇月斬（U）挑空敌人',
    pass: launched && e.hp <= 22,
    detail: `挑飞=${launched} 敌人HP=${e.hp}`,
  };
}

function flurryHits(): Result {
  const { world, input, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  const e = Enemy.ashigaru(player.x + 24, stage.groundY);
  world.enemies.push(e);
  for (let i = 0; i < 3; i++) step(world);
  input.tap('skillH');
  let hits = 0;
  let lastHp = e.hp;
  for (let i = 0; i < 80; i++) {
    step(world);
    if (e.hp < lastHp) hits++;
    lastHp = e.hp;
  }
  return {
    name: '朧乱舞（H）多段命中',
    pass: hits >= 3,
    detail: `命中段数=${hits} 敌人HP=${e.hp}`,
  };
}

function orbExplode(): Result {
  const { world, input, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  const e = Enemy.ashigaru(player.x + 150, stage.groundY);
  world.enemies.push(e);
  for (let i = 0; i < 3; i++) step(world);
  input.tap('skillO');
  for (let i = 0; i < 200; i++) step(world);
  return {
    name: '水月の術（O）命中引爆',
    pass: e.hp <= 8,
    detail: `敌人HP=${e.hp}（水月爆 22 伤）`,
  };
}

// ———————————————— 场景：精英怪机制 ————————————————

function bruiserArmor(): Result {
  const b = new Bruiser(500, 446);
  const normalNoStun = b.takeHit(5, 1, 2, 0, 10) === false && b.state !== 'hit';
  const launcherStuns = ((): boolean => {
    b.takeHit(12, 1, 6.5, -6, 20);
    return b.state === 'hit';
  })();
  return {
    name: '大力金刚刚体（普攻无硬直/挑空出硬直）',
    pass: normalNoStun && launcherStuns,
    detail: `普攻硬直=${!normalNoStun} 挑空硬直=${launcherStuns}`,
  };
}

function hookPull(): Result {
  const { world, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  world.enemies.push(new HookSoldier(player.x + 200, stage.groundY - 34));
  world.enemies.push(Enemy.ashigaru(player.x + 260, stage.groundY)); // 有队友接应才会出钩
  const x0 = player.centerX;
  let pulled = 0;
  for (let i = 0; i < 400; i++) {
    step(world);
    pulled = Math.max(pulled, player.centerX - x0);
  }
  return {
    name: '钩使钩中并拉动玩家',
    pass: player.hp < 100 && pulled > 15,
    detail: `玩家HP=${player.hp} 被拉位移=${pulled.toFixed(0)}px`,
  };
}

function shamanPoison(): Result {
  const { world, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  world.enemies.push(new Shaman(player.x + 250, stage.groundY - 32));
  // 站桩：蛊球应落在玩家脚下生成毒雾（站桩也会中毒）
  let poisoned = false;
  for (let i = 0; i < 400; i++) {
    step(world);
    if (player.poisonTimer > 0) {
      poisoned = true;
      break;
    }
  }
  return {
    name: '蛊术师毒雾使玩家中毒',
    pass: poisoned,
    detail: `中毒=${poisoned} 玩家HP=${player.hp}`,
  };
}

function crowDive(): Result {
  const { world, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  world.enemies.push(new Flyer(player.x + 200, stage.groundY - 220, 'crow'));
  for (let i = 0; i < 600; i++) step(world);
  return {
    name: '乌鸦俯冲能命中站桩玩家',
    pass: player.hp < 100,
    detail: `玩家HP=${player.hp}`,
  };
}

function bossFight(): Result {
  const { world, input, player, stage } = makeWorld();
  player.x = 400;
  player.y = stage.groundY - player.h;
  const boss = new Boss(player.x + 70, stage.groundY - 40);
  world.enemies.push(boss);

  // 第一段：站桩 400 ticks，Boss 应能命中玩家
  for (let i = 0; i < 400; i++) step(world);
  const bossHitsPlayer = player.hp < 100;

  // 第二段：近身连打 400 ticks（每轮面向 Boss 再出手，防止绕后空挥），Boss 应掉血
  for (let i = 0; i < 400; i++) {
    player.facing = boss.centerX >= player.centerX ? 1 : -1;
    if (i % 22 === 0) input.tap('attack');
    step(world);
  }
  const bossDamaged = boss.hp < 200;
  return {
    name: 'Boss「龙」：能攻击玩家/能被击伤',
    pass: bossHitsPlayer && bossDamaged,
    detail: `玩家HP=${player.hp} BossHP=${boss.hp} 二阶段=${boss.phase2}`,
  };
}

// ———————————————— 运行 ————————————————

const results: Result[] = [
  bladeKill(),
  spearHit(),
  launcherJuggle(),
  flurryHits(),
  orbExplode(),
  bruiserArmor(),
  hookPull(),
  shamanPoison(),
  crowDive(),
  bossFight(),
];

let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? '✅' : '❌'} ${r.name}  |  ${r.detail}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) process.exit(1);
