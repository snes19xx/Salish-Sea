// The target-laptop test (Phase 3). Serves the built app in
// web/dist itself, opens it in Chrome (GPU timer queries) and, for each preset:
//   - what the page picked: GPU name, preset, antialiasing, how dynamic resolution measures
//   - 30 s of flyover and 20 s of sailing at full boost, live: frame rate, slow frames, and the
//     render scale dynamic resolution settles at
//   - the GPU cost of one frame at the preset's own scale, with dynamic resolution off
//   - Balanced only: the same at render scale 0.6 (does pixel count matter on this GPU?) and
//     without SMAA (what SMAA costs)
// The first preset is the one the page picks by itself (the detection check); on it, three
// screenshots (flyover start, Gambier, the boat close up) go to out/laptop-<machine>-<view>.png
// for a look check (out/ isn't tracked by git, but Syncthing carries it to the other machine).
// Writes results/laptop-<date>-<machine>-<browser>.json and .md.
// Usage: node laptop.mjs            (about 6 minutes)
//        node laptop.mjs soak       (adds 15 minutes of flyover on the detected preset: throttling;
//                                    Chrome's own log goes to out/chrome-soak-<machine>.log)
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const PORT = 8000;
const SOAK = process.argv.includes('soak');
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`No build in ${DIST}: run \`npm run build\` in web/ (on the Mac) and let it sync.`);
  process.exit(1);
}

// A static server for web/dist (Python's would also do, but this keeps the test to one command).
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml'
};
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST.endsWith(sep) ? DIST : DIST + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
process.env.APP = 'web';
process.env.BASE = `http://127.0.0.1:${PORT}`;
process.env.BROWSER ||= 'chrome';
const { openPilot, BROWSER, OUT } = await import('./common.mjs');
mkdirSync(OUT, { recursive: true });

const wait = ms => new Promise(r => setTimeout(r, ms));
// Screenshots for checking the look on this GPU (terrain holes or cracks, the boat).
const SHOTS = [
  ['fly-start', "P.setMode('fly'); P.setFly(0.02)"],
  ['fly-gambier', 'P.setFly(0.35)'],
  ['boat', "P.setMode('sail'); P.sail.kn = 0; P.look.dist = 14; P.look.yaw = 1.3"]
];
const screenshots = async page => {
  const paths = [];
  for (const [name, js] of SHOTS) {
    await page.evaluate(js => { const P = window.pilot; eval(js); }, js);
    await wait(4000);
    const path = `${OUT}laptop-${hostname()}-${name}.png`;
    await page.screenshot({ path });
    paths.push(path);
  }
  return paths;
};
const info = page => page.evaluate(() => {
  const P = window.pilot;
  return {
    gpu: P.gpu, preset: P.quality.name, aa: P.antiAlias(), timing: P.dynRes.timing, presetScale: P.quality.renderScale,
    targetFps: P.quality.targetFps, dpr: devicePixelRatio, cssSize: [innerWidth, innerHeight],
    canvas: [P.renderer.domElement.width, P.renderer.domElement.height], userAgent: navigator.userAgent
  };
});
// Frame intervals and the render scale over `ms` of the live loop.
const live = (page, ms) => page.evaluate(ms => new Promise(done => {
  const P = window.pilot, t = [], scales = [];
  let prev = performance.now(); const end = prev + ms;
  const id = setInterval(() => scales.push(+P.currentRenderScale().toFixed(2)), 1000);
  const tick = now => {
    t.push(now - prev); prev = now;
    if (now < end) { requestAnimationFrame(tick); return; }
    clearInterval(id);
    t.sort((a, b) => a - b);
    // Late: more than 1.5 frame budgets (25 ms at a 60 fps target), i.e. at least one frame missed.
    const late = 1.5 * 1000 / P.quality.targetFps;
    done({
      fps: +(1000 * t.length / ms).toFixed(0), p50: +t[t.length >> 1].toFixed(1), p99: +t[Math.floor(t.length * 0.99)].toFixed(1),
      max: +t[t.length - 1].toFixed(1), pctLate: +(100 * t.filter(v => v > late).length / t.length).toFixed(1),
      scales, endScale: +P.currentRenderScale().toFixed(2), measuredMs: +P.dynRes.ms.toFixed(1), timing: P.dynRes.timing
    });
  };
  requestAnimationFrame(tick);
}), ms);
// Cost of one frame (reflection + main) at the flyover start: `ms` is wall time waiting for the
// GPU each frame (includes the CPU side), `gpuMs` the GPU's own time from timer queries (median
// of 30 frames; null where the browser has none). Run with dynamic resolution off.
const frameCost = page => page.evaluate(async () => {
  const P = window.pilot, gl = P.renderer.getContext();
  P.setMode('fly'); P.setFly(0.02);
  await new Promise(r => setTimeout(r, 2000));
  const info = P.renderer.info; info.autoReset = false; info.reset(); P.renderReflection(); P.renderMain();
  const calls = info.render.calls; info.autoReset = true;
  const ms = P.bench(60);
  let gpuMs = null;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (ext) {
    // One frame at a time (wait for the GPU after each), so queued frames don't overlap a timer.
    const qs = [], px = new Uint8Array(4);
    for (let i = 0; i < 30; i++) {
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q); P.renderReflection(); P.renderMain(); gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      qs.push(q);
    }
    // Results arrive after the browser has run a few frames.
    for (let i = 0; i < 30 && !gl.getQueryParameter(qs.at(-1), gl.QUERY_RESULT_AVAILABLE); i++) await new Promise(r => setTimeout(r, 100));
    const v = gl.getParameter(ext.GPU_DISJOINT_EXT) ? [] : qs.filter(q => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))
      .map(q => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b);
    qs.forEach(q => gl.deleteQuery(q));
    if (v.length) gpuMs = +v[v.length >> 1].toFixed(2);
  }
  return { ms, gpuMs, scale: P.currentRenderScale(), drawCalls: calls };
});

