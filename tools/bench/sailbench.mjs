// GPU cost of Sail mode with a full wake: boost for a while so the whole track is laid down, then
// time a frame with the wake on and with it moved out of view, plus live pacing while boosting.
// Usage: node sailbench.mjs [seconds of boost before measuring] [query string]
import { mkdirSync } from 'node:fs';
import { openPilot, pacing, OUT } from './common.mjs';

const boostS = parseFloat(process.argv[2] || '20');
mkdirSync(OUT, { recursive: true });
const { browser, page } = await openPilot(process.argv[3]);
await page.evaluate(() => window.pilot.setMode('sail'));
await new Promise(r => setTimeout(r, 1500));
await page.keyboard.down('b');
const res = { boostLive: await pacing(page, boostS * 1000) };
await page.screenshot({ path: `${OUT}sail-boost.png` });
await page.keyboard.up('b');

// The wake is drawn only within 400 m of uWakeBoat; moving that far away removes it from the frame.
// "allChunks" makes every chunk's bounding circle huge, so the shader walks all 96 segments (the
// old cost); the frame it draws should match the normal one, which maxDiff/pixelsDiff check.
const gpu = () => page.evaluate(() => {
  const P = window.pilot, gl = P.renderer.getContext();
  const water = P.scene.children.find(o => o.material && o.material.uniforms && o.material.uniforms.uWakeBoat);
  const u = water.material.uniforms;
  const wb = u.uWakeBoat.value, saved = wb.clone();
  const chunks = u.uChunk ? u.uChunk.value : [], savedChunks = chunks.map(c => c.clone());
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const grab = () => { P.renderReflection(); P.renderMain(); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const on = P.bench(60), imgOn = grab();
  chunks.forEach(c => c.set(0, 0, 1e7, 1));
  const all = chunks.length ? P.bench(60) : on, imgAll = grab();
  chunks.forEach((c, i) => c.copy(savedChunks[i]));
  wb.x += 1e6;
  const off = P.bench(60);
  wb.copy(saved);
  let maxDiff = 0, pixelsDiff = 0;
  for (let i = 0; i < imgOn.length; i += 4) {
    const d = Math.max(Math.abs(imgOn[i] - imgAll[i]), Math.abs(imgOn[i + 1] - imgAll[i + 1]), Math.abs(imgOn[i + 2] - imgAll[i + 2]));
    if (d > 0) pixelsDiff++;
    maxDiff = Math.max(maxDiff, d);
  }
  return { kn: +P.sail.kn.toFixed(1), withWake: on, allChunks: all, noWake: off, wakeCost: +(on - off).toFixed(2), maxDiff, pixelsDiff };
});
res.gpuAfterBoost = await gpu();
await new Promise(r => setTimeout(r, 3000));
res.gpuSlowing = await gpu();
console.log(JSON.stringify(res, null, 1));
await browser.close();
