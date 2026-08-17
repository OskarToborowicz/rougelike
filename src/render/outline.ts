import * as THREE from 'three';

const OUTLINE_MAT = new THREE.MeshBasicMaterial({
  color: 0x0a0610,
  side: THREE.BackSide,
});

/**
 * Inflated shells for the meshes big enough that rebuilding one per instance
 * would be felt. Keyed by source geometry and thickness; the WeakMap lets a
 * geometry that goes away take its shells with it.
 *
 * The primitive rigs deliberately stay out of this: their geometry is created
 * fresh per actor, so caching would never hit, and leaving them uncached keeps
 * their shells disposable exactly as before.
 */
const CACHE_ABOVE = 5000;
const shellCache = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();

function inflate(source: THREE.BufferGeometry, thickness: number) {
  const geo = source.clone();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nrm.getX(i) * thickness,
      pos.getY(i) + nrm.getY(i) * thickness,
      pos.getZ(i) + nrm.getZ(i) * thickness
    );
  }
  pos.needsUpdate = true;
  return geo;
}

/**
 * Inverted-hull outline. For every mesh in the rig, clone it, push the vertices
 * out along their normals and render backfaces only — the classic cheap ink line.
 * Hades' characters are drawn with a heavy black contour; without one, 3D actors
 * dissolve into a dark floor no matter how well they're lit.
 */
export function addOutline(root: THREE.Object3D, thickness = 0.035) {
  const shells: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry || m.userData.noOutline) return;
    // Skip flat ground decals — an outline on the blob shadow looks like a hole.
    if (m.material instanceof THREE.MeshBasicMaterial) return;

    // A quarter-million vertices walked in JS is a visible hitch, and a sculpt
    // is the same shape every time it spawns — so those are inflated once and
    // shared, and marked so that tearing one actor down cannot free the copy
    // every future one is still using.
    const heavy = m.geometry.attributes.position.count > CACHE_ABOVE;
    let geo: THREE.BufferGeometry;
    if (heavy) {
      let byThickness = shellCache.get(m.geometry);
      if (!byThickness) shellCache.set(m.geometry, (byThickness = new Map()));
      let hit = byThickness.get(thickness);
      if (!hit) byThickness.set(thickness, (hit = inflate(m.geometry, thickness)));
      geo = hit;
    } else {
      geo = inflate(m.geometry, thickness);
    }

    // A skinned mesh deforms every frame, so a plain Mesh shell would hang in the
    // rest pose while the body moved out of it. Bind the shell to the same
    // skeleton as a SkinnedMesh and it rides along — the inflated hull tracks
    // every limb. JOINTS/WEIGHTS live on the shared (inflated clone of the)
    // geometry, so the bind just needs the source's skeleton and bind matrix.
    const skinned = m as THREE.SkinnedMesh;
    let shell: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(geo, OUTLINE_MAT);
      s.bind(skinned.skeleton, skinned.bindMatrix);
      shell = s;
    } else {
      shell = new THREE.Mesh(geo, OUTLINE_MAT);
    }
    if (heavy) shell.userData.sharedGeometry = true;
    shell.position.copy(m.position);
    shell.rotation.copy(m.rotation);
    shell.scale.copy(m.scale);
    shell.renderOrder = -1;
    shells.push(shell);
    m.parent!.add(shell);
  });
  return shells;
}
