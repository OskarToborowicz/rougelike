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
   *
   * The ramp is the design doc's, spread at the dark end and given a touch of
   * hue — aesir cool, rodnova green — because the doc's own tones put legion
   * and rodnova 8.2 dE apart, which is one colour at 26px. That only buys a
   * minimum of about 11, though: seven desaturated stones cannot carry a
   * seven-way distinction on colour alone, which is why every mark also wears
   * its numeral. The stone is the mood; the numeral is the information.
   */
  stone: string;
  /** Ink for the numeral struck into that stone. */
  ink: string;
  /** Text and ring colour, as CSS and as a three.js hex. */
  css: string;
  color: number;
  /**
   * The colour this throne burns in the world — its door, its portal, the light
   * it throws on the floor.
   *
   * Deliberately not `stone`. The stones are a desaturated marble ramp, four of
   * the seven within 18 degrees of hue of each other, and the note above is
   * honest about why that works: every mark also wears its numeral, so the
   * stone only has to carry mood. A door has no numeral. Turned into light those
   * four arrive as the same off-white and the party cannot tell what it is
   * walking towards, so the fire gets its own spread-out hue and the marble is
   * left exactly as designed.
   */
  light: number;
  /** Thrones that will answer over this one's offers. Symmetric by convention. */
  rivals: PantheonId[];
  /** The gods who speak for it, by id. */
  gods: string[];
}

export const PANTHEONS: Record<PantheonId, Pantheon> = {
  hellenic: {
    id: 'hellenic',
    numeral: 'I',
    stone: '#e2dac6',
    ink: '#3a352e',
    css: '#e2dac6',
    color: 0xe2dac6,
    light: 0xf7ef3a, // hellenic — gold, pushed to H57 to clear the hammer's amber
    rivals: ['aesir', 'legion'],
    gods: ['zeus', 'athena'],
  },
  aesir: {
    id: 'aesir',
    numeral: 'II',
    stone: '#a9b2b8',
    ink: '#2b2f31',
    css: '#a9b2b8',
    color: 0xa9b2b8,
    light: 0x3dc4ff, // aesir — ice, H198, the cool its stone leans to
    rivals: ['hellenic', 'rodnova'],
    gods: ['odin', 'skadi'],
  },
  netjer: {
    id: 'netjer',
    numeral: 'III',
    stone: '#8d8474',
    ink: '#17140f',
    css: '#8d8474',
    color: 0x8d8474,
    light: 0x2fe0b4, // netjer — jade, H165
    rivals: ['anunna', 'choir'],
    gods: ['anubis', 'sekhmet'],
  },
  anunna: {
    id: 'anunna',
    numeral: 'IV',
    stone: '#b04a30',
    ink: '#f6e7e0',
    css: '#b04a30',
    color: 0xb04a30,
    light: 0xff5630, // anunna — rust, H12, the one stone with real hue
    rivals: ['netjer', 'legion'],
    gods: ['inanna', 'nergal'],
  },
  choir: {
    id: 'choir',
    numeral: 'V',
    stone: '#665f52',
    ink: '#f4efe4',
    css: '#665f52',
    color: 0x665f52,
    light: 0x5a72ff, // choir — indigo, H240
    rivals: ['legion', 'netjer'],
    // One voice, not two. The choir speaks as Michael alone — he is the face
    // that was painted for it, and a throne with a portrait for one god and a
    // sigil for the other reads as a missing file rather than as a choice.
    gods: ['michael'],
  },
  legion: {
    id: 'legion',
    numeral: 'VI',
    stone: '#584a40',
    ink: '#e6dfd0',
    css: '#584a40',
    color: 0x584a40,
    light: 0xff5ad0, // legion — magenta, H322
    rivals: ['choir', 'hellenic', 'anunna'],
    gods: ['belial', 'lilith'],
  },
  rodnova: {
    id: 'rodnova',
    numeral: 'VII',
    stone: '#39463a',
    ink: '#e6dfd0',
    css: '#39463a',
    color: 0x39463a,
    light: 0x5ce063, // rodnova — green, H122, keeping its stone's cast
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
