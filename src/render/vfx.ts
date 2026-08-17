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

/**
 * A tapered streak lying in the XZ plane, authored along +X from the origin:
 * a lance of light that is thickest a third of the way along and comes to a
 * point at both ends. Same trick as `crescent` — the vertex colour going black
 * *is* the fade, so it never shows an edge against the floor.
 */
function streak(length: number, width: number, segments = 14) {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Front-loaded taper: a hot head with a tail that thins out behind it.
    const taper = Math.sin(Math.PI * t ** 0.62);
    const w = (width * taper) / 2;
    const x = t * length;
    pos.push(x, 0, -w, x, 0, w);
    col.push(taper, taper, taper, taper, taper, taper);
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

/** The one material every additive flourish uses: no depth, no sorting, no seams. */
function flare(color: number, opacity: number, vertexColors = true) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    vertexColors,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
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
   * The painted slash arc. A ring sector standing on the wedge the swing was
   * actually tested against, which fades in place — this, not the weapon mesh,
   * is what the player reads as "I hit that", so it has to be drawn where the
   * hit happened and nowhere else.
   *
   * It used to be drawn somewhere else entirely, in three compounding ways: the
   * crescents were built at `reach * 1.14` and `1.2`, then scaled from 0.78 up
   * to 1.16 across their life, so the arc opened at 0.89 of the real reach and
   * ended at 1.32 of it — under-selling a hit on the first frame and promising
   * a third more range than the test allows on the last. On top of that the
   * whole sector was rotated by `(1 - t) * arc * 0.45` as it faded, sliding
   * nearly half an arc-width off the wedge that did the damage. At no point in
   * its life did the painted arc agree with `resolveSwing`, which is why a
   * swing looked like it came off the end of the blade instead of covering what
   * it hit.
   *
   * Now: outer radius exactly `reach`, angular width exactly `arc`, centred on
   * `facing`, and it does not travel. `update` still grows it — but into the
   * wedge and no further. See `resolveSwing` in world.ts for the other half.
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
    // Two crescents: a wide tinted body and a tighter white leading edge. Both
    // sit on the same outer radius — the leading edge *is* the reach, and the
    // body is the band swept behind it.
    const layers: [number, number, number, number][] = [
      [reach, reach * 0.62, color, 0.6],
      [reach, reach * 0.26, 0xffffff, 0.95],
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
      // Where `update` will take over from. Left at 1 the sector was drawn at
      // full reach for one frame, dipped, and opened again — a visible stutter
      // on the frame the eye is most likely to be looking at it.
      mesh.scale.setScalar(0.92);
      // Crescents are authored around +X; the actor faces +Z.
      mesh.rotation.y = -facing + Math.PI / 2;
      // Tipped out of the ground plane so the arc reads as a swing through the air.
      mesh.rotation.x = -0.24;
      mesh.renderOrder = 10;
      this.parent.add(mesh);
      this.slashes.push({ mesh, life, maxLife: life, peak: op });
    }
  }

  // `facing` and `arc` are no longer carried: the sector is placed once, on the
  // wedge, and never rotated again. Keeping them would only be an invitation to
  // reintroduce the drift.
  private slashes: {
    mesh: THREE.Mesh;
    life: number;
    maxLife: number;
    peak: number;
  }[] = [];

  /**
   * The bowshot. Three reads stacked on one frame: a lance of light punched out
   * along the flight line, a shock disc standing across it at the bow, and a
   * spray of sparks off the string. Without this the arrow simply *appears*
   * halfway across the arena — the release is the part the hands feel.
   */
  shot(x: number, z: number, facing: number, color = 0xdcffc0, spark = '#d8ffb0', power = 1) {
    // Lance: a tinted body under a tighter white core, both stretching forward
    // as they die so the eye is pulled along the shot rather than at it.
    const layers: [number, number, number, number][] = [
      [4.4 * power, 0.62 * power, color, 0.85],
      [3.4 * power, 0.24 * power, 0xffffff, 1],
    ];
    for (const [len, w, c, op] of layers) {
      const mesh = new THREE.Mesh(streak(len, w), flare(c, op));
      mesh.position.set(x + Math.sin(facing) * 0.9, 1.05, z + Math.cos(facing) * 0.9);
      // Streaks are authored along +X; facing 0 is +Z.
      mesh.rotation.y = facing - Math.PI / 2;
      mesh.renderOrder = 10;
      this.parent.add(mesh);
      this.flares.push({
        mesh,
        life: 0.13,
        maxLife: 0.13,
        peak: op,
        from: new THREE.Vector3(0.55, 1, 1),
        to: new THREE.Vector3(1.35, 1, 0.35),
      });
    }

    // Shock disc across the flight line — the string letting go.
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.42, 24).rotateY(Math.PI / 2),
      flare(color, 0.8, false)
    );
    disc.position.set(x + Math.sin(facing) * 0.8, 1.05, z + Math.cos(facing) * 0.8);
    disc.rotation.y = facing;
    disc.renderOrder = 10;
    this.parent.add(disc);
    this.flares.push({
      mesh: disc,
      life: 0.17,
      maxLife: 0.17,
      peak: 0.8,
      from: new THREE.Vector3(0.5, 0.5, 0.5),
      to: new THREE.Vector3(2.6, 2.6, 2.6),
    });

    // Sparks off the string: a tight cone forward, and a few kicked back.
    for (let i = 0; i < Math.round(8 * power); i++) {
      this.emit(x + Math.sin(facing) * 0.8, 1.05, z + Math.cos(facing) * 0.8, spark, {
        dirX: Math.sin(facing),
        dirZ: Math.cos(facing),
        spread: 0.9,
        speed: 13 * power,
        maxLife: rand(0.1, 0.24),
        scale: rand(0.2, 0.45),
        gravity: -6,
        vy: rand(-0.5, 1.5),
      });
    }
    for (let i = 0; i < 3; i++) {
      this.emit(x + Math.sin(facing) * 0.7, 1.05, z + Math.cos(facing) * 0.7, '#ffffff', {
        dirX: -Math.sin(facing),
        dirZ: -Math.cos(facing),
        spread: 2.2,
        speed: 3,
        maxLife: 0.14,
        scale: rand(0.3, 0.6),
        gravity: 0,
      });
    }
  }

  /**
   * A length of the arrow's flight, left behind and fading. Sprite trails read
   * as smoke; a solid ribbon reads as an arrow that was *there* a moment ago,
   * which is what makes a 46 m/s shot legible at all at this camera angle.
   */
  tracer(x: number, z: number, facing: number, length = 2.2, color = 0xdcffc0, life = 0.15) {
    const mesh = new THREE.Mesh(streak(length, 0.3), flare(color, 0.75));
    // Authored forward from the origin, so lay it down *behind* the current tip.
    mesh.position.set(x - Math.sin(facing) * length, 1.05, z - Math.cos(facing) * length);
    mesh.rotation.y = facing - Math.PI / 2;
    mesh.renderOrder = 9;
    this.parent.add(mesh);
    this.flares.push({
      mesh,
      life,
      maxLife: life,
      peak: 0.75,
      from: new THREE.Vector3(1, 1, 1),
      to: new THREE.Vector3(1, 1, 0.2),
    });
  }

  private flares: {
    mesh: THREE.Mesh;
    life: number;
    maxLife: number;
    peak: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
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
      // Opens out to the reach over the first third and then holds there. The
      // blade still travels — the eye reads the growth as the swing landing —
      // but it stops on the wedge instead of carrying on past it, so the arc is
      // never larger than the range that can actually connect.
      s.mesh.scale.setScalar(Math.min(1, 0.92 + (1 - t) * 0.24));
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = t * t * s.peak;
    }

    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.parent.remove(f.mesh);
        this.flares.splice(i, 1);
        continue;
      }
      const t = f.life / f.maxLife;
      f.mesh.scale.lerpVectors(f.to, f.from, t);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = t * t * f.peak;
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
