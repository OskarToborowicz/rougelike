"""
Turn a raw sculpt or generator export into a model this game can ship.

Run it one of two ways:

    # headless, if `blender` is a normal install on PATH
    blender --background --python tools/prep_model.py -- in.glb out.glb --budget boss

    # inside Blender (Text Editor, or over the MCP bridge)
    exec(open(r"tools/prep_model.py").read())
    prep(r"in.glb", r"public/models/foo.glb", budget="boss")

The pipeline is deliberately conservative: every step that costs quality is
gated on a measurement, so a mesh that is already clean is left alone. The one
that is not — 30% non-manifold edges, 89 loose shells, the state minotaur.glb
arrived in — gets rebuilt, because nothing downstream can decimate that.
"""

import json
import math
import sys

import bmesh
import bpy
import mathutils
from mathutils import Euler

# --------------------------------------------------------------------- budgets
#
# Triangle ceilings per role, measured against what the game already ships:
# the player's warrior is 1.4k and is on screen every frame of every run, the
# pillar prop is 7.6k. Anything here is a ceiling, not a target — come in under
# it and nobody will ever ask why.
#
# Two multipliers to keep in mind when these feel stingy:
#   · addOutline() clones every mesh into an inverted hull, so the real
#     on-screen cost is 2x what you see in Blender
#   · commons arrive in crowds; a boss is one body
BUDGETS = {
    "common": 2_000,
    "elite": 4_000,
    "boss": 20_000,
    "prop": 8_000,
    # Raised from 8k once the cost was actually measured rather than assumed.
    # Four heroes here, outline shells included, draw 160k against a chamber's
    # 85k of scenery — and no GPU of the last decade cares about a quarter of a
    # million triangles. What does cost is draw calls, which scale with
    # materials times joints and not with this number at all; glb-info.mjs
    # keeps that ceiling separately. warrior.glb is 1.4k and stays there
    # because it was modelled that way, not because a hero has to be.
    "player": 16_000,
}

# Above this share of non-manifold edges the mesh cannot be decimated — collapse
# refuses any edge that would worsen the topology, so it plateaus far above the
# target no matter what ratio you hand it. Below it, remeshing would throw away
# good topology for nothing.
REMESH_ABOVE = 0.02

# Voxels across the model's height when a remesh is unavoidable. 240 keeps horn
# tips and an axe blade; much coarser and thin features melt into the body.
REMESH_STEPS = 240

# Smooth shading stops here, so plate armour and blade edges stay crisp instead
# of turning into soap.
SHARP_ANGLE = math.radians(30)


def _stats(mesh):
    """Topology health, the two numbers that decide what this script does."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    edges = len(bm.edges)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)

    seen, parts = set(), 0
    for v in bm.verts:
        if v.index in seen:
            continue
        parts += 1
        stack = [v]
        seen.add(v.index)
        while stack:
            w = stack.pop()
            for e in w.link_edges:
                o = e.other_vert(w)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)

    out = {
        "tris": len(mesh.polygons),
        "verts": len(mesh.vertices),
        "edges": edges,
        "non_manifold": non_manifold,
        "non_manifold_ratio": round(non_manifold / edges, 4) if edges else 0.0,
        "loose_parts": parts,
    }
    bm.free()
    return out


def _weld(obj, threshold=0.0001):
    """
    Merge coincident vertices.

    Exporters routinely split every vertex three ways to carry flat normals.
    That alone quadrupled minotaur.glb to 45MB, and — worse — a split vertex is
    a seam the collapse decimator will not cross, so this has to happen first or
    the budget is unreachable.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=threshold)
    bm.to_mesh(obj.data)
    after = len(obj.data.vertices)
    bm.free()
    obj.data.update()
    return before, after


def _remesh(obj, steps=REMESH_STEPS):
    """Rebuild the surface as one closed manifold shell. Destructive by nature."""
    bpy.context.view_layer.objects.active = obj
    obj.data.remesh_voxel_size = max(obj.dimensions) / steps
    obj.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()


