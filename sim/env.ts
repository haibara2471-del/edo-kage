/**
 * RL 环境包装：把真实游戏代码包成 gym 风格环境。
 * 观测 ~40 维向量 / 14 个离散动作 / 每 step = 1 逻辑帧（60Hz）
 */
import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Enemy } from '../src/enemy';
import { Boss } from '../src/boss';
import { Flyer } from '../src/flyer';
import { Archer } from '../src/archer';
import { HookSoldier } from '../src/hooksoldier';
import { Bruiser } from '../src/bruiser';
import { Shaman } from '../src/shaman';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { resolveCombat } from '../src/combat';
import { reseed } from '../src/rng';
import type { World } from '../src/world';

export type Scenario = 'ashigaru' | 'wave1' | 'waves' | 'boss';

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

/** 技能气耗（与 player.ts 一致），用于空放惩罚 */
const SKILL_COSTS: Record<string, number> = {
  shuriken: 10,
  skillU: 10,
  skillH: 20,
  skillO: 25,
};

function maxTicks(scenario: Scenario): number {
  switch (scenario) {
    case 'ashigaru': return 1800;
    case 'wave1': return 3000;
    case 'waves': return 5400;
    case 'boss': return 3600;
  }
}

export class GameEnv {
  readonly obsSize = OBS_SIZE;
  readonly actionCount = ACTIONS.length;

  private world!: World;
  private input!: EnvInput;
  private player!: Player;
  private t = 0;
  private waveIdx = 0;
  private prevPlayerHp = 100;
  private prevEnemyTotalHp = 0;
  private prevEnemiesAlive = 0;
  private prevDist = 0;
  private totalKills = 0;
  private recentDmg: number[] = []; // 最近 45 帧内每帧造成的伤害（combo 计量）
  private comboPeak = 0;

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
    this.waveIdx = 0;

    if (this.scenario === 'ashigaru') {
      world.enemies.push(Enemy.ashigaru(this.player.x + 90, stage.groundY));
    } else if (this.scenario === 'wave1') {
      for (let i = 0; i < 3; i++) {
        world.enemies.push(Enemy.ashigaru(this.player.x + 140 + i * 120, stage.groundY));
      }
    } else if (this.scenario === 'waves') {
      this.spawnWave(1);
    } else if (this.scenario === 'boss') {
      world.enemies.push(new Boss(this.player.x + 90, stage.groundY - 40));
    }

