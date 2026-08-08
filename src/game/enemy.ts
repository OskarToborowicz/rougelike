import * as THREE from 'three';
import type { Actor } from './actor';
import { angleDelta, clamp, damp, rand, TAU } from '../core/math';
import { addOutline } from '../render/outline';
import { hexString, makeBodySkin, makeBoneSkin } from '../render/skin';

export type EnemyKind = 'wretch' | 'lobber' | 'brute' | 'erinys' | 'hydra' | 'champion';

interface Archetype {
  hp: number;
  radius: number;
  speed: number;
  color: number;
  /** Armour/trim colour — the bright half of the body's internal contrast. */
  trim: number;
  scale: number;
  contact: number;
  /** Seconds of visible wind-up before the hit lands. Readability is the whole fight. */
  tell: number;
  attackRange: number;
  cooldown: number;
  /** Bosses run their own pattern machine and own the top-of-screen health bar. */
  boss?: boolean;
  title?: string;
}

export const ARCHETYPES: Record<EnemyKind, Archetype> = {
  wretch: {
    hp: 42,
    radius: 0.5,
    speed: 4.6,
    // Cold slate against a warm ochre floor. Foes sharing the room's hue is why
    // the first passes read as camouflage.
    color: 0x37457e,
    trim: 0xc9a24a,
    scale: 1,
    contact: 10,
    tell: 0.42,
    attackRange: 1.9,
    cooldown: 1.1,
  },
  lobber: {
    hp: 34,
    radius: 0.5,
    speed: 3.2,
    color: 0x1f6b58,
    trim: 0x9ee06a,
    scale: 0.95,
    contact: 9,
    tell: 0.65,
    attackRange: 11,
    cooldown: 2.0,
  },
  brute: {
    hp: 140,
    radius: 0.92,
    speed: 3.1,
    color: 0x5b3382,
    trim: 0xe0663a,
    scale: 1.7,
    contact: 22,
    tell: 0.75,
    attackRange: 2.9,
    cooldown: 1.8,
  },
  erinys: {
    hp: 900,
    radius: 1.15,
    speed: 5.4,
    color: 0x7a1030,
    trim: 0xffb03a,
    scale: 2.0,
    contact: 26,
    tell: 0.6,
    attackRange: 3.6,
    cooldown: 1.2,
    boss: true,
    title: 'ERINYS · SCOURGE OF TARTARUS',
  },

  hydra: {
    // Rooted: it never chases, so the fight is about the room, not the chase.
    hp: 1400,
    radius: 1.8,
    speed: 0,
    color: 0x2f6b3a,
    trim: 0xd8e04a,
    scale: 2.6,
    contact: 24,
    tell: 0.7,
    attackRange: 30,
    cooldown: 1.5,
    boss: true,
    title: 'BONE HYDRA · JAWS OF ASPHODEL',
  },

  champion: {
    // Fought as a pair. Individually weaker than Erinys; together, worse.
    hp: 620,
    radius: 1.0,
    speed: 6.2,
    color: 0x1d5f74,
    trim: 0xffd166,
    scale: 1.85,
    contact: 24,
    tell: 0.5,
    attackRange: 3.2,
    cooldown: 1.0,
    boss: true,
    title: 'CHAMPIONS OF ELYSIUM',
  },
};

export type EnemyState =
  | 'spawn'
  | 'chase'
  | 'tell'
  | 'strike'
  | 'recover'
  | 'dead'
  /** Boss-only: committed to a multi-second attack pattern. */
  | 'pattern';

export type BossPattern =
  // Erinys
  | 'lash'
  | 'volley'
  | 'charge'
  // Bone Hydra
  | 'spit'
  | 'sweep'
  | 'summon'
  // Champions of Elysium
  | 'lunge'
  | 'spin'
  | 'throw';

/** The pattern rotation each boss cycles through. */
export const BOSS_PATTERNS: Partial<Record<EnemyKind, BossPattern[]>> = {
  erinys: ['lash', 'volley', 'charge'],
  hydra: ['spit', 'sweep', 'summon'],
  champion: ['lunge', 'throw', 'spin'],
};

export class Enemy implements Actor {
  team = 'enemy' as const;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = 0;
  radius: number;
  hp: number;
  maxHp: number;
  dead = false;
  iframes = 0;
  stagger = 0;
  flash = 0;

