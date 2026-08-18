import { pick, shuffle } from '../core/math';
import type { StatusKind } from './enemy';
import { t, type Key } from '../ui/i18n';
import { PANTHEON_ORDER, PANTHEONS, type PantheonId } from './pantheons';

export type Slot = 'attack' | 'special' | 'cast' | 'dash' | 'passive';

/**
 * Twin Strike's echoes: each entry is one extra special hit, at this fraction of
 * the base damage, fired a beat after the last. Reachable from a boon, a hammer
 * and two capstones — they stack here instead of each re-setting the same flag,
 * and the array length is the hard cap on how many echoes any build can reach.
 */
export const SPECIAL_ECHO_FALLOFF = [0.6, 0.4, 0.25];

export interface Boon {
  id: string;
  /** The throne that owns it. The god who offers it is chosen per offer. */
  pantheon: PantheonId;
  slot: Slot;
  name: string;
  desc: string;
  apply: (b: BoonSet) => void;
  /**
   * Whether taking this now would do nothing — its effect is already maxed by
   * some other source. Keeps a binary/capped effect from being offered as a dead
   * pick once it is fully held, across boons, hammers and capstones alike.
   */
  redundant?: (b: BoonSet) => boolean;
}

/** Flat, additive modifiers. Deliberately simple so stacking never surprises the player. */
export class BoonSet {
  attackMul = 1;
  specialMul = 1;
  castMul = 1;
  dashDamage = 0;
  moveMul = 1;
  lifesteal = 0;
  critChance = 0.05;
  critMul = 2.0;
  extraCastAmmo = 0;
  dashKnockback = 0;
  /**
   * Which status each source of damage inflicts. Split per slot because the
   * cards promise per-slot effects — one shared field made a Special boon
   * silently overwrite an Attack boon.
   */
  statusOnAttack: StatusKind | null = null;
  statusOnSpecial: StatusKind | null = null;
  statusOnCast: StatusKind | null = null;
  taken: Boon[] = [];

  /**
   * Which throne last put its mark on each slot — the colour that slot burns in
   * the world. Empty until a god has given this shade something for it, and a
   * slot with no mark keeps the class's own colour.
   *
   * It exists so a boon is visible the moment it is taken. The card promises a
   * god's gift and then every swing looked exactly as it did before the offer,
   * which made the whole screen read as a stat sheet.
   *
   * **Last, not first**, and that is the same rule `statusOnAttack` above
   * already follows: a second Attack boon overwrites the status the first one
   * granted, so a colour pinned to whichever throne got there first would still
   * be advertising lightning long after the attack had started setting things
   * alight. `resumeRun` replays picks in order for exactly this reason, so a
   * mark rebuilt here survives a save without a field on the wire.
   *
   * Passives are excluded because they belong to no slot. A crit boon changes
   * every hit this shade lands, and marking one slot with it would be a lie
   * about the other three.
   */
  readonly marks: Partial<Record<Slot, PantheonId>> = {};

  // --- the choir's bargain ----------------------------------------------
  /**
   * The Scales. A blow costing more than this fraction of maximum health is
   * halved, and the half that was spared is owed back to whatever struck you.
   * Zero means the choir never offered.
   */
  scalesThreshold = 0;

  // --- the legion's bargain ---------------------------------------------
  /** Extra damage per ally currently down. Worth More Fallen. */
  perDownedAlly = 0;

  // --- weapon modifications, granted by hammers -------------------------
  /** Scales the wind-up and recovery of the basic attack. Lower is faster. */
  attackSpeedMul = 1;
  attackReachMul = 1;
  /** Extra targets a cast bolt punches through. */
  castPierce = 0;
  /** Splash radius added to the cast, if any. */
  castBurst = 0;
  /**
   * How many extra, fading echoes the special fires after the first hit. Each
   * source of Twin Strike adds one; world reads it against SPECIAL_ECHO_FALLOFF.
   */
  specialEchoes = 0;
  /** Names of the hammers taken, for the HUD. */
  hammers: string[] = [];

  // --- what an ascendancy grants ----------------------------------------
  // Same argument as the meta block below: a branch changes numbers, and those
  // numbers stack here with everything else rather than in a parallel system.
  // Each of these has exactly one place that reads it, all in World.
  /** Extra damage while below half health. Zero means no branch granted it. */
  frenzy = 0;
  /** Extra bodies the *basic* bolt punches through, on top of its own two. */
  attackPierce = 0;
  /** A dying foe's status jumps to whatever is standing nearest. */
  contagion = false;

  // --- permanent upgrades, bought between runs --------------------------
  // These live here rather than in a parallel stat system so a run's modifiers
  // stack in exactly one place. See meta.ts.
  /** Flat health added on top of the class's own. */
  metaMaxHp = 0;
  /** Fraction of the Call gauge already full when the run begins. */
  metaStartCall = 0;
  /** Killing blows survived per run, at 35% health. */
  secondWind = 0;

