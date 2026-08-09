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
  /** The four stops of the roundel's metal gradient, light to dark. */
  metal: [string, string, string, string];
  /** Ink for the numeral struck into that metal. */
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
    metal: ['#f7e6ad', '#c9a227', '#6d5214', '#a8831f'],
    ink: '#231a06',
    css: '#f4e3ae',
    color: 0xf4e3ae,
    rivals: ['aesir', 'legion'],
    gods: ['zeus', 'athena'],
  },
  aesir: {
    id: 'aesir',
    numeral: 'II',
    metal: ['#dfeaf2', '#8ba9be', '#3f5566', '#6d8698'],
    ink: '#101a20',
    css: '#bcd4e6',
    color: 0xbcd4e6,
    rivals: ['hellenic', 'rodnova'],
    gods: ['odin', 'skadi'],
  },
  netjer: {
    id: 'netjer',
    numeral: 'III',
    metal: ['#a9e2d6', '#3ba18f', '#1d4f47', '#2f7f74'],
    ink: '#08201c',
    css: '#7fe6c8',
    color: 0x7fe6c8,
    rivals: ['anunna', 'choir'],
    gods: ['anubis', 'sekhmet'],
  },
  anunna: {
    id: 'anunna',
    numeral: 'IV',
    metal: ['#f0bd8c', '#c06a2e', '#653a18', '#8f4d20'],
    ink: '#241205',
    css: '#f0bd8c',
    color: 0xf0bd8c,
    rivals: ['netjer', 'legion'],
    gods: ['inanna', 'nergal'],
  },
  choir: {
    id: 'choir',
    numeral: 'V',
    metal: ['#fffdf6', '#e4dcc2', '#9a927b', '#cfc6a8'],
    ink: '#2a2620',
    css: '#e4dcc2',
    color: 0xe4dcc2,
    rivals: ['legion', 'netjer'],
    gods: ['michael', 'raphael'],
  },
  legion: {
    id: 'legion',
    numeral: 'VI',
    metal: ['#e88a80', '#b8332f', '#5c1512', '#8c2622'],
    ink: '#2a0906',
    css: '#e8a49c',
    color: 0xe8a49c,
    rivals: ['choir', 'hellenic', 'anunna'],
    gods: ['belial', 'lilith'],
  },
  rodnova: {
    id: 'rodnova',
    numeral: 'VII',
    metal: ['#c5da9a', '#7d9b52', '#3c4d24', '#5f7a3a'],
    ink: '#141c0a',
    css: '#c5da9a',
    color: 0xc5da9a,
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

/** The roundel's metal, as a CSS gradient. Used by every screen. */
export const roundel = (p: PantheonId) => {
  const [a, b, c, d] = PANTHEONS[p].metal;
  return `linear-gradient(160deg,${a},${b} 42%,${c} 78%,${d})`;
};

/**
 * A random god of a throne. The god is chosen per offer rather than per run, so
 * the same throne can arrive wearing a different face on the way down.
 */
export const godOfPantheon = (p: PantheonId) => {
  const roster = PANTHEONS[p].gods;
  return roster[Math.floor(Math.random() * roster.length)];
};
