import { Input } from './input';
import { Effects } from './effects';
import { Stage } from './stage';
import { Player } from './player';
import { Waves } from './waves';
import { Tower } from './tower';
import { Title } from './title';
import { Codex } from './codex';
import { resolveCombat } from './combat';
import { drawHUD, drawBossBar } from './ui';
import { clamp } from './types';
import { reseed } from './rng';
import { reportRun, fetchRun } from './report';
import { ReplayInput } from './replay';
import { getPlayerName, setPlayerName } from './identity';
import { AiInput } from './ai';
import type { World } from './world';

const VIEW_W = 960;
const VIEW_H = 540;
const STEP = 1000 / 60; // 固定 60Hz 逻辑步进

const DEBUG = new URLSearchParams(location.search).has('debug');
const REPLAY_ID = new URLSearchParams(location.search).get('replay');
const AI_SPECTATE = new URLSearchParams(location.search).get('ai'); // 'boss' | 'waves' | null

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

let input: Input = new Input();
const humanInput = input;
let aiInput: AiInput | null = null;
const effects = new Effects();
const stage = new Stage();
const player = new Player();
const waves = new Waves();
const tower = new Tower();
const title = new Title();
const codex = new Codex();

const world: World = {
  input,
  effects,
  stage,
  player,
  enemies: [],
  projectiles: [],
  arrows: [],
  orbs: [],
  clouds: [],
  codex,
  camX: 0,
  lastHits: [],
};

type Mode = 'title' | 'play' | 'codex' | 'loading';
let mode: Mode = REPLAY_ID || AI_SPECTATE ? 'loading' : 'title';
let frameCount = 0;
let zenFlash = 0; // 「禅」密令触发提示

/** 本局随机种子（记录在案，回放可用同种子复现） */
const seed = (Math.random() * 0xffffffff) >>> 0;
reseed(seed);

let reported = false;
let deathDelay = -1;
let debugUsed = false; // 开过「禅」/传送/清场的局不上报（作弊局无统计价值）
let aiPlay = false;    // alibaba 观战模式（AI 代打，不上报）

let playerName = getPlayerName();
let nameBuf = '';

// 首次登记忍名：标题画面直接键入，Enter 确认
window.addEventListener('keydown', (e) => {
  if (mode !== 'title' || playerName) return;
  if (e.key === 'Enter') {
    if (nameBuf.trim()) {
      playerName = nameBuf.trim().slice(0, 12);
      setPlayerName(playerName);
    }
    return;
  }
  if (e.key === 'Backspace') {
    nameBuf = nameBuf.slice(0, -1);
    return;
  }
  if (e.key.length === 1 && nameBuf.length < 12 && !e.metaKey && !e.ctrlKey) {
    nameBuf += e.key;
  }
});

// 标题画面按 N 改名
window.addEventListener('keydown', (e) => {
  if (mode === 'title' && playerName && e.code === 'KeyN') {
    playerName = '';
    nameBuf = '';
  }
});

let replayInfo: { id: number; result: string; wave: number } | null = null;
let replayError = false;

if (REPLAY_ID) {
  void fetchRun(REPLAY_ID).then((run) => {
    if (!run) {
      replayError = true;
      return;
    }
    reseed(run.seed); // 同种子
    input = new ReplayInput(run.log); // 同输入
    world.input = input;
    replayInfo = { id: run.id, result: run.result, wave: run.wave };
    // 从标题画面开始回放：日志帧是绝对时间轴（含标题停留），
    // 记录的 J 键会在同一帧触发开局，保证敌人刷新与输入对齐
    mode = 'title';
  });
}

// AI 观战通道：?ai=boss → 直接 Boss 场 + AI 代打斩龙；?ai=waves → 全程代打
if (AI_SPECTATE) {
  void (async () => {
    try {
      const ai = new AiInput(world);
      aiPlay = true;
      if (AI_SPECTATE === 'boss') {
        // 直接开 Boss 战（借 Waves 的 spawnBoss 逻辑）
        world.enemies.length = 0;
        world.player.x = 2310 + 60;
        world.player.y = 300;
        const cx = 2310 + (2750 - 2310) / 2;
        const { Boss } = await import('./boss');
        const { HookSoldier } = await import('./hooksoldier');
        world.enemies.push(new Boss(cx + 100, stage.groundY - 40));
        world.enemies.push(new HookSoldier(cx - 120, stage.groundY - 34));
        world.enemies.push(new HookSoldier(cx + 220, stage.groundY - 34));
        waves.barrierL = 2310 + 12;
        waves.barrierX = 2750 - 12;
        await ai.init('models/ppo_boss.onnx');
      } else {
        await ai.init('models/ppo_waves.onnx');
      }
      world.input = ai;
      mode = 'play';
    } catch (e) {
      replayError = true;
      console.error('AI 加载失败', e);
    }
  })();
}

