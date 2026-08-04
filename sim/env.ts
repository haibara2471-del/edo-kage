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
import { reseed, rand } from '../src/rng';
import { PlayerHittable } from '../src/player-hittable';
import type { World, Hittable } from '../src/world';
import * as ort from 'onnxruntime-node';

export type Scenario = 'ashigaru' | 'wave1' | 'waves' | 'boss' | 'bossEasy' | 'flyers' | 'bossSquad' | 'shurikenOnly' | 'random' | 'mirror';

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
  ['vamp'],                 // 10 吸血 buff
  ['left', 'attack'],       // 11
  ['right', 'attack'],      // 12
  ['left', 'jump'],         // 13
  ['right', 'jump'],        // 14
];

const OBS_SIZE = 42;

function maxTicks(scenario: Scenario): number {
  switch (scenario) {
    case 'ashigaru': return 1800;
    case 'wave1': return 3000;
    case 'waves': return 5400;
    case 'boss': return 7200; // Boss 战放宽（谨慎风格也需要时间磨 200 血）
    case 'bossEasy': return 5400;
    case 'flyers': return 3000;
    case 'bossSquad': return 7200;
    case 'shurikenOnly': return 2400;
    case 'random': return 3000;
    case 'mirror': return 2400;
  }
}

export class GameEnv {
  readonly obsSize = OBS_SIZE;
  readonly actionCount = ACTIONS.length;

  /** 镜像对手使用的 ONNX session（self-play 场景共享） */
  private static mirrorSession: ort.InferenceSession | null = null;
  static async setMirrorModel(path: string): Promise<void> {
    GameEnv.mirrorSession = await ort.InferenceSession.create(path);
  }

