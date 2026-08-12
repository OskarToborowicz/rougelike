# Model pipeline

Every `.glb` in `public/models` goes through `prep_model.py` before it ships.
This file is why, and what the numbers mean.

## From ComfyUI to the arena

1. **Generate.** Export `.glb` from the ComfyUI 3D node. Do not bother reducing
   polygons there — this pipeline does it better, and a generator's own decimate
   usually leaves the topology worse than the one it started with.
2. **Keep the raw file** somewhere outside the repo. The pipeline is destructive
   and one-way; the raw is the only way to re-run at a different budget.
3. **Prep it:**
   ```python
   exec(open(r"tools/prep_model.py", encoding="utf-8").read())
   prep(r"raw/wretch.glb", r"public/models/wretch.glb", budget="common", name="Wretch")
   ```
4. **Check the facing.** Look at it in Blender's front view (Numpad 1). The model
   must face *you*. If it does not, re-run with `face=90` / `180` / `-90` — the
   game writes `mesh.rotation.y` every frame, so a rotation left on the node
   would be overwritten and the model would moonwalk.
5. **Register it** in the `ROLE` table in `glb-info.mjs`, then `npm run models`.
6. **Wire it up** in `AUTHORED` in `enemy.ts` with the height you want.

What a generator gets wrong, every time, and what handles it:

| Symptom | Handled by |
| --- | --- |
| 500 k triangles | decimate to the role's budget |
| 30 k non-manifold edges, dozens of loose shells | voxel remesh, gated on measurement |
| every vertex split three ways, 45 MB | weld |
| body sitting off its own pivot | `_place` — see below |
| vertex colours or a baked texture | stripped; the game re-materials everything |
| arbitrary facing | `face=` degrees |
| arbitrary scale | nothing — `fitToHeight` owns scale at runtime |

**Colour does not survive.** Whatever the generator painted is thrown away:
`loadModel` re-materials every mesh so lighting matches the room, and the
archetype's `color` / `trim` in `enemy.ts` is what you will actually see. Judge a
generation on its silhouette, not its texture.

## Budgets

| Role | Triangles | Bytes | Notes |
| --- | --- | --- | --- |
| `common` | 2 000 | 150 kB | arrives in crowds |
| `elite` | 4 000 | 300 kB | |
| `boss` | 20 000 | 600 kB | one body, most-looked-at |
| `prop` | 8 000 | 300 kB | pillars, gates, braziers |
| `player` | 8 000 | 300 kB | on screen every frame, up to four |

Two multipliers make these tighter than they look:

- `addOutline()` clones every mesh into an inverted hull, so the **on-screen
  cost is 2×** the count in Blender.
`player` started at 2 000, anchored on `warrior.glb` being 1 404 — which is one
hand-authored, deliberately blocky rig, not a measurement. A built chamber draws
**118k triangles, 85k of it scenery** (eight columns at 7.6k, three portals at
8k), so four sculpted heroes at 8k — outline shells included, 64k — cost less
than the room they stand in. Anchor a budget on what the frame actually spends,
not on the smallest asset that happens to exist.

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

**Place it on its own pivot.** Centred on X/Z, feet on the floor plane, facing
-Y. `fitToHeight` corrects height and *nothing else*, so an off-centre pivot
rides into the game multiplied by the archetype's scale: the actor rotates
around a point beside itself while its hitbox stays where the pivot is. The
generated minotaur arrived 0.25 units off in depth — 0.56 game units after
scaling, against a collision radius of 1.15. `npm run models` prints the offset
as a share of the model's own footprint and fails above 5%.

Two files are exempt by hand in the `ROLE` table, because their pivots are
authored deliberately: `warrior_sword.glb` pivots on its grip, and `warrior.glb`
is an older hand-built rig whose 11% offset is 0.12 units against a 0.55 radius
— measurable, not visible, and not worth re-exporting a seven-node rig that the
animation and tint code looks up by string.

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
