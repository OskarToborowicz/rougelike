import { t } from '../ui/i18n';

export interface Biome {
  id: string;
  name: string;
  /** Floor base and mottling hues, fed to the painted floor texture. */
  floorBase: string;
  warmHue: [number, number];
  coolHue: [number, number];
  /** Mosaic band colours, outer to inner. */
  bands: string[];
  wallTop: string;
  wallMid: string;
  wallBase: string;
  gild: string;
  fog: number;
  background: number;
  /** Torch pair: the majority flame and the accent flame. */
  flameWarm: number;
  flameCool: number;
  pillar: number;
  /** Which boss rules this region. */
  boss: 'erinys' | 'hydra' | 'champion';
}

/**
 * Three regions of the underworld, five chambers each. They exist to stop the
 * run looking like one room repeated — the palette, the flames and the boss all
 * turn over together, so arriving somewhere new is unmistakable.
 */
export const BIOMES: Biome[] = [
  {
    id: 'tartarus',
    get name() {
      return t('biome.tartarus');
    },
    floorBase: '#4a3346',
    warmHue: [22, 38],
    coolHue: [268, 292],
    bands: ['#d6a660', '#8c5ab4', '#d6a660', '#78c8dc', '#c48e50'],
    wallTop: '#0b0714',
    wallMid: '#241634',
    wallBase: '#4b3140',
    gild: '#c69656',
    fog: 0x140c22,
    background: 0x090612,
    flameWarm: 0xff9b4a,
    flameCool: 0x3fe0c8,
    pillar: 0x8a6c4c,
    boss: 'erinys',
  },
  {
    id: 'asphodel',
    get name() {
      return t('biome.asphodel');
    },
    floorBase: '#3a2018',
    warmHue: [8, 26],
    coolHue: [340, 358],
    bands: ['#ff8a3c', '#7a1810', '#ffb454', '#ff5a2a', '#c4501c'],
    wallTop: '#12060a',
    wallMid: '#3a0e10',
    wallBase: '#6b2418',
    gild: '#ffae4c',
    fog: 0x2a0c0a,
    background: 0x150605,
    flameWarm: 0xff6a2a,
    flameCool: 0xffd24a,
    pillar: 0x9a5230,
    boss: 'hydra',
  },
  {
    id: 'elysium',
    get name() {
      return t('biome.elysium');
    },
    floorBase: '#1f4448',
    warmHue: [150, 175],
    coolHue: [185, 210],
    bands: ['#7fe6c8', '#2a6f7a', '#a8f0d8', '#5ec8ff', '#4aa08c'],
    wallTop: '#04120f',
    wallMid: '#0e3230',
    wallBase: '#1c5a52',
    gild: '#9fe8c0',
    fog: 0x0a2422,
    background: 0x041210,
    flameWarm: 0x6affc0,
    flameCool: 0x8ab4ff,
    pillar: 0x4e8a78,
    boss: 'champion',
  },
];

/**
 * Five chambers per region, then it wraps and everything gets harder.
 *
 * The order is the climb, and it already was: Tartarus is the floor of the
 * underworld, Asphodel sits above it and Elysium above that, so a party working
 * up this list is walking out. Nothing had to be reversed when the run stopped
 * being a descent — the regions were only ever named in the order you meet
 * them, and meeting them bottom-first is what an escape is. New realms —
 * Helheim, and whatever comes after — append here, above Elysium.
 */
export function biomeForRung(rung: number): Biome {
  return BIOMES[Math.floor((rung - 1) / 5) % BIOMES.length];
}

/**
 * The arena grows with the party. Four players plus a boss and a pack of adds
 * simply does not fit in a solo-sized room — everyone ends up shoving each other
 * into the same telegraph.
 */
export function arenaRadiusFor(playerCount: number) {
  /*
   * 11.5 was too tight from about the sixth chamber on, and the arithmetic says
   * why rather than the feel. Usable radius is this minus the player's own body
   * and the confine margin, and spread n foes evenly over it and the average gap
   * between them is 2·usable/√n. At rung 9 in a horde room that is 28 bodies in
   * a 20.7 circle: a 3.9 gap, against a brute reaching 2.9 and a dash carrying
   * 4.6. There was nowhere to dash that was not already inside someone's range.
   *
   * 13 buys 31% more floor and takes that gap back above a dash. It does not fix
   * the far end of a run on its own — the wave counts rise with every rung and
   * nothing caps them — but it is the half that is about space.
   */
  return 13 + Math.max(0, playerCount - 1) * 2.2;
}
