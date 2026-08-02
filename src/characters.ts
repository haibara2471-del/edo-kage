import type { Rect } from './types';

/** 程序化角色绘制：用基础图形拼出带姿态动画的忍者与足轻（零素材、零贴图成本） */

type Pal = Record<string, string>;

const NINJA: Pal = {
  cloth: '#33468a', clothD: '#273770', trim: '#5a72b8',
  skin: '#f0d0a0', belt: '#b84552', scarf: '#e05060',
  blade: '#f0f4ff', boots: '#1e2a50', metal: '#b8c2d8',
};
const SILHOUETTE: Pal = Object.fromEntries(Object.keys(NINJA).map((k) => [k, '#1a2140']));

export interface NinjaPose {
  state: 'idle' | 'run' | 'air' | 'attack' | 'dash' | 'hit' | 'dead';
  t: number;
  attackStage?: number;
  attackTimer?: number;
}

function r(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

/** 腿：髋部旋转的单节肢 + 向前伸出的足袋 */
function leg(ctx: CanvasRenderingContext2D, px: number, py: number, a: number, cloth: string, boots: string): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  r(ctx, -2.2, 0, 4.4, 12, cloth);
  r(ctx, -2.2, 10.5, 7, 4, boots);
  ctx.restore();
}

/** 臂：肩部旋转，可选握刀（reverse grip = 忍者反手握，刀锋沿小臂向后） */
function arm(
  ctx: CanvasRenderingContext2D, px: number, py: number, a: number,
  cloth: string, skin: string, P?: Pal, bladeOff = 0,
): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  r(ctx, -1.75, 0, 3.5, 11, cloth);
  r(ctx, -1.5, 10, 3, 3, skin);
  if (P) {
    ctx.translate(0, 11.5);
    ctx.rotate(bladeOff);
    r(ctx, -1.2, -2.4, 2.4, 4.8, P.belt);   // 镡
    r(ctx, 0, -1.1, 15, 2.2, P.blade);      // 刀身
    r(ctx, 0, -1.1, 15, 0.9, P.metal);      // 刃纹
  }
  ctx.restore();
}

/**
 * 忍者：原点在两脚之间、面向 +x（调用方负责 scale(facing,1) 翻转）
 * 身高约 41px，比碰撞盒略高，头部有兜帽、护额、红围巾
 */
