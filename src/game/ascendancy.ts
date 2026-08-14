import type { BoonSet } from './boons';
import { CLASSES, type AttackShape, type ClassDef, type ClassId } from './classes';
import { t, type Key } from '../ui/i18n';

/**
 * What a class becomes.
 *
 * Boons and hammers make a run stronger; they never make it a different shade.
 * Halfway down, each class forks into one of two ascendancies and keeps it for
 * the rest of the descent — so the warrior you finish with is a samurai or a
 * barbarian, not a warrior who happened to take crit cards. Each branch closes
 * with a single capstone, which is the promise of that path finally paid.
 *
 * Ids are English and stable: they key the i18n dictionary and travel on the
 * wire. Everything the player reads comes back through `t()`.
 */

export type AscendancyId =
  | 'samurai'
  | 'barbarian'
  | 'elven'
  | 'sharpshooter'
  | 'decay'
  | 'elemental';

/**
 * Where the tree branches, and where it closes. Both sit one chamber after a
 * boss, so an ascendancy is something the descent hands you for surviving a
 * guardian rather than something that arrives between two ordinary rooms.
 */
export const ASCEND_DEPTH = 5;
export const CAPSTONE_DEPTH = 10;

/**
 * How an ascendancy changes the weapon itself.
 *
 * `attack` and `weapon` are deliberately absent. The rig is built once, in the
 * Player constructor, so swapping either mid-run would leave the model swinging
 * an animation that belongs to something it is no longer holding.
 */
export interface ShapePatch {
  maxHp?: number;
  speed?: number;
  castDamage?: number;
  accent?: number;
  /** Patched by index; a missing entry keeps the class's own hit. */
  combo?: (Partial<AttackShape> | undefined)[];
  special?: Partial<AttackShape>;
}

export interface Capstone {
  id: string;
  name: string;
  desc: string;
  apply: (b: BoonSet) => void;
  shape?: ShapePatch;
}

export interface Ascendancy {
  id: AscendancyId;
  cls: ClassId;
  name: string;
  /** The small line above the name on the card. */
  title: string;
  desc: string;
  /** The branch's metal, as CSS. Matches `shape.accent`. */
  css: string;
  /**
   * Numbers land in the BoonSet, where boons, hammers and meta already stack —
   * there is no second table to keep in sync. See boons.ts.
   */
  apply: (b: BoonSet) => void;
  shape?: ShapePatch;
  capstone: Capstone;
}

/**
 * Text reads through getters keyed off the id, so a language change reaches an
 * ascendancy already sworn to rather than only the next offer. See ui/i18n.ts.
 */
const capstone = (spec: Omit<Capstone, 'name' | 'desc'>): Capstone => ({
  ...spec,
  get name() {
    return t(`asc.${spec.id}.name` as Key);
  },
  get desc() {
    return t(`asc.${spec.id}.desc` as Key);
  },
});

const ascendancy = (
  spec: Omit<Ascendancy, 'name' | 'title' | 'desc'>,
): Ascendancy => ({
  ...spec,
  get name() {
    return t(`asc.${spec.id}.name` as Key);
  },
  get title() {
    return t(`asc.${spec.id}.title` as Key);
  },
  get desc() {
    return t(`asc.${spec.id}.desc` as Key);
  },
});

/**
 * Six branches, two per class. Every one of them pays for what it gains:
 *
 *   samurai      — faster and deadlier per cut, and thinner in the body for it
 *   barbarian    — huge reach, sustain and health, bought with swing speed
 *   elven        — tempo and movement, on smaller bolts
 *   sharpshooter — one enormous bolt per reload, and a long reload
 *   decay        — everything rots on a fuse, so the damage arrives late
 *   elemental    — the nova becomes the whole class, and the body pays
 */
