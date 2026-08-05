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
  consumeDir(a: string): { consumed: boolean; dir: number } {
    return { consumed: this.consume(a), dir: 0 }; // AI 用当前朝向
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

/** 统一目标追踪（v0.46）：把 AI 带到目标攻击范围内，范围内归零交战自由。
 *  CHASE_RADIUS：目标（最近敌人）进入 300px（对齐 src/enemy.ts AGGRO_RANGE）追踪 reward 归零；
 *  路标目标（清场后 advanceTarget）半径=0，走到才停、到点刷下一波。
 *  CHASE_REWARD：范围外朝目标净靠近 +0.02/px、远离 -0.02/px。
 *  v0.46d：0.005 是苍蝇肉但对推进无感（推进段无战斗收益兜底，纯追踪 +1.3 被时间惩罚淹没）。
 *  0.02 账本：边界 300 下 waves 敌人 400px 走近到 300px 只 100px=+2（0.005 的 4 倍），
 *  占总收入 <2% 仍在引导级；推进段 260px=+5.2 看是否够到感知阈值。
 *  ★ 0.03 教训：走近 355px=+10.7 ≈ 击杀 15，模型把"贴到 300px"当目标 → 弓+钩崩。
 *  红线：战斗 reward（伤害/击杀/承伤/时间/活跃/通关）不动，只动追踪 K。 */
const CHASE_RADIUS = 300;
const CHASE_REWARD = 0.01;
/** 推进期（路标）追踪系数——一套追踪体系、按目标分档（v0.46f，σ 采样校准）：
 *  采样 random 课程真实 σ=5.5。战斗期 K=0.01 → "走近到 300px"归一化信号 0.17σ（安全方向指引，
 *  不主导战斗；0.02=0.34σ 已在主导边缘，0.03 崩弓+钩）。推进期清场后无战斗收益兜底，
 *  K=0.1 → 走完 260px 差异 3.4σ、终点 50px 仍 0.85σ（不走到底→半途）。单档是双档 K 相等时的
 *  退化形式，双档搜索空间含单档。战斗期/推进期只在 advanceTarget>0 处切换，互不污染。 */
const CHASE_REWARD_ADVANCE = 0.1;

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
    case 'random': return 3000; // v0.45c 隔离实验：回退 4800→3000（v0.45/v0.45b 两次带 4800 都崩战斗），保留推进分支
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
  private advanceTarget = -1; // 清波后需向右推进到此位置才刷下一波（对齐真实游戏）
  private allowAdvance = false; // 本局是否启用推进机制（waves / random 推进分支）
  private advanceWaves = 0;     // 本局总波数（waves=3，推进分支=2），清完最后一波才 done
  private wavesInEpisode = 0;   // 本局已刷波数（不依赖 waveIdx 编号，推进分支复用 wave1）
  private prevCx = 0;
  private prevTargetAbs = 0; // 上一帧到统一目标（最近敌/路标）的距离（追踪 reward 用）
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
    this.allowAdvance = false;
    this.advanceWaves = 0;
    this.wavesInEpisode = 0;
    this.advanceTarget = -1; // reset 开头无条件重置（random 前置推进分支稍后可能设路标）

    if (this.scenario === 'ashigaru') {
      world.enemies.push(Enemy.ashigaru(this.player.x + 90, stage.groundY));
    } else if (this.scenario === 'wave1') {
      for (let i = 0; i < 3; i++) {
        world.enemies.push(Enemy.ashigaru(this.player.x + 140 + i * 120, stage.groundY));
      }
    } else if (this.scenario === 'waves') {
      this.allowAdvance = true;
      this.advanceWaves = 3;
      this.spawnWave(1);
      this.wavesInEpisode = 1;
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
      // 随机课程 v0.46i（推进掺杂在各分支内部，不再独立分支）：
      // 每局先抽一个战斗场景 C（单房间 wave1/2/3 / 弓+钩 / 对空 / 随机混合），再抽推进模式——
      //  纯战斗（50%）/ 后置推进（25%，打完 C → 推进到出怪点 → 再刷一波 C）/ 前置推进（25%，先推进到
      //  出怪点 → 刷 C → 打）。让模型学会"找战斗 / 打完跑路"，推进是战斗流程的一部分而非孤立分支。
      const pr = rand();
      if (pr < 0.5) {
        this.spawnCombat(); // 纯战斗：无推进
      } else if (pr < 0.75) {
        this.allowAdvance = true; // 后置推进：打 C → 清场 → 路标 → 再刷一波 C
        this.advanceWaves = 2;
        this.spawnCombat();
        this.wavesInEpisode = 1;
      } else {
        this.allowAdvance = true; // 前置推进：先走到路标（出怪点）→ 刷 C → 打。开局无敌人，教"找战斗"
        this.advanceWaves = 1;
        this.advanceTarget = this.player.centerX + 300 + Math.floor(rand() * 500);
        this.wavesInEpisode = 0;
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
    this.prevCx = this.player.centerX;
    this.prevTargetAbs = Math.abs(
      this.advanceTarget > 0 ? this.advanceTarget - this.player.centerX : this.nearestEnemySignedDist(),
    );
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

  /** random 课程：抽一个随机战斗场景刷怪（单房间 wave1/2/3 / 弓+钩 / 对空 / 混合 3~6 敌） */
  private spawnCombat(): void {
    const stage = this.world.stage;
    const px = this.player.centerX;
    const gy = stage.groundY;
    const E = this.world.enemies;
    const r = rand();
    if (r < 0.30) {
      this.spawnWave([1, 2, 3][Math.floor(rand() * 3)]); // 单房间真实 wave1/2/3（30%，wave2/3 各 10%）
    } else if (r < 0.45) {
      const side = rand() < 0.5 ? -1 : 1;
      E.push(new Archer(px + side * 300, gy - 34));
      E.push(new HookSoldier(px + side * 430, gy - 34));
      for (let i = 0; i < 2; i++) E.push(Enemy.ashigaru(px - side * (220 + i * 110), gy));
    } else if (r < 0.70) {
      // 多目标混合对空（v0.46k 25%）：2 乌鸦+蝙蝠+2 足轻（地面+空中混合），练"多目标威胁优先级"。
      // 回放证据：模型会打纯乌鸦（shurikenOnly 100%），但 air/wave2 混合场景把乌鸦当低优先级忽略 → 被磨死。
      const side = rand() < 0.5 ? -1 : 1;
      E.push(new Flyer(px + side * 260, gy - 210, 'crow'));
      E.push(new Flyer(px - side * 300, gy - 190, 'crow'));
      E.push(new Flyer(px + side * 340, gy - 180, 'bat'));
      E.push(Enemy.ashigaru(px - side * 200, gy));
      E.push(Enemy.ashigaru(px + side * 200, gy));
    } else {
      const count = 3 + Math.floor(rand() * 4); // 3..6（对齐真实波次密度）
      const types = ['ashigaru', 'ashigaru', 'ashigaru', 'archer', 'hook', 'crow', 'bat', 'bruiser', 'shaman'] as const;
      for (let i = 0; i < count; i++) {
        const type = types[Math.floor(rand() * types.length)];
        const side = rand() < 0.5 ? -1 : 1;
        const dist = 220 + rand() * 380; // 220..600
        const x = px + side * dist;
        if (type === 'ashigaru') E.push(Enemy.ashigaru(x, gy));
        else if (type === 'archer') E.push(new Archer(x, gy - 34));
        else if (type === 'hook') E.push(new HookSoldier(x, gy - 34));
        else if (type === 'crow') E.push(new Flyer(x, gy - 200 - rand() * 60, 'crow'));
        else if (type === 'bat') E.push(new Flyer(x, gy - 170 - rand() * 50, 'bat'));
        else if (type === 'bruiser') E.push(new Bruiser(x, gy - 46));
        else if (type === 'shaman') E.push(new Shaman(x, gy - 32));
      }
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
    const takenPenalty = taken * 0.15; // 承伤 0.03→0.15（v0.44b）：v0.44 回放证明 0.03 无避伤梯度（脸接90伤只亏2.7），5× 造梯度；去残血放大，残局不吓退

    const enemiesAlive = this.world.enemies.length;
    const killsNow = Math.max(0, this.prevEnemiesAlive - enemiesAlive);
    this.totalKills += killsNow;

    const inactivityPenalty = (enemiesAlive > 0 && windowDmg < 0.1) ? -0.03 : 0;

    // 统一目标追踪 reward（v0.46）：战斗期目标=最近敌人，清场后=路标（advanceTarget）。
    // 目标在追踪半径外：朝目标净靠近 +0.03/px、远离 -0.03/px（把 AI 带到攻击范围内）；
    // 进入半径后归零，进攻/躲避交给战斗 reward（承伤/伤害/击杀），追踪不干预交战。
    // 路标目标半径=0：走到才停，到点刷下一波，然后目标自动切回新一波敌人。
    let chaseReward = 0;
    const targetSigned = this.advanceTarget > 0
      ? this.advanceTarget - this.player.centerX   // 路标（清场后）
      : this.nearestEnemySignedDist();             // 最近敌人（战斗期）
    const targetAbs = Math.abs(targetSigned);
    const chaseRadius = this.advanceTarget > 0 ? 0 : CHASE_RADIUS;
    if (targetAbs > chaseRadius) {
      const K = this.advanceTarget > 0 ? CHASE_REWARD_ADVANCE : CHASE_REWARD; // 推进期系数更大（无战斗收益兜底）
      chaseReward = (this.prevTargetAbs - targetAbs) * K;
    }

    let reward =
      damageReward +       // 输出伤害（刀/技能/飞镖）
      killsNow * 15 -      // 击杀 +50→+15（v0.44）：击杀尖峰不再压灭 dense 信号；收残敌边际 +15 vs 拖着=时间持续在亏
      takenPenalty +       // 承伤惩罚（v0.44b：0.03→0.15，无残血放大——造避伤梯度）
      -0.1 * frames +      // ★ 时间惩罚符号修复(v0.42)：v0.44 从 -0.05 提到 -0.1/帧（=-0.4/步），归一后不再形同虚设，逼 AI 终结而非拖延
      inactivityPenalty +  // 活跃惩罚：防站桩
      chaseReward;         // 统一目标追踪（v0.46）：范围外带到目标攻击范围内
    let done = false;

    if (this.player.state === 'dead') {
      reward -= 50; // 死亡重罚
      done = true;
    } else if (enemiesAlive === 0) {
      if (this.allowAdvance && this.wavesInEpisode < this.advanceWaves) {
        // 清波后要求向右推进触发下一波（环境构成，推进奖励激励右移）。
        // ★ 必须用 advanceTarget<0 守卫只设一次——否则每步都重设，目标永远追不上（原 bug）
        if (this.advanceTarget < 0) {
          // 推进距离随机化（v0.46g）：真局推进 400-900px 随清场位置多变（zone 间距 300/960 不等），
          // 固定 260px 教会"走固定距离"，出怪距离一变就失效。300~800 随机让模型学
          // "推进到出怪点（距离可变）"，对出怪距离鲁棒。
          this.advanceTarget = this.player.centerX + 300 + Math.floor(rand() * 500);
        }
      } else {
        reward += 50 + this.player.hp * 0.02; // 通关重赏 + 剩余血量加成
        done = true;
      }
    } else if (this.t >= maxTicks(this.scenario)) {
      reward -= 50; // timeout = fail
      done = true;
    }

    // 推进阶段（环境构成）：到达即刷下一波
    if (!done && this.allowAdvance && this.advanceTarget > 0) {
      if (this.player.centerX >= this.advanceTarget) {
        this.advanceTarget = -1;
        if (this.scenario === 'waves') {
          this.spawnWave(this.waveIdx + 1);
        } else {
          this.spawnCombat(); // random 课程：再刷一波随机战斗场景（v0.46i 推进掺杂在各分支内）
        }
        this.wavesInEpisode++;
        this.prevEnemyTotalHp = this.enemyTotalHp();
      }
    }
    this.prevCx = this.player.centerX;
    this.prevTargetAbs = targetAbs;
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

  /** 最近存活敌人的有符号水平距离（正=敌在右，负=敌在左）；无存活敌人返回 0（此时应已走清场→路标分支） */
  private nearestEnemySignedDist(): number {
    let best = 0;
    let bestAbs = 1e9;
    for (const e of this.world.enemies) {
      if (e.dead) continue;
      const d = e.centerX - this.player.centerX;
      const ad = Math.abs(d);
      if (ad < bestAbs) {
        bestAbs = ad;
        best = d;
      }
    }
    return bestAbs === 1e9 ? 0 : best;
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
        obs.push(0, 0, 0, 0, 0, 0, 0, 0);
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
