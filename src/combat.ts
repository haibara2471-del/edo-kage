import { rectsOverlap } from './types';
import type { WaterOrb } from './projectile';
import type { World } from './world';
import { PlayerHittable } from './player-hittable';

/** 每帧判定：玩家刀光/技能 vs 敌人、手里剑 vs 敌人、敌人攻击/箭矢 vs 玩家 */
export function resolveCombat(w: World): void {
  const { player, enemies, projectiles, effects, codex } = w;

  // 先快照玩家攻击判定（供下方刀光结算用）：若敌人攻击先命中，玩家进 hit 态后
  // attackSpec()/getAttackHitbox() 会变 null；快照保证"同帧互拼 = 换血"（玩家反馈：
  // 行进边挥砍同帧互拼敌人攻击被吃掉 → 看起来无敌）。
  const spec = player.attackSpec();
  const hb = player.getAttackHitbox();
  const src = player.state === 'launcher' ? 'skillU' : player.state === 'flurry' ? 'skillH' : 'blade';

  // 敌人攻击命中玩家：先结算，让同帧互拼时敌人的攻击也造成伤害+击退（玩家反馈#1）
  for (const e of enemies) {
    const eb = e.getAttackHitbox();
    if (!eb) continue;
    if (rectsOverlap(eb, player.rect)) {
      if (e instanceof PlayerHittable) {
        const as = e.player.attackSpec();
        if (as) player.takeHit(as.dmg, e.player.facing, w);
      } else {
        player.takeHit(e.contactDamage, e.centerX < player.centerX ? 1 : -1, w);
      }
    }
  }

  // 短刀 / 昇月斬 / 朧乱舞 命中
  if (spec && hb) {
    for (const e of enemies) {
      if (e.dead || e.lastHitId === player.attackId) continue;
      if (rectsOverlap(hb, e.rect)) {
        e.lastHitId = player.attackId;
        const died = e.takeHit(spec.dmg, player.facing, spec.kbx, spec.kby, spec.hitstun);
        if ('onHitConfirm' in player) (player as { onHitConfirm: () => void }).onHitConfirm(); // 命中回气
        player.applyVamp(spec.dmg); // 吸血 buff
        codex.mark(e.codexId);
        w.lastHits.push({ src, dmg: spec.dmg });
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
        w.lastHits.push({ src: 'shuriken', dmg: p.dmg });
        player.applyVamp(p.dmg); // 吸血 buff
        effects.shurikenHit(p.x, p.y, p.dmg);
        if (died) effects.death(e.centerX, e.centerY);
        break;
      }
    }
  }

  // 箭矢/钩索命中玩家（钩索把人往施术者方向猛拽）
  for (const a of w.arrows) {
    if (a.dead) continue;
    if (rectsOverlap(a.rect, player.rect)) {
      a.dead = true;
      let dir = Math.sign(a.vx);
      if (a.pull) {
        // 钟馗式猛拽：拉向钩使当前位置（玩家反馈#3），不拉回出钩原点
        const t = a.pullTarget && !a.pullTarget.dead ? a.pullTarget : null;
        dir = t ? Math.sign(t.centerX - player.centerX) || 1 : -dir;
      }
      player.takeHit(a.dmg, dir, w);
      if (a.pull) {
        player.vx = dir * 10;
        player.vy = -2;
      }
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
      w.lastHits.push({ src: 'skillO', dmg: 22 });
      w.codex.mark(e.codexId);
      if (died) w.effects.death(e.centerX, e.centerY);
    }
  }
}
