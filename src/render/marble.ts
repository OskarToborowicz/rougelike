/**
 * The two marble slabs the whole game is cut from: black with gold veining and
 * white with sanguine veining. Photographic, tiling, and shared between the 3D
 * room and the CSS screens so the stone underfoot is the same stone the HUD is
 * carved out of.
 *
 * Loading is fire-and-forget on purpose. Everything that paints stone has to
 * work before the images land — the arena is rebuilt between chambers and the
 * first one is built on frame zero — so callers draw their procedural version
 * immediately and re-paint through `whenMarbleReady()` once the file arrives.
 */

export type MarbleKind = 'black' | 'white';

const SRC: Record<MarbleKind, string> = {
  black: '/textures/marble_black.jpg',
  white: '/textures/marble_white.jpg',
};

const images = new Map<MarbleKind, HTMLImageElement>();

const ready = Promise.all(
  (Object.keys(SRC) as MarbleKind[]).map(
    (kind) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          images.set(kind, img);
          resolve();
        };
        // A missing slab is not fatal: the procedural stone stands on its own.
        img.onerror = () => resolve();
        img.src = SRC[kind];
      })
  )
).then(() => undefined);

/** The slab, or null while it is still in flight. Never throws, never blocks. */
export function marble(kind: MarbleKind): HTMLImageElement | null {
  return images.get(kind) ?? null;
}

/** Resolves once both slabs have settled, loaded or not. */
export function whenMarbleReady(): Promise<void> {
  return ready;
}

/**
 * Tile a slab across a canvas at a given scale, in whatever blend the caller
 * needs. Split out because floor, wall and column all want the same thing with
 * different weights, and getting the save/restore wrong leaves the composite
 * mode set for the rest of the painting.
 */
export function layMarble(
  ctx: CanvasRenderingContext2D,
  kind: MarbleKind,
  w: number,
  h: number,
  opts: { tile: number; alpha: number; mode?: GlobalCompositeOperation } = {
    tile: 1,
    alpha: 1,
  }
) {
  const img = marble(kind);
  if (!img) return false;
  ctx.save();
  ctx.globalAlpha = opts.alpha;
  if (opts.mode) ctx.globalCompositeOperation = opts.mode;
  const step = Math.max(w, h) / opts.tile;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) ctx.drawImage(img, x, y, step, step);
  }
  ctx.restore();
  return true;
}
