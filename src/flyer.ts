import type { Rect } from './types';
import { clamp } from './types';
import { drawFlyer, type FlyerKind } from './characters';
import { rand } from './rng';
import type { World } from './world';

type State = 'circle' | 'telegraph' | 'dive' | 'climb' | 'hit' | 'dead';

const STATS: Record<FlyerKind, { hp: number; dmg: number; speed: number; altitude: number; w: number; h: number }> = {
  crow: { hp: 12, dmg: 8, speed: 5.2, altitude: 150, w: 18, h: 12 },
  bat:  { hp: 8,  dmg: 5, speed: 6.0, altitude: 100, w: 16, h: 10 },
};

/** 飞行敌人：在玩家上空盘旋 → 警告抖动 → 俯冲 → 爬升。只有俯冲时有攻击判定 */
export class Flyer {
  vx = 0;
  vy = 0;
  facing = 1;

  hp: number;
  readonly maxHp: number;
  readonly contactDamage: number;
  readonly w: number;
  readonly h: number;

  state: State = 'circle';
  timer = 80;
  t = 0;
  flash = 0;
  lastHitId = 0;
  deadTimer = 0;

  private diveX = 0;
  private diveY = 0;
  private readonly wobble: number;
  private readonly altitude: number;
  private readonly speed: number;

  constructor(
    public x: number,
    public y: number,
    public readonly kind: FlyerKind,
  ) {
    const s = STATS[kind];
    this.hp = s.hp;
    this.maxHp = s.hp;
    this.contactDamage = s.dmg;
    this.altitude = s.altitude;
    this.speed = s.speed;
    this.w = s.w;
    this.h = s.h;
    this.wobble = rand() * Math.PI * 2;
    this.t = Math.floor(rand() * 60);
  }

  get codexId(): FlyerKind {
    return this.kind;
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }
  get dead(): boolean { return this.state === 'dead'; }
  get removable(): boolean { return this.state === 'dead' && this.deadTimer > 60; }

  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    if (this.state === 'dead') return false;
    this.hp -= dmg;
    this.flash = 6;
    if (this.hp <= 0) {
      this.state = 'dead';
      this.deadTimer = 0;
      this.vx = dirX * 2;
      this.vy = -3;
      return true;
    }
    this.state = 'hit';
    this.timer = hitstun;
    this.vx = dirX * kbx;
    this.vy = kby;
    return false;
  }

  /** 仅俯冲时有攻击判定 */
  getAttackHitbox(): Rect | null {
    if (this.state !== 'dive') return null;
    return { x: this.x + 2, y: this.y + 2, w: this.w - 4, h: this.h - 4 };
  }

  update(w: World): void {
    this.t++;
    if (this.flash > 0) this.flash--;

    const { player, stage } = w;

    switch (this.state) {
      case 'dead':
        this.deadTimer++;
        this.vy += 0.35;
        this.x += this.vx;
        this.y += this.vy;
        if (this.y + this.h > stage.groundY) {
          this.y = stage.groundY - this.h;
          this.vy = 0;
          this.vx *= 0.9;
        }
        return;

      case 'hit':
        this.timer--;
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.3;
        if (this.timer <= 0) this.state = 'climb';
        break;

      case 'circle': {
        // 在玩家上空缓慢漂移
        const hx = clamp(player.centerX + Math.sin(this.t * 0.011 + this.wobble) * 160, 40, stage.width - 40);
        const hy = clamp(player.y - this.altitude + Math.sin(this.t * 0.07 + this.wobble) * 18, 50, stage.groundY - 140);
        this.vx = clamp(this.vx + (hx - this.x) * 0.004, -2, 2);
        this.vy = clamp(this.vy + (hy - this.y) * 0.004, -1.6, 1.6);
        this.x += this.vx;
        this.y += this.vy;
        if (Math.abs(this.vx) > 0.3) this.facing = Math.sign(this.vx);
        if (
          player.state !== 'dead' &&
          Math.abs(player.centerX - this.centerX) < 280 &&
          --this.timer <= 0
        ) {
          this.state = 'telegraph';
          this.timer = 26;
          this.vx = 0;
          this.vy = 0;
        }
        break;
      }

      case 'telegraph':
        // 警告：原地高频抖动
        this.x += Math.sin(this.t * 2.2) * 0.8;
        if (--this.timer <= 0) {
          this.state = 'dive';
          this.timer = 42;
          const dx = player.centerX - this.centerX;
          const dy = player.centerY - this.centerY;
          const d = Math.hypot(dx, dy) || 1;
          this.diveX = (dx / d) * this.speed;
          this.diveY = (dy / d) * this.speed;
          this.facing = this.diveX >= 0 ? 1 : -1;
        }
        break;

      case 'dive':
        this.x += this.diveX;
        this.y += this.diveY;
        if (--this.timer <= 0 || this.y + this.h >= stage.groundY - 4) {
          this.state = 'climb';
        }
        break;

      case 'climb':
        this.vy = -2.2;
        this.vx *= 0.95;
        this.x += this.vx;
        this.y += this.vy;
        if (Math.abs(this.vx) > 0.3) this.facing = Math.sign(this.vx);
        if (this.y <= player.y - this.altitude * 0.8) {
          this.state = 'circle';
          this.timer = 90 + rand() * 90;
        }
        break;
    }

    this.x = clamp(this.x, 10, stage.width - this.w - 10);
    this.y = clamp(this.y, 30, stage.groundY - this.h);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead' && this.deadTimer > 30) {
      ctx.globalAlpha = Math.max(0, 1 - (this.deadTimer - 30) / 30);
    }
    drawFlyer(ctx, this.x, this.y, this.w, this.h, this.facing, this.kind, this.t, this.state, this.flash);
    ctx.globalAlpha = 1;

    // 俯冲警告标记（醒目红色叹号）
    if (this.state === 'telegraph') {
      ctx.fillStyle = '#ff5560';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('！', this.centerX, this.y - 6);
    }
  }
}
