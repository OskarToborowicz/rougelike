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
  'minotaur.glb': 'boss',
  'boss.glb': 'boss',
  'warrior.glb': 'player',
  'warrior_sword.glb': 'player',
  'pillar.glb': 'prop',
  'gate.glb': 'prop',
  'brazier.glb': 'prop',
};

const BUDGET = { common: 2000, elite: 4000, boss: 20000, prop: 8000, player: 2000 };

/** Bytes on the wire. A phone on mobile data pays for every one of them. */
const SIZE_BUDGET = { common: 150e3, elite: 300e3, boss: 600e3, prop: 300e3, player: 200e3 };

/**
 * Vertices per triangle. A welded closed mesh sits near 0.5; UV and material
 * seams push it up legitimately. 3.0 means every vertex was split per face,
 * which is what took minotaur.glb to 45MB at no visual gain whatsoever.
 */
const SPLIT_RATIO = 2.5;

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

  const acc = json.accessors ?? [];
  let tris = 0;
  let verts = 0;
  const attrs = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      if (p.indices != null) tris += acc[p.indices].count / 3;
      else if (p.attributes.POSITION != null) tris += acc[p.attributes.POSITION].count / 3;
      if (p.attributes.POSITION != null) verts += acc[p.attributes.POSITION].count;
      for (const a of Object.keys(p.attributes)) attrs.add(a);
    }
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      const a = acc[p.attributes.POSITION];
      if (!a?.min) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min[i]);
        max[i] = Math.max(max[i], a.max[i]);
      }
    }
  }

  return {
    file,
    bytes: buf.length,
    tris,
    verts,
    meshes: (json.meshes ?? []).length,
    nodes: (json.nodes ?? []).map((n) => n.name).filter(Boolean),
    images: (json.images ?? []).length,
    materials: (json.materials ?? []).map((m) => m.name),
    attrs: [...attrs],
    size: min.map((v, i) => +(max[i] - v).toFixed(3)),
  };
}

/** Every way a model can be wrong, in the order a reader cares about. */
function violations(info, role) {
  const out = [];
  const tris = BUDGET[role];
  const bytes = SIZE_BUDGET[role];
  if (role && info.tris > tris) out.push(`${info.tris} tris over the ${role} budget of ${tris}`);
  if (role && info.bytes > bytes)
    out.push(`${(info.bytes / 1e3).toFixed(0)}kB over the ${role} budget of ${(bytes / 1e3).toFixed(0)}kB`);
  if (info.verts / info.tris > SPLIT_RATIO)
    out.push(
      `${(info.verts / info.tris).toFixed(2)} verts per tri — vertices are split, weld before exporting`
    );
  if (!info.attrs.includes('NORMAL'))
    out.push('no NORMAL attribute — the loader derives them, but flat, so authored smoothing is lost');
  if (info.images > 0 && !info.attrs.includes('TEXCOORD_0'))
    out.push(`${info.images} embedded image(s) with no UVs to sample them — dead weight`);
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
  const role = ROLE[path.basename(f)];
  const bad = violations(info, role);
  totalBytes += info.bytes;
  totalTris += info.tris;
  if (bad.length) failed++;

  rows.push({
    model: path.basename(f),
    role: role ?? '—',
    tris: info.tris,
    'v/t': +(info.verts / info.tris).toFixed(2),
    kB: +(info.bytes / 1e3).toFixed(0),
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
