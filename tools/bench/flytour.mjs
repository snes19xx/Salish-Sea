// GPU time and a screenshot at five points along the flyover, then 15 s of live frame pacing.
// Screenshots go to $OUT (default tools/bench/out/).
// Usage: node flytour.mjs [query string]
import { mkdirSync } from 'node:fs';
import { openPilot, pacing, OUT } from './common.mjs';

mkdirSync(OUT, { recursive: true });
const { browser, page } = await openPilot(process.argv[2]);
const res = {};
for (const u of [0.02, 0.2, 0.4, 0.6, 0.8]) {
  await page.evaluate(u => window.pilot.setFly(u), u);
  await new Promise(r => setTimeout(r, 2500));
  res[`gpuMs@${u}`] = await page.evaluate(() => window.pilot.bench(30));
  await page.screenshot({ path: `${OUT}tour-${u}.png` });
}
await page.evaluate(() => window.pilot.setFly(0.02));
res.live = await pacing(page, 15000);
console.log(JSON.stringify(res, null, 1));
await browser.close();
