import { Stage } from '../src/stage';
import { Player } from '../src/player';
import { Flyer } from '../src/flyer';
import { Effects } from '../src/effects';
import { Codex } from '../src/codex';
import { resolveCombat } from '../src/combat';
import { reseed } from '../src/rng';
import { buildObs } from '../src/ai';
import * as ort from 'onnxruntime-node';
import type { World } from '../src/world';

const OBS = 42;
const A: string[][] = [
  [], ['left'], ['right'], ['jump'], ['attack'], ['shuriken'], ['dash'],
  ['skillU'], ['skillH'], ['skillO'],
  ['left', 'attack'], ['right', 'attack'], ['left', 'jump'], ['right', 'jump'],
];

class D {
  held = new Set<string>();
  buf: { action: string; frame: number }[] = [];
  frame = 0;
  tick(): void { this.frame++; }
  isHeld(a: string): boolean { return this.held.has(a); }
  consume(a: string): boolean {
    const i = this.buf.findIndex((p) => p.action === a && this.frame - p.frame <= 9);
    if (i >= 0) { this.buf.splice(i, 1); return true; }
    return false;
  }
  apply(n: number): void {
    const c = A[n] ?? [];
    this.held.clear();
    for (const x of c) {
      if (x === 'left' || x === 'right') this.held.add(x);
      else this.buf.push({ action: x, frame: this.frame });
    }
  }
}

function step(w: World): void {
  if (w.effects.freeze > 0) { w.effects.freeze--; w.effects.update(); return; }
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

(async () => {
  const ses = await ort.InferenceSession.create('sim/rl/ppo_shurikenOnly.onnx');
  reseed(1);
  const stage = new Stage();
  const d = new D();
  const p = new Player();
  p.x = 400;
  p.y = stage.groundY - p.h;
  const w: World = {
    input: d as never, effects: new Effects(), stage, player: p,
    enemies: [new Flyer(p.centerX - 160, stage.groundY - 220, 'crow', { passive: true }), new Flyer(p.centerX + 160, stage.groundY - 220, 'crow', { passive: true })],
    projectiles: [], arrows: [], orbs: [], clouds: [], codex: new Codex(), camX: 0, lastHits: [],
  };
  let last = -1;
  for (let f = 0; f < 600; f++) {
    d.tick();
    if (f % 4 === 0) {
      const o = buildObs(w);
      const r = await ses.run({ obs: new ort.Tensor('float32', o, [1, OBS]) });
      last = Number(r.action.data[0]);
      d.apply(last);
    }
    step(w);
    if (f % 60 === 0) {
      console.log(`t=${f} 动作=${last}(${A[last]?.join('+') ?? '?'}) x=${p.centerX.toFixed(0)} y=${p.centerY.toFixed(0)} 气=${p.ki.toFixed(0)} 敌=${w.enemies.length} 镖=${w.projectiles.length}`);
    }
  }
})();