const zenBuf: { code: string; time: number }[] = [];

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && mode === 'play') location.reload();
  // 「禅」密令：2 秒内连按 Z-E-N 切换无敌（任何模式下可用，无需 debug）
  if (mode === 'play' && ['KeyZ', 'KeyE', 'KeyN'].includes(e.code)) {
    zenBuf.push({ code: e.code, time: performance.now() });
    if (zenBuf.length > 3) zenBuf.shift();
    const seq = zenBuf.map((k) => k.code).join(',');
    const recent = zenBuf.every((k) => performance.now() - k.time < 2000);
    if (seq === 'KeyZ,KeyE,KeyN' && recent) {
      player.god = !player.god;
      if (player.god) debugUsed = true;
      zenFlash = 90;
      zenBuf.length = 0;
    }
  }
  if (!DEBUG || mode !== 'play') return;
  // —— 开发者调试（?debug=1 显示 DEBUG 标记与 G 无敌）——
  if (e.code === 'KeyG') player.god = !player.god;   // 无敌开关（Z-E-N 也可）
  if (e.code === 'KeyP') {
    // P：切换 AI 代打/人工操作（方便试玩观察训练好的模型）
    if (!aiPlay) {
      if (!aiInput) {
        aiInput = new AiInput(world);
        void aiInput.init('models/ppo_waves.onnx');
      }
      world.input = aiInput;
      aiPlay = true;
      debugUsed = true;
      console.log('AI 代打开启');
    } else {
      world.input = humanInput;
      aiPlay = false;
      console.log('AI 代打关闭');
    }
  }
  if (e.code === 'KeyY') {
    // Y：回满血和气
    player.hp = 100;
    player.ki = 100;
    debugUsed = true;
  }
});

/** 传送/清场调试键：仅「禅」模式（Z-E-N 开启无敌）下生效，玩家无法使用 */
window.addEventListener('keydown', (e) => {
  if (mode !== 'play' || !player.god) return;
  debugUsed = true;
  const ZONES = [
    { x0: 0, x1: 1050 },
    { x0: 1350, x1: 1950 },
    { x0: 2310, x1: 2750 },
  ];
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    const zi = Number(e.code.slice(-1)) - 1;
    if (ZONES[zi]) {
      world.enemies.length = 0; // 传送并清场
      waves.startAtZone(world, zi); // 直接触发该战区波次（否则波次计数器不同步→"传送到第 N-1 波"）
      player.x = ZONES[zi].x0 + 60;
      player.y = 300;
      player.vx = 0;
      player.vy = 0;
      world.camX = clamp(player.centerX - VIEW_W / 2, 0, stage.width - VIEW_W);
    }
  }
  // 4/5/6/7：塔层跳转（真龙/橘右京/不知火舞/宫本武藏）
  if (e.code === 'Digit4' || e.code === 'Digit5' || e.code === 'Digit6' || e.code === 'Digit7') {
    const fi = Number(e.code.slice(-1)) - 4;
    world.enemies.length = 0;
    waves.enabled = false;
    waves.barrierX = null;
    waves.barrierL = null;
    tower.start(world, fi);
    world.camX = clamp(player.centerX - VIEW_W / 2, 0, stage.width - VIEW_W);
  }
  if (e.code === 'KeyN') world.enemies.length = 0; // 秒清当前波（测结界开门）
});

