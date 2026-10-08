// Sunshine Coast 3D: start-up and the frame loop.
import './style.css';
import { loadBoat } from './boat/boat';
import { updateChase } from './boat/chase';
import { sail, setWind, updateSail } from './boat/sailing';
import { updateWake } from './boat/wake';
import { exposeDebugHook } from './core/debug';
import { beginFrameTiming, endFrameTiming, resetDynRes } from './core/dynres';
import { toggleGui, updateGui } from './core/gui';
import { GPU, onQualityChange, quality } from './core/quality';
import { U, camera, renderMain, resize } from './core/renderer';
import { state } from './core/state';
import { $, params } from './core/util';
import { buildPath, updateFly } from './flyover/path';
import { wireControls } from './ui/controls';
import { setMode, showAreaInfo, toggleMotor, updateInstruments } from './ui/hud';
import { BIGMAP, loadMap, toggleBigMap, updateBigMap } from './ui/map';
import { AREA, DATA, geo, loadData } from './world/data';
import { makeLabels, updateLabels } from './world/labels';
import { dome, updateSky } from './world/sky';
import { buildTerrain } from './world/terrain';
import { applyForestQuality, buildForest, setTreeStyle, updateForest } from './world/trees';
import { renderReflection, setSeabed, water } from './world/water';

function build() {
  const meta = geo.meta!;
  const summary = buildTerrain();
  setSeabed();
  buildForest();
  setTreeStyle(params.get('trees') || 'mixed'); // bakes in the background; trees appear when ready
  makeLabels(meta.labels);
  loadMap().catch(err => console.error('Could not draw the minimap', err)); // the map stays plain water without it
  buildPath(meta.flyover);
  sail.x = meta.boat.x; sail.z = meta.boat.z; sail.hdg = meta.boat.hdg;
  setWind(meta.wind.from, meta.wind.kn);
  showAreaInfo(meta);
  updateSky(); // again, now the star rotation can use the area's latitude and longitude
  setMode(state.mode);
  console.info(`${meta.area}: ${summary}; quality ${quality.name} (GPU: ${GPU || 'unknown'})`);
}

let last = performance.now(), elapsed = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; elapsed += dt;
  U.uTime.value = elapsed;
  updateSail(dt, elapsed);
  updateInstruments();
  if (state.mode === 'fly') updateFly(dt); else updateChase(dt);
  camera.updateMatrixWorld();
  updateForest(camera.position);
  dome.position.copy(camera.position);
  water.position.set(camera.position.x, 0, camera.position.z);
  updateWake(dt);
  beginFrameTiming();
  renderReflection();
  renderMain();
  endFrameTiming(now);
  updateLabels();
  updateBigMap();
  updateGui();
  requestAnimationFrame(frame);
}

// Key actions (the keys held for steering and boost are tracked in core/input.ts).
addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'e' && state.mode === 'sail') toggleMotor();
  if (k === 'm' && !e.repeat) toggleBigMap();
  if (e.key === 'Escape' && BIGMAP.open) toggleBigMap(false);
  if (e.key === '`' && !e.repeat) toggleGui();
});

const applyDetail = () => { U.uDetail.value = quality.detail ? 1 : 0; };
onQualityChange(() => { resetDynRes(false); resize(); applyDetail(); applyForestQuality(); });
applyDetail();
wireControls();
loadBoat();
resize();
updateSky();
setMode('fly');
if (params.has('debug')) exposeDebugHook();
if (params.has('gui')) toggleGui();

loadData().then(() => {
  $('#load-msg').textContent = 'Shaping the coastline…';
  requestAnimationFrame(() => setTimeout(() => {
    try {
      build();
      $('#loader').classList.add('done');
      last = performance.now();
      resetDynRes(); // start its clock now, not during loading
      requestAnimationFrame(frame);
    } catch (err) {
      $('#load-msg').textContent = 'This browser could not start WebGL 2. Try a current Chrome, Safari or Firefox.';
      console.error(err);
    }
  }, 30));
}).catch(err => {
  $('#load-msg').textContent = `Could not load ${DATA}pilot_height.*. Run tools/export_pilot.py ${AREA} first.`;
  console.error(err);
});
