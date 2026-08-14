import type { BoonSet } from './boons';
import type { ClassId } from './classes';
import { shuffle } from '../core/math';
import { t, type Key } from '../ui/i18n';

export interface Hammer {
  id: string;
  name: string;
  desc: string;
  /** Which slot it changes — shown as the card's kicker. */
  slot: 'ATTACK' | 'SPECIAL' | 'CAST';
  /** Classes it makes sense for. Empty means all. */
  classes?: ClassId[];
  apply: (b: BoonSet) => void;
}

/**
 * Weapon upgrades.
 *
 * Boons scale numbers; hammers change how a slot behaves. Keeping them on a
 * separate track is what stops a build from being a pile of damage percentages —
 * one of these should change how you actually play the weapon.
 */
/**
 * Name and description read through getters keyed off the id, so a language
 * change reaches hammers already granted. See ui/i18n.ts.
 */
const hammer = (spec: Omit<Hammer, 'name' | 'desc'>): Hammer => ({
  ...spec,
  get name() {
    return t(`hammer.${spec.id}.name` as Key);
  },
  get desc() {
    return t(`hammer.${spec.id}.desc` as Key);
  },
});

export const HAMMERS: Hammer[] = [
  hammer({
    id: 'heavy-strike',
    slot: 'ATTACK',
    apply: (b) => {
      b.attackMul += 0.3;
      b.attackReachMul += 0.2;
    },
  }),
  hammer({
    id: 'swift-strike',
    slot: 'ATTACK',
    apply: (b) => (b.attackSpeedMul *= 0.7),
  }),
  hammer({
    id: 'relentless',
    slot: 'ATTACK',
    apply: (b) => {
      b.attackMul += 0.15;
      b.lifesteal += 0.03;
    },
  }),
  hammer({
    id: 'twin-special',
    slot: 'SPECIAL',
    apply: (b) => (b.doubleSpecial = true),
  }),
  hammer({
    id: 'brutal-special',
    slot: 'SPECIAL',
    apply: (b) => (b.specialMul += 0.7),
  }),
  hammer({
    id: 'piercing-cast',
    slot: 'CAST',
    apply: (b) => (b.castPierce += 3),
  }),
  hammer({
    id: 'shattering-cast',
    slot: 'CAST',
    apply: (b) => (b.castBurst = Math.max(b.castBurst, 3.0)),
  }),
  hammer({
    id: 'twin-cast',
    slot: 'CAST',
    apply: (b) => {
      b.extraCastAmmo += 2;
      b.castMul += 0.35;
    },
  }),
];

/** Mirrors `boonById`. A run save names hammers by id and has to find them again. */
export const hammerById = (id: string) => HAMMERS.find((h) => h.id === id);

const SLOT_COLOR: Record<Hammer['slot'], string> = {
  ATTACK: '#ffb04a',
  SPECIAL: '#ff6f9c',
  CAST: '#8fd8ff',
};

export const hammerColor = (h: Hammer) => SLOT_COLOR[h.slot];

/** The slot as the card's kicker reads it. The id itself stays English. */
export const hammerSlotLabel = (h: Hammer) => t(`hammer.slot.${h.slot}` as Key);

/** Three hammers the player does not already hold. */
export function offerHammers(set: BoonSet, cls: ClassId, count = 3): Hammer[] {
  const pool = HAMMERS.filter(
    (h) => !set.hammers.includes(h.id) && (!h.classes || h.classes.includes(cls))
  );
  return shuffle(pool.slice()).slice(0, count);
}
