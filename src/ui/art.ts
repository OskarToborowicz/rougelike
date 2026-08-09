import type { ClassId } from '../game/classes';
import type { PantheonId } from '../game/pantheons';

/**
 * Art surfaces.
 *
 * Every `<image-slot>` in the design doc becomes one of these. The rule is that
 * a missing file is never an error: the plate keeps its frame, takes a tint, and
 * shows a sigil instead, so the game is fully playable with `public/art/` empty
 * and gets better as files land in it. See public/art/README.md.
 *
 * Files are probed once each and the result cached — a portrait plate is rebuilt
 * every time a seat is added, and a 404 per rebuild would be noise in the
 * network panel forever.
 */

const ART = '/art';

/** null = not probed yet, true/false = the answer. */
const present = new Map<string, boolean | null>();

function probe(src: string, onLoad: () => void) {
  const known = present.get(src);
  if (known === true) {
    onLoad();
    return;
  }
  if (known === false) return;

  present.set(src, null);
  const img = new Image();
  img.onload = () => {
    present.set(src, true);
    onLoad();
  };
  img.onerror = () => present.set(src, false);
  img.src = src;
}

export interface ArtOptions {
  /** Shown centred while the file is missing — usually a single letter. */
  sigil?: string;
  /** Border/tint colour for the empty state. */
  tint?: string;
}

/**
 * Build an art surface for `src`. Returns immediately with the empty state and
 * upgrades itself in place once the image is known to exist.
 */
export function artSlot(src: string, opts: ArtOptions = {}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'e-art missing';
  if (opts.tint) wrap.style.setProperty('--tint', opts.tint);

  if (opts.sigil) {
    const sigil = document.createElement('div');
    sigil.className = 'e-sigil';
    sigil.textContent = opts.sigil;
    wrap.appendChild(sigil);
  }

  probe(src, () => {
    const img = new Image();
    img.src = src;
    img.alt = '';
    wrap.classList.remove('missing');
    wrap.replaceChildren(img);
  });

  return wrap;
}

/** The painting behind the title. */
export const titleArt = () => artSlot(`${ART}/descent.jpg`);

/** A shade's portrait plate. One per class; the seat only picks the sigil. */
export const shadeArt = (cls: ClassId, sigil: string, tint?: string) =>
  artSlot(`${ART}/shade-${cls}.jpg`, { sigil, tint });

/** The god's plate on the offer screen. */
export const godArt = (god: string, sigil: string) =>
  artSlot(`${ART}/god-${god}.jpg`, { sigil });

/** Backdrop for a throne, if one is ever wanted. Unused by the three screens. */
export const throneArt = (p: PantheonId) => artSlot(`${ART}/throne-${p}.jpg`);