def _clear_scene():
    """Empty the scene. Not via select_all — that operator's poll fails when
    there is nothing to select, so the second run in a session throws."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def audit(src):
    """
    Measure what a generator actually handed you, before any of it is your fault.

    Every number below is a knob on the generator, not on this pipeline:

      nm_after_weld  Non-manifold edges once split vertices are merged. A real
                     surface is 0.00. Anything above ~0.05 is a soup of
                     interpenetrating sheets, and no decimator will save it.
      shells         Connected pieces after welding. Hundreds mean the isosurface
                     broke into scraps; the triangle floor is four times this.
      genus          Tunnels through the surface. Collapse decimation preserves
                     topology and cannot close a single one, so this is a hard
                     floor on how far the mesh can be reduced — the number that
                     decides whether an asset can ship at all.

    Run it on a raw export, change one setting in the graph, run it again. That
    is the whole loop.
    """
    _clear_scene()
    bpy.ops.import_scene.gltf(filepath=src)

    rows = []
    for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        raw = _stats(obj.data)
        _weld(obj)
        s = _stats(obj.data)
        genus = (2 - (s["verts"] - s["edges"] + s["tris"])) // 2
        rows.append(
            {
                "name": obj.name,
                "tris": raw["tris"],
                "verts_before_weld": raw["verts"],
                "verts": s["verts"],
                "nm_after_weld": s["non_manifold_ratio"],
                "shells": s["loose_parts"],
                "genus": genus,
            }
        )
        print(
            f"{obj.name:14s} {raw['tris']:8d} tris  weld {raw['verts']:8d}->{s['verts']:7d} verts  "
            f"nm={s['non_manifold_ratio']:.3f}  shells={s['loose_parts']:6d}  genus~{genus}"
        )
    print("AUDIT " + json.dumps(rows))
    return rows


def _prune_shells(obj, keep=0.02):
    """
    Throw away every connected shell far smaller than the biggest one.

    Collapse decimation cannot delete a shell — the best it can do is reduce one
    to a tetrahedron — so the triangle floor of a mesh is four times its number
    of components. A voxel remesh of tattered cloth produces thousands of them:
    every loose thread and every islanded scrap of lace becomes its own closed
    surface. That is why the sorceress' torso would not go below 16 876
    triangles no matter what ratio it was handed, at a budget of 1 600.

    Judged against the largest shell rather than an absolute size, so it is
    resolution-independent: what survives is what a viewer could actually see.
    """
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bm.faces.index_update()

    seen, groups = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, comp = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        groups.append(comp)

    before = len(groups)
    if before > 1:
        floor = max(len(g) for g in groups) * keep
        doomed = [f for g in groups if len(g) < floor for f in g]
        if doomed:
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
    # Deleting faces leaves the survivors' winding untouched but drops the
    # guarantee anything downstream had about it. QuadriFlow refuses a mesh
    # whose normals disagree, and refuses it silently enough to look like it ran.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    after = _stats(obj.data)["loose_parts"]
    return before, after


def _decimate(obj, target):
    """
    Collapse to the budget.

    Symmetry is on because a humanoid decimated asymmetrically reads as damaged
    — one horn keeps its silhouette while the other goes faceted, and the eye
    catches that long before it counts triangles.
    """
    tri = obj.modifiers.new("Tri", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=tri.name)

    n = len(obj.data.polygons)
    if n <= target:
        return n

    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = target / n
    mod.use_collapse_triangulate = True
    try:
        mod.use_symmetry = True
        mod.symmetry_axis = "X"
    except AttributeError:
        pass  # older Blender; asymmetric collapse still hits the budget
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return len(obj.data.polygons)


"""
Where a standing humanoid gets cut, as fractions of its own height.

