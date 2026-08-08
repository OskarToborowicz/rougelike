import * as THREE from 'three';
import { rand, TAU } from '../core/math';

/**
 * Painted character skins. A single flat colour on a capsule reads as a blob no
 * matter how it's lit — Hades' foes are legible because each one carries its own
 * internal light/dark pattern. These maps put that pattern on the mesh: a dark
 * base, a lit upper band, and hard-edged armour trim.
 */
export function makeBodySkin(
  base: string,
  trim: string,
  opts: { plates?: number; rags?: boolean; size?: number } = {}
): THREE.Texture {
  const size = opts.size ?? 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;

  // Vertical gradient: lit at the shoulders, swallowed by dark at the feet.
  // Capsule/cylinder UVs run v=1 at the top, so y=0 here is the top of the body.
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, shade(base, 1.18));
  g.addColorStop(0.4, base);
  g.addColorStop(1, shade(base, 0.22));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Horizontal armour plates with a bright top lip and a black shadow under it.
  const plates = opts.plates ?? 3;
  for (let i = 0; i < plates; i++) {
    const y = size * (0.22 + (i / plates) * 0.5);
    const h = size * 0.075;
    ctx.fillStyle = trim;
    ctx.fillRect(0, y, size, h);
    ctx.fillStyle = shade(trim, 1.35);
    ctx.fillRect(0, y, size, Math.max(2, h * 0.28));
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, y + h, size, Math.max(2, h * 0.4));
  }

  // Torn hem — breaks the bottom edge so the body doesn't end in a hard ring.
  if (opts.rags) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.moveTo(0, size);
    for (let x = 0; x <= size; x += size / 18) {
      ctx.lineTo(x, size * rand(0.78, 0.94));
      ctx.lineTo(x + size / 36, size * rand(0.86, 0.99));
    }
    ctx.lineTo(size, size);
    ctx.fill();
  }

  // Grime speckle, so the flats never look like vector shapes.
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rand(0.05, 0.2).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(rand(0, size), rand(0, size), rand(1, 5), 0, TAU);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Bone: pale, with dark sutures and hollow sockets. */
export function makeBoneSkin(size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, size);
  // Kept off pure white: with the rim lights on, a bright skull outshines the
  // player and the head becomes the only thing in the frame.
  g.addColorStop(0, '#d9c9a6');
  g.addColorStop(0.6, '#a8957a');
  g.addColorStop(1, '#4e4335');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(60,45,30,0.6)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let x = 0;
    const y0 = size * rand(0.2, 0.8);
    ctx.moveTo(0, y0);
    while (x < size) {
      x += size / 14;
      ctx.lineTo(x, y0 + rand(-5, 5));
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Multiply/lighten a #rrggbb by a factor, clamped. */
function shade(hex: string, f: number) {
  const h = hex.replace('#', '');
  const p = (i: number) =>
    Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f)));
  return `rgb(${p(0)},${p(2)},${p(4)})`;
}

export const hexString = (n: number) => '#' + n.toString(16).padStart(6, '0');
