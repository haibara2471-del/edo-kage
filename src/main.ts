import { Input } from './input';
import { Effects } from './effects';
import { Stage } from './stage';
import { Player } from './player';
import { Waves } from './waves';
import { Title } from './title';
import { Codex } from './codex';
import { resolveCombat } from './combat';
import { drawHUD } from './ui';
import { clamp, rectsOverlap } from './types';
import type { World } from './world';

const VIEW_W = 960;
const VIEW_H = 540;
const STEP = 1000 / 60; // 固定 60Hz 逻辑步进

const IS_TRAINING = new URLSearchParams(location.search).has('training');
const DEBUG = new URLSearchParams(location.search).has('debug');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const input = new Input();
const effects = new Effects();
const stage = new Stage(IS_TRAINING ? 'training' : 'level');
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
let mode: Mode = IS_TRAINING ? 'play' : 'title';
let trainingDone = false;
let frameCount = 0;

if (IS_TRAINING) {
  waves.enabled = false;
  player.x = stage.spawnPoint.x;
  player.y = stage.spawnPoint.y;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyT' && mode === 'title') {
    location.search = '?training=1'; // 标题画面按 T 进修練場
    return;
  }
  if (e.code === 'KeyR' && mode === 'play') location.reload();
  if (!DEBUG || mode !== 'play') return;
  // —— 开发者调试（?debug=1）——
  const zones = stage.grounds;
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    const zi = Number(e.code.slice(-1)) - 1;
    if (zones[zi]) {
      world.enemies.length = 0; // 传送并清场
      player.x = zones[zi].x0 + 60;
      player.y = 300;
      player.vx = 0;
      player.vy = 0;
      world.camX = clamp(player.centerX - VIEW_W / 2, 0, stage.width - VIEW_W);
    }
  }
  if (e.code === 'KeyN') world.enemies.length = 0; // 秒清当前波（测结界开门）
  if (e.code === 'KeyG') player.god = !player.god;   // 无敌开关
});

function tick(): void {
  input.tick();
  frameCount++;

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

  // 结界：波次未清完时封锁右路（含瞬身/摆荡飞跃）
  if (waves.barrierX !== null && player.x + player.w > waves.barrierX) {
    player.x = waves.barrierX - player.w;
    if (player.vx > 0) player.vx = 0;
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
  if (waves.enabled) waves.update(world);
  effects.update();

  // 修練場：到达终点高台
  if (IS_TRAINING && !trainingDone && rectsOverlap(player.rect, stage.goalZone)) {
    trainingDone = true;
  }

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

  if (DEBUG) {
    ctx.font = '11px monospace';
    ctx.fillStyle = '#ffd24a';
    ctx.textAlign = 'right';
    ctx.fillText(`DEBUG${player.god ? ' · GOD' : ''}  [1/2/3 传送  N 清波  G 无敌]`, VIEW_W - 16, 20);
  }

  if (IS_TRAINING && trainingDone) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px "Yu Mincho","MS Mincho",serif';
    ctx.fillStyle = '#ffd24a';
    ctx.fillText('修練完了！', VIEW_W / 2, 180);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('按 R 返回标题', VIEW_W / 2, 212);
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
