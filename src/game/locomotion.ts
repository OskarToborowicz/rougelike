import type { Frame } from "../core/input";
import { arenaRadius } from "../render/arena";
import { damp } from "../core/math";
import { DASH } from "./player";

/** The minimum a mover needs for locomotion — a Player satisfies it. */
export interface Movable {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  facing: number;
  radius: number;
  speed: number;
  state: string;
  stateT: number;
  stagger: number;
  isBusy: boolean;
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
    p.vel.x = Math.sin(p.facing) * speed;
    p.vel.z = Math.cos(p.facing) * speed;
  } else if (f && p.stagger <= 0) {
    const accel = p.isBusy ? 18 : 60;
    const max = p.speed * moveMul * (p.state === "attack" ? 0.25 : 1);
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
