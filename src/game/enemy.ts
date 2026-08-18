import * as THREE from 'three';
import type { Actor } from './actor';
import { angleDelta, clamp, damp, rand, TAU } from '../core/math';
import { addOutline } from '../render/outline';
import { fitToHeight, instance, loadModel } from '../render/models';
import { hexString, makeBodySkin, makeBoneSkin } from '../render/skin';
import { t } from '../ui/i18n';

// Scratch objects for skeletal posing, reused every frame so a rigged boss does
// not allocate a quaternion per bone per tick.
const _boneQ = new THREE.Quaternion();
const _boneE = new THREE.Euler();

export type EnemyKind = 'wretch' | 'lobber' | 'brute' | 'erinys' | 'hydra' | 'champion' | 'belial';

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
    /*
     * Measured against the sculpt, not guessed. The beast is a quadruped: 2.09
     * long against the 1.0 this used to describe, so a swing at its head or its
     * tail passed through and hit nothing. Half the animal was decoration.
     *
     * 0.68 puts the circle at 1.36 across, which covers the body between the
     * shoulders and leaves only the snout and the tail-tip outside — the parts a
     * player reads as "reach", not as "mass". Matching the full 2.09 would mean
     * hitting empty floor a stride behind it, which is the same lie inverted.
     */
    radius: 0.68,
    speed: 4.6,
    /*
     * Deep crimson. The gradient is drawn from this, so it is the whole animal.
     *
     * Two things it has to stay clear of, and both pushed it darker and cooler
     * than a plain red:
     *
     * Asphodel is a red room — floor #3a2018, walls #3a0e10 — and a foe sharing
     * the room's hue is exactly the camouflage the old cold slate was chosen to
     * avoid. This sits far enough above those in both lightness and saturation
     * to cut out against them.
     *
     * The wind-up telegraph is also red, and much hotter: a near-pure emissive
     * orange that ramps over the tell. That signal has to stay the loudest red
     * on screen, so the body leans away from orange rather than toward it.
     */
    color: 0x872634,
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
    /*
     * The hoplite is 2.58 across and 1.65 deep — the width is shield and spear,
     * the depth is the man. 1.05 sets the circle at 2.10, between the two: a
     * swing at the shield connects, and the overhang left outside is the
     * equipment, which is what a player expects to be reaching past.
     */
    radius: 1.05,
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
    get title() {
      return t('boss.erinys');
    },
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
    get title() {
      return t('boss.hydra');
    },
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
    get title() {
      return t('boss.champion');
    },
  },

  belial: {
    /*
     * The Legion lord — the climb's last guardian, above Elysium. Not a pair and
     * not rooted like the two realms below him: a lone, mobile demon that closes
     * distance himself, so his health has to buy a longer fight than the hydra's
     * stationary 1400 without the two-body split the champions get. 1500 lands
     * him hardest of the four while staying a single health bar.
     */
    hp: 1500,
    /*
     * The sculpt is 0.87 wide, 0.46 deep and reads as a broad-shouldered
     * humanoid. 1.3 sets the circle at 2.6 across — mass between the shoulders,
     * the ragged lower body and reaching arms left outside as "reach".
     */
    radius: 1.3,
    speed: 5.0,
    /*
     * Charcoal-wine body against a molten trim. His own realm is black-violet
     * ash lit by hellfire, so the body leans dark and desaturated to sit apart
     * from the flame telegraph (a hot orange emissive) that has to stay the
     * loudest thing on screen through his wind-ups.
     */
    color: 0x5a2633,
    trim: 0xff7a2a,
    scale: 2.0,
    contact: 30,
    tell: 0.55,
    attackRange: 3.8,
    cooldown: 1.1,
    boss: true,
    get title() {
      return t('boss.belial');
    },
  },
};

/**
 * Foes with a mesh authored in Blender rather than assembled from primitives.
 *
 * The primitive rig is still built first and is still a complete enemy on its
 * own — the file may be slow, may be missing, and the fight has to start on
 * frame zero regardless. Anything not listed here simply never swaps.
 */
