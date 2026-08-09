import { clamp } from './math';
import type { Frame } from './input';

/**
 * Aim assist, for thumbs.
 *
 * A mouse points at a pixel. A thumb points at roughly a third of the screen,
 * and it is also the thumb that steers — so on touch the aim that reaches the
 * simulation is always a little wrong, and for the ranged classes "a little
 * wrong" is a bolt sailing past the target's shoulder.
 *
 * So: find whatever is already roughly in front of the shade and bend the aim
 * onto it. Deliberately a *cone*, not a lock — it corrects the error the input
 * device introduces, it does not choose targets for the player. Point somewhere
 * with nothing in it and nothing happens.
 *
 * Never runs for mouse or gamepad input; see `Input.usingTouch`.
 */

export interface AimTarget {
  pos: { x: number; z: number };
  dead: boolean;
}

export interface AssistProfile {
  /** Nothing further than this can pull the aim. */
  range: number;
  /** Half-angle of the search cone, in radians. */
  cone: number;
  /** 0..1 — how much of the angular error is corrected. 1 snaps. */
  strength: number;
}

/**
 * Melee gets a nudge; ranged gets a snap.
 *
 * The difference is what the error costs. A sword swings through an arc, so
 * being ten degrees off still connects and the assist only has to stop the
 * shade facing the wrong way. A bolt is a line — ten degrees off at fifteen
 * metres is a clean miss — so within its cone the marksman's aim goes exactly
 * where the shot has to go.
 */
export const ASSIST: Record<'melee' | 'ranged', AssistProfile> = {
  melee: { range: 6.5, cone: 1.0, strength: 0.6 },
  ranged: { range: 20, cone: 0.85, strength: 1.0 },
};

/**
 * Bend `f`'s aim toward the best candidate. Mutates the frame and returns it,
 * so it can be dropped straight into the sampling call.
 */
export function assistAim(
  f: Frame,
  from: { x: number; z: number },
  targets: Iterable<AimTarget>,
  profile: AssistProfile
): Frame {
  const ax = f.aimX;
  const az = f.aimY;
  // A zero-length aim has no cone to search.
  if (!ax && !az) return f;

  let bestX = 0;
  let bestZ = 0;
  let bestAngle = 0;
  let bestScore = Infinity;

  for (const t of targets) {
    if (t.dead) continue;
    const dx = t.pos.x - from.x;
    const dz = t.pos.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.0001 || d > profile.range) continue;

    const nx = dx / d;
    const nz = dz / d;
    const angle = Math.acos(clamp(nx * ax + nz * az, -1, 1));
    if (angle > profile.cone) continue;

    // Angle dominates: the assist honours where the player pointed, and only
    // uses distance to break ties between two foes on nearly the same bearing.
    const score = angle + (d / profile.range) * 0.35;
    if (score < bestScore) {
      bestScore = score;
      bestAngle = angle;
      bestX = nx;
      bestZ = nz;
    }
  }

  if (bestScore === Infinity) return f;

  // Rotate toward the target by `strength` of the error. Done as a lerp of the
  // two unit vectors and renormalised, which is stable at every angle a cone
  // this wide can produce and needs no trigonometry.
  const k = profile.strength;
  if (k >= 1 || bestAngle < 0.0001) {
    f.aimX = bestX;
    f.aimY = bestZ;
    return f;
  }

  const mx = ax + (bestX - ax) * k;
  const mz = az + (bestZ - az) * k;
  const len = Math.hypot(mx, mz) || 1;
  f.aimX = mx / len;
  f.aimY = mz / len;
  return f;
}
