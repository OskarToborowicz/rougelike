import * as THREE from 'three';
import { rand, TAU } from '../core/math';
import { makeGlowTexture } from './arena';

/**
 * A crescent ribbon lying in the XZ plane: thickest and brightest at the middle
 * of the arc, tapering to nothing at both tips. Under additive blending, fading
 * the vertex colour to black *is* the alpha fade — no transparency sorting, no
 * hard edge. A plain ring sector renders as a solid paper fan; this renders as a
 * blade passing through air.
 */
function crescent(outerRadius: number, thickness: number, arc: number, segments = 40) {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = -arc / 2 + t * arc;
    // sin gives 0 at both tips and 1 at the centre of the swing.
    const taper = Math.sin(Math.PI * t) ** 0.7;
    const outer = outerRadius;
    const inner = outerRadius - thickness * taper;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    pos.push(cx * outer, 0, cz * outer, cx * inner, 0, cz * inner);
    // Leading (outer) edge stays hot; the trailing edge falls off into the dark.
    col.push(taper, taper, taper, taper * 0.35, taper * 0.35, taper * 0.35);
    if (i < segments) {
      const o = i * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

interface Particle {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  spin: number;
  scale: number;
  drag: number;
  gravity: number;
}

/**
 * One pooled additive-sprite system for everything that pops: hit sparks, dash
 * trails, death bursts, boon motes. Pooled because Hades never stutters.
 */
export class Vfx {
  private pool: Particle[] = [];
  private live: Particle[] = [];
  private textures = new Map<string, THREE.Texture>();
  private decals: { mesh: THREE.Mesh; life: number; maxLife: number; grow: number }[] = [];

  constructor(private parent: THREE.Object3D, private budget = 700) {}

  private tex(color: string) {
    let t = this.textures.get(color);
    if (!t) {
      t = makeGlowTexture(color, 0.35);
      this.textures.set(color, t);
    }
    return t;
  }

  private take(color: string): Particle | null {
    let p = this.pool.pop();
    if (!p) {
      if (this.live.length >= this.budget) return null;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        })
      );
      this.parent.add(sprite);
      p = {
        sprite,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        spin: 0,
        scale: 1,
        drag: 3,
        gravity: 0,
      };
    }
    (p.sprite.material as THREE.SpriteMaterial).map = this.tex(color);
    p.sprite.visible = true;
    return p;
  }

  private emit(
    x: number,
    y: number,
    z: number,
    color: string,
    opts: Partial<Particle> & { speed?: number; spread?: number; dirX?: number; dirZ?: number }
  ) {
    const p = this.take(color);
    if (!p) return;
    const speed = opts.speed ?? 6;
    const spread = opts.spread ?? TAU;
    const baseA = opts.dirX !== undefined ? Math.atan2(opts.dirZ!, opts.dirX) : rand(0, TAU);
    const a = baseA + rand(-spread / 2, spread / 2);
    const s = speed * rand(0.5, 1.2);
    p.vx = Math.cos(a) * s;
    p.vz = Math.sin(a) * s;
    p.vy = opts.vy ?? rand(1.5, 5);
    p.life = p.maxLife = opts.maxLife ?? rand(0.25, 0.5);
    p.scale = opts.scale ?? rand(0.35, 0.75);
    p.drag = opts.drag ?? 4.5;
    p.gravity = opts.gravity ?? -14;
    p.sprite.position.set(x, y, z);
    p.sprite.scale.setScalar(p.scale);
    this.live.push(p);
  }

  /** Weapon connect: a tight cone of sparks along the swing direction plus a white core flash. */
  hitSpark(x: number, z: number, dirX: number, dirZ: number, color = '#ffd98a', power = 1) {
    const n = Math.round(10 * power);
    for (let i = 0; i < n; i++) {
      this.emit(x, 0.9, z, color, {
        dirX,
        dirZ,
        spread: 1.5,
        speed: 9 * power,
        maxLife: rand(0.16, 0.32),
        scale: rand(0.3, 0.7) * power,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.emit(x, 0.95, z, '#ffffff', {
        speed: 2,
        maxLife: 0.12,
        scale: rand(0.8, 1.4) * power,
        gravity: 0,
      });
    }
  }

  bloodBurst(x: number, z: number, color = '#c0304a', power = 1) {
    for (let i = 0; i < Math.round(18 * power); i++) {
      this.emit(x, 1.0, z, color, {
        speed: 7 * power,
        maxLife: rand(0.3, 0.7),
        scale: rand(0.3, 0.9),
      });
    }
  }

  dashTrail(x: number, z: number, color = '#7fd6ff') {
    this.emit(x, 0.7, z, color, {
      speed: 0.6,
      maxLife: 0.28,
      scale: rand(0.7, 1.1),
      gravity: 0,
      drag: 6,
    });
  }

  /**
   * The painted slash arc. A ring sector that sweeps through the swing and fades —
   * this, not the weapon mesh, is what the player actually reads as "I hit that".
   * Every Hades attack has one; without it a melee swing reads as a stick waggle.
   */
  slash(
    x: number,
    z: number,
    facing: number,
    arc: number,
    reach: number,
    color: number,
    life = 0.2
  ) {
    // Two crescents: a wide tinted body and a tighter white leading edge.
    const layers: [number, number, number, number][] = [
      [reach * 1.14, reach * 0.62, color, 0.6],
      [reach * 1.2, reach * 0.26, 0xffffff, 0.95],
    ];
    for (const [outer, thickness, c, op] of layers) {
      const mesh = new THREE.Mesh(
        crescent(outer, thickness, arc),
        new THREE.MeshBasicMaterial({
          color: c,
          transparent: true,
          opacity: op,
          vertexColors: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        })
      );
      mesh.position.set(x, 1.15, z);
      // Crescents are authored around +X; the actor faces +Z.
      mesh.rotation.y = -facing + Math.PI / 2;
      // Tipped out of the ground plane so the arc reads as a swing through the air.
      mesh.rotation.x = -0.24;
      mesh.renderOrder = 10;
      this.parent.add(mesh);
      this.slashes.push({ mesh, life, maxLife: life, facing, arc, peak: op });
    }
  }

  private slashes: {
    mesh: THREE.Mesh;
    life: number;
    maxLife: number;
    facing: number;
    arc: number;
    peak: number;
  }[] = [];

  /** Expanding ground ring — telegraphs and explosions read instantly at this camera angle. */
  ring(x: number, z: number, color: number, radius: number, life = 0.35) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.72, radius, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    mesh.position.set(x, 0.05, z);
    this.parent.add(mesh);
    this.decals.push({ mesh, life, maxLife: life, grow: 1.9 });
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        this.live.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y = Math.max(0.06, p.sprite.position.y + p.vy * dt);
      p.sprite.position.z += p.vz * dt;
      const t = p.life / p.maxLife;
      (p.sprite.material as THREE.SpriteMaterial).opacity = t * t;
      p.sprite.scale.setScalar(p.scale * (0.4 + t * 0.8));
    }

    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.parent.remove(s.mesh);
        this.slashes.splice(i, 1);
        continue;
      }
      const t = s.life / s.maxLife;
      // Sweeps forward through the arc as it fades, so the eye follows the blade.
      s.mesh.rotation.y = -s.facing + Math.PI / 2 - (1 - t) * s.arc * 0.45;
      s.mesh.scale.setScalar(0.78 + (1 - t) * 0.38);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = t * t * s.peak;
    }

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      const t = Math.max(0, d.life / d.maxLife);
      if (d.life <= 0) {
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.parent.remove(d.mesh);
        this.decals.splice(i, 1);
        continue;
      }
      const s = 1 + (1 - t) * (d.grow - 1);
      d.mesh.scale.setScalar(s);
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = t;
    }
  }
}