const results = { when: new Date().toISOString(), browser: BROWSER, presets: [] };
const presets = [null, 'balanced', 'high', 'low']; // null: let the page pick
let detected = null;
for (const want of presets) {
  if (want && want === detected) continue;
  const label = want || 'detected';
  console.log(`== ${label}`);
  const { browser, page } = await openPilot(want ? `quality=${want}` : '');
  try {
    const r = { requested: label, ...(await info(page)) };
    if (!want) detected = r.preset;
    r.fly = await live(page, 30000);
    await page.evaluate(() => window.pilot.setMode('sail'));
    await wait(1500);
    await page.keyboard.down('b');
    r.sailBoost = await live(page, 20000);
    await page.keyboard.up('b');
    // Fixed-scale costs: dynamic resolution off, back to the preset's scale.
    await page.evaluate(() => { const P = window.pilot; P.dynRes.on = false; P.setQuality(P.quality.name); });
    r.cost = await frameCost(page);
    if (r.preset === 'balanced') {
      await page.evaluate(() => window.pilot.setRenderScale(0.6));
      r.costAtScale06 = await frameCost(page);
      await page.evaluate(() => { const P = window.pilot; P.setRenderScale(P.quality.renderScale); P.quality.aa = 'none'; });
      r.costNoAA = await frameCost(page);
    }
    if (!want) {
      await page.evaluate(() => { const P = window.pilot; P.setQuality(P.quality.name); }); // the preset's look again
      r.screenshots = await screenshots(page);
    }
    results.presets.push(r);
    console.log(JSON.stringify(r));
  } finally {
    await browser.close();
  }
}

if (SOAK) {
  console.log('== soak (15 min)');
  // The first soak lost its page after a minute with no reason given: keep Chrome's log this time.
  if (BROWSER === 'chrome') process.env.BROWSER_ARGS = `${process.env.BROWSER_ARGS || ''} --enable-logging --v=0 --log-file=${OUT}chrome-soak-${hostname()}.log`;
  const { browser, page } = await openPilot('');
  page.on('error', e => console.log('[page crashed]', e.message));
  page.on('close', () => console.log('[page closed]'));
  results.soak = [];
  try {
    for (let minute = 1; minute <= 15; minute++) {
      await wait(50000);
      const s = await live(page, 10000);
      results.soak.push({ minute, fps: s.fps, p99: s.p99, scale: s.endScale, measuredMs: s.measuredMs });
      console.log(JSON.stringify(results.soak.at(-1)));
    }
  } catch (e) {
    results.soakError = { afterMinute: results.soak.length, message: e.message };
    console.log('[soak stopped]', JSON.stringify(results.soakError));
  } finally {
    await browser.close().catch(() => {});
  }
}
server.close();

