import type { Rect } from './types';
import { clamp } from './types';
import { integrate, GRAVITY } from './physics';
import { Projectile } from './projectile';
import { drawNinja, drawSlashFx } from './characters';
import type { World } from './world';

/** 短刀三段连击帧数据（单位：1/60 秒 tick） */
export interface AttackSpec {
  startup: number;    // 启动帧：此帧后出现判定
  activeEnd: number;  // 判定结束帧
  end: number;        // 动作总帧数（收招）
  cancelFrom: number; // 可取消窗口：此区间内按 J 接下一段
  cancelTo: number;
  dmg: number;
  range: number;      // 判定框向前的长度
  kbx: number;        // 击退
  kby: number;        // 击飞（负值向上）
  hitstun: number;    // 敌人硬直帧数
}

export const BLADE: AttackSpec[] = [
  { startup: 4, activeEnd: 7,  end: 16, cancelFrom: 8,  cancelTo: 16, dmg: 5,  range: 30, kbx: 2,   kby: 0,  hitstun: 10 },
  { startup: 5, activeEnd: 9,  end: 20, cancelFrom: 10, cancelTo: 20, dmg: 7,  range: 32, kbx: 3,   kby: -1, hitstun: 12 },
  { startup: 8, activeEnd: 12, end: 28, cancelFrom: 99, cancelTo: 99, dmg: 12, range: 36, kbx: 6.5, kby: -6, hitstun: 20 },
];

const MOVE_MAX = 3.4;
const JUMP_VEL = -11;
const DJUMP_VEL = -10;
const DASH_SPEED = 9;
const DASH_TIME = 11;
const DASH_CD = 45;
const SHURIKEN_COST = 10;
const SHURIKEN_SPEED = 11;
const THROW_CD = 12;
const KI_PER_HIT = 8;

const ROPE_SPEED = 14;    // 绳头飞行速度
const ROPE_MAX = 340;     // 绳索最大长度
const REHOOK_CD = 10;     // 松钩后到再次抛索的间隔（按住 I 时自动接力）
const SWING_PUMP = 0.22;  // 手动摆荡助力（A/D）
const SWING_AUTO = 0.14;  // 自动泵摆（朝目标侧持续加力，振幅越荡越大→荡高甩出）
const SWING_MAX = 12;

type State = 'idle' | 'run' | 'air' | 'attack' | 'dash' | 'grapple' | 'hit' | 'dead';

interface Rope {
  phase: 'fly' | 'attach';
  hx: number; hy: number;   // 绳头位置
  dx: number; dy: number;   // 飞行方向（单位向量）
  traveled: number;
  ax: number; ay: number;   // 锚点
  len: number;              // 绳长
  side: number;             // 钩住时玩家相对锚点的方位（±1），荡到另一侧即接近落点
}

export class Player {
  x = 120;
  y = 0;
  readonly w = 20;
  readonly h = 36;
  vx = 0;
  vy = 0;
  facing = 1;
  onGround = false;

  hp = 100;
  readonly maxHp = 100;
  ki = 60;
  readonly maxKi = 100;

  state: State = 'idle';
  attackStage = 0;   // 1..3
  attackTimer = 0;
  attackId = 0;      // 每次挥刀递增，防止一次判定多次命中同一敌人

  dashTimer = 0;
  dashCd = 0;
  dashDir = 1;

  rope: Rope | null = null;
  grappleCd = 0;

