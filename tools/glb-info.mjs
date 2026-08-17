/**
 * Report on the shipped .glb files, and fail a build that regresses one.
 *
 *   node tools/glb-info.mjs            # table of everything in public/models
 *   node tools/glb-info.mjs --check    # same, but exits 1 on a violation
 *   node tools/glb-info.mjs foo.glb    # one file, full detail
 *
 * No dependencies: a GLB is a 12-byte header followed by a JSON chunk, and
 * everything worth knowing before a model ships is in that JSON.
 */

import fs from 'fs';
import path from 'path';

const MODELS = 'public/models';

/**
 * Triangle ceiling per file, matching BUDGETS in prep_model.py. Kept as data
 * rather than inferred from the filename so adding a model is a deliberate line
 * in a diff — the moment this guesses, a boss-sized common walks straight past.
 */
const ROLE = {
  'minotaur.glb': { role: 'boss' },
  'boss.glb': { role: 'boss' },
  'vampire.glb': { role: 'common' },
  'tartarus_beast.glb': { role: 'common' },
  // The brute is the heavy, not the crowd — it arrives one or two at a time
  // behind a wave of wretches, so it buys the elite budget rather than the
  // common one it would otherwise share with them.
  'tartarus_hoplit.glb': { role: 'elite' },
  'mage.glb': { role: 'player' },
  'archer.glb': { role: 'player' },
  'pillar.glb': { role: 'prop' },
  'portal.glb': { role: 'prop' },
  'gate.glb': { role: 'prop' },
  'brazier.glb': { role: 'prop' },

  // Hand-authored, and older than this rule. Its body sits 11% of its footprint
  // off centre, which is 0.12 game units against a 0.55 collision radius —
  // measurable, not visible. Re-placing it means re-exporting a seven-node rig
  // whose node *and* material names the animation and tint code look up by
  // string, so it is left alone deliberately rather than by omission.
  'warrior.glb': { role: 'player', pivot: 'authored' },

  // The pivot is the grip: player.ts parents it at (0.55, 0, 0) under the swing
  // pivot, and it never goes through fitToHeight. Same for the bow, pivoted on
  // its riser, and the grimoire, pivoted on its spine — both authored in game
  // units by tools/build_shades.py, so their size here is their size on screen.
  'warrior_sword.glb': { role: 'player', pivot: 'authored' },
  'archer_bow.glb': { role: 'player', pivot: 'authored' },
  'mage_book.glb': { role: 'player', pivot: 'authored' },
};

/*
 * `player` was 2000, anchored on warrior.glb being 1404 — one hand-authored,
 * deliberately blocky rig, which is not a constraint, just a sample. Measured
 * against the actual scene it was far too tight: a built chamber already draws
 * 118k triangles, 85k of it scenery (eight columns at 7.6k, three portals at
 * 8k). Four heroes at 8k, outline shells included, is 64k — less than the room
 * they stand in. The warrior stays well under either way.
 */
const BUDGET = { common: 2000, elite: 4000, boss: 20000, prop: 8000, player: 16000 };

/** Bytes on the wire. A phone on mobile data pays for every one of them. */
const SIZE_BUDGET = { common: 150e3, elite: 300e3, boss: 600e3, prop: 300e3, player: 500e3 };

/**
 * Primitives per file — the budget nobody was keeping, and the one that
 * actually costs.
 *
 * Triangles are close to free: four players at the raised budget draw 160k
 * against a chamber's 85k of scenery, and no GPU made this decade cares. Draw
 * calls are not. three.js batches nothing, so every primitive is its own call,
 * `addOutline` clones each into a second, and the shadow pass draws both again
 * — one mesh is three calls before anything moves. A model splits into a
 * primitive per material per node, so this is really a ceiling on
 * materials times joints, which is exactly the pair that grows when a rig gets
 * articulated. Watch it when adding either.
 */
const PRIM_BUDGET = { common: 8, elite: 12, boss: 24, prop: 12, player: 36 };

/**
 * Vertices per triangle. A welded closed mesh sits near 0.5; UV and material
 * seams push it up legitimately. 3.0 means every vertex was split per face,
 * which is what took minotaur.glb to 45MB at no visual gain whatsoever.
 */
const SPLIT_RATIO = 2.5;

/** Column-major 4x4 multiply, matching glTF's own convention. */
function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  // Quaternion to basis, scaled per column.
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

const apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

/**
 * World-space bounds, walking the node hierarchy.
 *
 * Mesh-space min/max alone is not enough: a generated model routinely carries
 * its offset on the node instead of in the vertices, and that offset is exactly
 * what puts an actor's body beside its own hitbox. See the pivot check below.
 */
