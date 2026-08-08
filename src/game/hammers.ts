import type { BoonSet } from './boons';
import type { ClassId } from './classes';
import { shuffle } from '../core/math';

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
export const HAMMERS: Hammer[] = [
  {
    id: 'heavy-strike',
    name: 'Heavy Strike',
    slot: 'ATTACK',
    desc: 'Your Attack deals +30% damage and reaches 20% further.',
    apply: (b) => {
      b.attackMul += 0.3;
      b.attackReachMul += 0.2;
    },
  },
  {
    id: 'swift-strike',
    name: 'Swift Strike',
    slot: 'ATTACK',
    desc: 'Your Attack winds up and recovers 30% faster.',
    apply: (b) => (b.attackSpeedMul *= 0.7),
  },
  {
    id: 'relentless',
    name: 'Relentless Edge',
    slot: 'ATTACK',
    desc: 'Your Attack deals +15% damage and heals 3% of it back.',
    apply: (b) => {
      b.attackMul += 0.15;
      b.lifesteal += 0.03;
    },
  },
  {
    id: 'twin-special',
    name: 'Twin Strike',
    slot: 'SPECIAL',
    desc: 'Your Special fires a second time, a beat later.',
    apply: (b) => (b.doubleSpecial = true),
  },
  {
    id: 'brutal-special',
    name: 'Brutal Special',
    slot: 'SPECIAL',
    desc: 'Your Special deals +70% damage.',
    apply: (b) => (b.specialMul += 0.7),
  },
  {
    id: 'piercing-cast',
    name: 'Piercing Cast',
    slot: 'CAST',
    desc: 'Your Cast punches through 3 more foes.',
    apply: (b) => (b.castPierce += 3),
  },
  {
    id: 'shattering-cast',
    name: 'Shattering Cast',
    slot: 'CAST',
    desc: 'Your Cast bursts on impact, damaging everything nearby.',
    apply: (b) => (b.castBurst = Math.max(b.castBurst, 3.0)),
  },
  {
    id: 'twin-cast',
    name: 'Double Charge',
    slot: 'CAST',
    desc: '+2 Cast ammo and +35% Cast damage.',
    apply: (b) => {
      b.extraCastAmmo += 2;
      b.castMul += 0.35;
    },
  },
];

const SLOT_COLOR: Record<Hammer['slot'], string> = {
  ATTACK: '#ffb04a',
  SPECIAL: '#ff6f9c',
  CAST: '#8fd8ff',
};

export const hammerColor = (h: Hammer) => SLOT_COLOR[h.slot];

/** Three hammers the player does not already hold. */
export function offerHammers(set: BoonSet, cls: ClassId, count = 3): Hammer[] {
  const pool = HAMMERS.filter(
    (h) => !set.hammers.includes(h.id) && (!h.classes || h.classes.includes(cls))
  );
  return shuffle(pool.slice()).slice(0, count);
}
