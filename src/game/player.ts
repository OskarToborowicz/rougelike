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
import { ascendancyById, defFor, type Ascendancy } from "./ascendancy";
import { boonById } from "./boons";
import { hammerById } from "./hammers";
// Type-only: save.ts describes a Player's choices but never constructs one, and
// keeping the import erased is what stops the two files from forming a cycle.
import type { Pick } from "./save";

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
  // Second segments, and the one piece of cloth that moves on its own. A model
  // that does not carry these gets a detached stand-in per slot, so the older
  // seven-node warrior still animates exactly as it did — see loadAuthoredRig.
  //
  // They are here because a limb of one piece can only swing like a pendulum.
  // An elbow is what separates a wind-up from a wave, and a knee is most of
  // what a run cycle is; at this camera neither is visible as a joint, but the
  // *timing* they allow is what reads as weight.
  foreL: 'ForearmL',
  foreR: 'ForearmR',
  shinL: 'ShinL',
  shinR: 'ShinR',
  cape: 'Cape',
} as const;

type RigJoint = keyof typeof RIG_JOINTS;

/**
 * Bodies authored in Blender, per class. Anything not listed keeps the
 * primitive rig, which is a finished character and not a placeholder.
 *
 * `tint` is how the seat colour gets onto the model, and it depends on what the
 * file brings with it. All three were built with named materials, so only the
 * piece called `Crest` takes the colour — the warrior's plume, and the cloak on
 * the other two — while the leather, hair and gold keep what they were painted.
 * `whole` remains for a bare sculpt, which arrives with one nameless material
 * and nothing to pick out.
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
  archer: {
    body: "/models/archer.glb",
    weapon: "/models/archer_bow.glb",
    height: 2.1,
    tint: "crest",
  },
  mage: {
    body: "/models/mage.glb",
    weapon: "/models/mage_book.glb",
    height: 2.1,
    tint: "crest",
  },
};

/**
 * Where each weapon's pivot sits when nothing is happening to it — the pose
 * every swing returns to, per weapon, on both axes.
 *
 * `y` swings the arm across the body; `x` rolls the weapon about the arm, which
 * is what lifts a blade and what tips a book's pages up or slams them shut.
 *
 * This is a table rather than three constants because `animateBody` measures a
 * swing as the pivot's distance *from its rest pose*, and that measurement is
 * what turns the torso, leads the shoulder and loads the elbow. Read against
 * the wrong rest, a body is permanently mid-swing: with one hard-coded sword
 * rest, the sorceress stood with her torso and right shoulder turned a fifth of
 * a radian into an attack she was not making, and her elbow could never load,
 * because the quantity it loads on never got below zero for her.
 */
const REST: Record<ClassDef["weapon"], { y: number; x: number }> = {
  /** Turned across the body, guard up. */
  sword: { y: -0.5, x: 0.1 },
  /**
   * Not the same number: a bow rests turned across the body so its curve reads
   * from the front, where a crossbow sat levelled down the aim line. Point it
   * straight ahead and it is a vertical stick.
   */
  bow: { y: -0.2, x: 0.1 },
  /**
   * Nearly square to the front, and flat. A book is carried open and read from,
   * so the roll that lifts a blade into guard would stand this one on its spine
   * and turn the one readable face of it away from the camera.
   */
  book: { y: -0.05, x: 0 },
};

/**
 * The complete aimed bow frame, in player-local space.
 *
 * The shot line is deliberately beside the archer on his anatomical right
 * (negative local X), not through the middle of his chest. The bow never takes
 * its position from either hand: both hands are solved onto this frame after
 * the torso has turned, so winding up cannot drag the weapon off the cursor.
 */
const BOW_GRIP = new THREE.Vector3(-0.26, 1.62, 0.54);
/** Reachable left-hip carry point; the left hand remains on the wood in a dash. */
const BOW_CARRY = new THREE.Vector3(0.32, 1.10, 0.12);
const HAND_L = new THREE.Vector3(-0.028, -0.24, 0.074);
const HAND_R = new THREE.Vector3(0.028, -0.24, 0.074);
const BOW_ROLL = (5 * Math.PI) / 180;
const BOW_NORMAL_DRAW = 0.47;
const BOW_FULL_DRAW = 0.57;
/** Authored arrow landmarks after Blender -> glTF axis conversion. */
const ARROW_NOCK_Z = -0.043;
const ARROW_TIP_Z = 0.70;
/** Front face of the wooden riser: the requested permanent arrow-tip contact. */
const BOW_RISER_Z = 0.06;
/** Bow-arm elbow: low and out, so the arm reads straight without locking. */
const BOW_ELBOW_POLE = new THREE.Vector3(0.36, 1.40, 0.18);
/** String elbow: on the body's right and behind the shoulder, like a real draw. */
const STRING_ELBOW_POLE = new THREE.Vector3(-0.56, 1.58, -0.25);
/** Full RMB draw lifts and recedes the elbow until it nearly follows the shaft. */
const STRING_ELBOW_CHARGE = new THREE.Vector3(0, 0.215, 0);

/**
 * How long the string takes to leave the fingers.
 *
 * Three frames. Every one added past that makes the shot mushier — the release
 * is the fastest thing on the model, and it is the only part of a bow cycle the
 * eye reads as force.
 */