Defaults are ordinary human proportions, not this model's. Every sculpt is a
little different, so `prep(..., split_at={...})` overrides any of them and the
report prints the triangle count that landed in each part — a limb that comes
back at 30 triangles means the plane missed.
"""
SPLIT_AT = {
    "waist": 0.52,  # pelvis ends, torso begins
    "neck": 0.84,
    "shoulder": 0.72,  # arms are only separated above this
    "arm_x": 0.52,  # |x| beyond this share of half-width, above the waist
}

# Origin of each part, as (share of height, share of half-width). The part turns
# around this point, so it has to sit on the joint and not in the middle of the
# mesh — an origin in the centre of a limb makes it spin like a propeller.
JOINT_AT = {
    "Pelvis": (0.52, 0.0),
    "Torso": (0.60, 0.0),
    "Head": (0.84, 0.0),
    "ArmL": (0.78, -0.62),
    "ArmR": (0.78, 0.62),
    "LegL": (0.50, -0.28),
    "LegR": (0.50, 0.28),
}

# Parent of each part. Rotating the torso has to carry the arms and the head
# with it — that nesting is what makes a turn read as one movement.
JOINT_PARENT = {
    "Pelvis": None,
    "Torso": "Pelvis",
    "Head": "Torso",
    "ArmL": "Torso",
    "ArmR": "Torso",
    "LegL": "Pelvis",
    "LegR": "Pelvis",
    # Articulated rigs add a second segment per limb, plus the one piece of
    # cloth that swings on its own. See RIG_JOINTS in player.ts.
    "ForearmL": "ArmL",
    "ForearmR": "ArmR",
    "ShinL": "LegL",
    "ShinR": "LegR",
    "Cape": "Torso",
}


def _classify(co, lo, hi, at, legs):
    """Which part a face belongs to, from where its centre sits in the bounds."""
    h = hi.z - lo.z or 1.0
    half = max(hi.x - lo.x, 1e-6) / 2
    fz = (co.z - lo.z) / h
    fx = co.x / half  # already centred on the pivot by _place

    if fz >= at["neck"]:
        return "Head"
    if fz >= at["shoulder"] and abs(fx) >= at["arm_x"]:
        return "ArmL" if fx < 0 else "ArmR"
    if fz >= at["waist"]:
        # Arms hanging at the sides reach well below the shoulder line.
        if abs(fx) >= at["arm_x"]:
            return "ArmL" if fx < 0 else "ArmR"
        return "Torso"
    if legs:
        return "LegL" if fx < 0 else "LegR"
    return "Pelvis"


def _split_humanoid(obj, legs=True, at=None):
    """
    Cut one sculpted body into the named, nested nodes the game animates.

    The game does no skinning: `animateBody` in player.ts rotates named nodes,
    each around its own origin, and a mesh that arrives as a single object has
    nothing to rotate. This carves that hierarchy out of the sculpt by where the
    geometry sits, which is crude but repeatable — and every part is reported so
    a bad cut is visible before it ships.
    """
    at = {**SPLIT_AT, **(at or {})}
    me = obj.data
    lo = mathutils.Vector((min(v.co.x for v in me.vertices), 0, min(v.co.z for v in me.vertices)))
    hi = mathutils.Vector((max(v.co.x for v in me.vertices), 0, max(v.co.z for v in me.vertices)))
    h = hi.z - lo.z
    half = (hi.x - lo.x) / 2

    groups = {}
    for poly in me.polygons:
        groups.setdefault(_classify(poly.center, lo, hi, at, legs), []).append(poly.index)

    # Separate by selection, one part at a time; whatever is left over stays on
    # the original object and becomes the root.
    parts = {}
    order = [n for n in ("Head", "ArmL", "ArmR", "Torso", "LegL", "LegR") if n in groups]
    for name in order:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
        # Face indices shift as parts leave, so the set is recomputed each pass.
        for poly in obj.data.polygons:
            poly.select = _classify(poly.center, lo, hi, at, legs) == name
        if not any(p.select for p in obj.data.polygons):
            continue
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        new = [o for o in bpy.context.selected_objects if o is not obj][-1]
        new.name = name
        parts[name] = new

    obj.name = "Pelvis"
    parts["Pelvis"] = obj

    # Origins onto the joints, then the hierarchy. Parenting keeps the world
    # transform, so this is purely a change of pivot and of who follows whom.
    for name, part in parts.items():
        fz, fx = JOINT_AT[name]
        cursor = bpy.context.scene.cursor.location.copy()
        bpy.context.scene.cursor.location = (fx * half, 0.0, lo.z + fz * h)
        bpy.ops.object.select_all(action="DESELECT")
        part.select_set(True)
        bpy.context.view_layer.objects.active = part
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        bpy.context.scene.cursor.location = cursor

    for name, part in parts.items():
        parent = JOINT_PARENT[name]
        if parent and parent in parts:
            part.parent = parts[parent]
            part.matrix_parent_inverse = parts[parent].matrix_world.inverted()

    return {n: len(p.data.polygons) for n, p in parts.items()}


def _unwrap_cylindrical(obj):
    """
    Wrap the body in a cylinder around Z: u is the angle, v is the height.

    Computed from vertex positions rather than run through Blender's unwrapper,
    because the texture this feeds is not arbitrary. makeBodySkin paints a
    vertical light-to-dark ramp with horizontal armour bands and expects v=1 at
    the top of the body — Smart UV Project would scatter the mesh into islands
    and slice that ramp into confetti.

    Only v carries meaning: every band in that texture spans the full width, so
    u exists to keep the grime speckle from repeating, nothing more.

    v is written **inverted** on purpose. Blender puts v=0 at the bottom of an
    image and glTF puts it at the top, so the exporter flips the coordinate on
    the way out; writing the obvious `height / span` here lands v=0 on the head
    in game, which paints black horns and brightly lit hooves. Verified against
    the loaded model, not assumed.
    """
    me = obj.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name="UVMap")

    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    span = (hi - lo) or 1.0

    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            us.append(math.atan2(co.y, co.x) / (2 * math.pi) + 0.5)
        # A face straddling the back seam would otherwise smear the whole
        # texture across itself; push its low corners round to the far side.
        if max(us) - min(us) > 0.5:
            us = [u + 1.0 if u < 0.5 else u for u in us]
        for li, u in zip(poly.loop_indices, us):
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (u, 1.0 - (co.z - lo) / span)


def _place(objs, face=0.0, anchor=None):
    """
    Put the model on its own pivot: centred on X/Y, feet on Z=0, facing -Y.

    Generators do not care where the origin lands — the minotaur arrived with the
    body sitting 0.25 units off it in depth. `fitToHeight` only ever corrects
    height, so that offset survives into the game multiplied by the archetype's
    scale, and the actor then rotates around a point beside itself while its
    hitbox stays centred on the pivot. Half a collision radius of disagreement
    between what you see and what you can hit.

    -Y is Blender's front view, which the exporter maps to glTF +Z — the
    direction `Enemy.facing` of 0 points down. A model that faces the wrong way
    needs `face` in degrees, not a rotated node: the game writes `rotation.y`
    every frame and would overwrite it.
    """
    for o in objs:
        o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    if face:
        rot = mathutils.Matrix.Rotation(math.radians(face), 4, "Z")
        for o in objs:
            o.data.transform(rot)

    def bounds(of):
        lo = mathutils.Vector((math.inf,) * 3)
        hi = mathutils.Vector((-math.inf,) * 3)
        for o in of:
            for corner in o.bound_box:
                v = mathutils.Vector(corner)
                lo = mathutils.Vector(map(min, lo, v))
                hi = mathutils.Vector(map(max, hi, v))
        return lo, hi

    # X and Y come from the anchor set — the body — while the floor is measured
    # against everything, because a staff planted on the ground is still resting
    # on it and a model that hovers reads worse than one standing off-centre.
    lo, hi = bounds(anchor or objs)
    floor = bounds(objs)[0].z
    shift = mathutils.Matrix.Translation(
        (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -floor)
    )
    for o in objs:
        o.data.transform(shift)
        o.data.update()
    return tuple(round(v, 4) for v in shift.to_translation())


def _shade(obj):
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=SHARP_ANGLE)
    except AttributeError:
        # Pre-4.1: the same thing lived on the mesh datablock.
        bpy.ops.object.shade_smooth()
        if hasattr(obj.data, "use_auto_smooth"):
            obj.data.use_auto_smooth = True
            obj.data.auto_smooth_angle = SHARP_ANGLE


# Where a joint sits inside its own part, as fractions of that part's bounding
# box. Used only when `rig` is not given an explicit origin.
#
# Every one of these is measured against the part's *first* source object, never
# the joined result: an arm holding a staff has a bounding box two metres tall,
# and a shoulder placed at 90% of that lands somewhere above the head.
RIG_ORIGIN = {
    "Pelvis": ("centre", "centre", 0.94),  # hips, near the top of the skirt
    "Torso": ("centre", "centre", 0.28),  # waist
    "Head": ("centre", "centre", 0.06),  # neck
    "ArmL": ("inboard", "centre", 0.90),  # shoulder
    "ArmR": ("inboard", "centre", 0.90),
    "LegL": ("centre", "centre", 0.96),
    "LegR": ("centre", "centre", 0.96),
    # Second segments. On a T-posed source the forearm runs along X, so the
    # elbow is its inboard end and the height fraction hardly matters.
    "ForearmL": ("inboard", "centre", 0.50),
    "ForearmR": ("inboard", "centre", 0.50),
    "ShinL": ("centre", "centre", 0.96),  # knee
    "ShinR": ("centre", "centre", 0.96),
    "Cape": ("centre", "centre", 0.96),  # hangs off the shoulders
}


# A T-posed source stands with its arms out, and the game writes joint rotations
# absolutely — `animateBody` sets `rotation.x/y/z` outright every frame, so a
# rest angle left on a node is overwritten on the first tick and the shade
# fights the arena with its arms spread. The rest pose has to be baked into the
# geometry instead, which is what `rest=` does. These are sane defaults for a
# T-pose: arms down and slightly forward, nothing else moved.
#
# About **Y**, not Z. A T-posed arm lies along X and the axis that swings it
# down is the one running front-to-back; rotating about the vertical Z sweeps it
# horizontally instead, which looks almost right in a viewport and shows up as a
# body sitting 20% of its own depth off its pivot.
T_POSE_REST = {
    "ArmR": (0, 72, 0),
    "ArmL": (0, -72, 0),
    "ForearmR": (0, 8, 0),
    "ForearmL": (0, -8, 0),
}


def _bounds(obj):
    lo = mathutils.Vector((math.inf,) * 3)
    hi = mathutils.Vector((-math.inf,) * 3)
    for corner in obj.bound_box:
        v = obj.matrix_world @ mathutils.Vector(corner)
        lo = mathutils.Vector(map(min, lo, v))
        hi = mathutils.Vector(map(max, hi, v))
    return lo, hi


def _joint_origin(joint, box, centre_x):
    """Turn a part's bounds into the point it should rotate around."""
    lo, hi = box
    fx, fy, fz = RIG_ORIGIN[joint]
    if fx == "inboard":
        # The shoulder is the end of the arm nearest the body, pulled a little
        # into the mass so the joint is inside the meat and not on its skin.
        x = hi.x - (hi.x - lo.x) * 0.25 if hi.x < centre_x else lo.x + (hi.x - lo.x) * 0.25
    else:
        x = (lo.x + hi.x) / 2
    y = (lo.y + hi.y) / 2 if fy == "centre" else lo.y + (hi.y - lo.y) * fy
    return mathutils.Vector((x, y, lo.z + (hi.z - lo.z) * fz))