const AUTHORED: Partial<Record<EnemyKind, { url: string; height: number; rigged?: boolean }>> = {
  // Erinys is the first boss, so she is the one worth looking at closest.
  erinys: { url: '/models/minotaur.glb', height: 2.2 },
  // The wretch is the foe the run is mostly made of — every chamber opens with
  // a pack of them. 1.9 against the player's 2.1 keeps it readably smaller
  // without turning it into vermin.
  //
  // The beast is wider than it is tall — 1.96 x 1.41 x 1.60 against the
  // vampire's upright build. `fitToHeight` scales on height alone, so asking for
  // the old 1.9 would blow it out to 2.6 across against a 0.5 collision radius:
  // a body two and a half times the width of the thing it actually fights with.
  // 1.5 keeps the footprint honest and still reads taller than the player's
  // knee. See tools/MODELS.md.
  wretch: { url: '/models/tartarus_beast.glb', height: 1.5 },
  // The brute, as a spear-and-shield hoplite. Upright, so unlike the beast it
  // fits on height honestly.
  //
  // 1.75 is not the height you see: the archetype's `scale` of 1.7 multiplies
  // whatever `fitToHeight` sets, so this lands at 2.98 — half again the player's
  // 2.1 and well under Erinys at 4.4. The heavy has to read as the thing you
  // deal with before it reaches you, without being mistaken for a boss.
  brute: { url: '/models/tartarus_hoplit.glb', height: 1.75, rigged: true },
  // Belial, the Legion lord. 2.3 against his archetype scale of 2.0 lands at 4.6
  // — a shade over Erinys at 4.4, so the last guardian reads as the biggest body
  // in the run without dwarfing the room he fights in.
  belial: { url: '/models/belial.glb', height: 2.3, rigged: true },
};

/**
 * The three statuses a god's boon can actually inflict.
 *
 * Each one has to be a different *kind* of effect, not a different number, or
 * the player has no reason to prefer one god's offer over another:
 *   weak  — the foe hits softer (defensive)
 *   doom  — a delayed lump of damage (burst, rewards moving on)
 *   shock — a jolt that arcs to whatever is standing nearby (crowds)
 */
export type StatusKind = 'weak' | 'doom' | 'shock' | 'burn';

/** Bit per status, for the HUD tint and the wire. Order matches STATUS_KINDS. */
export const STATUS_KINDS: StatusKind[] = ['weak', 'doom', 'shock', 'burn'];

