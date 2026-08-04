import type { Rect } from './types';
import { clamp } from './types';
import { integrate } from './physics';
import { Projectile, WaterOrb } from './projectile';
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
const DASH_CD = 300;      // 5 秒 CD：防止 AI/玩家 spam 无敌位移
const SHURIKEN_COST = 10;
const SHURIKEN_SPEED = 11;
const THROW_CD = 12;
const KI_PER_HIT = 8;

const LAUNCHER_COST = 10;   // 昇月斬
const LAUNCHER_VEL = -9;
const FLURRY_COST = 20;     // 朧乱舞
const FLURRY_TIME = 36;     // 9 段连斩（每 4 帧一段）
const ORB_COST = 25;        // 水月の術
const VAMP_COST = 20;       // 血飲：吸血 buff
const VAMP_TIME = 180;      // 3 秒
const VAMP_CD = 480;        // 8 秒
const VAMP_RATIO = 0.3;     // 造成伤害的 30% 回血

type State = 'idle' | 'run' | 'air' | 'attack' | 'launcher' | 'flurry' | 'dash' | 'hit' | 'dead';

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

  hitTimer = 0;
  invTimer = 0;      // 受击后/瞬身中的无敌帧
  coyote = 0;        // 土狼时间：离开平台边缘后短暂可跳
  airJumps = 0;
  throwCd = 0;
  vampTimer = 0;     // 吸血 buff 剩余帧数
  vampCd = 0;        // 吸血技能 CD
  t = 0;             // 动画时钟（逻辑帧递增）
  god = false;       // 开发者无敌（?debug=1 按 G）
  poisonTimer = 0;   // 蛊毒：持续掉血 + 减速

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }

  currentSpec(): AttackSpec | null {
    return this.state === 'attack' ? BLADE[this.attackStage - 1] : null;
  }

  /** 当前攻击的伤害规格（三段刀 / 腾空击 / 七十二斩单段），供 combat 使用 */
  attackSpec(): { dmg: number; kbx: number; kby: number; hitstun: number; heavy: boolean } | null {
    if (this.state === 'launcher') return { dmg: 8, kbx: 1, kby: -9, hitstun: 14, heavy: true };
    if (this.state === 'flurry') return { dmg: 3, kbx: 0.5, kby: -1, hitstun: 6, heavy: false };
    const s = this.currentSpec();
    if (s) return { ...s, heavy: this.attackStage === 3 };
    return null;
  }

  /** 攻击判定框：仅在判定帧内存在 */
  getAttackHitbox(): Rect | null {
    if (this.state === 'launcher') {
      // 起手即判定（角色迅速上升，判定框向下加大覆盖地面敌人）
      if (this.attackTimer < 1 || this.attackTimer > 6) return null;
      return { x: this.x - 8, y: this.y - 26, w: this.w + 16, h: 60 };
    }
    if (this.state === 'flurry') {
      return { x: this.centerX - 34, y: this.centerY - 30, w: 68, h: 60 };
    }
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

  /** 吸血：开启血饮 buff 时，按伤害比例回血（取整） */
  applyVamp(dmg: number): void {
    if (this.vampTimer > 0) {
      this.hp = Math.min(this.maxHp, this.hp + Math.floor(dmg * VAMP_RATIO));
    }
  }

  /** 蛊毒掉血（不触发硬直） */
  dot(dmg: number): void {
    if (this.god || this.state === 'dead') return;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) this.state = 'dead';
  }

  takeHit(dmg: number, dirX: number, w: World): void {
    if (this.god) return;
    if (this.state === 'dead' || this.state === 'dash' || this.invTimer > 0) return;
    this.hp = Math.max(0, this.hp - dmg);
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

  update(w: World): void {
    this.t++;
    if (this.state === 'dead') return;

    if (this.invTimer > 0) this.invTimer--;
    if (this.dashCd > 0) this.dashCd--;
    if (this.throwCd > 0) this.throwCd--;
    if (this.vampTimer > 0) this.vampTimer--;
    if (this.vampCd > 0) this.vampCd--;
    if (this.coyote > 0) this.coyote--;
    if (this.poisonTimer > 0) {
      this.poisonTimer--;
      if (this.poisonTimer % 30 === 0) this.dot(1);
    }

    const { stage, input, effects } = w;

    // 受击硬直
    if (this.state === 'hit') {
      this.hitTimer--;
      integrate(this, stage);
      if (this.hitTimer <= 0) this.state = this.onGround ? 'idle' : 'air';
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

    // 昇月斬（腾空击）：拔刀上挑，人随刀起
    if (this.state === 'launcher') {
      this.attackTimer++;
      integrate(this, stage);
      if (this.attackTimer >= 16) this.state = 'air';
      return;
    }

    // 朧乱舞（七十二斩）：空中悬停乱舞，每 4 帧一段判定
    if (this.state === 'flurry') {
      this.attackTimer++;
      this.vy = 0;
      this.vx *= 0.85;
      if (this.attackTimer % 4 === 0) this.attackId++; // 每段独立命中
      if (this.attackTimer >= FLURRY_TIME) {
        this.state = 'air';
      } else if (this.y + this.h >= stage.groundY && stage.hasGroundAt(this.centerX)) {
        this.y = stage.groundY - this.h; // 贴地则收招
        this.state = 'idle';
      }
      return;
    }

    const move = (input.isHeld('left') ? -1 : 0) + (input.isHeld('right') ? 1 : 0);
    const attacking = this.state === 'attack';

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

    // 昇月斬（U）：挑空起手式，可接朧乱舞/空中三段
    if (!attacking && this.ki >= LAUNCHER_COST && input.consume('skillU')) {
      this.ki -= LAUNCHER_COST;
      this.state = 'launcher';
      this.attackTimer = 0;
      this.attackId++;
      this.vy = LAUNCHER_VEL;
      this.onGround = false;
      this.airJumps = 1;
      effects.ring(this.centerX, this.y + this.h - 6);
    }

    // 朧乱舞（H）：空中连斩，重击/挑飞后的连招核心
    if (!attacking && this.ki >= FLURRY_COST && input.consume('skillH')) {
      this.ki -= FLURRY_COST;
      this.state = 'flurry';
      this.attackTimer = 0;
      this.attackId++;
      if (this.onGround) {
        this.vy = -6; // 地面发动先小跳
        this.onGround = false;
      }
    }

    // 水月の術（O）：一段放水弹，二段（或命中/到限）引爆
    if (!attacking && input.consume('skillO')) {
      const live = w.orbs.find((o) => !o.dead);
      if (live) {
        live.detonate = true;
      } else if (this.ki >= ORB_COST) {
        this.ki -= ORB_COST;
        w.orbs.push(new WaterOrb(this.centerX + this.facing * 20, this.y + 8, this.facing * 1.6));
      }
    }

    // 血飲（I）：消耗气开启吸血 buff，一段时间内造成伤害按比例回血
    if (!attacking && this.vampCd <= 0 && this.ki >= VAMP_COST && input.consume('vamp')) {
      this.ki -= VAMP_COST;
      this.vampTimer = VAMP_TIME;
      this.vampCd = VAMP_CD;
      effects.ring(this.centerX, this.y + this.h - 6);
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

    // 水平移动（中毒减速 30%）
    if (this.state !== 'attack') {
      const slow = this.poisonTimer > 0 ? 0.7 : 1;
      const accel = (this.onGround ? 0.6 : 0.35) * slow;
      if (move !== 0) {
        this.vx = clamp(this.vx + move * accel, -MOVE_MAX * slow, MOVE_MAX * slow);
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
    if (wasGround && !this.onGround && this.vy > 0) this.coyote = 6;

    // 落地取消挥刀
    if (this.state === 'attack' && this.onGround && !wasGround) {
      this.state = 'idle';
    }

    // 状态归纳（只在基础移动状态间归纳，不覆盖 attack/launcher/flurry 等动作状态）
    if (this.state === 'idle' || this.state === 'run' || this.state === 'air') {
      if (!this.onGround) this.state = 'air';
      else this.state = Math.abs(this.vx) > 0.3 ? 'run' : 'idle';
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
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
      state:
        this.state === 'launcher' ? 'air' :
        this.state === 'flurry' ? 'dash' : this.state,
      t: this.t,
      attackStage: this.attackStage,
      attackTimer: this.attackTimer,
    });
    ctx.globalAlpha = 1;

    // 朧乱舞：环绕刀光
    if (this.state === 'flurry') {
      const a = this.attackTimer * 0.5;
      for (let i = 0; i < 3; i++) {
        const ang = a + (i * Math.PI * 2) / 3;
        ctx.strokeStyle = i === 0 ? '#ffd24a' : '#ffffff';
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, 30, ang, ang + 1.6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 中毒染色
    if (this.poisonTimer > 0 && this.state !== 'dead') {
      ctx.globalAlpha = 0.25 + Math.sin(this.t * 0.2) * 0.08;
      ctx.fillStyle = '#5aa040';
      ctx.fillRect(this.x - 2, this.y - 4, this.w + 4, this.h + 4);
      ctx.globalAlpha = 1;
    }

    // 刀光弧
    const hb = this.getAttackHitbox();
    if (hb) drawSlashFx(ctx, hb, this.facing, this.attackStage);
  }
}
