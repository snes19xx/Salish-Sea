/* The Kelvin wake, evaluated per pixel in the water shader from the stationary-phase solution for
   a moving point source in deep water. Behind a boat at speed v, a point x metres back along the
   track and y metres to the side sees two wave systems, with direction tan(theta) = t solving
   2 y t^2 + x t + y = 0: transverse waves (small t) and diverging waves (large t), each with phase
   (g / v^2) (x + y t) sqrt(1 + t^2). They only exist inside |y| < x / sqrt(8), the 19.5-degree
   wedge, and meet in bright cusps along its edges. This gives the real shape (curved transverse
   crests about 2 pi v^2 / g apart, feathery diverging crests) without any noise.
   x and y are measured from the boat's actual track, so the wake bends with its turns: the boat
   drops a point every WAKE.spacing metres (position, time, strength, distance travelled) and the
   shader finds each pixel's nearest track segment. A narrow turbulent foam trail uses the same
   segments. The wave pattern uses the sailing-clock speed, capped at WAKE.vMax so the boost wake
   keeps visible ripples instead of becoming one long, flat swell. */
import * as THREE from 'three';
import { smooth } from '../core/util';
import { waterU } from '../world/water';
import { sail, sailing } from './sailing';

export const WAKE = { n: 96, spacing: 1.6, vMax: 7.0, maxAge: 240 };
const wakeTrack = Array.from({ length: WAKE.n }, () => new THREE.Vector4(0, 0, -1e6, 0));
const wakeDist = new Array<number>(WAKE.n).fill(0); // distance travelled when each point was dropped
let wakeHead = 0, wakeClock = 0, wakeTravel = 0;
let wakeLast: THREE.Vector2 | null = null;
waterU.uTrack.value = wakeTrack;
waterU.uTrackS.value = wakeDist;
const wakeChunks = Array.from({ length: WAKE.n / 8 }, () => new THREE.Vector4());
waterU.uChunk.value = wakeChunks;

// A bounding circle around each chunk of 8 segments, using the same test as the shader for which
// segments are real. Segments older than WAKE.maxAge have faded out (their waves are below
// 0.3% of full strength, the foam gone), so they don't count.
function updateWakeChunks() {
  const lim = 4 * WAKE.spacing * WAKE.spacing + 4;
  for (let c = 0; c < wakeChunks.length; c++) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const live: THREE.Vector4[] = [];
    for (let k = 0; k < 8; k++) {
      const j = c * 8 + k, i = (j + WAKE.n - 1) % WAKE.n;
      const s = wakeTrack[j], p = wakeTrack[i];
      if (s.w <= 0 || p.w <= 0 || wakeDist[j] <= wakeDist[i] || wakeClock - s.z > WAKE.maxAge) continue;
      if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 > lim) continue;
      live.push(p, s);
      x0 = Math.min(x0, p.x, s.x); x1 = Math.max(x1, p.x, s.x);
      z0 = Math.min(z0, p.y, s.y); z1 = Math.max(z1, p.y, s.y);
    }
    if (!live.length) { wakeChunks[c].set(0, 0, 0, 0); continue; }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    let r = 0;
    for (const p of live) r = Math.max(r, Math.hypot(p.x - cx, p.y - cz));
    wakeChunks[c].set(cx, cz, r + 0.01, 1);
  }
}

export function updateWake(dt: number) {
  wakeClock += Math.min(dt, 0.05) * sailing.timex;
  waterU.uWakeClock.value = wakeClock;
  // Points are spaced so the 96 of them always cover about 30 s of sailing-clock history.
  const v = sail.kn * 0.5144; // m/s on the sailing clock
  WAKE.spacing = Math.max(1.6, v * 0.31);
  if (!wakeLast) { wakeLast = new THREE.Vector2(sail.x, sail.z); return; }
  let dx = sail.x - wakeLast.x, dz = sail.z - wakeLast.y, d = Math.hypot(dx, dz);
  if (d > 200) { wakeLast.set(sail.x, sail.z); return; } // a jump (mode switch, reset): start afresh
  // A boat at rest makes no wake; a faster one pushes more water (capped at 2x the 7 kn wake).
  const strength = smooth(0.3, 3, sail.kn) * Math.min(2, Math.max(sail.kn, 7) / 7);
  while (d >= WAKE.spacing) {
    wakeLast.x += dx / d * WAKE.spacing; wakeLast.y += dz / d * WAKE.spacing;
    wakeTravel += WAKE.spacing;
    wakeTrack[wakeHead].set(wakeLast.x, wakeLast.y, wakeClock, strength);
    wakeDist[wakeHead] = wakeTravel;
    wakeHead = (wakeHead + 1) % WAKE.n;
    dx = sail.x - wakeLast.x; dz = sail.z - wakeLast.y; d = Math.hypot(dx, dz);
  }
  // Boat position, point spacing, distance travelled at the boat, and the wave speed.
  waterU.uWakeBoat.value.set(sail.x, sail.z, WAKE.spacing, wakeTravel + d);
  waterU.uWakeV.value = Math.min(Math.max(v, 1.5), WAKE.vMax);
  updateWakeChunks();
}
