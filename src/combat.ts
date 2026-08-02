import { rectsOverlap } from './types';
import { BLADE } from './player';
import type { World } from './world';

/** 每帧判定：玩家刀光 vs 敌人、手里剑 vs 敌人、敌人攻击 vs 玩家 */
export function resolveCombat(w: World): void {
  const { player, enemies, projectiles, effects, codex } = w;

  // 短刀命中
  const hb = player.getAttackHitbox();
  if (hb) {
    const spec = BLADE[player.attackStage - 1];
    for (const e of enemies) {
      if (e.dead || e.lastHitId === player.attackId) continue;
      if (rectsOverlap(hb, e.rect)) {
        e.lastHitId = player.attackId;
        const died = e.takeHit(spec.dmg, player.facing, spec.kbx, spec.kby, spec.hitstun);
        player.onHitConfirm(); // 命中回气
        codex.mark(e.codexId);
        const cx = player.facing > 0 ? hb.x + hb.w : hb.x;
        effects.meleeHit(cx, e.centerY, spec.dmg, player.attackStage === 3);
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

  // 箭矢命中玩家
  for (const a of w.arrows) {
    if (a.dead) continue;
    if (rectsOverlap(a.rect, player.rect)) {
      a.dead = true;
      player.takeHit(a.dmg, Math.sign(a.vx), w);
    }
  }
}
