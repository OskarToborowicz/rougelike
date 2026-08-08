import * as THREE from "three";
import type { Actor } from "./actor";
import type { Frame } from "../core/input";
import { angleDelta, clamp, damp } from "../core/math";
import type { BoonSet } from "./boons";
import { addOutline } from "../render/outline";
import {
  CLASSES,
  type AttackShape,
  type ClassDef,
  type ClassId,
} from "./classes";

export const PLAYER_TINTS = [0xff6a3d, 0x4fc3ff, 0x9d6bff, 0x5fe08a];

export type PlayerState =
  | "idle"
  | "run"
  | "attack"
  | "dash"
  | "cast"
  | "hurt"
  | "down";

export const DASH = { dist: 4.6, time: 0.16, cooldown: 0.26, iframes: 0.22 };

export class Player implements Actor {
  team = "player" as const;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = 0;
  radius = 0.55;
  maxHp = 100;
  hp = 100;
  dead = false;
  iframes = 0;
  stagger = 0;
  flash = 0;

  state: PlayerState = "idle";
  stateT = 0;
  comboIndex = 0;
  comboWindow = 0;
  attackHitDone = false;
  dashCd = 0;
  castAmmo = 3;
  castReload = 0;
  callGauge = 0;
  /**
   * Fired on each footfall. Steps are the one cue deliberately kept off the
   * wire: they are continuous rather than an event, so every client generates
   * its own from the rig it is already animating.
   */
  onStep?: (x: number, z: number, speed: number) => void;
  /** Set on the frame Second Wind fires, so the World can sell the moment. */
  usedSecondWind = false;
  deathCd = 0;
  /** Revive progress while a partner stands on this player's corpse (co-op). */
  reviveProgress = 0;
  speed = 8.2;

  mesh = new THREE.Group();
  private bodyMat!: THREE.MeshStandardMaterial;
  private weapon!: THREE.Mesh;
  private weaponPivot = new THREE.Group();
  private bob = 0;

  /** True while the special is running, so the swing resolver knows which shape to use. */
  usingSpecial = false;
  readonly def: ClassDef;

  constructor(
    public id: number,
    public seat: number,
    public boons: BoonSet,
    tint = PLAYER_TINTS[0],
    public cls: ClassId = "warrior",
  ) {
    this.def = CLASSES[cls];
    // Permanent upgrades are already folded into the BoonSet handed in, so the
    // starting body is the class plus whatever was bought between runs.
    this.maxHp = this.hp = this.def.maxHp + boons.metaMaxHp;
    this.callGauge = Math.min(1, boons.metaStartCall);
    this.speed = this.def.speed;
    this.build(tint);
  }

  /**
   * The shape of the attack currently being thrown, with hammer modifications
   * folded in. Specials keep their own timing — speeding those up would let a
   * heavy finisher be spammed like a jab.
   */
  get currentAttack(): AttackShape {
    if (this.usingSpecial) return this.def.special;
    const base =
      this.def.combo[clamp(this.comboIndex, 0, this.def.combo.length - 1)];
    const b = this.boons;
    if (b.attackSpeedMul === 1 && b.attackReachMul === 1) return base;
    return {
      ...base,
      wind: base.wind * b.attackSpeedMul,
      recover: base.recover * b.attackSpeedMul,
      reach: base.reach * b.attackReachMul,
    };
  }

  get comboLength() {
    return this.def.combo.length;
  }

