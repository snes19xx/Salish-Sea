// Screenshots for checking a look: run a snippet of JavaScript in the page (with window.pilot as P),
// wait, then save a screenshot. Several snippets give several shots, named name-1.png, name-2.png...
// Usage: node shot.mjs <name> "<query string>" "<js>" ["<js>" ...]
//   node shot.mjs shore "" "P.setMode('sail'); P.sail.x = 100; P.sail.z = 200"
import { mkdirSync } from 'node:fs';
import { openPilot, OUT } from './common.mjs';

const [name = 'shot', query = '', ...snippets] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const { browser, page } = await openPilot(query);
let i = 0;
for (const js of snippets.length ? snippets : ['']) {
  const wait = await page.evaluate(js => { const P = window.pilot; return eval(js); }, js);
  await new Promise(r => setTimeout(r, typeof wait === 'number' ? wait : 3000));
  await page.screenshot({ path: `${OUT}${name}-${++i}.png` });
  console.log(`${OUT}${name}-${i}.png`);
}
await browser.close();
