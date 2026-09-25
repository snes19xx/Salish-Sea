// The flyover: a closed spline through the area's waypoints (pilot_height.json), lifted to clear
// the ground, and the title camera that flies along it looking ahead.
import * as THREE from 'three';
import { look } from '../core/input';
import { camera } from '../core/renderer';
import { view } from '../core/state';
import { lerp } from '../core/util';
import { sampleH } from '../world/data';

const PS = 3000;
let pathPts: THREE.Vector3[] = [];
const pathY = new Float32Array(PS + 1);
let pathLen = 1;
export const flyTuning = { speed: 78 }; // m/s along the path

export function buildPath(points: [number, number, number][]) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), true, 'centripetal');
  pathPts = curve.getSpacedPoints(PS);
  pathLen = curve.getLength();
  // Height: at least 55 m over the ground, the highest need within 45 samples either side
  // (about 1 km on the 66 km Howe Sound loop), smoothed.
  const req = new Float32Array(PS + 1);
  for (let i = 0; i <= PS; i++) { const p = pathPts[i]; req[i] = Math.max(p.y, Math.max(sampleH(p.x, p.z), 0) + 55); }
  const mx = new Float32Array(PS + 1);
  for (let i = 0; i <= PS; i++) { let m = 0; for (let k = -45; k <= 45; k++) m = Math.max(m, req[(i + k + PS) % PS]); mx[i] = m; }
  for (let i = 0; i <= PS; i++) { let s = 0; for (let k = -30; k <= 30; k++) s += mx[(i + k + PS) % PS]; pathY[i] = s / 61; }
}
function pathAt(u: number, out: THREE.Vector3) {
  u = ((u % 1) + 1) % 1;
  const f = u * PS, i = Math.floor(f), t = f - i, a = pathPts[i], b = pathPts[(i + 1) % PS];
  return out.set(lerp(a.x, b.x, t), lerp(pathY[i], pathY[(i + 1) % PS], t), lerp(a.z, b.z, t));
}

const camTarget = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
// Only the path motion is smoothed; drag applies on the next frame so the view follows the mouse
// without lag, and eases back to straight ahead when let go.
export function updateFly(dt: number) {
  view.flyU = (view.flyU + dt * flyTuning.speed / pathLen) % 1;
  pathAt(view.flyU, tmpA);
  pathAt(view.flyU + 260 / pathLen, tmpB);
  tmpC.subVectors(tmpB, tmpA).normalize();
  const yaw = Math.atan2(tmpC.x, -tmpC.z);
  const pitch = Math.asin(Math.max(-0.6, Math.min(0.4, tmpC.y))) - 0.07;
  const want = tmpB.set(tmpA.x + Math.sin(yaw) * Math.cos(pitch) * 300, tmpA.y + Math.sin(pitch) * 300, tmpA.z - Math.cos(yaw) * Math.cos(pitch) * 300);
  if (!look.dragging) { look.yaw *= Math.exp(-dt * 0.6); look.pitch *= Math.exp(-dt * 0.6); }
  camera.position.copy(tmpA);
  if (!view.camInit) { camTarget.copy(want); view.camInit = true; }
  camTarget.lerp(want, 1 - Math.exp(-dt * 2.5));
  camera.lookAt(camTarget);
  camera.rotateOnWorldAxis(Y_AXIS, -look.yaw);
  camera.rotateX(look.pitch);
}
