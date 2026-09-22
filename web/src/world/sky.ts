// Sky dome (sky colour, sun, night sky, clouds) and the sky state: sun position, light colours,
// weather and haze for the time of day.
import * as THREE from 'three';
import { U, hemi, passes, scene, sunLight } from '../core/renderer';
import { state, type Weather } from '../core/state';
import { lerp, smooth } from '../core/util';
import { setText } from '../ui/dom';
import { geo } from './data';
import { waterU } from './water';
import NOISE from '../shaders/noise.glsl?raw';
import SKY_COMMON from '../shaders/sky_common.glsl?raw';
import skyVert from '../shaders/sky.vert?raw';
import skyFrag from '../shaders/sky.frag?raw';

const skyMat = new THREE.ShaderMaterial({
  uniforms: { ...U },
  vertexShader: skyVert,
  fragmentShader: SKY_COMMON + NOISE + skyFrag,
  side: THREE.BackSide, depthWrite: false
});
export const dome = new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 24), skyMat);
// Draw order (opaque objects otherwise sort by material id before distance): boat, near terrain,
// trees, backdrop, water, then sky, so the depth test skips hidden pixels of the expensive shaders.
dome.renderOrder = 10; dome.frustumCulled = false;
scene.add(dome);
passes.dome = dome;

export const WEATHER: Record<Weather, { fog: number; over: number; waves: number; stars: number }> = {
  clear: { fog: 4.2e-5, over: 0, waves: 0.9, stars: 1 },
  haze: { fog: 1.0e-4, over: 0.25, waves: 0.7, stars: 0.45 },
  over: { fog: 1.35e-4, over: 0.85, waves: 1.25, stars: 0 }
};

// The night sky is set for a moonless late-July night (PDT = UTC-7), when the Milky Way core
// stands low in the south around 22:30-23:00 at this latitude.
const SKY_DATE_UTC = Date.UTC(2026, 6, 20);
function updateStarRotation(hour: number) {
  const meta = geo.meta;
  const lat = THREE.MathUtils.degToRad(meta ? meta.origin.lat : 49.4);
  const lon = meta ? meta.origin.lon : -123.4;
  const days = (SKY_DATE_UTC + (hour + 7) * 3600e3 - Date.UTC(2000, 0, 1, 12)) / 86400e3;
  const lstHours = (((18.697374558 + 24.06570982441908 * days + lon / 15) % 24) + 24) % 24;
  const L = lstHours / 24 * Math.PI * 2;
  const cL = Math.cos(L), sL = Math.sin(L), cP = Math.cos(lat), sP = Math.sin(lat);
  // Rows map an equatorial unit vector to east, north, up; the transpose maps back.
  U.uEq.value.set(-sL, cL, 0, -sP * cL, -sP * sL, cP, cP * cL, cP * sL, sP).transpose();
}

/** Sun, light colours, haze and stars for state.hour and state.weather. */
export function updateSky() {
  const t = state.hour, w = WEATHER[state.weather];
  const el = THREE.MathUtils.degToRad(Math.sin(Math.PI * (t - 5.4) / 15.6) * 58 - 4);
  const az = THREE.MathUtils.degToRad(lerp(62, 298, (t - 5) / 16.4));
  const sd = U.sunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  const sy = sd.y;
  const day = smooth(-0.12, 0.25, sy);
  const gold = (1 - smooth(0.02, 0.4, sy)) * smooth(-0.14, 0.02, sy);
  const vis = smooth(-0.06, 0.04, sy) * (1 - 0.78 * w.over);
  const sc = [lerp(3.1, 2.9, gold), lerp(2.95, 1.35, gold), lerp(2.75, 0.6, gold)].map(v => v * vis) as [number, number, number];
  U.sunCol.value.set(...sc);
  const amb = [lerp(0.02, 0.24, day) + gold * 0.06, lerp(0.025, 0.31, day) + gold * 0.03, lerp(0.05, 0.43, day)]
    .map(v => v * (1 + w.over * 0.15)) as [number, number, number];
  U.ambSky.value.set(...amb);
  U.ambGround.value.set(amb[0] * 0.35 + 0.02 * day, amb[1] * 0.35 + 0.03 * day, amb[2] * 0.3 + 0.015 * day);
  U.uOvercast.value = w.over; U.fogDensity.value = w.fog; waterU.uWaveAmp.value = w.waves;
  U.uStars.value = (1 - smooth(-0.26, -0.07, sy)) * w.stars; // stars come out through nautical twilight
  updateStarRotation(t);
  // Linear values (setRGB and the 3-number constructor take the working colour space as is).
  sunLight.color.setRGB(...sc); sunLight.position.copy(sd).multiplyScalar(1000);
  hemi.color.setRGB(...amb); hemi.groundColor.setRGB(U.ambGround.value.x, U.ambGround.value.y, U.ambGround.value.z);
  const fogC = new THREE.Color(lerp(0.03, 0.5, day) + gold * 0.25, lerp(0.035, 0.6, day) + gold * 0.05, lerp(0.06, 0.74, day) - gold * 0.12);
  const grey = fogC.r * 0.3 + fogC.g * 0.5 + fogC.b * 0.2;
  fogC.lerp(new THREE.Color(grey, grey, grey * 1.03), w.over * 0.85);
  const fog = scene.fog as THREE.FogExp2;
  fog.color.copy(fogC); fog.density = w.fog * 0.85;
  const hh = Math.floor(t), mm = Math.floor((t - hh) * 60);
  setText('#clock', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
}