    this.t = 0;
    this.prevPlayerHp = this.player.hp;
    this.prevEnemyTotalHp = this.enemyTotalHp();
    this.prevEnemiesAlive = world.enemies.length;
    this.prevDist = this.nearestEnemyDist();
    this.totalKills = 0;
    this.recentDmg = [];
    this.comboPeak = 0;
    return this.observe();
  }

  /** 正式三波阵容（与 waves.ts 一致） */
  private spawnWave(idx: number): void {
    this.waveIdx = idx;
    const stage = this.world.stage;
    const px = this.player.centerX;
    const gy = stage.groundY;
    const E = this.world.enemies;
    if (idx === 1) {
      for (let i = 0; i < 3; i++) E.push(Enemy.ashigaru(px + 140 + i * 120, gy));
    } else if (idx === 2) {
      for (let i = 0; i < 3; i++) E.push(Enemy.ashigaru(px + 120 + i * 130, gy));
      E.push(new Flyer(px + 240, gy - 220, 'crow'));
      E.push(new Archer(px + 300, gy - 34));
      E.push(new HookSoldier(px + 380, gy - 34));
    } else if (idx === 3) {
      for (let i = 0; i < 2; i++) E.push(Enemy.ashigaru(px + 120 + i * 140, gy));
      E.push(new Flyer(px + 220, gy - 160, 'bat'));
      E.push(new Archer(px + 320, gy - 34));
      E.push(new Bruiser(px + 260, gy - 46));
      E.push(new Shaman(px + 400, gy - 32));
    }
  }

  step(actionIdx: number): { obs: number[]; reward: number; done: boolean; info: Record<string, number> } {
    const input = this.input;
    const combo = ACTIONS[actionIdx] ?? [];
    const kiBefore = this.player.ki;

    // 帧跳跃：每个 agent 步 = 4 游戏帧（15Hz 决策，动作连贯、信用分配更稳）
    for (let f = 0; f < 4; f++) {
      input.beginTick();
      input.clearMomentary();
      if (f === 0) {
        // 映射动作：方向键为按住（整个步内），其余为首帧点按
        input.setHeld('left', combo.includes('left'));
        input.setHeld('right', combo.includes('right'));
        for (const a of combo) {
          if (a !== 'left' && a !== 'right') input.press(a);
        }
      }
      this.tick();
      if (this.player.state === 'dead') break;
    }

    // 空放惩罚：气不够还按技能（防"无脑扔镖"退化策略）
    let wasted = 0;
    for (const a of combo) {
      const cost = SKILL_COSTS[a];
      if (cost !== undefined && kiBefore < cost) wasted += 0.1;
    }

    // —— 奖励（四分项：伤害 / combo / 击杀 / 生存；受到伤害重罚） ——
    const enemyHp = this.enemyTotalHp();
    const dealt = Math.max(0, this.prevEnemyTotalHp - enemyHp);   // ① 造成伤害
    const taken = Math.max(0, this.prevPlayerHp - this.player.hp); // 承受伤害
    const dist = this.nearestEnemyDist();
    const approach = this.prevDist - dist;

    // ② combo：12 步窗口（≈0.8 秒）累计伤害 ≥15，持续期间每步 +0.3
    this.recentDmg.push(dealt);
    if (this.recentDmg.length > 12) this.recentDmg.shift();
    const windowDmg = this.recentDmg.reduce((s, d) => s + d, 0);
    const comboBonus = windowDmg >= 15 ? 0.3 : 0;
    this.comboPeak = Math.max(this.comboPeak, windowDmg);

    const enemiesAlive = this.world.enemies.length;
    const killsNow = Math.max(0, this.prevEnemiesAlive - enemiesAlive);
    this.totalKills += killsNow;                                     // ③ 击杀

    // 奖励权重：Boss 战需要强进攻引导（否则收敛到"全场遛狗不输出"的和平主义）
    const W =
      this.scenario === 'boss'
        ? { dealt: 1.5, taken: 0.5, kill: 50, farPenalty: 0.05 }
        : { dealt: 0.5, taken: 1.0, kill: 3, farPenalty: 0 };

    // ④ 生存：不设过程奖励（每帧给分=鼓励挂机），只在通关时按剩余血量给分
    let reward =
      dealt * W.dealt +     // ① 伤害
      comboBonus +           // ② combo
      killsNow * W.kill +    // ③ 击杀
      approach * 0.01 -      // 逼近引导
      taken * W.taken -      // 受到伤害
      (dist > 100 ? W.farPenalty : 0) - // Boss 战远离惩罚（反遛狗）
      wasted;                // 空放技能
    let done = false;

    if (this.player.state === 'dead') {
      reward -= 15;
      done = true;
    } else if (enemiesAlive === 0) {
      if (this.scenario === 'waves') {
        if (this.waveIdx < 3) {
          reward += 15;
          this.spawnWave(this.waveIdx + 1);
          this.prevEnemyTotalHp = this.enemyTotalHp();
        } else {
          reward += 40 + this.player.hp * 0.1; // 通关 + 剩余血量加成（生存能力给分）
          done = true;
        }
      } else {
        reward += 25 + this.player.hp * 0.1;
        done = true;
      }
    } else if (this.t >= maxTicks(this.scenario)) {
      reward -= 5;
      done = true;
    }

    this.prevPlayerHp = this.player.hp;
    this.prevEnemyTotalHp = this.enemyTotalHp();
    this.prevEnemiesAlive = enemiesAlive;
    this.prevDist = dist;

    return {
      obs: this.observe(),
      reward,
      done,
      info: {
        t: this.t, playerHp: this.player.hp, enemyHp, enemiesAlive, wave: this.waveIdx,
        kills: this.totalKills, comboPeak: this.comboPeak, takenCum: 100 - this.player.hp,
      },
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
