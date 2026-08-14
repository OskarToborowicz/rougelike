import { boonById } from './boons';
import { hammerById } from './hammers';
import { ascendancyById, type AscendancyId } from './ascendancy';
import { CLASS_ORDER, type ClassId } from './classes';
import { PANTHEON_ORDER, type PantheonId } from './pantheons';
import { ROOMS, type RoomKind } from './rewards';

/**
 * What survives closing the tab mid-descent.
 *
 * meta.ts keeps what survives *dying*; this keeps what survives walking away.
 * The two are deliberately separate files and separate keys: losing a run must
 * still cost you the build, and a corrupt run save must never be able to take
 * the reliquary down with it.
 *
 * The save holds the *decisions* a run was made of — which boons, in what order,
 * which hammers, which branch — and never the numbers they add up to. Replaying
 * them through the same `apply` functions the run itself used is what makes the
 * file small, legible, and impossible to fall out of sync with a rebalance: a
 * boon retuned between sessions loads at its new value rather than resurrecting
 * the old one. It is the same argument `applyMeta` makes for upgrades.
 */

/** One acquisition, in the order it happened. */
export type Pick =
  /** A boon, by id. One entry per level — a pom writes a second. */
  | ['b', string]
  /** A weapon hammer, by id. */
  | ['h', string]
  /** The branch sworn to at the forking. */
  | ['a', AscendancyId]
  /** That branch's capstone. */
  | ['c'];

export interface ShadeSave {
  seat: number;
  cls: ClassId;
  picks: Pick[];
  /** Thrones that will not offer again this descent. */
  spurned: PantheonId[];
  /**
   * Health as a fraction of maximum, not as a number. A class or an upgrade
   * retuned between sessions would otherwise load a shade at the wrong health —
   * or above its own ceiling.
   */
  hp: number;
}

export interface RunSave {
  v: number;
  depth: number;
  room: RoomKind;
  /** What this descent has earned so far, for the shore screen. */
  obols: number;
  kills: number;
  shades: ShadeSave[];
}

/**
 * Bumped only when a change cannot be repaired by the sanitising below — a
 * different `picks` encoding, say. A save from another version is dropped whole
 * rather than half-read, because a run resumed with half a build is worse than
 * one that was never offered.
 */
const VERSION = 1;
const KEY = 'styx.run';

/** Does a pick still name something this build knows how to apply? */
function knownPick(p: unknown): p is Pick {
  if (!Array.isArray(p) || typeof p[0] !== 'string') return false;
  if (p[0] === 'c') return true;
  if (typeof p[1] !== 'string') return false;
  if (p[0] === 'b') return !!boonById(p[1]);
  if (p[0] === 'h') return !!hammerById(p[1]);
  if (p[0] === 'a') return !!ascendancyById(p[1]);
  return false;
}

/**
 * Rebuild a save from whatever is in storage.
 *
 * Everything is checked rather than trusted. The file is on the player's own
 * disk and survives across versions of the game, so an id that has since been
 * renamed or removed must drop out quietly instead of taking the whole descent
 * with it — the same rule meta.ts applies to its upgrade map.
 */
function sanitise(raw: unknown): RunSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<RunSave>;
  if (s.v !== VERSION) return null;

  const depth = Math.floor(Number(s.depth));
  if (!Number.isFinite(depth) || depth < 1) return null;

  const shades = (Array.isArray(s.shades) ? s.shades : [])
    .map((sh): ShadeSave | null => {
      const cls = sh?.cls as ClassId;
      if (!CLASS_ORDER.includes(cls)) return null;
      const seat = Math.floor(Number(sh?.seat));
      if (!Number.isFinite(seat) || seat < 0) return null;
      const hp = Number(sh?.hp);
      return {
        seat,
        cls,
        picks: (Array.isArray(sh?.picks) ? sh.picks : []).filter(knownPick),
        spurned: (Array.isArray(sh?.spurned) ? sh.spurned : []).filter(
          (p): p is PantheonId => PANTHEON_ORDER.includes(p as PantheonId)
        ),
        // A shade loads on its feet. Zero would resume the run already dead, at
        // a checkpoint with no way to revive.
        hp: Number.isFinite(hp) ? Math.min(1, Math.max(0.1, hp)) : 1,
      };
    })
    .filter((sh): sh is ShadeSave => sh !== null);

  // Nobody to resume as.
  if (!shades.length) return null;

  const room = (sh => (sh && sh in ROOMS ? sh : 'combat'))(s.room) as RoomKind;
  const n = (x: unknown) => Math.max(0, Math.floor(Number(x)) || 0);

  return { v: VERSION, depth, room, obols: n(s.obols), kills: n(s.kills), shades };
}

/** The descent waiting to be resumed, or null when there is none. */
export function loadRun(): RunSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitise(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveRun(run: RunSave) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...run, v: VERSION }));
  } catch {
    /* private mode: the run still plays, it just cannot be walked away from */
  }
}

export function clearRun() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do — a save that cannot be cleared is one that was never written */
  }
}
