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
  playerName: 'Shade',
  relayUrl: '',
};

/**
 * Settings live in one place and are read live by whoever cares, rather than
 * being copied into the renderer at boot — so changing one mid-run takes effect
 * immediately instead of after a restart.
 */
export const settings: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
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
