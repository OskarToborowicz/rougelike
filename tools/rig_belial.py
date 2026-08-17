"""
Rig Belial: give the cleaned single-mesh sculpt a named humanoid armature and
skin weights, so the game can move its arms and legs by rotating bones.

Runs headless:

    "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
        --background --python tools/rig_belial.py

Input  : public/models/belial.glb  (already welded, decimated, placed feet-on-
         floor and facing -Y by prep_model.py — the topology we actually ship)
Output : public/models/belial.glb  (same, now a SkinnedMesh + armature, no clips)

No animation clips are baked. The bones are named in the same scheme the player
rig uses (Pelvis / Spine / Head / ArmL.. / LegL..), and enemy.ts drives them
procedurally at runtime — the skin just makes that deform smoothly instead of
swinging the whole body.
"""
import os
import bpy
import mathutils

# Source is the cleaned, unrigged mesh kept out of the way; output is the shipped
# path. Reading from a separate source keeps the rig idempotent — re-running never
# binds an armature to an already-skinned file.
SRC = os.path.abspath(os.path.join(os.getcwd(), "raw", "belial_clean.glb"))
DST = os.path.abspath(os.path.join(os.getcwd(), "public", "models", "belial.glb"))

# Bone joints as a fraction of the body's height (0 = floor, 1 = crown) and of
# its half-width for the limbs. Tuned for an upright, robed, broad-shouldered
# humanoid; the lower body is a robe, so the legs sit narrow and the knees high.
FEET, KNEE, HIP = 0.02, 0.26, 0.50
CHEST, SHOULDER, NECK, CROWN = 0.72, 0.80, 0.88, 0.97
ARM_X, ELBOW_X, HAND = 0.30, 0.40, 0.50   # share of half-width, out from centre
LEG_X = 0.16


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_mesh():
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh imported from " + SRC)
    m = meshes[0]
    # Drop the parent 'world' empty's transform onto the mesh so bone coordinates
    # can be computed in plain world space.
    bpy.ops.object.select_all(action="DESELECT")
    m.select_set(True)
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
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

    arm_data = bpy.data.armatures.new("BelialRig")
    arm = bpy.data.objects.new("BelialRig", arm_data)
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

    # Spine chain, up the centre.
    pelvis = bone("Pelvis", (cx, 0, z(HIP)), (cx, 0, z(HIP + 0.06)))
    spine = bone("Spine", (cx, 0, z(HIP + 0.02)), (cx, 0, z(CHEST)), pelvis)
    head = bone("Head", (cx, 0, z(NECK)), (cx, 0, z(CROWN)), spine)

    # Arms hang down and out; forearm continues past the elbow.
    for s, L in ((-1, "L"), (1, "R")):
        up = (cx + s * half * ARM_X, 0, z(SHOULDER))
        elbow = (cx + s * half * ELBOW_X, 0, z((SHOULDER + CHEST) / 2 - 0.06))
        hand = (cx + s * half * HAND, 0, z(HIP + 0.04))
        a = bone("Arm" + L, up, elbow, spine)
        bone("Forearm" + L, elbow, hand, a)

    # Legs down the robe; knee then ankle.
    for s, L in ((-1, "L"), (1, "R")):
        hip = (cx + s * half * LEG_X, 0, z(HIP))
        knee = (cx + s * half * LEG_X, 0, z(KNEE))
        ankle = (cx + s * half * LEG_X, 0, z(FEET))
        leg = bone("Leg" + L, hip, knee, pelvis)
        bone("Shin" + L, knee, ankle, leg)

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def _seg_dist(p, a, b):
    """Distance from point p to the segment a-b."""
    ab = b - a
    denom = ab.dot(ab) or 1e-9
    t = max(0.0, min(1.0, (p - a).dot(ab) / denom))
    return (p - (a + ab * t)).length


def manual_weights(mesh, arm):
    """
    Weight every vertex by proximity to the bone segments.

    Blender's bone-heat solver returns nothing on this sculpt (it is not the
    watertight surface heat diffusion needs), which leaves every vertex
    unweighted and the exporter drops the skin. Proximity weighting always
    assigns something and is fully under our control: each vertex takes the few
    nearest bones, inverse-square by distance, so limbs blend smoothly at the
    shoulder and hip instead of splitting into rigid chunks.
    """
    bones = [(b.name, b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones]
    groups = {name: mesh.vertex_groups[name] for name, _, _ in bones}
    KEEP = 3          # influences per vertex, under glTF's limit of 4
    SPREAD = 1.8      # a bone counts only within this factor of the closest one

    for v in mesh.data.vertices:
        p = v.co
        dists = [(name, _seg_dist(p, a, b)) for name, a, b in bones]
        dists.sort(key=lambda x: x[1])
        dmin = max(dists[0][1], 1e-4)
        chosen = [(n, d) for n, d in dists[:KEEP] if d <= dmin * SPREAD]
        wsum = sum(1.0 / (d * d + 1e-6) for _, d in chosen)
        for name, d in chosen:
            w = (1.0 / (d * d + 1e-6)) / wsum
            groups[name].add([v.index], w, "REPLACE")


def skin(mesh, arm):
    # Parent to the armature and add the modifier + empty vertex groups (named
    # per bone), but no automatic weights — those come from manual_weights. The
    # parent link is the exporter's "correct workflow" that ties skin to node.
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_NAME")

    manual_weights(mesh, arm)

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all()

    weighted = sum(1 for v in mesh.data.vertices if len(v.groups) > 0)
    print("RIG_SKIN groups=%d weighted=%d/%d find_armature=%s"
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
    mesh = import_mesh()
    arm = build_armature(mesh)
    skin(mesh, arm)
    export()
    print("RIG_DONE bones=%d verts=%d" % (len(arm.data.bones), len(mesh.data.vertices)))


main()
