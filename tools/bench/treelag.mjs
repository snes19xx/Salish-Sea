// Do the tree rings keep up at boost speed? Each ring is built around a centre and covers a margin
// beyond its reach; if the camera gets further than that margin from the centre of the ring being
// drawn, trees at the far edge are missing. Boosts for a while and records, per ring, the largest
// camera-to-centre distance as a share of the margin (over 1 means trees went missing), how often
// it rebuilt, and the longest rebuild.
// Usage: node treelag.mjs [seconds of boost] [query string]
import { mkdirSync } from 'node:fs';
import { openPilot, OUT } from './common.mjs';

const boostS = parseFloat(process.argv[2] || '25');
mkdirSync(OUT, { recursive: true });
const { browser, page } = await openPilot(process.argv[3]);
await page.evaluate(() => window.pilot.setMode('sail'));
await new Promise(r => setTimeout(r, 1500));
await page.keyboard.down('b');
const res = await page.evaluate(ms => new Promise(done => {
  const P = window.pilot, end = performance.now() + ms;
  const stats = P.forest.map(r => ({ ring: r.name, margin: r.margin, maxLag: 0, worstShare: 0, rebuilds: 0, longestMs: 0 }));
  const busy = P.forest.map(() => null);
  const start = P.camera.position.clone();
  const tick = now => {
    P.forest.forEach((r, i) => {
      const s = stats[i];
      const lag = Math.hypot(P.camera.position.x - r.cx, P.camera.position.z - r.cz);
      if (isFinite(lag)) { s.maxLag = Math.max(s.maxLag, Math.round(lag)); s.worstShare = +Math.max(s.worstShare, lag / r.margin).toFixed(2); }
      if (r.job && busy[i] === null) busy[i] = now;
      if (!r.job && busy[i] !== null) { s.rebuilds++; s.longestMs = Math.max(s.longestMs, Math.round(now - busy[i])); busy[i] = null; }
    });
    if (now < end) requestAnimationFrame(tick);
    else done({ kn: +P.sail.kn.toFixed(1), travelled: Math.round(P.camera.position.distanceTo(start)), rings: stats });
  };
  requestAnimationFrame(tick);
}), boostS * 1000);
await page.screenshot({ path: `${OUT}treelag.png` });
await page.keyboard.up('b');
console.log(JSON.stringify(res, null, 1));
await browser.close();
