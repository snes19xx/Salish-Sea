// Dynamic resolution check (web app only): fakes a slow machine by raising the target frame rate,
// then lowers it again, and logs the render scale and measured frame time twice a second.
// Usage: APP=web node dynres.mjs [fast target fps] [query]       (Firefox: frame-interval timing)
//        APP=web BROWSER=chrome node dynres.mjs 300               (Chrome: GPU timer queries)
import { openPilot } from './common.mjs';

const fast = parseFloat(process.argv[2] || '144');
const { browser, page } = await openPilot(process.argv[3] || 'quality=balanced');
const watch = (label, seconds) => page.evaluate((label, seconds) => new Promise(done => {
  const P = window.pilot, log = [], t0 = performance.now();
  const id = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    log.push(`${t.toFixed(1)}s ${P.currentRenderScale().toFixed(2)} ${P.dynRes.ms.toFixed(1)}ms`);
    if (t >= seconds) { clearInterval(id); done(`${label} (timing: ${P.dynRes.timing})\n  ` + log.join(' | ')); }
  }, 500);
}), label, seconds);

console.log(await watch('preset target', 4));
await page.evaluate(f => { window.pilot.quality.targetFps = f; }, fast);
console.log(await watch(`target ${fast} fps`, 20));
await page.evaluate(() => { window.pilot.quality.targetFps = 60; });
console.log(await watch('target back to 60 fps', 30));
await browser.close();
