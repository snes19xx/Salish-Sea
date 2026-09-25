// The sailing model: speed from the point of sail, steering, the motor and the boost, grounding,
// and the boat's heel and sail trim. The sailing clock runs TIMEX times real time.
import * as THREE from 'three';
import { keys, touchSteer } from '../core/input';
import { state } from '../core/state';
import { angDiff, lerp, smooth } from '../core/util';
import { geo, sampleH } from '../world/data';
import { waterU } from '../world/water';
import { poseBoat } from './boat';

export const sailing = {
  timex: 6,
  boostKn: 45 // hold B: surge to this speed, then settle back when released
};
export const wind = { from: 292, kn: 14 }; // set per area from pilot_height.json
export const sail = { x: 0, z: 1650, hdg: 262, kn: 0, motor: false, boom: 0.3, heel: 0, rudder: 0, boost: false };

/** Boat speed as a share of the best, by the angle off the wind (degrees). */
export function polar(a: number) {
  if (a < 36) return 0;
  if (a < 60) return lerp(0.15, 0.78, (a - 36) / 24);
  if (a < 105) return lerp(0.78, 1.0, (a - 60) / 45);
  return lerp(1.0, 0.82, (a - 105) / 75);
}
export function pointName(a: number) {
  return a < 36 ? 'In irons' : a < 60 ? 'Close-hauled' : a < 80 ? 'Close reach' : a < 115 ? 'Beam reach' : a < 155 ? 'Broad reach' : 'Running';
}
export function setWind(from: number, kn: number) {
  wind.from = from; wind.kn = kn;
  const wd = THREE.MathUtils.degToRad(from + 180);
  waterU.uWindDir.value.set(Math.sin(wd), -Math.cos(wd));
}
setWind(wind.from, wind.kn);

/** Inside the area the boat may sail in (away from the grid edges, which blend into the backdrop). */
export function inSailingBounds(x: number, z: number) {
  const g = geo.detail;
  return !(x < g.minX + 2500 || x > geo.maxX - 2500 || z < g.minZ + 2500 || z > geo.maxZ - 1500);
}

export function updateSail(dt: number, time: number) {
  const steer = ((keys.a || keys.arrowleft || touchSteer.l) ? -1 : 0) + ((keys.d || keys.arrowright || touchSteer.r) ? 1 : 0);
  const rel = angDiff(sail.hdg, wind.from), a = Math.abs(rel);
  sail.boost = state.mode === 'sail' && !!(keys.b || touchSteer.boost);
  // Outside Sail mode the boat drifts to a stop, so the journey starts where the user left it
  // (at first, the area's start in Horseshoe Bay) rather than wherever it sailed during the flyover.
  const target = state.mode !== 'sail' ? 0 : sail.boost ? sailing.boostKn : sail.motor ? 6 : polar(a) * wind.kn * 0.56;
  // Boost picks up quickly; everything else (and coming off boost) eases.
  sail.kn += (target - sail.kn) * Math.min(1, dt * (sail.boost ? 1.2 : 0.35));
  sail.hdg += steer * dt * 26 * Math.max(0.35, Math.min(1, sail.kn / 3.5));
  sail.hdg = (sail.hdg + 360) % 360;
  const h = THREE.MathUtils.degToRad(sail.hdg);
  const fx = Math.sin(h), fz = -Math.cos(h);
  const step = sail.kn * 0.5144 * sailing.timex * dt;
  const nx = sail.x + fx * step, nz = sail.z + fz * step;
  if (sampleH(nx + fx * 6, nz + fz * 6) > -1.2 || !inSailingBounds(nx, nz)) { sail.kn *= 0.2; }
  else { sail.x = nx; sail.z = nz; }
  const side = rel > 0 ? 1 : -1;
  const boomT = side * THREE.MathUtils.degToRad(lerp(8, 82, smooth(35, 175, a)));
  sail.boom += (boomT - sail.boom) * Math.min(1, dt * 1.5);
  const heelT = sail.motor ? 0 : side * 0.24 * polar(a) * Math.sin(THREE.MathUtils.degToRad(Math.min(a, 120)));
  sail.heel += (heelT - sail.heel) * Math.min(1, dt * 0.8);
  sail.rudder += (steer * 0.35 - sail.rudder) * Math.min(1, dt * 6);
  poseBoat(sail.x, sail.z, h, sail.heel, sail.boom, sail.rudder, time);
  waterU.uBoat.value.set(sail.x, sail.z, h, Math.min(1.5, sail.kn / 6)); // a heavier wake at boost speed
}