  /**
   * Thrones that will not offer again this climb, because a rival was taken
   * over their heads. Cleared when the run restarts.
   */
  spurned = new Set<PantheonId>();

  /** How many times each boon has been taken; a pom raises the level. */
  private levels = new Map<string, number>();

  add(b: Boon) {
    b.apply(this);
    // Here rather than in each boon's `apply`, so a boon cannot be written that
    // changes a slot and forgets to show it — and so the twenty-eight that
    // already exist did not need touching to gain the behaviour.
    if (b.slot !== 'passive') this.marks[b.slot] = b.pantheon;
    if (!this.taken.some((x) => x.id === b.id)) this.taken.push(b);
    this.levels.set(b.id, (this.levels.get(b.id) ?? 0) + 1);
  }

  levelOf(id: string) {
    return this.levels.get(id) ?? 0;
  }

  /**
   * Re-apply a boon already held. Every boon's `apply` is additive, so running
   * it again simply stacks the same effect — which is exactly what levelling up
   * should mean, with no separate upgrade table to keep in sync.
   */
  upgrade(b: Boon) {
    this.add(b);
  }

  /** Thrones still willing to speak to this shade. */
  get courted(): PantheonId[] {
    return PANTHEON_ORDER.filter((p) => !this.spurned.has(p));
  }
}

/**
 * Name and description are live getters keyed off the boon's id, so a language
 * change reaches boons already sitting in a player's `taken` list rather than
 * only new offers. See ui/i18n.ts.
 */
const boon = (spec: Omit<Boon, 'name' | 'desc'>): Boon => ({
  ...spec,
  get name() {
    return t(`boon.${spec.id}.name` as Key);
  },
  get desc() {
    return t(`boon.${spec.id}.desc` as Key);
  },
});

/**
 * Four boons per throne, and each throne plays differently rather than trading
 * in the same percentages:
 *
 *   hellenic — shock and crit, the crowd-clearer
 *   aesir    — weak and knockback, the one that buys you room
 *   netjer   — doom and lifesteal, paid out on a delay
 *   anunna   — burn, damage that spreads on its own
 *   choir    — defensive bargains, the only throne that gives back
 *   legion   — raw damage bought with something
 *   rodnova  — speed, ammo and reach; no status at all
 */
