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
    "player": 2_000,
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


def _remesh(obj):
    """Rebuild the surface as one closed manifold shell. Destructive by nature."""
    bpy.context.view_layer.objects.active = obj
    obj.data.remesh_voxel_size = max(obj.dimensions) / REMESH_STEPS
    obj.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()


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


def prep(src, dst, budget="boss", tris=None, keep_materials=False, keep_uvs=False, name=None):
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
    """
    target = tris or BUDGETS[budget]

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)

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
        prep(argv[0], argv[1], **opts)