export const ASCENDANCIES: Record<AscendancyId, Ascendancy> = {
  // ------------------------------------------------------------- the warrior
  samurai: ascendancy({
    id: 'samurai',
    cls: 'warrior',
    css: '#e8f0ff',
    apply: (b) => {
      b.attackSpeedMul *= 0.72;
      b.critChance += 0.12;
      b.critMul += 0.6;
    },
    // The finisher narrows as it lengthens: one body, cut cleanly, rather than
    // the warrior's wide crowd sweep.
    shape: {
      maxHp: 96,
      speed: 8.8,
      accent: 0xe8f0ff,
      combo: [undefined, undefined, { arc: 2.2, reach: 3.6, dmg: 26 }],
    },
    capstone: capstone({
      id: 'samurai-iai',
      apply: (b) => {
        b.critMul += 1.2;
        b.statusOnAttack = 'doom';
      },
      // The draw is the whole technique — the wind-up all but disappears.
      shape: { special: { wind: 0.09, dmg: 42 } },
    }),
  }),

  barbarian: ascendancy({
    id: 'barbarian',
    cls: 'warrior',
    css: '#ff6a4a',
    apply: (b) => {
      b.attackMul += 0.35;
      b.attackReachMul += 0.25;
      b.lifesteal += 0.06;
      b.attackSpeedMul *= 1.12;
    },
    shape: {
      maxHp: 135,
      speed: 8.0,
      accent: 0xff6a4a,
      combo: [{ arc: 2.6, push: 7 }, { arc: 2.8, push: 8 }, { arc: 3.6, push: 18 }],
    },
    capstone: capstone({
      id: 'barbarian-rage',
      apply: (b) => {
        b.frenzy += 0.6;
        b.lifesteal += 0.06;
      },
    }),
  }),

  // ------------------------------------------------------------- the marksman
  elven: ascendancy({
    id: 'elven',
    cls: 'archer',
    css: '#7fe0c0',
    apply: (b) => {
      b.moveMul += 0.16;
      b.extraCastAmmo += 2;
      b.attackSpeedMul *= 0.7;
    },
    // The reload stops being the whole rhythm of the class. Each bolt is worth
    // less, and there are far more of them.
    shape: {
      maxHp: 84,
      speed: 9.8,
      accent: 0x7fe0c0,
      combo: [{ recover: 0.24, dmg: 18 }],
      special: { arc: 0.9 },
    },
    capstone: capstone({
      id: 'elven-volley',
      apply: (b) => (b.doubleSpecial = true),
      shape: { special: { arc: 1.3, dmg: 14 } },
    }),
  }),

  sharpshooter: ascendancy({
    id: 'sharpshooter',
    cls: 'archer',
    css: '#ffd85a',
    apply: (b) => {
      b.attackMul += 0.45;
      b.attackPierce += 2;
      b.critChance += 0.1;
      b.attackSpeedMul *= 1.15;
    },
    // The lane gets longer and the reload gets worse, which is the trade: this
    // branch wants one clean line held for a long time.
    shape: {
      maxHp: 78,
      speed: 8.6,
      accent: 0xffd85a,
      combo: [{ dmg: 30, reach: 24, recover: 0.42 }],
    },
    capstone: capstone({
      id: 'sharp-headhunter',
      apply: (b) => {
        b.critMul += 1.5;
        b.attackPierce += 3;
        b.critChance += 0.08;
      },
    }),
  }),

  // ----------------------------------------------------------------- the mage
  decay: ascendancy({
    id: 'decay',
    cls: 'mage',
    css: '#7fc98a',
    apply: (b) => {
      b.statusOnAttack = 'doom';
      b.statusOnCast = 'doom';
      b.lifesteal += 0.07;
      b.castMul += 0.3;
    },
    // The orb hits softer because almost nothing this branch does is meant to
    // kill on contact — it is all banked on the fuse.
    shape: {
      maxHp: 86,
      speed: 7.2,
      accent: 0x7fc98a,
      combo: [{ dmg: 16 }],
    },
    capstone: capstone({
      id: 'decay-plague',
      apply: (b) => {
        b.contagion = true;
        b.lifesteal += 0.05;
      },
    }),
  }),

  elemental: ascendancy({
    id: 'elemental',
    cls: 'mage',
    css: '#ff9a4a',
    apply: (b) => {
      b.statusOnSpecial = 'burn';
      b.castBurst = Math.max(b.castBurst, 3.0);
      b.specialMul += 0.5;
      b.critChance += 0.05;
    },
    shape: {
      maxHp: 74,
      accent: 0xff9a4a,
      combo: [{ dmg: 21 }],
      special: { reach: 6.2, dmg: 40 },
    },
    capstone: capstone({
      id: 'elemental-cataclysm',
      apply: (b) => {
        b.doubleSpecial = true;
        b.statusOnAttack = 'shock';
      },
      shape: { special: { reach: 7.5 } },
    }),
  }),
};

/** Fixed order — the index is the wire value, so this list must never be reordered. */
export const ASCENDANCY_ORDER: AscendancyId[] = [
  'samurai',
  'barbarian',
  'elven',
  'sharpshooter',
  'decay',
  'elemental',
];

export const ascendancyById = (id: string): Ascendancy | undefined =>
  ASCENDANCIES[id as AscendancyId];

/** The branches this class may take. This is the offer. */
export const ascendanciesOf = (cls: ClassId): Ascendancy[] =>
  ASCENDANCY_ORDER.map((id) => ASCENDANCIES[id]).filter((a) => a.cls === cls);

/**
 * The class as an ascendancy leaves it.
 *
 * Copying descriptors rather than spreading is not a style choice: `name`,
 * `title` and `blurb` are getters on the class table, and a spread would call
 * them once and freeze the shade in whatever language the run started in. The
 * combo and special are cloned for the same reason in reverse — patching them in
 * place would rewrite CLASSES for every run that followed.
 */
export function ascendDef(
  base: ClassDef,
  ...patches: (ShapePatch | undefined)[]
): ClassDef {
  const def = Object.create(
    Object.getPrototypeOf(base),
    Object.getOwnPropertyDescriptors(base),
  ) as ClassDef;
  def.combo = base.combo.map((s) => ({ ...s }));
  def.special = { ...base.special };

  for (const p of patches) {
    if (!p) continue;
    if (p.maxHp !== undefined) def.maxHp = p.maxHp;
    if (p.speed !== undefined) def.speed = p.speed;
    if (p.castDamage !== undefined) def.castDamage = p.castDamage;
    if (p.accent !== undefined) def.accent = p.accent;
    if (p.special) Object.assign(def.special, p.special);
    p.combo?.forEach((s, i) => {
      if (s && def.combo[i]) Object.assign(def.combo[i], s);
    });
  }
  return def;
}

/** The shape a shade fights with once its branch and capstone are folded in. */
export const defFor = (cls: ClassId, a: Ascendancy | null, capped: boolean): ClassDef =>
  a ? ascendDef(CLASSES[cls], a.shape, capped ? a.capstone.shape : undefined) : CLASSES[cls];
