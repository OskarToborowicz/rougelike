import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

/**
 * Load a GLB authored in Blender, once, and hand back clones.
 *
 * Meshes arrive with their own material; the arena re-materials them so lighting
 * stays consistent with the rest of the room rather than whatever the DCC tool
 * happened to export.
 */
export function loadModel(url: string): Promise<THREE.Object3D> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.castShadow = true;
            m.receiveShadow = true;
            // Sculpting and generator exports routinely arrive as bare position
            // data. Without normals a lit material has nothing to shade against
            // and the model renders as a flat cut-out, so they are derived here
            // once, on the cached source, rather than per clone.
            if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
          });
          resolve(root);
        },
        undefined,
        reject
      );
    });
    cache.set(url, p);
  }
  return p;
}

/** True if any mesh under the object is skinned — it needs a rebound clone. */
function isSkinned(source: THREE.Object3D): boolean {
  let skinned = false;
  source.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  return skinned;
}

/** A fresh copy of a loaded model, with an optional material override. */
export function instance(source: THREE.Object3D, material?: THREE.Material): THREE.Object3D {
  // Object3D.clone shares bones by reference, so every clone of a skinned model
  // would deform to the same pose. SkeletonUtils.clone rebuilds the skeleton and
  // rebinds each SkinnedMesh to its own copy — the only correct clone for a rig.
  const clone = isSkinned(source) ? cloneSkinned(source) : source.clone(true);
  clone.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (material) m.material = material;
    // Object3D.clone shares geometry with the source. Anything tearing a scene
    // down must skip these, or disposing one instance guts the cached model and
    // every future clone of it renders as nothing.
    m.userData.sharedGeometry = true;
  });
  return clone;
}

/**
 * Scale a model so its bounding box is exactly `height` tall, and drop it so it
 * sits on y=0. Blender units and game units drift apart constantly; pinning the
 * height means the arena controls scale, not the export.
 */
export function fitToHeight(obj: THREE.Object3D, height: number) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0) {
    const s = height / size.y;
    obj.scale.multiplyScalar(s);
  }
  const box2 = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box2.min.y;
  return obj;
}