export function drawNinja(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  facing: number, pose: NinjaPose, silhouette = false,
): void {
  const P = silhouette ? SILHOUETTE : NINJA;
  const t = pose.t;
  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.scale(facing, 1);

  if (pose.state === 'dead') {
    r(ctx, -14, -9, 24, 9, P.cloth);          // 躯干
    r(ctx, 9, -10, 10, 10, P.clothD);         // 头
    r(ctx, 13, -7.5, 4.5, 2.6, P.skin);       // 脸
    r(ctx, -22, -6.5, 8, 3, P.scarf);         // 围巾
    r(ctx, -6, -11.5, 13, 2, P.blade);        // 脱手的短刀
    ctx.restore();
    return;
  }

  // —— 姿态参数 ——
  let lean = 0, bob = 0;
  let legF = 0.06, legB = -0.06, armF = 0.22, armB = -0.3;
  let reverseGrip = true;
  let scarfWind = 0;

  switch (pose.state) {
    case 'idle':
      bob = Math.sin(t * 0.06) * 0.7;
      armF = 0.22 + Math.sin(t * 0.06) * 0.05;
      break;
    case 'run': {
      const c = t * 0.3;
      legF = Math.sin(c) * 0.75;
      legB = -legF;
      armF = -Math.sin(c) * 0.55 + 0.25;
      armB = Math.sin(c) * 0.55 - 0.3;
      lean = 0.16;
      bob = -Math.abs(Math.sin(c)) * 1.2;
      scarfWind = 1;
      break;
    }
    case 'air':
      legF = 0.85; legB = -0.55;
      armF = -0.7; armB = 0.55;
      lean = 0.1; scarfWind = 1.3;
      break;
    case 'attack': {
      const s = pose.attackStage ?? 1;
      const tm = pose.attackTimer ?? 0;
      reverseGrip = false;
      if (s === 1) {                        // 横斩：刀从后上方抡向前方
        const p = Math.min(1, tm / 8);
        armF = -2.1 + p * 2.7;
        lean = 0.1 + p * 0.18;
        legF = 0.3; legB = -0.4;
      } else if (s === 2) {                 // 回斩：反向撩刀
        const p = Math.min(1, tm / 9);
        armF = 0.5 - p * 2.8;
        lean = 0.26 - p * 0.1;
        legF = -0.35; legB = 0.4;
      } else {                              // 突刺：低身前送
        const p = Math.min(1, tm / 10);
        armF = -0.1;
        lean = 0.28 + p * 0.24;
        legF = -0.75; legB = 0.95;
      }
      armB = -armF * 0.5 - 0.4;
      scarfWind = 0.9;
      break;
    }
    case 'dash':
      lean = 0.85; legF = -0.8; legB = -1.25;
      armF = -1.5; armB = -1.75; scarfWind = 2.2;
      break;
    case 'hit':
      lean = -0.3; armF = -0.9; armB = 0.9; legF = 0.5; legB = -0.6;
      break;
  }

  ctx.translate(0, bob);
  ctx.rotate(lean);

  // 围巾（身后三段，速度越快越水平）
  for (let i = 0; i < 3; i++) {
    const wave = Math.sin(t * 0.18 - i * 0.9) * Math.max(0.3, 1.6 - scarfWind * 0.6);
    r(ctx, -8 - i * 5.5, -31 - i * (0.5 + scarfWind * 1.1) + wave * (0.4 + i * 0.45), 5.5, 3.4, P.scarf);
  }

  leg(ctx, -2, -16, legB, P.clothD, P.boots);
  leg(ctx, 2, -16, legF, P.cloth, P.boots);
  arm(ctx, -3, -28.5, armB, P.clothD, P.skin);

  // 躯干
  r(ctx, -5.5, -31, 11, 15.5, P.cloth);
  r(ctx, -5.5, -31, 11, 3, P.trim);
  r(ctx, -5.5, -19.5, 11, 3, P.belt);
  r(ctx, -8, -19, 2.6, 2.6, P.belt); // 腰带结

  // 头（兜帽 + 后垂帽尖）
  r(ctx, -5, -40.5, 10.5, 10, P.clothD);
  ctx.fillStyle = P.clothD;
  ctx.beginPath();
  ctx.moveTo(-5, -40.5);
  ctx.lineTo(-10, -35.5);
  ctx.lineTo(-5, -32.5);
  ctx.closePath();
  ctx.fill();
  r(ctx, 0.5, -38.5, 5, 2.2, P.metal);    // 护额
  r(ctx, 0.5, -36, 5, 3.4, P.skin);       // 脸
  r(ctx, 3, -35.3, 1.7, 1.7, silhouette ? P.skin : '#101018'); // 眼

  // 前臂 + 短刀
  arm(ctx, 3, -28.5, armF, P.cloth, P.skin, P, reverseGrip ? Math.PI : 0);

  ctx.restore();
}

/** 刀光：判定帧内沿判定框画两道弧光 */
export function drawSlashFx(ctx: CanvasRenderingContext2D, hb: Rect, facing: number, stage: number): void {
  const cx = facing > 0 ? hb.x : hb.x + hb.w;
  const cy = hb.y + hb.h / 2;
  const R = hb.w * 0.95;
  const a0 = -1.0, a1 = 0.55;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = stage === 3 ? '#ffd24a' : '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (facing > 0) ctx.arc(cx, cy, R, a0, a1);
  else ctx.arc(cx, cy, R, Math.PI - a1, Math.PI - a0);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (facing > 0) ctx.arc(cx, cy, R * 0.72, a0 * 0.8, a1 * 0.8);
  else ctx.arc(cx, cy, R * 0.72, Math.PI - a1 * 0.8, Math.PI - a0 * 0.8);
  ctx.stroke();
  ctx.restore();
}

// ———————————————— 飞行敌人（乌鸦 / 蝙蝠） ————————————————

export type FlyerKind = 'crow' | 'bat';

const CROW: Pal = { body: '#3a3266', wing: '#4c4188', beak: '#e8bc50', eye: '#ff5560' };
const BAT: Pal = { body: '#5a4a80', wing: '#6c5a96', beak: '#5a4a80', eye: '#ff7560' };

function wing(
  ctx: CanvasRenderingContext2D, px: number, py: number, a: number,
  color: string, len: number, webbed: boolean,
): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  if (webbed) {
    // 蝙蝠膜翼：三角形
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-len, -2);
    ctx.lineTo(-len * 0.6, 3.5);
    ctx.closePath();
    ctx.fill();
  } else {
    // 鸟翼：主羽 + 覆羽
    r(ctx, -len, -1.5, len, 3, color);
    r(ctx, -len * 0.7, 1, len * 0.5, 2, color);
  }
  ctx.restore();
}

