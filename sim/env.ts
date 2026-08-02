/**
 * RL 环境包装：把真实游戏代码包成 gym 风格环境。
 * 观测 ~40 维向量 / 14 个离散动作 / 每 step = 1 逻辑帧（60Hz）
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Enemy } from '../src/enemy';
import { Boss } from '../src/boss';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { resolveCombat } from '../src/combat';
import { reseed } from '../src/rng';
import type { World } from '../src/world';

export type Scenario = 'ashigaru' | 'wave1' | 'boss';

/** 直接注入式输入（每帧可设置按住集合 + 点按） */
class EnvInput {
  private heldSet = new Set<string>();
  private buf: { action: string; frame: number }[] = [];
  private frame = 0;

  beginTick(): void {
    this.frame++;
    this.buf = this.buf.filter((p) => this.frame - p.frame <= 9);
  }
  setHeld(a: string, on: boolean): void {
    if (on) this.heldSet.add(a);
    else this.heldSet.delete(a);
  }
  press(a: string): void {
    this.buf.push({ action: a, frame: this.frame - 1 }); // 视同上一帧按下，本帧可被消费
    this.heldSet.add(a);
  }
  clearMomentary(): void {
    for (const a of ['jump', 'attack', 'shuriken', 'dash', 'skillU', 'skillH', 'skillO', 'codex']) {
      this.heldSet.delete(a);
    }
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
  tick(): void { /* beginTick 代替 */ }
}

export const ACTIONS: string[][] = [
  [],                       // 0 无操作
  ['left'],                 // 1
  ['right'],                // 2
  ['jump'],                 // 3
  ['attack'],               // 4
  ['shuriken'],             // 5
  ['dash'],                 // 6
  ['skillU'],               // 7
  ['skillH'],               // 8
  ['skillO'],               // 9
  ['left', 'attack'],       // 10
  ['right', 'attack'],      // 11
  ['left', 'jump'],         // 12
  ['right', 'jump'],        // 13
];

const OBS_SIZE = 42;
const MAX_TICKS = 1800; // 30 秒上限

export class GameEnv {
  readonly obsSize = OBS_SIZE;
  readonly actionCount = ACTIONS.length;

  private world!: World;
  private input!: EnvInput;
  private player!: Player;
  private t = 0;
  private prevPlayerHp = 100;
  private prevEnemyTotalHp = 0;
  private prevDist = 0;

  constructor(private scenario: Scenario) {}

  reset(seed = 1): number[] {
    reseed(seed);
    const stage = new Stage();
    this.input = new EnvInput();
    this.player = new Player();
    this.player.x = 400;
    this.player.y = stage.groundY - this.player.h;

    const world: World = {
      input: this.input as never,
      effects: new Effects(),
      stage,
      player: this.player,
      enemies: [],
      projectiles: [],
      arrows: [],
      orbs: [],
      clouds: [],
      codex: new Codex(),
      camX: 0,
    };
    this.world = world;

    if (this.scenario === 'ashigaru') {
      world.enemies.push(Enemy.ashigaru(this.player.x + 90, stage.groundY));
    } else if (this.scenario === 'wave1') {
      for (let i = 0; i < 3; i++) {
        world.enemies.push(Enemy.ashigaru(this.player.x + 140 + i * 120, stage.groundY));
      }
    } else if (this.scenario === 'boss') {
      world.enemies.push(new Boss(this.player.x + 90, stage.groundY - 40));
    }

    this.t = 0;
    this.prevPlayerHp = this.player.hp;
    this.prevEnemyTotalHp = this.enemyTotalHp();
    this.prevDist = this.nearestEnemyDist();
    return this.observe();
  }

