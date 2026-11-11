/* The boat: a 9.1 m sloop, root at the waterline centre, bow
   toward -z. MainPivot (boom + mainsail) and RudderPivot turn about their local y. The jib turns
   about the forestay (its tack-to-head line), not the vertical, so its head stays on the stay. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { onQualityChange, quality } from '../core/quality';
import { U, renderer, scene, sunLight } from '../core/renderer';
import { waterU } from '../world/water';

// Drawn at two-thirds of its built size (about 6 m long, mast about 9 m): at full size it
// dominated the chase view. The wake scales with it.
export const BOAT_SCALE = 0.65;
export const boat = new THREE.Group();
boat.name = 'boat';
boat.rotation.order = 'YXZ';
boat.scale.setScalar(BOAT_SCALE);
waterU.uBoatScale.value = BOAT_SCALE;
scene.add(boat);

const parts = { main: null as THREE.Object3D | null, jib: null as THREE.Object3D | null, rudder: null as THREE.Object3D | null };
const JIB_AXIS = new THREE.Vector3(0, 1, 0);

// One material for the whole boat, with colour, roughness and metalness per vertex (the model's
// materials differ in nothing else), so pieces can be merged; the sails need a two-sided copy.
function boatMaterial(side: THREE.Side) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side });
  m.onBeforeCompile = s => {
    s.vertexShader = 'attribute vec2 rm;\nvarying vec2 vRM;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRM = rm;');
    s.fragmentShader = 'varying vec2 vRM;\n' + s.fragmentShader
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
  };
  m.customProgramCacheKey = () => 'boat-rm';
  return m;
}

// The model has 24 pieces (a part per material, across hull, cabin, rig, sails, rudder...), each
// its own draw call in every pass. Merge the pieces that move together (the hull and everything
// fixed to it, or one of the pivots) and are drawn on the same sides: 5 meshes.
function mergeBoat(model: THREE.Object3D, movers: THREE.Object3D[]) {
  model.updateMatrixWorld(true);
  const groups = new Map<string, { parent: THREE.Object3D; side: THREE.Side; geoms: THREE.BufferGeometry[] }>();
  const pieces: THREE.Mesh[] = [];
  model.traverse(o => { if ((o as THREE.Mesh).isMesh) pieces.push(o as THREE.Mesh); });
  const toParent = new THREE.Matrix4();
  for (const mesh of pieces) {
    let parent: THREE.Object3D = model;
    for (let a = mesh.parent; a; a = a.parent) if (movers.includes(a)) { parent = a; break; }
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const g = mesh.geometry.clone();
    g.applyMatrix4(toParent.copy(parent.matrixWorld).invert().multiply(mesh.matrixWorld));
    const n = g.attributes.position.count, col = new Float32Array(n * 3), rm = new Float32Array(n * 2);
    // Metal as modelled: the sky's environment map (world/sky.ts) gives the spars something to reflect.
    for (let i = 0; i < n; i++) {
      col[i * 3] = mat.color.r; col[i * 3 + 1] = mat.color.g; col[i * 3 + 2] = mat.color.b;
      rm[i * 2] = mat.roughness; rm[i * 2 + 1] = mat.metalness;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('rm', new THREE.BufferAttribute(rm, 2));
    const key = `${parent.uuid} ${mat.side}`;
    if (!groups.has(key)) groups.set(key, { parent, side: mat.side, geoms: [] });
    groups.get(key)!.geoms.push(g);
    mesh.removeFromParent();
  }
  const mats = new Map<THREE.Side, THREE.MeshStandardMaterial>();
  for (const { parent, side, geoms } of groups.values()) {
    if (!mats.has(side)) mats.set(side, boatMaterial(side));
    const merged = mergeGeometries(geoms);
    if (!merged) throw new Error('could not merge the boat pieces');
    const mesh = new THREE.Mesh(merged, mats.get(side));
    mesh.castShadow = mesh.receiveShadow = true; // the sails shade the deck and the hull
    parent.add(mesh);
  }
  return groups.size;
}

// Sun shadows on the boat only (Balanced and High): a small shadow box that follows the boat. The
// terrain, trees and water use their own shaders and neither cast nor receive these shadows.
const SHADOW_BOX = 7; // metres either side of the boat, in the light's view
sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -SHADOW_BOX;
sunLight.shadow.camera.right = sunLight.shadow.camera.top = SHADOW_BOX;
sunLight.shadow.camera.near = 1; sunLight.shadow.camera.far = 80;
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
function applyShadowQuality() {
  const size = quality.shadowSize;
  renderer.shadowMap.enabled = size > 0;
  sunLight.castShadow = size > 0;
  if (size > 0 && sunLight.shadow.mapSize.x !== size) {
    sunLight.shadow.mapSize.set(size, size);
    sunLight.shadow.map?.dispose();
    sunLight.shadow.map = null; // remade at the new size on the next render
  }
}
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // updated once a frame (updateBoatShadow), not in every pass
applyShadowQuality();
onQualityChange(applyShadowQuality);
/** Aim the sun's shadow box at the boat; call once a frame before the main pass. */
export function updateBoatShadow() {
  if (!sunLight.castShadow) return;
  sunLight.target.position.copy(boat.position);
  sunLight.position.copy(boat.position).addScaledVector(U.sunDir.value, 40);
  sunLight.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
}

export function loadBoat() {
  new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/sailboat/sailboat.glb`).then(gltf => {
    const model = gltf.scene;
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
    mergeBoat(model, [main, jib, rudder]);
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
