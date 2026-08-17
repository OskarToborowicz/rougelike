import type { BoonSet } from './boons';
import { t, type Key } from '../ui/i18n';

/**
 * What survives a death.
 *
 * The roguelike contract says a lost run costs you the build — but if it costs
 * you *everything*, a bad run is pure loss, and losing is most of the game. So
 * every run pays out obols, obols buy permanent upgrades, and the run you just
 * threw away still moved the next one forward.
 *
 * Deliberately shallow: eight upgrades, none of them more than a few levels.
 * The point is to make dying productive, not to gate the game behind a grind.
 */

export interface MetaState {
  /** Unspent currency. */
  obols: number;
  /** Levels bought, by upgrade id. */
  upgrades: Record<string, number>;
  /** Lifetime counters, for the run summary. */
  runs: number;
  highest: number;
  kills: number;
  totalObols: number;
}

export interface Upgrade {
  id: string;
  name: string;
  /** Written for the *next* level, so the card always says what you'd get. */
  desc: (nextLevel: number) => string;
  maxLevel: number;
  /** Cost of moving from `level` to `level + 1`. */
  cost: (level: number) => number;
  apply: (b: BoonSet, level: number) => void;
}

/**
 * Costs rise steeply enough that the last level of anything is a real decision,
 * and the first level of everything is affordable within a few runs.
 */
const ramp = (base: number, step: number) => (level: number) =>
  Math.round(base + step * level * (level + 1) * 0.5);

/**
 * The name is a live getter keyed off the id, so a language change reaches the
 * shrine's list without rebuilding the table. See ui/i18n.ts.
 */
const upgrade = (spec: Omit<Upgrade, 'name'>): Upgrade => ({
  ...spec,
  get name() {
    return t(`meta.${spec.id}.name` as Key);
  },
});

export const UPGRADES: Upgrade[] = [
  upgrade({
    id: 'vigour',
    desc: (n) => t('meta.vigour.desc', { n: n * 12 }),
    maxLevel: 5,
    cost: ramp(30, 22),
    apply: (b, l) => (b.metaMaxHp += l * 12),
  }),
  upgrade({
    id: 'edge',
    desc: (n) => t('meta.edge.desc', { n: n * 6 }),
    maxLevel: 5,
    cost: ramp(35, 26),
    apply: (b, l) => {
      b.attackMul += l * 0.06;
      b.specialMul += l * 0.06;
      b.castMul += l * 0.06;
    },
  }),
  upgrade({
    id: 'swiftness',
    desc: (n) => t('meta.swiftness.desc', { n: n * 4 }),
    maxLevel: 4,
    cost: ramp(40, 28),
    apply: (b, l) => (b.moveMul += l * 0.04),
  }),
  upgrade({
    id: 'reserve',
    desc: (n) => t('meta.reserve.desc', { n }),
    maxLevel: 3,
    cost: ramp(45, 35),
    apply: (b, l) => (b.extraCastAmmo += l),
  }),
  upgrade({
    id: 'fortune',
    desc: (n) => t('meta.fortune.desc', { n: n * 20 }),
    maxLevel: 3,
    cost: ramp(50, 40),
    apply: () => {
      /* read directly by the payout, not a combat stat */
    },
  }),
  upgrade({
    id: 'zeal',
    desc: (n) => t('meta.zeal.desc', { n: n * 25 }),
    maxLevel: 2,
    cost: ramp(60, 50),
    apply: (b, l) => (b.metaStartCall += l * 0.25),
  }),
  upgrade({
    id: 'hunter',
    desc: (n) => t('meta.hunter.desc', { n: n * 5 }),
    maxLevel: 3,
    cost: ramp(55, 42),
    apply: (b, l) => (b.critChance += l * 0.05),
  }),
  upgrade({
    id: 'secondwind',
    desc: () => t('meta.secondwind.desc'),
    maxLevel: 1,
    cost: () => 220,
    apply: (b, l) => (b.secondWind += l),
  }),
];

export const upgradeById = (id: string) => UPGRADES.find((u) => u.id === id);

