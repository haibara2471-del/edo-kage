interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string; gravity: number;
}

interface DmgNumber {
  x: number; y: number; vy: number; life: number; text: string; color: string; big: boolean;
}

interface Afterimage {
  x: number; y: number; w: number; h: number; life: number;
}

/** 打击感三件套：hit-stop（冻结帧）、屏幕震动、火花粒子，外加伤害数字和冲刺残影 */
export class Effects {
  freeze = 0;   // >0 时世界逻辑暂停（渲染继续）
  shake = 0;    // 震动幅度，自动衰减

  private particles: Particle[] = [];
  private numbers: DmgNumber[] = [];
  private afters: Afterimage[] = [];

  /** 短刀命中 */
  meleeHit(x: number, y: number, dmg: number, heavy: boolean): void {
    this.freeze = heavy ? 7 : 3;
    this.shake = heavy ? 7 : 3;
    this.sparks(x, y, heavy ? 16 : 9, '#ffffff');
    if (heavy) this.sparks(x, y, 6, '#ffd24a');
    this.numbers.push({ x, y: y - 12, vy: -0.8, life: 45, text: String(dmg), color: heavy ? '#ffd24a' : '#ffffff', big: heavy });
  }

  /** 手里剑命中 */
  shurikenHit(x: number, y: number, dmg: number): void {
    this.freeze = 2;
    this.shake = Math.max(this.shake, 1.5);
    this.sparks(x, y, 6, '#9fd8ff');
    this.numbers.push({ x, y: y - 12, vy: -0.8, life: 40, text: String(dmg), color: '#9fd8ff', big: false });
  }

  /** 玩家受击 */
  playerHit(x: number, y: number): void {
    this.freeze = 4;
    this.shake = 6;
    this.sparks(x, y, 12, '#ff5566');
  }

  /** 敌人死亡 */
  death(x: number, y: number): void {
    this.sparks(x, y, 22, '#ff5566');
    this.sparks(x, y, 10, '#8888aa');
    this.shake = Math.max(this.shake, 4);
  }

  /** 水月の術引爆 */
  orbExplode(x: number, y: number): void {
    this.freeze = 6;
    this.shake = 9;
    this.sparks(x, y, 26, '#5aa0ff');
    this.sparks(x, y, 14, '#e0f0ff');
    this.ring(x, y);
    this.numbers.push({ x, y: y - 30, vy: -0.9, life: 50, text: '22', color: '#9fd8ff', big: true });
  }

  /** 冲刺/落地扬尘 */
  puff(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI;
      this.particles.push({
        x, y, vx: Math.cos(a) * 1.2, vy: -Math.random() * 0.8,
        life: 18, maxLife: 18, size: 2.5, color: '#6670a0', gravity: 0.02,
      });
    }
  }

  /** 二段跳气环 */
  ring(x: number, y: number): void {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.particles.push({
        x, y, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2,
        life: 14, maxLife: 14, size: 2, color: '#9fd8ff', gravity: 0,
      });
    }
  }

  afterimage(x: number, y: number, w: number, h: number): void {
    this.afters.push({ x, y, w, h, life: 14 });
  }

  private sparks(x: number, y: number, n: number, color: string): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 3.5;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
        life: 20 + Math.random() * 12, maxLife: 32, size: 1.5 + Math.random() * 2, color, gravity: 0.12,
      });
    }
  }

  update(): void {
    this.shake *= 0.85;
    if (this.shake < 0.1) this.shake = 0;

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const n of this.numbers) {
      n.y += n.vy;
      n.vy *= 0.96;
      n.life--;
    }
    this.numbers = this.numbers.filter((n) => n.life > 0);

    for (const a of this.afters) a.life--;
    this.afters = this.afters.filter((a) => a.life > 0);
  }

  /** 世界坐标系下绘制（相机平移之后调用） */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    for (const a of this.afters) {
      ctx.globalAlpha = (a.life / 14) * 0.4;
      ctx.fillStyle = '#5f7cff';
      ctx.fillRect(a.x, a.y, a.w, a.h);
    }
    ctx.globalAlpha = 1;

    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.6));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const n of this.numbers) {
      ctx.globalAlpha = Math.min(1, n.life / 25);
      ctx.fillStyle = n.color;
      ctx.font = n.big ? 'bold 18px monospace' : 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(n.text, n.x, n.y);
    }
    ctx.globalAlpha = 1;
  }

  shakeOffset(): { x: number; y: number } {
    return {
      x: (Math.random() * 2 - 1) * this.shake,
      y: (Math.random() * 2 - 1) * this.shake * 0.6,
    };
  }
}
