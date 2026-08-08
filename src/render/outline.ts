import * as THREE from 'three';

const OUTLINE_MAT = new THREE.MeshBasicMaterial({
  color: 0x0a0610,
  side: THREE.BackSide,
});

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
    if (!m.isMesh || !m.geometry) return;
    // Skip flat ground decals — an outline on the blob shadow looks like a hole.
    if (m.material instanceof THREE.MeshBasicMaterial) return;

    const geo = m.geometry.clone();
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

    const shell = new THREE.Mesh(geo, OUTLINE_MAT);
    shell.position.copy(m.position);
    shell.rotation.copy(m.rotation);
    shell.scale.copy(m.scale);
    shell.renderOrder = -1;
    shells.push(shell);
    m.parent!.add(shell);
  });
  return shells;
}
