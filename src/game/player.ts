import * as THREE from "three";
import type { Actor } from "./actor";
import type { Frame } from "../core/input";
import { angleDelta, clamp, damp } from "../core/math";
import type { BoonSet } from "./boons";
import { addOutline } from "../render/outline";
import { fitToHeight, instance, loadModel } from "../render/models";
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

/**
 * The joints `animateBody` drives, and the node names it looks for.
 *
 * A model supplies whichever of these it has. Demanding the full set meant one
 * missing node switched the entire body animation off, which rules out any
 * figure that has no separate legs to swing — a mage in a robe wants its skirt
 * to stay one piece, and cutting fake legs into it only buys a visible seam.
 * What the walk is actually carried by is the torso, the head counter-rotating
 * against it and the arms; the legs are the stride, and a robe hides that.
 */
const RIG_JOINTS = {
  pelvis: 'Pelvis',
  torso: 'Torso',
  head: 'Head',
  armL: 'ArmL',
  armR: 'ArmR',
  legL: 'LegL',
  legR: 'LegR',
} as const;

type RigJoint = keyof typeof RIG_JOINTS;

/**
 * Bodies authored in Blender, per class. Anything not listed keeps the
 * primitive rig, which is a finished character and not a placeholder.
 *
 * `tint` is how the seat colour gets onto the model, and it depends on what the
 * file brings with it. The warrior was built with named materials, so only its
 * plume takes the colour and the armour keeps its own. A generated sculpt has
 * one nameless material and no UVs — nothing to pick out — so the whole body
 * wears it, which at this camera distance is what tells four players apart.
 */
const AUTHORED_RIGS: Partial<
  Record<ClassId, { body: string; weapon?: string; height: number; tint: "crest" | "whole" }>
> = {
  warrior: {
    body: "/models/warrior.glb",
    weapon: "/models/warrior_sword.glb",
    height: 2.1,
    tint: "crest",
  },
  mage: { body: "/models/mage.glb", height: 2.1, tint: "whole" },
};

/** The sword's resting guard angle, and the pose every swing returns to. */
const REST_SWORD_Y = -0.5;

