import { pick, shuffle } from '../core/math';
import type { StatusKind } from './enemy';

export type God = 'Aphrodite' | 'Ares' | 'Zeus' | 'Poseidon' | 'Artemis';

export interface GodStyle {
  color: number;
  css: string;
  /** Status the god's damage applies, if any. */
  status?: 'weak' | 'doom' | 'shock' | 'knockback' | 'crit';
}

export const GODS: Record<God, GodStyle> = {
  Aphrodite: { color: 0xff6f9c, css: '#ff6f9c', status: 'weak' },
  Ares: { color: 0xb3212f, css: '#e2384a', status: 'doom' },
  Zeus: { color: 0xffe066, css: '#ffe066', status: 'shock' },
  Poseidon: { color: 0x35c6ff, css: '#35c6ff', status: 'knockback' },
  Artemis: { color: 0x7ee08a, css: '#7ee08a', status: 'crit' },
};

export type Slot = 'attack' | 'special' | 'cast' | 'dash' | 'passive';

export interface Boon {
  id: string;
  god: God;
  slot: Slot;
  name: string;
  desc: string;
  apply: (b: BoonSet) => void;
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
   * cards promise per-slot effects — one shared field made Ares's Special boon
   * silently overwrite Zeus's Attack boon.
   */
  statusOnAttack: StatusKind | null = null;
  statusOnSpecial: StatusKind | null = null;
  statusOnCast: StatusKind | null = null;
  taken: Boon[] = [];

  // --- weapon modifications, granted by hammers -------------------------
  /** Scales the wind-up and recovery of the basic attack. Lower is faster. */
  attackSpeedMul = 1;
  attackReachMul = 1;
  /** Extra targets a cast bolt punches through. */
  castPierce = 0;
  /** Splash radius added to the cast, if any. */
  castBurst = 0;
  /** The special fires twice, a beat apart. */
  doubleSpecial = false;
  /** Names of the hammers taken, for the HUD. */
  hammers: string[] = [];

  // --- permanent upgrades, bought between runs --------------------------
  // These live here rather than in a parallel stat system so a run's modifiers
  // stack in exactly one place. See meta.ts.
  /** Flat health added on top of the class's own. */
  metaMaxHp = 0;
  /** Fraction of the Call gauge already full when the run begins. */
  metaStartCall = 0;
  /** Killing blows survived per run, at 35% health. */
  secondWind = 0;

  /** How many times each boon has been taken; a pom raises the level. */
  private levels = new Map<string, number>();

  add(b: Boon) {
    b.apply(this);
    if (!this.taken.some((t) => t.id === b.id)) this.taken.push(b);
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
}

export const ALL_BOONS: Boon[] = [
  {
    id: 'zeus-attack',
    god: 'Zeus',
    slot: 'attack',
    name: 'Lightning Strike',
    desc: 'Your Attack deals +40% damage and Shocks: a jolt arcs to nearby foes.',
    apply: (b) => {
      b.attackMul += 0.4;
      b.statusOnAttack = 'shock';
    },
  },
  {
    id: 'poseidon-dash',
    god: 'Poseidon',
    slot: 'dash',
    name: 'Tidal Dash',
    desc: 'Your Dash damages and knocks back foes you pass through.',
    apply: (b) => {
      b.dashDamage += 18;
      b.dashKnockback += 14;
    },
  },
  {
    id: 'artemis-crit',
    god: 'Artemis',
    slot: 'passive',
    name: "Hunter's Mark",
    desc: '+15% critical chance on everything.',
    apply: (b) => (b.critChance += 0.15),
  },
  {
    id: 'ares-special',
    god: 'Ares',
    slot: 'special',
    name: 'Slicing Shot',
    desc: 'Your Special deals +55% damage and inflicts Doom: it detonates a beat later.',
    apply: (b) => {
      b.specialMul += 0.55;
      b.statusOnSpecial = 'doom';
    },
  },
  {
    id: 'aphro-cast',
    god: 'Aphrodite',
    slot: 'cast',
    name: 'Crush Shot',
    desc: 'Your Cast deals +60% damage and makes foes Weak: they hit for 40% less.',
    apply: (b) => {
      b.castMul += 0.6;
      b.statusOnCast = 'weak';
    },
  },
  {
    id: 'zeus-passive',
    god: 'Zeus',
    slot: 'passive',
    name: 'Storm Sandals',
    desc: '+12% movement speed.',
    apply: (b) => (b.moveMul += 0.12),
  },
  {
    id: 'ares-life',
    god: 'Ares',
    slot: 'passive',
    name: 'Blood Frenzy',
    desc: 'Heal 4% of damage you deal.',
    apply: (b) => (b.lifesteal += 0.04),
  },
  {
    id: 'artemis-ammo',
    god: 'Artemis',
    slot: 'cast',
    name: 'Deadly Volley',
    desc: '+2 Cast ammo.',
    apply: (b) => (b.extraCastAmmo += 2),
  },
];

/** Three distinct offers, never repeating a boon the player already holds. */
export function offer(set: BoonSet, count = 3): Boon[] {
  const held = new Set(set.taken.map((b) => b.id));
  const pool = ALL_BOONS.filter((b) => !held.has(b.id));
  if (pool.length <= count) return pool;
  return shuffle(pool.slice()).slice(0, count);
}

export const randomGod = (): God => pick(Object.keys(GODS) as God[]);
