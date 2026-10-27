// Look check for the port: the same views drawn by the single-file pilot and by the web app.
// For each view (on a freshly loaded page) the camera is held at a spot for a few seconds so the
// tree rings fill, then the loop is stopped, the camera set to a recorded pose, and one frame
// drawn at a fixed time. The pilot run records the poses (out/compare-poses.json); the web run
// reuses them, so the two sets of images can be diffed (imgdiff.py).
// Usage:  node compare.mjs            (pilot: out/cmp-pilot-<view>.png)
//         APP=web node compare.mjs    (web app: out/cmp-web-<view>.png)
//         APP=web TAG=before node compare.mjs   (out/cmp-before-<view>.png: a web-app version to
//         diff a change against, with `imgdiff.py before web`)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { APP, OUT, openPilot } from './common.mjs';
const TAG = process.env.TAG || APP;

const VIEWS = [
  { name: 'fly-start', hour: 19.33, hold: 'P.setFly(0.02)' },
  { name: 'fly-gambier', hour: 19.33, hold: 'P.setFly(0.35)' },
  { name: 'fly-noon', hour: 12.5, hold: 'P.setFly(0.6)' },
  { name: 'sail-start', hour: 19.33, mode: 'sail', hold: 'P.sail.kn = 0' },
  { name: 'night', hour: 22.75, hold: 'P.setFly(0.8)' }
];
const only = process.argv[2];
mkdirSync(OUT, { recursive: true });
const posesFile = `${OUT}compare-poses.json`;
const poses = existsSync(posesFile) ? JSON.parse(readFileSync(posesFile, 'utf8')) : {};

const { browser, page } = await openPilot();
let first = true;
for (const v of VIEWS) {
  if (only && v.name !== only) continue;
  if (!first) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#loader.done') && window.pilot, { timeout: 180000, polling: 500 });
  }
  first = false;
  await page.evaluate(v => {
    const P = window.pilot, tod = document.querySelector('#tod');
    tod.value = String(v.hour); tod.dispatchEvent(new Event('input'));
    if (v.mode) P.setMode(v.mode);
    document.querySelector('#labels').hidden = true;
  }, v);
  // Hold the view for 6 s so the trees bake and the rings fill around it.
  await page.evaluate(js => new Promise(done => {
    const P = window.pilot, end = performance.now() + 6000;
    const id = setInterval(() => { eval(js); if (performance.now() > end) { clearInterval(id); done(); } }, 10);
  }), v.hold);
  // Stop the loop, pose the camera, draw one frame at a fixed time.
  const pose = await page.evaluate(async (pose) => {
    const P = window.pilot;
    window.requestAnimationFrame = () => 0;
    await new Promise(r => setTimeout(r, 200)); // let the last scheduled frame run
    const c = P.camera;
    if (pose) { c.position.fromArray(pose.p); c.quaternion.fromArray(pose.q); }
    c.updateMatrixWorld();
    const find = key => P.scene.children.find(o => o.material && o.material.uniforms && o.material.uniforms[key]);
    find('uStars').position.copy(c.position); // the sky dome follows the camera
    find('uWakeBoat').position.set(c.position.x, 0, c.position.z); // so does the sea grid
    // The boat bobs with the clock: hold it level at its spot so both apps draw the same pose.
    const boat = P.scene.children.find(o => o.isGroup && Math.abs(o.scale.x - 0.65) < 1e-6);
    if (boat) { boat.position.set(P.sail.x, 0, P.sail.z); boat.rotation.x = 0; boat.rotation.z = 0; boat.updateMatrixWorld(true); }
    P.U.uTime.value = 100;
    P.renderReflection(); P.renderMain();
    return { p: c.position.toArray(), q: c.quaternion.toArray() };
  }, APP === 'pilot' ? null : poses[v.name] || null);
  if (APP === 'pilot') poses[v.name] = pose;
  await new Promise(r => setTimeout(r, 300));
  const path = `${OUT}cmp-${TAG}-${v.name}.png`;
  await page.screenshot({ path });
  console.log(path);
}
if (APP === 'pilot') writeFileSync(posesFile, JSON.stringify(poses, null, 1));
await browser.close();