// Easing shared by the weapon rig. Attack animation is all about *where* the
// time goes: a linear sweep reads as a machine, and the eye reads acceleration
// as force.
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Fast start, gentle finish. */
const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 2;
/** Harder version, for the strike itself. */
const easeOutCubic = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;
/** Eased at both ends, for settling. */
const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

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
   * How long this shade has been holding Call with a full gauge, waiting for
   * someone to hold it back. Zero the moment the key comes up. See World.
   */
  concordHold = 0;
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
  /**
   * The procedural body, kept in its own group so the authored mesh can replace
   * the whole thing in one move once it finishes loading.
   */
  private bodyRig = new THREE.Group();
  /** Every material the hit flash drives — swapped out with the rig. */
  private flashMats: THREE.MeshStandardMaterial[] = [];
  /**
   * Joint nodes of the authored mesh, each with its origin on the joint it turns
   * around. Null until the model lands, and for classes that don't have one.
   */
  private rig: Record<RigJoint, THREE.Object3D> | null = null;
  /** Eased 0..1 walk weight, so the gait grows and dies instead of popping on. */
  private gaitAmp = 0;
  private idleT = 0;
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
      this.bodyRig.add(pauldron);
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
      this.bodyRig.add(leg);
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

    this.bodyRig.add(torso, chest, neck, head, hair, belt, skirt);
    this.mesh.add(this.bodyRig, this.weaponPivot, shadow, hero);
    this.flashMats = [this.bodyMat];
    addOutline(this.mesh, 0.03);

    // The authored mesh arrives a frame or many later; until then the primitives
    // above are the character, exactly as before.
    void this.loadAuthoredRig(tint);
  }

  /**
   * Swap the primitive rig for the mesh authored in Blender.
   *
   * Only the body comes from the file. A weapon, where the class has one on
   * disk, loads separately and goes under `weaponPivot` so the swing animation
   * keeps driving it — a baked-in blade would be a static prop hanging off the
   * hip. Classes with no entry keep the primitive rig, which is a complete
   * character on its own.
   */
  private async loadAuthoredRig(tint: number) {
    const want = AUTHORED_RIGS[this.cls];
    if (!want) return;

    const [bodySrc, weaponSrc] = await Promise.all([
      loadModel(want.body),
      want.weapon ? loadModel(want.weapon) : Promise.resolve(null),
    ]).catch(() => [null, null] as const);
    // No asset, no swap.
    if (!bodySrc || (want.weapon && !weaponSrc)) return;

    const body = instance(bodySrc);
    fitToHeight(body, want.height);

    // Materials come off a shared cached model, so every player would flash and
    // tint together unless each rig gets its own copies.
    const mats: THREE.MeshStandardMaterial[] = [];
    body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const mine = src.clone();
      if (want.tint === "whole") {
        // A bare sculpt arrives with one nameless material and no UVs, so there
        // is no plume to pick out — the whole body wears the seat colour, which
        // is the only thing that has to survive at this camera distance.
        mine.color.setHex(tint);
        mine.roughness = 0.72;
        mine.metalness = 0.04;
      } else if (/crest/i.test(src.name)) {
        // The plume is the seat colour — the one part of the armour that says
        // which of the four players this is, from the top-down camera.
        mine.color.setHex(tint);
      }
      m.material = mine;
      mats.push(mine);
    });

    this.mesh.remove(this.bodyRig);
    this.bodyRig.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.sharedGeometry) m.geometry.dispose();
    });

    addOutline(body, 0.03);
    this.mesh.add(body);
    this.bodyRig = body as THREE.Group;
    this.flashMats = mats;

    // The joints are just named nodes — no skinning. Hard-edged plate armour has
    // nothing to deform anyway, and segmented limbs read cleanly from this far up.
    //
    // A joint the model does not carry gets a detached stand-in: animateBody can
    // then write to every slot without a guard on each line, and the writes land
    // on an object that is in no scene and renders nothing.
    const found = {} as Record<RigJoint, THREE.Object3D>;
    let any = false;
    for (const [joint, nodeName] of Object.entries(RIG_JOINTS) as [RigJoint, string][]) {
      const node = body.getObjectByName(nodeName);
      if (node) any = true;
      found[joint] = node ?? new THREE.Object3D();
    }
    if (any) this.rig = found;

    // A class with no weapon file keeps the procedural one buildWeapon made —
    // it is already parented to weaponPivot and already animates, so the mage's
    // staff swings exactly as it did before its body arrived.
    if (!weaponSrc) return;

    // The blade rides the same offset the primitive one did, so every pose in
    // animateWeapon lands where it always did.
    const held = instance(weaponSrc);
    held.position.set(0.55, 0, 0);
    held.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) this.weapon = m;
    });
    addOutline(held, 0.03);
    for (const child of [...this.weaponPivot.children]) {
      this.weaponPivot.remove(child);
      const m = child as THREE.Mesh;
      if (m.isMesh && !m.userData.sharedGeometry) m.geometry.dispose();
    }
    this.weaponPivot.add(held);
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
      const guard = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.14, 0.1),
        trim,
      );
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

  /**
   * Damage the Scales spared this frame, owed back to whatever struck. The World
   * collects it — Player has no way to reach the attacker, and putting the
   * reflection here would mean every caller of `hurt` had to know about it.
   */
  reflectOwed = 0;

  hurt(amount: number) {
    if (this.iframes > 0 || this.dead) return false;

    // The Scales. A blow that costs more than the threshold is halved, and the
    // half that was spared becomes a debt against whatever swung. Deliberately
    // only the *large* hits: chip damage stays chip damage, so the boon reads as
    // protection against the thing that was about to end the run.
    const bar = this.boons.scalesThreshold;
    if (bar > 0 && amount > this.maxHp * bar) {
      const spared = amount / 2;
      amount -= spared;
      this.reflectOwed += spared;
    }

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
      for (const m of this.flashMats) m.emissive.setScalar(0);
      // Going down is a collapse, not a plank tipping over: the body folds while
      // the whole rig rotates.
      if (this.rig) {
        const r = this.rig;
        r.torso.rotation.x = damp(r.torso.rotation.x, 0.5, 6, dt);
        r.head.rotation.x = damp(r.head.rotation.x, -0.35, 6, dt);
        r.legL.rotation.x = damp(r.legL.rotation.x, -0.5, 6, dt);
        r.legR.rotation.x = damp(r.legR.rotation.x, -0.25, 6, dt);
        r.armL.rotation.x = damp(r.armL.rotation.x, -0.6, 6, dt);
        r.armR.rotation.x = damp(r.armR.rotation.x, -0.4, 6, dt);
      }
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
    if (
      speed > 1.2 &&
      Math.floor(bobWas / Math.PI) !== Math.floor(this.bob / Math.PI)
    ) {
      this.onStep?.(this.pos.x, this.pos.z, speed);
    }

    this.animateWeapon(dt);
    // Body after the weapon: the sword arm reads its pose off weaponPivot, so
    // the hand has to be told where the hilt already went, not the frame after.
    this.animateBody(dt, speed);
    for (const m of this.flashMats) {
      m.emissive.setRGB(this.flash, this.flash * 0.85, this.flash * 0.8);
      if (this.iframes > 0 && this.state === "dash") m.emissive.addScalar(0.25);
    }
  }

  /**
   * Which way the current swing travels.
   *
   * Combo steps alternate, so a chain reads as one continuous flurry instead of
   * the blade teleporting back to the same shoulder before every hit. The heavy
   * always goes the same way — it is a committed, readable wind-up, not part of
   * the rhythm.
   */
  private get swingDir() {
    if (this.usingSpecial) return 1;
    return this.comboIndex % 2 === 0 ? 1 : -1;
  }

  /**
   * Pose the body.
   *
   * Everything here is driven off state the rig already has — the bob phase that
   * fires footsteps, and the weapon pivot the swing writes to — so the walk stays
   * locked to the actual speed and the shoulder can never disagree with the
   * blade. No clips to blend, nothing to keep in sync with gameplay timings.
   */
  private animateBody(dt: number, speed: number) {
    const r = this.rig;
    if (!r) return;
    this.idleT += dt;

    // Walk weight, eased. Without it a tap of the stick snaps the legs to full
    // stride for one frame and back.
    const gait = clamp(speed / (this.speed * 0.7), 0, 1);
    this.gaitAmp = damp(this.gaitAmp, gait, 9, dt);
    const g = this.gaitAmp;
    const stride = Math.sin(this.bob);
    // Breathing only surfaces as the walk dies out, or it fights the stride.
    const breath = Math.sin(this.idleT * 2.1) * (1 - g);

    // How far the blade has travelled from its guard position. The torso turns
    // into the swing and the shoulder chases the hilt — that rotation *is* the
    // wind-up, which is what makes an attack readable before it lands.
    const swung = this.weaponPivot.rotation.y - REST_SWORD_Y;
    const attacking = this.state === "attack";
    const dashing = this.state === "dash";

    const lean = 0.13 * g + (dashing ? 0.3 : 0);
    r.torso.rotation.x = lean + breath * 0.025 - this.flash * 0.22;
    r.torso.rotation.y = stride * 0.12 * g + swung * 0.3;
    r.torso.rotation.z = -stride * 0.04 * g;

    r.pelvis.rotation.y = -stride * 0.14 * g;
    r.pelvis.rotation.z = Math.cos(this.bob) * 0.05 * g;

    // The head holds its line while the shoulders turn under it — the eyes stay
    // on the target, which is the whole reason a turn reads as intent.
    r.head.rotation.y = -(r.torso.rotation.y + r.pelvis.rotation.y) * 0.65;
    r.head.rotation.x = -lean * 0.55 + breath * 0.03;

    if (dashing) {
      // Tuck: lead knee up, trailing leg trailing.
      r.legL.rotation.x = damp(r.legL.rotation.x, -0.6, 16, dt);
      r.legR.rotation.x = damp(r.legR.rotation.x, 0.35, 16, dt);
    } else {
      const swing = stride * 0.62 * g;
      r.legL.rotation.x = swing;
      r.legR.rotation.x = -swing;
    }

    // Shield arm counter-swings with the legs, and comes across the body during
    // an attack instead of flapping behind the swing.
    r.armL.rotation.x = -stride * 0.5 * g + (dashing ? -0.4 : 0);
    r.armL.rotation.y = damp(r.armL.rotation.y, attacking ? -0.3 : 0, 10, dt);

    // Sword arm is slaved to the blade, plus a little arm swing when it's idle
    // enough to have one.
    r.armR.rotation.x =
      this.weaponPivot.rotation.x * 0.8 +
      stride * 0.3 * g * (attacking ? 0 : 1);
    r.armR.rotation.y = swung * 0.6;
  }

  private animateWeapon(dt: number) {
    const rest = this.def.weapon === "sword" ? REST_SWORD_Y : -0.05;
    let targetY = rest;
    let targetX = this.def.weapon === "staff" ? 0 : 0.1;

    if (this.state === "attack") {
      const a = this.currentAttack;

      if (this.def.weapon === "sword") {
        // The blade travels the wedge the hit test actually uses, centred on
        // facing. The old sweep started at a fixed -1.3 while its end scaled
        // with the arc, so every attack wider than the first combo step drifted
        // right — the heavy finished a full radian past the shoulder while the
        // damage had landed symmetrically in front.
        const dir = this.swingDir;
        const half = a.arc / 2;
        // A little past the wedge on both sides: lead-in to load the swing,
        // follow-through so it decelerates instead of stopping dead.
        const from = -dir * (half + 0.35);
        const to = dir * (half + 0.2);
        const raised = this.usingSpecial ? -0.6 : -0.3;
        const chopped = this.usingSpecial ? 0.4 : 0.2;

        if (this.stateT < a.wind) {
          // Wind-up: pull back and lift. Eased out, so the load is readable at
          // the start and the blade hangs at the top for a beat.
          const k = easeOut(this.stateT / a.wind);
          this.weaponPivot.rotation.y = lerp(REST_SWORD_Y, from, k);
          this.weaponPivot.rotation.x = lerp(0.1, raised, k);
          return;
        }

        const activeEnd = a.wind + a.active;
        if (this.stateT < activeEnd) {
          // The strike. Cubic ease-out puts most of the arc in the first third
          // of the active frames, which is where the hit resolves — the blade
          // is where the damage is, not trailing behind it.
          const k = easeOutCubic((this.stateT - a.wind) / a.active);
          this.weaponPivot.rotation.y = lerp(from, to, k);
          this.weaponPivot.rotation.x = lerp(raised, chopped, k);
          return;
        }

        // Recover: settle back to guard. Smoothstepped rather than left parked
        // at the end of the arc for the whole recovery.
        const k = smoothstep(
          clamp((this.stateT - activeEnd) / Math.max(0.0001, a.recover), 0, 1),
        );
        this.weaponPivot.rotation.y = lerp(to, REST_SWORD_Y, k);
        this.weaponPivot.rotation.x = lerp(chopped, 0.1, k);
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

      // Staff: raise it overhead through the wind-up, then drive it down. The
      // release used to snap between two fixed poses in a single frame, which
      // is why the thrust had no weight — now it drives through and settles.
      if (this.stateT < a.wind) {
        const k = easeOut(this.stateT / a.wind);
        this.weaponPivot.rotation.x = lerp(0, -0.9, k);
        this.weaponPivot.rotation.y = lerp(-0.05, -0.25, k);
        return;
      }
      const staffEnd = a.wind + a.active;
      if (this.stateT < staffEnd) {
        const k = easeOutCubic((this.stateT - a.wind) / a.active);
        this.weaponPivot.rotation.x = lerp(-0.9, 0.62, k);
        this.weaponPivot.rotation.y = lerp(-0.25, 0.24, k);
        return;
      }
      const settle = smoothstep(
        clamp((this.stateT - staffEnd) / Math.max(0.0001, a.recover), 0, 1),
      );
      this.weaponPivot.rotation.x = lerp(0.62, 0, settle);
      this.weaponPivot.rotation.y = lerp(0.24, -0.05, settle);
      return;
    }

    // Cast had no pose at all: the weapon simply hung at rest while a bolt
    // appeared out of nowhere. A short shove forward gives the bolt a source.
    if (this.state === "cast") {
      const k = clamp(this.stateT / 0.18, 0, 1);
      // Out hard, back soft — one sine hump over the whole cast.
      const push = Math.sin(k * Math.PI);
      const reach = this.def.weapon === "staff" ? 0.75 : 0.5;
      this.weaponPivot.rotation.x = lerp(targetX, -reach, easeOutCubic(push));
      this.weaponPivot.rotation.y = lerp(rest, rest * 0.2, push);
      return;
    }

    // Dash: tuck the weapon in behind the shoulder so the silhouette leads with
    // the body. A blade left swinging out front reads as an attack.
    if (this.state === "dash") {
      targetY = rest - 0.55;
      targetX = 0.42;
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
