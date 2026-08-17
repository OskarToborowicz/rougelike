import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RewardKind } from '../game/rewards';

/**
 * The thing floating over a door, saying what is on the other side of it.
 *
 * A gate used to communicate its reward with exactly one channel: the hue of
 * the portal, the floor ring and a soft round sprite, all set from the same
 * `reward.light`. That is one channel too few, and `pantheons.ts` already says
 * why in its own words — seven desaturated thrones cannot carry a seven-way
 * distinction on colour alone, which is why every mark in the UI also wears its
 * numeral. A door had no numeral. Worse, colour cannot separate the *kinds*
 * either: a hammer is amber and the hellenic throne is gold, and at seventeen
 * units those are the same door.
 *
 * So the sprite becomes a shape. Four silhouettes for the four reward kinds,
 * and for a boon the throne's own roman numeral, which is the same information
 * the offer screen leads with — read it on the door, and you already know whose
 * cards you are walking into.
 *
 * ## Two tones, and why
 *
 * Every emblem is a dark **stone** with a bright **sigil** standing proud of it,
 * which is the roundel's construction lifted into three dimensions. It is not
 * decoration: the sigil is additive-bright and the portal behind it is a sheet
 * of additive light, so a bright shape alone would sit on a bright field and
 * dissolve. The stone is what the sigil is read against. `addOutline` cannot do
 * this job — it skips `MeshBasicMaterial` on purpose, and a self-lit sigil has
 * to be basic or the dark room would swallow it.
 *
 * ## One geometry per tone
 *
 * Every part is merged down to one buffer per material before it leaves here,
 * so an emblem costs two draw calls no matter how many boxes went into it. That
 * matters more than the triangle count: `glb-info.mjs` spends a whole paragraph
 * on the fact that three.js batches nothing, and three gates each carrying a
 * dozen loose boxes would put more draw calls in the room than the party does.
 */

/** Dark enough to read as cut stone against a lit doorway, never black. */
const STONE = 0x171313;

export interface Emblem {
  readonly group: THREE.Group;
  /** Paint the sigil with the throne's fire. The stone never takes it. */
  tint(color: THREE.Color): void;
  dispose(): void;
}

// --------------------------------------------------------------------- parts
//
// Everything below returns geometry already placed in the emblem's own space:
// origin at the middle, roughly 1.6 wide and 1.3 tall, +Z toward the player.
// Building in final position rather than assembling transforms later is what
// lets the whole thing merge in one pass.

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0, rot = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.rotateZ(rot);
  g.translate(x, y, z);
  return g;
};

const ball = (r: number, x = 0, y = 0, z = 0) => {
  const g = new THREE.SphereGeometry(r, 10, 8);
  g.translate(x, y, z);
  return g;
};

/**
 * A roman numeral in bars.
 *
 * The seven thrones are numbered I to VII, and every glyph in that range is
 * made of straight strokes — which is the whole reason this is affordable. A
 * numeral is two to four boxes; a font would be an atlas, a texture and a UV
 * set on a model set that ships with zero embedded images.
 */
function numeralBars(numeral: string) {
  const H = 0.86;
  const BAR = 0.15;
  const LEAN = 0.34;
  // How far a leaning stroke's end travels sideways from its own centre. Offset
  // the two strokes by exactly this and their bottoms meet on the centre line.
  const reach = Math.sin(LEAN) * H * 0.5;

  /**
   * One glyph, built at the origin.
   *
   * The left stroke leans `\` and the right one `/`, so they close at the
   * *bottom*. Signed the other way they close at the top, which is a lambda —
   * and a lambda with an I beside it is why VI was arriving as something much
   * closer to an N. A positive Z rotation carries a bar's top toward -x, so the
   * sign that opens the mouth is the one on the far side of each stroke.
   */
  const glyph = (ch: string) =>
    ch === 'V'
      ? [box(BAR, H, BAR, -reach, 0, 0, LEAN), box(BAR, H, BAR, reach, 0, 0, -LEAN)]
      : [box(BAR, H, BAR)];

  // Measured, never derived. A rotated box is wider than the box it started as,
  // and the closed form for *how much* wider was wrong by a third of a glyph —
  // enough to seat the I of `IV` inside the V's left stroke. Measuring cannot
  // drift when the lean or the bar changes.
  const built = [...numeral]
    .filter((ch) => ch === 'I' || ch === 'V')
    .map((ch) => {
      const parts = glyph(ch);
      const b = new THREE.Box3();
      for (const p of parts) {
        p.computeBoundingBox();
        b.union(p.boundingBox!);
      }
      return { parts, min: b.min.x, w: b.max.x - b.min.x };
    });

  const gap = 0.13;
  const total = built.reduce((n, g) => n + g.w, 0) + gap * Math.max(0, built.length - 1);

  const out: THREE.BufferGeometry[] = [];
  let cursor = -total / 2;
  for (const g of built) {
    const shift = cursor - g.min;
    for (const p of g.parts) {
      p.translate(shift, 0, 0);
      out.push(p);
    }
    cursor += g.w + gap;
  }
  return out;
}

