/**
 * 种子化随机数（mulberry32）：每局随机生成种子并记录，
 * 同种子 + 同输入序列 = 逐帧可复现（回放地基）。
 * 仅影响玩法的随机（Boss 残像、飞鸟相位等）走这里；纯装饰随机仍可用 Math.random。
 */
let s = 1;

export function reseed(seed: number): void {
  s = seed >>> 0 || 1;
}

export function rand(): number {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
