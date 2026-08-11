# Model pipeline

Every `.glb` in `public/models` goes through `prep_model.py` before it ships.
This file is why, and what the numbers mean.

## Budgets

| Role | Triangles | Bytes | Notes |
| --- | --- | --- | --- |
| `common` | 2 000 | 150 kB | arrives in crowds |
| `elite` | 4 000 | 300 kB | |
| `boss` | 20 000 | 600 kB | one body, most-looked-at |
| `prop` | 8 000 | 300 kB | pillars, gates, braziers |
| `player` | 2 000 | 200 kB | on screen every frame |

Two multipliers make these tighter than they look:

- `addOutline()` clones every mesh into an inverted hull, so the **on-screen
  cost is 2×** the count in Blender.
- The whole model set currently fits in **0.88 MB**. That is the number to
  protect — `loadModel` fetches on demand, mid-run, and there is no preload, so
  a fat asset is a stall in the middle of a fight on a phone.

Roles are assigned per file in the `ROLE` table in `glb-info.mjs`, deliberately
by hand: the moment it guesses from a filename, a boss-sized common walks past.

## Running it

Blender from the Windows Store cannot be launched from a shell — `WindowsApps`
is ACL-locked — so the working route here is to run it *inside* Blender, from
the Text Editor or over the MCP bridge:

```python
exec(open(r"tools/prep_model.py", encoding="utf-8").read())
prep(r"raw/minotaur.glb", r"public/models/minotaur.glb", budget="boss", name="Minotaur")
```

With a normal Blender install it is also a one-liner:

```bash
blender --background --python tools/prep_model.py -- raw/minotaur.glb public/models/minotaur.glb --budget boss
```

Then check what came out:

```bash
npm run models
```

`npm run models:check` is the same report with a non-zero exit on any violation,
and runs as part of `npm run build`.

## What the pipeline does, and why each step is gated

**Weld.** Exporters routinely split every vertex three ways to carry flat
normals. That alone took `minotaur.glb` to 45 MB, and a split vertex is a seam
the collapse decimator refuses to cross — so the budget is unreachable until
this runs. `v/t` in the report is the tell: a welded closed mesh sits near 0.5,
UV and material seams push it up legitimately, **3.0 means fully split**.

**Remesh — only when the topology is broken.** Voxel remesh throws away whatever
topology the mesh had, so it is gated on measurement: it runs only above 2%
non-manifold edges. A clean sculpt skips it and keeps its own surface. The raw
minotaur had **43 227 non-manifold edges and 89 loose shells**, which is why
plain decimation plateaued at 108 k triangles no matter what ratio it was given.
Voxel size is `max_dimension / 240`, so it is resolution-independent — fine
enough to keep horn tips and an axe blade.

**Decimate, symmetrically.** `use_symmetry` on the X axis, because a humanoid
decimated asymmetrically reads as damaged: one horn holds its silhouette while
the other goes faceted, and the eye catches that long before it counts
triangles. It also happens to produce a cleaner result — the symmetric pass left
**zero** non-manifold edges where an asymmetric one left 240.

**Smooth by angle, not flat smooth.** `shade_smooth_by_angle(30°)` keeps plate
armour and blade edges crisp. It costs roughly 15% more vertices than blanket
smoothing (split normals at the hard edges) — 419 kB against 365 kB on the
minotaur — and it is worth every byte; blanket smoothing turns the axe into
soap.

**Strip what nothing reads.** No UVs and no materials by default:

- `loadModel` re-materials everything so lighting stays consistent with the
  room, and every shipped `.glb` has **zero embedded images**, so UVs are pure
  wire weight until something samples one.
- The exception is a model whose *material names carry meaning* — `warrior.glb`
  tints whichever material matches `/crest/i` to the player's seat colour.
  Export that one with `keep_materials=True` or the seat colours are lost.

Multi-part rigs are never joined. `warrior.glb` is seven named nodes (`LegL`,
`ArmR`, `Pelvis`, …) that `Player.animateBody()` drives **by name**; joining
them would silently break every lookup. The budget is split across the parts.

## Keeping the raws

The pipeline is destructive and one-way, so the high-poly source is the only way
to re-run it at a different budget later. Those files are 10–50 MB each — do not
commit them to git as-is. Either keep them outside the repo, or set up git-lfs
for an `assets-src/raw/` directory first.

## Scale is not set here

`fitToHeight` rescales every model to a height the game picks, then grounds it —
`2.2` for the minotaur, times the archetype's `scale: 2.0`, so 4.4 units against
the player's 2.1. **Resizing in Blender changes nothing in game.** Size lives in
`enemy.ts`, not in the file.
