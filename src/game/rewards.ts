import { godOf, GODS, randomGod, type God } from './boons';
import { pick, shuffle } from '../core/math';
import { t } from '../ui/i18n';

export type RewardKind = 'boon' | 'pom' | 'vitality' | 'hammer';

/** What kind of fight is on the other side of the door. */
export type RoomKind = 'combat' | 'elite' | 'horde' | 'boss';

export interface RoomStyle {
  label: string;
  /** Multiplies enemy count. */
  density: number;
  /** Multiplies enemy health and damage. */
  strength: number;
}

// Labels are getters so a language change is picked up wherever they are read.
export const ROOMS: Record<RoomKind, RoomStyle> = {
  combat: {
    get label() {
      return t('rooms.combat');
    },
    density: 1,
    strength: 1,
  },
  // Fewer bodies, each one a real threat — space to fight, no room to be sloppy.
  elite: {
    get label() {
      return t('rooms.elite');
    },
    density: 0.55,
    strength: 1.9,
  },
  // The opposite pressure: weak individually, overwhelming as a crowd.
  horde: {
    get label() {
      return t('rooms.horde');
    },
    density: 1.9,
    strength: 0.7,
  },
  boss: {
    get label() {
      return t('rooms.boss');
    },
    density: 1,
    strength: 1,
  },
};

export interface Reward {
  kind: RewardKind;
  /** Only set for boon doors — which god waits on the other side. */
  god?: God;
  label: string;
  /** Colour of the door's light and its symbol. */
  color: number;
  css: string;
}

export interface Door {
  reward: Reward;
  room: RoomKind;
}

/**
 * What a door is worth, known before you walk through it.
 *
 * This is the decision the run is actually made of: not "which boon" but "which
 * door", chosen while you can still see how much health you have left. A door
 * whose contents are a surprise is just a corridor.
 */
export function rollReward(kind: RewardKind): Reward {
  if (kind === 'boon') {
    const god = randomGod();
    return {
      kind,
      god,
      get label() {
        return t('reward.boon', { god: godOf(god) });
      },
      color: GODS[god].color,
      css: GODS[god].css,
    };
  }
  if (kind === 'pom') {
    return {
      kind,
      get label() {
        return t('reward.pom');
      },
      color: 0xd6a6ff,
      css: '#d6a6ff',
    };
  }
  if (kind === 'vitality') {
    return {
      kind,
      get label() {
        return t('reward.vitality');
      },
      color: 0xff4d6a,
      css: '#ff4d6a',
    };
  }
  return {
    kind,
    get label() {
      return t('reward.hammer');
    },
    color: 0xffb04a,
    css: '#ffb04a',
  };
}

/**
 * Build the doors on offer.
 *
 * Always at least one boon, so a run can never be starved of the thing that
 * makes it a build. Elite and horde rooms pay better, which is the trade the
 * player is actually being offered: a harder fight for a stronger reward.
 */
export function offerDoors(depth: number, count = 2, hasBoons = false): Door[] {
  const kinds: RewardKind[] = ['boon'];
  const pool: RewardKind[] = ['vitality', 'hammer', 'boon'];
  // A pom is worthless with nothing to empower.
  if (hasBoons) pool.push('pom', 'pom');
  const rest = shuffle(pool);
  while (kinds.length < count) kinds.push(rest.pop() ?? pick<RewardKind>(['boon', 'vitality']));

  // Two doors offering the same god are one door drawn twice. Roll each boon
  // against the gods already on offer so every option is visibly different.
  const usedGods = new Set<God>();
  const rewards = shuffle(kinds).map((kind) => {
    if (kind !== 'boon') return rollReward(kind);
    let r = rollReward('boon');
    for (let i = 0; i < 12 && r.god && usedGods.has(r.god); i++) r = rollReward('boon');
    if (r.god) usedGods.add(r.god);
    return r;
  });

  // Room types ramp in once the run has its footing, and never repeat across
  // doors — picking between two identical fights is not a choice either.
  const roomPool: RoomKind[] = depth < 3 ? ['combat', 'combat'] : ['combat', 'elite', 'horde'];
  const rooms = shuffle(roomPool.slice());
  return rewards.map((reward, i) => ({
    reward,
    room: rooms[i % rooms.length] ?? 'combat',
  }));
}