export function drawFlyer(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  facing: number, kind: FlyerKind, t: number, state: string, flash: number,
): void {
  const base = kind === 'crow' ? CROW : BAT;
  const white = flash > 0 || (state === 'telegraph' && Math.floor(t / 3) % 2 === 0);
  const P: Pal = white ? { body: '#ffffff', wing: '#ffffff', beak: '#ffffff', eye: '#ffffff' } : base;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(facing, 1);

  const flap =
    state === 'dive' ? -0.9 :
    state === 'dead' ? 1.2 :
    Math.sin(t * (kind === 'bat' ? 0.7 : 0.45)) * 0.9;

  if (kind === 'crow') {
    r(ctx, -12, -1.5, 6, 3, P.wing);                    // 尾羽
    wing(ctx, -1, -1, -flap, P.wing, 11, false);        // 远侧翼
    ctx.fillStyle = P.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(6, -3, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = P.beak;                             // 喙
    ctx.beginPath();
    ctx.moveTo(8.5, -4);
    ctx.lineTo(13, -2.5);
    ctx.lineTo(8.5, -1.5);
    ctx.closePath();
    ctx.fill();
    r(ctx, 6.5, -4, 1.4, 1.4, P.eye);                   // 眼
    wing(ctx, 1, -1, flap, P.wing, 12, false);          // 近侧翼
  } else {
    wing(ctx, -1, 0, -flap * 0.8, P.wing, 9, true);
    ctx.fillStyle = P.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 5.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3.5, -2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();                                    // 耳
    ctx.moveTo(2, -4.5);
    ctx.lineTo(3, -7.5);
    ctx.lineTo(4.5, -4.5);
    ctx.closePath();
    ctx.fill();
    r(ctx, 4, -3, 1.3, 1.3, P.eye);
    wing(ctx, 1, 0, flap * 0.8, P.wing, 10, true);
  }

  ctx.restore();
}

// ———————————————— 精英怪：钩使 / 大力金刚 / 蛊术师 ————————————————

const HOOK: Pal = {
  armor: '#5a6a7a', armorD: '#46525e', cloth: '#4a4458', skin: '#ecc090',
  straw: '#6a7078', strawD: '#4e545c', spear: '#8a94a8', blade: '#c8d0e0',
  boots: '#2e2a3c', belt: '#3a3428',
};
const WHITE_HOOK: Pal = whiten(HOOK);

/** 钩使：灰蓝甲 + 锁链钩，蓄力甩钩（闪白警告） */
export function drawHookSoldier(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  facing: number, pose: ArcherPose,
): void {
  const white = pose.flash > 0 || (pose.state === 'windup' && Math.floor(pose.timer / 3) % 2 === 0);
  const P = white ? WHITE_HOOK : HOOK;
  const t = pose.t;
  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.scale(facing, 1);

  if (pose.state === 'dead') {
    r(ctx, -15, -9, 26, 9, P.armor);
    r(ctx, 10, -10, 9, 9, P.cloth);
    r(ctx, -20, -3, 12, 2, P.spear); // 散落的锁链
    ctx.restore();
    return;
  }

  const walk = pose.state === 'chase' ? Math.sin(t * 0.22) : 0;
  ctx.translate(0, pose.state === 'chase' ? -Math.abs(walk) : 0);
  leg(ctx, -2, -14, walk * 0.5, P.cloth, P.boots);
  leg(ctx, 2, -14, -walk * 0.5, P.cloth, P.boots);
  arm(ctx, -3, -26, -0.4, P.cloth, P.skin);

  r(ctx, -6, -29, 12, 15, P.armor);
  r(ctx, -6, -25, 12, 2, P.armorD);
  r(ctx, -6, -21, 12, 2, P.armorD);
  r(ctx, -6, -16, 12, 3, P.belt);

  r(ctx, -4.5, -34, 9, 6, P.skin);
  r(ctx, 1, -32.3, 1.6, 1.6, white ? '#ffffff' : '#101018');
  r(ctx, -5.5, -35.5, 11, 3.5, P.straw);

  // 持钩臂：蓄力时后摆，其余前持
  const armA = pose.state === 'windup' ? 2.2 : 0.1;
  arm(ctx, 3, -26, armA, P.cloth, P.skin);
  // 镰刀钩（蓄力时后摆）+ 垂下的锁链
  const hx = pose.state === 'windup' ? -4 : 9;
  const hy = -14;
  ctx.strokeStyle = P.blade;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hx, hy, 4.5, -1.4, 1.2);
  ctx.stroke();
  ctx.fillStyle = P.spear;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(hx - 3 - i * 2, hy + 4 + i * 4, 2.5, 2.5);
  }

  ctx.restore();
}