def rig(
    src,
    dst,
    parts,
    budgets=None,
    materials=None,
    origins=None,
    face=0.0,
    remesh=None,
    remesh_steps=REMESH_STEPS,
    prune=0.02,
    centre_on=None,
    rest=None,
    name=None,
):
    """
    Turn a sculpt that was **split by hand** into the rig the game animates.

    `prep(..., split="humanoid")` guesses the cuts from where geometry sits.
    This is the other route: somebody has already separated the mesh in Blender,
    which is far better than any plane can do — it can follow a sleeve seam and
    tell a staff from the hand holding it — and what is left is everything the
    game needs and a manual split does not give you: names, joint origins, a
    hierarchy, a triangle budget per part, and a body standing on the floor.

        rig(r"raw/magus.glb", r"public/models/magus.glb",
            parts={"Head": ["Mesh_0.003"], "ArmR": ["Mesh_0.006", "Mesh_0.004"]},
            budgets={"Head": 2000, "ArmR": 1500},
            materials={"Head": "Skin", "ArmR": ["Cloth", "Wood"]})

    parts     — {joint: [source object names]}. Prefix a name with "+" to mark
                it a prop — welded into the joint and moving with it, but not
                measured when the joint origin is worked out. A staff is a prop;
                both halves of a skirt are not. Source objects not listed
                anywhere are deleted, and reported.
    budgets   — {joint: triangles}, or a list to split a joint across its own
                pieces by hand. Split it by what the eye spends time on, not
                evenly: a head is worth three skirts.
    materials — {joint: name} or {joint: [name per source object]}. Names are
                looked up through `build_shades.py`'s palette when that file has
                been exec'd into the same session, so a rigged sculpt wears the
                same leather and gold as an authored one. A sculpt arrives with
                no materials at all, and without this the whole body has to take
                the seat colour flat.
    origins   — {joint: (x, y, z)} in final placed space, overriding RIG_ORIGIN.
    remesh    — None measures each piece and decides; False forbids it. Forbidding
                it is usually a mistake on a generated sculpt: this one arrived
                with 98% of its edges non-manifold and half a million loose
                shells, and welding only took that to 40% — far past the point
                where collapse refuses to cross an edge. Decimation plateaued at
                645k triangles against a budget of 8k. The lace pays for it.
    remesh_steps — voxels across the piece's longest axis, as a number or the
                same per-joint / per-piece shape as `budgets`. This is the knob
                that decides whether a part can reach its budget at all, and it
                is not about detail — it is about **genus**. A voxel pass over
                lace or hair leaves a surface pierced by a tunnel per gap, and
                collapse preserves topology: it cannot close a single one. The
                sorceress' bodice came out of a 160-step pass with 855 handles
                and would not go under 16k triangles against a budget of 1600.
                At 100 that is 371 handles, at 64 it is 147, at 40 it is 51.
                Coarse where the surface is holed, fine where it is thin — a
                staff shaft is 3 cm through and disappears below about 200.
    prune     — drop shells smaller than this share of the piece's largest one.
                See _prune_shells: the triangle floor of a mesh is four times
                its shell count, and remeshed lace has thousands.
    rest      — {joint: (rx, ry, rz)} in degrees, baked into the mesh around
                that joint and carried down its subtree. Pass T_POSE_REST for a
                T-posed source; without it the shade stands with its arms out,
                because the game overwrites node rotations every frame and a
                rest angle left on the node never survives the first tick.
    centre_on — joints whose bounds decide where the middle is. Default is all
                of them, which is wrong for anyone holding something long: pass
                the trunk — Pelvis, Torso, Head — and the staff stops dragging
                the body off its own pivot.
    """
    budgets = budgets or {}
    materials = materials or {}
    origins = origins or {}

    _clear_scene()

    bpy.ops.import_scene.gltf(filepath=src)
    found = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}
    report = {"src": src, "dst": dst, "parts": [], "dropped": []}

    # A leading "+" marks a prop: welded into the joint, but not part of the
    # body it hangs off. Only anatomy is measured for the joint origin — a hip
    # taken from one half of a skirt sits half a skirt off the centre line, and
    # a shoulder taken from an arm holding a staff sits above the head.
    props = {joint: {n[1:] for n in names if n.startswith("+")} for joint, names in parts.items()}
    parts = {joint: [n.lstrip("+") for n in names] for joint, names in parts.items()}

    wanted = {n for names in parts.values() for n in names}
    missing = sorted(wanted - set(found))
    if missing:
        raise RuntimeError(f"{src}: no such object(s): {missing}. Have: {sorted(found)}")
    for n in sorted(set(found) - wanted):
        report["dropped"].append({"name": n, "tris": len(found[n].data.polygons)})
        bpy.data.objects.remove(found.pop(n), do_unlink=True)

    # Source names and joint names live in the same namespace, and a hand-split
    # file routinely uses one for the other — a mesh called ArmL that has to
    # become ArmR because the game's weapon hand is +X. Renaming into an
    # occupied name silently gets you "ArmR.001", so everything moves out of the
    # way first.
    for i, n in enumerate(list(found)):
        found[n].name = f"_src{i}"

    # Measured before anything is joined or decimated, because these objects are
    # about to stop being separate.
    boxes = {}
    for joint, names in parts.items():
        anatomy = [n for n in names if n not in props[joint]] or names
        lo = mathutils.Vector((math.inf,) * 3)
        hi = mathutils.Vector((-math.inf,) * 3)
        for n in anatomy:
            a, b = _bounds(found[n])
            lo = mathutils.Vector(map(min, lo, a))
            hi = mathutils.Vector(map(max, hi, b))
        boxes[joint] = (lo, hi)

    # Joints go in their own map. Writing them back into `found` lets a joint
    # named for one source shadow another source of the same name — swap a left
    # and a right arm and the second one silently gets fed the first one's
    # finished mesh.
    built = {}
    maker = globals().get("material")
    for joint, names in parts.items():
        want = materials.get(joint)
        want = [want] * len(names) if isinstance(want, str) else (want or [])
        budget = budgets.get(joint, BUDGETS["player"] // len(parts))
        # Share the joint's budget across its pieces by how much mesh each one
        # arrived with, unless the caller split it by hand. Proportional is a
        # poor proxy for how much the eye spends on a thing — pass a list when
        # it matters.
        if isinstance(budget, (list, tuple)):
            share = list(budget)
        else:
            weight = [len(found[n].data.polygons) for n in names]
            share = [max(60, round(budget * w / sum(weight))) for w in weight]

        steps = remesh_steps.get(joint, REMESH_STEPS) if isinstance(remesh_steps, dict) else remesh_steps
        steps = list(steps) if isinstance(steps, (list, tuple)) else [steps] * len(names)

        # Every piece is cleaned *separately* and only then joined.
        #
        # Cleaning after the join would be simpler and is wrong twice over: a
        # voxel remesh outputs one shell with one material, so the staff loses
        # its wood and fuses into the fist that holds it. Kept apart until the
        # end, each piece keeps its own material slot and its own voxel size —
        # and voxel size is derived from the object's longest axis, so a staff
        # measured together with an arm is remeshed at the wrong resolution.
        pieces = []
        for i, n in enumerate(names):
            obj = found[n]
            obj.data.materials.clear()
            if i < len(want) and want[i]:
                obj.data.materials.append(
                    maker(want[i])
                    if maker
                    else (bpy.data.materials.get(want[i]) or bpy.data.materials.new(want[i]))
                )

            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj

            before = _stats(obj.data)
            welded = _weld(obj)
            health = _stats(obj.data)
            # Per joint, because on a healthy source the remesh stops being the
            # rescue and becomes the damage: it is worth running on the one part
            # that arrives as soup and ruinous on the ten that do not.
            # `"*"` sets the default for joints the dict does not name. Without
            # it a dict of one entry silently leaves the other ten on the gate,
            # which is the opposite of what naming one of them meant.
            want_remesh = (
                remesh.get(joint, remesh.get("*")) if isinstance(remesh, dict) else remesh
            )
            do_remesh = (
                health["non_manifold_ratio"] > REMESH_ABOVE
                if want_remesh is None
                else bool(want_remesh)
            )
            if do_remesh:
                _remesh(obj, steps[i])
            shells = _prune_shells(obj, prune)
            final = _decimate(obj, share[i])
            _shade(obj)
            pieces.append(
                {
                    "from": n,
                    "budget": share[i],
                    "before": before,
                    "welded": {"verts": welded[0], "to": welded[1]},
                    "remeshed": do_remesh,
                    "shells": shells,
                    "after": _stats(obj.data),
                    "tris": final,
                }
            )

        bpy.ops.object.select_all(action="DESELECT")
        for n in names:
            found[n].select_set(True)
        head = found[names[0]]
        bpy.context.view_layer.objects.active = head
        if len(names) > 1:
            bpy.ops.object.join()
        head.name = joint

        report["parts"].append(
            {"name": joint, "tris": len(head.data.polygons), "pieces": pieces}
        )
        built[joint] = head

    objs = [built[j] for j in parts]
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = objs[0]
    # Centred on the body, not on everything it is holding. A staff held out at
    # arm's length drags the bounding box a hand's width sideways, and centring
    # on that puts the shade beside its own hitbox — the exact fault the pivot
    # check exists to catch, arrived at by trying to satisfy it.
    shift = _place(objs, face, anchor=[built[j] for j in (centre_on or parts)])
    report["placed"] = shift

    # Origins, then the hierarchy. `_place` moved the mesh data under every
    # object, so the boxes measured earlier move with it.
    delta = mathutils.Vector(shift)
    centre_x = 0.0
    for joint, obj in ((j, built[j]) for j in parts):
        if joint in origins:
            point = mathutils.Vector(origins[joint])
        else:
            lo, hi = boxes[joint]
            point = _joint_origin(joint, (lo + delta, hi + delta), centre_x)
        cursor = bpy.context.scene.cursor.location.copy()
        bpy.context.scene.cursor.location = point
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        bpy.context.scene.cursor.location = cursor

    # Rest pose, baked into the geometry rather than left on the nodes, and
    # applied to each joint's whole subtree — rotating an upper arm has to carry
    # its forearm and that forearm's own pivot, or the elbow comes apart the
    # moment the arm goes down.
    for joint, angles in (rest or {}).items():
        if joint not in built:
            continue
        rot = Euler([math.radians(a) for a in angles], "XYZ").to_matrix()
        pivot = built[joint].location.copy()
        line = [joint]
        grew = True
        while grew:
            grew = False
            for j in parts:
                if JOINT_PARENT.get(j) in line and j not in line:
                    line.append(j)
                    grew = True
        for j in line:
            obj = built[j]
            obj.data.transform(rot.to_4x4())
            obj.location = pivot + rot @ (obj.location - pivot)
        report.setdefault("rest", {})[joint] = list(angles)

    # origin_set moved every object; without this the parent matrices below are
    # still the ones from before it ran, and the rig telescopes.
    bpy.context.view_layer.update()
    for joint, obj in ((j, built[j]) for j in parts):
        parent = JOINT_PARENT.get(joint)
        if parent and parent in parts:
            obj.parent = built[parent]
            obj.matrix_parent_inverse = built[parent].matrix_world.inverted()

    bpy.ops.object.select_all(action="SELECT")
    kwargs = dict(
        filepath=dst,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT" if materials else "NONE",
        export_skins=False,
        export_animations=False,
        export_yup=True,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        for k in ("export_cameras", "export_lights", "export_skins"):
            kwargs.pop(k, None)
        bpy.ops.export_scene.gltf(**kwargs)

    print("RIG_REPORT " + json.dumps(report))
    return report


def prep(
    src,
    dst,
    budget="boss",
    tris=None,
    keep_materials=False,
    keep_uvs=False,
    name=None,
    face=0.0,
    place=True,
    unwrap=None,
    split=None,
    split_at=None,
):
    """
    src, dst      — .glb in, .glb out
    budget        — key into BUDGETS; ignored when `tris` is given
    tris          — explicit triangle ceiling
    keep_materials— the runtime re-materials everything, so this is off by
                    default. Turn it on for a model whose *material names* carry
                    meaning: warrior.glb tints whichever one matches /crest/i to
                    the player's seat colour, and stripping them loses that.
    keep_uvs      — nothing in the project samples a texture yet (every shipped
                    .glb has zero images), so UVs are pure wire weight until one
                    does.
    face          — degrees to spin the model about Z so it faces -Y (Blender
                    front). Generated meshes land at whatever angle they land.
    place         — centre on the pivot and drop the feet to Z=0. See _place.
    unwrap        — "cylindrical" to give a character body UVs so it can wear the
                    game's painted skin. The texture is drawn in the browser at
                    runtime, so this costs UV data and not one byte of image.
                    Implies keep_uvs.
    split         — "humanoid" cuts the body into the seven named nodes the game
                    animates; "robed" leaves the skirt whole and cuts five, for
                    a figure whose legs are not visible and whose hem should not
                    split in two. See _split_humanoid.
    split_at      — override any of SPLIT_AT for a model with odd proportions.
    """
    keep_uvs = keep_uvs or unwrap is not None
    target = tris or BUDGETS[budget]

    _clear_scene()

    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh in %s" % src)

    # Multi-part rigs (warrior.glb is seven named nodes the animation code drives
    # by name) must survive as separate objects — joining them would silently
    # break every rig lookup.
    report = {"src": src, "dst": dst, "budget": target, "parts": []}
    share = max(1, target // len(meshes))

    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

        before = _stats(obj.data)
        welded = _weld(obj)

        health = _stats(obj.data)
        remeshed = health["non_manifold_ratio"] > REMESH_ABOVE
        if remeshed:
            _remesh(obj)

        final_tris = _decimate(obj, share if len(meshes) > 1 else target)
        _shade(obj)
        if unwrap == "cylindrical":
            _unwrap_cylindrical(obj)
        if name and len(meshes) == 1:
            obj.name = name

        report["parts"].append(
            {
                "name": obj.name,
                "before": before,
                "welded": {"verts": welded[0], "to": welded[1]},
                "remeshed": remeshed,
                "after": _stats(obj.data),
                "tris": final_tris,
            }
        )

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = meshes[0]
    if place:
        report["placed"] = _place(meshes, face)

    # Cutting happens after placing, so the planes are measured against a body
    # that is already centred and standing on the floor.
    if split and len(meshes) == 1:
        report["parts_cut"] = _split_humanoid(meshes[0], legs=split != "robed", at=split_at)
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

    bpy.ops.object.select_all(action="SELECT")
    kwargs = dict(
        filepath=dst,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=keep_uvs,
        export_materials="EXPORT" if keep_materials else "NONE",
        export_skins=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        # Export flags drift between Blender versions; drop the optional ones
        # rather than fail the whole run over a renamed keyword.
        for k in ("export_cameras", "export_lights", "export_skins"):
            kwargs.pop(k, None)
        bpy.ops.export_scene.gltf(**kwargs)

    print("PREP_REPORT " + json.dumps(report))
    return report


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2:
        print(__doc__)
    else:
        opts = {}
        rest = argv[2:]
        for i, a in enumerate(rest):
            if a == "--budget":
                opts["budget"] = rest[i + 1]
            elif a == "--tris":
                opts["tris"] = int(rest[i + 1])
            elif a == "--keep-materials":
                opts["keep_materials"] = True
            elif a == "--keep-uvs":
                opts["keep_uvs"] = True
            elif a == "--name":
                opts["name"] = rest[i + 1]
            elif a == "--face":
                opts["face"] = float(rest[i + 1])
            elif a == "--no-place":
                opts["place"] = False
            elif a == "--split":
                opts["split"] = rest[i + 1]
            elif a == "--unwrap":
                opts["unwrap"] = rest[i + 1]
        prep(argv[0], argv[1], **opts)
