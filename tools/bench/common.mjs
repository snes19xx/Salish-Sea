// Shared setup: open the pilot in a real (non-headless) Firefox window at 1920 x 1080, wait for it
// to load and the trees to bake, and give back the page. Headless browsers and readPixels-free
// timings miss real compositor and vsync behaviour, so measurements use a visible window.
import puppeteer from 'puppeteer-core';

export const BASE = process.env.BASE || 'http://127.0.0.1:8765';
export const OUT = process.env.OUT || new URL('./out/', import.meta.url).pathname;

export async function openPilot(query = '') {
  const browser = await puppeteer.launch({
    browser: 'firefox', executablePath: '/Applications/Firefox.app/Contents/MacOS/firefox', headless: false,
    args: ['--width=1920', '--height=1080'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(`${BASE}/pilot/?debug${query ? '&' + query : ''}`, { waitUntil: 'load' });
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
