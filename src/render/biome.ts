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

/** Five chambers per region, then it wraps and everything gets harder. */
export function biomeForDepth(depth: number): Biome {
  return BIOMES[Math.floor((depth - 1) / 5) % BIOMES.length];
}

/**
 * The arena grows with the party. Four players plus a boss and a pack of adds
 * simply does not fit in a solo-sized room — everyone ends up shoving each other
 * into the same telegraph.
 */
export function arenaRadiusFor(playerCount: number) {
  return 11.5 + Math.max(0, playerCount - 1) * 2.2;
}
