// Dynamic resolution: when frames take longer than the preset's
// frame-rate target, lower the render scale (down to `min`), and raise it again, up to the
// preset's render scale, when there is room. The browser stretches the smaller canvas to fill the
// page, so a lower scale looks softer but costs fewer pixels.
//
// Two ways to tell how long a frame takes:
// - 'gpu': where the browser has GPU timer queries (Chrome, Edge), the GPU time of each frame.
//   It shows the headroom too, so the scale moves straight to about 75% of the budget.
// - 'frames': elsewhere (Firefox, Safari), the time between frames. That only shows that frames
//   were late, not how much room is left, so the scale steps up by trying: if frames turn late
//   soon after, it steps back down and waits twice as long before trying again.
import { quality } from './quality';
import { currentRenderScale, renderer, setRenderScale } from './renderer';
import { params } from './util';

const STEP = 0.05;
/** Seconds between changes, so each one is measured before the next. */
const SETTLE = 0.75;

export const dynRes = {
  /** Off with ?dynres=0, and with ?pr= (a fixed pixel ratio). */
  on: params.get('dynres') !== '0' && !params.has('pr'),
  /** The lowest render scale it will use. */
  min: 0.6,
  /** How it measures frames: 'gpu', 'frames', or 'off'. */
  timing: 'off' as 'gpu' | 'frames' | 'off',
  /** Recent GPU or frame time, ms (smoothed). */
  ms: 0,
  /** Set while stats-gl is loaded: it runs its own timer queries, and two can't overlap. */
  gpuTimerTaken: false
};

const gl = renderer.getContext() as WebGL2RenderingContext;
const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
  { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
const free: WebGLQuery[] = [], waiting: WebGLQuery[] = [];
let running: WebGLQuery | null = null;

let lastChange = 0, samples = 0;
let intervals: number[] = [], lastFrame = 0;
let nextProbe = 3, probeWait = 3, probedAt = -1;

const budget = () => 1000 / quality.targetFps;
const ceiling = () => quality.renderScale;
const floor = () => Math.min(dynRes.min, ceiling());

/**
 * Back to the preset's render scale (preset changes, turning it off). `resize` false leaves the
 * resize to the caller.
 */
export function resetDynRes(resize = true) {
  setRenderScale(quality.renderScale, resize);
  forget(performance.now() / 1000);
  probeWait = 3; nextProbe = performance.now() / 1000 + probeWait; probedAt = -1;
}

/** Call before the frame's first render. */
export function beginFrameTiming() {
  if (!dynRes.on || !ext || dynRes.gpuTimerTaken || running) return;
  running = free.pop() || gl.createQuery();
  gl.beginQuery(ext.TIME_ELAPSED_EXT, running);
}

/** Call after the frame's last render, with the frame's rAF time. */
export function endFrameTiming(nowMs: number) {
  if (running && ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); waiting.push(running); running = null; }
  if (!dynRes.on) { dynRes.timing = 'off'; return; }
  const now = nowMs / 1000;
  if (ext && !dynRes.gpuTimerTaken) {
    dynRes.timing = 'gpu';
    const ms = collectGpu();
    if (ms !== null) gpuStep(ms, now);
  } else {
    dynRes.timing = 'frames';
    waiting.length && collectGpu(); // drain any left from before stats-gl took over
    if (lastFrame) framesStep(nowMs - lastFrame, now);
  }
  lastFrame = nowMs;
}

/** The newest finished GPU time in ms, or null. Results arrive a few frames late. */
function collectGpu(): number | null {
  let ms: number | null = null;
  while (waiting.length && gl.getQueryParameter(waiting[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = waiting.shift()!;
    if (!gl.getParameter(ext!.GPU_DISJOINT_EXT)) ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    free.push(q);
  }
  return ms;
}

function gpuStep(ms: number, now: number) {
  samples++;
  // Skip the first frames after a change: they were queued at the old scale.
  if (samples <= 4) { dynRes.ms = ms; return; }
  dynRes.ms += (ms - dynRes.ms) * 0.1;
  if (samples < 20 || now - lastChange < SETTLE) return;
  const b = budget(), s = currentRenderScale();
  // GPU time grows with the pixel count, the square of the scale. Aim for 75% of the budget;
  // hold anywhere between 60% and 85% so it doesn't hunt.
  const aim = s * Math.sqrt(0.75 * b / dynRes.ms);
  if (dynRes.ms > 0.85 * b) apply(Math.max(aim, s - 0.2), now);
  else if (dynRes.ms < 0.6 * b && s < ceiling()) apply(Math.min(aim, s + 0.15), now);
}

function framesStep(dtMs: number, now: number) {
  if (dtMs > 250) return; // a hidden tab or a loading stall, not the frame rate
  intervals.push(dtMs);
  if (intervals.length > 30) intervals.shift();
  if (intervals.length < 20 || now - lastChange < SETTLE) return;
  const sorted = [...intervals].sort((a, b) => a - b);
  dynRes.ms = sorted[sorted.length >> 1];
  const b = budget(), s = currentRenderScale();
  if (dynRes.ms > 1.2 * b) {
    // Late. If it's right after trying a higher scale, that step was too far: wait longer next time.
    if (probedAt >= 0 && now - probedAt < 3) probeWait = Math.min(probeWait * 2, 60);
    probedAt = -1;
    apply(Math.max(s * Math.sqrt(b / dynRes.ms), s - 0.15), now);
    nextProbe = now + probeWait;
  } else if (s < ceiling() && now > nextProbe) {
    probedAt = now;
    apply(s + STEP, now);
    nextProbe = now + probeWait;
  }
}

function apply(want: number, now: number) {
  // Snap down to whole steps, so small wobbles don't resize and steps up never overshoot.
  const s = currentRenderScale();
  const next = Math.min(ceiling(), Math.max(floor(), +(Math.floor(want / STEP + 1e-6) * STEP).toFixed(2)));
  if (Math.abs(next - s) < 1e-6) return;
  setRenderScale(next);
  forget(now);
}

function forget(now: number) {
  lastChange = now; samples = 0; intervals = [];
}
