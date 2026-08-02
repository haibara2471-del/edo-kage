import { rectsOverlap } from './types';
import type { WaterOrb } from './projectile';
import type { World } from './world';

/** 每帧判定：玩家刀光/技能 vs 敌人、手里剑 vs 敌人、敌人攻击/箭矢 vs 玩家 */
export function resolveCombat(w: World): void {
  const { player, enemies, projectiles, effects, codex } = w;

  // 短刀 / 昇月斬 / 朧乱舞 命中
  const spec = player.attackSpec();
  const hb = player.getAttackHitbox();
  if (spec && hb) {
    for (const e of enemies) {
      if (e.dead || e.lastHitId === player.attackId) continue;
      if (rectsOverlap(hb, e.rect)) {
        e.lastHitId = player.attackId;
        const died = e.takeHit(spec.dmg, player.facing, spec.kbx, spec.kby, spec.hitstun);
        player.onHitConfirm(); // 命中回气
        codex.mark(e.codexId);
        const cx = player.facing > 0 ? hb.x + hb.w : hb.x;
        effects.meleeHit(cx, e.centerY, spec.dmg, spec.heavy);
        if (died) effects.death(e.centerX, e.centerY);
      }
    }
  }

  // 手里剑命中
  for (const p of projectiles) {
    if (p.dead) continue;
    for (const e of enemies) {
      if (e.dead) continue;
      if (rectsOverlap(p.rect, e.rect)) {
        p.dead = true;
        const died = e.takeHit(p.dmg, Math.sign(p.vx), 1.5, 0, 8);
        codex.mark(e.codexId);
        effects.shurikenHit(p.x, p.y, p.dmg);
        if (died) effects.death(e.centerX, e.centerY);
        break;
      }
    }
  }

  // 敌人攻击命中玩家（长枪突刺 / 俯冲）
  for (const e of enemies) {
    const eb = e.getAttackHitbox();
    if (!eb) continue;
    if (rectsOverlap(eb, player.rect)) {
      player.takeHit(e.contactDamage, e.centerX < player.centerX ? 1 : -1, w);
    }
  }

  // 箭矢/钩索命中玩家（钩索把人往施术者方向拽）
  for (const a of w.arrows) {
    if (a.dead) continue;
    if (rectsOverlap(a.rect, player.rect)) {
      a.dead = true;
      player.takeHit(a.dmg, a.pull ? -Math.sign(a.vx) : Math.sign(a.vx), w);
    }
  }
}

/** 水月の術引爆：大范围伤害 + 强击退 */
export function explodeOrb(w: World, orb: WaterOrb): void {
  const R = 60;
  w.effects.orbExplode(orb.x, orb.y);
  for (const e of w.enemies) {
    if (e.dead) continue;
    if (Math.abs(e.centerX - orb.x) < R + 14 && Math.abs(e.centerY - orb.y) < R) {
      const dir = Math.sign(e.centerX - orb.x) || 1;
      const died = e.takeHit(22, dir, 4, -3, 18);
      w.codex.mark(e.codexId);
      if (died) w.effects.death(e.centerX, e.centerY);
    }
  }
}
