// ?debug: the `window.pilot` hook the benchmark scripts in tools/bench drive (same names as in the
// single-file pilot, so the scripts work against both).
import { sail } from '../boat/sailing';
import { BIGMAP, MAP, canSailTo, drawMapArea } from '../ui/map';
import { setMode } from '../ui/hud';
import { FOREST, setTreeStyle, setTreesShown } from '../world/trees';
import { renderReflection } from '../world/water';
import { look } from './input';
import { GPU, quality, setQuality } from './quality';
import { dynRes } from './dynres';
import { U, antiAlias, camera, currentRenderScale, renderMain, renderer, scene, setRenderScale } from './renderer';
import { state, view } from './state';

export function exposeDebugHook() {
  (window as unknown as { pilot: unknown }).pilot = {
    look, sail, state, setMode, U, forest: FOREST, renderer, scene, camera, renderMain, renderReflection,
    map: MAP, bigmap: BIGMAP, canSailTo, drawMapArea, quality, setQuality, antiAlias, dynRes, currentRenderScale,
    setRenderScale, gpu: GPU,
    setFly: (u: number) => { view.flyU = u; view.camInit = false; },
    /** Average milliseconds per frame (reflection + main pass), waiting for the GPU each frame. */
    bench(frames = 60) {
      // Reading back one pixel forces the GPU to finish the frame (gl.finish() alone does not on ANGLE/Metal).
      const gl = renderer.getContext(), px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < 5; i++) { renderReflection(); renderMain(); }
      sync();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) { renderReflection(); renderMain(); sync(); }
      return +((performance.now() - t0) / frames).toFixed(2);
    },
    setTrees: (on: boolean) => setTreesShown(on),
    treeStyle: (name: string) => setTreeStyle(name),
    /** Frame intervals over a few seconds of the live loop (catches rebuild hitches the static bench misses). */
    frameStats: (ms = 6000) => new Promise(done => {
      const t: number[] = []; let prev = performance.now(); const end = prev + ms;
      const tick = (now: number) => {
        t.push(now - prev); prev = now;
        if (now < end) { requestAnimationFrame(tick); return; }
        t.sort((a, b) => a - b);
        done({ avg: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1), p99: +t[Math.floor(t.length * 0.99)].toFixed(1), max: +t[t.length - 1].toFixed(1) });
      };
      requestAnimationFrame(tick);
    }),
    treeMeshes: () => scene.children.filter(o => o.userData.isForest)
  };
}
