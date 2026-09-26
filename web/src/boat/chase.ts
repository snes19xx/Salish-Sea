// The chase camera in Sail mode. It starts behind the boat, about 13 degrees up (chaseView.pitch),
// so the horizon sits a quarter of the way down the view and the landscape fills the top of it.
// Drag orbits and the wheel zooms (core/input.ts); steering swings it round smoothly.
import * as THREE from 'three';
import { look } from '../core/input';
import { camera } from '../core/renderer';
import { view } from '../core/state';
import { angDiff } from '../core/util';
import { sampleH } from '../world/data';
import { BOAT_SCALE } from './boat';
import { sail } from './sailing';

export const chaseView = { dist: 44, pitch: 0.22 };
const chase = { hdg: 0, y: 0, dist: 30 };

export function updateChase(dt: number) {
  if (!view.camInit) { chase.hdg = sail.hdg; chase.dist = look.dist; }
  chase.hdg += angDiff(sail.hdg, chase.hdg) * (1 - Math.exp(-dt * 2.5)); // swing round smoothly when steering
  chase.dist += (look.dist - chase.dist) * (1 - Math.exp(-dt * 10)); // ease the scroll-wheel steps
  const h = THREE.MathUtils.degToRad(chase.hdg) + look.yaw;
  const pitch = chaseView.pitch - look.pitch;
  const d = chase.dist;
  const x = sail.x - Math.sin(h) * Math.cos(pitch) * d, z = sail.z + Math.cos(h) * Math.cos(pitch) * d;
  const y = Math.max(2.5, Math.sin(pitch) * d + 4, sampleH(x, z) + 6);
  // Height clearance over land is eased so the camera doesn't jump over each ridge.
  chase.y = view.camInit ? Math.max(2.5, chase.y + (y - chase.y) * (1 - Math.exp(-dt * 4))) : y;
  view.camInit = true;
  camera.position.set(x, chase.y, z);
  camera.lookAt(sail.x, 5 * BOAT_SCALE, sail.z); // about mid-height on the rig
}
