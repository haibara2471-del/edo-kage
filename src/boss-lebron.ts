import { rand } from './rng';
import { clamp } from './types';
import type { Rect } from './types';
import { integrate } from './physics';
import { Arrow } from './projectile';
import { TowerBoss } from './tower-boss';
import { drawLebron } from './characters';
import type { World } from './world';

/**
 * 巨头（流窜抱团召唤）：一弓一冲撞，继承乐邦 20% 攻击值（2）/ 5% 血量（15），移速同乐邦。
 */
type GiantState = 'chase' | 'charge' | 'fire' | 'hit' | 'dead';
export class LebronGiant {
  readonly w = 26;
  readonly h = 40;
  vx = 0;
  vy = 0;
  facing = 1;
  onGround = false;
  state: GiantState = 'chase';
  timer = 0;
  atkCd = 0;
  flash = 0;
  lastHitId = 0;
  deadTimer = 0;
  t = 0;
  hp = 15;
  readonly maxHp = 15;
  readonly codexId = 'giant' as const;
  readonly contactDamage = 2; // 乐邦基础攻击 10 的 20%

  constructor(public x: number, public y: number, public kind: 'archer' | 'charger') {}

  get rect(): Rect { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  get centerX(): number { return this.x + this.w / 2; }
  get centerY(): number { return this.y + this.h / 2; }
  get dead(): boolean { return this.state === 'dead'; }
  get removable(): boolean { return this.state === 'dead' && this.deadTimer > 40; }

  takeHit(dmg: number, dirX: number, kbx: number, kby: number, hitstun: number): boolean {
    if (this.dead) return false;
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
    this.timer = hitstun;
    this.vx = dirX * kbx;
    this.vy = kby;
    return false;
  }

  getAttackHitbox(): Rect | null {
    if (this.state === 'charge') {
      return { x: this.facing > 0 ? this.x : this.x - 20, y: this.y + 4, w: this.w + 20, h: 28 };
    }
    return null;
  }

  update(w: World): void {
    const { stage, player } = w;
    this.t++;
    if (this.flash > 0) this.flash--;
    if (this.atkCd > 0) this.atkCd--;

    if (this.state === 'dead') {
      this.deadTimer++;
      if (this.deadTimer < 20) { this.vx *= 0.85; integrate(this, stage); }
      return;
    }
    if (this.state === 'hit') {
      this.timer--;
      integrate(this, stage);
      if (this.timer <= 0) this.state = 'chase';
      return;
    }

    const dx = player.centerX - this.centerX;
    this.facing = dx > 0 ? 1 : -1;

    if (this.kind === 'archer') {
      // 弓手：保持距离，隔段时间射箭
      if (this.state === 'fire') {
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'chase';
      } else {
        this.state = 'chase';
        if (Math.abs(dx) < 320 && this.atkCd <= 0) {
          this.state = 'fire';
          this.timer = 24;
          this.atkCd = 100;
          w.arrows.push(new Arrow(this.centerX + this.facing * 18, this.y + 14, this.facing * 7, { dmg: 2 }));
        }
        this.vx = Math.abs(dx) > 190 ? this.facing * 2 : (Math.abs(dx) < 90 ? -this.facing * 1.2 : 0);
      }
    } else {
      // 冲撞：贴近时蓄力冲撞
      if (this.state === 'charge') {
        this.vx = this.facing * 8;
        if (--this.timer <= 0) { this.state = 'chase'; this.atkCd = 70; }
      } else {
        this.state = 'chase';
        if (Math.abs(dx) < 120 && this.atkCd <= 0) { this.state = 'charge'; this.timer = 22; }
        this.vx = Math.abs(dx) > 40 ? this.facing * 2 : 0;
      }
    }
    integrate(this, stage);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'dead') ctx.globalAlpha = Math.max(0, 1 - this.deadTimer / 40);
    drawLebron(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
      phase: 1,
      giant: this.kind,
    });
    ctx.globalAlpha = 1;
  }
}

