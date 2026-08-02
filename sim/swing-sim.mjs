// 摆荡物理模拟：验证「按住 I 连续接力过沟 + 振幅增长带来升高」
// 复刻 player.ts 的算法，调参后回写游戏代码
const G = 0.55, SWING_MAX = 12, ROPE_MAX = 340;
const groundY = 480;

// 场景：沟1 [1050,1350] 梁心 (1130,223) (1280,223)；起跑点 x=1030
const anchors = [{ x: 1130, y: 223 }, { x: 1280, y: 223 }];
const grounds = [[0, 1050], [1350, 1950]];

function simulate(PUMP, KICK, RELEASE_BOOST, verbose) {
  let p = { x: 1030, y: 444, vx: 3.4, vy: -9 }; // 沟边起跳瞬间开始
  let rope = null, cd = 0, lastA = null, lastUntil = -1, t = 0, minY = 444;
  const log = [];
  const hx = () => p.x + 10, hy = () => p.y + 10;

  function tryThrow() {
    let best = null, bd = ROPE_MAX;
    for (const a of anchors) {
      if (lastA && t < lastUntil && Math.hypot(a.x - lastA.x, a.y - lastA.y) < 30) continue;
      const ddx = a.x - hx(), ddy = a.y - hy();
      if (ddy > -16) continue;
      if (Math.abs(ddx) > 30 && Math.sign(ddx) !== 1) continue; // 只钩前方
      const d = Math.hypot(ddx, ddy);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) {
      rope = { ax: best.x, ay: best.y, len: Math.max(46, Math.hypot(hx() - best.x, hy() - best.y)), side: Math.sign(hx() - best.x) || -1 };
      p.vx += -rope.side * KICK; // 钩住瞬间朝目标侧的切向初速度
      log.push(`t${t} 钩住(${best.x}) 绳长${rope.len.toFixed(0)}`);
      return true;
    }
    return false;
  }

  while (t < 900) {
    t++;
    if (cd > 0) cd--;
    if (!rope) {
      if (cd <= 0 && !tryThrow()) cd = 5;
      p.vy += G; p.x += p.vx; p.y += p.vy;
    } else {
      p.vy += G;
      // 共振泵摆：沿当前切向运动方向加速
      let dx = hx() - rope.ax, dy = hy() - rope.ay;
      let dist = Math.hypot(dx, dy) || 1;
      const tx = -dy / dist, ty = dx / dist;
      const vt = p.vx * tx + p.vy * ty;
      if (Math.abs(vt) > 0.05) {
        p.vx += tx * Math.sign(vt) * PUMP;
        p.vy += ty * Math.sign(vt) * PUMP;
      }
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > SWING_MAX) { p.vx = p.vx / sp * SWING_MAX; p.vy = p.vy / sp * SWING_MAX; }
      p.x += p.vx; p.y += p.vy;
      // 绳长约束
      dx = hx() - rope.ax; dy = hy() - rope.ay; dist = Math.hypot(dx, dy);
      if (dist > rope.len && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        p.x = rope.ax + nx * rope.len - 10; p.y = rope.ay + ny * rope.len - 10;
        const vr = p.vx * nx + p.vy * ny;
        p.vx -= vr * nx; p.vy -= vr * ny;
      }
      // 自动松手：过支点另一侧、接近最高点
      const sideNow = Math.sign(hx() - rope.ax) || rope.side;
      if (sideNow !== rope.side && p.vy > -1) {
        p.vx *= 1.1; p.vy = Math.min(p.vy, -RELEASE_BOOST);
        lastA = { x: rope.ax, y: rope.ay }; lastUntil = t + 40; rope = null; cd = 10;
        log.push(`t${t} 松手 x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} v=(${p.vx.toFixed(1)},${p.vy.toFixed(1)})`);
      }
    }
    minY = Math.min(minY, p.y);
    if (p.vy >= 0 && p.y + 36 >= groundY && grounds.some(g => hx() >= g[0] && hx() <= g[1])) {
      log.push(`t${t} ★落地 x=${p.x.toFixed(0)}`);
      return { ok: p.x >= 1350, log, minY, t };
    }
    if (p.y > 540) { log.push(`t${t} ✗坠亡 x=${p.x.toFixed(0)}`); return { ok: false, log, minY, t }; }
  }
  log.push('超时未落地');
  return { ok: false, log, minY, t };
}

for (const [pump, kick, boost] of [[0.10, 3.5, 3], [0.15, 3.5, 3], [0.20, 3.5, 3], [0.15, 2.5, 3.5], [0.20, 2.5, 3.5], [0.25, 3.0, 3.5]]) {
  const r = simulate(pump, kick, boost, false);
  console.log(`PUMP=${pump} KICK=${kick} BOOST=${boost} → ${r.ok ? '成功过沟' : '失败'} 用时${r.t}t 最高点y=${r.minY.toFixed(0)}(起点444)`);
}
console.log('\n--- 最优参数轨迹 ---');
const best = simulate(0.20, 2.5, 3.5, true);
console.log(best.log.join('\n'));
