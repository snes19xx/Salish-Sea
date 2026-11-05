// The sea: wave normals, planar reflection, depth colour, shore foam and the boat's wake (the
// wake's track lives in boat/wake.ts and feeds the uniforms here).
import * as THREE from 'three';
import { quality } from '../core/quality';
import { U, camera, mirrorCam, renderSplit, renderer, resizeHooks, scene } from '../core/renderer';
import { geo } from './data';
import NOISE from '../shaders/noise.glsl?raw';
import SKY_COMMON from '../shaders/sky_common.glsl?raw';
import waterVert from '../shaders/water.vert?raw';
import waterFrag from '../shaders/water.frag?raw';

const textureMatrix = new THREE.Matrix4();
// 4x MSAA: without it the half-resolution reflection has stair-stepped edges that crawl as the camera moves.
const reflRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });

export const waterU = {
  tRefl: { value: reflRT.texture }, tHeight: { value: null as THREE.Texture | null },
  hB: { value: new THREE.Vector4(0, 0, 30, 0) }, hN: { value: new THREE.Vector2(2, 2) },
  // The 2 m lidar window's heights, where there is one (lN = 0 when not).
  tHeightL: { value: null as THREE.Texture | null },
  lB: { value: new THREE.Vector4(0, 0, 2, 0) }, lN: { value: new THREE.Vector2(0, 0) },
  uTexMat: { value: textureMatrix }, uWindDir: { value: new THREE.Vector2(0.94, 0.34) },
  uWaveAmp: { value: 1 }, uBoat: { value: new THREE.Vector4(0, 0, 0, 0) },
  uBoatScale: { value: 1 }, // the boat model's scale
  // Wake (boat/wake.ts): the boat's recent track points (x, z, time dropped, strength), the
  // distance travelled at each, the sailing clock, and the boat's position.
  uTrack: { value: [] as THREE.Vector4[] }, uTrackS: { value: [] as number[] }, uWakeClock: { value: 0 },
  uWakeBoat: { value: new THREE.Vector4() }, uWakeV: { value: 3.6 },
  uChunk: { value: [] as THREE.Vector4[] } // a bounding circle per 8 track segments (x, z, radius, 1 if any are live)
};

const waterMat = new THREE.ShaderMaterial({
  uniforms: { ...U, ...waterU },
  vertexShader: waterVert,
  fragmentShader: SKY_COMMON + NOISE + waterFrag
});

// The sea is a 200 km grid that follows the camera, with cells about 1 m wide under the camera and
// a few km wide at the edge (spacing grows with the cube of the distance from the centre). Two huge
// triangles would lose precision when the GPU interpolates world positions across them.
function waterGeometry(half: number, segs: number) {
  const geom = new THREE.PlaneGeometry(2, 2, segs, segs).rotateX(-Math.PI / 2);
  const pos = geom.attributes.position;
  const warp = (u: number) => Math.sign(u) * half * Math.abs(u) ** 3;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, warp(pos.getX(i)), 0, warp(pos.getZ(i)));
  return geom;
}
export const water = new THREE.Mesh(waterGeometry(100000, 96), waterMat);
water.frustumCulled = false;
water.renderOrder = 4;
scene.add(water);

/** Give the water shader the seabed heights (unblended at the grid edge) for depth colour and foam. */
export function setSeabed() {
  const g = geo.detail;
  const ht = new THREE.DataTexture(geo.seabed, g.nx, g.nz, THREE.RedFormat, THREE.FloatType);
  const lin = renderer.extensions.has('OES_texture_float_linear');
  ht.magFilter = ht.minFilter = lin ? THREE.LinearFilter : THREE.NearestFilter;
  ht.needsUpdate = true;
  waterU.tHeight.value = ht;
  waterU.hB.value.set(g.minX, g.minZ, g.dx, 0);
  waterU.hN.value.set(g.nx, g.nz);
  // Inside the lidar window the shoreline follows the lidar, so depth (foam, seabed showing) must too.
  const L = geo.lidar;
  if (L) {
    const lt = new THREE.DataTexture(L.h, L.nx, L.nz, THREE.RedFormat, THREE.FloatType);
    lt.magFilter = lt.minFilter = lin ? THREE.LinearFilter : THREE.NearestFilter;
    lt.needsUpdate = true;
    waterU.tHeightL.value = lt;
    waterU.lB.value.set(L.minX, L.minZ, L.dx, 0);
    waterU.lN.value.set(L.nx, L.nz);
  }
}

/** Objects left out of the reflection on presets without reflected trees (the tree rings). */
export const notReflectedOnLowerPresets: THREE.Object3D[] = [];

const _up = new THREE.Vector3(), _dir = new THREE.Vector3();
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const REFLECT_CLIP = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
/** Draw the scene mirrored in the sea plane into the reflection target. */
export function renderReflection() {
  const cp = camera.position;
  camera.getWorldDirection(_dir);
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion); _up.y = -_up.y;
  mirrorCam.position.set(cp.x, -cp.y, cp.z);
  mirrorCam.up.copy(_up);
  mirrorCam.lookAt(cp.x + _dir.x * 100, -(cp.y + _dir.y * 100), cp.z + _dir.z * 100);
  mirrorCam.updateMatrixWorld();
  mirrorCam.matrixWorldInverse.copy(mirrorCam.matrixWorld).invert();
  textureMatrix.copy(BIAS).multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
  const hidden = quality.reflTrees ? [] : notReflectedOnLowerPresets.filter(o => o.visible);
  for (const o of hidden) o.visible = false;
  water.visible = false; U.uClip.value = 1;
  renderer.clippingPlanes = REFLECT_CLIP; // the boat's keel and rudder are under water: keep them out of the reflection
  renderSplit(mirrorCam, reflRT);
  renderer.clippingPlanes = [];
  water.visible = true; U.uClip.value = 0;
  for (const o of hidden) o.visible = true;
}

resizeHooks.push((w, h, pr) => {
  reflRT.setSize(Math.max(2, Math.floor(w * pr * quality.reflScale)), Math.max(2, Math.floor(h * pr * quality.reflScale)));
});