function tick(): void {
  world.input.tick();
  frameCount++;
  if (zenFlash > 0) zenFlash--;

  if (mode === 'loading') return;

  if (mode === 'title') {
    if (title.update(input)) {
      // 忍名 alibaba → AI 代打观战模式
      if (playerName.trim().toLowerCase() === 'alibaba') {
        const ai = new AiInput(world);
        void ai.init('models/ppo_waves.onnx');
        world.input = ai;
        aiPlay = true;
      }
      mode = 'play';
    }
    return;
  }

  if (mode === 'codex') {
    if (codex.update(input)) mode = 'play';
    return;
  }

  if (input.consume('codex')) {
    mode = 'codex';
    return;
  }

  // hit-stop：冻结世界逻辑，仅衰减特效
  if (effects.freeze > 0) {
    effects.freeze--;
    effects.update();
    return;
  }

  player.update(world);

  // 结界 / 塔竞技场：封锁左右（玩家和怪物都夹住，防止击退逃逸）
  const bL = tower.active ? tower.barrierL : waves.barrierL;
  const bR = tower.active ? tower.barrierR : waves.barrierX;
  if (bR !== null) {
    if (player.x + player.w > bR) {
      player.x = bR - player.w;
      if (player.vx > 0) player.vx = 0;
    }
    for (const e of world.enemies) {
      if (e.x + e.w > bR) {
        e.x = bR - e.w;
        if (e.vx > 0) e.vx = 0;
      }
    }
  }
  if (bL !== null) {
    if (player.x < bL) {
      player.x = bL;
      if (player.vx < 0) player.vx = 0;
    }
    for (const e of world.enemies) {
      if (e.x < bL) {
        e.x = bL;
        if (e.vx < 0) e.vx = 0;
      }
    }
  }

  for (const e of world.enemies) e.update(world);
  world.enemies = world.enemies.filter((e) => !e.removable);

  for (const p of world.projectiles) p.update(stage.width);
  world.projectiles = world.projectiles.filter((p) => !p.dead);

  for (const a of world.arrows) a.update(world);
  world.arrows = world.arrows.filter((a) => !a.dead);

  for (const o of world.orbs) o.update(world);
  world.orbs = world.orbs.filter((o) => !o.dead);

  for (const c of world.clouds) c.update(world);
  world.clouds = world.clouds.filter((c) => !c.dead);

  resolveCombat(world);

  if (!tower.active) {
    waves.update(world);
    // 大门开启后走向大门 → 进塔
    if (waves.gateOpen && player.centerX > 2680 && !tower.active) {
      waves.enabled = false;
      waves.barrierX = null;
      waves.barrierL = null;
      tower.start(world, 0);
    }
  }
  if (tower.active) tower.update(world);

  effects.update();

  // 每局结束时上报一次（通关 / 死亡 1.5 秒后；作弊局、回放、AI 代打不上报）
  if (!reported && !debugUsed && !replayInfo && !aiPlay) {
    const env: 'local' | 'prod' = location.hostname === 'localhost' ? 'local' : 'prod';
    if (tower.active && tower.done) {
      reported = true;
      void reportRun({
        v: 1, name: playerName, seed, result: 'clear', wave: 3 + tower.total, duration: frameCount,
        hpLeft: player.hp, log: input.log, env, ua: navigator.userAgent, at: new Date().toISOString(),
      });
    } else if (!tower.active && waves.done) {
      reported = true;
      void reportRun({
        v: 1, name: playerName, seed, result: 'clear', wave: waves.wave, duration: frameCount,
        hpLeft: player.hp, log: input.log, env, ua: navigator.userAgent, at: new Date().toISOString(),
      });
    } else if (!tower.active && player.state === 'dead') {
      if (deathDelay < 0) deathDelay = 90;
      else if (--deathDelay <= 0) {
        reported = true;
        void reportRun({
          v: 1, name: playerName, seed, result: 'dead', wave: waves.wave, duration: frameCount,
          hpLeft: 0, log: input.log, env, ua: navigator.userAgent, at: new Date().toISOString(),
        });
      }
    }
  }

  // 相机平滑跟随
  const target = clamp(player.centerX - VIEW_W / 2, 0, stage.width - VIEW_W);
  world.camX += (target - world.camX) * 0.15;
}

