import { Input } from './input';
import { Effects } from './effects';
import { Stage } from './stage';
import { Player } from './player';
import { Waves } from './waves';
import { Title } from './title';
import { Codex } from './codex';
import { resolveCombat } from './combat';
import { drawHUD } from './ui';
import { clamp } from './types';
import type { World } from './world';

const VIEW_W = 960;
const VIEW_H = 540;
const STEP = 1000 / 60; // 固定 60Hz 逻辑步进

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
  codex,
  camX: 0,
};

type Mode = 'title' | 'play' | 'codex';
let mode: Mode = 'title';
let frameCount = 0;

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && mode === 'play') location.reload();
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

  for (const e of world.enemies) e.update(world);
  world.enemies = world.enemies.filter((e) => !e.removable);

  for (const p of world.projectiles) p.update(stage.width);
  world.projectiles = world.projectiles.filter((p) => !p.dead);

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
  for (const p of world.projectiles) p.draw(ctx);
  for (const e of world.enemies) e.draw(ctx);
  player.draw(ctx);
  effects.drawWorld(ctx);
  ctx.restore();

  ctx.restore();

  drawHUD(ctx, world, waves, VIEW_W);

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