export const STATUS_COLOR: Record<StatusKind, number> = {
  weak: 0xff6f9c,
  doom: 0xe2384a,
  shock: 0xffe066,
  burn: 0xff8a3c,
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
  // The Legion lord commands the whole board rather than one range band: he
  // closes with Erinys's charge, walls the rim with the hydra's sweep, sends his
  // own adds, then punishes the retreat with the champions' thrown line. A
  // four-beat rotation no single realm boss runs — built from moves already in
  // the pattern machine, so it needs no new combat code.
  belial: ['charge', 'sweep', 'summon', 'throw'],
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

  /**
   * Seconds left on each status. Zero means not afflicted; the World owns what
   * they *do*, the Enemy only owns how long they last and how they look.
   */
  status: Record<StatusKind, number> = { weak: 0, doom: 0, shock: 0, burn: 0 };
  /** Damage a burn deals each beat, and who is owed the credit for it. */
  burnDps = 0;
  burnSourceId = -1;
  /** Counts down to the next beat of burn damage. */
  burnTick = 0;
  /** Gate on burn spreading, so a crowd does not relight itself every frame. */
  burnSpreadCd = 0;
  /** Damage banked by Doom, paid out in one lump when the timer runs out. */
  doomPayload = 0;
  /** Player id owed the credit (crit, lifesteal, call gauge) for that payout. */
  doomSourceId = -1;
  /** Shock's own cooldown, so a burst of bolts can't chain-zap every frame. */
  shockCd = 0;

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
  /** The disc on the floor. Kept when an authored mesh replaces the rig. */
  private shadow?: THREE.Object3D;
  /**
   * The body, under the pivot that carries facing.
   *
   * Everything that animates lives in here rather than on `mesh`, because `mesh`
   * owns world placement: its `rotation.y` is rewritten to the facing every
   * frame, so a pitch put there would be a pitch around the world's X axis and
   * the beast would rear sideways whenever it happened to be walking east. In
   * here, +Z is the direction it is looking, and a lunge is one number.
   *
   * The ground shadow deliberately stays outside — a shadow does not lunge.
   */
  private body = new THREE.Group();
  targetId = -1;
  mesh = new THREE.Group();
  a: Archetype;
  /** Slight per-instance speed jitter so a pack doesn't move as one blob. */
  private jitter = rand(0.9, 1.1);
  private bodyMat!: THREE.MeshStandardMaterial;
  /**
   * Every material the telegraph writes to. One entry while the body is the
   * primitive rig; however many the authored mesh brought once it has swapped
   * in. Without this an authored boss would wind up and strike with no tell —
   * the emissive ramp is the whole readability language of the fight.
   */
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private bob = rand(0, 6);

  /**
   * A skinned body drives its limbs through bones instead of the whole-body
   * gait. Empty until an authored mesh that carries a skeleton swaps in; while
   * it is empty the enemy animates exactly as before.
   */
  private rigged = false;
  private bones: Record<string, THREE.Bone> = {};
  private boneRest: Record<string, THREE.Quaternion> = {};

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
    this.flashMats = [this.bodyMat];
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
      this.body.add(arm);
    }

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
      eye.position.set(s * 0.1, 1.54, 0.3);
      this.body.add(eye);
    }

    this.buildKindMarks(trimMat, boneMat);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(a.radius * 1.05, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
    );
    shadow.position.y = 0.03;

    this.body.add(body, shoulders, skull);
    this.mesh.add(this.body, shadow);
    addOutline(this.mesh, 0.032);
    this.mesh.scale.setScalar(a.scale);
    this.mesh.position.y = -1.2; // rises out of the floor on spawn

    this.shadow = shadow;
    void this.loadAuthoredMesh();
  }

  /**
   * Swap the primitive rig for a mesh authored in Blender.
   *
   * Everything the rig built goes, apart from the ground shadow and the boss's
   * halo — the sculpt carries the silhouette now, and a leftover cone of horns
   * would be floating inside its skull.
   *
   * The material is ours, not the file's — exports arrive with whatever the tool
   * felt like, routinely fully metallic and untextured, which renders as a black
   * cut-out under the arena's point lights.
   *
   * Which of ours depends on one thing: whether the sculpt was unwrapped. With
   * UVs it wears the same painted skin the primitive rig does — but *without the
   * armour banding*. Those bands were drawn for a cylinder: on a torso they read
   * as plates strapped round a chest, and the cylindrical unwrap that feeds them
   * only knows height, so on a whole creature the same stripes run straight
   * across the legs, the shield and the spear. A sculpted body came out looking
   * like a deckchair.
   *
   * What survives is the part that was never about a cylinder: the vertical
   * light-to-dark ramp, which grounds anything with a top and a bottom, and the
   * grime speckle that keeps the flats from reading as vector shapes.
   *
   * Without UVs there is nothing to sample, and a flat coat in the archetype's
   * colour is the honest fallback. Either way the material belongs to this
   * class, so the tell glow, the hit flash and the status tints keep driving it.
   */
  private async loadAuthoredMesh() {
    const want = AUTHORED[this.kind];
    if (!want) return;
    const src = await loadModel(want.url).catch(() => null);
    // No asset, no swap: the primitive rig is a complete enemy on its own.
    if (!src || this.dead) return;

    let unwrapped = false;
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry.attributes.uv) unwrapped = true;
    });

    let mat: THREE.MeshStandardMaterial;
    if (unwrapped) {
      // Reuse the material rather than rebuild it — flashMats already points at
      // it — but repaint the canvas without the bands. See the note above.
      mat = this.bodyMat;
      mat.map?.dispose();
      mat.map = makeBodySkin(hexString(this.a.color), hexString(this.a.trim), {
        plates: 0,
        rags: false,
      });
      mat.needsUpdate = true;
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: this.a.color,
        roughness: 0.72,
        metalness: 0.05,
      });
      // Elites had their hot rim written onto the rig's material; carry it
      // across or an elite quietly becomes a common foe when its mesh lands.
      mat.emissive.copy(this.bodyMat.emissive);
    }
    const body = instance(src, mat);
    fitToHeight(body, want.height);
    this.flashMats = [mat];

    // The rig lives under `body` now, so that is what gets emptied. The shadow
    // and any halo sit on `mesh` beside it and are left alone by construction.
    for (const child of [...this.body.children]) {
      this.body.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !m.userData.sharedGeometry) m.geometry.dispose();
      });
    }
    // Their pivots have just been thrown away; without this the idle animation
    // keeps beating wings that are no longer in the scene.
    this.wings = [];
    this.heads = [];

    addOutline(body, 0.032);
    this.body.add(body);

    if (want.rigged) this.setupRig(body);
  }

  /**
   * Catch the skeleton the authored mesh brought in. The bones are named in the
   * player rig's scheme (`ArmL`, `LegR`, `Spine`…); animateSkeleton rotates them
   * off their rest pose, so their rest orientation is captured here once. With
   * no bones found the enemy quietly falls back to the whole-body gait.
   */
  private setupRig(body: THREE.Object3D) {
    const names = [
      'Pelvis', 'Spine', 'Head',
      'ArmL', 'ForearmL', 'ArmR', 'ForearmR',
      'LegL', 'ShinL', 'LegR', 'ShinR',
    ];
    for (const name of names) {
      const bone = body.getObjectByName(name) as THREE.Bone | undefined;
      if (bone?.isBone) {
        this.bones[name] = bone;
        this.boneRest[name] = bone.quaternion.clone();
      }
    }
    this.rigged = Object.keys(this.bones).length > 0;
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
      this.body.add(horn);
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
      this.body.add(staff, orb, sack);
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
      this.body.add(mound);

      // Bone spurs around the rim. Sunk into the dome so they read as part of
      // the carcass — free-floating ribs just looked like scattered debris.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        const spur = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.44, 5), boneMat);
        spur.position.set(Math.cos(a) * 1.16, 0.42, Math.sin(a) * 1.16);
        spur.rotation.set(Math.PI / 2.6, 0, -a);
        spur.castShadow = true;
        this.body.add(spur);
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
        this.body.add(neck);
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

      this.body.add(crest, helm, shield, spear, tip);
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
        this.body.add(pivot);
      }

      // Crown of horns and the whip she lashes with.
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.72, 6), trimMat);
        horn.position.set(s * 0.16, 1.86, -0.04);
        horn.rotation.set(-0.3, 0, s * 0.34);
        horn.castShadow = true;
        this.body.add(horn);
      }
      const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 1.7, 6), trimMat);
      whip.position.set(0.62, 1.0, 0.45);
      whip.rotation.set(0.9, 0, -0.3);
      whip.castShadow = true;

      const halo = new THREE.PointLight(0xff2a55, 9, 9, 2);
      halo.position.set(0, 1.8, 0);
      this.body.add(whip);
      // A light, not a limb — it stays on the pivot so a lunge does not drag the
      // whole room's glow forward with it.
      this.mesh.add(halo);
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
      this.body.add(horn, spike);
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
      this.glow(0.25, 0.05, 0.02);
    }
  }

  /** The telegraph, written to whatever the body is currently wearing. */
  private glow(r: number, g: number, b: number) {
    for (const m of this.flashMats) m.emissive.setRGB(r, g, b);
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

  /** The status that gets to own the body tint. Doom first — it's the one on a clock. */
  get worstStatus(): StatusKind | null {
    if (this.status.doom > 0) return 'doom';
    if (this.status.burn > 0) return 'burn';
    if (this.status.shock > 0) return 'shock';
    if (this.status.weak > 0) return 'weak';
    return null;
  }

  /** Statuses as a bitmask, for the wire. */
  get statusBits() {
    let bits = 0;
    STATUS_KINDS.forEach((k, i) => {
      if (this.status[k] > 0) bits |= 1 << i;
    });
    return bits;
  }

  tick(dt: number) {
    this.stateT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.stagger = Math.max(0, this.stagger - dt);
    this.shockCd = Math.max(0, this.shockCd - dt);
    this.burnSpreadCd = Math.max(0, this.burnSpreadCd - dt);

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
      // The bob moved onto `body` with the rest of the gait — `mesh` is where
      // the spawn rise and the death sink live, and the ground shadow hangs off
      // it. While that carried the bob, the shadow lifted off the floor with
      // every step.
      this.mesh.position.y = 0;
    }

    // Two distinct emissive languages, never confusable:
    //   tell  -> hot red, ramping up over the wind-up ("I am about to hit you")
    //   flash -> white, one frame ("you hit me")
    // A boss's wind-up lives inside its pattern state rather than a 'tell' state,
    // but it has to glow exactly the same way — one telegraph language, always.
    const winding = this.state === 'tell' || (this.state === 'pattern' && !this.strikeDone);
    const tellHeat = winding ? clamp(this.stateT / this.a.tell, 0, 1) : 0;
    const heat = tellHeat * tellHeat;
    // A third, quieter language underneath both: statuses. They pulse rather
    // than ramp or blink, so at a glance you can tell "afflicted" from "about to
    // hit you" without reading a number. Anything louder wins the frame.
    if (this.flash > heat) {
      this.glow(this.flash, this.flash * 0.95, this.flash * 0.9);
    } else if (heat > 0.02) {
      this.glow(heat * 1.6, heat * 0.12, heat * 0.05);
    } else {
      const worn = this.worstStatus;
      if (worn) {
        // Doom counts down visibly — the pulse tightens as the payload nears.
        const rate = worn === 'doom' ? 5 + 10 / Math.max(0.2, this.status.doom) : 6;
        const pulse = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(this.stateT * rate));
        for (const m of this.flashMats) m.emissive.setHex(STATUS_COLOR[worn]).multiplyScalar(pulse);
      } else {
        this.glow(0, 0, 0);
      }
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

    if (this.state !== 'dead') this.mesh.scale.setScalar(this.a.scale);
    // A rigged body moves its own limbs; the whole-body gait would fight the
    // skeleton, so it is one or the other.
    if (this.rigged) this.animateSkeleton(dt);
    else this.animateBody(dt);
  }

  /**
   * Procedural skeletal gait for a rigged foe.
   *
   * Same idea as the player rig: no clips, just named bones rotated off their
   * rest pose each frame. Arms and legs swing in antiphase at the stride rate,
   * a wind-up lifts the arms as the tell ramps, and the strike throws them
   * forward — driven by the same `state` and `stateT` the emissive telegraph
   * already reads, so limb and glow land on the same frame.
   */
  private animateSkeleton(dt: number) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const g = this.gait();
    this.bob += dt * (5 + speed) * g.rate;
    const stride = clamp(speed / this.moveSpeed, 0, 1);

    const phase = Math.sin(this.bob * 0.5);
    const armAmp = 0.1 + stride * 0.5;
    const legAmp = 0.06 + stride * 0.55;

    // Wind-up lifts the arms; committed strike throws them forward. Both read the
    // same clock as the tell so nothing has to be kept in sync by hand.
    const winding = this.state === 'tell' || (this.state === 'pattern' && !this.strikeDone);
    const raise = winding ? clamp(this.stateT / this.a.tell, 0, 1) ** 2 : 0;
    const striking = this.state === 'strike' || (this.state === 'pattern' && this.strikeDone);
    const throwT = striking ? clamp(this.stateT * 3, 0, 1) : 0;

    // Positive local-X swings a limb forward on this rig (matches the Blender
    // pose test). Arms oppose legs; left opposes right.
    const armX = -raise * 1.3 + throwT * 1.1;
    this.setBone('ArmR', armX + phase * armAmp);
    this.setBone('ArmL', armX - phase * armAmp);
    this.setBone('ForearmR', -raise * 0.9 - throwT * 0.3);
    this.setBone('ForearmL', -raise * 0.9 - throwT * 0.3);

    this.setBone('LegR', -phase * legAmp);
    this.setBone('LegL', phase * legAmp);
    this.setBone('ShinR', Math.max(0, phase) * legAmp * 0.8);
    this.setBone('ShinL', Math.max(0, -phase) * legAmp * 0.8);

    // Spine breathes and leans into a strike; the head counter-rotates a touch so
    // the body never turns as one board.
    this.setBone('Spine', throwT * 0.25 + Math.sin(this.bob) * 0.02 * (0.4 + stride), phase * 0.06);
    this.setBone('Head', 0, -phase * 0.05);
  }

  /** Rotate one bone off its captured rest pose by an XYZ-Euler delta. */
  private setBone(name: string, x = 0, y = 0, z = 0) {
    const bone = this.bones[name];
    if (!bone) return;
    bone.quaternion.copy(this.boneRest[name]).multiply(_boneQ.setFromEuler(_boneE.set(x, y, z)));
  }

  /**
   * The walk.
   *
   * These sculpts have no skeleton — they arrive as one mesh, and the pipeline's
   * humanoid splitter cannot help here: it classifies by position, so the
   * hoplite's shield came out as part of its right leg and the tip of its spear
   * as part of its head. A leg that swings a shield is worse than a leg that
   * does not move.
   *
   * So the gait is carried by the whole body, which is how a heavy thing reads
   * at this camera distance anyway: weight thrown from one side to the other,
   * the body dropping as it lands and rising as it pushes off. Two cues do most
   * of the work — the roll and the bob — and they run at the same rate a stride
   * would, one full cycle per two steps.
   */
  private gait(): {
    rate: number;
    bob: number;
    roll: number;
    pitch: number;
    sway: number;
    yaw: number;
    lean: number;
  } {
    // A quadruped's gait is quick and low, and it pitches: the shoulders drop
    // as the forelegs take the weight. There is no side-to-side lurch in it.
    if (this.kind === 'wretch') {
      return { rate: 1.35, bob: 0.055, roll: 0.035, pitch: 0.05, sway: 0.02, yaw: 0.03, lean: 0.04 };
    }
    /*
     * Armoured, slow, and — the part that decides the whole animation — with no
     * legs to show. The sculpt is a cloaked figure: below the waist it is one
     * shaggy hem with boots poking out, so there is nothing to swing even if the
     * body were cut into parts.
     *
     * What is left is what a heavy walker actually reads by from this camera:
     * the mass thrown from side to side, and the shoulders turning against the
     * hips. The yaw is the strongest cue here — it is the one thing a rigid prop
     * being slid across the floor never does.
     */
    if (this.kind === 'brute') {
      return { rate: 0.62, bob: 0.055, roll: 0.13, pitch: 0.02, sway: 0.06, yaw: 0.12, lean: 0.05 };
    }
    // The primitive rigs, which were only ever a bob. Kept close to what they
    // did before so nothing that already looked right changes.
    return { rate: 1.0, bob: 0.05, roll: 0.02, pitch: 0, sway: 0, yaw: 0, lean: 0 };
  }

  private animateBody(dt: number) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const g = this.gait();
    this.bob += dt * (5 + speed) * g.rate;

    // Amplitude follows how fast it is actually travelling, so a foe held still
    // by a tell or a stagger settles rather than marching on the spot. Never
    // quite zero: a body perfectly rigid between steps reads as a prop.
    const stride = clamp(speed / this.moveSpeed, 0, 1);
    const amp = 0.25 + stride * 0.75;

    // The bob is doubled because a stride has two footfalls, and `abs` makes
    // each one a landing rather than a float.
    const bobY = Math.abs(Math.sin(this.bob)) * g.bob * amp;
    // Roll and sway run at half that — one full lean per stride, not per step.
    const rollZ = Math.sin(this.bob * 0.5) * g.roll * amp;
    const swayX = Math.cos(this.bob * 0.5) * g.sway * amp;
    // Pitch rides the footfall, a quarter-cycle behind the bob: the body tips
    // forward as it comes down, not as it rises.
    const pitchX = Math.sin(this.bob * 2 - Math.PI / 2) * g.pitch * amp;
    // Shoulders against hips, a quarter-cycle off the roll — the body turns into
    // the side the weight has just left.
    const yawY = Math.sin(this.bob * 0.5 - Math.PI / 2) * g.yaw * amp;
    // And a constant lean into the direction of travel, which is the difference
    // between a thing that walks and a thing being slid.
    const leanX = stride * g.lean;

    this.animateBite(dt, { bobY, rollZ, swayX, pitchX: pitchX + leanX, yawY });
  }

  /**
   * The bite.
   *
   * This was a 12% swell of the whole body over the wind-up, which on the old
   * primitive rig read as a creature drawing breath. On a sculpted quadruped it
   * reads as inflation — the thing visibly gets bigger and then is somehow the
   * same size again, which is not a movement any animal makes.
   *
   * A bite is anticipation and release instead: coil back onto the haunches over
   * the wind-up, then throw the whole body forward on the frame the damage
   * lands, jaws first. Nothing here is a limb, because the sculpt has no rig —
   * it is all the body's own weight, which is what sells a lunge anyway.
   *
   * Only the shapes that close to contact do it. A lobber throws from eleven
   * units away and would look ridiculous snapping at the air.
   */
  private animateBite(
    dt: number,
    gait: { bobY: number; rollZ: number; swayX: number; pitchX: number; yawY: number },
  ) {
    const melee = this.a.attackRange <= 4;
    let back = 0;
    let pitch = 0;
    let drop = 0;

    if (melee) {
      if (this.state === 'tell') {
        // Loaded late, not linearly: a wind-up that eases in is a creature
        // gathering itself, one that ramps evenly is a machine extending.
        const k = clamp(this.stateT / this.a.tell, 0, 1) ** 2;
        back = -0.34 * k;
        pitch = -0.20 * k;
        drop = -0.10 * k;
      } else if (this.state === 'strike') {
        // The whole throw is spent in the first 60ms — the damage has already
        // landed by then, and an attack whose animation lags its hitbox is one
        // the player learns to distrust.
        const k = clamp(this.stateT / 0.06, 0, 1);
        back = -0.34 + 0.86 * k;
        pitch = -0.20 + 0.62 * k;
        drop = -0.10 + 0.04 * k;
      } else if (this.state === 'recover') {
        // Held a beat at full extension, then drawn back. Snapping straight
        // home would undo the weight the lunge just bought.
        const k = clamp((this.stateT - 0.06) / 0.24, 0, 1) ** 0.6;
        back = 0.52 * (1 - k);
        pitch = 0.42 * (1 - k);
        drop = -0.06 * (1 - k);
      }
    }

    /*
     * Damped rather than assigned, so a state that ends early bleeds out instead
     * of popping — and so every other state simply falls back to rest.
     *
     * Except the throw itself, which is followed almost exactly. At the gentler
     * rate the body reached full extension around 160ms, a tenth of a second
     * after the damage had already landed, and an attack whose picture arrives
     * that far behind its hitbox is one the player stops reading.
     */
    const k = clamp(dt * (this.state === 'strike' ? 60 : 22), 0, 1);
    this.lungeZ += (back - this.lungeZ) * k;
    this.lungeY += (drop - this.lungeY) * k;
    this.lungeX += (pitch - this.lungeX) * k;

    /*
     * Summed, not assigned. The lunge and the walk both want the same three
     * axes, and whichever wrote last would win — a bite that cancelled the gait
     * would snap the body flat for a fifth of a second in the middle of the one
     * move the player is watching most closely.
     *
     * The lunge is damped state and the gait is a plain oscillation, so keeping
     * them in separate fields and adding them here is what lets each stay
     * correct on its own.
     */
    this.body.position.z = this.lungeZ;
    this.body.position.y = this.lungeY + gait.bobY;
    this.body.position.x = gait.swayX;
    this.body.rotation.x = this.lungeX + gait.pitchX;
    this.body.rotation.z = gait.rollZ;
    this.body.rotation.y = gait.yawY;
  }

  /** The lunge, held apart from the gait so the two can be summed. */
  private lungeZ = 0;
  private lungeY = 0;
  private lungeX = 0;
}