/**
 * 乐邦·摊母私（塔顶终极 Boss）：骑士/热火/湖人三队合一的球王恶搞。
 * 三阶段（≤200/≤100，进阶段 maxHp=当前血量）、狂野免疫控制、每 6s 回 1 血；
 * 认父（父爱印记-40%）/ 流窜抱团（召唤两巨头）/ 惊天一跪（一分雨）/
 * 七脏诀（虚影 7 段百分比连击）/ 媒体之星（±1）。
 */
type LebronState = 'idle' | 'walk' | 'dunkWindup' | 'dunk' | 'father' | 'kneel' | 'team' | 'qijue' | 'recover' | 'win' | 'dead';

interface Whistle { x: number; y: number; vy: number; }

export class LebronBoss extends TowerBoss {
  readonly name = '樂邦·攤母私';
  readonly codexId = 'lebron' as const;

  ki = 200;
  readonly maxKi = 200;
  phase = 1;           // 1/2/3
  markTimer = 0;       // 父爱印记剩余帧（玩家对 Boss 伤害 -40%）
  fatherCd = 400;      // 认父 CD（25s=1500f，开局短）
  teamCd = 800;        // 流窜抱团 CD（40s=2400f）
  qijueCd = 1200;      // 七脏诀 CD（30s=1800f）
  private phaseDamage = 0; // 本阶段累计受击（惊天一跪判定）
  private kneelUsed = false;
  private rainTimer = 0;   // 一分雨剩余帧
  private rainHits = 0;    // 玩家累计被哨子命中
  private whistleCd = 0;
  private whistles: Whistle[] = [];
  private speedBoost = 0;
  private qijueHit = 0;
  private qijueTimer = 0;
  private dunkHit = false; // 灌篮命中（回气用）
  private regenTick = 0;
  private kiRegenTick = 0;
  private fatherSide = 1;  // 认父时屁股朝向（面向玩家一侧）

  constructor(x: number, y: number) {
    super(x, y, 300);
  }

  get contactDamage(): number {
    const m = this.phase >= 3 ? 1 : 0; // 媒体之星：造成伤害 +1
    return this.state === 'dunk' ? 10 + m : 0;
  }

  getAttackHitbox(): Rect | null {
    if (this.state === 'dunk') {
      if (this.timer < 3 || this.timer > 10) return null;
      return { x: this.facing > 0 ? this.x + this.w - 6 : this.x - 34, y: this.y - 6, w: 40, h: 40 };
    }
    return null;
  }

  /** 狂野：免疫控制（不吃硬直/击退/眩晕），只吃伤害；七脏诀虚影不可选中 */
  takeHit(dmg: number, _dirX: number, _kbx: number, _kby: number, _hitstun: number): boolean {
    if (this.state === 'dead' || this.state === 'qijue') return false;
    let d = dmg;
    if (this.markTimer > 0) d = Math.floor(dmg * 0.6);  // 父爱印记：伤害 -40%
    if (this.phase >= 3) d = Math.max(1, d - 1);        // 媒体之星：受伤固定 -1
    this.hp -= d;
    this.flash = 6;
    this.phaseDamage += d;
    this.checkPhase();
    if (this.hp <= 0) {
      this.state = 'dead';
      this.deadTimer = 0;
      this.vx = 0;
      this.vy = 0;
      return true;
    }
    return false;
  }

  private checkPhase(): void {
    const np = this.hp <= 100 ? 3 : this.hp <= 200 ? 2 : 1;
    if (np > this.phase) {
      this.phase = np;
      this.maxHp = this.hp;   // 进阶段：血量上限调整为当前血量
      this.phaseDamage = 0;
      this.kneelUsed = false;
    }
  }

  private gainKi(n: number): void {
    this.ki = Math.min(this.maxKi, this.ki + n);
  }

  private summonGiants(w: World): void {
    const alive = w.enemies.filter((e) => e instanceof LebronGiant && !e.dead).length;
    if (alive >= 2) return; // 已有两个巨头 → 不叠加
    w.enemies.push(new LebronGiant(this.x + 50, w.stage.groundY - 40, 'archer'));
    w.enemies.push(new LebronGiant(this.x - 50, w.stage.groundY - 40, 'charger'));
  }

