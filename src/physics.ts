import type { Rect } from './types';
import { clamp } from './types';

export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
}

/** 物理需要的最小关卡接口（避免直接依赖 Stage 造成循环引用） */
export interface StageLike {
  readonly groundY: number;
  readonly width: number;
  readonly platforms: Rect[];
  hasGroundAt(x: number): boolean;
}

export const GRAVITY = 0.55;
export const MAX_FALL = 13;

/** 重力 + 积分 + 分段地面/单向平台碰撞（脚下没有地面段则坠入深沟） */
export function integrate(b: Body, stage: StageLike): void {
  b.vy = Math.min(b.vy + GRAVITY, MAX_FALL);
  const prevBottom = b.y + b.h;
  b.x += b.vx;
  b.y += b.vy;

  b.onGround = false;

  if (
    b.y + b.h >= stage.groundY &&
    (stage.hasGroundAt(b.x + 2) || stage.hasGroundAt(b.x + b.w - 2))
  ) {
    b.y = stage.groundY - b.h;
    b.vy = 0;
    b.onGround = true;
  }

  if (b.vy >= 0) {
    for (const p of stage.platforms) {
      const overlapX = b.x + b.w > p.x && b.x < p.x + p.w;
      if (overlapX && prevBottom <= p.y + 1 && b.y + b.h >= p.y) {
        b.y = p.y - b.h;
        b.vy = 0;
        b.onGround = true;
      }
    }
  }

  b.x = clamp(b.x, 0, stage.width - b.w);
}
