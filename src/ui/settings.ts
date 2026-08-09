export interface Settings {
  /** Multiplies every camera shake. 0 disables it entirely. */
  shake: number;
  /** Floating damage numbers. Off is a legitimate preference, not a downgrade. */
  damageNumbers: boolean;
  /** Shadow maps — the single biggest GPU cost in the scene. */
  shadows: boolean;
  /** Caps device pixel ratio. Low renders fewer pixels on high-DPI screens. */
  quality: 'low' | 'medium' | 'high';
  /** Extra camera distance, for players who want more of the room in frame. */
  zoom: number;
  /** Combat and interface sounds. 0 is silence. */
  sfxVolume: number;
  /** The drone bed under the run, scaled separately — many players want only this off. */
  musicVolume: number;
  playerName: string;
  relayUrl: string;
}

const KEY = 'styx.settings';

export const DEFAULTS: Settings = {
  shake: 1,
  damageNumbers: true,
  shadows: true,
  quality: 'high',
  zoom: 1,
  sfxVolume: 0.8,
  musicVolume: 0.5,
  playerName: 'Shade',
  relayUrl: '',
};

/**
 * Settings live in one place and are read live by whoever cares, rather than
 * being copied into the renderer at boot — so changing one mid-run takes effect
 * immediately instead of after a restart.
 */
export const settings: Settings = load();

/**
 * First-run defaults for the machine we actually landed on.
 *
 * A phone at devicePixelRatio 3 rendering shadow maps at full resolution is a
 * slideshow, and a player whose first impression is 15fps never gets to the
 * options screen to fix it. Only ever applied when nothing is stored — an
 * explicit choice is never second-guessed.
 */
function deviceDefaults(): Settings {
  const coarse = matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(innerWidth, innerHeight) < 820;
  if (!coarse || !small) return { ...DEFAULTS };
  return { ...DEFAULTS, quality: 'medium', shadows: false };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return deviceDefaults();
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return deviceDefaults();
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode; the run still works, it just will not be remembered */
  }
}

export const pixelRatioFor = (q: Settings['quality']) =>
  q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
