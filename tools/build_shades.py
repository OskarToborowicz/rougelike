"""
Author the two shades that were never sculpted: the marksman and the sorceress.

Everything else in `public/models` comes out of a generator and through
`prep_model.py`. These two do not: they are built here from primitives, the way
`warrior.glb` was, because a generated sculpt arrives as one nameless blob and
the game animates *named nodes*. `prep_model.py` can cut that blob into seven
parts by measuring where the geometry sits, but a guessed cut puts the shoulder
joint wherever the plane happened to land. Building the parts means the pivot is
the joint, not an estimate of it, and re-running with a different silhouette
costs one edit instead of one generation.

Run it inside Blender — from the Text Editor or over the MCP bridge:

    exec(open(r"tools/build_shades.py", encoding="utf-8").read())
    build_all(r"E:/nowy poczatek/rougelike/public/models")

What comes out, and the contract each file has to keep:

  archer.glb     nodes named for RIG_JOINTS in player.ts; -Y is front; feet on
  mage.glb       Z=0; centred on X/Y. The marksman has seven. The sorceress has
                 twelve — she is armoured rather than robed, so there is no hem
                 to hide a stride behind and she takes the elbows, the knees,
                 and `Cape` for the hair.
  archer_bow.glb the weapon, pivoted on the grip and *never* fitToHeight'd:
  mage_book.glb  player.ts parents it at (0.55, 0, 0) under the swing pivot, in
                 game units, so its size here is its size on screen.

Materials survive on purpose. `loadAuthoredRig` clones whatever the file brings
and only repaints the one matching /crest/i with the seat colour, so the palette
below is what you will actually see — dark leather and aged gold, with one piece
per shade carrying the player's colour: the archer's shoulder mantle, and the
sorceress' chest plate and pauldrons. Those are chosen for what a camera 52
degrees up can see, which is the top of a shoulder and nothing below the belt.
"""

import math
import os

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

TAU = math.tau

# ------------------------------------------------------------------- palette
#
# Dark sacral: near-black cloth and leather, one metal, one skin tone, and the
# gold kept for the few pieces that are meant to read as reliquary rather than
# kit — the brooch, the belt disc, the clasps on the book. More gold than that
# and the silhouette turns into jewellery.
BASE_PALETTE = {
    "Leather": ((0.055, 0.043, 0.038), 0.78, 0.0),
    "Cloth": ((0.031, 0.030, 0.038), 0.94, 0.0),
    "Gold": ((0.44, 0.32, 0.13), 0.34, 0.85),
    "Iron": ((0.055, 0.055, 0.062), 0.46, 0.75),
    "Skin": ((0.60, 0.44, 0.34), 0.66, 0.0),
    "Hair": ((0.16, 0.11, 0.07), 0.82, 0.0),
    "Wood": ((0.085, 0.056, 0.038), 0.72, 0.0),
    "Page": ((0.42, 0.38, 0.31), 0.88, 0.0),
    # Not black. A true black eye against dark skin under a dark fringe is one
    # unreadable smudge; a cold near-black separates from the Hair beside it.
    "Eye": ((0.028, 0.026, 0.040), 0.55, 0.0),
    "Lip": ((0.190, 0.088, 0.084), 0.66, 0.0),
    # Repainted per seat at load. The values here are only what a lone shade
    # wears in a screenshot; roughness and metalness are what survive.
    "Crest": ((0.14, 0.11, 0.16), 0.88, 0.02),
}

# Per-shade overrides, because these two are not the same person.
#
# Values here are **linear**, which is why they look impossibly dark written
# down: glTF carries a base colour factor and three uses it as linear light, so
# 0.30 in this table is roughly #9a in a screenshot. The first sorceress was
# authored at the archer's 0.60 skin and 0.16 hair, and in the arena — lit by a
# warm orange key that multiplies every one of these — she came out a pale
# ginger woman in an orange breastplate. She is black-haired and fair-skinned,
# and neither of those survives being borrowed from him, so both are hers alone.
#
# Judge them against the *game's* light, not a neutral preview: everything here
# gets multiplied by an orange lamp before anyone sees it, so a skin tone that
# looks correct in Blender arrives one step redder and one step lighter.
SHADE_PALETTE = {
    "mage": {
        # Black, with just enough warmth left to separate from the cold near-
        # black of the eye beside it.
        "Hair": ((0.020, 0.017, 0.015), 0.84, 0.0),
        # Fair, and deliberately desaturated rather than simply bright. Half of
        # her is bare, so this is the largest single area of colour on the model
        # and the tone the whole figure is read as — and it is read under an
        # orange key that adds its own warmth. Authored with the pink left in,
        # a fair skin arrives in the arena as salmon.
        "Skin": ((0.620, 0.500, 0.445), 0.66, 0.0),
    },
}

PALETTE = dict(BASE_PALETTE)


def palette(shade=None):
    """
    Make one shade's palette the active one. Call before building that shade.

    Safe to call in any order because `clear()` removes the materials between
    builds, so each file is exported with the values that were live when its
    meshes were made — there is no way for the archer to inherit the sorceress'
    skin short of building both without clearing.
    """
    PALETTE.clear()
    PALETTE.update(BASE_PALETTE)
    PALETTE.update(SHADE_PALETTE.get(shade, {}))


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    color, rough, metal = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    # Solid-shading colour. The exporter reads the node, the viewport reads
    # this, and leaving it at the default is why a preview comes back as grey
    # clay no matter what the palette says.
    m.diffuse_color = (*color, 1.0)
    m.roughness = rough
    m.metallic = metal
    return m


def emissive(name, color, strength=2.4):
    """A material that keeps glowing in game — only ever on a held weapon.

    The hit flash writes `emissive` on every body material each frame, so glow
    authored into a *body* is overwritten before it is ever seen. Weapon
    materials are not in that list, which is why the runes live on the book.
    """
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.4
    bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
    bsdf.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*color, 1.0)
    return m


# ------------------------------------------------------------------ geometry
#
# Every generator returns a bare (verts, faces) pair in world space. Winding is
# not tracked: each chunk is a closed shape and `Part.build` recalculates
# normals over the finished mesh, which is both shorter and harder to get wrong
# than threading orientation through a dozen loops.


def _pw(v, e):
    """Signed power, so a cross-section can be squared off without folding."""
    return math.copysign(abs(v) ** e, v)


def ring(z, rx, ry, n, cx=0.0, cy=0.0, e=2.0, phase=0.0, flute=None):
    """
    One cross-section. `e` above 2 squares it off — plate, not sausage.

    `flute=(count, depth)` ripples the radius around the axis. It is the whole
    difference between a robe and a traffic cone: a smooth cone of a skirt reads
    as a solid, and vertical folds are what say cloth at a distance where no
    texture survives.
    """
    k = 2.0 / e
    out = []
    for i in range(n):
        a = phase + TAU * i / n
        f = 1.0 + flute[1] * math.cos(flute[0] * a) if flute else 1.0
        out.append(
            Vector((cx + rx * f * _pw(math.cos(a), k), cy + ry * f * _pw(math.sin(a), k), z))
        )
    return out


def loft(rings, cap_lo=True, cap_hi=True):
    """Stitch equal-length cross-sections into a tube."""
    verts = [v for r in rings for v in r]
    n = len(rings[0])
    faces = []
    for s in range(len(rings) - 1):
        a, b = s * n, (s + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
    if cap_lo:
        faces.append(tuple(range(n)))
    if cap_hi:
        faces.append(tuple(range(len(verts) - n, len(verts))))
    return verts, faces


def column(profile, n=12, e=2.0, cap_lo=True, cap_hi=True, flute=None):
    """A stack of (z, cx, cy, rx, ry) — the workhorse for torsos and limbs."""
    return loft(
        [ring(z, rx, ry, n, cx, cy, e, flute=flute) for (z, cx, cy, rx, ry) in profile],
        cap_lo,
        cap_hi,
    )


def sweep(path, radii, n=8, e=2.0, up=Vector((0.0, 0.0, 1.0))):
    """
    A tube along an arbitrary path — arms, arrow shafts, hair, bow limbs.

    Frames come off the tangent rather than being carried along the curve, which
    would need a rotation-minimising frame; nothing here twists enough to notice
    and the local basis is one cross product.
    """
    pts = [Vector(p) for p in path]
    rings = []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        t = (b - a)
        if t.length < 1e-9:
            t = Vector((0, 0, 1))
        t.normalize()
        ref = up if abs(t.dot(up)) < 0.95 else Vector((0.0, 1.0, 0.0))
        side = t.cross(ref)
        side.normalize()
        vert = side.cross(t)
        rx, ry = radii[i] if isinstance(radii[i], (tuple, list)) else (radii[i],) * 2
        k = 2.0 / e
        rings.append(
            [
                p
                + side * (rx * _pw(math.cos(TAU * j / n), k))
                + vert * (ry * _pw(math.sin(TAU * j / n), k))
                for j in range(n)
            ]
        )
    return loft(rings)


def blob(center, radii, n=14, m=8):
    """A squashed sphere. Skulls, shoulders, hands, the sorceress' bun."""
    cx, cy, cz = center
    rx, ry, rz = radii
    verts = [Vector((cx, cy, cz + rz))]
    for i in range(1, m):
        phi = math.pi * i / m
        sz, sr = math.cos(phi), math.sin(phi)
        for j in range(n):
            a = TAU * j / n
            verts.append(
                Vector((cx + rx * sr * math.cos(a), cy + ry * sr * math.sin(a), cz + rz * sz))
            )
    verts.append(Vector((cx, cy, cz - rz)))

    faces = []
    for j in range(n):
        faces.append((0, 1 + j, 1 + (j + 1) % n))
    for i in range(m - 2):
        a, b = 1 + i * n, 1 + (i + 1) * n
        for j in range(n):
            k = (j + 1) % n
            faces.append((a + j, b + j, b + k, a + k))
    last = 1 + (m - 2) * n
    tip = len(verts) - 1
    for j in range(n):
        faces.append((tip, last + (j + 1) % n, last + j))
    return verts, faces


def shell(zs, a0, a1, rfun, na=14, t=0.035, yfun=None, zfun=None):
    """
    A cloak: an arc of surface wrapped around the body axis, given thickness.

    Angles are measured with 0 pointing -Y — the direction the model faces — and
    growing toward +X, so a cape over the back is roughly `0.42*pi` to
    `1.58*pi`. Thickness is offset radially rather than along a computed normal:
    the surface is already a function of the axis, so the two are the same thing
    and the radial version cannot fold at a crease.

    `zfun(u, a)` warps the level heights. A cape whose rows are all flat is a
    plank from the side no matter what the radius does; lifting the hem at the
    front edges and letting it dip at the back is the difference between cloth
    and a signboard.
    """
    nz = len(zs)
    outer, inner = [], []
    for iz, z in enumerate(zs):
        u = iz / (nz - 1)
        y0 = yfun(u) if yfun else 0.0
        for j in range(na):
            a = a0 + (a1 - a0) * (j / (na - 1))
            r = rfun(u, a)
            zz = z + (zfun(u, a) if zfun else 0.0)
            outer.append(Vector(((r + t / 2) * math.sin(a), y0 - (r + t / 2) * math.cos(a), zz)))
            inner.append(Vector(((r - t / 2) * math.sin(a), y0 - (r - t / 2) * math.cos(a), zz)))

    verts = outer + inner
    o = len(outer)
    idx = lambda i, j: i * na + j
    faces = []
    for i in range(nz - 1):
        for j in range(na - 1):
            faces.append((idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)))
            faces.append(
                (o + idx(i, j), o + idx(i + 1, j), o + idx(i + 1, j + 1), o + idx(i, j + 1))
            )
    # Close the four borders, or the outline shell inflates a surface with no
    # edge and the cape reads as a hole from behind.
    for j in range(na - 1):
        faces.append((idx(0, j), idx(0, j + 1), o + idx(0, j + 1), o + idx(0, j)))
        top = nz - 1
        faces.append((idx(top, j + 1), idx(top, j), o + idx(top, j), o + idx(top, j + 1)))
    for i in range(nz - 1):
        faces.append((idx(i, 0), o + idx(i, 0), o + idx(i + 1, 0), idx(i + 1, 0)))
        e = na - 1
        faces.append((idx(i + 1, e), o + idx(i + 1, e), o + idx(i, e), idx(i, e)))
    return verts, faces


