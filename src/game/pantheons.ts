import { t, type Key } from '../ui/i18n';

/**
 * The seven thrones.
 *
 * ECUMENE is a council, not a pantheon — seven traditions of the dead sharing
 * one underworld and disagreeing about it. Mechanically a throne is what a boon
 * belongs to: it owns the colour, the roundel, and the rivals who will answer
 * over its offers. The gods are the faces that come to the door; which one shows
 * up changes the words on the card, not the maths behind it.
 *
 * Ids are English and stable — they key the i18n dictionary, the save file and
 * the wire. Everything the player reads comes back through `t()`.
 */
export type PantheonId =
  | 'hellenic'
  | 'aesir'
  | 'netjer'
  | 'anunna'
  | 'choir'
  | 'legion'
  | 'rodnova';

export const PANTHEON_ORDER: PantheonId[] = [
  'hellenic',
  'aesir',
  'netjer',
  'anunna',
  'choir',
  'legion',
  'rodnova',
];

export interface Pantheon {
  id: PantheonId;
  /** Which throne it sits on. Shown on the roundel. */
  numeral: string;
  /**
   * The throne's stone.
   *
   * The marble pass took the seven saturated hues away: a desaturated ramp with
   * a single sanguine in it, so the art reads as relief rather than painting.
   * `stone` is the mark's face, `ink` the numeral cut into it, and `css`/`color`
   * the tone anything else tints by.
   */
  stone: string;
  /** Ink for the numeral struck into that stone. */
  ink: string;
  /** Text and ring colour, as CSS and as a three.js hex. */
  css: string;
  color: number;
  /** Thrones that will answer over this one's offers. Symmetric by convention. */
  rivals: PantheonId[];
  /** The gods who speak for it, by id. */
  gods: string[];
}

export const PANTHEONS: Record<PantheonId, Pantheon> = {
  hellenic: {
    id: 'hellenic',
    numeral: 'I',
    stone: '#ded6c5',
    ink: '#3a352e',
    css: '#ded6c5',
    color: 0xded6c5,
    rivals: ['aesir', 'legion'],
    gods: ['zeus', 'athena'],
  },
  aesir: {
    id: 'aesir',
    numeral: 'II',
    stone: '#b6ad9c',
    ink: '#2f2b25',
    css: '#b6ad9c',
    color: 0xb6ad9c,
    rivals: ['hellenic', 'rodnova'],
    gods: ['odin', 'skadi'],
  },
  netjer: {
    id: 'netjer',
    numeral: 'III',
    stone: '#8d8474',
    ink: '#1e1b17',
    css: '#8d8474',
    color: 0x8d8474,
    rivals: ['anunna', 'choir'],
    gods: ['anubis', 'sekhmet'],
  },
  anunna: {
    id: 'anunna',
    numeral: 'IV',
    stone: '#b04a30',
    ink: '#2a0f08',
    css: '#b04a30',
    color: 0xb04a30,
    rivals: ['netjer', 'legion'],
    gods: ['inanna', 'nergal'],
  },
  choir: {
    id: 'choir',
    numeral: 'V',
    stone: '#6a6252',
    ink: '#e6dfd0',
    css: '#6a6252',
    color: 0x6a6252,
    rivals: ['legion', 'netjer'],
    gods: ['michael', 'raphael'],
  },
  legion: {
    id: 'legion',
    numeral: 'VI',
    stone: '#4e4740',
    ink: '#e6dfd0',
    css: '#4e4740',
    color: 0x4e4740,
    rivals: ['choir', 'hellenic', 'anunna'],
    gods: ['belial', 'lilith'],
  },
  rodnova: {
    id: 'rodnova',
    numeral: 'VII',
    stone: '#3a3530',
    ink: '#e6dfd0',
    css: '#3a3530',
    color: 0x3a3530,
    rivals: ['aesir'],
    gods: ['perun', 'morana'],
  },
};

/** Which throne a god belongs to. Built once from the rosters above. */
export const PANTHEON_OF: Record<string, PantheonId> = Object.fromEntries(
  PANTHEON_ORDER.flatMap((p) => PANTHEONS[p].gods.map((g) => [g, p]))
);

// ----------------------------------------------------------------- display

export const pantheonName = (p: PantheonId) => t(`pantheon.${p}` as Key);

/** "the choir · fifth throne" — the line under a god's roundel. */
export const throneLine = (p: PantheonId) =>
  t('pantheon.throne', { name: pantheonName(p), n: t(`throne.${p}` as Key) });

export const godName = (g: string) => t(`god.${g}.name` as Key);
export const godEpithet = (g: string) => t(`god.${g}.epithet` as Key);
export const godQuote = (g: string) => t(`god.${g}.quote` as Key);

/**
 * The throne's mark, as a CSS background. A single directional light across one
 * stone — no metal ramp, because the marble pass has no metal in it.
 */
export const roundel = (p: PantheonId) => {
  const s = PANTHEONS[p].stone;
  return `linear-gradient(168deg,${s},color-mix(in srgb,${s} 76%,#000) 60%,${s})`;
};

/**
 * A random god of a throne. The god is chosen per offer rather than per run, so
 * the same throne can arrive wearing a different face on the way down.
 */
export const godOfPantheon = (p: PantheonId) => {
  const roster = PANTHEONS[p].gods;
  return roster[Math.floor(Math.random() * roster.length)];
};
