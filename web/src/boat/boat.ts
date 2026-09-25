/* The boat: a 9.1 m sloop, root at the waterline centre, bow
   toward -z. MainPivot (boom + mainsail) and RudderPivot turn about their local y. The jib turns
   about the forestay (its tack-to-head line), not the vertical, so its head stays on the stay. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene } from '../core/renderer';
import { waterU } from '../world/water';

// Drawn at two-thirds of its built size (about 6 m long, mast about 9 m): at full size it
// dominated the chase view. The wake scales with it.
export const BOAT_SCALE = 0.65;
export const boat = new THREE.Group();
boat.rotation.order = 'YXZ';
boat.scale.setScalar(BOAT_SCALE);
waterU.uBoatScale.value = BOAT_SCALE;
scene.add(boat);

const parts = { main: null as THREE.Object3D | null, jib: null as THREE.Object3D | null, rudder: null as THREE.Object3D | null };
const JIB_AXIS = new THREE.Vector3(0, 1, 0);

export function loadBoat() {
  new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/sailboat/sailboat.glb`).then(gltf => {
    const model = gltf.scene;
    // No environment map in this scene, so fully metallic spars would render nearly black.
    model.traverse(o => {
      const m = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).material as THREE.MeshStandardMaterial : null;
      if (m && m.metalness > 0.3) m.metalness = 0.25;
    });
    const main = model.getObjectByName('MainPivot'), jib = model.getObjectByName('JibPivot'), rudder = model.getObjectByName('RudderPivot');
    if (!main || !jib || !rudder) throw new Error('sailboat.glb is missing MainPivot, JibPivot or RudderPivot');
    // The jib's head is its highest vertex; the pivot sits at the tack, so the head is the axis.
    let head: THREE.Vector3 | null = null;
    jib.traverse(o => {
      if (!(o as THREE.Mesh).isMesh) return;
      const p = (o as THREE.Mesh).geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (!head || v.y > head.y) head = v.clone(); }
    });
    if (head) JIB_AXIS.copy(head).normalize();
    boat.add(model);
    Object.assign(parts, { main, jib, rudder });
  }).catch(err => console.error('Could not load the sailboat model', err));
}

/** Place the boat and set its sails and rudder (boom and rudder angles in radians). */
export function poseBoat(x: number, z: number, hdgRad: number, heel: number, boom: number, rudder: number, time: number) {
  boat.position.set(x, 0.12 * Math.sin(time * 1.3) + 0.07 * Math.sin(time * 2.1 + 1), z);
  boat.rotation.y = -hdgRad;
  boat.rotation.x = 0.025 * Math.sin(time * 1.1) + 0.012 * Math.sin(time * 2.3);
  boat.rotation.z = -heel + 0.02 * Math.sin(time * 0.9);
  if (parts.main && parts.jib && parts.rudder) {
    parts.main.rotation.y = boom;
    parts.jib.quaternion.setFromAxisAngle(JIB_AXIS, boom * 0.55);
    parts.rudder.rotation.y = rudder; // positive swings the blade to starboard
  }
}