const KEY = 'styx.meta';

export const EMPTY_META: MetaState = {
  obols: 0,
  upgrades: {},
  runs: 0,
  highest: 0,
  kills: 0,
  totalObols: 0,
};

function load(): MetaState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_META, upgrades: {} };
    const parsed = JSON.parse(raw) as Partial<MetaState> & { deepest?: number };
    return {
      ...EMPTY_META,
      ...parsed,
      // Never trust the stored map: a renamed or removed upgrade must not be
      // able to hand out levels of something that no longer exists.
      upgrades: Object.fromEntries(
        Object.entries(parsed.upgrades ?? {}).filter(([id]) => !!upgradeById(id))
      ),
      /*
       * `highest` was `deepest` while the run was a descent, and this file has
       * no version to drop a stale shape on — it is the record that survives
       * dying, so unlike a run save it must never be thrown away. Spreading
       * `parsed` over `EMPTY_META` would have quietly reset every player's best
       * chamber to zero on the build that renamed the field.
       *
       * Reading both is enough and stays correct forever: a save written since
       * the rename has no `deepest`, one written before has no `highest`, and
       * `max` picks whichever is actually there.
       */
      highest: Math.max(parsed.highest ?? 0, parsed.deepest ?? 0),
    };
  } catch {
    return { ...EMPTY_META, upgrades: {} };
  }
}

/** Read live by whoever cares, same as settings. */
export const meta: MetaState = load();

export function saveMeta() {
  try {
    localStorage.setItem(KEY, JSON.stringify(meta));
  } catch {
    /* private mode: the run still works, it just will not be remembered */
  }
}

export const levelOf = (id: string) => meta.upgrades[id] ?? 0;

/** What the next level of this upgrade costs, or null when it is maxed. */
export function nextCost(u: Upgrade): number | null {
  const l = levelOf(u.id);
  return l >= u.maxLevel ? null : u.cost(l);
}

export function canAfford(u: Upgrade) {
  const c = nextCost(u);
  return c !== null && meta.obols >= c;
}

/** Spend on one level. Returns false if maxed or too poor — callers may just try. */
export function buy(u: Upgrade) {
  const c = nextCost(u);
  if (c === null || meta.obols < c) return false;
  meta.obols -= c;
  meta.upgrades[u.id] = levelOf(u.id) + 1;
  saveMeta();
  return true;
}

/** Obols are banked the moment they drop — closing the tab must never cost them. */
export function earn(amount: number) {
  const gain = Math.max(0, Math.round(amount * (1 + levelOf('fortune') * 0.2)));
  meta.obols += gain;
  meta.totalObols += gain;
  saveMeta();
  return gain;
}

export function recordRun(rung: number) {
  meta.runs++;
  meta.highest = Math.max(meta.highest, rung);
  saveMeta();
}

/**
 * Fold every purchased upgrade into a fresh BoonSet.
 *
 * Meta lands in the same place boons do rather than in a parallel stat system,
 * so a run's modifiers stack in exactly one way and there is no second table to
 * keep in sync.
 */
export function applyMeta(b: BoonSet, state: MetaState = meta) {
  for (const u of UPGRADES) {
    const l = state.upgrades[u.id] ?? 0;
    if (l > 0) u.apply(b, l);
  }
  return b;
}

/** The levels a guest sends to the host, compact enough for the handshake. */
export function encodeMeta(state: MetaState = meta): string {
  return UPGRADES.map((u) => state.upgrades[u.id] ?? 0).join('.');
}

/**
 * Rebuild a peer's levels from the handshake. Clamped to each upgrade's real
 * maximum: the string arrives from another client and cannot be trusted to be
 * anything in particular.
 */
export function decodeMeta(s: string): MetaState {
  const parts = String(s ?? '').split('.');
  const upgrades: Record<string, number> = {};
  UPGRADES.forEach((u, i) => {
    const n = Math.floor(Number(parts[i]));
    if (Number.isFinite(n) && n > 0) upgrades[u.id] = Math.min(u.maxLevel, n);
  });
  return { ...EMPTY_META, upgrades };
}