export const ALL_BOONS: Boon[] = [
  // ---------------------------------------------------------- I · hellenic
  boon({
    id: 'hel-attack',
    pantheon: 'hellenic',
    slot: 'attack',
    apply: (b) => {
      b.attackMul += 0.4;
      b.statusOnAttack = 'shock';
    },
  }),
  boon({
    id: 'hel-cast',
    pantheon: 'hellenic',
    slot: 'cast',
    apply: (b) => {
      b.castMul += 0.55;
      b.statusOnCast = 'shock';
    },
  }),
  boon({
    id: 'hel-crit',
    pantheon: 'hellenic',
    slot: 'passive',
    apply: (b) => (b.critChance += 0.15),
  }),
  boon({
    id: 'hel-dash',
    pantheon: 'hellenic',
    slot: 'dash',
    apply: (b) => {
      b.dashDamage += 20;
      b.dashKnockback += 10;
    },
  }),

  // ------------------------------------------------------------- II · aesir
  boon({
    id: 'aes-attack',
    pantheon: 'aesir',
    slot: 'attack',
    apply: (b) => {
      b.attackMul += 0.35;
      b.statusOnAttack = 'weak';
    },
  }),
  boon({
    id: 'aes-special',
    pantheon: 'aesir',
    slot: 'special',
    apply: (b) => {
      b.specialMul += 0.6;
      b.statusOnSpecial = 'weak';
    },
  }),
  boon({
    id: 'aes-dash',
    pantheon: 'aesir',
    slot: 'dash',
    apply: (b) => {
      b.dashDamage += 18;
      b.dashKnockback += 16;
    },
  }),
  boon({
    id: 'aes-move',
    pantheon: 'aesir',
    slot: 'passive',
    apply: (b) => (b.moveMul += 0.14),
  }),

  // ------------------------------------------------------------ III · netjer
  boon({
    id: 'net-cast',
    pantheon: 'netjer',
    slot: 'cast',
    apply: (b) => {
      b.castMul += 0.6;
      b.statusOnCast = 'doom';
    },
  }),
  boon({
    id: 'net-attack',
    pantheon: 'netjer',
    slot: 'attack',
    apply: (b) => {
      b.attackMul += 0.3;
      b.statusOnAttack = 'doom';
    },
  }),
  boon({
    id: 'net-life',
    pantheon: 'netjer',
    slot: 'passive',
    apply: (b) => (b.lifesteal += 0.05),
  }),
  boon({
    id: 'net-ammo',
    pantheon: 'netjer',
    slot: 'cast',
    apply: (b) => (b.extraCastAmmo += 2),
  }),

  // ------------------------------------------------------------ IV · anunna
  boon({
    id: 'anu-attack',
    pantheon: 'anunna',
    slot: 'attack',
    apply: (b) => {
      b.attackMul += 0.35;
      b.statusOnAttack = 'burn';
    },
  }),
  boon({
    id: 'anu-special',
    pantheon: 'anunna',
    slot: 'special',
    apply: (b) => {
      b.specialMul += 0.55;
      b.statusOnSpecial = 'burn';
    },
  }),
  boon({
    id: 'anu-fever',
    pantheon: 'anunna',
    slot: 'passive',
    apply: (b) => {
      b.attackMul += 0.1;
      b.specialMul += 0.1;
      b.castMul += 0.1;
    },
  }),
  boon({
    id: 'anu-cast',
    pantheon: 'anunna',
    slot: 'cast',
    apply: (b) => {
      b.castMul += 0.25;
      b.castBurst = Math.max(b.castBurst, 3.0);
    },
  }),

  // ------------------------------------------------------------- V · choir
  boon({
    id: 'cho-sword',
    pantheon: 'choir',
    slot: 'attack',
    apply: (b) => {
      b.attackMul += 0.25;
      b.statusOnAttack = 'burn';
    },
  }),
  boon({
    id: 'cho-scales',
    pantheon: 'choir',
    slot: 'passive',
    // Stacking lowers the bar rather than halving twice: a second Scales means
    // more blows qualify, which is legible. Compounding reduction would not be.
    apply: (b) =>
      (b.scalesThreshold = b.scalesThreshold === 0 ? 0.25 : b.scalesThreshold + 0.1),
  }),
  boon({
    id: 'cho-song',
    pantheon: 'choir',
    slot: 'passive',
    apply: (b) => {
      b.critChance += 0.08;
      b.moveMul += 0.06;
    },
  }),
  boon({
    id: 'cho-cast',
    pantheon: 'choir',
    slot: 'cast',
    apply: (b) => (b.castPierce += 3),
  }),

  // ------------------------------------------------------------ VI · legion
  boon({
    id: 'leg-special',
    pantheon: 'legion',
    slot: 'special',
    apply: (b) => {
      b.specialMul += 0.55;
      b.statusOnSpecial = 'doom';
    },
  }),
  boon({
    id: 'leg-fallen',
    pantheon: 'legion',
    slot: 'passive',
    apply: (b) => (b.perDownedAlly += 0.25),
  }),
  boon({
    id: 'leg-life',
    pantheon: 'legion',
    slot: 'passive',
    apply: (b) => (b.lifesteal += 0.04),
  }),
  boon({
    id: 'leg-attack',
    pantheon: 'legion',
    slot: 'attack',
    apply: (b) => (b.attackSpeedMul *= 0.7),
  }),

  // ----------------------------------------------------------- VII · rodnova
  boon({
    id: 'rod-move',
    pantheon: 'rodnova',
    slot: 'passive',
    apply: (b) => (b.moveMul += 0.14),
  }),
  boon({
    id: 'rod-ammo',
    pantheon: 'rodnova',
    slot: 'cast',
    apply: (b) => (b.extraCastAmmo += 2),
  }),
  boon({
    id: 'rod-special',
    pantheon: 'rodnova',
    slot: 'special',
    apply: (b) => (b.specialEchoes += 1),
    redundant: (b) => b.specialEchoes >= SPECIAL_ECHO_FALLOFF.length,
  }),
  boon({
    id: 'rod-attack',
    pantheon: 'rodnova',
    slot: 'attack',
    apply: (b) => {
      b.attackMul += 0.25;
      b.attackReachMul += 0.2;
    },
  }),
];

export const boonById = (id: string) => ALL_BOONS.find((b) => b.id === id);

const ofPantheon = (p: PantheonId) => ALL_BOONS.filter((b) => b.pantheon === p);

/**
 * What one throne is willing to offer this shade, newest first out of the hat.
 * Never repeats something already held — a card you cannot take is a wasted
 * third of the screen.
 */
export function offerFrom(set: BoonSet, p: PantheonId, count = 3): Boon[] {
  const held = new Set(set.taken.map((b) => b.id));
  return shuffle(
    ofPantheon(p).filter((b) => !held.has(b.id) && !b.redundant?.(set)),
  ).slice(0, count);
}

/**
 * The rival's card: one boon from a throne that has a quarrel with this one, and
 * that this shade has not already spurned. Null when every rival is exhausted or
 * already spoken for — the offer then simply runs three cards deep.
 */
export function rivalOffer(set: BoonSet, p: PantheonId): Boon | null {
  const held = new Set(set.taken.map((b) => b.id));
  const rivals = shuffle(
    PANTHEONS[p].rivals.filter((r) => !set.spurned.has(r))
  );
  for (const r of rivals) {
    const pool = ofPantheon(r).filter((b) => !held.has(b.id));
    if (pool.length) return pick(pool);
  }
  return null;
}

/** A throne that still speaks to this shade. */
export const randomPantheon = (set?: BoonSet): PantheonId =>
  pick(set && set.courted.length ? set.courted : PANTHEON_ORDER);