def slab(center, size, rot=(0.0, 0.0, 0.0)):
    """An oriented box — straps, belt plates, book boards."""
    sx, sy, sz = (s / 2 for s in size)
    rmat = Euler(rot, "XYZ").to_matrix()
    verts = []
    for x in (-sx, sx):
        for y in (-sy, sy):
            for z in (-sz, sz):
                verts.append(Vector(center) + rmat @ Vector((x, y, z)))
    faces = [
        (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1),
        (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3),
    ]
    return verts, faces


def disc(center, r, thick, n=16, axis="y", inner=0.0):
    """A round plate — brooches, belt bosses, the halo motif on a buckle."""
    c = Vector(center)
    if axis == "y":
        u, v, w = Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))
    elif axis == "z":
        u, v, w = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    else:
        u, v, w = Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))
    rings = []
    for s in (-1, 1):
        rings.append(
            [c + w * (s * thick / 2) + u * (r * math.cos(TAU * i / n)) + v * (r * math.sin(TAU * i / n))
             for i in range(n)]
        )
    if inner:
        # A ring rather than a plate, so it can be a torc or a buckle frame.
        verts, faces = [], []
        for s in (-1, 1):
            for rr in (inner, r):
                verts += [
                    c + w * (s * thick / 2) + u * (rr * math.cos(TAU * i / n))
                    + v * (rr * math.sin(TAU * i / n))
                    for i in range(n)
                ]
        for q in range(4):
            a = q * n
            b = ((q + 1) % 4) * n
            for i in range(n):
                j = (i + 1) % n
                faces.append((a + i, a + j, b + j, b + i))
        return verts, faces
    return loft(rings)


def turn(geo, center, angle, axis="y"):
    """Rotate a chunk about its own centre. `blob` has no orientation of its own."""
    m = Matrix.Rotation(angle, 3, axis.upper())
    c = Vector(center)
    return [c + m @ (v - c) for v in geo[0]], geo[1]


def spike(base, tip, r, n=4, e=2.6):
    """
    A tapered point, four-sided by default.

    Six triangles' worth of geometry and the single most repeated shape on the
    sorceress — everything gold she wears is either one of these or four of them
    crossed. `n=4` is deliberate: a round spike at this size is a cone, and a
    cone catches light evenly, which is the opposite of what a faceted blade
    does. The tip is left a stub rather than a true point so the outline shell
    has something to inflate.
    """
    rr = r if isinstance(r, (tuple, list)) else (r, r)
    return sweep([Vector(base), Vector(tip)], [rr, (rr[0] * 0.07, rr[1] * 0.07)], n=n, e=e)


def star(part, mat, centre, normal, up=(0, 0, 1), arms=(0.040, 0.074, 0.030, 0.030), r=0.011):
    """
    The four-armed spike, laid flat against a surface.

    `arms` is (up, down, left, right) and they are unequal on purpose: the motif
    on the reference sheet is a cross whose lower blade runs about twice the
    length of the other three, and four equal arms read as a plus sign, which is
    a road sign rather than a reliquary. `normal` is the surface it lies on, so
    the whole ornament tilts with the plate under it.
    """
    c = Vector(centre)
    nz = Vector(normal).normalized()
    u = Vector(up) - nz * Vector(up).dot(nz)
    u.normalize()
    s = nz.cross(u)
    for d, length in ((u, arms[0]), (-u, arms[1]), (s, arms[2]), (-s, arms[3])):
        part.add(spike(c - d * 0.007 + nz * 0.004, c + d * length + nz * 0.004, r), mat)
    part.add(blob(c + nz * 0.010, (r * 1.6, r * 1.6, r * 1.6), n=6, m=4), mat)


def _surface(sphere):
    """y of an ellipsoid's front face at (x, z), plus an outward offset."""
    (cx, cy, cz), (rx, ry, rz) = sphere

    def on(x, z, out=0.0):
        u, w = (x - cx) / rx, (z - cz) / rz
        return cy - ry * math.sqrt(max(0.04, 1.0 - u * u - w * w)) - out

    return on


def profile_at(profile, z):
    """(cx, cy, rx, ry) of a `column` profile at height z, linearly interpolated."""
    p = sorted(profile, key=lambda r: r[0])
    lo = hi = p[0]
    t = 0.0
    if z >= p[-1][0]:
        lo = hi = p[-1]
    elif z > p[0][0]:
        for i in range(len(p) - 1):
            if p[i][0] <= z <= p[i + 1][0]:
                lo, hi = p[i], p[i + 1]
                t = (z - lo[0]) / (hi[0] - lo[0])
                break
    return tuple(lo[k] + (hi[k] - lo[k]) * t for k in (1, 2, 3, 4))


def on_column(profile, x, z, out=0.0, e=2.0):
    """
    y of a lofted body's front face at (x, z), plus an outward offset.

    `_surface` does this for a skull and it is why an eye cannot sink into a
    cheek. A body needs the same thing for a different reason: every gold spike
    on this shade is pinned to the plate it lies on, so moving the corset's
    waist in by a centimetre carries the whole chain down the sternum with it
    instead of leaving twelve ornaments hanging in the air. Solved against the
    same superellipse `ring` draws, not a circle, or the ornaments float off a
    squared-off section exactly where it is flattest — which is the front.
    """
    cx, cy, rx, ry = profile_at(profile, z)
    c = min(1.0, abs(x - cx) / rx) ** (e / 2.0)
    s = math.sqrt(max(0.0, 1.0 - c * c))
    return cy - ry * (s ** (2.0 / e)) - out


def face(part, skull, jaw, eyes, brows, nose, lips, lip_mat="Eye"):
    """
    Put a face on a skull.

    Every feature is placed *on an ellipsoid*, not at a guessed depth: given
    (x, z) the surface y is exact, so an eye sits proud of the cheek by the
    amount asked for and cannot sink into the head or float off it when the
    skull changes width. The mouth is measured against the **jaw** and not the
    cranium — they are different surfaces, and the jaw is the one in front at
    that height, so a lip placed on the skull is a lip inside the chin.

    Everything here is given in world Z rather than as offsets, because face
    proportions are read off the whole head: eyes at 45% of chin-to-crown, brow
    a thumb above them, the nose ending halfway from eye to chin. Offsets from
    a skull centre hide those relationships and every adjustment then has to be
    made twice.

    None of it survives at the game's camera — a head is eighteen pixels and an
    eye is two. It is here because a face that does not exist reads as a
    mannequin the instant anything gets close, and because a brow and two dark
    marks are what still carry an expression at the size where nothing else does.
    """
    on_skull, on_jaw = _surface(skull), _surface(jaw)

    eye_z, eye_dx, eye_r = eyes
    brow_z, brow_dx, brow_size, brow_tilt = brows
    for s in (-1, 1):
        # Set *into* the socket, showing about two millimetres of itself. Left
        # standing proud it is a glossy bean stuck to the cheek, which is the
        # single most doll-like thing a low-poly head can do.
        x = s * eye_dx
        part.add(blob((x, on_skull(x, eye_z, -0.008), eye_z), eye_r, n=10, m=6), "Eye")
        # A soft ridge rather than a plank, and tilted down toward the nose.
        # That tilt is the whole expression: level brows read as a doll, and
        # these are the only symmetric way to say the shade is looking at
        # something.
        bx = s * brow_dx
        bc = (bx, on_skull(bx, brow_z, -0.004), brow_z)
        part.add(turn(blob(bc, brow_size, n=10, m=6), bc, s * brow_tilt), "Hair")

    nose_z, nose_r = nose
    part.add(blob((0, on_skull(0, nose_z, -0.004), nose_z), nose_r, n=8, m=6), "Skin")
    lip_z, lip_r = lips
    part.add(blob((0, on_jaw(0, lip_z, -0.003), lip_z), lip_r, n=10, m=6), lip_mat)


# --------------------------------------------------------------------- parts


