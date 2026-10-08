// Debug panel (lil-gui) and frame stats (stats-gl), loaded only when asked for: ?gui, or the ` key.
// stats-gl wraps renderer.render to time each pass, so it stays out of normal runs and benchmarks.
import type GUIType from 'lil-gui';
import type StatsType from 'stats-gl';
import { chaseView } from '../boat/chase';
import { sailing, setWind, wind } from '../boat/sailing';
import { WAKE } from '../boat/wake';
import { flyTuning } from '../flyover/path';
import { setHour, setWeather } from '../ui/controls';
import { forestTuning } from '../world/trees';
import { GPU, PRESETS, applyQuality, quality, setQuality, type QualityName } from './quality';
import { dynRes, resetDynRes } from './dynres';
import { antiAlias, currentRenderScale, renderer } from './renderer';
import { state } from './state';

let panel: { gui: GUIType; stats: StatsType } | null = null;
let loading = false;

/** Called once a frame from the loop. */
export function updateGui() { panel?.stats.update(); }

export async function toggleGui() {
  if (panel) {
    const on = panel.gui._hidden;
    panel.gui.show(on); panel.stats.dom.hidden = !on;
    return;
  }
  if (loading) return;
  loading = true;
  const [{ default: GUI }, { default: Stats }] = await Promise.all([import('lil-gui'), import('stats-gl')]);
  const stats = new Stats({ trackGPU: true, logsPerSecond: 4, samplesLog: 40, samplesGraph: 10 });
  stats.dom.classList.add('stats-gl');
  document.body.appendChild(stats.dom);
  dynRes.gpuTimerTaken = true; // stats-gl times the GPU itself from now on
  await stats.init(renderer);

  const gui = new GUI({ title: 'Debug' });
  const refresh = () => gui.controllersRecursive().forEach(c => c.updateDisplay());

  const q = gui.addFolder('Quality');
  q.add({ gpu: GPU || 'unknown' }, 'gpu').name('GPU').disable();
  q.add(quality, 'name', Object.keys(PRESETS)).name('Preset').onChange((n: QualityName) => { setQuality(n); refresh(); });
  q.add(quality, 'renderScale', 0.4, 2, 0.05).name('Render scale (most)').onFinishChange(applyQuality);
  q.add(quality, 'targetFps', 20, 144, 1).name('Target fps').listen();
  q.add(dynRes, 'on').name('Dynamic resolution').onChange((on: boolean) => { if (!on) resetDynRes(); });
  q.add(dynRes, 'min', 0.3, 1, 0.05).name('Lowest scale');
  const live = {
    get scale() { return currentRenderScale().toFixed(2); },
    get ms() { return `${dynRes.ms.toFixed(1)} (${dynRes.timing})`; }
  };
  q.add(live, 'scale').name('Scale in use').disable().listen();
  q.add(live, 'ms').name('Frame ms (measured by)').disable().listen();
  q.add(quality, 'reflScale', 0.15, 1, 0.05).name('Reflection scale').onFinishChange(applyQuality);
  q.add(quality, 'reflTrees').name('Trees in reflection').onChange(applyQuality);
  q.add(quality, 'farTrees').name('Far tree ring').onChange(applyQuality);
  q.add(quality, 'detail').name('Terrain detail').onChange(applyQuality);
  // MSAA only applies if the page loaded with it; otherwise SMAA stands in (see quality.ts).
  q.add(quality, 'aa', ['none', 'smaa', 'msaa']).name('Antialiasing').listen();
  q.add({ get inUse() { return antiAlias(); } }, 'inUse').name('Antialiasing in use').disable().listen();

  const s = gui.addFolder('Scene');
  // listen(): these also change outside the panel (the control strip, the area's data on load).
  s.add(state, 'hour', 0, 23.95, 0.05).name('Time of day').onChange(setHour).listen();
  s.add(state, 'weather', { Clear: 'clear', Haze: 'haze', Overcast: 'over' }).name('Weather').onChange(setWeather).listen();
  s.add(renderer, 'toneMappingExposure', 0.4, 2, 0.01).name('Exposure');

  const b = gui.addFolder('Sailing');
  b.add(sailing, 'boostKn', 10, 60, 1).name('Boost (kn)');
  b.add(sailing, 'timex', 1, 12, 0.5).name('Clock speed');
  b.add(wind, 'from', 0, 359, 1).name('Wind from').onChange(() => setWind(wind.from, wind.kn)).listen();
  b.add(wind, 'kn', 0, 35, 1).name('Wind (kn)').listen();
  b.add(chaseView, 'dist', 12, 160, 1).name('Chase distance');
  b.add(chaseView, 'pitch', -0.2, 1, 0.01).name('Chase pitch');
  b.add(WAKE, 'vMax', 3, 15, 0.5).name('Wake wave speed cap');
  b.add(WAKE, 'maxAge', 30, 600, 10).name('Wake max age (s)');

  const o = gui.addFolder('Other');
  o.add(flyTuning, 'speed', 10, 300, 1).name('Flyover speed (m/s)');
  o.add(forestTuning, 'budgetMs', 0.5, 8, 0.25).name('Tree rebuild ms/frame');

  panel = { gui, stats };
}