const BRUISER: Pal = {
  skin: '#b06848', skinD: '#8a4c34', cloth: '#3a3040', belt: '#6a3028',
  band: '#c8b088', boots: '#2a2434',
};
const WHITE_BRUISER: Pal = whiten(BRUISER);

/** 大力金刚：赤膊巨汉，蓄力举拳过顶 → 砸地 */
export function drawBruiser(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  facing: number, pose: ArcherPose,
): void {
  const white = pose.flash > 0 || (pose.state === 'windup' && Math.floor(pose.timer / 4) % 2 === 0);
  const P = white ? WHITE_BRUISER : BRUISER;
  const t = pose.t;
  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.scale(facing, 1);

  if (pose.state === 'dead') {
    r(ctx, -18, -12, 32, 12, P.skin);
    r(ctx, 13, -11, 10, 10, P.skinD);
    ctx.restore();
    return;
  }

  const walk = pose.state === 'chase' ? Math.sin(t * 0.16) : 0;
  ctx.translate(0, pose.state === 'chase' ? -Math.abs(walk) * 1.2 : 0);

  // 粗腿开立
  leg(ctx, -5, -16, 0.3, P.skinD, P.boots);
  leg(ctx, 5, -16, -0.3, P.skinD, P.boots);

  // 双臂（蓄力举过顶，砸下时前送）
  let armF = -0.3, armB = -0.5;
  if (pose.state === 'windup') { armF = -2.6; armB = -2.9; }
  else if (pose.state === 'smash') { armF = 0.9; armB = 0.7; }
  ctx.save();
  ctx.translate(-5, -34);
  ctx.rotate(armB);
  r(ctx, -3, 0, 6, 18, P.skin);
  r(ctx, -3.5, 15, 7, 7, P.skinD); // 巨拳
  ctx.restore();

  // 粗壮躯干（赤膊）
  r(ctx, -9, -38, 18, 24, P.skin);
  r(ctx, -9, -20, 18, 6, P.cloth); // 兜裆布
  r(ctx, -9, -16, 18, 3, P.belt);
  r(ctx, -3, -34, 6, 8, P.skinD);  // 胸肌阴影

  // 头 + 发髻
  r(ctx, -4.5, -45, 9, 8, P.skin);
  r(ctx, 1.5, -42, 1.8, 1.8, white ? '#ffffff' : '#101018');
  r(ctx, -2, -48.5, 4, 4, P.cloth);
  r(ctx, -5, -40, 10, 2, P.band); // 卷袖带

  ctx.save();
  ctx.translate(5, -34);
  ctx.rotate(armF);
  r(ctx, -3, 0, 6, 18, P.skin);
  r(ctx, -3.5, 15, 7, 7, P.skinD);
  ctx.restore();

  ctx.restore();
}

const SHAMAN: Pal = {
  robe: '#5a3a6a', robeD: '#42294e', skin: '#c8b8a0', staff: '#6a5238',
  orb: '#7ee060', eye: '#7ee060',
};
const WHITE_SHAMAN: Pal = whiten(SHAMAN);

