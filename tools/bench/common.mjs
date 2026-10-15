// Shared setup: open the pilot in a real (non-headless) browser window at 1920 x 1080, wait for it
// to load and the trees to bake, and give back the page. Headless browsers and readPixels-free
// timings miss real compositor and vsync behaviour, so measurements use a visible window.
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

// APP=web measures the Vite app in web/ (npm run dev, port 5173); the default is the single-file
// pilot served from the project root on port 8765. Both expose the same window.pilot hook.
export const APP = process.env.APP || 'pilot';
export const BASE = process.env.BASE || (APP === 'web' ? 'http://127.0.0.1:5173' : 'http://127.0.0.1:8765');
const PAGE = APP === 'web' ? '/' : '/pilot/';
export const OUT = process.env.OUT || new URL('./out/', import.meta.url).pathname;

// BROWSER=chrome uses Chrome (or Chromium) instead of Firefox (it has GPU timer queries, Firefox
// doesn't). The first install found is used (macOS, then Linux paths); FIREFOX=/path or
// CHROME=/path overrides.
export const BROWSER = process.env.BROWSER || 'firefox';
const CANDIDATES = {
  firefox: [process.env.FIREFOX, '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox'],
  chrome: [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
};
const EXE = (CANDIDATES[BROWSER] || []).find(p => p && existsSync(p));

export async function openPilot(query = '') {
  if (!EXE) throw new Error(`No ${BROWSER} found; set ${BROWSER === 'chrome' ? 'CHROME' : 'FIREFOX'}=/path/to/it`);
  const browser = await puppeteer.launch({
    browser: BROWSER, executablePath: EXE, headless: false,
    // BROWSER_ARGS adds flags, e.g. BROWSER_ARGS="--ignore-gpu-blocklist" if Chrome falls back to software.
    args: ['--width=1920', '--height=1080', ...(process.env.BROWSER_ARGS || '').split(' ').filter(Boolean)], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') console.log(`[${m.type()}]`, m.text()); });
  await page.goto(`${BASE}${PAGE}?debug${query ? '&' + query : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#loader.done') && window.pilot, { timeout: 180000, polling: 500 });
  await new Promise(r => setTimeout(r, 6000)); // trees bake, forest rings fill
  return { browser, page };
}

// Frame intervals of the live loop over ms milliseconds.
export const pacing = (page, ms) => page.evaluate(ms => new Promise(done => {
  const t = []; let prev = performance.now(); const end = prev + ms;
  const tick = now => { t.push(now - prev); prev = now; if (now < end) requestAnimationFrame(tick); else {
    t.sort((a, b) => a - b);
    const over = x => +(100 * t.filter(v => v > x).length / t.length).toFixed(1);
    done({ fps: +(1000 * t.length / ms).toFixed(0), p50: +t[t.length >> 1].toFixed(1), p99: +t[Math.floor(t.length * 0.99)].toFixed(1),
      max: +t[t.length - 1].toFixed(1), pctOver8ms: over(8), pctOver17ms: over(17) });
  } };
  requestAnimationFrame(tick);
}), ms);