/**
 * Head and haft. The head is deliberately lopsided — a symmetric block on a
 * stick is a mallet or a sign, and the flared striking face is the one detail
 * that makes the silhouette say *hammer* without a texture on it.
 */
const hammerParts = () => [
  box(0.86, 0.34, 0.3, 0, 0.36, 0),
  box(0.18, 0.44, 0.36, 0.44, 0.36, 0),
  box(0.15, 0.92, 0.15, 0, -0.24, 0),
  box(0.28, 0.12, 0.18, 0, -0.66, 0),
];

/**
 * A heart: two lobes and a point. Two spheres and a square turned on its corner
 * is the cheapest shape that is unmistakably one, and unmistakable is the whole
 * requirement — this is the door you take when you are about to die.
 */
const heartParts = () => [
  ball(0.3, -0.24, 0.22, 0),
  ball(0.3, 0.24, 0.22, 0),
  box(0.62, 0.62, 0.42, 0, -0.06, 0, Math.PI / 4),
];

/**
 * The pomegranate: a body, a crown of four points, and a stub of stem. It
 * empowers a boon already held, so it is the one emblem that is a *fruit* and
 * not an implement — which is exactly how it reads next to the hammer.
 */
const pomParts = () => {
  const parts = [ball(0.42, 0, -0.06, 0), box(0.13, 0.2, 0.13, 0, 0.42, 0)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(
      box(0.1, 0.26, 0.1, Math.cos(a) * 0.15, 0.4, Math.sin(a) * 0.15, Math.cos(a) * 0.5)
    );
  }
  return parts;
};

/** The slab a sigil is cut into. Rounded by a bevel box rather than a shape. */
const stoneParts = (w: number, h: number) => [
  box(w, h, 0.16, 0, 0, -0.16),
  box(w + 0.14, h - 0.16, 0.1, 0, 0, -0.16),
  box(w - 0.16, h + 0.14, 0.1, 0, 0, -0.16),
];

// ------------------------------------------------------------------ assembly

function merge(parts: THREE.BufferGeometry[]) {
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!geo) throw new Error('emblem: nothing to merge');
  return geo;
}

/**
 * Build the emblem for a reward.
 *
 * `numeral` is only read for a boon, and it is passed in rather than looked up
 * so this file never reaches into the game layer for anything but a type.
 */
export function makeEmblem(kind: RewardKind, numeral = 'I'): Emblem {
  const sigil =
    kind === 'boon'
      ? numeralBars(numeral)
      : kind === 'hammer'
        ? hammerParts()
        : kind === 'vitality'
          ? heartParts()
          : pomParts();

  // Sized off what it has to hold: a VII is far wider than a heart, and one
  // slab for all four would either crop the numeral or float around the fruit.
  const bounds = new THREE.Box3();
  for (const p of sigil) {
    p.computeBoundingBox();
    bounds.union(p.boundingBox!);
  }
  const size = new THREE.Vector3();
  bounds.getSize(size);

  const stoneGeo = merge(stoneParts(size.x + 0.46, size.y + 0.42));
  const sigilGeo = merge(sigil);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: STONE,
    roughness: 0.86,
    metalness: 0.05,
  });
  // Basic, not standard: the arena is a dark room and this is the one part that
  // has to be legible from across it, so it lights itself. It is also why the
  // stone behind it is worth having — see the note at the top.
  const sigilMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(stoneGeo, stoneMat), new THREE.Mesh(sigilGeo, sigilMat));

  return {
    group,
    tint(color) {
      sigilMat.color.copy(color);
    },
    dispose() {
      stoneGeo.dispose();
      sigilGeo.dispose();
      stoneMat.dispose();
      sigilMat.dispose();
      group.clear();
    },
  };
}