  state: EnemyState = 'spawn';
  stateT = 0;
  cooldown = 0;
  strikeDone = false;
  /** Boss pattern bookkeeping. Unused by regular foes. */
  pattern: BossPattern = 'lash';
  patternStep = 0;
  patternTimer = 0;
  enraged = false;
  /** Locked-in charge direction, sampled at the end of the wind-up. */
  chargeX = 0;
  chargeZ = 1;
  private wings: THREE.Group[] = [];
  /** Hydra necks, swayed in idle and snapped forward on a strike. */
  private heads: THREE.Group[] = [];
  targetId = -1;
  mesh = new THREE.Group();
  a: Archetype;
  /** Slight per-instance speed jitter so a pack doesn't move as one blob. */
  private jitter = rand(0.9, 1.1);
  private bodyMat!: THREE.MeshStandardMaterial;
  private bob = rand(0, 6);

  constructor(public id: number, public kind: EnemyKind) {
    this.a = ARCHETYPES[kind];
    this.radius = this.a.radius;
    this.hp = this.maxHp = this.a.hp;
    this.build();
  }

  private build() {
    const a = this.a;
    // Painted skin instead of a flat colour: the map carries the light-to-dark
    // ramp and the armour banding, so the body has internal contrast even when
    // the arena lighting is flat.
    this.bodyMat = new THREE.MeshStandardMaterial({
      map: makeBodySkin(hexString(a.color), hexString(a.trim), {
        plates: this.kind === 'brute' ? 4 : 3,
        rags: this.kind !== 'brute',
      }),
      roughness: 0.78,
      metalness: 0.06,
    });
    const boneMat = new THREE.MeshStandardMaterial({ map: makeBoneSkin(), roughness: 0.55 });
    const trimMat = new THREE.MeshStandardMaterial({
      color: a.trim,
      roughness: 0.35,
      metalness: 0.6,
    });

    // Hunched, top-heavy silhouette: wide shoulders over a narrow base reads as
    // "threat" from across the arena without needing a face.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.2, 0.72, 12), this.bodyMat);
    body.position.y = 0.86;
    body.castShadow = true;

    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.44, 14, 10), this.bodyMat);
    shoulders.scale.set(1.25, 0.6, 0.8);
    shoulders.position.y = 1.2;
    shoulders.castShadow = true;

    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 1), boneMat);
    skull.position.set(0, 1.5, 0.1);
    skull.scale.set(0.9, 1, 1.1);
    skull.castShadow = true;

    // Arms hang forward — the tell animation swells the whole body, and long
    // arms make that swell read.
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 4, 8), this.bodyMat);
      arm.position.set(s * 0.46, 0.92, 0.12);
      arm.rotation.x = -0.35;
      arm.castShadow = true;
      this.mesh.add(arm);
    }

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
      eye.position.set(s * 0.1, 1.54, 0.3);
      this.mesh.add(eye);
    }

    this.buildKindMarks(trimMat, boneMat);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(a.radius * 1.05, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
    );
    shadow.position.y = 0.03;

    this.mesh.add(body, shoulders, skull, shadow);
    addOutline(this.mesh, 0.032);
    this.mesh.scale.setScalar(a.scale);
    this.mesh.position.y = -1.2; // rises out of the floor on spawn
  }

  /**
   * Per-kind silhouette marks. Three foes that differ only in tint are three
   * versions of the same enemy; the player has to be able to name what is
   * charging at them from the outline alone.
   */
  private buildKindMarks(trimMat: THREE.Material, boneMat: THREE.Material) {
    if (this.kind === 'wretch') {
      // Single forward-swept horn.
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.36, 7), boneMat);
      horn.position.set(0, 1.76, 0.02);
      horn.rotation.x = -0.35;
      horn.castShadow = true;
      this.mesh.add(horn);
      return;
    }

    if (this.kind === 'lobber') {
      // Tall crooked staff and a satchel — reads "ranged" before it throws.
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 2.1, 6), boneMat);
      staff.position.set(0.55, 1.15, 0.1);
      staff.rotation.z = 0.22;
      staff.castShadow = true;
      const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.15, 0),
        new THREE.MeshStandardMaterial({
          color: 0x9cff8a,
          emissive: 0x2f7a28,
          roughness: 0.3,
        })
      );
      orb.position.set(0.79, 2.15, 0.1);
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.bodyMat);
      sack.scale.set(1, 1.2, 0.8);
      sack.position.set(-0.36, 0.86, -0.24);
      sack.castShadow = true;
      this.mesh.add(staff, orb, sack);
      return;
    }

    if (this.kind === 'hydra') {
      // Three necks fanning out of a rooted mound. No legs — it cannot follow
      // you, and the shape has to say so before it opens fire.
      // Its own dark material: the banded body skin wraps a squashed sphere as
      // concentric rings and turns the mound into a lily pad.
      const moundMat = new THREE.MeshStandardMaterial({
        color: 0x1d3f28,
        roughness: 0.92,
        metalness: 0.02,
      });
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 10), moundMat);
      mound.scale.set(1.3, 0.55, 1.3);
      mound.position.y = 0.4;
      mound.castShadow = true;
      this.mesh.add(mound);

      // Bone spurs around the rim. Sunk into the dome so they read as part of
      // the carcass — free-floating ribs just looked like scattered debris.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        const spur = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.44, 5), boneMat);
        spur.position.set(Math.cos(a) * 1.16, 0.42, Math.sin(a) * 1.16);
        spur.rotation.set(Math.PI / 2.6, 0, -a);
        spur.castShadow = true;
        this.mesh.add(spur);
      }

      for (const s of [-1, 0, 1]) {
        const neck = new THREE.Group();
        neck.position.set(s * 0.5, 0.7, 0);
        for (let i = 0; i < 5; i++) {
          const bead = new THREE.Mesh(new THREE.SphereGeometry(0.2 - i * 0.018, 10, 8), boneMat);
          bead.position.set(s * i * 0.13, i * 0.32, i * 0.1);
          bead.castShadow = true;
          neck.add(bead);
        }
        const skull = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.62, 7), boneMat);
        skull.position.set(s * 0.62, 1.68, 0.55);
        skull.rotation.x = 1.5;
        skull.castShadow = true;
        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xd8e04a })
        );
        eye.position.set(s * 0.62, 1.78, 0.7);
        neck.add(skull, eye);
        neck.rotation.z = s * -0.22;
        this.heads.push(neck);
        this.mesh.add(neck);
      }

      const halo = new THREE.PointLight(0xa8e04a, 8, 10, 2);
      halo.position.set(0, 1.6, 0);
      this.mesh.add(halo);
      return;
    }

    if (this.kind === 'champion') {
      // Crested helm and a heavy round shield — a soldier, not a monster.
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.62), trimMat);
      crest.position.set(0, 1.82, 0.02);
      crest.castShadow = true;

      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), trimMat);
      helm.scale.set(1, 1.1, 1.05);
      helm.position.set(0, 1.52, 0.06);
      helm.castShadow = true;

      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 20), trimMat);
      shield.rotation.set(Math.PI / 2, 0, 0.2);
      shield.position.set(-0.62, 1.05, 0.3);
      shield.castShadow = true;

      const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6), boneMat);
      spear.position.set(0.66, 1.15, 0.2);
      spear.rotation.set(1.15, 0, -0.15);
      spear.castShadow = true;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 6), trimMat);
      tip.position.set(0.72, 1.15, 1.45);
      tip.rotation.x = Math.PI / 2;

      this.mesh.add(crest, helm, shield, spear, tip);
      return;
    }

    if (this.kind === 'erinys') {
      // Wings. Nothing else in the game has them, so the silhouette alone tells
      // the player this fight is different before she has moved.
      const wingMat = new THREE.MeshStandardMaterial({
        color: 0x1a0510,
        roughness: 0.9,
        side: THREE.DoubleSide,
        emissive: 0x50101f,
        emissiveIntensity: 0.5,
      });
      for (const s of [-1, 1]) {
        // Each wing is its own pivot at the shoulder, so it can beat in place.
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.34, 1.42, -0.2);
        const wing = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8), wingMat);
        wing.scale.set(0.08, 0.78, 0.46);
        wing.position.set(s * 0.42, 0.16, -0.34);
        wing.rotation.set(0.24, 0, s * 0.5);
        wing.castShadow = true;
        pivot.add(wing);
        pivot.rotation.y = s * -0.45;
        this.wings.push(pivot);
        this.mesh.add(pivot);
      }

      // Crown of horns and the whip she lashes with.
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.72, 6), trimMat);
        horn.position.set(s * 0.16, 1.86, -0.04);
        horn.rotation.set(-0.3, 0, s * 0.34);
        horn.castShadow = true;
        this.mesh.add(horn);
      }
      const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 1.7, 6), trimMat);
      whip.position.set(0.62, 1.0, 0.45);
      whip.rotation.set(0.9, 0, -0.3);
      whip.castShadow = true;

      const halo = new THREE.PointLight(0xff2a55, 9, 9, 2);
      halo.position.set(0, 1.8, 0);
      this.mesh.add(whip, halo);
      return;
    }

    // Brute: a crown of heavy horns and shoulder spikes. Big, and obviously so.
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.6, 6), trimMat);
      horn.position.set(s * 0.2, 1.78, -0.02);
      horn.rotation.set(-0.2, 0, s * 0.5);
      horn.castShadow = true;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 6), trimMat);
      spike.position.set(s * 0.5, 1.36, 0);
      spike.rotation.z = s * -0.55;
      spike.castShadow = true;
      this.mesh.add(horn, spike);
    }
  }

  /**
   * Scale this instance for an elite or horde room.
   *
   * `a` is the shared archetype object, so it must be copied before touching it
   * — writing through it would buff every wretch in the game, permanently.
   */
  empower(mult: number) {
    if (mult === 1) return;
    this.a = { ...this.a, contact: this.a.contact * mult, scale: this.a.scale * (1 + (mult - 1) * 0.3) };
    this.maxHp = Math.round(this.maxHp * mult);
    this.hp = this.maxHp;
    this.mesh.scale.setScalar(this.a.scale);
    if (mult > 1.2) {
      // Elites carry a hot rim so they are never mistaken for the rank and file.
      this.bodyMat.emissive.setRGB(0.25, 0.05, 0.02);
    }
  }

  hurt(amount: number) {
    if (this.dead) return;
    this.hp -= amount;
    this.flash = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.state = 'dead';
      this.stateT = 0;
    }
  }

  get moveSpeed() {
    return this.a.speed * this.jitter;
  }

  tick(dt: number) {
    this.stateT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.stagger = Math.max(0, this.stagger - dt);

    this.mesh.position.x = this.pos.x;
    this.mesh.position.z = this.pos.z;
    this.mesh.rotation.y += angleDelta(this.mesh.rotation.y, this.facing) * clamp(10 * dt, 0, 1);

    if (this.state === 'spawn') {
      this.mesh.position.y = damp(this.mesh.position.y, 0, 9, dt);
    } else if (this.state === 'dead') {
      this.mesh.position.y = damp(this.mesh.position.y, -1.4, 7, dt);
      this.mesh.rotation.x = damp(this.mesh.rotation.x, 1.2, 8, dt);
      this.mesh.scale.multiplyScalar(1 - dt * 1.2);
    } else {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      this.bob += dt * (5 + speed);
      this.mesh.position.y = Math.abs(Math.sin(this.bob)) * (speed > 0.4 ? 0.1 : 0.03);
    }

    // Two distinct emissive languages, never confusable:
    //   tell  -> hot red, ramping up over the wind-up ("I am about to hit you")
    //   flash -> white, one frame ("you hit me")
    // A boss's wind-up lives inside its pattern state rather than a 'tell' state,
    // but it has to glow exactly the same way — one telegraph language, always.
    const winding = this.state === 'tell' || (this.state === 'pattern' && !this.strikeDone);
    const tellHeat = winding ? clamp(this.stateT / this.a.tell, 0, 1) : 0;
    const heat = tellHeat * tellHeat;
    if (this.flash > heat) {
      this.bodyMat.emissive.setRGB(this.flash, this.flash * 0.95, this.flash * 0.9);
    } else {
      this.bodyMat.emissive.setRGB(heat * 1.6, heat * 0.12, heat * 0.05);
    }
    // Wingbeat: slow while stalking, hard and fast through an attack.
    if (this.wings.length) {
      const rate = this.state === 'pattern' ? 11 : 4.5;
      const amp = this.state === 'pattern' ? 0.55 : 0.22;
      const beat = Math.sin(this.bob * rate * 0.35) * amp;
      this.wings.forEach((w, i) => {
        const s = i === 0 ? -1 : 1;
        w.rotation.y = s * (-0.45 - beat);
        w.rotation.z = beat * 0.3;
      });
      this.bob += dt * 3;
    }

    // Necks sway out of phase so the hydra never looks like one rigid prop.
    this.heads.forEach((h, i) => {
      const lean = this.state === 'pattern' ? 0.3 : 0;
      h.rotation.x = Math.sin(this.bob * 1.4 + i * 2.1) * 0.12 + lean;
      h.rotation.z = (i - 1) * -0.22 + Math.cos(this.bob + i) * 0.07;
    });
    if (this.heads.length) this.bob += dt * 1.6;

    const puff = this.state === 'tell' ? 1 + tellHeat * 0.12 : 1;
    if (this.state !== 'dead') this.mesh.scale.setScalar(this.a.scale * puff);
  }
}