/** 蛊术师：紫袍兜帽 + 蛊杖，施法时举杖（杖顶蛊珠发亮） */
export function drawShaman(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  facing: number, pose: ArcherPose,
): void {
  const white = pose.flash > 0;
  const P = white ? WHITE_SHAMAN : SHAMAN;
  const t = pose.t;
  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.scale(facing, 1);

  if (pose.state === 'dead') {
    r(ctx, -14, -8, 24, 8, P.robe);
    r(ctx, 10, -8, 8, 8, P.robeD);
    r(ctx, -20, -2, 14, 2, P.staff);
    ctx.restore();
    return;
  }

  const walk = pose.state === 'chase' || pose.state === 'retreat' ? Math.sin(t * 0.2) : 0;
  ctx.translate(0, Math.sin(t * 0.07) * 0.6 + (walk !== 0 ? -Math.abs(walk) * 0.6 : 0));

  // 长袍（下摆遮脚，飘动感）
  ctx.fillStyle = P.robe;
  ctx.beginPath();
  ctx.moveTo(-7, -30);
  ctx.lineTo(7, -30);
  ctx.lineTo(9 + walk * 1.5, 0);
  ctx.lineTo(-9 + walk * 1.5, 0);
  ctx.closePath();
  ctx.fill();
  r(ctx, -7, -30, 14, 5, P.robeD);

  // 兜帽 + 阴影中的蛊眼
  r(ctx, -5, -40, 10, 11, P.robeD);
  r(ctx, -3.5, -36.5, 7, 5, '#12101c');
  r(ctx, 0.5, -35, 1.6, 1.6, P.eye);
  r(ctx, -2.5, -35, 1.2, 1.2, P.eye);

  // 蛊杖（施法时举起）
  const staffA = pose.state === 'windup' ? -1.2 : 0.15;
  ctx.save();
  ctx.translate(4, -26);
  ctx.rotate(staffA);
  r(ctx, -1, -14, 2, 30, P.staff);
  ctx.fillStyle = pose.state === 'windup' ? '#aaffaa' : P.orb;
  ctx.beginPath();
  ctx.arc(0, -16, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

const ASH: Pal = {
  armor: '#a04a56', armorD: '#7a3642', cloth: '#564a66', skin: '#ecc090',
  straw: '#a08858', strawD: '#7a6640', spear: '#c09860', blade: '#f0f4ff',
  boots: '#342e48', belt: '#4a3828', metal: '#b0bacf',
};
const WHITE: Pal = Object.fromEntries(Object.keys(ASH).map((k) => [k, '#ffffff']));

function whiten(p: Pal): Pal {
  return Object.fromEntries(Object.keys(p).map((k) => [k, '#ffffff']));
}

// ———————————————— 弓箭手 ————————————————

const ARCHER: Pal = {
  armor: '#3f6a5a', armorD: '#2e4c40', cloth: '#46405a', skin: '#ecc090',
  band: '#284a3e', bow: '#8a6a3a', string: '#d8d0b8', arrow: '#c09860',
  boots: '#2e2840', belt: '#4a3828',
};
const WHITE_ARCHER: Pal = whiten(ARCHER);

export interface ArcherPose {
  state: string;   // idle / aim / recover / hit / dead
  t: number;
  timer: number;
  flash: number;
}

/** 弓箭手：轻装绿甲 + 头巾，竖持长弓，瞄准后放箭（放箭前闪白警告） */
export function drawArcher(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  facing: number, pose: ArcherPose,
): void {
  const white = pose.flash > 0 || (pose.state === 'aim' && pose.timer < 12 && Math.floor(pose.t / 3) % 2 === 0);
  const P = white ? WHITE_ARCHER : ARCHER;
  const t = pose.t;
  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.scale(facing, 1);

  if (pose.state === 'dead') {
    r(ctx, -15, -9, 26, 9, P.armor);
    r(ctx, 10, -10, 9, 9, P.cloth);
    ctx.strokeStyle = P.bow; // 掉落的弓
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-14, -4, 8, -1.2, 1.2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const bob = pose.state === 'idle' ? Math.sin(t * 0.05) * 0.5 : 0;
  ctx.translate(0, bob);

  // 开立站姿
  leg(ctx, -3, -14, 0.28, P.cloth, P.boots);
  leg(ctx, 3, -14, -0.28, P.cloth, P.boots);

  // 后臂（拉弦手，瞄准时后收）
  arm(ctx, -3, -26, pose.state === 'aim' ? 0.9 : -0.4, P.cloth, P.skin);

  // 轻甲躯干
  r(ctx, -6, -29, 12, 15, P.armor);
  r(ctx, -6, -24, 12, 2, P.armorD);
  r(ctx, -6, -19, 12, 2, P.armorD);
  r(ctx, -6, -16, 12, 3, P.belt);

  // 头 + 头巾
  r(ctx, -4.5, -34, 9, 6, P.skin);
  r(ctx, 1, -32.3, 1.6, 1.6, white ? '#ffffff' : '#101018');
  r(ctx, -5, -35.5, 10, 3.5, P.band);
  r(ctx, -8, -34, 3.5, 2, P.band); // 头巾结

  // 前持弓臂
  arm(ctx, 3, -26, 0.05, P.cloth, P.skin);

  // 长弓（竖弧，弓口朝前）
  const bowX = 8;
  const bowY = -22;
  const tipY = 9.8;
  const pull = pose.state === 'aim' ? 8 : 0;
  ctx.strokeStyle = P.bow;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(bowX, bowY, 11, -1.1, 1.1);
  ctx.stroke();
  // 弓弦
  ctx.strokeStyle = P.string;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bowX + 5, bowY - tipY);
  ctx.lineTo(bowX + 5 - pull, bowY);
  ctx.lineTo(bowX + 5, bowY + tipY);
  ctx.stroke();
  // 搭箭（瞄准时可见）
  if (pose.state === 'aim') {
    ctx.strokeStyle = P.arrow;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bowX + 5 - pull, bowY);
    ctx.lineTo(bowX + 14, bowY);
    ctx.stroke();
    ctx.fillStyle = P.blade;
    ctx.fillRect(bowX + 12, bowY - 1.5, 3, 3);
  }

  ctx.restore();
}

export interface AshPose {
  state: string;
  t: number;
  timer: number;   // 当前状态剩余帧（用于蓄力闪白）
  flash: number;   // 受击白闪
}

export function drawAshigaru(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  facing: number, pose: AshPose,
): void {
  const white = pose.flash > 0 || (pose.state === 'windup' && Math.floor(pose.timer / 3) % 2 === 0);
  const P = white ? WHITE : ASH;
  const t = pose.t;
  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.scale(facing, 1);

  if (pose.state === 'dead') {
    r(ctx, -15, -9, 26, 9, P.armor);
    r(ctx, 10, -10, 9, 9, P.cloth);  // 头
    ctx.fillStyle = P.straw;         // 滚落的斗笠
    ctx.beginPath();
    ctx.moveTo(-21, 0);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-15, -6);
    ctx.closePath();
    ctx.fill();
    r(ctx, -18, -2.5, 30, 2, P.spear); // 掉落的枪
    ctx.restore();
    return;
  }

  let bob = 0, legF = 0.05, legB = -0.05, spearA = -1.15, lean = 0;
  switch (pose.state) {
    case 'chase': {
      const c = t * 0.22;
      legF = Math.sin(c) * 0.55;
      legB = -legF;
      bob = -Math.abs(Math.sin(c));
      spearA = -0.45 + Math.sin(c) * 0.06;
      lean = 0.08;
      break;
    }
    case 'windup': spearA = 2.45; lean = -0.12; legF = 0.35; legB = -0.45; break; // 拉枪蓄力
    case 'thrust': spearA = 0.04; lean = 0.35; legF = -0.6; legB = 0.85; break;   // 突刺前送
    case 'recover': spearA = -0.6; lean = 0.05; break;
    case 'hit': spearA = -1.5; lean = -0.28; legF = 0.4; legB = -0.5; break;
    default: bob = Math.sin(t * 0.05) * 0.5;
  }

  ctx.translate(0, bob);
  ctx.rotate(lean);

  leg(ctx, -2, -14, legB, P.cloth, P.boots);
  leg(ctx, 2, -14, legF, P.cloth, P.boots);
  arm(ctx, -3, -26, -0.4, P.cloth, P.skin);

  // 甲胄躯干（横板缀）
  r(ctx, -6, -29, 12, 15, P.armor);
  r(ctx, -6, -25, 12, 2, P.armorD);
  r(ctx, -6, -21, 12, 2, P.armorD);
  r(ctx, -6, -17, 12, 2, P.armorD);
  r(ctx, -7.5, -29, 3.5, 6, P.armorD); // 肩甲

  // 脸 + 阵笠
  r(ctx, -4.5, -34, 9, 6, P.skin);
  r(ctx, 1, -32.3, 1.6, 1.6, white ? '#ffffff' : '#101018');
  ctx.fillStyle = P.straw;
  ctx.beginPath();
  ctx.moveTo(-10, -33.5);
  ctx.quadraticCurveTo(0, -44, 10, -33.5);
  ctx.closePath();
  ctx.fill();
  r(ctx, -10.5, -34.5, 21, 2.5, P.strawD);

  // 前臂持枪：枪尖约 +44，与攻击判定框（身前 36+11≈47）基本对齐
  ctx.save();
  ctx.translate(3.5, -26);
  ctx.rotate(spearA);
  r(ctx, -1.75, 0, 3.5, 9, P.cloth);
  r(ctx, -1.5, 8, 3, 3, P.skin);
  ctx.translate(0, 9.5);
  r(ctx, -8, -1.2, 44, 2.4, P.spear);
  ctx.fillStyle = P.blade;
  ctx.beginPath();
  ctx.moveTo(36, -2.8);
  ctx.lineTo(45, 0);
  ctx.lineTo(36, 2.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}
