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

  archer.glb     seven nodes named for RIG_JOINTS in player.ts; -Y is front;
  mage.glb       feet on Z=0; centred on X/Y. The sorceress is robed, so she
                 has five — a hem that splits in two walks like a pair of
                 scissors.
  archer_bow.glb the weapon, pivoted on the grip and *never* fitToHeight'd:
  mage_book.glb  player.ts parents it at (0.55, 0, 0) under the swing pivot, in
                 game units, so its size here is its size on screen.

Materials survive on purpose. `loadAuthoredRig` clones whatever the file brings
and only repaints the one matching /crest/i with the seat colour, so the palette
below is what you will actually see — dark leather and aged gold, with the cloak
carrying the player's colour because at a 40 degree camera the cloak is the only
part big enough to tell four shades apart.
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
PALETTE = {
    "Leather": ((0.055, 0.043, 0.038), 0.78, 0.0),
    "Cloth": ((0.031, 0.030, 0.038), 0.94, 0.0),
    "Gold": ((0.44, 0.32, 0.13), 0.34, 0.85),
    "Iron": ((0.055, 0.055, 0.062), 0.46, 0.75),
    "Skin": ((0.60, 0.44, 0.34), 0.66, 0.0),
    "Hair": ((0.16, 0.11, 0.07), 0.82, 0.0),
    "Wood": ((0.085, 0.056, 0.038), 0.72, 0.0),
    "Page": ((0.42, 0.38, 0.31), 0.88, 0.0),
    # Repainted per seat at load. The values here are only what a lone shade
    # wears in a screenshot; roughness and metalness are what survive.
    "Crest": ((0.14, 0.11, 0.16), 0.88, 0.02),
}


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
    H = 2.0
    parts = [
        Part("Pelvis", (0, 0, 0.98)),
        Part("Torso", (0, 0, 1.14), "Pelvis"),
        Part("Head", (0, 0, 1.66), "Torso"),
        Part("ArmL", (-0.30, 0, 1.53), "Torso"),
        Part("ArmR", (0.30, 0, 1.53), "Torso"),
        Part("LegL", (-0.13, 0, 0.96), "Pelvis"),
        Part("LegR", (0.13, 0, 0.96), "Pelvis"),
    ]
    P = {p.name: p for p in parts}

    # Legs: boot, calf, thigh in one taper. The boot is longer than it is wide,
    # which is the only thing that keeps a leg from reading as a pipe.
    for name, s in (("LegL", -1), ("LegR", 1)):
        x = s * 0.13
        P[name].add(
            column(
                [
                    (0.00, x, -0.052, 0.086, 0.152),
                    (0.06, x, -0.044, 0.100, 0.163),
                    (0.16, x, 0.000, 0.078, 0.092),
                    (0.30, x, 0.005, 0.095, 0.102),
                    (0.52, x, 0.000, 0.082, 0.088),
                    (0.74, x, 0.000, 0.099, 0.106),
                    (0.99, x, 0.000, 0.118, 0.122),
                ],
                n=12,
                e=2.4,
            ),
            "Leather",
        )
        # Wrapped greave — a band, not a boot top, so the leg has a joint.
        P[name].add(
            column([(0.17, x, 0.0, 0.092, 0.104), (0.30, x, 0.005, 0.107, 0.114)], n=12, e=2.4),
            "Cloth",
        )

    # Hips, belt, and the leather tassets hanging off the front of it.
    P["Pelvis"].add(
        column(
            [
                (0.82, 0, 0, 0.185, 0.140),
                (0.94, 0, 0, 0.205, 0.152),
                (1.06, 0, 0, 0.212, 0.158),
            ],
            n=14,
            e=2.6,
        ),
        "Leather",
    )
    P["Pelvis"].add(
        column([(1.00, 0, 0, 0.228, 0.172), (1.11, 0, 0, 0.224, 0.168)], n=14, e=2.6),
        "Leather",
    )
    P["Pelvis"].add(disc((0, -0.168, 1.055), 0.072, 0.036, 16, "y"), "Gold")
    P["Pelvis"].add(disc((0, -0.180, 1.055), 0.100, 0.018, 16, "y", inner=0.082), "Gold")
    for i, (dx, ang) in enumerate(((-0.135, 0.5), (0.0, 0.0), (0.135, -0.5))):
        P["Pelvis"].add(
            slab((dx, -0.150 + abs(dx) * 0.28, 0.885), (0.145, 0.045, 0.30), (0.06, 0, ang)),
            "Leather",
        )

    # Cuirass: narrow at the waist, broad across the chest, and a yoke that
    # stops under the collarbone so the cloak has somewhere to sit.
    P["Torso"].add(
        column(
            [
                (0.99, 0, 0, 0.196, 0.150),
                (1.13, 0, 0, 0.180, 0.140),
                (1.30, 0, 0, 0.234, 0.166),
                (1.45, 0, 0, 0.266, 0.178),
                (1.56, 0, 0.005, 0.252, 0.164),
                (1.63, 0, 0.005, 0.198, 0.136),
            ],
            n=14,
            e=2.5,
        ),
        "Leather",
    )
    P["Torso"].add(column([(1.58, 0, 0.01, 0.078, 0.078), (1.70, 0, 0.01, 0.072, 0.072)], n=10), "Skin")

    # Baldric across the chest, and the quiver strap under it.
    P["Torso"].add(
        sweep(
            [(-0.175, -0.135, 1.06), (-0.06, -0.200, 1.24), (0.12, -0.175, 1.44), (0.215, -0.02, 1.56)],
            [(0.030, 0.014), (0.034, 0.014), (0.032, 0.014), (0.030, 0.014)],
            n=6,
        ),
        "Cloth",
    )
    # The brooch pins the cloak where it comes over the shoulder — the same
    # place the portrait puts it, and the only reason the gathered roll below
    # reads as fastened rather than draped.
    P["Torso"].add(disc((-0.150, -0.180, 1.442), 0.052, 0.028, 14, "y"), "Gold")
    P["Torso"].add(disc((-0.150, -0.190, 1.442), 0.074, 0.014, 14, "y", inner=0.060), "Gold")

    # The cloak. Wrapped from one front edge round the back to the other, with a
    # fold ripple, a hem that drifts backwards as it falls, and front edges that
    # ride up — a cape whose rows are all level is a plank seen from the side.
    P["Torso"].add(
        shell(
            [1.64, 1.54, 1.38, 1.16, 0.94, 0.74, 0.60],
            0.40 * math.pi,
            1.60 * math.pi,
            lambda u, a: (0.280 + 0.165 * u * (1 - 0.28 * u)) * (1 + 0.055 * math.sin(6.5 * a)),
            na=16,
            t=0.040,
            # Kept close to the back. Every centimetre the hem trails is a
            # centimetre `centre` slides the whole body forward off its hitbox.
            yfun=lambda u: 0.010 + 0.045 * u,
            zfun=lambda u, a: u * (0.26 * math.exp(-((a - 0.40 * math.pi) / 0.75) ** 2)
                                   + 0.26 * math.exp(-((a - 1.60 * math.pi) / 0.75) ** 2)
                                   - 0.05 * math.sin(3 * a)),
        ),
        # Not the crest. The mantle above already carries the seat colour, and
        # painting the long cape as well makes the whole shade one hue — which
        # is legible, and the opposite of the portrait, where the colour is one
        # note against a lot of black.
        "Cloth",
    )
    # The mantle: the same cloth come over both shoulders and stopped at the
    # bicep. It is doing three jobs — it is the widest thing on the shade from
    # directly above, which is where the seat colour has to be legible; it puts
    # the arms *under* a garment instead of hanging off ball joints; and it is
    # the shape the portrait leads with.
    # It has to *start at the neck* and flare from there. Begun at full width it
    # is a bucket standing on the collarbones, which is what a constant-radius
    # top row gives you no matter how well the hem behaves.
    def over_shoulder(u, a):
        near = min(abs(a - 0.5 * math.pi), abs(a - 1.5 * math.pi))
        peak = 0.115 * math.exp(-((near / 0.60) ** 2)) * min(1.0, u * 2.6)
        return (0.115 + 0.215 * u**0.55 + peak) * (1 + 0.05 * math.sin(7 * a))

    P["Torso"].add(
        shell(
            [1.700, 1.655, 1.590, 1.500, 1.395, 1.300],
            0.30 * math.pi,
            1.70 * math.pi,
            over_shoulder,
            na=18,
            t=0.038,
            yfun=lambda u: 0.010 + 0.020 * u,
            zfun=lambda u, a: -u * 0.06 * math.cos(a),
        ),
        "Crest",
    )
    # Where it is gathered and pinned, under the brooch.
    P["Torso"].add(
        sweep(
            [(-0.245, -0.135, 1.55), (-0.195, -0.185, 1.44), (-0.135, -0.175, 1.33)],
            [(0.060, 0.048), (0.070, 0.052), (0.052, 0.040)],
            n=7,
            e=2.4,
        ),
        "Crest",
    )

    # Quiver, riding high on the weapon side, and the shafts standing out of it.
    P["Torso"].add(
        sweep(
            [(0.115, 0.180, 0.95), (0.20, 0.158, 1.25), (0.285, 0.130, 1.58)],
            [(0.070, 0.070), (0.078, 0.078), (0.086, 0.086)],
            n=9,
        ),
        "Leather",
    )
    P["Torso"].add(disc((0.293, 0.147, 1.60), 0.090, 0.020, 12, "z"), "Gold")
    for i in range(6):
        k = i / 5 - 0.5
        top = Vector((0.285 + k * 0.10, 0.150 + (i % 2) * 0.045 - 0.02, 1.95 - abs(k) * 0.05))
        base = Vector((0.24 + k * 0.05, 0.165, 1.44))
        P["Torso"].add(sweep([base, top], [(0.013, 0.013), (0.012, 0.012)], n=4), "Wood")
        for rot in (0.0, math.pi / 2):
            P["Torso"].add(
                slab(
                    (top.x, top.y, top.z - 0.055),
                    (0.052, 0.006, 0.095),
                    (0.0, 0.0, rot),
                ),
                "Cloth",
            )

    # Head: skull, jaw, and the wavy hair from the portrait — a crown mass plus
    # loose locks, because one smooth cap reads as a helmet.
    P["Head"].add(blob((0, 0.012, 1.805), (0.132, 0.142, 0.160)), "Skin")
    P["Head"].add(blob((0, -0.030, 1.725), (0.104, 0.116, 0.086)), "Skin")
    P["Head"].add(blob((0, -0.118, 1.792), (0.021, 0.026, 0.030), n=8, m=6), "Skin")
    # Wider than the skull by a clear margin on every axis. Two ellipsoids of
    # nearly the same radius do not nest: the faceted one dips inside the smooth
    # one between its vertices, and a patch of scalp surfaces through the hair.
    P["Head"].add(blob((0, 0.034, 1.842), (0.156, 0.164, 0.158)), "Hair")
    # Bangs swept across the brow, as one ribbon rather than a band around it.
    # A band gives the skull a straight edge, and a straight edge on a skull is
    # the rim of a helmet whatever colour it is painted.
    P["Head"].add(
        sweep(
            [
                (-0.130, -0.020, 1.902),
                (-0.055, -0.088, 1.906),
                (0.045, -0.092, 1.888),
                (0.128, -0.030, 1.878),
            ],
            [(0.048, 0.030), (0.062, 0.038), (0.058, 0.036), (0.040, 0.026)],
            n=6,
            e=2.6,
        ),
        "Hair",
    )
    # Locks: flattened ribbons, not tubes, and started inside the crown so they
    # read as one mass breaking up rather than sausages hung off a ball.
    for s in (-1, 1):
        for out, back, wave in ((0.80, -0.30, 1.0), (1.0, 0.35, -1.0), (0.82, 1.0, 1.0)):
            P["Head"].add(
                sweep(
                    [
                        (s * 0.085 * out, 0.02 + back * 0.05, 1.900),
                        (s * 0.125 * out, 0.035 + back * 0.075 + wave * 0.012, 1.815),
                        (s * 0.128 * out, 0.020 + back * 0.092 - wave * 0.014, 1.725),
                        (s * 0.118 * out, 0.055 + back * 0.088 + wave * 0.010, 1.645),
                    ],
                    [(0.052, 0.030), (0.058, 0.034), (0.050, 0.030), (0.026, 0.016)],
                    n=6,
                    e=2.6,
                ),
                "Hair",
            )

    # Arms hang slightly splayed: the game parents the bow out at x=0.55, and a
    # hand pinned to the ribs leaves it floating in space.
    for name, s in (("ArmL", -1), ("ArmR", 1)):
        # No pauldron: the mantle is the shoulder. A cap here would be a sphere
        # inside a cloak that swings independently of it, and the first time the
        # arm came forward it would push through the cloth.
        P[name].add(
            sweep(
                [
                    (s * 0.288, 0.0, 1.530),
                    (s * 0.330, 0.010, 1.330),
                    (s * 0.352, -0.020, 1.140),
                    (s * 0.368, -0.070, 1.020),
                ],
                [(0.098, 0.098), (0.078, 0.078), (0.066, 0.066), (0.058, 0.058)],
                n=8,
            ),
            "Leather",
        )
        P[name].add(
            sweep(
                [(s * 0.350, -0.018, 1.150), (s * 0.366, -0.058, 1.045)],
                [(0.076, 0.076), (0.070, 0.070)],
                n=8,
            ),
            "Cloth",
        )
        P[name].add(disc((s * 0.368, -0.066, 1.025), 0.074, 0.016, 10, "z"), "Gold")
        P[name].add(blob((s * 0.372, -0.100, 0.975), (0.054, 0.060, 0.066), n=10, m=6), "Leather")

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

    # String and the arrow on it. A bow with nothing nocked reads as a harp.
    p.add(sweep([(0, 0.014, 0.79), (0, 0.017, 0.0), (0, 0.014, -0.79)], [0.008] * 3, n=4), "Sinew")
    p.add(sweep([(0, 0.030, 0.012), (0, -0.60, 0.012)], [(0.012, 0.012)] * 2, n=5), "Wood")
    p.add(sweep([(0, -0.60, 0.012), (0, -0.70, 0.012)], [(0.022, 0.022), (0.002, 0.002)], n=6), "Iron")
    p.add(slab((0, -0.010, 0.012), (0.005, 0.105, 0.052)), "Cloth")
    p.add(slab((0, -0.010, 0.012), (0.052, 0.105, 0.005)), "Cloth")

    obj = p.build()
    shade(obj)
    print("bow:", len(obj.data.polygons), "faces")
    return [obj]


