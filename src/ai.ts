import { Input, type Action } from './input';
import type { World } from './world';

/**
 * AI 输入源：浏览器内 onnxruntime-web 推理 PPO 策略，驱动玩家（alibaba 观战模式）。
 * 观测向量与 sim/env.ts 的 42 维完全一致（必须保持同步！）。
 */

declare const ort: any; // CDN 全局（index.html 引入）

const OBS_SIZE = 42;

/** 动作表（与 sim/env.ts ACTIONS 一致） */
const ACTIONS: string[][] = [
  [], ['left'], ['right'], ['jump'], ['attack'], ['shuriken'], ['dash'],
  ['skillU'], ['skillH'], ['skillO'],
  ['left', 'attack'], ['right', 'attack'], ['left', 'jump'], ['right', 'jump'],
];

function typeCode(id: string): number {
  return ({ ashigaru: 1, archer: 2, hook: 3, bruiser: 4, shaman: 5, crow: 6, bat: 7, boss: 8 } as Record<string, number>)[id] ?? 0;
}

function stateCode(s: string): number {
  return ({ idle: 1, chase: 2, windup: 3, thrust: 4, recover: 5, hit: 6, telegraph: 7, dive: 8, climb: 9, aim: 10, combo: 11, dashWindup: 12, dashKick: 13, rising: 14, sweepWindup: 15, sweep: 16 } as Record<string, number>)[s] ?? 0;
}

/** 42 维观测（镜像 sim/env.ts observe()） */
export function buildObs(w: World): Float32Array {
  const p = w.player;
  const obs: number[] = [
    p.x / 2750, p.y / 540, p.vx / 10, p.vy / 10,
    p.hp / 100, p.ki / 100, p.facing, p.onGround ? 1 : 0,
    p.dashCd / 45, p.poisonTimer / 120,
    w.projectiles.length / 6, w.arrows.length / 6, w.orbs.length,
  ];

  const sorted = [...w.enemies]
    .filter((e) => !e.dead)
    .sort((a, b) => Math.abs(a.centerX - p.centerX) - Math.abs(b.centerX - p.centerX))
    .slice(0, 3);
  for (let i = 0; i < 3; i++) {
    const e = sorted[i] as
      | { centerX: number; centerY: number; hp?: number; maxHp?: number; codexId: string; state?: string }
      | undefined;
    if (e) {
      obs.push(
        Math.max(-1, Math.min(1, (e.centerX - p.centerX) / 300)),
        Math.max(-1, Math.min(1, (e.centerY - p.centerY) / 300)),
        Math.max(0, e.hp ?? 0) / (e.maxHp ?? 100),
        typeCode(e.codexId) / 8,
        stateCode(e.state ?? '') / 16,
      );
    } else {
      obs.push(0, 0, 0, 0, 0);
    }
  }

  const projs = [...w.arrows.map((a) => ({ x: a.x, y: a.y })), ...w.projectiles.map((s) => ({ x: s.x, y: s.y }))];
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
  return new Float32Array(obs.slice(0, OBS_SIZE));
}

export class AiInput extends Input {
  private session: any = null;
  private deciding = false;

  constructor(private world: World) {
    super(false); // 不接真实键盘
  }

  async init(url: string): Promise<void> {
    this.session = await ort.InferenceSession.create(url);
  }

  get ready(): boolean {
    return this.session !== null;
  }

  private pending = false;
  private decisionFrame = 0;

  override tick(): void {
    // 场上无敌：训练中不存在"安静期"，策略会摇摆——直接向右推进触发下一波
    if (this.world.enemies.every((e) => e.dead)) {
      this.held.clear();
      this.held.add('right');
      super.tick();
      return;
    }
    // Boss 场：训练决策是 2 帧/步（30Hz），普通场是 4 帧/步
    const isBoss = this.world.enemies.some((e) => e.codexId === 'boss');
    const interval = isBoss ? 2 : 4;
    if (this.session && this.frame >= this.decisionFrame + interval && !this.pending) {
      this.decisionFrame = this.frame;
      this.pending = true;
      this.decide().finally(() => {
        this.pending = false;
      });
    }
    super.tick();
  }

  private async decide(): Promise<void> {
    try {
      const obs = buildObs(this.world);
      const results = await this.session.run({ obs: new ort.Tensor('float32', obs, [1, OBS_SIZE]) });
      const a = Number(results.action.data[0]);
      const combo = ACTIONS[a] ?? [];
      this.held.clear();
      for (const act of combo) {
        if (act === 'left' || act === 'right') this.held.add(act as Action);
        else this.buffer.push({ action: act as Action, frame: this.frame });
      }
    } catch (e) {
      console.error('AI 决策失败', e);
    }
  }
}
