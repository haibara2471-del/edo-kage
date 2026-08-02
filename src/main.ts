import { Input } from './input';
import { Effects } from './effects';
import { Stage } from './stage';
import { Player } from './player';
import { Waves } from './waves';
import { Title } from './title';
import { Codex } from './codex';
import { resolveCombat } from './combat';
import { drawHUD, drawBossBar } from './ui';
import { clamp } from './types';
import type { World } from './world';

const VIEW_W = 960;
const VIEW_H = 540;
const STEP = 1000 / 60; // 固定 60Hz 逻辑步进

const DEBUG = new URLSearchParams(location.search).has('debug');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const input = new Input();
const effects = new Effects();
const stage = new Stage();
const player = new Player();
const waves = new Waves();
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
};

type Mode = 'title' | 'play' | 'codex';
let mode: Mode = 'title';
let frameCount = 0;
let zenFlash = 0; // 「禅」密令触发提示

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
      zenFlash = 90;
      zenBuf.length = 0;
    }
  }
  if (!DEBUG || mode !== 'play') return;
  // —— 开发者调试（?debug=1 显示 DEBUG 标记与 G 无敌）——
  if (e.code === 'KeyG') player.god = !player.god;   // 无敌开关（Z-E-N 也可）
});

/** 传送/清场调试键：随时可用（数字键与 N 均未被游戏占用） */
window.addEventListener('keydown', (e) => {
  if (mode !== 'play') return;
  const ZONES = [
    { x0: 0, x1: 1050 },
    { x0: 1350, x1: 1950 },
    { x0: 2310, x1: 2750 },
  ];
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    const zi = Number(e.code.slice(-1)) - 1;
    if (ZONES[zi]) {
      world.enemies.length = 0; // 传送并清场
      player.x = ZONES[zi].x0 + 60;
      player.y = 300;
      player.vx = 0;
      player.vy = 0;
      world.camX = clamp(player.centerX - VIEW_W / 2, 0, stage.width - VIEW_W);
    }
  }
  if (e.code === 'KeyN') world.enemies.length = 0; // 秒清当前波（测结界开门）
});

function tick(): void {
  input.tick();
  frameCount++;
  if (zenFlash > 0) zenFlash--;

  if (mode === 'title') {
    if (title.update(input)) mode = 'play';
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

  // 结界：波次未清完时封锁右路；Boss 战同时封锁左路
  if (waves.barrierX !== null && player.x + player.w > waves.barrierX) {
    player.x = waves.barrierX - player.w;
    if (player.vx > 0) player.vx = 0;
  }
  if (waves.barrierL !== null && player.x < waves.barrierL) {
    player.x = waves.barrierL;
    if (player.vx < 0) player.vx = 0;
  }

  for (const e of world.enemies) e.update(world);
  world.enemies = world.enemies.filter((e) => !e.removable);

  for (const p of world.projectiles) p.update(stage.width);
  world.projectiles = world.projectiles.filter((p) => !p.dead);

  for (const a of world.arrows) a.update(stage);
  world.arrows = world.arrows.filter((a) => !a.dead);

  for (const o of world.orbs) o.update(world);
  world.orbs = world.orbs.filter((o) => !o.dead);

  for (const c of world.clouds) c.update(world);
  world.clouds = world.clouds.filter((c) => !c.dead);

  resolveCombat(world);
  waves.update(world);
  effects.update();

  // 相机平滑跟随
  const target = clamp(player.centerX - VIEW_W / 2, 0, stage.width - VIEW_W);
  world.camX += (target - world.camX) * 0.15;
}

function render(): void {
  if (mode === 'title') {
    title.draw(ctx, stage, VIEW_W, VIEW_H);
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

  drawHUD(ctx, world, waves, VIEW_W);

  // Boss 血条
  const boss = world.enemies.find((e) => e.codexId === 'boss') as { hp: number; maxHp: number; dead: boolean } | undefined;
  if (boss && !boss.dead) drawBossBar(ctx, '龍', boss.hp, boss.maxHp, VIEW_W);

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
    ctx.fillText(`DEBUG${player.god ? ' · GOD' : ''}  [1/2/3 传送  N 清波  G 无敌]`, VIEW_W - 16, 20);
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
