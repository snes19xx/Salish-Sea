// GPU cost breakdown at one flyover position: whole frame, main pass, reflection, and the frame
// with each part hidden. Times wait for the GPU (one readPixels per frame), in ms.
// Usage: node breakdown.mjs [u = position along the route, 0-1] [query string]
import { openPilot } from './common.mjs';

const u = parseFloat(process.argv[2] || '0.02');
const { browser, page } = await openPilot(process.argv[3]);
await page.evaluate(u => window.pilot.setFly(u), u);
await new Promise(r => setTimeout(r, 1500));
const res = await page.evaluate(() => {
  const P = window.pilot, gl = P.renderer.getContext(), px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const time = (fn, n = 40) => { for (let i = 0; i < 5; i++) fn(); sync(); const t0 = performance.now(); for (let i = 0; i < n; i++) { fn(); sync(); } return +((performance.now() - t0) / n).toFixed(2); };
  const terrain = P.scene.children.filter(o => o.userData.triangles);
  const water = P.scene.children.find(o => o.material && o.material.uniforms && o.material.uniforms.tRefl);
  const hide = (objs, fn) => { objs.forEach(o => o.visible = false); const r = fn(); objs.forEach(o => o.visible = true); return r; };
  const both = () => { P.renderReflection(); P.renderMain(); };
  const info = P.renderer.info; info.autoReset = false; info.reset(); both();
  const tris = info.render.triangles, calls = info.render.calls; info.autoReset = true;
  return {
    trianglesPerFrame: tris, drawCalls: calls,
    frame: time(both), mainOnly: time(P.renderMain), reflectionOnly: time(P.renderReflection),
    noTerrain: hide(terrain, () => time(both)), noDetailTerrain: hide([terrain[0]], () => time(both)),
    noBackdrop: hide([terrain[1]], () => time(both)), noWater: hide([water], () => time(both)),
    noSky: hide(P.scene.children.filter(o => o.renderOrder === 10), () => time(both)),
    noTrees: hide(P.forest.map(r => r.front), () => time(both)),
    readbackOnly: time(() => {})
  };
});
console.log(`u=${u}`, JSON.stringify(res, null, 1));
await browser.close();
