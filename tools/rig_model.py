"""
Rig a cleaned single-mesh sculpt: give it a named humanoid armature and skin
weights so the game can move its arms and legs by rotating bones.

Runs headless, source and destination as arguments:

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --python tools/rig_model.py -- raw/belial_clean.glb public/models/belial.glb Belial

Bones follow the player rig's scheme (Pelvis / Spine / Head / Arm{L,R} /
Forearm{L,R} / Leg{L,R} / Shin{L,R}); enemy.ts drives them procedurally, so no
clips are baked. The source may already carry a (possibly broken, weightless)
armature — it is stripped on import and rebuilt from scratch.

Weighting is manual proximity, not Blender's bone-heat solver (which returns
zero weights on these sculpts and makes the exporter drop the skin). Two rules
kill the "stretched sheet" a naive proximity pass gives a robe:
  · the central lower body is pinned rigidly to the Pelvis, so a skirt swings
    from the hips instead of being stretched like a membrane between the legs;
  · a limb only ever weights vertices on its own side, so nothing is pulled
    across the body by the opposite arm or leg.
"""
import os
import sys
import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = os.path.abspath(argv[0]) if argv else os.path.abspath("raw/belial_clean.glb")
DST = os.path.abspath(argv[1]) if len(argv) > 1 else SRC
RIG = argv[2] if len(argv) > 2 else "Rig"

# Bone joints as a fraction of the body's height (0 = floor, 1 = crown) and of
# its half-width for the limbs. Tuned for an upright, broad-shouldered humanoid.
FEET, KNEE, HIP = 0.02, 0.26, 0.50
CHEST, SHOULDER, NECK, CROWN = 0.72, 0.80, 0.88, 0.97
ARM_X, ELBOW_X, HAND = 0.30, 0.40, 0.50   # share of half-width, out from centre
LEG_X = 0.16

# Weighting rules.
KEEP = 2            # influences per vertex (glTF allows up to 4)
SPREAD = 1.5        # a bone counts only within this factor of the closest one
SKIRT_HALF = 0.20   # |x| under this share of half-width, low down, pins to Pelvis
SIDE_EPS = 0.06     # a thin central column may still blend both sides


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_and_clean():
    """Import the source and reduce the scene to a single, bind-free mesh."""
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh imported from " + SRC)
    m = meshes[0]
    bpy.ops.object.select_all(action="DESELECT")
    m.select_set(True)
    bpy.context.view_layer.objects.active = m
    # Strip any armature the source already carried, so re-rigging starts clean.
    if m.parent:
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    for mod in list(m.modifiers):
        if mod.type == "ARMATURE":
            m.modifiers.remove(mod)
    m.vertex_groups.clear()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Delete everything else (old armatures, the 'world' empty, etc.).
    for o in list(bpy.context.scene.objects):
        if o is not m:
            bpy.data.objects.remove(o, do_unlink=True)
    return m


def bounds(obj):
    lo = mathutils.Vector((1e9, 1e9, 1e9))
    hi = mathutils.Vector((-1e9, -1e9, -1e9))
    for v in obj.data.vertices:
        w = obj.matrix_world @ v.co
        lo = mathutils.Vector(map(min, lo, w))
        hi = mathutils.Vector(map(max, hi, w))
    return lo, hi


def build_armature(mesh):
    lo, hi = bounds(mesh)
    h = hi.z - lo.z
    half = max(hi.x - lo.x, 1e-4) / 2
    cx = (lo.x + hi.x) / 2

    def z(f):
        return lo.z + h * f

    arm_data = bpy.data.armatures.new(RIG)
    arm = bpy.data.objects.new(RIG, arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(name, head, tail, parent=None):
        b = eb.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = parent
            b.use_connect = False
        return b

    pelvis = bone("Pelvis", (cx, 0, z(HIP)), (cx, 0, z(HIP + 0.06)))
    spine = bone("Spine", (cx, 0, z(HIP + 0.02)), (cx, 0, z(CHEST)), pelvis)
    bone("Head", (cx, 0, z(NECK)), (cx, 0, z(CROWN)), spine)

    for s, L in ((-1, "L"), (1, "R")):
        up = (cx + s * half * ARM_X, 0, z(SHOULDER))
        elbow = (cx + s * half * ELBOW_X, 0, z((SHOULDER + CHEST) / 2 - 0.06))
        hand = (cx + s * half * HAND, 0, z(HIP + 0.04))
        a = bone("Arm" + L, up, elbow, spine)
        bone("Forearm" + L, elbow, hand, a)

    for s, L in ((-1, "L"), (1, "R")):
        hip = (cx + s * half * LEG_X, 0, z(HIP))
        knee = (cx + s * half * LEG_X, 0, z(KNEE))
        ankle = (cx + s * half * LEG_X, 0, z(FEET))
        leg = bone("Leg" + L, hip, knee, pelvis)
        bone("Shin" + L, knee, ankle, leg)

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm, (lo, hi, h, half, cx)


def _seg_dist(p, a, b):
    ab = b - a
    denom = ab.dot(ab) or 1e-9
    t = max(0.0, min(1.0, (p - a).dot(ab) / denom))
    return (p - (a + ab * t)).length


def _candidates(p, geo):
    """Which bones may weight this vertex, before distance is even considered."""
    lo, hi, h, half, cx = geo
    fx = (p.x - cx) / half
    fz = (p.z - lo.z) / h
    # Central lower body → the Pelvis alone. This is the whole anti-sheet fix: a
    # robe's middle can no longer be stretched between the two leg bones.
    if fz < HIP and abs(fx) < SKIRT_HALF:
        return ["Pelvis"]
    out = ["Pelvis", "Spine", "Head"]
    for nm in ("Arm", "Forearm", "Leg", "Shin"):
        if fx <= SIDE_EPS:
            out.append(nm + "L")
        if fx >= -SIDE_EPS:
            out.append(nm + "R")
    return out


def manual_weights(mesh, arm, geo):
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    groups = {name: mesh.vertex_groups[name] for name in segs}

    for v in mesh.data.vertices:
        p = v.co
        names = _candidates(p, geo)
        dists = sorted(((n, _seg_dist(p, *segs[n])) for n in names), key=lambda x: x[1])
        dmin = max(dists[0][1], 1e-4)
        chosen = [(n, d) for n, d in dists[:KEEP] if d <= dmin * SPREAD]
        wsum = sum(1.0 / (d * d + 1e-6) for _, d in chosen)
        for name, d in chosen:
            groups[name].add([v.index], (1.0 / (d * d + 1e-6)) / wsum, "REPLACE")


def skin(mesh, arm, geo):
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_NAME")

    manual_weights(mesh, arm, geo)

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all()

    weighted = sum(1 for v in mesh.data.vertices if len(v.groups) > 0)
    print("RIG_SKIN groups=%d weighted=%d/%d armature=%s"
          % (len(mesh.vertex_groups), weighted, len(mesh.data.vertices),
             mesh.find_armature().name if mesh.find_armature() else None))


def export():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=DST,
        export_format="GLB",
        export_skins=True,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_animations=False,
        export_materials="NONE",
        export_yup=True,
        use_selection=False,
        use_visible=False,
        use_active_scene=True,
        export_apply=False,
    )


def main():
    clear()
    mesh = import_and_clean()
    arm, geo = build_armature(mesh)
    skin(mesh, arm, geo)
    export()
    print("RIG_DONE %s bones=%d verts=%d -> %s"
          % (RIG, len(arm.data.bones), len(mesh.data.vertices), DST))


main()