class Part:
    """
    One animated node: geometry, the joint it turns around, and its parent.

    The origin is the whole point. `animateBody` rotates these nodes and nothing
    else — no skinning, no bones — so an origin in the middle of a thigh makes
    the leg spin like a propeller instead of stepping.
    """

    def __init__(self, name, origin, parent=None):
        self.name = name
        self.origin = Vector(origin)
        self.parent = parent
        self.chunks = []

    def add(self, geo, mat):
        self.chunks.append((geo[0], geo[1], mat))
        return self

    def build(self):
        mats = []
        for _, _, m in self.chunks:
            if m not in mats:
                mats.append(m)

        verts, faces, midx = [], [], []
        for vs, fs, m in self.chunks:
            base = len(verts)
            verts += vs
            faces += [tuple(base + i for i in f) for f in fs]
            midx += [mats.index(m)] * len(fs)

        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in verts], [], faces)
        me.validate()
        for m in mats:
            me.materials.append(material(m) if m in PALETTE else bpy.data.materials[m])
        for poly, i in zip(me.polygons, midx):
            poly.material_index = i

        obj = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(obj)

        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.update()

        # Move the mesh under its own joint without moving it in the world.
        me.transform(Matrix.Translation(-self.origin))
        obj.location = self.origin
        self.obj = obj
        return obj


def centre(parts):
    """
    Slide the whole rig so its bounding box sits over the pivot it turns around.

    `fitToHeight` corrects height and nothing else, so any X/Y offset rides into
    the game multiplied by the archetype's scale and the shade ends up rotating
    around a point beside itself while its hitbox stays put. `npm run models`
    fails above 5% of the footprint, and a cape trailing half a metre behind is
    worth about 17% on its own.

    Only the root moves: every child's world transform is its own joint, taken
    through the parent inverse, so shifting the root carries the whole tree.
    """
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for p in parts:
        for v in p.obj.data.vertices:
            w = v.co + p.origin
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    delta = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    parts[0].obj.location = parts[0].origin + delta
    print(f"  centred by {tuple(round(v, 3) for v in delta)}, height {hi.z - lo.z:.3f}")
    return delta


def assemble(parts, root_name):
    """Build every part, nest them, and hand back the objects in export order."""
    objs = [p.build() for p in parts]
    by_name = {p.name: p for p in parts}
    for p in parts:
        if p.parent:
            p.obj.parent = by_name[p.parent].obj
            # Written from the parent's own joint rather than read back off its
            # matrix_world: nothing has evaluated the depsgraph yet, so that
            # matrix is still the identity and every child would inherit its
            # parent's offset a second time — the rig telescopes upward.
            p.obj.matrix_parent_inverse = Matrix.Translation(-by_name[p.parent].origin)
    for o in objs:
        shade(o)
    centre(parts)
    print(f"{root_name}: {sum(len(o.data.polygons) for o in objs)} faces over {len(objs)} nodes")
    return objs


