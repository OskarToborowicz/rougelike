import type { Action, Frame } from '../core/input';

export const MAX_PLAYERS = 4;

/** Fixed order — the index is the wire bit, so this list must never be reordered. */
export const ACTIONS: Action[] = ['attack', 'special', 'cast', 'dash', 'call', 'interact'];

/** Inputs go out every tick, so they travel as a packed array, not an object. */
export type WireFrame = [number, number, number, number, number, number];

export function encodeFrame(f: Frame): WireFrame {
  let pressed = 0;
  let held = 0;
  ACTIONS.forEach((a, i) => {
    if (f.pressed.has(a)) pressed |= 1 << i;
    if (f.held.has(a)) held |= 1 << i;
  });
  // Two decimals is well under the resolution of a 60Hz analogue stick.
  const q = (n: number) => Math.round(n * 100) / 100;
  return [q(f.moveX), q(f.moveY), q(f.aimX), q(f.aimY), pressed, held];
}

export function decodeFrame(w: WireFrame): Frame {
  const pressed = new Set<Action>();
  const held = new Set<Action>();
  ACTIONS.forEach((a, i) => {
    if (w[4] & (1 << i)) pressed.add(a);
    if (w[5] & (1 << i)) held.add(a);
  });
  return { moveX: w[0], moveY: w[1], aimX: w[2], aimY: w[3], pressed, held };
}

/**
 * [id, seat, x, z, facing, hp, maxHp, stateIdx, dead, castAmmo, callGauge,
 *  revive, iframes, classIdx, usingSpecial]
 */
export type WirePlayer = [
  number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number
];

/** [id, kindIdx, x, z, facing, hp, maxHp, stateIdx, dead, enraged, flash] */
export type WireEnemy = [
  number, number, number, number, number, number, number, number, number, number, number
];

/** [id, x, z, colour, teamIsPlayer] */
export type WireProjectile = [number, number, number, number, number];

/** Visual events the host played this tick, replayed verbatim on every guest. */
export type WireFx =
  | ['slash', number, number, number, number, number, number, number]
  | ['spark', number, number, number, number, string, number]
  | ['burst', number, number, string, number]
  | ['ring', number, number, number, number, number]
  | ['trail', number, number, string]
  | ['shake', number]
  | ['dmg', number, number, number, number, string];

export interface Snapshot {
  t: 'sn';
  /** Host tick counter; guests drop anything that arrives out of order. */
  n: number;
  players: WirePlayer[];
  enemies: WireEnemy[];
  projectiles: WireProjectile[];
  fx: WireFx[];
  /** [network id, player id] — lets each guest find which shade is theirs. */
  owners: [number, number][];
  /** Boon choices the host is currently waiting on, if any. */
  offers?: WireOffer[];
  depth: number;
  label: string;
  /** Non-empty when the host wants a banner shown on every screen. */
  banner?: string;
  paused: boolean;
}

/** A boon as it travels to a guest's chooser. */
export interface WireBoon {
  id: string;
  god: string;
  name: string;
  desc: string;
}

/** An open boon choice the host is waiting on. */
export interface WireOffer {
  /** Which player must choose. */
  pid: number;
  god: string;
  boons: WireBoon[];
}

export type ClientMessage =
  | { t: 'hello'; room: string; name: string; cls: string }
  | { t: 'in'; f: WireFrame }
  | { t: 'pick'; boonId: string }
  | Snapshot;

export type ServerMessage =
  | { t: 'role'; role: 'host' | 'guest'; id: number; room: string }
  | { t: 'join'; id: number; name: string; cls: string }
  | { t: 'leave'; id: number }
  | { t: 'in'; id: number; f: WireFrame }
  | { t: 'pick'; id: number; boonId: string }
  | { t: 'full' }
  | Snapshot;

/** Short, unambiguous room codes — no vowels, no 0/O/1/I. */
export function makeRoomCode(): string {
  const alphabet = 'BCDFGHJKMNPQRSTVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
