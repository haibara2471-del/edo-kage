import type { Rect } from './types';
import type { Player } from './player';
import type { Input } from './input';
import type { World, Hittable } from './world';

/**
 * 把玩家包装成 Hittable，用于 mirror/self-play 场景：
 * 主玩家和镜像玩家互相进入对方的 enemies 列表，复用现有 combat 逻辑。
 */
export class PlayerHittable implements Hittable {
  lastHitId = 0;
  readonly contactDamage = 10;
  readonly codexId = 'boss'; // 用 boss 类型码，让对手给予足够重视

  constructor(
    public player: Player,
    private input: Input,
    private world: World,
  ) {}

  get x() { return this.player.x; }
  get w() { return this.player.w; }
  set x(v: number) { this.player.x = v; }
  get vx() { return this.player.vx; }
  set vx(v: number) { this.player.vx = v; }
  get rect(): Rect { return this.player.rect; }
  get dead() { return this.player.state === 'dead'; }
  get removable() { return this.dead; }
  get centerX() { return this.player.centerX; }
  get centerY() { return this.player.centerY; }

  getAttackHitbox(): Rect | null {
    return this.player.getAttackHitbox();
  }

  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    const p = this.player;
    if (p.god || p.state === 'dead' || p.state === 'dash' || p.invTimer > 0) return false;
    const before = p.hp;
    p.hp = Math.max(0, p.hp - dmg);
    if (p.hp <= 0) {
      p.state = 'dead';
      return before > 0;
    }
    p.state = 'hit';
    p.hitTimer = hitstun;
    p.invTimer = 45;
    p.vx = dirX * kbx;
    p.vy = kby;
    return false;
  }

  update(w: World): void {
    const saved = w.input;
    w.input = this.input;
    this.player.update(w);
    w.input = saved;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.player.draw(ctx);
  }
}
