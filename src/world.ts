import type { Rect } from './types';
import type { Input } from './input';
import type { Effects } from './effects';
import type { Stage } from './stage';
import type { Player } from './player';
import type { Projectile, Arrow } from './projectile';
import type { Codex, CodexId } from './codex';

/** 可被攻击/可攻击玩家的实体（足轻、弓箭手、飞行敌人……） */
export interface Hittable {
  readonly rect: Rect;
  readonly dead: boolean;
  readonly removable: boolean;
  readonly centerX: number;
  readonly centerY: number;
  readonly contactDamage: number;
  readonly codexId: CodexId;
  lastHitId: number;
  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean;
  getAttackHitbox(): Rect | null;
  update(w: World): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

export interface World {
  input: Input;
  effects: Effects;
  stage: Stage;
  player: Player;
  enemies: Hittable[];
  projectiles: Projectile[];
  arrows: Arrow[];
  codex: Codex;
  camX: number;
}
