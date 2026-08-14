import type { Action, Frame } from '../core/input';

export const MAX_PLAYERS = 4;

/** Fixed order — the index is the wire bit, so this list must never be reordered. */
export const ACTIONS: Action[] = ['attack', 'special', 'cast', 'dash', 'call', 'interact'];

/**
 * Inputs go out every tick, so they travel as a packed array, not an object.
 * The trailing value is the sequence number, echoed back by the host so the
 * guest knows which of its predicted steps have been confirmed.
 */
export type WireFrame = [number, number, number, number, number, number, number];

export function encodeFrame(f: Frame, seq = 0): WireFrame {
  let pressed = 0;
  let held = 0;
  ACTIONS.forEach((a, i) => {
    if (f.pressed.has(a)) pressed |= 1 << i;
    if (f.held.has(a)) held |= 1 << i;
  });
  // Two decimals is well under the resolution of a 60Hz analogue stick.
  const q = (n: number) => Math.round(n * 100) / 100;
  return [q(f.moveX), q(f.moveY), q(f.aimX), q(f.aimY), pressed, held, seq];
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
 *  revive, iframes, classIdx, usingSpecial, moveSpeed]
 *
 * `moveSpeed` is the *effective* top speed after boons. The guest predicts its
 * own movement and has no idea what boons the host applied, so sending the
 * derived number keeps prediction and simulation on the same footing.
 *
 * The build does not ride here. It is a list of ids, not a number, and it
 * changes a few times a descent rather than thirty times a second — see
 * `builds` on the Snapshot.
 */
export type WirePlayer = [
  number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number
];

/** [id, kindIdx, x, z, facing, hp, maxHp, stateIdx, dead, enraged, flash, statusBits] */
export type WireEnemy = [
  number, number, number, number, number, number, number, number, number, number, number,
  number
];

/**
 * [id, x, z, colour, teamIsPlayer, radius]
 *
 * `radius` is the radius the bolt is *drawn* at, not the one it is hit at — the
 * two differ by roughly half. It travels because a guest builds the mesh itself,
 * and a bolt, an orb and a hydra's spit are three different sizes that were all
 * coming out as the same wrong one.
 */
export type WireProjectile = [number, number, number, number, number, number];

/** Visual events the host played this tick, replayed verbatim on every guest. */
export type WireFx =
  | ['slash', number, number, number, number, number, number, number]
  | ['spark', number, number, number, number, string, number]
  | ['burst', number, number, string, number]
  | ['ring', number, number, number, number, number]
  | ['trail', number, number, string]
  | ['shake', number]
  /** ['sfx', cue name, x, z, power] — the audible half of a moment. */
  | ['sfx', string, number, number, number]
  /** ['dmg', x, z, amount, crit, colour] — a number that popped over a body. */
  | ['dmg', number, number, number, number, string]
  /** ['freeze', seconds] — the hitstop the host just took. */
  | ['freeze', number];

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
  /**
   * [player id, encoded picks] — what each shade is carrying.
   *
   * The host resolves all combat, so a guest needs none of this to be simulated
   * correctly. It needs it to be *told*: without it a guest's own HUD shows an
   * empty build, the sheet has nothing to list, and its weapon animates at base
   * speed while the host swings it 30% faster.
   *
   * Sent as the choices rather than the numbers, exactly as the run save is
   * written, so one replay path serves both. Omitted from most snapshots — a
   * build changes a few times a descent, not every tick.
   */
  builds?: [number, string][];
  /**
   * [network id, last input sequence the host consumed]. Guests replay only the
   * inputs newer than their ack, which is what keeps prediction from fighting
   * the authoritative state.
   */
  acks: [number, number][];
  depth: number;
  label: string;
  /** Non-empty when the host wants a banner shown on every screen. */
  banner?: string;
  paused: boolean;
}

/**
 * One card as it travels to a guest's chooser. Deliberately the exact shape the
 * local chooser already renders, so a remote seat and a local seat see the same
 * screen built from the same fields rather than two parallel layouts.
 */
export interface WireCard {
  id: string;
  name: string;
  desc: string;
  /** Small label above the name — a throne, a slot, a rival's interruption. */
  kicker: string;
  accent: string;
  /** A rival answering over the offering throne. Drawn in its own colour. */
  rival?: boolean;
  /** Levels held, and levels on the track, for a boon being stacked. */
  pips?: number;
  pipsOf?: number;
}

/**
 * The offer screen's furniture — everything except the cards. Mirrors OfferView
 * in ui/hud.ts; the guest hands it straight to the same chooser the host uses,
 * so a remote seat and a local seat are the same screen built from one shape.
 */
export interface WireView {
  /** Heading — a god's name, 'HAMMER', 'EMPOWER'. */
  title: string;
  accent: string;
  subtitle: string;
  epithet?: string;
  quote?: string;
  numeral?: string;
  roundel?: string;
  ink?: string;
  throne?: string;
  art?: string;
}

/**
 * An open choice the host is waiting on. Covers boons, hammers and poms: they
 * differ only in their heading and colour, which is why they can share a wire
 * format at all.
 */
export interface WireOffer {
  /** Which player must choose. */
  pid: number;
  view: WireView;
  cards: WireCard[];
}

export type ClientMessage =
  | { t: 'hello'; room: string; name: string; cls: string; meta?: string }
  | { t: 'in'; f: WireFrame }
  | { t: 'pick'; boonId: string }
  | Snapshot;

export type ServerMessage =
  | { t: 'role'; role: 'host' | 'guest'; id: number; room: string }
  | { t: 'join'; id: number; name: string; cls: string; meta?: string }
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