def shade(obj):
    """Smooth by angle, so plate stays crisp and cloth does not facet."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(34))
    except Exception:
        bpy.ops.object.shade_smooth()


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


# -------------------------------------------------------------- the marksman
#
# From shade-archer.jpg: a wool cloak thrown over the shoulders and gathered at
# the chest under a sun-disc brooch, scaled leather beneath it, a wide belt on a
# second disc, and the quiver riding high on the right shoulder with the
# fletching clear of it. The arrows are the read. At a 40 degree camera a bow in
# the hand is a line and a cloak is a blob; six shafts standing above the
# shoulder are the one part of this figure nothing else in the game has.


def archer():
    """
    Twelve nodes, and the proportions of someone who draws a bow for a living.

    The first version was seven nodes and built like a man-at-arms — a barrel
    chest as wide as the hips, one-piece arms, one-piece legs. Two things were
    wrong with that. The silhouette said infantry, and infantry is what the
    warrior already is; a marksman has to read as *lighter* than the shade
    standing next to him, which at 115 pixels is entirely a matter of how wide
    the torso is against how long the legs are. And a limb of one piece cannot
    draw a bow. A draw is an elbow: the bow arm locks straight out while the
    string hand comes back past the jaw, and without a joint between the
    shoulder and the hand there is no pose to hold — only an arm raised, which
    is exactly what the old rig could do and the reason it looked like it.

    So: elbows and knees, the cloak on `Cape` where the game already damps a
    trailing node, and every radius pulled in. He stands 2.05 with a 0.196
    half-width at the chest against the sorceress' 0.176 and the old marksman's
    0.266.
    """
    palette("archer")
    H = 2.0
    parts = [
        Part("Pelvis", (0, 0, 0.980)),
        Part("Torso", (0, 0, 1.140), "Pelvis"),
        # The neck joint, which is where a head turns — not the middle of it.
        Part("Head", (0, 0, 1.700), "Torso"),
        # The cloak, on the node `animateBody` damps behind the body. On the
        # torso it was rigid cloth: it turned with the chest on the same frame,
        # which is the one thing cloth never does.
        Part("Cape", (0, 0.050, 1.620), "Torso"),
        Part("ArmL", (-0.238, 0, 1.505), "Torso"),
        Part("ArmR", (0.238, 0, 1.505), "Torso"),
        # Elbows. The origin is the joint, so the forearm folds around the point
        # the upper arm actually ends at — the whole reason these are authored
        # rather than cut out of a sculpt.
        Part("ForearmL", (-0.282, -0.010, 1.218), "ArmL"),
        Part("ForearmR", (0.282, -0.010, 1.218), "ArmR"),
        Part("LegL", (-0.112, 0, 0.955), "Pelvis"),
        Part("LegR", (0.112, 0, 0.955), "Pelvis"),
        Part("ShinL", (-0.118, 0.004, 0.520), "LegL"),
        Part("ShinR", (0.118, 0.004, 0.520), "LegR"),
    ]
    P = {p.name: p for p in parts}

    # ------------------------------------------------------------------- legs
    #
    # Long, and narrow through the thigh. The widest ring is at the hip and the
    # taper runs all the way to the knee without a bulge in it: this one is in
    # trousers and boots, so there is no calf to model, and a leg that swells in
    # the middle under cloth reads as padding rather than as muscle.
    for name, shin, s in (("LegL", "ShinL", -1), ("LegR", "ShinR", 1)):
        x = s * 0.112
        P[name].add(
            column(
                [
                    (0.505, x * 1.03, 0.004, 0.066, 0.074),
                    (0.620, x * 1.02, 0.002, 0.072, 0.080),
                    (0.780, x * 1.01, 0.000, 0.082, 0.089),
                    (0.900, x * 1.00, 0.000, 0.092, 0.098),
                    (0.995, x * 1.00, 0.000, 0.100, 0.104),
                ],
                n=12,
                e=2.3,
            ),
            "Leather",
        )
        # The knee belongs to the thigh and sits on the joint, so bending the
        # shin uncovers it instead of opening a gap behind it.
        P[name].add(blob((s * 0.118, 0.002, 0.520), (0.062, 0.064, 0.052), n=10, m=6), "Leather")

        k = s * 0.118
        P[shin].add(
            column(
                [
                    (0.150, k, -0.004, 0.055, 0.062),
                    (0.300, k, 0.004, 0.061, 0.068),
                    (0.420, k, 0.004, 0.063, 0.070),
                    (0.510, k, 0.004, 0.064, 0.072),
                ],
                n=12,
                e=2.3,
            ),
            "Leather",
        )
        # The boot. Longer than it is wide and carried forward of the ankle —
        # the single cheapest thing that keeps a leg from reading as a pipe, and
        # the only part of the lower body a top-down camera resolves at all.
        P[shin].add(
            column(
                [
                    (0.000, k, -0.048, 0.062, 0.128),
                    (0.055, k, -0.040, 0.070, 0.132),
                    (0.130, k, -0.010, 0.068, 0.086),
                    (0.190, k, -0.002, 0.064, 0.074),
                ],
                n=12,
                e=2.4,
            ),
            "Leather",
        )
        # Wrapped greave — a band, not a boot top, so the leg has a joint.
        P[shin].add(
            column([(0.195, k, -0.002, 0.068, 0.078), (0.300, k, 0.004, 0.070, 0.078)], n=12, e=2.3),
            "Cloth",
        )

    # ------------------------------------------------------------------- hips
    #
    # Narrow. A marksman reads off the ratio of shoulder to hip and of torso to
    # leg, and the belt is where both of those are decided.
    P["Pelvis"].add(
        column(
            [
                (0.860, 0, 0, 0.140, 0.108),
                (0.960, 0, 0, 0.158, 0.116),
                (1.060, 0, 0, 0.163, 0.120),
            ],
            n=14,
            e=2.5,
        ),
        "Leather",
    )
    P["Pelvis"].add(
        column([(1.010, 0, 0, 0.176, 0.132), (1.104, 0, 0, 0.172, 0.128)], n=14, e=2.5),
        "Leather",
    )
    P["Pelvis"].add(disc((0, -0.130, 1.058), 0.058, 0.032, 16, "y"), "Gold")
    P["Pelvis"].add(disc((0, -0.140, 1.058), 0.080, 0.016, 16, "y", inner=0.066), "Gold")
    # Two tassets rather than three, and short. The three long ones read as the
    # skirt of a cuirass, which is the heavy silhouette this rig is getting away
    # from — these are a pair of belt straps and nothing more.
    for dx, ang in ((-0.086, 0.34), (0.086, -0.34)):
        P["Pelvis"].add(
            slab((dx, -0.118 + abs(dx) * 0.30, 0.918), (0.116, 0.040, 0.235), (0.05, 0, ang)),
            "Leather",
        )

    # ------------------------------------------------------------------ torso
    #
    # A long ribcage over a short, tight waist, and the shoulders carried by the
    # yoke rather than by the chest — the widest ring is at 1.44 and it is only
    # 0.196, so the mantle above it is what gives him a shoulder line at all.
    TORSO = [
        (1.000, 0, 0.000, 0.156, 0.116),
        (1.140, 0, 0.000, 0.144, 0.108),
        (1.300, 0, 0.000, 0.172, 0.120),
        (1.440, 0, 0.000, 0.196, 0.130),
        (1.550, 0, 0.005, 0.186, 0.122),
        (1.625, 0, 0.005, 0.150, 0.104),
    ]
    P["Torso"].add(column(TORSO, n=14, e=2.4), "Leather")
    # The neck runs *above* the mantle's collar. Ending it where the cloth
    # starts puts the chin on the collar, and a head with no neck under it is
    # what reads as an oversized head, before its actual size is in question.
    P["Torso"].add(
        column([(1.575, 0, 0.010, 0.062, 0.064), (1.790, 0, 0.012, 0.054, 0.057)], n=10), "Skin"
    )
    # Trapezius, so the shoulder is not where a lofted tube stops and a sphere
    # starts.
    for s in (-1, 1):
        P["Torso"].add(blob((s * 0.126, 0.004, 1.520), (0.086, 0.074, 0.048), n=12, m=6), "Leather")

    # Baldric across the chest, and the quiver strap under it.
    P["Torso"].add(
        sweep(
            [(-0.150, -0.106, 1.070), (-0.050, -0.156, 1.240), (0.100, -0.140, 1.420), (0.185, -0.020, 1.530)],
            [(0.026, 0.012), (0.030, 0.012), (0.028, 0.012), (0.026, 0.012)],
            n=6,
        ),
        "Cloth",
    )
    # The brooch pins the cloak where it comes over the shoulder.
    P["Torso"].add(disc((-0.128, -0.146, 1.432), 0.044, 0.026, 14, "y"), "Gold")
    P["Torso"].add(disc((-0.128, -0.155, 1.432), 0.062, 0.013, 14, "y", inner=0.050), "Gold")

    # The mantle: cloth over both shoulders, stopped at the bicep. It is the
    # widest thing on the shade from directly above, which is where the seat
    # colour has to be legible, and it puts the arms *under* a garment instead
    # of hanging them off ball joints. It has to start at the neck and flare
    # from there — begun at full width it is a bucket on the collarbones.
    def over_shoulder(u, a):
        near = min(abs(a - 0.5 * math.pi), abs(a - 1.5 * math.pi))
        peak = 0.100 * math.exp(-((near / 0.60) ** 2)) * min(1.0, u * 2.6)
        return (0.100 + 0.172 * u**0.55 + peak) * (1 + 0.05 * math.sin(7 * a))

    P["Torso"].add(
        shell(
            [1.672, 1.632, 1.575, 1.500, 1.420, 1.352],
            0.30 * math.pi,
            1.70 * math.pi,
            over_shoulder,
            na=18,
            t=0.034,
            yfun=lambda u: 0.008 + 0.018 * u,
            zfun=lambda u, a: -u * 0.055 * math.cos(a),
        ),
        "Crest",
    )

    # Quiver, riding high on the bow-arm side with the fletching clear of the
    # shoulder. The arrows are the read: at this camera a bow in the hand is a
    # line and a cloak is a blob, and six shafts standing above a shoulder are
    # the one thing on this figure nothing else in the game has.
    P["Torso"].add(
        sweep(
            [(0.100, 0.150, 0.980), (0.170, 0.132, 1.250), (0.238, 0.108, 1.560)],
            [(0.055, 0.055), (0.060, 0.060), (0.066, 0.066)],
            n=9,
        ),
        "Leather",
    )
    P["Torso"].add(disc((0.244, 0.120, 1.578), 0.070, 0.018, 12, "z"), "Gold")
    for i in range(6):
        k = i / 5 - 0.5
        top = Vector((0.240 + k * 0.088, 0.126 + (i % 2) * 0.040 - 0.018, 1.930 - abs(k) * 0.045))
        base = Vector((0.200 + k * 0.044, 0.138, 1.430))
        P["Torso"].add(sweep([base, top], [(0.011, 0.011), (0.010, 0.010)], n=4), "Wood")
        for rot in (0.0, math.pi / 2):
            P["Torso"].add(
                slab((top.x, top.y, top.z - 0.050), (0.046, 0.005, 0.086), (0.0, 0.0, rot)),
                "Cloth",
            )

    # ------------------------------------------------------------------ cloak
    #
    # Wrapped from one front edge round the back to the other, with a fold
    # ripple, a hem that drifts backwards as it falls, and front edges that ride
    # up — a cape whose rows are all level is a plank seen from the side. Not
    # the crest: the mantle above already carries the seat colour, and painting
    # the long cape as well makes the whole shade one hue.
    P["Cape"].add(
        shell(
            [1.618, 1.520, 1.370, 1.160, 0.950, 0.760, 0.630],
            0.42 * math.pi,
            1.58 * math.pi,
            lambda u, a: (0.230 + 0.150 * u * (1 - 0.28 * u)) * (1 + 0.055 * math.sin(6.5 * a)),
            na=16,
            t=0.034,
            # Kept close to the back. Every centimetre the hem trails is a
            # centimetre `centre` slides the whole body forward off its hitbox.
            yfun=lambda u: 0.010 + 0.040 * u,
            zfun=lambda u, a: u * (0.24 * math.exp(-((a - 0.42 * math.pi) / 0.75) ** 2)
                                   + 0.24 * math.exp(-((a - 1.58 * math.pi) / 0.75) ** 2)
                                   - 0.05 * math.sin(3 * a)),
        ),
        "Cloth",
    )
    # Where it is gathered and pinned, under the brooch. On the cape node with
    # the cloth it belongs to, or the fold stays put while the cloak swings.
    P["Cape"].add(
        sweep(
            [(-0.210, -0.108, 1.540), (-0.168, -0.150, 1.432), (-0.115, -0.142, 1.325)],
            [(0.050, 0.040), (0.058, 0.044), (0.044, 0.034)],
            n=7,
            e=2.4,
        ),
        "Crest",
    )

    # ------------------------------------------------------------------- head
    skull = ((0, 0.012, 1.892), (0.100, 0.120, 0.130))
    jaw = ((0, -0.014, 1.830), (0.074, 0.086, 0.068))
    P["Head"].add(blob(*skull), "Skin")
    P["Head"].add(blob(*jaw), "Skin")
    # A man's face off the portrait: heavy level brow, narrow eye, straight
    # nose, mouth barely a line.
    face(
        P["Head"],
        skull,
        jaw,
        eyes=(1.888, 0.044, (0.026, 0.010, 0.012)),
        brows=(1.912, 0.045, (0.033, 0.009, 0.009), 0.16),
        nose=(1.874, (0.016, 0.015, 0.023)),
        lips=(1.812, (0.025, 0.010, 0.008)),
    )
    # Wider than the skull by a clear margin on every axis. Two ellipsoids of
    # nearly the same radius do not nest: the faceted one dips inside the smooth
    # one between its vertices, and a patch of scalp surfaces through the hair.
    P["Head"].add(blob((0, 0.034, 1.922), (0.120, 0.140, 0.122)), "Hair")
    # Bangs swept across the brow, riding the skull's own surface — every point
    # computed on it, a centimetre proud, so it cannot spike off the head.
    on_skull = _surface(skull)
    P["Head"].add(
        sweep(
            [
                (x, on_skull(x, z, 0.011), z)
                for x, z in ((-0.080, 1.968), (-0.030, 1.946), (0.032, 1.940), (0.080, 1.960))
            ],
            [(0.025, 0.013), (0.029, 0.016), (0.027, 0.015), (0.021, 0.011)],
            n=6,
            e=2.6,
        ),
        "Hair",
    )
    # Locks: flattened ribbons, not tubes, started inside the crown so they read
    # as one mass breaking up. Shorter than the first pass — hair to the collar
    # widens the head-and-shoulders mass, which is the silhouette this rig is
    # trying to keep narrow.
    for s in (-1, 1):
        for out, back, wave in ((0.80, -0.30, 1.0), (1.0, 0.35, -1.0), (0.82, 1.0, 1.0)):
            P["Head"].add(
                sweep(
                    [
                        (s * 0.070 * out, 0.02 + back * 0.05, 1.974),
                        (s * 0.102 * out, 0.035 + back * 0.068 + wave * 0.011, 1.900),
                        (s * 0.104 * out, 0.020 + back * 0.082 - wave * 0.013, 1.830),
                        (s * 0.094 * out, 0.055 + back * 0.078 + wave * 0.009, 1.778),
                    ],
                    [(0.040, 0.024), (0.046, 0.027), (0.038, 0.023), (0.020, 0.012)],
                    n=6,
                    e=2.6,
                ),
                "Hair",
            )

    # ------------------------------------------------------------------- arms
    #
    # Two segments, and thin. The upper arm hangs slightly splayed — the game
    # parents the bow out at x=0.55 and a hand pinned to the ribs leaves it
    # floating — and the forearm carries the bracer, which is the one piece of
    # kit that says archer on a limb rather than on a back.
    #
    # No pauldron: the mantle is the shoulder. A cap here would be a sphere
    # inside a cloak that swings independently of it, and the first time the arm
    # came forward it would push through the cloth.
    for arm, fore, s in (("ArmL", "ForearmL", -1), ("ArmR", "ForearmR", 1)):
        P[arm].add(blob((s * 0.232, 0.000, 1.500), (0.076, 0.076, 0.070), n=12, m=6), "Leather")
        P[arm].add(
            sweep(
                [
                    (s * 0.238, 0.000, 1.500),
                    (s * 0.262, 0.006, 1.370),
                    (s * 0.280, -0.004, 1.230),
                ],
                [(0.070, 0.070), (0.058, 0.058), (0.050, 0.050)],
                n=8,
            ),
            "Leather",
        )
        # Elbow, on the joint, same argument as the knee.
        P[fore].add(blob((s * 0.282, -0.008, 1.218), (0.052, 0.054, 0.050), n=10, m=6), "Leather")
        P[fore].add(
            sweep(
                [
                    (s * 0.284, -0.012, 1.210),
                    (s * 0.298, -0.036, 1.110),
                    (s * 0.308, -0.070, 1.012),
                ],
                [(0.048, 0.048), (0.043, 0.043), (0.038, 0.038)],
                n=8,
            ),
            "Leather",
        )
        # The bracer. Long on both arms rather than one: a bow arm needs it to
        # keep the string off the forearm and the string hand wears one anyway,
        # and an asymmetric pair at this size reads as a modelling mistake.
        P[fore].add(
            sweep(
                [(s * 0.290, -0.022, 1.170), (s * 0.302, -0.052, 1.062)],
                [(0.056, 0.056), (0.050, 0.050)],
                n=8,
            ),
            "Cloth",
        )
        P[fore].add(disc((s * 0.304, -0.060, 1.045), 0.054, 0.014, 10, "z"), "Gold")
        P[fore].add(blob((s * 0.310, -0.084, 0.978), (0.044, 0.050, 0.056), n=10, m=6), "Leather")

    return assemble(parts, "archer"), H


def bow():
    """
    The bow, in game units and pivoted on the grip.

    Never goes through fitToHeight — player.ts parents it at (0.55, 0, 0) under
    the swing pivot, which sits 1.0 up on a 2.1-tall shade, so these numbers are
    what lands on screen: 1.6 tall, spanning roughly knee to crown.
    """
    sinew = emissive("Sinew", (0.62, 0.88, 0.42), 2.0)
    p = Part("ArcherBow", (0, 0, 0))

    for s in (-1, 1):
        p.add(
            sweep(
                [
                    (0, -0.058, s * 0.10),
                    (0, -0.082, s * 0.34),
                    (0, -0.066, s * 0.56),
                    (0, -0.020, s * 0.71),
                    (0, 0.014, s * 0.79),
                ],
                [(0.030, 0.048), (0.026, 0.040), (0.022, 0.034), (0.016, 0.024), (0.011, 0.016)],
                n=7,
            ),
            "Wood",
        )
        p.add(disc((0, 0.014, s * 0.785), 0.020, 0.024, 8, "z"), "Gold")

    # Riser and grip wrap.
    p.add(
        column(
            [
                (-0.16, 0, -0.058, 0.030, 0.050),
                (-0.05, 0, -0.062, 0.032, 0.056),
                (0.05, 0, -0.062, 0.032, 0.056),
                (0.16, 0, -0.058, 0.030, 0.050),
            ],
            n=8,
            e=2.2,
        ),
        "Wood",
    )
    p.add(
        column(
            [(-0.085, 0, -0.060, 0.036, 0.058), (0.085, 0, -0.060, 0.036, 0.058)],
            n=8,
            e=2.2,
        ),
        "Leather",
    )

    # The string. A bow with nothing on it reads as a harp.
    p.add(sweep([(0, 0.014, 0.79), (0, 0.017, 0.0), (0, 0.014, -0.79)], [0.008] * 3, n=4), "Sinew")

    # The arrow is its own node, and that is the whole point of this file being
    # two objects instead of one.
    #
    # Baked into the bow it is a decoration: the shade mimes a draw while the
    # shaft stays welded to the riser, which is the tell that gives away every
    # bow animation that only rotates an arm. On its own node `animateWeapon`
    # slides it back along the aim line through the draw and throws it forward
    # on the loose, so the thing the player is actually watching — the arrow —
    # is the thing that moves. Its origin is the bow's, so the node's local -Y
    # is the aim direction and a single `position.z` in three is the draw.
    a = Part("ArcherArrow", (0, 0, 0), "ArcherBow")
    a.add(sweep([(0, 0.055, 0.012), (0, -0.60, 0.012)], [(0.012, 0.012)] * 2, n=5), "Wood")
    a.add(sweep([(0, -0.60, 0.012), (0, -0.70, 0.012)], [(0.022, 0.022), (0.002, 0.002)], n=6), "Iron")
    # The nock, sitting on the string. It is four faces, and it is what makes
    # the draw legible from above once the shaft itself is edge-on.
    a.add(blob((0, 0.038, 0.012), (0.024, 0.030, 0.024), n=8, m=5), "Iron")
    a.add(slab((0, -0.010, 0.012), (0.005, 0.105, 0.052)), "Cloth")
    a.add(slab((0, -0.010, 0.012), (0.052, 0.105, 0.005)), "Cloth")

    obj, arrow = p.build(), a.build()
    for o in (obj, arrow):
        shade(o)

    # The arrow hangs off an *empty*, and the mesh is the empty's child.
    #
    # `addOutline` clones every mesh into an inverted hull and adds the hull as
    # a **sibling** with the mesh's transform copied once. Move a mesh after
    # that and its outline stays behind — the arrow would slide out of its own
    # silhouette on the first draw. Under an empty the hull lands inside the
    # node instead, so the thing the game animates carries both.
    arrow.name = "ArrowShaft"
    pivot = bpy.data.objects.new("ArcherArrow", None)
    bpy.context.collection.objects.link(pivot)
    arrow.parent = pivot
    pivot.parent = obj

    print("bow:", len(obj.data.polygons) + len(arrow.data.polygons), "faces over 2 meshes")
    return [obj, pivot, arrow]


# ------------------------------------------------------------- the sorceress
#
# From the reference sheet, and it is not a robe.
#
# She is armoured in black plate cut like a leotard: moulded cups, a corset
# pulled hard at the waist, a high-cut brief, bare shoulders and midriff and
# legs, straps at the thigh, and pointed heeled boots to mid-calf. Every edge of
# it carries the same gold motif — a four-armed spike whose lower blade runs
# twice the length of the other three. That spike is the character. It runs down
# the sternum, sits on both hips, hangs off both thighs, climbs the front of
# both boots and stands on her forehead, and it is the only warm colour on her.
#
# Three things follow from the sheet that the robed version did not have to
# answer:
#
# **She has legs, so she gets the whole rig.** Twelve nodes with elbows and
# knees, where the robe got five. There is no hem left to hide a stride behind:
# bare thighs and a heel are exactly the silhouette a player reads a walk off,
# and a leg that swings from the hip in one piece is a pendulum. The knee ball
# lives on the thigh, at the joint, so bending the shin uncovers it instead of
# opening a gap.
#
# **The hair is the cape.** `animateBody` damps one node behind the body and
# calls it `Cape`; hers is floor-length hair, which wants precisely that and
# nothing else. The mass down her back hangs off the nape and lags; the locks
# framing her face stay on the head, where a backward swing cannot drive them
# through her own chest.
#
# **Skin is a material now.** The robe covered everything but a face and two
# hands, so the body under it could be a lofted tube. Half of this figure is
# bare, which means the tube has to be a *body* — glute, knee, calf, ankle,
# fingers — and the armour sits on top of it as separate pieces rather than
# being the shape itself. That is where most of the triangle count went, and it
# is the difference between a woman in armour and an armour-shaped solid.


def sorceress():
    palette("mage")
    H = 2.0
    parts = [
        Part("Pelvis", (0, 0, 1.060)),
        Part("Torso", (0, 0, 1.210), "Pelvis"),
        Part("Head", (0, 0.008, 1.700), "Torso"),
        # Hair, in the slot the game damps behind the body — see above.
        Part("Cape", (0, 0.050, 1.760), "Torso"),
        Part("ArmL", (-0.205, 0.000, 1.605), "Torso"),
        Part("ArmR", (0.205, 0.000, 1.605), "Torso"),
        Part("ForearmL", (-0.300, -0.006, 1.248), "ArmL"),
        Part("ForearmR", (0.300, -0.006, 1.248), "ArmR"),
        Part("LegL", (-0.118, 0.000, 1.010), "Pelvis"),
        Part("LegR", (0.118, 0.000, 1.010), "Pelvis"),
        Part("ShinL", (-0.126, 0.004, 0.560), "LegL"),
        Part("ShinR", (0.126, 0.004, 0.560), "LegR"),
    ]
    P = {p.name: p for p in parts}

    # The corset's own cross-section, kept as a name rather than typed inline,
    # because every gold ornament on the front of her is placed against it by
    # `on_column`. Hard-coding the depths instead would mean twelve numbers that
    # go stale the moment the waist moves in by a centimetre — and they would go
    # stale silently, as a chain floating a finger's width off her chest.
    # Depth is not width times a constant. The first pass set every `ry` to
    # about 0.58 of its `rx` and she came out a plank: correct from the front,
    # and from the side a figure with no ribcage standing behind a pair of
    # shoulders. A torso is roughly two-thirds as deep as it is wide at the
    # chest and closer to four-fifths at the waist, and the game's camera is at
    # 52 degrees — more than half of what it sees is the side of her.
    BODICE = [
        (1.170, 0, 0.000, 0.152, 0.112),
        (1.240, 0, 0.000, 0.130, 0.100),
        (1.300, 0, 0.000, 0.118, 0.094),
        (1.380, 0, 0.000, 0.138, 0.102),
        (1.460, 0, 0.004, 0.164, 0.110),
        (1.530, 0, 0.004, 0.176, 0.114),
        (1.600, 0, 0.002, 0.170, 0.106),
        (1.652, 0, 0.000, 0.146, 0.092),
    ]

    # The body goes in first and the armour sits on top of it. That order is the
    # whole design: the corset is a strapless piece that stops under the bust and
    # again at the hip, so whatever it does not cover has to be a real ribcage
    # rather than a hole. Built the other way round — armour as the silhouette,
    # skin patched into the gaps — every edge of the plate is a place for the two
    # to disagree, and they disagree by intersecting.
    P["Torso"].add(column(BODICE, n=16, e=2.2), "Skin")
    # Long enough to clear the collar. A chin resting on cloth is what turns a
    # head into a ball sitting on a pair of shoulders.
    P["Torso"].add(
        column([(1.618, 0, 0.008, 0.058, 0.060), (1.764, 0, 0.012, 0.049, 0.051)], n=10), "Skin"
    )
    # Trapezius. Without it the shoulder is where a lofted box stops and a
    # sphere starts, and the seam between them reads as a joint on a doll.
    for s in (-1, 1):
        P["Torso"].add(blob((s * 0.116, 0.006, 1.626), (0.092, 0.078, 0.050), n=12, m=6), "Skin")

    # The corset, from the hip to just under the bust, and the cups above it.
    # It is one offset off the body's own section, so it can never pinch through
    # her: a plate authored as its own profile has to be re-tuned every time the
    # waist does.
    P["Torso"].add(
        column(
            [(z, cx, cy, rx + 0.013, ry + 0.013) for (z, cx, cy, rx, ry) in BODICE if z <= 1.462],
            n=16,
            e=2.2,
        ),
        "Crest",
    )
    # Wide enough to reach the corset's top ring at the *sides*, not only at the
    # front. Narrower cups leave a band of bare rib between the two pieces of
    # armour that runs right round her, which reads as a costume in two halves.
    cups = {}
    for s in (-1, 1):
        cups[s] = ((s * 0.084, -0.066, 1.508), (0.084, 0.072, 0.082))
        P["Torso"].add(blob(*cups[s], n=12, m=7), "Crest")

    # Front of whatever is actually in front of her at a given height — the
    # corset below 1.462, bare sternum above it. One function, so the chain does
    # not step off the plate where the plate ends.
    def front(z, out):
        return on_column(BODICE, 0, z, out=out + (0.013 if z <= 1.462 else 0.0), e=2.2)

    # The chain down the sternum: five of the motif, shrinking as they fall. It
    # is the one line on her that runs the full height of the torso, and it is
    # what stops the corset reading as a swimsuit.
    for z, k in ((1.586, 1.00), (1.508, 0.92), (1.424, 0.86), (1.336, 0.80), (1.252, 0.72)):
        star(
            P["Torso"],
            "Gold",
            (0, front(z, 0.012), z),
            (0, -1, 0),
            arms=(0.030 * k, 0.058 * k, 0.024 * k, 0.024 * k),
            r=0.009 * k,
        )
    for s in (-1, 1):
        on_cup = _surface(cups[s])
        star(
            P["Torso"],
            "Gold",
            (s * 0.086, on_cup(s * 0.086, 1.508, 0.008), 1.508),
            (0, -1, 0),
            arms=(0.034, 0.052, 0.028, 0.028),
            r=0.009,
        )
        # A wire along the top edge of the cup, riding the cup's own surface so
        # it stays a trim line and does not saw through the plate it edges.
        P["Torso"].add(
            sweep(
                [
                    (s * x, on_cup(s * x, z, 0.006), z)
                    for x, z in ((0.012, 1.556), (0.062, 1.576), (0.112, 1.564), (0.150, 1.528))
                ],
                [(0.008, 0.008)] * 4,
                n=5,
            ),
            "Gold",
        )
    # The belt: a band at the waist, taken off the section so it cannot cut in.
    wcx, wcy, wrx, wry = profile_at(BODICE, 1.300)
    P["Torso"].add(
        column(
            [
                (1.290, wcx, wcy, wrx + 0.014, wry + 0.014),
                (1.312, wcx, wcy, wrx + 0.014, wry + 0.014),
            ],
            n=16,
            e=2.2,
        ),
        "Gold",
    )

    # Collar at the throat. Kept low and narrow — a tall one is a gorget, and a
    # gorget on a bare shoulder reads as a missing breastplate rather than as
    # jewellery — and it has to clear the chin at 1.732 by a real gap, or the
    # head sits on the collar and reads as a ball on a pair of shoulders.
    P["Torso"].add(
        column([(1.638, 0, 0.008, 0.070, 0.072), (1.698, 0, 0.010, 0.063, 0.065)], n=12, e=2.3),
        "Leather",
    )
    # Its spikes ring the back and sides only. Across the throat they were five
    # gold points under her chin, which from the front is a set of teeth.
    for i in range(5):
        a = math.pi + (i - 2) * 0.42
        P["Torso"].add(
            spike(
                (0.064 * math.sin(a), 0.010 - 0.066 * math.cos(a), 1.692),
                (0.072 * math.sin(a), 0.010 - 0.075 * math.cos(a), 1.726),
                (0.008, 0.008),
            ),
            "Gold",
        )

    # Pauldrons. They belong to the torso and not to the arm: the plate on the
    # sheet is strapped across the shoulder, so it holds still while the arm
    # swings under it — which is also the only version that cannot push through
    # the deltoid when the arm comes forward.
    #
    # Three spikes each, fanning back to front. This is the piece a player sees
    # from directly above, so it and the chest plate are what carry the seat
    # colour; everything else on her stays black, which is the sheet.
    for s in (-1, 1):
        # Two overlapping lames rather than one cap. A single ellipsoid over a
        # shoulder is a disc seen from the side — it has one silhouette and one
        # highlight, and it reads as a shield strapped on rather than as plate.
        # The step between two is what says armour at any distance.
        for c, r, tilt in (
            ((s * 0.194, 0.004, 1.648), (0.092, 0.080, 0.040), 0.34),
            ((s * 0.224, 0.002, 1.598), (0.084, 0.072, 0.036), 0.76),
        ):
            P["Torso"].add(turn(blob(c, r, n=14, m=7), c, s * tilt), "Crest")
        for dy, up, out in ((-0.054, 0.044, 0.058), (0.000, 0.068, 0.074), (0.050, 0.042, 0.056)):
            P["Torso"].add(
                spike(
                    (s * 0.238, dy, 1.622),
                    (s * (0.238 + out), dy * 1.25, 1.622 + up),
                    (0.019, 0.021),
                ),
                "Gold",
            )

    # ------------------------------------------------------------------- hips
    #
    # The brief. It has to narrow hard between 1.02 and 0.97 or the leg opening
    # is level, and a level opening across the top of both thighs is a pair of
    # shorts. What sells the cut is that the thigh is wider than the brief at
    # the hip and comes out from under its side.
    BRIEF = [
        (1.192, 0, 0.004, 0.154, 0.116),
        (1.140, 0, 0.010, 0.172, 0.128),
        (1.075, 0, 0.014, 0.178, 0.132),
        (1.020, 0, 0.014, 0.146, 0.120),
        (0.972, 0, 0.014, 0.096, 0.096),
    ]
    P["Pelvis"].add(column(BRIEF, n=16, e=2.3), "Leather")
    # Glutes, under the brief. A lofted section is symmetric front to back, so
    # without these she has hips from the front and a filing cabinet from the
    # side — and the side is most of what a camera 52 degrees up is looking at.
    for s in (-1, 1):
        P["Pelvis"].add(
            blob((s * 0.076, 0.078, 1.038), (0.088, 0.070, 0.080), n=12, m=6), "Leather"
        )
    P["Pelvis"].add(
        column(
            [(1.174, 0, 0, 0.172, 0.118), (1.200, 0, 0, 0.168, 0.115)],
            n=16,
            e=2.3,
        ),
        "Gold",
    )
    for s in (-1, 1):
        star(
            P["Pelvis"],
            "Gold",
            (s * 0.140, on_column(BRIEF, s * 0.140, 1.104, out=0.012, e=2.3), 1.104),
            (s * 0.52, -0.85, 0),
            arms=(0.032, 0.058, 0.026, 0.026),
            r=0.010,
        )
        # The V at the front, converging on the point of the brief.
        P["Pelvis"].add(
            spike(
                (s * 0.078, on_column(BRIEF, s * 0.078, 1.070, out=0.010, e=2.3), 1.070),
                (s * 0.012, on_column(BRIEF, 0, 0.988, out=0.014, e=2.3), 0.988),
                (0.012, 0.012),
            ),
            "Gold",
        )

    # ------------------------------------------------------------------- legs
    for name, shin, s in (("LegL", "ShinL", -1), ("LegR", "ShinR", 1)):
        x = s * 0.118
        # Glute, thigh, and the taper into the knee. The widest ring is at 1.075
        # rather than at the top: a thigh that is widest where it meets the hip
        # is a cone, and a cone is what every leg built out of one taper looks
        # like from this camera.
        THIGH = [
            (1.158, x * 1.00, 0.014, 0.098, 0.116),
            (1.075, x * 1.05, 0.010, 0.109, 0.126),
            (0.990, x * 1.06, 0.004, 0.106, 0.121),
            (0.880, x * 1.07, 0.000, 0.096, 0.109),
            (0.760, x * 1.08, 0.000, 0.086, 0.098),
            (0.650, x * 1.08, 0.002, 0.077, 0.088),
            (0.578, x * 1.07, 0.004, 0.071, 0.081),
        ]
        P[name].add(column(THIGH, n=14, e=2.1), "Skin")
        # The knee ball belongs to the thigh, and it is centred exactly on the
        # joint. On the shin it would swing away and open a gap at the back of
        # the knee on every stride; here bending the shin uncovers it.
        P[name].add(blob((s * 0.126, 0.002, 0.560), (0.069, 0.072, 0.056), n=12, m=6), "Skin")

        # Thigh strap, and the motif hanging off the outside of it.
        tcx, tcy, trx, trly = profile_at(THIGH, 0.776)
        P[name].add(
            column(
                [
                    (0.754, tcx, tcy, trx + 0.011, trly + 0.011),
                    (0.798, tcx, tcy, trx + 0.011, trly + 0.011),
                ],
                n=12,
                e=2.2,
            ),
            "Leather",
        )
        star(
            P[name],
            "Gold",
            (s * 0.146, on_column(THIGH, s * 0.146, 0.776, out=0.018, e=2.1), 0.776),
            (s * 0.46, -0.89, 0),
            arms=(0.030, 0.054, 0.022, 0.022),
            r=0.008,
        )
        star(
            P[name],
            "Gold",
            (s * 0.138, on_column(THIGH, s * 0.138, 0.958, out=0.010, e=2.1), 0.958),
            (s * 0.48, -0.88, 0),
            arms=(0.025, 0.044, 0.019, 0.019),
            r=0.007,
        )

        # Calf and ankle. The belly of the calf sits at 0.38 and carries its
        # depth in Y, not in X — seen from the front a calf barely widens, and
        # widening it there is what makes a bare leg read as a bollard.
        k = s * 0.126
        CALF = [
            (0.578, k * 1.07, 0.004, 0.071, 0.081),
            (0.520, k * 1.08, 0.002, 0.066, 0.080),
            (0.450, k * 1.09, 0.010, 0.064, 0.085),
            (0.380, k * 1.10, 0.016, 0.062, 0.088),
            (0.300, k * 1.10, 0.012, 0.053, 0.070),
            (0.220, k * 1.10, 0.008, 0.043, 0.055),
            (0.150, k * 1.10, 0.006, 0.035, 0.044),
            (0.106, k * 1.10, 0.008, 0.031, 0.040),
        ]
        P[shin].add(column(CALF, n=12, e=2.1), "Skin")

        # The boot. Shaft off the calf's own section, then the foot as a swept
        # arch: she is on a heel, so the sole never touches the ground except at
        # the ball, and the ankle is directly over the arch rather than over the
        # heel. Modelled flat it is a slipper with a spike stuck under it.
        bcx, bcy, brx, bry = profile_at(CALF, 0.436)
        P[shin].add(
            column(
                [(0.436, bcx, bcy, brx + 0.016, bry + 0.016)]
                + [(z, cx, cy, rx + 0.016, ry + 0.016) for (z, cx, cy, rx, ry) in CALF if z < 0.436],
                n=12,
                e=2.1,
            ),
            "Leather",
        )
        toe = k * 1.10
        P[shin].add(
            sweep(
                [
                    (toe, 0.014, 0.124),
                    (toe, -0.028, 0.066),
                    (toe, -0.088, 0.026),
                    (toe, -0.145, 0.015),
                    (toe, -0.190, 0.011),
                ],
                [(0.041, 0.049), (0.045, 0.050), (0.046, 0.042), (0.032, 0.026), (0.013, 0.011)],
                n=8,
                e=2.3,
            ),
            "Leather",
        )
        # The heel itself, and it is a spike like everything else she wears.
        P[shin].add(
            sweep(
                [(toe, 0.050, 0.118), (toe, 0.064, 0.002)],
                [(0.026, 0.028), (0.012, 0.013)],
                n=6,
                e=2.4,
            ),
            "Leather",
        )
        # The tongue peaking up the front of the shaft — the reason the boot top
        # is a shape rather than a level cut across the calf.
        P[shin].add(
            spike(
                (toe, on_column(CALF, toe, 0.408, out=0.016, e=2.1), 0.404),
                (toe, on_column(CALF, toe, 0.462, out=0.018, e=2.1), 0.500),
                (0.042, 0.024),
            ),
            "Leather",
        )
        P[shin].add(
            column(
                [
                    (0.424, bcx, bcy, brx + 0.020, bry + 0.020),
                    (0.446, bcx, bcy, brx + 0.018, bry + 0.018),
                ],
                n=12,
                e=2.1,
            ),
            "Gold",
        )
        for z in (0.252, 0.352):
            star(
                P[shin],
                "Gold",
                (toe, on_column(CALF, toe, z, out=0.024, e=2.1), z),
                (0, -1, 0),
                arms=(0.022, 0.038, 0.018, 0.018),
                r=0.007,
            )
        # Toe cap, which is what the eye reads as the point of the shoe.
        P[shin].add(
            sweep(
                [(toe, -0.138, 0.015), (toe, -0.198, 0.010)],
                [(0.034, 0.028), (0.008, 0.007)],
                n=8,
                e=2.3,
            ),
            "Gold",
        )

    # ------------------------------------------------------------------- arms
    #
    # Splayed, and not as a pose choice: the game parents the book at x=0.55
    # under the swing pivot, so a hand pinned to the ribs leaves it floating a
    # hand's width out in space.
    for arm, fore, s in (("ArmL", "ForearmL", -1), ("ArmR", "ForearmR", 1)):
        P[arm].add(blob((s * 0.200, 0.002, 1.592), (0.070, 0.074, 0.072), n=12, m=6), "Skin")
        P[arm].add(
            sweep(
                [
                    (s * 0.205, 0.000, 1.596),
                    (s * 0.240, 0.004, 1.480),
                    (s * 0.276, 0.000, 1.360),
                    (s * 0.300, -0.006, 1.252),
                ],
                [(0.062, 0.064), (0.054, 0.056), (0.047, 0.049), (0.043, 0.045)],
                n=10,
            ),
            "Skin",
        )
        # The armlet: a band high on the bicep, which is the one piece of kit
        # between the pauldron and the bracer and the only thing keeping the
        # upper arm from being bare pipe.
        P[arm].add(
            sweep(
                [(s * 0.234, 0.004, 1.500), (s * 0.254, 0.002, 1.436)],
                [(0.060, 0.062), (0.058, 0.060)],
                n=10,
                e=2.4,
            ),
            "Leather",
        )

        P[fore].add(
            sweep(
                [
                    (s * 0.300, -0.006, 1.252),
                    (s * 0.326, -0.026, 1.130),
                    (s * 0.352, -0.052, 1.014),
                ],
                [(0.043, 0.045), (0.038, 0.040), (0.032, 0.034)],
                n=10,
            ),
            "Skin",
        )
        # Bracer, squared off — e=2.5 against the arm's 2.0, so plate reads as
        # plate next to the skin it is strapped over.
        P[fore].add(
            sweep(
                [
                    (s * 0.306, -0.010, 1.222),
                    (s * 0.328, -0.028, 1.118),
                    (s * 0.350, -0.050, 1.026),
                ],
                [(0.053, 0.055), (0.049, 0.051), (0.045, 0.047)],
                n=10,
                e=2.5,
            ),
            "Leather",
        )
        for a, b, r0, r1 in (
            ((s * 0.306, -0.010, 1.222), (s * 0.311, -0.014, 1.200), 0.056, 0.055),
            ((s * 0.346, -0.046, 1.046), (s * 0.351, -0.051, 1.024), 0.049, 0.048),
        ):
            P[fore].add(sweep([a, b], [(r0, r0 + 0.002), (r1, r1 + 0.002)], n=10, e=2.5), "Gold")
        star(
            P[fore],
            "Gold",
            (s * 0.376, -0.028, 1.120),
            (s * 0.91, -0.42, 0),
            arms=(0.028, 0.046, 0.018, 0.018),
            r=0.007,
        )

        # Glove back and bare fingers — the sheet's gloves stop at the knuckle.
        # Five tubes is a hundred triangles and it is the cheapest human read on
        # the whole model: a mitten at the end of an arm is a mannequin.
        P[fore].add(blob((s * 0.359, -0.066, 0.966), (0.027, 0.042, 0.044), n=12, m=6), "Leather")
        for i in range(4):
            dy = -0.080 + (i - 1.5) * 0.021
            P[fore].add(
                sweep(
                    [
                        (s * 0.360, dy, 0.936),
                        (s * 0.361, dy + 0.008, 0.890),
                        (s * 0.360, dy + 0.020, 0.858),
                    ],
                    [(0.011, 0.012), (0.010, 0.011), (0.008, 0.009)],
                    n=5,
                ),
                "Skin",
            )
        P[fore].add(
            sweep(
                [(s * 0.348, -0.092, 0.944), (s * 0.338, -0.110, 0.902)],
                [(0.013, 0.014), (0.009, 0.010)],
                n=5,
            ),
            "Skin",
        )

    # ------------------------------------------------------------------- head
    skull = ((0, 0.010, 1.868), (0.098, 0.116, 0.124))
    jaw = ((0, -0.010, 1.806), (0.060, 0.074, 0.064))
    P["Head"].add(blob(*skull), "Skin")
    P["Head"].add(blob(*jaw), "Skin")
    for s in (-1, 1):
        P["Head"].add(blob((s * 0.094, 0.014, 1.846), (0.016, 0.026, 0.032), n=8, m=6), "Skin")
    # Smaller than the first pass on every count. Eyes at 0.029 half-width on a
    # 0.098 skull nearly met over the nose, and a nose 0.042 tall on a face 0.16
    # from brow to chin is a muzzle: both were sized as *features* instead of
    # against the head they sit on, which is the whole reason `face` takes world
    # Z rather than offsets. The brow tilt came down with them — at 0.30 the
    # outer ends stood off the temples and read as a pair of horns.
    face(
        P["Head"],
        skull,
        jaw,
        eyes=(1.860, 0.045, (0.020, 0.009, 0.011)),
        brows=(1.886, 0.044, (0.028, 0.008, 0.007), 0.20),
        nose=(1.838, (0.011, 0.013, 0.018)),
        lips=(1.790, (0.021, 0.010, 0.008)),
        lip_mat="Lip",
    )
    on_skull = _surface(skull)
    # The sigil between the brows. Two pixels at the game's camera and the only
    # thing on her that is unambiguously not armour — it is what says the black
    # plate is a habit rather than a uniform.
    star(
        P["Head"],
        "Gold",
        (0, on_skull(0, 1.924, 0.006), 1.924),
        (0, -1, 0),
        arms=(0.010, 0.026, 0.009, 0.009),
        r=0.0045,
    )
    for s in (-1, 1):
        P["Head"].add(
            spike((s * 0.096, 0.018, 1.828), (s * 0.103, 0.024, 1.732), (0.010, 0.010)), "Gold"
        )

    # Hair. The crown clears the skull on every axis — two ellipsoids of nearly
    # the same radius do not nest, and the faceted one surfaces through the
    # smooth one between its vertices as a patch of bare scalp.
    P["Head"].add(blob((0, 0.026, 1.880), (0.114, 0.132, 0.126)), "Hair")
    # The mass at the sides and back of the skull, carried down to the jaw so
    # the strands below have something to come *out of*. Without it the gaps
    # between the parting and the locks are holes with the room showing through,
    # and the whole head reads as a wig of separate ribbons. It is pushed back
    # far enough to clear the jaw's own front face — a mane centred on the skull
    # closes over the cheeks and she is wearing a balaclava.
    P["Head"].add(blob((0, 0.056, 1.812), (0.122, 0.116, 0.096), n=14, m=8), "Hair")
    # Centre parting: two ribbons whose every point is computed *on* the skull,
    # sitting a centimetre proud of it. That is the third approach to a hairline
    # and the first that works — a blob meets a skull along a level curve, which
    # is the brim of a cap, and straight sticks laid over the top leave the
    # surface the moment it curves and read as spikes. This cannot spike,
    # because it never leaves the head.
    for s in (-1, 1):
        P["Head"].add(
            sweep(
                [
                    (x, on_skull(x, z, 0.012), z)
                    for x, z in (
                        (s * 0.010, 1.986),
                        (s * 0.048, 1.960),
                        (s * 0.080, 1.918),
                        (s * 0.098, 1.860),
                    )
                ],
                [(0.013, 0.009), (0.019, 0.012), (0.021, 0.013), (0.017, 0.010)],
                n=6,
                e=2.6,
            ),
            "Hair",
        )
    # The two locks that fall in front of the shoulder, down over the chest.
    # These stay on the *head* on purpose: the long mass behind her is on the
    # `Cape` node, which the game swings backwards, and anything hanging down
    # her front on that node would be driven straight through her own ribs.
    # Flattened ribbons rather than tubes — a round section here reads as rope.
    for s in (-1, 1):
        for path, radii in (
            (
                (
                    (s * 0.062, -0.046, 1.958),
                    (s * 0.101, -0.064, 1.876),
                    (s * 0.111, -0.090, 1.792),
                    (s * 0.114, -0.126, 1.688),
                    (s * 0.132, -0.160, 1.576),
                    (s * 0.144, -0.172, 1.468),
                    (s * 0.126, -0.150, 1.374),
                ),
                (
                    (0.022, 0.014),
                    (0.028, 0.018),
                    (0.030, 0.019),
                    (0.030, 0.019),
                    (0.029, 0.018),
                    (0.024, 0.015),
                    (0.011, 0.008),
                ),
            ),
            (
                (
                    (s * 0.086, -0.010, 1.950),
                    (s * 0.124, -0.020, 1.858),
                    (s * 0.142, -0.046, 1.758),
                    (s * 0.160, -0.086, 1.648),
                    (s * 0.180, -0.120, 1.538),
                    (s * 0.188, -0.130, 1.438),
                    (s * 0.168, -0.110, 1.350),
                ),
                (
                    (0.023, 0.015),
                    (0.030, 0.019),
                    (0.032, 0.020),
                    (0.032, 0.020),
                    (0.030, 0.019),
                    (0.025, 0.016),
                    (0.012, 0.008),
                ),
            ),
        ):
            P["Head"].add(sweep(list(path), list(radii), n=7, e=2.2), "Hair")

    # The mass down her back, on the node the game damps behind the body. It
    # hangs off the nape and reaches the hip, so a walk swings roughly a
    # handspan of it — which is the single cheapest piece of motion on the
    # model, and the reason she does not need a cloak she is not wearing.
    #
    # `shell` measures its radius from the body axis, which for a cloak standing
    # off the back is fine and for hair lying *on* one is not: a single radius
    # wide enough to clear the shoulders is a hand's width behind the waist, and
    # what comes out is a hood. So the radius is the polar equation of an
    # ellipse instead, with the two semi-axes tracked down the body — hair over a
    # shoulder needs 0.20 across and 0.13 deep at the same height, and no
    # constant can be both.
    def hair_axis(pairs, u):
        for (u0, v0), (u1, v1) in zip(pairs, pairs[1:]):
            if u0 <= u <= u1:
                return v0 + (v1 - v0) * (u - u0) / (u1 - u0)
        return pairs[-1][1]

    across = ((0.0, 0.118), (0.18, 0.142), (0.36, 0.196), (0.62, 0.166), (0.82, 0.202), (1.0, 0.192))
    deep = ((0.0, 0.140), (0.18, 0.146), (0.36, 0.130), (0.62, 0.120), (0.82, 0.146), (1.0, 0.142))

    def hair_r(u, a):
        A, B = hair_axis(across, u), hair_axis(deep, u)
        r = A * B / math.sqrt((B * math.sin(a)) ** 2 + (A * math.cos(a)) ** 2)
        return r * (1 + 0.055 * math.sin(6.5 * a))

    P["Cape"].add(
        shell(
            [1.808, 1.720, 1.600, 1.450, 1.290, 1.140, 1.020],
            0.40 * math.pi,
            1.60 * math.pi,
            hair_r,
            na=20,
            t=0.030,
            yfun=lambda u: 0.004 + 0.014 * u,
            zfun=lambda u, a: -0.05 * u * math.cos(a) + 0.028 * u * math.sin(5.0 * a),
        ),
        "Hair",
    )
    # Two heavier falls at the outside edges, past the hem of the mass. A curtain
    # that ends on one level is a curtain; hair ends on several.
    for s in (-1, 1):
        P["Cape"].add(
            sweep(
                [
                    (s * 0.150, 0.072, 1.478),
                    (s * 0.176, 0.100, 1.320),
                    (s * 0.170, 0.086, 1.148),
                    (s * 0.138, 0.070, 0.982),
                ],
                [(0.052, 0.034), (0.056, 0.036), (0.048, 0.030), (0.020, 0.013)],
                n=6,
                e=2.6,
            ),
            "Hair",
        )

    return assemble(parts, "sorceress"), H


def grimoire():
    """
    The book, and nothing else — she carries no staff and no focus.

    Held the way the staff was, at (0.55, 0, 0) under the swing pivot, so it is
    modelled around its own spine: the cast animation drives this pivot forward
    and down, and a book pivoted on a corner would swing like a hatchet.
    """
    rune = emissive("Rune", (0.62, 0.42, 1.0), 3.0)
    p = Part("MageBook", (0, 0, 0))

    for s in (-1, 1):
        tilt = -s * 0.30
        p.add(slab((s * 0.150, 0.0, 0.036), (0.275, 0.325, 0.028), (0.0, tilt, 0.0)), "Leather")
        p.add(slab((s * 0.146, 0.0, 0.054), (0.245, 0.295, 0.016), (0.0, tilt, 0.0)), "Page")
        # Corner fittings, the one metal on it.
        for cy in (-1, 1):
            p.add(
                slab((s * 0.262, cy * 0.136, 0.074), (0.055, 0.055, 0.030), (0.0, tilt, 0.0)),
                "Gold",
            )
    # Spine, sitting low between the boards.
    p.add(
        column(
            [(0.0, 0, 0, 0.044, 0.170), (0.026, 0, 0, 0.048, 0.172), (0.048, 0, 0, 0.034, 0.164)],
            n=8,
            e=2.6,
        ),
        "Leather",
    )
    # Lines of script, and the sigil burning through the right-hand page.
    for i in range(3):
        p.add(slab((0.150, -0.06 + i * 0.06, 0.064), (0.170, 0.014, 0.006), (0.0, -0.30, 0.0)), "Rune")
    p.add(slab((-0.150, 0.0, 0.064), (0.090, 0.090, 0.006), (0.0, 0.30, 0.785)), "Rune")

    obj = p.build()
    shade(obj)
    print("book:", len(obj.data.polygons), "faces")
    return [obj]


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
        export_skins=False,
        export_animations=False,
        export_yup=True,
    )
    print("wrote", path, os.path.getsize(path), "bytes")


# ------------------------------------------------------------------- running


def preview(path, target=(0, 0, 1.0), dist=4.4, yaw=0.0, pitch=0.30, size=560, lens=62):
    """
    A flat-lit turnaround shot, for judging a silhouette without leaving the CLI.

    Workbench rather than a render engine: what matters here is the outline and
    the material split, both of which a studio light shows more honestly than a
    lighting rig that can flatter a shape into looking finished.
    """
    scene = bpy.context.scene
    cam = bpy.data.objects.get("PreviewCam")
    if not cam:
        cam = bpy.data.objects.new("PreviewCam", bpy.data.cameras.new("PreviewCam"))
        bpy.context.collection.objects.link(cam)
    t = Vector(target)
    eye = t + Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    cam.location = eye
    cam.rotation_euler = (t - eye).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    scene.camera = cam

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = False
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_cavity = True
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def stage(kind, path, tint=(1.0, 0.416, 0.239), dist=17.1, size=760):
    """
    The shade as the game frames it: weapon in hand, seat colour on the crest,
    and the camera where scene.ts puts it.

    That camera is a 42 degree lens at an offset of (0, 13.5, 10.5) — 52 degrees
    up, seventeen units out — which leaves a 2.1-unit body about a sixth of the
    frame high. Everything judged at arm's length in the front view has to
    survive being 115 pixels tall, and most of it does not. This is the shot
    that decides whether a silhouette works; the close ones only say why.
    """
    clear()
    body_fn, weapon_fn, rest = {
        "archer": (archer, bow, (0.1, 0.0, -0.2)),
        "mage": (sorceress, grimoire, (0.0, 0.0, -0.05)),
    }[kind]
    objs, _ = body_fn()
    held = weapon_fn()

    # fitToHeight scales the body to 2.1 and leaves the weapon alone, so the
    # preview has to do the same or the bow comes out 6% too big.
    bpy.context.view_layer.update()
    lo = min(min((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in objs)
    hi = max(max((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in objs)
    objs[0].scale = (2.1 / (hi - lo),) * 3
    for w in held:
        # Only the root. The bow's arrow is a child node so it can be drawn and
        # loosed, and placing it too would carry it out of the bow twice over.
        if w.parent:
            continue
        w.location = Vector((0.55, 0.0, 1.0))
        w.rotation_euler = Euler(rest, "XYZ")

    crest = bpy.data.materials.get("Crest")
    if crest:
        # sRGB in, linear out — Blender's viewport works in linear light and the
        # seat colours in player.ts are hex.
        lin = (*(c**2.2 for c in tint), 1.0)
        crest.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = lin
        crest.diffuse_color = lin

    return preview(
        path,
        target=(0, 0, 1.05),
        dist=dist,
        yaw=0.62,
        pitch=math.radians(52),
        size=size,
        lens=47,
    )


def build_all(models_dir, shots_dir=None):
    """Both shades and both weapons, from an empty scene to four .glb files."""
    out = []
    for name, fn, weapon_fn, weapon_name in (
        ("archer", archer, bow, "archer_bow"),
        ("mage", sorceress, grimoire, "mage_book"),
    ):
        clear()
        objs, _ = fn()
        export(objs, os.path.join(models_dir, f"{name}.glb"))
        if shots_dir:
            preview(os.path.join(shots_dir, f"{name}_front.png"), yaw=0.0)
            preview(os.path.join(shots_dir, f"{name}_three.png"), yaw=0.85, pitch=0.42)
        out.append(name)

        clear()
        w = weapon_fn()
        export(w, os.path.join(models_dir, f"{weapon_name}.glb"))
        if shots_dir:
            preview(os.path.join(shots_dir, f"{weapon_name}.png"), target=(0, 0, 0), dist=2.2, yaw=0.6)
        out.append(weapon_name)
    return out