  hitTimer = 0;
  invTimer = 0;      // 受击后/瞬身中的无敌帧
  coyote = 0;        // 土狼时间：离开平台边缘后短暂可跳
  airJumps = 0;
  throwCd = 0;
  t = 0;             // 动画时钟（逻辑帧递增）

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }

  currentSpec(): AttackSpec | null {
    return this.state === 'attack' ? BLADE[this.attackStage - 1] : null;
  }

  /** 攻击判定框：仅在判定帧内存在 */
  getAttackHitbox(): Rect | null {
    const spec = this.currentSpec();
    if (!spec) return null;
    if (this.attackTimer < spec.startup || this.attackTimer > spec.activeEnd) return null;
    return {
      x: this.facing > 0 ? this.x + this.w : this.x - spec.range,
      y: this.y + 4,
      w: spec.range,
      h: 26,
    };
  }

  onHitConfirm(): void {
    this.ki = Math.min(this.maxKi, this.ki + KI_PER_HIT);
  }

  takeHit(dmg: number, dirX: number, w: World): void {
    if (this.state === 'dead' || this.state === 'dash' || this.invTimer > 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.rope = null;
    w.effects.playerHit(this.centerX, this.centerY);
    if (this.hp <= 0) {
      this.state = 'dead';
      return;
    }
    this.state = 'hit';
    this.hitTimer = 18;
    this.invTimer = 45;
    this.vx = dirX * 4.5;
    this.vy = -3.5;
  }

  private startAttack(stage: number): void {
    this.state = 'attack';
    this.attackStage = stage;
    this.attackTimer = 0;
    this.attackId++;
  }

  /** 坠入天堑 = 任务失败 */
  private checkPit(w: World): boolean {
    if (this.y > w.stage.groundY + 100) {
      this.hp = 0;
      this.rope = null;
      this.state = 'dead';
      return true;
    }
    return false;
  }

  /** 绳头飞行：45° 前上方，钩住横梁/平台/锚点 */
  private updateRopeFly(w: World): void {
    const r = this.rope;
    if (!r || r.phase !== 'fly') return;

    r.hx += r.dx * ROPE_SPEED;
    r.hy += r.dy * ROPE_SPEED;
    r.traveled += ROPE_SPEED;

    const stage = w.stage;
    let attach: { x: number; y: number } | null = null;

    for (const a of stage.anchors) {
      if (Math.hypot(a.x - r.hx, a.y - r.hy) < 22) {
        attach = { x: a.x, y: a.y };
        break;
      }
    }
    if (!attach) {
      for (const rc of stage.ropeTargets) {
        if (
          r.hx >= rc.x - 8 && r.hx <= rc.x + rc.w + 8 &&
          r.hy >= rc.y - 8 && r.hy <= rc.y + rc.h + 8
        ) {
          attach = { x: r.hx, y: r.hy };
          break;
        }
      }
    }

    if (attach) {
      r.phase = 'attach';
      r.ax = attach.x;
      r.ay = attach.y;
      r.len = Math.max(46, Math.hypot(this.centerX - r.ax, this.y + 10 - r.ay));
      r.side = Math.sign(this.centerX - r.ax) || -1;
      this.state = 'grapple';
      w.effects.puff(attach.x, attach.y);
    } else if (r.traveled > ROPE_MAX || r.hy < 8 || r.hx < 0 || r.hx > stage.width) {
      this.rope = null; // 没钩到，绳索收回
      this.grappleCd = 15;
    }
  }

  /** 松钩：跳跃键给小跳助力，松开 I 直接自由落体 */
  private detach(w: World, boost: boolean): void {
    this.state = 'air';
    this.rope = null;
    this.grappleCd = REHOOK_CD;
    this.airJumps = 1; // 摆荡后补一次二段跳
    if (boost) this.vy = Math.min(this.vy, -4.5);
    w.effects.puff(this.centerX, this.centerY);
  }

  /** 钟摆摆荡：按住 I 保持悬挂，松开即自由落体 */
  private updateSwing(w: World): void {
    const r = this.rope;
    if (!r) {
      this.state = 'air';
      return;
    }
    const { stage, input } = w;

    // 松开 I = 放手；按跳 = 助力飞出
    if (!input.isHeld('grapple')) { this.detach(w, false); return; }
    if (input.consume('jump')) { this.detach(w, true); return; }

    // 摆动物理：自动朝目标侧泵摆 + A/D 手动加力
    this.vy += GRAVITY;
    const move = (input.isHeld('left') ? -1 : 0) + (input.isHeld('right') ? 1 : 0);
    this.vx += -r.side * SWING_AUTO + move * SWING_PUMP;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > SWING_MAX) {
      this.vx = (this.vx / sp) * SWING_MAX;
      this.vy = (this.vy / sp) * SWING_MAX;
    }
    this.x += this.vx;
    this.y += this.vy;

    // 绳长约束：拉回圆周并去掉径向速度
    const dx = this.centerX - r.ax;
    const dy = this.y + 10 - r.ay;
    const dist = Math.hypot(dx, dy);
    if (dist > r.len && dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      this.x = r.ax + nx * r.len - this.w / 2;
      this.y = r.ay + ny * r.len - 10;
      const vr = this.vx * nx + this.vy * ny;
      this.vx -= vr * nx;
      this.vy -= vr * ny;
    }

    // 自动松手：荡过支点到另一侧、升至接近最高点时自动飞出（手动 W/I 仍可提前松）
    const sideNow = Math.sign(this.centerX - r.ax) || r.side;
    if (sideNow !== r.side && this.vy > -1) {
      this.vx *= 1.25;
      this.detach(w, true);
      return;
    }

    // 落到地面/平台 → 自动松钩
    if (this.vy >= 0) {
      const prevBottom = this.y + this.h - this.vy;
      let surface: number | null = null;
      if (
        this.y + this.h >= stage.groundY &&
        (stage.hasGroundAt(this.x + 2) || stage.hasGroundAt(this.x + this.w - 2))
      ) {
        surface = stage.groundY;
      }
      for (const p of stage.platforms) {
        const overlapX = this.x + this.w > p.x && this.x < p.x + p.w;
        if (overlapX && prevBottom <= p.y + 1 && this.y + this.h >= p.y) {
          surface = surface === null ? p.y : Math.min(surface, p.y);
        }
      }
      if (surface !== null) {
        this.y = surface - this.h;
        this.vy = 0;
        this.onGround = true;
        this.state = 'idle';
        this.rope = null;
        this.grappleCd = 15;
        w.effects.puff(this.centerX, this.y + this.h);
        return;
      }
    }

    this.x = clamp(this.x, 0, stage.width - this.w);
    if (Math.abs(this.vx) > 0.5) this.facing = Math.sign(this.vx);
    this.checkPit(w);
  }

  update(w: World): void {
    this.t++;
    if (this.state === 'dead') return;

    if (this.invTimer > 0) this.invTimer--;
    if (this.dashCd > 0) this.dashCd--;
    if (this.throwCd > 0) this.throwCd--;
    if (this.coyote > 0) this.coyote--;
    if (this.grappleCd > 0) this.grappleCd--;

    const { stage, input, effects } = w;

    // 受击硬直
    if (this.state === 'hit') {
      this.hitTimer--;
      integrate(this, stage);
      if (this.hitTimer <= 0) this.state = this.onGround ? 'idle' : 'air';
      return;
    }

    // 绳头飞行（并行于当前状态，钩中后转入摆荡）
    this.updateRopeFly(w);

    // 摆荡
    if (this.state === 'grapple') {
      this.updateSwing(w);
      return;
    }

    // 瞬身：无重力直线位移，带残影
    if (this.state === 'dash') {
      this.dashTimer--;
      this.vx = this.dashDir * DASH_SPEED;
      this.vy = 0;
      this.x = clamp(this.x + this.vx, 0, stage.width - this.w);
      if (this.dashTimer % 2 === 0) effects.afterimage(this.x, this.y, this.w, this.h);
      if (this.dashTimer <= 0) {
        this.state = this.onGround ? 'idle' : 'air';
        this.vx *= 0.35;
      }
      return;
    }

    const move = (input.isHeld('left') ? -1 : 0) + (input.isHeld('right') ? 1 : 0);
    const attacking = this.state === 'attack';

    // 飞索：按住 I 即自动朝前上方最近锚点抛索（无目标时按 45° 抛出）
    if (!attacking && !this.rope && this.grappleCd <= 0 && input.isHeld('grapple')) {
      const dir = move !== 0 ? move : this.facing;
      let dx = dir * 0.7071;
      let dy = -0.7071;
      let bestD = ROPE_MAX;
      for (const a of stage.anchors) {
        const ddx = a.x - this.centerX;
        const ddy = a.y - (this.y + 10);
        if (ddy > -16) continue;                                    // 必须在上方
        if (Math.abs(ddx) > 30 && Math.sign(ddx) !== dir) continue; // 必须在前方
        const d = Math.hypot(ddx, ddy);
        if (d < bestD) {
          bestD = d;
          dx = ddx / d;
          dy = ddy / d;
        }
      }
      this.rope = {
        phase: 'fly',
        hx: this.centerX,
        hy: this.y + 10,
        dx, dy,
        traveled: 0,
        ax: 0, ay: 0, len: 0, side: 0,
      };
      effects.puff(this.centerX, this.centerY);
    }

    // 瞬身（攻击中不可）
    if (!attacking && input.consume('dash') && this.dashCd <= 0) {
      this.state = 'dash';
      this.dashTimer = DASH_TIME;
      this.dashCd = DASH_CD;
      this.dashDir = move !== 0 ? move : this.facing;
      this.facing = this.dashDir;
      this.invTimer = Math.max(this.invTimer, DASH_TIME);
      effects.puff(this.centerX, this.y + this.h - 4);
      return;
    }

    // 跳跃 / 二段跳（攻击中不可）
    if (!attacking && input.consume('jump')) {
      if (this.onGround || this.coyote > 0) {
        this.vy = JUMP_VEL;
        this.onGround = false;
        this.coyote = 0;
        this.airJumps = 1;
        effects.puff(this.centerX, this.y + this.h);
      } else if (this.airJumps > 0) {
        this.vy = DJUMP_VEL;
        this.airJumps--;
        effects.ring(this.centerX, this.y + this.h - 6);
      }
    }

    // 短刀连击
    if (!attacking) {
      if (input.consume('attack')) this.startAttack(1);
    } else {
      const spec = BLADE[this.attackStage - 1];
      this.attackTimer++;
      // 取消窗口内接下一段
      if (
        this.attackStage < 3 &&
        this.attackTimer >= spec.cancelFrom &&
        this.attackTimer <= spec.cancelTo &&
        input.consume('attack')
      ) {
        this.startAttack(this.attackStage + 1);
      } else if (this.attackTimer >= spec.end) {
        this.state = this.onGround ? 'idle' : 'air';
      }
    }

    // 手里剑·扇形三连（攻击中不可）：上中下三发，覆盖纵向空间
    if (
      this.state !== 'attack' &&
      this.throwCd <= 0 &&
      this.ki >= SHURIKEN_COST &&
      input.consume('shuriken')
    ) {
      this.ki -= SHURIKEN_COST;
      this.throwCd = THROW_CD;
      const px = this.centerX + this.facing * 16;
      const py = this.y + 12;
      for (const a of [-0.24, 0, 0.24]) {
        w.projectiles.push(
          new Projectile(px, py, Math.cos(a) * SHURIKEN_SPEED * this.facing, Math.sin(a) * SHURIKEN_SPEED),
        );
      }
    }

    // 水平移动
    if (this.state !== 'attack') {
      const accel = this.onGround ? 0.6 : 0.35;
      if (move !== 0) {
        this.vx = clamp(this.vx + move * accel, -MOVE_MAX, MOVE_MAX);
        this.facing = move;
      } else {
        this.vx *= this.onGround ? 0.7 : 0.98;
      }
    } else {
      // 挥刀时小步前移，收招时急停
      const spec = BLADE[this.attackStage - 1];
      this.vx = this.attackTimer <= spec.activeEnd ? this.facing * 0.8 : this.vx * 0.6;
    }

    const wasGround = this.onGround;
    integrate(this, stage);
    if (this.checkPit(w)) return;
    if (wasGround && !this.onGround && this.vy > 0) this.coyote = 6;

    // 落地取消挥刀
    if (this.state === 'attack' && this.onGround && !wasGround) {
      this.state = 'idle';
    }

    // 状态归纳
    if (this.state !== 'attack') {
      if (!this.onGround) this.state = 'air';
      else this.state = Math.abs(this.vx) > 0.3 ? 'run' : 'idle';
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // 绳索（飞行中的绳头 / 钩住后带下垂的绳）
    if (this.rope) {
      const r = this.rope;
      const tx = r.phase === 'fly' ? r.hx : r.ax;
      const ty = r.phase === 'fly' ? r.hy : r.ay;
      ctx.strokeStyle = '#c8b088';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.centerX, this.y + 10);
      if (r.phase === 'attach') {
        // 松弛下垂
        const dist = Math.hypot(this.centerX - r.ax, this.y + 10 - r.ay);
        const sag = Math.max(3, (r.len - dist) * 0.5 + 3);
        ctx.quadraticCurveTo((this.centerX + r.ax) / 2, (this.y + 10 + r.ay) / 2 + sag, r.ax, r.ay);
      } else {
        ctx.lineTo(tx, ty);
      }
      ctx.stroke();
      ctx.fillStyle = '#e8ecf8';
      ctx.fillRect(tx - 2.5, ty - 2.5, 5, 5);
    }

    // 无敌帧闪烁
    if (
      this.invTimer > 0 &&
      this.state !== 'dash' &&
      this.state !== 'dead' &&
      Math.floor(this.invTimer / 3) % 2 === 0
    ) {
      ctx.globalAlpha = 0.35;
    }

    drawNinja(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state === 'grapple' ? 'air' : this.state,
      t: this.t,
      attackStage: this.attackStage,
      attackTimer: this.attackTimer,
    });
    ctx.globalAlpha = 1;

    // 刀光弧
    const hb = this.getAttackHitbox();
    if (hb) drawSlashFx(ctx, hb, this.facing, this.attackStage);
  }
}