  private build(tint: number) {
    // Skin/flesh reads pale against the dark arena; the tint lives in the cloak,
    // which is the shape the eye actually tracks at this camera distance.
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xe8c9a8,
      roughness: 0.62,
      metalness: 0.02,
      emissive: 0x000000,
    });
    const cloak = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.72,
      metalness: 0.08,
    });
    const cloth = new THREE.MeshStandardMaterial({
      color: 0x171525,
      roughness: 0.95,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: 0xe8bb6b,
      roughness: 0.3,
      metalness: 0.75,
      emissive: 0x2a1c05,
    });

    // Tapered torso — narrow waist, broad shoulders. A capsule has neither.
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.24, 0.78, 14),
      cloak,
    );
    torso.position.y = 1.08;
    torso.castShadow = true;

    const chest = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 18, 14),
      this.bodyMat,
    );
    chest.scale.set(1.15, 0.72, 0.85);
    chest.position.y = 1.42;
    chest.castShadow = true;

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.14, 0.16, 10),
      this.bodyMat,
    );
    neck.position.y = 1.62;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 20, 16),
      this.bodyMat,
    );
    head.scale.set(0.92, 1.08, 0.95);
    head.position.y = 1.82;
    head.castShadow = true;

    // Hair mass, pushed back — gives the head an asymmetric, readable outline.
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), cloth);
    hair.scale.set(1.0, 0.95, 1.15);
    hair.position.set(0, 1.88, -0.07);
    hair.castShadow = true;

    // Shoulder pauldrons catch the key light and widen the top of the silhouette.
    for (const s of [-1, 1]) {
      const pauldron = new THREE.Mesh(
        new THREE.SphereGeometry(0.19, 14, 10),
        trim,
      );
      pauldron.scale.set(1, 0.7, 1);
      pauldron.position.set(s * 0.4, 1.4, 0);
      pauldron.castShadow = true;
      this.mesh.add(pauldron);
    }

    const belt = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.05, 8, 20).rotateX(Math.PI / 2),
      trim,
    );
    belt.position.y = 0.72;

    const skirt = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 0.66, 16, 1, true),
      cloth,
    );
    skirt.position.y = 0.44;
    skirt.castShadow = true;

    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.11, 0.3, 4, 8),
        this.bodyMat,
      );
      leg.position.set(s * 0.15, 0.24, 0);
      leg.castShadow = true;
      this.mesh.add(leg);
    }

    this.buildWeapon(trim);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
      }),
    );
    shadow.position.y = 0.03;

    // Personal key light. Guarantees the protagonist stays the brightest thing
    // on screen no matter which dark corner of the room the fight drifts into.
    const hero = new THREE.PointLight(tint, 6, 5.5, 2);
    hero.position.set(0, 2.6, 0.8);

    this.mesh.add(
      torso,
      chest,
      neck,
      head,
      hair,
      belt,
      skirt,
      this.weaponPivot,
      shadow,
      hero,
    );
    addOutline(this.mesh, 0.03);
  }

  /**
   * The weapon is the class read. At this camera distance the bodies are near
   * identical, so sword / bow / staff has to carry the whole silhouette
   * difference — and each one rests at a different angle so even an idle player
   * is recognisable.
   */
  private buildWeapon(trim: THREE.Material) {
    const steel = new THREE.MeshStandardMaterial({
      color: 0xdfe6ff,
      roughness: 0.22,
      metalness: 0.9,
      emissive: 0x1b2540,
    });
    const wood = new THREE.MeshStandardMaterial({
      color: 0x5a3b22,
      roughness: 0.85,
    });
    const glow = new THREE.MeshStandardMaterial({
      color: this.def.accent,
      emissive: this.def.accent,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });

    this.weaponPivot.position.y = 1.0;

    if (this.def.weapon === "sword") {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.06, 1.9),
        steel,
      );
      blade.position.set(0.55, 0, 0.75);
      blade.castShadow = true;
      const guard = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.08, 0.1),
        trim,
      );
      guard.position.set(0.55, 0, -0.12);
      this.weapon = blade;
      this.weaponPivot.add(blade, guard);
      return;
    }

    if (this.def.weapon === "crossbow") {
      // Crossbow: a stock pointing down the aim line with a short steel prod
      // across it. The hard T is what separates it from the sword at this
      // camera distance — a bow's curve reads round, this reads square.
      const group = new THREE.Group();
      const stock = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.11, 0.95),
        wood,
      );
      stock.position.set(0.5, 0, 0.5);
      stock.castShadow = true;
      group.add(stock);

      // The prod, angled slightly forward at the tips like a steel bow.
      for (const s of [-1, 1]) {
        const limb = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.05, 0.07),
          steel,
        );
        limb.position.set(0.5 + s * 0.21, 0.02, 0.82);
        limb.rotation.set(0, s * 0.22, s * 0.1);
        limb.castShadow = true;
        group.add(limb);
      }

      // String drawn back to the catch, plus the loaded bolt riding the groove.
      const string = new THREE.Mesh(
        new THREE.BoxGeometry(0.84, 0.02, 0.02),
        glow,
      );
      string.position.set(0.5, 0.05, 0.44);
      group.add(string);
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.62, 5),
        glow,
      );
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(0.5, 0.09, 0.66);
      group.add(bolt);

      // Trigger guard hanging under the stock, so the underside isn't a slab.
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.1), trim);
      guard.position.set(0.5, -0.11, 0.28);
      group.add(guard);

      this.weapon = stock;
      this.weaponPivot.add(group);
      return;
    }

    // Staff: long shaft, planted upright, with a floating focus stone.
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 2.3, 7),
      wood,
    );
    shaft.position.set(0.5, 0.25, 0.2);
    shaft.rotation.set(0.22, 0, -0.14);
    shaft.castShadow = true;
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), glow);
    stone.position.set(0.66, 1.42, 0.42);
    const halo = new THREE.PointLight(this.def.accent, 4, 4.5, 2);
    halo.position.copy(stone.position);
    this.weapon = shaft;
    this.weaponPivot.add(shaft, stone, halo);
  }

  get isBusy() {
    return (
      this.state === "attack" || this.state === "dash" || this.state === "cast"
    );
  }

  hurt(amount: number) {
    if (this.iframes > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.iframes = 0.45;
    this.flash = 1;
    this.stagger = 0.18;

    // Second Wind: the blow lands and hurts, but it does not finish you. Spent
    // here rather than on revive so it reads as surviving, not resurrecting.
    if (this.hp <= 0 && this.boons.secondWind > 0) {
      this.boons.secondWind--;
      this.hp = this.maxHp * 0.35;
      this.iframes = 1.6;
      this.usedSecondWind = true;
      return true;
    }

    if (this.hp <= 0) {
      this.dead = true;
      this.state = "down";
      this.deathCd = 0;
    }
    return true;
  }

  /** Advance timers and the visual rig. Combat resolution lives in World. */
  tick(dt: number, f: Frame | null) {
    this.iframes = Math.max(0, this.iframes - dt);
    this.stagger = Math.max(0, this.stagger - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.stateT += dt;

    if (this.castAmmo < 3) {
      this.castReload -= dt;
      if (this.castReload <= 0) {
        this.castAmmo++;
        this.castReload = 1.1;
      }
    }

    if (this.dead) {
      this.mesh.rotation.z = damp(this.mesh.rotation.z, Math.PI / 2.2, 8, dt);
      this.mesh.position.copy(this.pos);
      this.bodyMat.emissive.setScalar(0);
      return;
    }
    this.mesh.rotation.z = damp(this.mesh.rotation.z, 0, 10, dt);

    // Facing eases toward aim, but locks hard during an attack's active frames.
    if (f) {
      const wantFacing = Math.atan2(f.aimX, f.aimY);
      const rate = this.state === "attack" ? 3 : 18;
      this.facing +=
        angleDelta(this.facing, wantFacing) * clamp(rate * dt, 0, 1);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;

    // Run bob — small, but it's the difference between sliding and walking.
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const bobWas = this.bob;
    this.bob += dt * (6 + speed * 1.4);
    this.mesh.position.y =
      Math.abs(Math.sin(this.bob)) * (speed > 0.5 ? 0.09 : 0.02);

    // A footfall is the bottom of the bob, not a timer — so steps stay locked to
    // the legs at every speed, and stop dead the moment the player does.
    if (speed > 1.2 && Math.floor(bobWas / Math.PI) !== Math.floor(this.bob / Math.PI)) {
      this.onStep?.(this.pos.x, this.pos.z, speed);
    }

    this.animateWeapon(dt);
    this.bodyMat.emissive.setRGB(
      this.flash,
      this.flash * 0.85,
      this.flash * 0.8,
    );
    if (this.iframes > 0 && this.state === "dash") {
      this.bodyMat.emissive.addScalar(0.25);
    }
  }

  private animateWeapon(dt: number) {
    const rest =
      this.def.weapon === "sword"
        ? -0.5
        : this.def.weapon === "crossbow"
          ? -0.05
          : -0.05;
    let targetY = rest;
    let targetX = this.def.weapon === "staff" ? 0 : 0.1;

    if (this.state === "attack") {
      const a = this.currentAttack;
      const total = a.wind + a.active + a.recover;

      if (this.def.weapon === "sword") {
        const t = clamp(this.stateT / total, 0, 1);
        // Wind up back, then whip through the arc, then settle.
        const swing = t < a.wind / total ? -0.9 * (t / (a.wind / total)) : 1;
        const through = clamp((this.stateT - a.wind) / a.active, 0, 1);
        this.weaponPivot.rotation.y =
          swing < 1 ? -0.5 + swing * 0.8 : -1.3 + through * (a.arc + 0.6);
        this.weaponPivot.rotation.x = this.usingSpecial ? -0.35 : 0.05;
        return;
      }

      if (this.def.weapon === "crossbow") {
        // Level it on the wind-up, kick on release, then crank it down through
        // the recover — the reload is most of the animation, and seeing it is
        // how the player learns the shot has a cost.
        const aim = clamp(this.stateT / a.wind, 0, 1);
        if (this.stateT < a.wind) {
          this.weaponPivot.rotation.y = -0.05 + aim * 0.05;
          this.weaponPivot.rotation.x = 0.1 - aim * 0.1;
          return;
        }
        const after = (this.stateT - a.wind) / (a.active + a.recover);
        // Sharp kick up, then a slow crank back to level as the string resets.
        const kick = Math.exp(-after * 9);
        const reload = Math.sin(clamp(after, 0, 1) * Math.PI);
        this.weaponPivot.rotation.x = -0.34 * kick + 0.42 * reload;
        this.weaponPivot.rotation.y = -0.28 * reload;
        return;
      }

      // Staff: raise it overhead through the wind-up, then thrust it down.
      const raise = clamp(this.stateT / a.wind, 0, 1);
      const released = this.stateT >= a.wind;
      this.weaponPivot.rotation.x = released ? 0.5 : -raise * 0.85;
      this.weaponPivot.rotation.y = released ? 0.2 : -0.05;
      return;
    }

    this.weaponPivot.rotation.y = damp(
      this.weaponPivot.rotation.y,
      targetY,
      12,
      dt,
    );
    this.weaponPivot.rotation.x = damp(
      this.weaponPivot.rotation.x,
      targetX,
      12,
      dt,
    );
  }
}