  private updateRain(w: World): void {
    const { player } = w;
    if (this.whistleCd-- <= 0) {
      this.whistleCd = 30; // 每 30 帧（0.5s）落一个哨子
      this.whistles.push({ x: player.centerX + (rand() * 160 - 80), y: player.y - 220, vy: 0 });
    }
    for (let i = this.whistles.length - 1; i >= 0; i--) {
      const s = this.whistles[i];
      s.vy += 0.55;
      s.y += s.vy;
      if (s.y > w.stage.groundY) { this.whistles.splice(i, 1); continue; }
      if (s.x > player.x && s.x < player.x + player.w && s.y > player.y && s.y < player.y + player.h) {
        this.whistles.splice(i, 1);
        player.dot(1); // 一分雨：1 点伤害（不触发硬直/无敌）
        this.rainHits++;
        if (this.rainHits >= 6) {
          this.rainHits = 0;
          player.stun = 120; // 累计 6 次 → 眩晕 2s
        }
      }
    }
  }

  protected ai(w: World): void {
    const { player, stage } = w;
    const dx = player.centerX - this.centerX;
    const adx = Math.abs(dx);

    // 资源：气缓慢回 + 每 6s 回 1 血（走步回血）
    if (++this.kiRegenTick >= 10) { this.kiRegenTick = 0; this.gainKi(3); }
    if (++this.regenTick >= 360) { this.regenTick = 0; this.hp = Math.min(this.maxHp, this.hp + 1); }
    if (this.markTimer > 0) this.markTimer--;
    if (this.speedBoost > 0) this.speedBoost--;
    if (this.fatherCd > 0) this.fatherCd--;
    if (this.teamCd > 0) this.teamCd--;
    if (this.qijueCd > 0) this.qijueCd--;

    if (this.rainTimer > 0) {
      this.rainTimer--;
      this.updateRain(w);
    }

    if (player.state === 'dead') {
      this.state = 'win'; // 胜利：霸王步 + 戴冠
      this.vx = 0;
      return;
    }

    // 惊天一跪：二阶段起，本阶段受击超 20% 触发一次（限定技）
    if (this.phase >= 2 && !this.kneelUsed && this.phaseDamage >= this.maxHp * 0.2 && this.state === 'walk') {
      this.state = 'kneel';
      this.timer = 120;     // 下跪僵直 2s
      this.rainTimer = 360; // 一分雨 6s
      this.whistleCd = 0;
      this.rainHits = 0;
      this.kneelUsed = true;
      this.vx = 0;
      return;
    }

    const speed = 2.4 * (this.phase >= 2 ? 1.15 : 1) * (this.speedBoost > 0 ? 1.23 : 1);

    switch (this.state) {
      case 'dunkWindup':
        this.vx = 0;
        if (--this.timer <= 0) { this.state = 'dunk'; this.timer = 14; this.dunkHit = false; }
        break;

      case 'dunk': {
        // 命中回气（每造成一次伤害回 5 气）
        const hb = this.getAttackHitbox();
        if (hb && !this.dunkHit) {
          const overlap = hb.x + hb.w > player.x && hb.x < player.x + player.w && hb.y + hb.h > player.y && hb.y < player.y + player.h;
          if (overlap) { this.dunkHit = true; this.gainKi(5); }
        }
        this.vx = this.facing * 1.2;
        if (--this.timer <= 0) {
          this.state = 'recover';
          this.timer = 20;
          this.atkCd = this.phase >= 3 ? 24 : 34;
        }
        break;
      }

      case 'father':
        this.vx = 0;
        if (--this.timer <= 0) {
          // 撅屁股对玩家一侧：玩家在屁股侧 → 挂父爱印记；跑前面可躲
          const behind = this.fatherSide > 0 ? player.centerX > this.centerX : player.centerX < this.centerX;
          if (behind) {
            this.markTimer = 180; // 印记 3s
            player.lebronMark = 180; // 玩家头顶显示
          }
          this.state = 'recover';
          this.timer = 20;
          this.atkCd = 50;
        }
        break;

      case 'kneel':
        this.vx = 0;
        if (--this.timer <= 0) { this.state = 'recover'; this.timer = 20; this.atkCd = 40; }
        break;

      case 'team':
        this.vx = 0;
        if (--this.timer <= 0) {
          this.summonGiants(w);
          this.speedBoost = 300; // 移速 +23%，5s
          this.state = 'recover';
          this.timer = 30;
          this.atkCd = 60;
        }
        break;

      case 'qijue':
        this.facing = dx > 0 ? 1 : -1;
        this.vx = this.facing * 5; // 虚影追着打（位移交给 base 的 integrate）
        if (++this.qijueTimer >= 18) {
          this.qijueTimer = 0;
          this.qijueHit++;
          if (this.qijueHit > 7) {
            this.state = 'recover';
            this.timer = 30;
            this.atkCd = 50;
            break;
          }
          // 每段 5% 当前生命（min 1），7 段不间断；末段击退。dot 不触发硬直/无敌 → 全中
          const pct = Math.max(1, Math.floor(player.hp * 0.05));
          player.dot(pct);
          if (this.qijueHit === 7) {
            player.vx = this.facing * 6;
            player.vy = -3;
          }
          this.gainKi(5); // 命中回气
          if (player.hp <= 0) return; // 玩家被七脏诀打死（ai 顶部已窄化 player.state，用 hp 判）
        }
        break;

      case 'recover':
        this.vx = 0;
        if (--this.timer <= 0) this.state = 'walk';
        break;

      case 'win':
        this.vx = 0;
        break;

      default: {
        this.state = 'walk';
        this.facing = dx > 0 ? 1 : -1;
        if (this.atkCd <= 0) {
          if (this.phase >= 3 && this.qijueCd <= 0 && this.ki >= 70 && adx < 320 && rand() < 0.5) {
            this.state = 'qijue';
            this.qijueHit = 0;
            this.qijueTimer = 0;
            this.qijueCd = 1800;
            this.ki -= 70;
            this.facing = dx > 0 ? 1 : -1;
          } else if (this.phase >= 2 && this.teamCd <= 0 && this.ki >= 50 && rand() < 0.5) {
            this.state = 'team';
            this.timer = 24;
            this.teamCd = 2400;
            this.ki -= 50;
          } else if (this.fatherCd <= 0 && this.ki >= 30 && adx < 300 && rand() < 0.45) {
            this.state = 'father';
            this.timer = 45;
            this.fatherCd = 1500;
            this.ki -= 30;
            this.fatherSide = dx > 0 ? 1 : -1; // 屁股朝玩家一侧
            this.facing = -this.fatherSide;    // 转过身，屁股对着玩家
          } else if (adx < 60) {
            this.state = 'dunkWindup';
            this.timer = 16;
            this.vx = 0;
          }
        }
        if (this.state === 'walk') this.vx = adx > 40 ? this.facing * speed : 0;
      }
    }
    this.x = clamp(this.x, 0, stage.width - this.w);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const phantom = this.state === 'qijue';
    if (phantom) ctx.globalAlpha = 0.55; // 七脏诀虚影
    drawLebron(ctx, this.x, this.y, this.w, this.h, this.facing, {
      state: this.state,
      t: this.t,
      timer: this.timer,
      flash: this.flash,
      phase: this.phase,
      mark: this.markTimer,
      qijueHit: this.qijueHit,
    });
    ctx.globalAlpha = 1;

    // 一分雨：哨子
    for (const s of this.whistles) {
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b8860b';
      ctx.fillRect(s.x - 4, s.y - 2, 8, 2);
      ctx.fillRect(s.x - 1, s.y - 2, 2, 5);
    }

    // 父爱印记提示（Boss 头顶）
    if (this.markTimer > 0) {
      ctx.fillStyle = '#ff9ac8';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('父愛', this.centerX, this.y - 10);
    }
    // 七脏诀段数提示
    if (this.state === 'qijue') {
      ctx.fillStyle = '#e8e4c8';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`七臟·${this.qijueHit}/7`, this.centerX, this.y - 12);
    }
  }
}
