import type { Rect } from './types';
import { integrate } from './physics';
import type { World } from './world';

/**
 * 塔 Boss 基类：公共 Hittable 样板（命中/击退/死亡/二阶段），招式状态机由子类实现。
 * 设计原则同「龙」：前摇-判定-硬直 的帧数据，每招有解法。
 */
export abstract class TowerBoss {
  readonly w = 24;
  readonly h = 42;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing = -1;
  onGround = false;

  hp: number;
  /** 可写：乐邦「狂野」进阶段时把上限调整为当前血量（血条同步收缩） */
  maxHp: number;

  state: string = 'idle';
  timer = 0;
  atkCd = 40;
  flash = 0;
  lastHitId = 0;
  deadTimer = 0;
  t = 0;

  constructor(x: number, y: number, hp: number) {
    this.x = x;
    this.y = y;
    this.maxHp = hp;
    this.hp = hp;
  }

  get rect(): Rect { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }
  get dead(): boolean { return this.state === 'dead'; }
  get removable(): boolean { return this.state === 'dead' && this.deadTimer > 70; }
  get phase2(): boolean { return this.hp <= this.maxHp / 2; }
  /** Boss 名（血条/层数横幅用） */
  abstract get name(): string;
  /** 每招接触伤害（按 state 切换），默认 0 */
  abstract get contactDamage(): number;
  /** 当前招式判定框 */
  abstract getAttackHitbox(): Rect | null;

  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    if (this.state === 'dead') return false;
    this.hp -= dmg;
    this.flash = 6;
    if (this.hp <= 0) {
      this.state = 'dead';
      this.deadTimer = 0;
      this.vx = dirX * kbx;
      this.vy = kby;
      return true;
    }
    this.state = 'hit';
    this.timer = Math.min(Math.floor(hitstun * 0.7), 12);
    this.vx = dirX * kbx * 0.7;
    this.vy = kby;
    return false;
  }

  update(w: World): void {
    this.t++;
    if (this.flash > 0) this.flash--;
    if (this.atkCd > 0) this.atkCd--;

    if (this.state === 'dead') {
      this.deadTimer++;
      if (this.deadTimer < 24) {
        this.vx *= 0.85;
        integrate(this, w.stage);
      }
      return;
    }
    if (this.state === 'hit') {
      this.timer--;
      integrate(this, w.stage);
      if (this.timer <= 0) this.state = 'walk';
      return;
    }
    this.ai(w);
    integrate(this, w.stage);
  }

  /** 子类决策：设置 vx/vy/state，基类统一 integrate */
  protected abstract ai(w: World): void;
  abstract draw(ctx: CanvasRenderingContext2D): void;
}
