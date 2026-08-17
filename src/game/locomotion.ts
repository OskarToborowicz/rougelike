import type { Frame } from "../core/input";
import { arenaRadius } from "../render/arena";
import { damp } from "../core/math";
import { DASH } from "./player";

/** Fraction of walking speed kept while an attack, special or cast is running. */
export const BUSY_MOVE_MUL = 0.2;

/** The minimum a mover needs for locomotion — a Player satisfies it. */
export interface Movable {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  facing: number;
  /** Latched heading for a dash in progress. See `Player.dashDir`. */
  dashDir: number;
  radius: number;
  speed: number;
  state: string;
  stateT: number;
  stagger: number;
}

/**
 * One authoritative step of player movement.
 *
 * Host and guest must produce bit-identical results from identical input, or
 * prediction drifts and the client rubber-bands. Keeping the integration in one
 * function is what makes that guarantee cheap — there is no second copy to keep
 * in sync by hand.
 */
export function stepMovement(p: Movable, f: Frame | null, dt: number, moveMul: number) {
  if (p.state === "dash") {
    // Ease-out so the dash pops on frame one and glides to a stop.
    const t = p.stateT / DASH.time;
    const speed = (DASH.dist / DASH.time) * (1 - t * t) * 1.5;
    // `dashDir`, never `facing`. Read off `facing` this line was sampling a
    // value that chases the cursor every frame, which turned a straight dash
    // into a curve toward the mouse — on the host and, identically, in the
    // guest's own replay of it.
    p.vel.x = Math.sin(p.dashDir) * speed;
    p.vel.z = Math.cos(p.dashDir) * speed;
  } else if (f && p.stagger <= 0) {
    // Swinging or casting slows the shade to a crawl — it never roots it. A root
    // is nearly invisible on a mouse, where one click is one swing, but the aim
    // stick on a phone autofires, so a rooted attack meant standing still for the
    // whole fight. At a fifth of the speed the commitment still reads.
    const busy = p.state === "attack" || p.state === "cast";
    const accel = busy ? 26 : 60;
    const max = p.speed * moveMul * (busy ? BUSY_MOVE_MUL : 1);
    p.vel.x = damp(p.vel.x, f.moveX * max, accel * 0.35, dt);
    p.vel.z = damp(p.vel.z, f.moveY * max, accel * 0.35, dt);
  } else if (!f) {
    const d = Math.exp(-8 * dt);
    p.vel.x *= d;
    p.vel.z *= d;
  }

  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  confine(p);
}

/** Keep an actor inside the arena. Shared so prediction hits the same wall. */
export function confine(a: {
  pos: { x: number; z: number };
  vel: { x: number; z: number };
  radius: number;
}) {
  const r = Math.hypot(a.pos.x, a.pos.z);
  const lim = arenaRadius() - a.radius - 0.6;
  if (r > lim) {
    a.pos.x = (a.pos.x / r) * lim;
    a.pos.z = (a.pos.z / r) * lim;
    a.vel.x *= 0.2;
    a.vel.z *= 0.2;
  }
}
