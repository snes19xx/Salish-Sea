// Frame pacing while flying, sailing, steering and dragging the view.
// At 144 Hz a frame is 6.9 ms, so pctOver8ms is the share of frames that missed a refresh.
// Usage: node interact.mjs [query string]
import { openPilot, pacing } from './common.mjs';

const { browser, page } = await openPilot(process.argv[2]);
const out = {};
out.fly = await pacing(page, 8000);
await page.evaluate(() => window.pilot.setMode('sail'));
await new Promise(r => setTimeout(r, 2000));
out.sailIdle = await pacing(page, 4000);
await page.keyboard.down('a');
out.sailSteer = await pacing(page, 6000);
await page.keyboard.up('a');
await page.mouse.move(960, 540);
await page.mouse.down();
const drag = (async () => {
  for (let i = 0; i < 120; i++) { await page.mouse.move(960 + Math.sin(i / 10) * 400, 540 + Math.cos(i / 13) * 100); await new Promise(r => setTimeout(r, 16)); }
})();
out.sailDrag = await pacing(page, 3000);
await drag; await page.mouse.up();
console.log(JSON.stringify(out, null, 1));
await browser.close();