const LOOSE_TIME = 0.05;
/** Beat after release in which the string is visibly straight and empty. */
const NOCK_DELAY = 0.12;

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
  /**
   * The heading a dash committed to, latched on the frame it started.
   *
   * A separate field from `facing`, and that separation is the whole fix: the
   * direction was already being read off the movement keys at the moment of the
   * press, but `facing` then eased toward the aim every frame at rate 18, which
   * converges inside 55ms against a dash that lasts 160. `stepMovement` re-read
   * `facing` on every one of those frames, so the dash set off where the stick
   * was held and then curved into the cursor before the shade had covered a
   * third of the distance. Latched here, it cannot bend.
   */
  dashDir = 0;
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
  /** Authored cape joint position, used as the origin for inertial trailing. */
  private capeRest = new THREE.Vector3();
  /** Per-instance cape geometry and its undeformed vertices. */
  private capeMeshes: {
    position: THREE.BufferAttribute;
    base: Float32Array;
    minY: number;
    spanY: number;
  }[] = [];
  /** Eased 0..1 walk weight, so the gait grows and dies instead of popping on. */
  private gaitAmp = 0;
  private idleT = 0;
  private bob = 0;
  /**
   * The nocked arrow, where the weapon file carries one as its own node.
   *
   * Baked into the bow it is a decoration that slides around with the riser
   * while the shade mimes a draw. On its own node it is the draw: the shaft
   * travels back along the aim line, disappears at the loose, and is back on
   * the string by the time the recovery ends — which is the animation reading
   * as *nocking the next one* rather than as an arm going up and down.
   */
  private bowArrow: THREE.Object3D | null = null;
  /** Root of the authored bow, scaled subtly to show its limbs loading. */
  private bowBody: THREE.Object3D | null = null;
  /** Two live segments from the bow tips to the nock. */
  private bowString: THREE.LineSegments | null = null;
  /** Private bow vertices, including its outline, bent progressively by RMB. */
  private bowMeshes: {
    position: THREE.BufferAttribute;
    base: Float32Array;
    toBow: THREE.Matrix4;
    fromBow: THREE.Matrix4;
  }[] = [];
  /** How far the string is back, 0..1. Written by animateWeapon, read by the body. */
  private bowDraw = 0;
  /**
   * Weight of the archery stance, 0..1, eased.
   *
   * Damped rather than read straight off the attack timer so a burst of shots
   * does not drop the shade back to a walk pose between them: the arms stay in
   * the aim and only the draw cycles, which is what a marksman firing twice a
   * second actually looks like.
   */
  private aimHold = 0;

  /** True while the special is running, so the swing resolver knows which shape to use. */
  usingSpecial = false;
  /** Bow RMB is held: the shot is deferred until the button is released. */
  specialCharging = false;
  /** Seconds accumulated by the bow channel, capped at the final 1.5-second tier. */
  specialCharge = 0;
  /** Number of arrows latched when a charged volley is released. */
  specialVolleyCount = 1;
  /** Three world-facing cells displayed above the archer while RMB is held. */
  private chargeMeter = new THREE.Group();
  private chargeCells: THREE.Mesh[] = [];
  /**
   * The shape this shade fights with. Not readonly: an ascendancy replaces it
   * mid-run, and `currentAttack` reads it live so the new weapon lands on the
   * very next swing. See ascendancy.ts.
   */
  def: ClassDef;
  /** The branch taken halfway down, or null while the run is still generic. */
  asc: Ascendancy | null = null;
  hasCapstone = false;
  /**
   * Every choice this shade has made, in order. The BoonSet holds what they add
   * up to; this holds what they *were*, which is the only form that survives
   * being written to disk and read back by a differently balanced build. See
   * game/save.ts.
   */
  picks: Pick[] = [];

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
   * Swear to a branch.
   *
   * Two halves, on purpose: the numbers go into the BoonSet, where the whole run
   * already stacks, and only the *shape* of the weapon replaces `def`. Nothing
   * here touches the rig — `attack` and `weapon` are the two fields an
   * ascendancy may not move, because the body was built around them once.
   */
  ascend(a: Ascendancy) {
    if (this.asc) return;
    this.asc = a;
    a.apply(this.boons);
    this.picks.push(['a', a.id]);
    this.refreshDef();
  }

  /** The branch's last word. Only ever granted once, and only after `ascend`. */
  takeCapstone() {
    if (!this.asc || this.hasCapstone) return;
    this.hasCapstone = true;
    this.asc.capstone.apply(this.boons);
    this.picks.push(['c']);
    this.refreshDef();
  }

  /**
   * Replay a list of choices onto this shade, in the order they were made.
   *
   * The one path back from a list of ids to a built shade, used by both the run
   * save and a guest rebuilding its own copy from the host. Order is load
   * bearing: a status is last-write-wins, so the same cards in a different order
   * are a different shade.
   *
   * `ascend` and `takeCapstone` record their own entry; the other two are pushed
   * here, so `picks` comes out matching what went in.
   */
  applyPicks(picks: Pick[]) {
    for (const pick of picks) {
      if (pick[0] === 'b') {
        const b = boonById(pick[1]);
        // `add` counts the level, so a boon listed twice comes back at two.
        if (b) {
          this.boons.add(b);
          this.picks.push(pick);
        }
      } else if (pick[0] === 'h') {
        const h = hammerById(pick[1]);
        if (h) {
          h.apply(this.boons);
          this.boons.hammers.push(h.id);
          this.picks.push(pick);
        }
      } else if (pick[0] === 'a') {
        const a = ascendancyById(pick[1]);
        if (a) this.ascend(a);
      } else {
        this.takeCapstone();
      }
    }
  }

  /** Back to the bare class. The climb restarted; the oath did not survive it. */
  renounce() {
    this.asc = null;
    this.hasCapstone = false;
    this.picks.length = 0;
    this.refreshDef();
  }

  /**
   * Rebuild `def` from the class plus whatever has been sworn to, then re-derive
   * the two stats the constructor copies out of it. Health is granted rather
   * than restored — an ascendancy that raises the ceiling should hand you the
   * difference, but must not quietly heal a shade that walked in hurt.
   */
  private refreshDef() {
    this.def = defFor(this.cls, this.asc, this.hasCapstone);
    const ceiling = this.def.maxHp + this.boons.metaMaxHp;
    const gained = Math.max(0, ceiling - this.maxHp);
    this.maxHp = ceiling;
    this.hp = clamp(this.hp + gained, 1, this.maxHp);
    this.speed = this.def.speed;
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

    // Three compact cells viewed from the elevated game camera. The group
    // counter-rotates against the player in tick(), keeping [ ][ ][ ] readable
    // regardless of aim direction.
    this.chargeMeter.position.set(0, 2.72, 0);
    this.chargeMeter.visible = false;
    const meterFrameMat = new THREE.MeshBasicMaterial({
      color: 0xe5c57b,
      depthTest: false,
      depthWrite: false,
    });
    const meterEmptyMat = new THREE.MeshBasicMaterial({
      color: 0x17131b,
      depthTest: false,
      depthWrite: false,
    });
    const meterFillMat = new THREE.MeshBasicMaterial({
      color: 0xffd071,
      depthTest: false,
      depthWrite: false,
    });
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.43;
      const empty = new THREE.Mesh(
        new THREE.BoxGeometry(0.29, 0.025, 0.14),
        meterEmptyMat,
      );
      empty.position.set(x, 0.04, 0);
      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(0.27, 0.025, 0.12),
        meterFillMat,
      );
      fill.position.set(x, 0.07, 0.06);
      fill.scale.z = 0.001;
      // Four separate edges guarantee that the upper stroke cannot disappear
      // behind the empty centre due to depth precision or camera perspective.
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.03, 0.025), meterFrameMat);
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.03, 0.025), meterFrameMat);
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.19), meterFrameMat);
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.19), meterFrameMat);
      top.position.set(x, 0.09, -0.085);
      bottom.position.set(x, 0.09, 0.085);
      left.position.set(x - 0.1625, 0.09, 0);
      right.position.set(x + 0.1625, 0.09, 0);
      // Painter order is explicit because depth testing is intentionally off:
      // background first, liquid second, every frame edge last.
      empty.renderOrder = 20;
      fill.renderOrder = 21;
      for (const edge of [top, bottom, left, right]) edge.renderOrder = 22;
      this.chargeCells.push(fill);
      this.chargeMeter.add(empty, fill, top, bottom, left, right);
    }

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
    this.mesh.add(this.bodyRig, this.weaponPivot, shadow, hero, this.chargeMeter);
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
      let underCape = /cape/i.test(o.name);
      for (let p = o.parent; p && p !== body; p = p.parent) {
        if (/cape/i.test(p.name)) underCape = true;
      }
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
      // The hood/mantle already carries the seat colour. Giving every material
      // below the Cape joint that same cloth colour makes both read as one
      // garment instead of a bright hood hiding a nearly-black cape beneath it.
      if (underCape) {
        mine.color.setHex(tint);
        mine.roughness = 0.82;
        mine.metalness = 0.02;
      }
      m.material = mine;
      mats.push(mine);
    });

    this.mesh.remove(this.bodyRig);
    this.bodyRig.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.sharedGeometry) m.geometry.dispose();
    });

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
    if (found.cape.parent) {
      this.capeRest.copy(found.cape.position);
      found.cape.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.userData.noOutline = true;
        // Instances normally share cached geometry. The cape is the one body
        // part whose vertices move, so give this player a private copy.
        mesh.geometry = mesh.geometry.clone();
        const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        const base = new Float32Array(position.array as ArrayLike<number>);
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < position.count; i++) {
          minY = Math.min(minY, position.getY(i));
          maxY = Math.max(maxY, position.getY(i));
        }
        this.capeMeshes.push({ position, base, minY, spanY: Math.max(0.001, maxY - minY) });
      });
    }
    addOutline(body, 0.03);

    // A class with no weapon file keeps the procedural one buildWeapon made —
    // it is already parented to weaponPivot and already animates, so a weapon
    // swings exactly as it did before its body arrived.
    if (!weaponSrc) return;

    // The blade rides the same offset the primitive one did, so every pose in
    // animateWeapon lands where it always did.
    const held = instance(weaponSrc);
    held.position.set(this.def.weapon === "bow" ? 0 : 0.55, 0, 0);
    held.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      this.weapon = m;
      // The authored string is part of the rigid export. Hide only that
      // material slot on this instance; the animated V-string below replaces
      // it, while wood, leather, arrow and outlines remain untouched.
      const source = Array.isArray(m.material) ? m.material : [m.material];
      const own = source.map((material) => {
        const copy = material.clone();
        if (/sinew/i.test(copy.name)) {
          copy.transparent = true;
          copy.opacity = 0;
          copy.depthWrite = false;
        }
        return copy;
      });
      m.material = Array.isArray(m.material) ? own : own[0];
    });
    // The bow's arrow, if this weapon has one. Looked up rather than assumed:
    // every other weapon is a single node and gets `null`, which is the same
    // path a bow takes before its file lands.
    this.bowArrow = held.getObjectByName("ArcherArrow") ?? null;
    this.bowBody = held.getObjectByName("ArcherBow") ?? held;
    const stringGeometry = new THREE.BufferGeometry();
    stringGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(12), 3),
    );
    this.bowString = new THREE.LineSegments(
      stringGeometry,
      new THREE.LineBasicMaterial({ color: 0xb8f28a }),
    );
    this.bowString.renderOrder = 2;
    this.bowBody.add(this.bowString);
    addOutline(held, 0.03);
    // The authored bow is one rigid export, so give this instance deformable
    // vertices. Skip the arrow: it must remain a straight projectile. Outlines
    // are collected too, keeping the ink contour attached to the bending wood.
    this.bowMeshes.length = 0;
    held.updateMatrixWorld(true);
    const bowWorldInverse = this.bowBody.matrixWorld.clone().invert();
    this.bowBody.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      let parent: THREE.Object3D | null = o;
      while (parent && parent !== this.bowBody) {
        if (parent === this.bowArrow) return;
        parent = parent.parent;
      }
      mesh.geometry = mesh.geometry.clone();
      const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const base = new Float32Array(position.array as ArrayLike<number>);
      const toBow = bowWorldInverse.clone().multiply(mesh.matrixWorld);
      const fromBow = toBow.clone().invert();
      this.bowMeshes.push({ position, base, toBow, fromBow });
    });
    for (const child of [...this.weaponPivot.children]) {
      // The mage's focus light is not part of the placeholder — it is what
      // keeps her lit in a dark room, and it belongs to the class rather than
      // to whichever mesh happens to be carrying it. Everything else goes.
      if ((child as THREE.Light).isLight) continue;
      this.weaponPivot.remove(child);
      const m = child as THREE.Mesh;
      if (m.isMesh && !m.userData.sharedGeometry) m.geometry.dispose();
    }
    this.weaponPivot.add(held);
  }

  /**
   * The weapon is the class read. At this camera distance the bodies are near
   * identical, so sword / bow / book has to carry the whole silhouette
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

    if (this.def.weapon === "bow") {
      // Bow held upright with the limbs curving out along the aim line and the
      // string on the near side, matching archer_bow.glb — this is what shows
      // for the frames before that file lands, and a shape change on arrival
      // would read as a glitch.
      const group = new THREE.Group();
      const grip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.34, 6),
        wood,
      );
      grip.position.set(0.5, 0, 0.05);
      grip.castShadow = true;
      group.add(grip);

      for (const s of [-1, 1]) {
        const limb = new THREE.Mesh(
          new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3([
              new THREE.Vector3(0.5, s * 0.1, 0.06),
              new THREE.Vector3(0.5, s * 0.36, 0.085),
              new THREE.Vector3(0.5, s * 0.6, 0.05),
              new THREE.Vector3(0.5, s * 0.79, -0.015),
            ]),
            6,
            0.022,
            5,
            false,
          ),
          wood,
        );
        limb.castShadow = true;
        group.add(limb);
      }

      // String from tip to tip, and the arrow already on it.
      const string = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 1.58, 4),
        glow,
      );
      string.position.set(0.5, 0, -0.015);
      group.add(string);
      const arrow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.66, 5),
        glow,
      );
      arrow.rotation.x = Math.PI / 2;
      arrow.position.set(0.5, 0.012, 0.3);
      group.add(arrow);

      this.weapon = grip;
      this.weaponPivot.add(group);
      return;
    }

    // Grimoire: held open across the palm, the sigil on the page doing the work
    // the staff's focus stone used to. The light is the reason the mage is
    // visible in a dark room, so it stays with the book.
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.34), wood);
    cover.position.set(0.5, 0, 0.06);
    cover.rotation.set(0.16, 0, 0);
    cover.castShadow = true;
    const page = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.28), trim);
    page.position.set(0.5, 0.04, 0.06);
    page.rotation.copy(cover.rotation);
    const sigil = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.16), glow);
    sigil.position.set(0.56, 0.06, 0.06);
    sigil.rotation.set(0.16, 0.78, 0);
    const halo = new THREE.PointLight(this.def.accent, 4, 4.5, 2);
    halo.position.set(0.52, 0.3, 0.08);
    this.weapon = cover;
    this.weaponPivot.add(cover, page, sigil, halo);
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
        // Limbs fold as the body goes down. A corpse with straight arms and
        // knees is a felled tree, not a body — and the knees fold backwards,
        // the forearms forwards. See the walk cycle for why the signs differ.
        r.shinL.rotation.x = damp(r.shinL.rotation.x, 1.2, 6, dt);
        r.shinR.rotation.x = damp(r.shinR.rotation.x, 0.9, 6, dt);
        r.foreL.rotation.x = damp(r.foreL.rotation.x, -0.8, 6, dt);
        r.foreR.rotation.x = damp(r.foreR.rotation.x, -0.7, 6, dt);
        r.cape.rotation.x = damp(r.cape.rotation.x, 0.4, 4, dt);
      }
      return;
    }
    this.mesh.rotation.z = damp(this.mesh.rotation.z, 0, 10, dt);

    // Facing eases toward aim, but locks hard during an attack's active frames
    // — and is left alone entirely through a dash, which owns the heading it
    // latched. Easing here is what used to drag the dash onto the cursor.
    if (f && this.state !== "dash") {
      const wantFacing = Math.atan2(f.aimX, f.aimY);
      // A sword commits to its swing direction. A bow remains a sight: its
      // wood, string and arrow must keep following the cursor during LPM too.
      const rate = this.state === "attack" && this.def.weapon !== "bow" ? 3 : 18;
      this.facing +=
        angleDelta(this.facing, wantFacing) * clamp(rate * dt, 0, 1);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;
    this.chargeMeter.visible = this.specialCharging && !this.dead;
    this.chargeMeter.rotation.y = -this.facing;
    for (let i = 0; i < this.chargeCells.length; i++) {
      // Each cell fills continuously from bottom to top over its own half-second.
      const fill = clamp(this.specialCharge / 0.5 - i, 0, 1);
      this.chargeCells[i].visible = fill > 0;
      this.chargeCells[i].scale.z = Math.max(0.001, fill);
      this.chargeCells[i].position.z = 0.06 * (1 - fill);
    }

    // Run bob — small, but it's the difference between sliding and walking.
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const bobWas = this.bob;
    // The archer runs low and covers a little more ground per step. Giving him
    // the common cadence made his long legs patter; slow only his phase so the
    // warrior and mage retain their existing timing.
    const cadence =
      this.def.weapon === "bow" ? 4.25 + speed * 0.82 : 6 + speed * 1.4;
    this.bob += dt * cadence;
    const stepArc = Math.abs(Math.sin(this.bob));
    const runBob = this.def.weapon === "bow" ? 0.25 : 0.09;
    // The archer now leaves the planted foot visibly: a broad vertical arc
    // carries the whole body between contacts instead of asking the legs to
    // cycle under a torso that stays at one height.
    this.mesh.position.y =
      Math.pow(stepArc, 0.78) * (speed > 0.5 ? runBob : 0.02);

    // A footfall is the bottom of the bob, not a timer — so steps stay locked to
    // the legs at every speed, and stop dead the moment the player does.
    if (
      speed > 1.2 &&
      Math.floor(bobWas / Math.PI) !== Math.floor(this.bob / Math.PI)
    ) {
      this.onStep?.(this.pos.x, this.pos.z, speed);
    }

    this.animateWeapon(dt);
    // The bow's own cycle, after the generic weapon pass and before the body:
    // it owns the pivot outright for this class, and the archery stance below
    // reads the aim weight and the draw it leaves behind.
    if (this.def.weapon === "bow") this.holdBow(dt);
    // Body after the weapon: the sword arm reads its pose off weaponPivot, so
    // the hand has to be told where the hilt already went, not the frame after.
    this.animateBody(dt, speed);
    if (this.def.weapon === "bow") this.pinBowToHands();
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

    // How far the weapon has travelled from its own rest pose. The torso turns
    // into the swing and the shoulder chases the hilt — that rotation *is* the
    // wind-up, which is what makes an attack readable before it lands.
    //
    // Both axes, because the three weapons do not wind up on the same one. A
    // sword's attack is nearly all `swung`: it is drawn back across the body
    // and comes round. A book's is nearly all `rolled`: it is tipped open
    // overhead and slammed shut forward, and it barely moves sideways at all.
    // Reading only the sideways travel is why the sorceress used to throw her
    // whole attack from a body that never moved.
    const rest = REST[this.def.weapon];
    const swung = this.weaponPivot.rotation.y - rest.y;
    const rolled = this.weaponPivot.rotation.x - rest.x;
    const attacking = this.state === "attack";
    const dashing = this.state === "dash";
    const casting = this.state === "cast";

    const lean = 0.13 * g + (dashing ? 0.3 : 0);
    // Rock back as the weapon comes up, forward as it drives out. For a sword
    // that is a couple of degrees either side of nothing; for a book, whose
    // whole attack lives on this axis, it is most of what sells the slam.
    r.torso.rotation.x =
      lean + breath * 0.025 - this.flash * 0.22 + (attacking ? rolled * 0.1 : 0);
    r.torso.rotation.y = stride * 0.12 * g + swung * 0.3;
    r.torso.rotation.z = -stride * 0.04 * g;

    r.pelvis.rotation.y = -stride * 0.14 * g;
    r.pelvis.rotation.z = Math.cos(this.bob) * 0.05 * g;

    // The head holds its line while the shoulders turn under it — the eyes stay
    // on the target, which is the whole reason a turn reads as intent.
    r.head.rotation.y = -(r.torso.rotation.y + r.pelvis.rotation.y) * 0.65;
    r.head.rotation.x = -lean * 0.55 + breath * 0.03;

    if (dashing) {
      // Tuck: lead knee up, trailing leg trailing, both heels folded under.
      r.legL.rotation.x = damp(r.legL.rotation.x, -0.6, 16, dt);
      r.legR.rotation.x = damp(r.legR.rotation.x, 0.35, 16, dt);
      r.shinL.rotation.x = damp(r.shinL.rotation.x, 1.1, 16, dt);
      r.shinR.rotation.x = damp(r.shinR.rotation.x, 0.35, 16, dt);
    } else {
      const swing = stride * 0.62 * g;
      r.legL.rotation.x = swing;
      r.legR.rotation.x = -swing;
      // Knees bend one way only, and that way is *backwards*: the heel comes up
      // behind the thigh. Positive, where the elbows below are negative, and the
      // asymmetry is the anatomy — on this rig a negative `rotation.x` throws a
      // segment forward, which is where a forearm goes and the exact opposite of
      // where a shin does. Both were negative until the sorceress arrived and
      // became the first body to actually carry `ShinL`/`ShinR`; on the warrior
      // and the marksman these writes land on detached stand-ins and render
      // nothing, so a backwards knee had nowhere to show itself.
      //
      // The bend peaks a beat *after* the thigh reaches the front of its swing,
      // which is the whole difference between a walk and a pair of scissors
      // opening and closing.
      r.shinL.rotation.x = Math.max(0, Math.sin(this.bob + 1.1)) * 1.05 * g;
      r.shinR.rotation.x = Math.max(0, Math.sin(this.bob + 1.1 + Math.PI)) * 1.05 * g;
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

    // Elbows. Held at a constant bend they would just be a shorter arm; what
    // makes them worth having is that the weapon arm *straightens into* the
    // strike — the bend is deepest at the top of the wind-up and gone by the
    // time the blade arrives, which is where the sense of effort comes from.
    //
    // Whichever axis the weapon was drawn back on, so the bend follows the
    // wind-up rather than one hard-coded direction of it: back across the body
    // for a blade, up and open for a book. Only during an attack — a cast
    // rolls the book face-out without drawing it back at all, and a bent elbow
    // on a push is the opposite of the pose.
    const load = attacking ? clamp(Math.max(-swung, -rolled), 0, 1.6) : 0;
    r.foreR.rotation.x = damp(
      r.foreR.rotation.x,
      (casting ? -0.08 : -0.22) -
        load * 0.55 +
        (attacking ? 0 : Math.abs(stride) * 0.12 * g),
      14,
      dt,
    );
    r.foreL.rotation.x = damp(
      r.foreL.rotation.x,
      -0.3 - Math.max(0, -stride) * 0.5 * g + (dashing ? -0.5 : 0),
      12,
      dt,
    );

    // The cape lags. It is one node and a damped angle, and it does more for
    // the sense of movement than the whole gait above: cloth that arrives late
    // is the cheapest simulation there is.
    //
    // Every contribution to it has to arrive as part of this *target*, never as
    // an adjustment applied to the angle afterwards. A damped value is state: it
    // keeps whatever was written to it, and a per-frame `-=` against it does not
    // nudge the pose, it integrates. The archer's draw pushed the cloak back by
    // 0.12 a frame against a filter that only pulls back 8% of the gap, which
    // settles a radian and a half out — the cloak stood up over the shade's head
    // as a black slab the size of a door. Read `-=` on a damped angle as a bug
    // on sight.
    const drawLift = this.def.weapon === "bow" ? 0.34 * this.bowDraw * this.aimHold : 0;
    r.cape.rotation.x = damp(
      r.cape.rotation.x,
      -0.34 * g - (dashing ? 0.5 : 0) - drawLift,
      5,
      dt,
    );
    r.cape.rotation.z = damp(r.cape.rotation.z, -stride * 0.16 * g, 6, dt);

    if (this.def.weapon === "bow") {
      this.poseArcherLocomotion(r, g, stride, dashing, dt);
      this.poseArchery(r, g, attacking, dashing);
    }
  }

  /**
   * Give the marksman a ready stance and a run of his own.
   *
   * The shared gait is deliberately upright because it also has to fit the
   * armoured warrior and the robed mage. On the archer that left both long
   * limbs almost straight whenever the bow was not fully aimed — visually a
   * T-pose even though the authored arms point down. A marksman instead keeps
   * his weight forward, knees soft and elbows tucked, then lengthens that same
   * low stance into the run. `poseArchery` is applied afterwards, so drawing
   * the string cleanly takes control of the upper body without snapping the
   * legs back to the generic pose.
   */
  private poseArcherLocomotion(
    r: Record<RigJoint, THREE.Object3D>,
    g: number,
    stride: number,
    dashing: boolean,
    dt: number,
  ) {
    if (dashing) {
      r.pelvis.rotation.x = 0;
      return;
    }

    // Keep a little of the ready stance while aiming. This makes firing during
    // a run feel planted, while the arms are allowed to pass entirely to the
    // bow pose as `aimHold` rises.
    const freeArms = 1 - this.aimHold;
    const crouch = 0.12 + g * 0.06;

    r.pelvis.rotation.x = crouch * 0.34;
    r.pelvis.rotation.y += -stride * 0.10 * g;
    r.pelvis.rotation.z += Math.cos(this.bob) * 0.055 * g;
    r.torso.rotation.x += 0.08 + g * 0.11 + Math.abs(stride) * 0.055 * g;
    r.torso.rotation.y += stride * 0.09 * g;
    r.torso.rotation.z += -stride * 0.05 * g;
    // The gaze stays generally forward but arrives a fraction behind the
    // shoulders. Tiny pitch/roll motion is enough to stop the head reading as
    // welded to the torso without making the aim look careless.
    r.head.rotation.x -= 0.018 + g * 0.018 + Math.abs(stride) * 0.014 * g;
    r.head.rotation.y += -stride * 0.04 * g;
    r.head.rotation.z += stride * 0.018 * g;

    // A run is not two straight legs swinging like scissors. One side folds
    // and reaches forward while the other extends behind to push off; half a
    // cycle later they exchange jobs. The positive half-wave gives each role a
    // full readable beat rather than blending both legs through the same pose.
    const leadL = Math.max(0, stride) * g;
    const leadR = Math.max(0, -stride) * g;
    r.legL.rotation.x = -crouch - leadL * 1.02 + leadR * 0.46;
    r.legR.rotation.x = -crouch - leadR * 1.02 + leadL * 0.46;
    // At speed the trailing knee is almost straight, so it can visibly drive
    // the body upward. Only the leading leg folds deeply toward the chest.
    const plantedKnee = lerp(crouch * 1.8, 0.08, g);
    r.shinL.rotation.x = plantedKnee + leadL * 1.48 + leadR * 0.03;
    r.shinR.rotation.x = plantedKnee + leadR * 1.48 + leadL * 0.03;

    // Keep the cape visible behind the back and give it only a restrained sway.
    // It intentionally ignores movement direction, avoiding flips while moving
    // down-screen or strafing relative to aim.
    const push = Math.abs(Math.cos(this.bob));
    const flutter = Math.sin(this.bob * 2 - 0.65);
    const broadWave = Math.sin(this.bob - 0.9);
    const capeBack = clamp(
      0.16 * g + 0.018 * push * g + 0.022 * flutter * g,
      0,
      0.22,
    );
    r.cape.rotation.x = damp(
      r.cape.rotation.x,
      capeBack,
      12,
      dt,
    );
    r.cape.rotation.z = damp(
      r.cape.rotation.z,
      -stride * 0.045 * g + Math.sin(this.bob * 0.5) * 0.018 * g,
      7,
      dt,
    );
    r.cape.rotation.y = damp(
      r.cape.rotation.y,
      broadWave * 0.018 * g + flutter * 0.008 * g,
      7,
      dt,
    );
    r.cape.position.x = damp(
      r.cape.position.x,
      this.capeRest.x,
      8,
      dt,
    );
    r.cape.position.y = damp(
      r.cape.position.y,
      this.capeRest.y,
      8,
      dt,
    );

    // Pin the cape at the shoulders and progressively loosen vertices toward
    // the hem. Crossing waves make it fold like fabric instead of rotating as
    // a single plastic plate.
    for (let meshIndex = 0; meshIndex < this.capeMeshes.length; meshIndex++) {
      const cloth = this.capeMeshes[meshIndex];
      const topY = cloth.minY + cloth.spanY;
      for (let i = 0; i < cloth.position.count; i++) {
        const j = i * 3;
        const down = clamp((topY - cloth.base[j + 1]) / cloth.spanY, 0, 1);
        const loose = down * down * (3 - 2 * down);
        const phase = this.bob * 1.2 - down * 2.2 + meshIndex * 0.7;
        cloth.position.setXYZ(
          i,
          cloth.base[j] + loose * Math.sin(phase * 0.72) * 0.012 * g,
          cloth.base[j + 1] + loose * Math.sin(phase * 1.18) * 0.005 * g,
          cloth.base[j + 2] + loose * Math.sin(phase) * 0.016 * g,
        );
      }
      cloth.position.needsUpdate = true;
    }
    r.cape.position.z = damp(
      r.cape.position.z,
      this.capeRest.z,
      8,
      dt,
    );

    // Bent, close arms replace the long straight silhouette at rest. During a
    // run they counter-swing, then fade out as the hands move onto the bow.
    r.armL.rotation.x += freeArms * (-0.13 - stride * 0.30 * g);
    r.armR.rotation.x += freeArms * (-0.10 + stride * 0.34 * g);
    r.armL.rotation.y = lerp(r.armL.rotation.y, -0.16, freeArms);
    r.armR.rotation.y = lerp(r.armR.rotation.y, 0.12, freeArms);
    r.armL.rotation.z = lerp(r.armL.rotation.z, 0.08 + stride * 0.06 * g, freeArms);
    r.armR.rotation.z = lerp(r.armR.rotation.z, -0.08 - stride * 0.06 * g, freeArms);
    r.foreL.rotation.x = lerp(
      r.foreL.rotation.x,
      -0.52 - Math.max(0, stride) * 0.20 * g,
      freeArms,
    );
    r.foreR.rotation.x = lerp(
      r.foreR.rotation.x,
      -0.46 - Math.max(0, -stride) * 0.24 * g,
      freeArms,
    );
  }

  /**
   * The archery stance, laid over the walk.
   *
   * Everything above poses a body around a weapon that swings. A bow does not
   * swing, and posing one off `swung` gives exactly what the marksman had: two
   * arms rising and falling together, which is a man lifting a box.
   *
   * A draw is a shape held between two hands doing opposite jobs. The bow arm
   * locks out along the aim and stops moving — it is the sight, and anything it
   * does that the target did not ask for is a miss. The string hand travels:
   * back past the jaw over the wind-up, gone in three frames at the loose, and
   * forward again to the quiver through the recovery. The chest opens between
   * them, which is where the sense of load comes from, and the head stays put
   * because the eye is already on the target.
   *
   * Written after the walk rather than instead of it, and blended by weight, so
   * a shade firing on the move still strides — only the arms and the turn of
   * the chest are taken over, and they come back when the shooting stops.
   */
  private poseArchery(
    r: Record<RigJoint, THREE.Object3D>,
    g: number,
    attacking: boolean,
    dashing: boolean,
  ) {
    // How much of the body the stance owns. It rises fast — a shot starts with
    // the bow already coming up — and falls slowly, so a burst of arrows is one
    // continuous stance with a draw cycling inside it rather than the arms
    // dropping to a walk between every shot. A dash cancels it outright: the
    // roll has its own tuck and an aim held through it reads as a glide.
    // Weight comes from `holdBow`, which ran with the weapon a moment ago — the
    // bow and the body have to be posed off the same number or the hand arrives
    // somewhere the grip is not.
    const w = dashing ? 0 : this.aimHold;

    // The kick. One exponential off the moment the string goes, and it is the
    // only thing on the model that says the shot had force: the bow hand jumps,
    // the chest squares up, and it is gone inside a fifth of a second.
    const a = this.currentAttack;
    const drawingSpecial = this.specialCharging;
    const since = attacking ? this.stateT - a.wind : 1;
    const kick = since >= 0 ? Math.exp(-since * 16) : 0;
    const chargeTurn = drawingSpecial ? smoothstep(this.specialCharge / 1.5) : 0;
    if (w < 0.002) return;
    const run = Math.sin(this.bob) * g;

    // Arms are intentionally not rotated here. After the torso is finished,
    // pinBowToHands builds one immutable shot frame and solves both two-bone
    // chains onto it. Letting guessed shoulder Eulers define the weapon made
    // every extra chest turn move the bow, string and arrow away from the aim.

    // The chest opens into the draw and squares up at the loose. This is the
    // wind-up: the arms are in place before the string moves, so the only thing
    // left to grow is the turn between the shoulders.
    // Opening the shoulders turns the model slightly to its right as the right
    // hand comes back with the string, then squares it on release.
    // Open away from the camera-side shoulder so the aiming silhouette is read
    // from the back: left arm forward, right elbow receding behind the torso.
    // Shoulders turn side-on; hips follow only a little. Rotating both equally
    // made the entire shade corkscrew instead of opening the upper back.
    // The charged special winds the body up beyond the normal ready stance.
    // Most of the turn sits in the shoulders, with enough hip rotation to keep
    // the model anatomical instead of twisting only one isolated joint.
    // Normal ready/LPM opens the shoulders by about 29 degrees. A fully charged
    // PPM adds only another 2 degrees. The previous sum exceeded 70 degrees and
    // physically carried the bow hand behind the player even though the arrow
    // itself still pointed at the cursor.
    // The base turn belongs to the stance, not bowDraw: the string can snap and
    // be re-nocked without the entire upper body twitching square in 50 ms.
    r.torso.rotation.y += w * (-0.62 - 0.04 * chargeTurn + 0.06 * kick);
    r.pelvis.rotation.y += w * (-0.09 - 0.02 * chargeTurn);
    r.torso.rotation.x += Math.abs(run) * 0.035;
    r.torso.rotation.x += w * (-0.075 + 0.06 * kick);
    r.torso.rotation.z += w * -0.035 * chargeTurn;
    r.pelvis.rotation.z += w * -0.012 * chargeTurn;
    // The eyes stay on the target while the shoulders turn under them. Written
    // against the torso's *final* angle rather than subtracting the turn the
    // draw just added — the walk set this line before the draw existed, and two
    // corrections chasing one number is how a head ends up looking away.
    r.head.rotation.y = lerp(
      r.head.rotation.y,
      -(r.torso.rotation.y + r.pelvis.rotation.y) * 0.8,
      w,
    );
    // Applied after every torso/run contribution: keep the skull seated above
    // the neck instead of inheriting enough forward pitch to fold into the
    // chest. A tiny live counter-motion remains, but never the old head bob.
    r.head.rotation.x = lerp(
      r.head.rotation.x,
      -0.025 + Math.abs(run) * 0.012,
      w,
    );
    r.head.rotation.z = lerp(r.head.rotation.z, run * 0.012, w);

    // The knee softens, and that is all the lower body gets.
    //
    // A braced archer stands with the feet apart, and there is no honest way to
    // write that here: the hips are a rotation and nothing translates, so
    // "apart" can only be bought by fanning both legs outward about the hip —
    // which swings the feet sideways *and upward*, off the floor the shadow is
    // still drawn on. It reads as the splits, performed in mid-air. A stance
    // that needs the feet moved needs the feet moved; rotating toward it is not
    // a cheaper version of the same thing, it is a different, worse pose.
    r.shinL.rotation.x += w * (1 - g) * 0.18;
    // The cloak's share of the draw is folded into its damp target in
    // animateBody, where the rest of that angle is decided. See the note there.
  }

  /**
   * Put the nocked arrow where the draw says it is.
   *
   * `sinceLoose` is seconds since the string went, or negative if it has not.
   * For the first breath after a shot the arrow is simply not there — the one
   * that was on the string is downrange, and hiding it is what stops the same
   * shaft appearing to bounce back onto the bow. What reappears is the next
   * one, which is exactly the beat the recovery is for.
   */
  /**
   * Carry the bow to the bow hand, and the aim weight everything else reads.
   *
   * The weapon hangs off a pivot at hip height, half a metre out to the side —
   * a swing arm, which is the right thing for a sword and a lie for a bow. Left
   * there through an attack the shade raises both arms to shoulder height while
   * the bow stays down by the belt, and the hands never touch it. That is the
   * single most obvious thing wrong with an animation that only rotates arms,
   * and no amount of work on the arms fixes it.
   *
   * So through the draw the pivot becomes the canonical shot frame: beside the
   * chest, shoulder-high and aligned with local +Z. The body is then solved onto
   * that frame, which lets the shoulders wind up without steering the weapon.
   */
  private holdBow(dt: number) {
    const rest = REST.bow;
    const attacking = this.state === "attack";
    const channeling = this.specialCharging;
    // A bow is carried ready, not slack. Idle and run therefore keep the full
    // stance; only a dash temporarily gives it up.
    const want = this.state === "dash" ? 0 : 1;
    // Rises fast, falls slow. Fast because the whole attack is 0.42s and a
    // stance that arrives late is a stance nobody sees; slow because a burst
    // has to stay one continuous aim with the draw cycling inside it, rather
    // than the arms dropping to a walk between every arrow.
    this.aimHold = damp(this.aimHold, want, want > 0 ? 30 : 6, dt);
    const w = this.aimHold;

    // Carried and aimed positions are both in the left hand. During a run the
    // carry point follows the same phase as that arm, so the grip cannot slide
    // through the palm while the shoulder and elbow move.
    const gait = this.gaitAmp;
    const stride = Math.sin(this.bob);
    const carryX = BOW_CARRY.x + stride * 0.025 * gait;
    const carryY = BOW_CARRY.y - stride * 0.085 * gait;
    const carryZ = BOW_CARRY.z + Math.abs(stride) * 0.035 * gait;
    this.weaponPivot.position.set(
      lerp(carryX, BOW_GRIP.x, w),
      lerp(carryY, BOW_GRIP.y, w),
      lerp(carryZ, BOW_GRIP.z, w),
    );

    // The draw, and it does not live where an attack animation usually puts it.
    //
    // This class fires with a 40ms wind-up and a 340ms recovery — the shot
    // leaves almost immediately and the long tail *is* the next arrow being
    // drawn, which is what classes.ts says and what the damage is priced on. An
    // animation that draws during the wind-up therefore has two and a half
    // frames to do it in, and what that looks like is an arm going up. So the
    // draw runs backwards against the attack: it is already back when the
    // string goes, empty for a breath, and pulled again across the recovery.
    const since = attacking ? this.stateT - this.currentAttack.wind : -1;
    if (this.state === "dash") {
      this.bowDraw = damp(this.bowDraw, 0, 18, dt);
    }
    else if (channeling) {
      // The right hand steadily pulls beyond the normal ready anchor. The cap
      // matches the final damage tier, so holding longer cannot distort the rig.
      const load = lerp(1, 1.19, smoothstep(this.specialCharge / 1.5));
      this.bowDraw = damp(this.bowDraw, load, 8, dt);
    }
    else if (!attacking) this.bowDraw = damp(this.bowDraw, 1, 14, dt);
    // Hard enough that the *first* shot of a burst is drawn too. Every later
    // one arrives already back off the previous recovery, but a shade opening
    // fire from a walk has forty milliseconds to nock, and firing a slack bow
    // once is enough to read as one.
    else if (since < 0) {
      // RMB loads beyond the normal anchor before the volley. LMB starts from
      // the already drawn ready pose and therefore remains immediate.
      const load = this.usingSpecial
        ? lerp(1, 1.22, smoothstep(this.stateT / this.currentAttack.wind))
        : 1;
      this.bowDraw = damp(this.bowDraw, load, 45, dt);
    }
    else if (since < LOOSE_TIME) this.bowDraw = 1 - since / LOOSE_TIME;
    else if (since < NOCK_DELAY) this.bowDraw = 0;
    else {
      // The right hand first reaches the now-straight string, then draws it to
      // the jaw over the remaining recovery. Because recover is multiplied by
      // attackSpeedMul for LMB, this visible draw speeds up with the stat too.
      const nock = Math.max(0.05, (this.currentAttack.recover - NOCK_DELAY) * 0.9);
      this.bowDraw = smoothstep((since - NOCK_DELAY) / nock);
    }
    this.poseArrow(since);

    // The authored limbs already carry the recurved silhouette. Scaling the
    // whole object to fake loading also squashed its grip and displaced both
    // hands, so keep the wood rigid; the live V-string carries the draw.
    if (this.bowBody) {
      this.bowBody.scale.set(1, 1, 1);
    }
    // Square to the target, and the kick. The rest pose turns the bow across
    // the body so its curve reads while it is being carried; held through a
    // shot that points the arrow thirty degrees off the thing being shot at,
    // which the eye catches at once because the projectile does not go that
    // way. Aimed, the bow is a vertical line with an arrow on it pointing where
    // the damage lands.
    const flick = since >= 0 ? Math.exp(-since * 14) : 0;
    const carryYaw = rest.y + stride * 0.10 * gait;
    const carryRoll = rest.x - stride * 0.08 * gait;
    // Recoil is a short translation along the unchanged shot axis. Pitching the
    // whole pivot here used to send the visible arrow up to 9.2 degrees away
    // from the projectile fired by gameplay.
    this.weaponPivot.position.z += 0.015 * flick * w;
    this.weaponPivot.rotation.y = lerp(carryYaw, 0, w);
    this.weaponPivot.rotation.x = lerp(carryRoll, 0, w);
    // Keep the same slight cant in ready, LPM and PPM. It rolls around the shot
    // axis, so the silhouette changes without changing where the arrow points.
    this.weaponPivot.rotation.z = lerp(
      this.weaponPivot.rotation.z,
      BOW_ROLL,
      clamp(dt * 18, 0, 1),
    );
  }

  private poseArrow(sinceLoose = -1) {
    const arrow = this.bowArrow;
    if (!arrow) return;
    arrow.position.z = -0.30 * this.bowDraw;
    const looseBeat = sinceLoose >= 0 && sinceLoose < NOCK_DELAY;
    const reachingForNext = this.bowDraw < 0.7;
    // A replacement shaft does not grow out of the grip while the hand reaches
    // forward after either a shot or a dash. It appears only once it is
    // substantially nocked, then remains on the same two exact contacts for the
    // rest of the draw.
    arrow.visible = this.state !== "dash" && !looseBeat && !reachingForNext;
  }

  /**
   * Solve one segmented arm onto an authored hand target.
   *
   * The target and pole arrive in world space. The elbow is found analytically
   * from the two real segment lengths, then each joint maps its authored rest
   * vector onto the solved direction. Shoulder positions remain untouched, so
   * neither upper arm can climb out through the cape during a deep draw.
   */
  private solveArmIK(
    upper: THREE.Object3D,
    lower: THREE.Object3D,
    handOffset: THREE.Vector3,
    targetWorld: THREE.Vector3,
    poleWorld: THREE.Vector3,
    weight: number,
  ) {
    const parent = upper.parent;
    if (!parent || !lower.parent || weight <= 0.001) return;

    parent.updateWorldMatrix(true, false);
    const target = parent.worldToLocal(targetWorld.clone());
    const pole = parent.worldToLocal(poleWorld.clone());
    const shoulder = upper.position.clone();
    const l1 = lower.position.length();
    const l2 = handOffset.length();
    const toTarget = target.clone().sub(shoulder);
    const rawDistance = toTarget.length();
    if (rawDistance < 0.0001 || l1 < 0.0001 || l2 < 0.0001) return;

    const direction = toTarget.normalize();
    const distance = clamp(rawDistance, Math.abs(l1 - l2) + 0.002, l1 + l2 - 0.002);
    const reachableTarget = shoulder.clone().addScaledVector(direction, distance);
    const poleOffset = pole.sub(shoulder);
    const planeNormal = new THREE.Vector3().crossVectors(direction, poleOffset);
    if (planeNormal.lengthSq() < 0.000001) planeNormal.set(0, 0, 1);
    planeNormal.normalize();
    const bendDirection = new THREE.Vector3()
      .crossVectors(planeNormal, direction)
      .normalize();
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const elbow = shoulder
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(bendDirection, height);

    // Map the whole authored elbow plane, not only the upper-arm direction.
    // The shortest-arc quaternion reaches the point but leaves axial twist
    // arbitrary, which turned the broad side of the low-poly arm toward camera.
    const bindUpper = lower.position.clone().normalize();
    const bindLower = handOffset.clone().normalize();
    const bindNormal = new THREE.Vector3().crossVectors(bindUpper, bindLower);
    if (bindNormal.lengthSq() < 0.000001) bindNormal.set(0, 0, 1);
    bindNormal.normalize();
    const bindBend = new THREE.Vector3().crossVectors(bindNormal, bindUpper).normalize();
    const targetUpper = elbow.clone().sub(shoulder).normalize();
    const targetLower = reachableTarget.clone().sub(elbow).normalize();
    const targetNormal = new THREE.Vector3().crossVectors(targetUpper, targetLower);
    if (targetNormal.lengthSq() < 0.000001) targetNormal.copy(planeNormal).negate();
    targetNormal.normalize();
    const targetBend = new THREE.Vector3()
      .crossVectors(targetNormal, targetUpper)
      .normalize();
    const bindBasis = new THREE.Matrix4().makeBasis(bindUpper, bindBend, bindNormal);
    const targetBasis = new THREE.Matrix4().makeBasis(targetUpper, targetBend, targetNormal);
    const bindQ = new THREE.Quaternion().setFromRotationMatrix(bindBasis);
    const targetQ = new THREE.Quaternion()
      .setFromRotationMatrix(targetBasis)
      .multiply(bindQ.invert());
    upper.quaternion.slerp(targetQ, weight);

    const targetInUpper = reachableTarget
      .clone()
      .sub(shoulder)
      .applyQuaternion(upper.quaternion.clone().invert());
    const lowerDirection = targetInUpper.sub(lower.position).normalize();
    const lowerTarget = new THREE.Quaternion().setFromUnitVectors(bindLower, lowerDirection);
    lower.quaternion.slerp(lowerTarget, weight);
    upper.updateMatrixWorld(true);
  }

  /** Build the shot frame, then put both hands onto it. Never the reverse. */
  private pinBowToHands() {
    const r = this.rig;
    const bow = this.bowBody;
    if (!r || !bow) return;

    // The bow frame is already fixed in player space by holdBow. Its local +Z
    // is the exact gameplay aim, shared by idle, LPM and PPM. Torso rotation is
    // therefore free to sell the load without ever steering the weapon.
    this.mesh.updateMatrixWorld(true);
    bow.updateMatrixWorld(true);
    const gripWorld = bow.localToWorld(new THREE.Vector3());
    const normalLoad = clamp(this.bowDraw, 0, 1);
    const extraLoad = smoothstep((this.bowDraw - 1) / 0.19);
    const drawDistance = BOW_NORMAL_DRAW * normalLoad +
      (BOW_FULL_DRAW - BOW_NORMAL_DRAW) * extraLoad;
    const stringNock = new THREE.Vector3(0, 0, -drawDistance);
    const stringNockWorld = bow.localToWorld(stringNock.clone());

    // For the three loose frames the fingers stay by the jaw while the released
    // string snaps to the riser. During recovery the hand meets the new nock and
    // follows it back, which reads as reach -> catch -> draw instead of a hand
    // glued to elastic.
    const sinceLoose = this.state === "attack"
      ? this.stateT - this.currentAttack.wind
      : -1;
    const handNock = stringNock.clone();
    if (sinceLoose >= 0 && sinceLoose < NOCK_DELAY) {
      const anchor = -BOW_NORMAL_DRAW - 0.025 * Math.exp(-sinceLoose * 18);
      const reach = smoothstep(
        (sinceLoose - LOOSE_TIME) / Math.max(0.001, NOCK_DELAY - LOOSE_TIME),
      );
      handNock.z = lerp(anchor, 0, reach);
    }
    const handNockWorld = bow.localToWorld(handNock.clone());
    const bowPoleWorld = this.mesh.localToWorld(BOW_ELBOW_POLE.clone());
    const stringPoleWorld = this.mesh.localToWorld(
      STRING_ELBOW_POLE.clone().addScaledVector(STRING_ELBOW_CHARGE, extraLoad),
    );

    // Authored R is the visible/anatomical left arm holding the wood; authored
    // L is the right arm pulling the string beside the body.
    this.solveArmIK(r.armR, r.foreR, HAND_R, gripWorld, bowPoleWorld, 1);
    this.solveArmIK(r.armL, r.foreL, HAND_L, handNockWorld, stringPoleWorld, this.aimHold);
    this.mesh.updateMatrixWorld(true);

    // Both LPM and PPM bend the wood. PPM merely adds the last four centimetres
    // of tip travel; release drives bowDraw to zero and restores the base mesh.
    const tipPull = 0.085 * normalLoad + 0.04 * extraLoad;
    const vertex = new THREE.Vector3();
    for (const limb of this.bowMeshes) {
      for (let i = 0; i < limb.position.count; i++) {
        const j = i * 3;
        vertex
          .set(limb.base[j], limb.base[j + 1], limb.base[j + 2])
          .applyMatrix4(limb.toBow);
        const alongBow = clamp(Math.abs(vertex.y) / 0.79, 0, 1);
        vertex.z -= tipPull * Math.pow(alongBow, 1.55);
        vertex.applyMatrix4(limb.fromBow);
        limb.position.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      limb.position.needsUpdate = true;
    }

    const tipZ = -0.014 - tipPull;
    if (this.bowString) {
      const p = this.bowString.geometry.getAttribute("position") as THREE.BufferAttribute;
      p.setXYZ(0, 0, 0.79, tipZ);
      p.setXYZ(1, stringNock.x, stringNock.y, stringNock.z);
      p.setXYZ(2, stringNock.x, stringNock.y, stringNock.z);
      p.setXYZ(3, 0, -0.79, tipZ);
      p.needsUpdate = true;
    }
    if (this.bowArrow?.visible) {
      // Fit two authored landmarks to two non-negotiable contacts: the back of
      // the feathers/nock sits on the string bend and the metal point sits in
      // the centre/front face of the wooden riser. Solving both also avoids
      // treating the Arrow node's origin as a nock when it is not one.
      const arrowScale =
        (BOW_RISER_Z - stringNock.z) / (ARROW_TIP_Z - ARROW_NOCK_Z);
      const arrowOriginZ = stringNock.z - ARROW_NOCK_Z * arrowScale;
      this.bowArrow.position.set(0, 0, arrowOriginZ);
      this.bowArrow.quaternion.identity();
      this.bowArrow.scale.set(1, 1, arrowScale);
    }
  }

  private animateWeapon(dt: number) {
    const rest = REST[this.def.weapon];
    let targetY = rest.y;
    let targetX = rest.x;

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
          this.weaponPivot.rotation.y = lerp(rest.y, from, k);
          this.weaponPivot.rotation.x = lerp(rest.x, raised, k);
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
        this.weaponPivot.rotation.y = lerp(to, rest.y, k);
        this.weaponPivot.rotation.x = lerp(chopped, rest.x, k);
        return;
      }

      // The bow has no branch here. Everything a bow does — the aim, the draw,
      // the loose, the kick — is one continuous cycle that outlives any single
      // attack, so it lives in `holdBow`, which runs in every state. A pose
      // written here as well would be a second hand on the same wheel.
      if (this.def.weapon === "bow") return;

      // Book: tip it open and overhead through the wind-up, then slam it out
      // and shut. The release used to snap between two fixed poses in a single
      // frame, which is why the thrust had no weight — now it drives through
      // and settles.
      //
      // Almost all of it is on `x`, the roll. That is the axis a book has: it
      // is a broad flat face on the end of an arm, and turning that face from
      // sky to target is the only motion on it a player can read from above.
      // Swinging it sideways like a blade only ever showed its spine.
      if (this.stateT < a.wind) {
        const k = easeOut(this.stateT / a.wind);
        this.weaponPivot.rotation.x = lerp(rest.x, -0.9, k);
        this.weaponPivot.rotation.y = lerp(rest.y, -0.25, k);
        return;
      }
      const bookEnd = a.wind + a.active;
      if (this.stateT < bookEnd) {
        const k = easeOutCubic((this.stateT - a.wind) / a.active);
        this.weaponPivot.rotation.x = lerp(-0.9, 0.62, k);
        this.weaponPivot.rotation.y = lerp(-0.25, 0.24, k);
        return;
      }
      const settle = smoothstep(
        clamp((this.stateT - bookEnd) / Math.max(0.0001, a.recover), 0, 1),
      );
      this.weaponPivot.rotation.x = lerp(0.62, rest.x, settle);
      this.weaponPivot.rotation.y = lerp(0.24, rest.y, settle);
      return;
    }

    // Cast had no pose at all: the weapon simply hung at rest while a bolt
    // appeared out of nowhere. A short shove forward gives the bolt a source.
    if (this.state === "cast") {
      const k = clamp(this.stateT / 0.18, 0, 1);
      // Out hard, back soft — one sine hump over the whole cast.
      const push = Math.sin(k * Math.PI);
      const reach = this.def.weapon === "book" ? 0.75 : 0.5;
      this.weaponPivot.rotation.x = lerp(targetX, -reach, easeOutCubic(push));
      this.weaponPivot.rotation.y = lerp(rest.y, rest.y * 0.2, push);
      return;
    }

    // Dash: tuck the weapon in behind the shoulder so the silhouette leads with
    // the body. A blade left swinging out front reads as an attack.
    if (this.state === "dash") {
      targetY = rest.y - 0.55;
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