// Markdown summary.
const p = results.presets, first = p[0] || {};
const cost = c => `${c.ms} / ${c.gpuMs ?? 'n/a'}`;
const row = r => `| ${r.preset}${r.requested === 'detected' ? ' (picked by the page)' : ''} | ${r.aa} | ${r.targetFps} | ` +
  `${cost(r.cost)} at ${r.cost.scale} | ${r.cost.drawCalls} | ${r.fly.fps} / ${r.fly.p99} / ${r.fly.pctLate}% | ${r.fly.endScale} | ` +
  `${r.sailBoost.fps} / ${r.sailBoost.p99} / ${r.sailBoost.pctLate}% | ${r.sailBoost.endScale} | ` +
  `${r.fly.timing === 'gpu' ? r.fly.measuredMs : 'n/a'} / ${r.cost.gpuMs ?? 'n/a'} |`;
const bal = p.find(r => r.preset === 'balanced');
const diff = (a, b) => (a == null || b == null ? 'n/a' : (a - b).toFixed(2));
let md = `### ${results.when.slice(0, 10)}, ${BROWSER}\n\n` +
  `- GPU: \`${first.gpu}\`\n- Browser: \`${first.userAgent}\`\n` +
  `- Page: ${first.cssSize?.join(' x ')} CSS px, devicePixelRatio ${first.dpr}; dynamic resolution timing: ${first.fly?.timing}\n` +
  `- Detection picked: **${detected}** (the plan expects balanced)\n\n` +
  `Frame ms is wall / GPU timer, at the preset's fixed scale. Late = frames over 1.5x the target's budget. ` +
  `Live / clean GPU ms: what dynamic resolution's timer read in the live flyover against the clean GPU time; ` +
  `if live is far higher (at the same scale), dynamic resolution lowers the scale for nothing.\n\n` +
  `| Preset | AA | Target fps | Frame ms | Draw calls | Fly fps / p99 ms / % late | Fly end scale | Sail boost fps / p99 ms / % late | Sail end scale | Live / clean GPU ms |\n` +
  `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n` + p.map(row).join('\n') + '\n';
if (bal) {
  md += `\nBalanced, fixed scale (wall / GPU ms): ${cost(bal.cost)} at ${bal.cost.scale}; ${cost(bal.costAtScale06)} at 0.6 ` +
    `(scale 0.6 saves ${diff(bal.cost.gpuMs, bal.costAtScale06.gpuMs)} GPU ms); ${cost(bal.costNoAA)} without SMAA ` +
    `(SMAA costs ${diff(bal.cost.gpuMs, bal.costNoAA.gpuMs)} GPU ms).\n`;
}
if (results.soak) {
  md += `\nSoak (detected preset, flyover): ` + results.soak.map(s => `${s.minute}m ${s.fps} fps @${s.scale}`).join(', ') + '\n';
  if (results.soakError) md += `Soak stopped after minute ${results.soakError.afterMinute}: ${results.soakError.message} (see out/chrome-soak-${hostname()}.log)\n`;
}
// Kept in results/ (tracked, unlike out/), named by date and machine.
const RESULTS = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(RESULTS, { recursive: true });
const name = `laptop-${results.when.replace(/[:.]/g, '-').slice(0, 16)}-${hostname()}-${BROWSER}${SOAK ? '-soak' : ''}`;
writeFileSync(`${RESULTS}${name}.json`, JSON.stringify(results, null, 1));
writeFileSync(`${RESULTS}${name}.md`, md);
console.log('\n' + md);
console.log(`Saved ${RESULTS}${name}.json and .md`);
