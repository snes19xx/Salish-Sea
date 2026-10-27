// Draw calls and triangles per frame, split by what draws them (terrain, backdrop, trees, water,
// sky, boat) and by pass (reflection far / near, main far / near), at a few points: the flyover
// start, mid-route and the Sail start. The budget on the target laptop is 120 draw calls on
// Balanced, 200 on High; terrain tiles were meant to count as one.
// Usage: node drawcalls.mjs [query string]      (APP=web for the Vite app)
import { openPilot } from './common.mjs';

const { browser, page } = await openPilot(process.argv[2]);
const spots = [['fly 0.02', 'P.setMode("fly"); P.setFly(0.02)'], ['fly 0.5', 'P.setFly(0.5)'], ['sail start', 'P.setMode("sail"); P.sail.kn = 0']];
const out = {};
for (const [name, js] of spots) {
  await page.evaluate(js => { const P = window.pilot; eval(js); }, js);
  await new Promise(r => setTimeout(r, 2500));
  out[name] = await page.evaluate(() => {
    const P = window.pilot, gl = P.renderer.getContext();
    // Label each drawable by the top-level scene object it belongs to.
    const label = top => {
      if (top.userData.triangles) return P.scene.children.filter(o => o.userData.triangles).indexOf(top) === 0 ? 'terrain' : 'backdrop';
      if (top.renderOrder === 10) return 'sky';
      if (top.material?.uniforms?.tRefl) return 'water';
      if (P.forest?.some(r => r.front === top || r.back === top)) return 'trees';
      return top.name || top.type;
    };
    let cur = '?', pass = '?';
    const hooks = [];
    for (const top of P.scene.children) top.traverse(o => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      const prev = o.onBeforeRender, l = label(top);
      o.onBeforeRender = function (...a) { cur = l; return prev.apply(this, a); };
      hooks.push([o, prev]);
    });
    const counts = {};
    const count = (mode, n, inst = 1) => {
      const k = `${pass} ${cur}`;
      const c = counts[k] ||= { calls: 0, tris: 0 };
      c.calls++; c.tris += mode === gl.TRIANGLES ? (n / 3) * inst : 0;
    };
    const orig = {};
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      orig[f] = gl[f];
      gl[f] = function (...a) {
        if (f === 'drawElements') count(a[0], a[1]);
        else if (f === 'drawArrays') count(a[0], a[2]);
        else if (f === 'drawElementsInstanced') count(a[0], a[1], a[4]);
        else count(a[0], a[2], a[3]);
        return orig[f].apply(this, a);
      };
    }
    // Name the passes: renderSplit makes two render() calls (far, then near) for each view.
    const render = P.renderer.render;
    let view = '', n = 0;
    P.renderer.render = function (s, c) { pass = `${view} ${n++ % 2 ? 'near' : 'far'}`; return render.call(this, s, c); };
    view = 'refl'; n = 0; cur = 'post'; P.renderReflection();
    view = 'main'; n = 0; cur = 'post'; P.renderMain();
    P.renderer.render = render;
    for (const f in orig) gl[f] = orig[f];
    for (const [o, prev] of hooks) o.onBeforeRender = prev;
    const total = Object.values(counts).reduce((s, c) => ({ calls: s.calls + c.calls, tris: s.tris + c.tris }), { calls: 0, tris: 0 });
    const byThing = {};
    for (const [k, c] of Object.entries(counts)) {
      const thing = k.split(' ').slice(2).join(' ');
      const b = byThing[thing] ||= { calls: 0, tris: 0 };
      b.calls += c.calls; b.tris += c.tris;
    }
    return { quality: P.quality.name, total, byThing, byPass: counts };
  });
}
for (const [name, r] of Object.entries(out)) {
  console.log(`\n== ${name} (${r.quality}): ${r.total.calls} draw calls, ${(r.total.tris / 1e6).toFixed(2)} M triangles`);
  for (const [k, c] of Object.entries(r.byThing).sort((a, b) => b[1].calls - a[1].calls)) console.log(`  ${k.padEnd(10)} ${String(c.calls).padStart(4)} calls  ${(c.tris / 1e3).toFixed(0).padStart(6)} k tris`);
  console.log('  by pass:', Object.entries(r.byPass).map(([k, c]) => `${k} ${c.calls}`).join(', '));
}
await browser.close();