  private world!: World;
  private input!: EnvInput;
  private player!: Player;
  private mirror?: Player;
  private mirrorInput?: EnvInput;
  private t = 0;
  private waveIdx = 0;
  private advanceTarget = -1; // waves 场景：清波后需向右推进到此位置才刷下一波（对齐真实游戏）
  private prevCx = 0;
  private prevPlayerHp = 100;
  private prevEnemyTotalHp = 0;
  private prevEnemiesAlive = 0;
  private prevDist = 0;
  private totalKills = 0;
  private hitCount = 0;
  private prevState = '';
  private prevKi = 0;
  private recentDmg: number[] = []; // 最近 45 帧内每帧造成的伤害（combo 计量）
  private recentSrc: string[] = []; // 最近伤害来源（combo 多样性计量）
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
      lastHits: [],
    };
    this.world = world;

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
    } else if (this.scenario === 'bossEasy') {
      // 课程弱化版：100 血 / 残像 12% / 无二阶段
      world.enemies.push(new Boss(this.player.x + 90, stage.groundY - 40, { hp: 100, dodge: 0.12, noPhase2: true }));
    } else if (this.scenario === 'flyers') {
      // 专项：纯飞行局（补短板：打乌鸦）
      world.enemies.push(new Flyer(this.player.x - 180, stage.groundY - 220, 'crow'));
      world.enemies.push(new Flyer(this.player.x + 180, stage.groundY - 220, 'crow'));
      world.enemies.push(new Flyer(this.player.x, stage.groundY - 200, 'bat'));
    } else if (this.scenario === 'bossSquad') {
      // 专项：真 Boss 团战（Boss + 双钩使）
      const cx = 2530;
      world.enemies.push(new Boss(cx + 100, stage.groundY - 40));
      world.enemies.push(new HookSoldier(cx - 120, stage.groundY - 34));
      world.enemies.push(new HookSoldier(cx + 220, stage.groundY - 34));
      this.player.x = 2370;
      this.player.y = 300;
    } else if (this.scenario === 'shurikenOnly') {
      // 专项：纯镖打鸟（逼它学会用手里剑对空）
      world.enemies.push(new Flyer(this.player.x - 160, stage.groundY - 220, 'crow', { passive: true }));
      world.enemies.push(new Flyer(this.player.x + 160, stage.groundY - 220, 'crow', { passive: true }));
      // 不刷近战怪，逼它必须用镖
    } else if (this.scenario === 'random') {
      // 随机战斗课程：2~5 个敌人，类型/方向/距离全随机，覆盖全部 8 类敌人
      // （足轻加权，保证多数对局可打；金刚/蛊师低频出现练反制）
      const count = 2 + Math.floor(rand() * 4); // 2..5
      const types = ['ashigaru', 'ashigaru', 'ashigaru', 'archer', 'hook', 'crow', 'bat', 'bruiser', 'shaman'] as const;
      for (let i = 0; i < count; i++) {
        const type = types[Math.floor(rand() * types.length)];
        const side = rand() < 0.5 ? -1 : 1;
        const dist = 220 + rand() * 380; // 220..600
        const x = this.player.x + side * dist;
        if (type === 'ashigaru') {
          world.enemies.push(Enemy.ashigaru(x, stage.groundY));
        } else if (type === 'archer') {
          world.enemies.push(new Archer(x, stage.groundY - 34));
        } else if (type === 'hook') {
          world.enemies.push(new HookSoldier(x, stage.groundY - 34));
        } else if (type === 'crow') {
          world.enemies.push(new Flyer(x, stage.groundY - 200 - rand() * 60, 'crow'));
        } else if (type === 'bat') {
          world.enemies.push(new Flyer(x, stage.groundY - 170 - rand() * 50, 'bat'));
        } else if (type === 'bruiser') {
          world.enemies.push(new Bruiser(x, stage.groundY - 46));
        } else if (type === 'shaman') {
          world.enemies.push(new Shaman(x, stage.groundY - 32));
        }
      }
    } else if (this.scenario === 'mirror') {
      // Self-play：主玩家 vs 镜像玩家（由固定 ONNX 模型控制）
      this.mirror = new Player();
      this.mirror.x = this.player.x + 360;
      this.mirror.y = stage.groundY - this.mirror.h;
      this.mirror.facing = -1;
      this.mirrorInput = new EnvInput();
      world.enemies.push(new PlayerHittable(this.mirror, this.mirrorInput, world));
    }

    this.t = 0;
    this.advanceTarget = -1;
    this.prevCx = this.player.centerX;
    this.prevPlayerHp = this.player.hp;
    this.prevKi = this.player.ki;
    this.prevEnemyTotalHp = this.enemyTotalHp();
    this.prevEnemiesAlive = world.enemies.length;
    this.prevDist = this.nearestEnemyDist();
    this.totalKills = 0;
    this.hitCount = 0;
    this.prevState = this.player.state;
    this.recentDmg = [];
    this.recentSrc = [];
    this.comboPeak = 0;
    return this.observe();
  }

  /** 正式三波阵容（两侧散开，距离与 waves.ts 的 ±420 一致，可逐个击破） */
  private spawnWave(idx: number): void {
    this.waveIdx = idx;
    const stage = this.world.stage;
    const px = this.player.centerX;
    const gy = stage.groundY;
    const E = this.world.enemies;
    const both = (i: number): number => px + (i % 2 === 0 ? -1 : 1) * (400 + i * 80);
    if (idx === 1) {
      for (let i = 0; i < 3; i++) E.push(Enemy.ashigaru(both(i), gy));
    } else if (idx === 2) {
      for (let i = 0; i < 3; i++) E.push(Enemy.ashigaru(both(i), gy));
      E.push(new Flyer(px - 240, gy - 220, 'crow'));
      E.push(new Archer(px + 300, gy - 34));
      E.push(new HookSoldier(px + 380, gy - 34));
    } else if (idx === 3) {
      for (let i = 0; i < 2; i++) E.push(Enemy.ashigaru(both(i), gy));
      E.push(new Flyer(px + 220, gy - 160, 'bat'));
      E.push(new Archer(px - 320, gy - 34));
      E.push(new Bruiser(px + 260, gy - 46));
      E.push(new Shaman(px + 400, gy - 32));
    }
  }

  async step(actionIdx: number): Promise<{ obs: number[]; reward: number; done: boolean; info: Record<string, number> }> {
    const input = this.input;
    const combo = ACTIONS[actionIdx] ?? [];

    // Self-play：每步先推理镜像对手动作
    if (this.scenario === 'mirror' && this.mirror && this.mirrorInput && GameEnv.mirrorSession) {
      const mirrorObs = this.observeFor(this.mirror, [new PlayerHittable(this.player, this.input, this.world)]);
      const mirrorAction = await this.inferMirror(mirrorObs);
      const mc = ACTIONS[mirrorAction] ?? [];
      this.mirrorInput.beginTick();
      this.mirrorInput.clearMomentary();
      this.mirrorInput.setHeld('left', mc.includes('left'));
      this.mirrorInput.setHeld('right', mc.includes('right'));
      for (const a of mc) {
        if (a !== 'left' && a !== 'right') this.mirrorInput.press(a);
      }
    }

    // 帧跳跃：一般场景 4 帧/步（15Hz）；Boss 战 2 帧/步（30Hz，残像/连招需要更细的反应粒度）
    const frames = this.scenario === 'boss' ? 2 : 4;
    for (let f = 0; f < frames; f++) {
      input.beginTick();
      input.clearMomentary();
      if (this.mirrorInput) {
        this.mirrorInput.beginTick();
        this.mirrorInput.clearMomentary();
      }
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

    // —— 胜利导向 Reward（v0.42）：重赏击杀/通关/生存，重罚承伤/死亡 ——
    const enemyHp = this.enemyTotalHp();
    const dealt = Math.max(0, this.prevEnemyTotalHp - enemyHp);
    this.recentDmg.push(dealt);
    if (this.recentDmg.length > 12) this.recentDmg.shift();
    const windowDmg = this.recentDmg.reduce((s, d) => s + d, 0);

    const hits = this.world.lastHits;
    let bladeDmg = 0;
    let skillDmg = 0;
    for (const h of hits) {
      if (h.src === 'blade') bladeDmg += h.dmg;
      else skillDmg += h.dmg;
    }
    this.world.lastHits = [];
    const damageReward = bladeDmg * 1.0 + skillDmg * 0.5;

    const taken = Math.max(0, this.prevPlayerHp - this.player.hp);
    const hpRatio = Math.max(0.1, this.player.hp / 100);
    const damageScale = 1 + 2 * (1 - hpRatio); // 满血 1x / 半血 2x / 残血 3x
    const takenPenalty = taken * 0.05 * damageScale; // 基础 0.1→0.05：v0.36 已记录 0.1 抑制近战换血

    const enemiesAlive = this.world.enemies.length;
    const killsNow = Math.max(0, this.prevEnemiesAlive - enemiesAlive);
    this.totalKills += killsNow;

    const inactivityPenalty = (enemiesAlive > 0 && windowDmg < 0.1) ? -0.03 : 0;

    let reward =
      damageReward +       // 输出伤害（刀/技能/飞镖）
      killsNow * 50 -      // 击杀重赏（+100→+50：与伤害 ~900 同量级，避免击杀尖峰在 norm_reward 下压灭 dense 信号）
      takenPenalty +       // 承伤惩罚：与剩余血量反比（满血1x/半血2x/残血3x）
      -0.05 * frames +     // ★ 时间惩罚符号修复：v0.42 误写为 +0.05*frames（存活奖励），实为 -0.2/步，逼 AI 尽快清场而非蹲到 timeout
      inactivityPenalty;   // 活跃惩罚：防站桩
    let done = false;

    if (this.player.state === 'dead') {
      reward -= 50; // 死亡重罚
      done = true;
    } else if (enemiesAlive === 0) {
      if (this.scenario === 'waves') {
        if (this.waveIdx < 3) {
          // 清波后要求向右推进触发下一波（环境构成，与 reward 无关）
          this.advanceTarget = this.player.centerX + 260;
        } else {
          reward += 50 + this.player.hp * 0.02; // 通关重赏 + 剩余血量加成
          done = true;
        }
      } else {
        reward += 50 + this.player.hp * 0.02; // 通关重赏
        done = true;
      }
    } else if (this.t >= maxTicks(this.scenario)) {
      reward -= 50; // timeout = fail
      done = true;
    }

    // waves 推进阶段（环境构成）：到达即刷下一波
    if (!done && this.scenario === 'waves' && this.advanceTarget > 0) {
      if (this.player.centerX >= this.advanceTarget) {
        this.advanceTarget = -1;
        this.spawnWave(this.waveIdx + 1);
        this.prevEnemyTotalHp = this.enemyTotalHp();
      }
    }
    this.prevCx = this.player.centerX;
    this.prevState = this.player.state;

    this.prevPlayerHp = this.player.hp;
    this.prevKi = this.player.ki;
    this.prevEnemyTotalHp = this.enemyTotalHp();
    this.prevEnemiesAlive = enemiesAlive;
    const dist = this.nearestEnemyDist();
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

  private async inferMirror(obs: number[]): Promise<number> {
    if (!GameEnv.mirrorSession) return 0;
    const tensor = new ort.Tensor('float32', new Float32Array(obs), [1, obs.length]);
    const results = await GameEnv.mirrorSession.run({ obs: tensor });
    const data = results.action.data as Int32Array | BigInt64Array;
    const action = typeof data[0] === 'bigint' ? Number(data[0]) : data[0];
    return action;
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
    for (const a of w.arrows) a.update(w);
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
    return this.observeFor(this.player, this.world.enemies);
  }

  private observeFor(p: Player, enemies: Hittable[]): number[] {
    const w = this.world;
    const obs: number[] = [
      p.x / 2750, p.y / 540, p.vx / 10, p.vy / 10,
      p.hp / 100, p.ki / 100, p.facing, p.onGround ? 1 : 0,
      p.dashCd / 45, p.poisonTimer / 120,
      w.projectiles.length / 6, w.arrows.length / 6, w.orbs.length,
      p.ki >= 10 ? 1 : 0,  // 气足够扔镖（对空 affordance）
      0,                    // 14: 头顶有敌人标志（下面填）
      0,                    // 15: 最近敌人在近战/技能可达范围（下面填）
      0,                    // 16: 最近敌人在手里剑扇形可达范围（下面填）
    ];

    // 最近 3 个敌人：[相对x, 相对y, 血量比, 类型码, 状态码] × 3
    const typeCode = (id: string): number =>
      ({ ashigaru: 1, archer: 2, hook: 3, bruiser: 4, shaman: 5, crow: 6, bat: 7, boss: 8 })[id] ?? 0;
    const stateCode = (s: string): number =>
      ({ idle: 1, chase: 2, windup: 3, thrust: 4, recover: 5, hit: 6, telegraph: 7, dive: 8, climb: 9, aim: 10, combo: 11, dashWindup: 12, dashKick: 13, rising: 14, sweepWindup: 15, sweep: 16 })[s] ?? 0;

    const sorted = [...enemies]
      .filter((e) => !e.dead)
      .sort((a, b) => Math.abs(a.centerX - p.centerX) - Math.abs(b.centerX - p.centerX))
      .slice(0, 2);
    const nearest = sorted[0];
    const airborne = sorted.some((e) => e.centerY < p.centerY - 80) ? 1 : 0;
    obs[14] = airborne; // 头顶有敌人（高度差 >80px，需要远程/跳跃）

    // Affordance：帮助策略把“位置对齐”转化为“出手”，只描述几何可达性
    if (nearest) {
      const dx = nearest.centerX - p.centerX;
      const dy = nearest.centerY - p.centerY;
      const inFront = dx * p.facing >= -5;
      // 刀/昇月斬/朧乱舞综合可达：水平约 45px、纵向 -35~+40
      obs[15] = (inFront && Math.abs(dx) <= 45 && dy >= -35 && dy <= 40) ? 1 : 0;
      // 手里剑扇形可达：玩家前方中远距离、纵向从地面到高空
      obs[16] = (dx * p.facing > 0 && Math.abs(dx) >= 20 && Math.abs(dx) <= 450 && dy >= -240 && dy <= 60) ? 1 : 0;
    }
    // 最近 2 个敌人 × 7 维：[相对x, 相对y, 血比, 类别, 状态, vx, vy, 面向]
    for (let i = 0; i < 2; i++) {
      const e = sorted[i];
      if (e) {
        obs.push(
          Math.max(-1, Math.min(1, (e.centerX - p.centerX) / 300)),
          Math.max(-1, Math.min(1, (e.centerY - p.centerY) / 300)),
          Math.max(0, (e as { hp?: number }).hp ?? 0) / ((e as { maxHp?: number }).maxHp ?? 100),
          typeCode(e.codexId) / 8,
          stateCode((e as { state?: string }).state ?? '') / 16,
          Math.max(-1, Math.min(1, (e as { vx?: number }).vx ?? 0) / 5),
          Math.max(-1, Math.min(1, (e as { vy?: number }).vy ?? 0) / 5),
          (e as { facing?: number }).facing ?? 0,
        );
      } else {
        obs.push(0, 0, 0, 0, 0, 0, 0);
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

    // 战场态势（7 维）
    const enemiesLeft = enemies.some((e) => !e.dead && e.centerX < p.centerX) ? 1 : 0;
    const enemiesRight = enemies.some((e) => !e.dead && e.centerX >= p.centerX) ? 1 : 0;
    const airCount = Math.min(5, enemies.filter((e) => !e.dead && e.centerY < p.centerY - 80).length) / 5;
    const remaining = Math.min(10, enemies.length) / 10;
    const wave = this.scenario === 'waves' ? this.waveIdx / 3 : 0;
    const advance = this.advanceTarget > 0 ? (this.advanceTarget - p.centerX) / 1000 : -1;
    let nearestDist = 0;
    for (const e of enemies) {
      const d = Math.abs(e.centerX - p.centerX);
      if (d < nearestDist || nearestDist === 0) nearestDist = d;
    }
    nearestDist = Math.min(1000, nearestDist) / 1000;
    obs.push(remaining, wave, enemiesLeft, enemiesRight, airCount, nearestDist, advance);

    while (obs.length < OBS_SIZE) obs.push(0);
    return obs.slice(0, OBS_SIZE);
  }
}