function render(): void {
  if (mode === 'loading') {
    ctx.fillStyle = '#0a0e27';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#e8e4c8';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      replayError ? '加载失败（检查网络/模型）' : AI_SPECTATE ? 'AI 模型加载中……' : '加载回放中……',
      VIEW_W / 2, VIEW_H / 2,
    );
    return;
  }

  if (mode === 'title') {
    title.draw(ctx, stage, VIEW_W, VIEW_H);
    if (!playerName) {
      // 首次登记忍名
      ctx.fillStyle = 'rgba(5,7,15,0.7)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = 'rgba(20,26,56,0.95)';
      ctx.fillRect(VIEW_W / 2 - 180, 210, 360, 120);
      ctx.strokeStyle = '#59627a';
      ctx.lineWidth = 2;
      ctx.strokeRect(VIEW_W / 2 - 180, 210, 360, 120);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e8e4c8';
      ctx.font = 'bold 20px "Yu Mincho","MS Mincho",serif';
      ctx.fillText('报上你的忍名', VIEW_W / 2, 246);
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(nameBuf + (frameCount % 60 < 35 ? '▌' : ''), VIEW_W / 2, 286);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '12px monospace';
      ctx.fillText('输入名字（≤12 字符）· Enter 确认', VIEW_W / 2, 314);
    } else {
      // 已登记：显示忍名
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,210,74,0.75)';
      ctx.font = '13px monospace';
      ctx.fillText(`忍名：${playerName} · 按 N 改名`, VIEW_W / 2, 466);
    }
    return;
  }

  const shake = effects.shakeOffset();

  ctx.save();
  ctx.translate(shake.x, shake.y);

  stage.drawBackground(ctx, world.camX, VIEW_W, VIEW_H, frameCount);

  // 世界坐标
  ctx.save();
  ctx.translate(-Math.round(world.camX), 0);
  stage.drawGround(ctx);
  waves.draw(ctx, stage.groundY, frameCount);
  for (const p of world.projectiles) p.draw(ctx);
  for (const a of world.arrows) a.draw(ctx);
  for (const o of world.orbs) o.draw(ctx);
  for (const c of world.clouds) c.draw(ctx);
  for (const e of world.enemies) e.draw(ctx);
  player.draw(ctx);
  effects.drawWorld(ctx);
  ctx.restore();

  ctx.restore();

  drawHUD(ctx, world, waves, VIEW_W, tower.active ? tower.label : undefined, tower.active);

  // Boss 血条
  const boss = world.enemies.find((e) => e.codexId === 'boss') as { hp: number; maxHp: number; dead: boolean } | undefined;
  if (boss && !boss.dead) drawBossBar(ctx, tower.active ? tower.bossName : '龍', boss.hp, boss.maxHp, VIEW_W);

  // 塔内视觉：暗角 + 层数横幅（独立场景的视觉标识）
  if (tower.active) tower.draw(ctx, VIEW_W, VIEW_H);

  // 回放横幅
  if (replayInfo) {
    ctx.fillStyle = '#ffd24a';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      `回放 #${replayInfo.id} · ${replayInfo.result === 'clear' ? '通关' : '阵亡'} · 第${replayInfo.wave}波`,
      VIEW_W / 2, 76,
    );
  }

  // AI 代打横幅
  if (aiPlay) {
    ctx.fillStyle = '#9fd8ff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('AI 代打中 · alibaba', VIEW_W / 2, 76);
  }

  // 「禅」无敌指示：常驻小金印 + 触发时大字闪现
  if (player.god) {
    ctx.fillStyle = '#b03040';
    ctx.fillRect(VIEW_W - 44, 34, 28, 28);
    ctx.fillStyle = '#f5ead8';
    ctx.font = 'bold 18px "Yu Mincho","MS Mincho",serif';
    ctx.textAlign = 'center';
    ctx.fillText('禅', VIEW_W - 30, 55);
  }
  if (zenFlash > 0) {
    ctx.globalAlpha = Math.min(1, zenFlash / 40);
    ctx.fillStyle = '#ffd24a';
    ctx.font = 'bold 72px "Yu Mincho","MS Mincho",serif';
    ctx.textAlign = 'center';
    ctx.fillText(player.god ? '禅' : '破', VIEW_W / 2, 260);
    ctx.globalAlpha = 1;
  }

  if (DEBUG) {
    ctx.font = '11px monospace';
    ctx.fillStyle = '#ffd24a';
    ctx.textAlign = 'right';
    ctx.fillText(`DEBUG${player.god ? ' · GOD' : ''}`, VIEW_W - 16, 20);
  }

  if (mode === 'codex') codex.draw(ctx, VIEW_W, VIEW_H, frameCount);
}

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += now - last;
  last = now;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    tick();
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0; // 掉帧严重时丢弃积压，避免螺旋卡死
  render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
