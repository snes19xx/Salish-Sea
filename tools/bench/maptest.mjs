// Drives the minimap and the chart with real mouse and keyboard input and saves screenshots:
// minimap zoom with the wheel, M to open the chart, zoom and drag on it, then a click on open
// water to sail there. Also times a full redraw of the chart and of the minimap patch.
// Usage: node maptest.mjs [query string]
import { mkdirSync } from 'node:fs';
import { openPilot, OUT } from './common.mjs';

mkdirSync(OUT, { recursive: true });
const { browser, page } = await openPilot(process.argv[2]);
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, el) => {
  const path = `${OUT}map-${name}.png`;
  if (el) await (await page.$(el)).screenshot({ path }); else await page.screenshot({ path });
  console.log(path);
};
const res = {};
await page.evaluate(() => window.pilot.setMode('sail'));
await wait(2500);
await shot('mini-45', '#inst');
const box = await (await page.$('#minimap')).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 5; i++) { await page.mouse.wheel({ deltaY: -100 }); await wait(60); }
await wait(300);
res.miniZoomedIn = await page.evaluate(() => +window.pilot.map.mpp.toFixed(1));
await shot('mini-in', '#inst');
for (let i = 0; i < 9; i++) { await page.mouse.wheel({ deltaY: 100 }); await wait(60); }
await wait(300);
res.miniZoomedOut = await page.evaluate(() => +window.pilot.map.mpp.toFixed(1));
await shot('mini-out', '#inst');

await page.mouse.move(960, 400);
await page.keyboard.press('m');
await wait(800);
res.chartOpen = await page.evaluate(() => window.pilot.bigmap.open);
await shot('chart');
// Zoom in about a point, then drag.
const vb = await (await page.$('#bigmap-view')).boundingBox();
const cx = vb.x + vb.width * 0.35, cy = vb.y + vb.height * 0.45;
await page.mouse.move(cx, cy);
for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: -100 }); await wait(60); }
await wait(300);
await shot('chart-zoom');
await page.mouse.down(); await page.mouse.move(cx + 200, cy + 80, { steps: 10 }); await page.mouse.up();
await wait(300);
res.afterDrag = await page.evaluate(() => ({ open: window.pilot.bigmap.open, mpp: +window.pilot.bigmap.mpp.toFixed(1) }));
await shot('chart-drag');
// Redraw costs (the chart redraws only when its view changes; the patch when the boat nears its edge).
res.redrawMs = await page.evaluate(() => {
  const P = window.pilot, B = P.bigmap, c = B.canvas, t = n => { const t0 = performance.now(); for (let i = 0; i < n; i++) P.drawMapArea(B.ctx, c.width, c.height, B.cx - 1000, B.cz - 1000, B.mpp); return +((performance.now() - t0) / n).toFixed(2); };
  const chart = t(20);
  const p = P.map.patch.canvas, ctx = p.getContext('2d'), t0 = performance.now();
  for (let i = 0; i < 20; i++) P.drawMapArea(ctx, p.width, p.height, P.map.patch.x0, P.map.patch.z0, P.map.patch.mpp);
  B.dirty = true;
  return { chart, chartPx: [c.width, c.height], patch: +((performance.now() - t0) / 20).toFixed(2), patchPx: [p.width, p.height] };
});
// Click open water: search the visible chart for a spot the boat may sail to, away from the boat.
const target = await page.evaluate(() => {
  const P = window.pilot, B = P.bigmap, r = B.canvas.getBoundingClientRect();
  for (let fy = 0.3; fy < 0.8; fy += 0.05) for (let fx = 0.2; fx < 0.8; fx += 0.05) {
    const x = B.cx + (fx - 0.5) * r.width * B.mpp, z = B.cz + (fy - 0.5) * r.height * B.mpp;
    if (P.canSailTo(x, z) && Math.hypot(x - P.sail.x, z - P.sail.z) > 3000) return { px: r.left + fx * r.width, py: r.top + fy * r.height, x, z };
  }
  return null;
});
res.target = target;
if (target) {
  await page.mouse.move(target.px, target.py);
  await page.mouse.down(); await page.mouse.up();
  await wait(200);
  res.afterClick = await page.evaluate(() => ({ open: window.pilot.bigmap.open, mode: window.pilot.state.mode,
    x: Math.round(window.pilot.sail.x), z: Math.round(window.pilot.sail.z) }));
  await wait(3000);
  await shot('after-travel');
}
console.log(JSON.stringify(res, null, 1));
await browser.close();