  step(actionIdx: number): { obs: number[]; reward: number; done: boolean; info: Record<string, number> } {
    const input = this.input;
    input.beginTick();
    input.clearMomentary();

    // 映射动作：方向键为按住，其余为点按
    const combo = ACTIONS[actionIdx] ?? [];
    input.setHeld('left', combo.includes('left'));
    input.setHeld('right', combo.includes('right'));
    for (const a of combo) {
      if (a !== 'left' && a !== 'right') input.press(a);
    }

    this.tick();

    // —— 奖励 ——
    const enemyHp = this.enemyTotalHp();
    const dealt = Math.max(0, this.prevEnemyTotalHp - enemyHp);
    const taken = Math.max(0, this.prevPlayerHp - this.player.hp);
    const dist = this.nearestEnemyDist();
    const approach = this.prevDist - dist; // >0 表示拉近了

    let reward = dealt * 0.6 - taken * 0.6 + approach * 0.01 - 0.01;
    const enemiesAlive = this.world.enemies.length;
    let done = false;

    if (this.player.state === 'dead') {
      reward -= 15;
      done = true;
    } else if (enemiesAlive === 0) {
      reward += 25;
      done = true;
    } else if (this.t >= MAX_TICKS) {
      reward -= 5;
      done = true;
    }

    this.prevPlayerHp = this.player.hp;
    this.prevEnemyTotalHp = enemyHp;
    this.prevDist = dist;

    return {
      obs: this.observe(),
      reward,
      done,
      info: { t: this.t, playerHp: this.player.hp, enemyHp, enemiesAlive },
    };
  }

  private tick(): void {
    const w = this.world;
    this.t++;
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

  private enemyTotalHp(): number {
    return this.world.enemies.reduce((s, e) => s + Math.max(0, (e as { hp?: number }).hp ?? 0), 0);
  }

  private nearestEnemyDist(): number {
    let d = 9999;
    for (const e of this.world.enemies) {
      d = Math.min(d, Math.abs(e.centerX - this.player.centerX));
    }
    return d === 9999 ? 0 : d;
  }

  private observe(): number[] {
    const p = this.player;
    const w = this.world;
    const obs: number[] = [
      p.x / 2750, p.y / 540, p.vx / 10, p.vy / 10,
      p.hp / 100, p.ki / 100, p.facing, p.onGround ? 1 : 0,
      p.dashCd / 45, p.poisonTimer / 120,
      w.projectiles.length / 6, w.arrows.length / 6, w.orbs.length,
    ];

    // 最近 3 个敌人：[相对x, 相对y, 血量比, 类型码, 状态码] × 3
    const typeCode = (id: string): number =>
      ({ ashigaru: 1, archer: 2, hook: 3, bruiser: 4, shaman: 5, crow: 6, bat: 7, boss: 8 })[id] ?? 0;
    const stateCode = (s: string): number =>
      ({ idle: 1, chase: 2, windup: 3, thrust: 4, recover: 5, hit: 6, telegraph: 7, dive: 8, climb: 9, aim: 10, combo: 11, dashWindup: 12, dashKick: 13, rising: 14, sweepWindup: 15, sweep: 16 })[s] ?? 0;

    const sorted = [...w.enemies]
      .filter((e) => !e.dead)
      .sort((a, b) => Math.abs(a.centerX - p.centerX) - Math.abs(b.centerX - p.centerX))
      .slice(0, 3);
    for (let i = 0; i < 3; i++) {
      const e = sorted[i];
      if (e) {
        obs.push(
          Math.max(-1, Math.min(1, (e.centerX - p.centerX) / 300)),
          Math.max(-1, Math.min(1, (e.centerY - p.centerY) / 300)),
          Math.max(0, (e as { hp?: number }).hp ?? 0) / ((e as { maxHp?: number }).maxHp ?? 100),
          typeCode(e.codexId) / 8,
          stateCode((e as { state?: string }).state ?? '') / 16,
        );
      } else {
        obs.push(0, 0, 0, 0, 0);
      }
    }

    // 最近飞行道具（敌方）
    const projs = [...w.arrows, ...w.projectiles.map((s) => ({ x: s.x, y: s.y }))];
    let np: { x: number; y: number } | null = null;
    let nd = 1e9;
    for (const pr of projs) {
      const d = Math.hypot(pr.x - p.centerX, pr.y - p.centerY);
      if (d < nd) {
        nd = d;
        np = pr;
      }
    }
    obs.push(
      np ? Math.max(-1, Math.min(1, (np.x - p.centerX) / 300)) : 0,
      np ? Math.max(-1, Math.min(1, (np.y - p.centerY) / 300)) : 0,
    );

    while (obs.length < OBS_SIZE) obs.push(0);
    return obs.slice(0, OBS_SIZE);
  }
}
