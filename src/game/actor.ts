import * as THREE from 'three';

export interface Actor {
  id: number;
  team: 'player' | 'enemy';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: number;
  radius: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** Seconds of remaining invulnerability. */
  iframes: number;
  /** Seconds of remaining knockback-driven loss of control. */
  stagger: number;
  mesh: THREE.Object3D;
  /** Set by damage; drives the white flash on the material. */
  flash: number;
}

/** Push two overlapping circles apart. Mass-less and symmetric — good enough, and stable. */
export function separate(a: Actor, b: Actor) {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const d2 = dx * dx + dz * dz;
  const r = a.radius + b.radius;
  if (d2 >= r * r || d2 === 0) return;
  const d = Math.sqrt(d2);
  const push = (r - d) * 0.5;
  const nx = dx / d;
  const nz = dz / d;
  a.pos.x -= nx * push;
  a.pos.z -= nz * push;
  b.pos.x += nx * push;
  b.pos.z += nz * push;
}