function worldBounds(json) {
  const acc = json.accessors ?? [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const visit = (idx, parent) => {
    const n = json.nodes[idx];
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh != null) {
      for (const p of json.meshes[n.mesh].primitives) {
        const a = acc[p.attributes.POSITION];
        if (!a?.min) continue;
        // Every corner: a rotated node makes the axis-aligned extremes useless.
        for (let i = 0; i < 8; i++) {
          const w = apply(m, [
            i & 1 ? a.max[0] : a.min[0],
            i & 2 ? a.max[1] : a.min[1],
            i & 4 ? a.max[2] : a.min[2],
          ]);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], w[k]);
            max[k] = Math.max(max[k], w[k]);
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes?.[json.scene ?? 0];
  for (const r of scene?.nodes ?? json.nodes.map((_, i) => i)) visit(r, identity);
  return { min, max };
}

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

  const acc = json.accessors ?? [];
  let tris = 0;
  let verts = 0;
  let prims = 0;
  const attrs = new Set();
  for (const mesh of json.meshes ?? []) {
    prims += mesh.primitives.length;
    for (const p of mesh.primitives) {
      if (p.indices != null) tris += acc[p.indices].count / 3;
      else if (p.attributes.POSITION != null) tris += acc[p.attributes.POSITION].count / 3;
      if (p.attributes.POSITION != null) verts += acc[p.attributes.POSITION].count;
      for (const a of Object.keys(p.attributes)) attrs.add(a);
    }
  }

  const { min, max } = worldBounds(json);

  return {
    pivot: {
      // Offset of the body from the origin it will rotate around, as a share of
      // its own footprint, plus how far the feet float above or sink below y=0.
      x: (min[0] + max[0]) / 2 / (max[0] - min[0] || 1),
      z: (min[2] + max[2]) / 2 / (max[2] - min[2] || 1),
      floor: min[1] / (max[1] - min[1] || 1),
    },
    file,
    bytes: buf.length,
    tris,
    verts,
    prims,
    meshes: (json.meshes ?? []).length,
    nodes: (json.nodes ?? []).map((n) => n.name).filter(Boolean),
    images: (json.images ?? []).length,
    materials: (json.materials ?? []).map((m) => m.name),
    attrs: [...attrs],
    size: min.map((v, i) => +(max[i] - v).toFixed(3)),
  };
}

/** Every way a model can be wrong, in the order a reader cares about. */
function violations(info, entry) {
  const out = [];
  const role = entry?.role;
  const tris = BUDGET[role];
  const bytes = SIZE_BUDGET[role];
  if (role && info.tris > tris) out.push(`${info.tris} tris over the ${role} budget of ${tris}`);
  if (role && info.bytes > bytes)
    out.push(`${(info.bytes / 1e3).toFixed(0)}kB over the ${role} budget of ${(bytes / 1e3).toFixed(0)}kB`);
  if (role && info.prims > PRIM_BUDGET[role])
    out.push(
      `${info.prims} primitives over the ${role} budget of ${PRIM_BUDGET[role]} — each one is a draw call, doubled by the outline and drawn again for shadows`
    );
  if (info.verts / info.tris > SPLIT_RATIO)
    out.push(
      `${(info.verts / info.tris).toFixed(2)} verts per tri — vertices are split, weld before exporting`
    );
  if (!info.attrs.includes('NORMAL'))
    out.push('no NORMAL attribute — the loader derives them, but flat, so authored smoothing is lost');
  if (info.images > 0 && !info.attrs.includes('TEXCOORD_0'))
    out.push(`${info.images} embedded image(s) with no UVs to sample them — dead weight`);

  // fitToHeight grounds every model it touches, so height needs no check here.
  // What it never corrects is X/Z, and that offset rides into the game
  // multiplied by the archetype's scale: the actor rotates around a point beside
  // itself while its hitbox stays on the pivot. The generated minotaur arrived
  // 25% off, which was half a collision radius.
  const off = Math.max(Math.abs(info.pivot.x), Math.abs(info.pivot.z));
  if (entry?.pivot !== 'authored' && off > 0.05)
    out.push(
      `pivot is ${(off * 100).toFixed(0)}% of the footprint off centre — re-export with place=True`
    );
  return out;
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const explicit = args.filter((a) => !a.startsWith('--'));

const files = explicit.length
  ? explicit
  : fs
      .readdirSync(MODELS)
      .filter((f) => f.endsWith('.glb'))
      .map((f) => path.join(MODELS, f));

let failed = 0;
let totalBytes = 0;
let totalTris = 0;
const rows = [];

for (const f of files) {
  const info = readGlb(f);
  const entry = ROLE[path.basename(f)];
  const bad = violations(info, entry);
  totalBytes += info.bytes;
  totalTris += info.tris;
  if (bad.length) failed++;

  rows.push({
    model: path.basename(f),
    role: entry?.role ?? '—',
    tris: info.tris,
    'v/t': +(info.verts / info.tris).toFixed(2),
    prims: info.prims,
    kB: +(info.bytes / 1e3).toFixed(0),
    pivot: `${(info.pivot.x * 100).toFixed(0)},${(info.pivot.z * 100).toFixed(0)}%`,
    attrs: info.attrs.map((a) => a.replace('TEXCOORD_0', 'UV').replace('POSITION', 'POS')).join('+'),
    ok: bad.length ? 'FAIL' : 'ok',
  });

  if (explicit.length) console.log(JSON.stringify(info, null, 1));
  for (const b of bad) console.error(`  ${path.basename(f)}: ${b}`);
}

console.table(rows);
console.log(
  `${files.length} models · ${totalTris.toLocaleString()} tris · ${(totalBytes / 1e6).toFixed(2)} MB total`
);

if (check && failed) {
  console.error(`\n${failed} model(s) outside budget. See tools/MODELS.md.`);
  process.exit(1);
}