# ------------------------------------------------------------- the sorceress
#
# From shade-mage.jpg: a heavy mantle with peaked shoulders and a collar
# standing behind the head, black layered cloth under it, one wide belt on a
# star boss, and hair piled into a high bun with curls loose at the sides. She
# gets five nodes, not seven — the hem is one piece of cloth, and cutting it in
# two so the game can swing a leg through it turns a robe into a pair of
# scissors.


def sorceress():
    H = 2.0
    parts = [
        Part("Pelvis", (0, 0, 1.00)),
        Part("Torso", (0, 0, 1.14), "Pelvis"),
        Part("Head", (0, 0, 1.66), "Torso"),
        Part("ArmL", (-0.27, 0, 1.52), "Torso"),
        Part("ArmR", (0.27, 0, 1.52), "Torso"),
    ]
    P = {p.name: p for p in parts}

    # The skirt is the whole lower half of the silhouette, so it carries the
    # folds. Nine of them, shallow — enough to break the cone, not so many that
    # the decimator would be the only thing that ever saw them.
    P["Pelvis"].add(
        column(
            [
                (0.00, 0, 0.02, 0.455, 0.400),
                (0.13, 0, 0.02, 0.440, 0.386),
                (0.34, 0, 0.01, 0.372, 0.332),
                (0.58, 0, 0.00, 0.298, 0.268),
                (0.80, 0, 0.00, 0.236, 0.210),
                (0.97, 0, 0.00, 0.190, 0.166),
                (1.08, 0, 0.00, 0.176, 0.150),
            ],
            n=18,
            e=2.1,
            flute=(9, 0.045),
        ),
        "Cloth",
    )
    # An open over-panel down the front, the layer the portrait's belt sits on.
    P["Pelvis"].add(
        shell(
            [1.06, 0.90, 0.66, 0.40, 0.18],
            -0.30 * math.pi,
            0.30 * math.pi,
            lambda u, a: (0.190 + 0.185 * u) * (1 + 0.05 * math.cos(5 * a)),
            na=11,
            t=0.030,
        ),
        "Crest",
    )

    # Bodice, belt, and the star boss on it.
    P["Torso"].add(
        column(
            [
                (0.98, 0, 0, 0.180, 0.148),
                (1.14, 0, 0, 0.166, 0.138),
                (1.30, 0, 0, 0.202, 0.156),
                (1.42, 0, 0.005, 0.214, 0.164),
                (1.53, 0, 0.005, 0.196, 0.148),
                (1.61, 0, 0.005, 0.152, 0.120),
            ],
            n=14,
            e=2.2,
        ),
        "Cloth",
    )
    P["Torso"].add(column([(1.56, 0, 0.01, 0.070, 0.070), (1.70, 0, 0.01, 0.064, 0.064)], n=10), "Skin")
    P["Torso"].add(
        column([(0.99, 0, 0, 0.196, 0.162), (1.13, 0, 0, 0.190, 0.156)], n=14, e=2.3), "Leather"
    )
    P["Torso"].add(disc((0, -0.158, 1.055), 0.068, 0.034, 16, "y"), "Gold")
    # Four bars through one centre: the star on the buckle in the portrait, and
    # the only ornament on her that is allowed to catch the key light.
    for ang in (0.0, math.pi / 2, math.pi / 4, -math.pi / 4):
        P["Torso"].add(slab((0, -0.166, 1.055), (0.185, 0.020, 0.026), (0, ang, 0)), "Gold")
    # Chain collar and the pendant hanging off it.
    P["Torso"].add(disc((0, 0.0, 1.470), 0.118, 0.014, 18, "z", inner=0.098), "Gold")
    P["Torso"].add(disc((0, -0.005, 1.410), 0.150, 0.012, 18, "z", inner=0.134), "Gold")
    P["Torso"].add(slab((0, -0.150, 1.360), (0.055, 0.022, 0.075), (0.0, math.pi / 4, 0.0)), "Gold")

    # The mantle: one piece of cloth from the neck to below the knee. It leaves
    # the collar narrow, reaches full width across the shoulders within a
    # handspan, and carries a peak there — which is the portrait's whole
    # silhouette, and the only part of her a player sees from directly above.
    #
    # The peak is made twice: once in radius, so it juts out, and once in height
    # through `zfun`, so it rises. Radius alone gives a cape with wide hips
    # halfway up its back, which is not the same shape at all.
    # Two garments, not one, and the split is what keeps her dark: the seat
    # colour stops at the bicep and everything below it is black. One violet
    # column from collar to floor is legible from the moon and has nothing to do
    # with the portrait, where the colour is one note against a lot of black.
    edge_tuck = lambda u, a: 1.0 - 0.36 * u * math.exp(
        -((min(abs(a - 0.34 * math.pi), abs(a - 1.66 * math.pi)) / 0.60) ** 2)
    )

    def mantle(u, a):
        near = min(abs(a - 0.5 * math.pi), abs(a - 1.5 * math.pi))
        flare = 0.120 + 0.235 * min(1.0, u * 2.1) ** 0.6
        peak = 0.150 * math.exp(-((near / 0.42) ** 2)) * math.exp(-(((u - 0.27) / 0.22) ** 2))
        return (flare + peak) * edge_tuck(u, a) * (1 + 0.045 * math.sin(7 * a))

    P["Torso"].add(
        shell(
            [1.700, 1.660, 1.600, 1.500, 1.340, 1.150],
            0.34 * math.pi,
            1.66 * math.pi,
            mantle,
            na=20,
            t=0.042,
            yfun=lambda u: 0.015 + 0.030 * u,
            zfun=lambda u, a: (
                0.055
                * math.exp(-((min(abs(a - 0.5 * math.pi), abs(a - 1.5 * math.pi)) / 0.36) ** 2))
                * math.exp(-(((u - 0.27) / 0.20) ** 2))
                - u * 0.05 * math.cos(a)
            ),
        ),
        "Crest",
    )
    P["Torso"].add(
        shell(
            [1.180, 1.020, 0.820, 0.600, 0.400, 0.260],
            0.34 * math.pi,
            1.66 * math.pi,
            lambda u, a: (0.352 + 0.130 * u * (1 - 0.30 * u))
            * edge_tuck(0.5 + 0.5 * u, a)
            * (1 + 0.045 * math.sin(7 * a)),
            na=20,
            t=0.042,
            yfun=lambda u: 0.045 + 0.045 * u,
            zfun=lambda u, a: u * 0.20 * (
                math.exp(-((a - 0.34 * math.pi) / 0.7) ** 2)
                + math.exp(-((a - 1.66 * math.pi) / 0.7) ** 2)
            ),
        ),
        "Cloth",
    )
    # Collar standing behind the head — the one piece that says sacral rather
    # than merely dark, framing the skull the way the halo does in the portrait.
    # Kept narrow: a wide one is a trumpet, and she is not a gramophone.
    P["Torso"].add(
        shell(
            [1.60, 1.72, 1.84],
            0.62 * math.pi,
            1.38 * math.pi,
            lambda u, a: 0.170 + 0.075 * u,
            na=14,
            t=0.030,
            yfun=lambda u: 0.02 + 0.055 * u,
        ),
        "Crest",
    )

    # Head, and the piled hair that is her whole outline from above.
    P["Head"].add(blob((0, 0.012, 1.792), (0.124, 0.134, 0.152)), "Skin")
    P["Head"].add(blob((0, -0.028, 1.718), (0.098, 0.110, 0.082)), "Skin")
    P["Head"].add(blob((0, 0.030, 1.840), (0.152, 0.158, 0.154)), "Hair")
    # The bun. Pulled back rather than stacked on top, so the head keeps one
    # outline instead of turning into a snowman.
    P["Head"].add(blob((0, 0.080, 1.900), (0.108, 0.106, 0.092), n=12, m=7), "Hair")
    P["Head"].add(disc((0, -0.118, 1.862), 0.022, 0.014, 8, "y"), "Gold")
    # Curls: ribbons with a wave in them, hugging the jaw. Round tubes here read
    # as rope, which is the difference between loose hair and a wig of cables.
    for s in (-1, 1):
        for out, back, wave in ((0.85, -0.15, 1.0), (1.05, 0.45, -1.0), (0.88, 1.00, 1.0)):
            P["Head"].add(
                sweep(
                    [
                        (s * 0.085 * out, 0.02 + back * 0.05, 1.900),
                        (s * 0.128 * out, 0.035 + back * 0.075 + wave * 0.014, 1.790),
                        (s * 0.120 * out, 0.010 + back * 0.095 - wave * 0.016, 1.665),
                        (s * 0.138 * out, 0.050 + back * 0.090 + wave * 0.012, 1.545),
                        (s * 0.104 * out, 0.020 + back * 0.085, 1.430),
                    ],
                    [(0.050, 0.032), (0.058, 0.038), (0.052, 0.034), (0.044, 0.028), (0.022, 0.014)],
                    n=6,
                    e=2.6,
                ),
                "Hair",
            )

    # Sleeves: fitted at the shoulder, flaring into a hanging cuff. The flare is
    # what keeps her reading as a robe from directly above, where the mantle
    # foreshortens into nothing.
    for name, s in (("ArmL", -1), ("ArmR", 1)):
        P[name].add(
            sweep(
                [
                    (s * 0.270, 0.000, 1.520),
                    (s * 0.330, 0.005, 1.320),
                    (s * 0.355, -0.030, 1.140),
                    (s * 0.372, -0.090, 1.010),
                ],
                [(0.092, 0.096), (0.082, 0.086), (0.074, 0.078), (0.058, 0.062)],
                n=8,
            ),
            "Cloth",
        )
        P[name].add(
            column(
                [
                    (1.15, s * 0.355, -0.030, 0.082, 0.084),
                    (1.02, s * 0.368, -0.075, 0.098, 0.100),
                    (0.92, s * 0.376, -0.098, 0.112, 0.112),
                ],
                n=12,
                e=2.1,
                flute=(6, 0.06),
            ),
            "Cloth",
        )
        P[name].add(blob((s * 0.376, -0.130, 0.960), (0.050, 0.056, 0.062), n=10, m=6), "Skin")

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
