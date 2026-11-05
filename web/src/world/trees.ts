/* Forest. Trees are impostors. At load time each tree model is rendered from 8 directions into a
   texture (colour, plus surface normals so the sun can light it), and every tree is one
   camera-facing quad showing the baked view closest to the camera's angle: 2 triangles per tree.
   Two rings follow the camera: dense within 650 m, sparser out to 3.2 km; beyond that the canopy
   painted by the terrain shader takes over. Each tree is hashed from its grid cell, so trees stay put.
   Rebuilds run a few milliseconds per frame into a hidden buffer that is swapped in when complete.
   Each ring fades in and out by the live camera distance, in the vertex shader: every tree has a
   random threshold and shrinks away as the ring's weight drops below it. A rebuild only has to
   cover a margin beyond the ring, so swapping buffers doesn't make trees pop. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { snoise } from '../core/noise';
import { quality } from '../core/quality';
import { U, renderer, scene } from '../core/renderer';
import { lerp, smooth } from '../core/util';
import { isTown, sampleH } from './data';
import { notReflectedOnLowerPresets } from './water';
import SKY_COMMON from '../shaders/sky_common.glsl?raw';
import treeVert from '../shaders/tree.vert?raw';
import treeFrag from '../shaders/tree.frag?raw';
import bakeVert from '../shaders/bake_normal.vert?raw';
import bakeFrag from '../shaders/bake_normal.frag?raw';

// Conifers, baked into one atlas with one row per species, so a mixed forest is still one
// draw call per ring.
const TREE_DIR = `${import.meta.env.BASE_URL}models/trees/`;
const SPECIES = ['douglas_fir', 'western_red_cedar', 'western_hemlock']; // atlas rows 0, 1, 2
/** Tree switch: 'mixed' picks each tree's species from its cell; the others show one species everywhere. */
export const TREE_STYLES = { mixed: -1, fir: 0, cedar: 1, hemlock: 2 } as const;
export type TreeStyle = keyof typeof TREE_STYLES | 'off';
const IMP = { views: 8, fw: 256, fh: 512, rows: SPECIES.length };

export interface Ring {
  name: string; cell: number; cap: number; every: number; salt: number;
  /** The ring's weight fades in over [band.x, band.y] metres and out over [band.z, band.w]. */
  band: [number, number, number, number];
  reach: number; margin: number; maxWeight: (dist: number) => number;
  front: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  back: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  cx: number; cz: number; jobX: number; jobZ: number; jobStart: number;
  job: Generator<undefined, number> | null; written: number; uploaded: number; logged?: boolean;
  /** Off on presets without the far ring. */
  enabled: boolean;
}
type RingSpec = Pick<Ring, 'name' | 'cell' | 'cap' | 'every' | 'salt' | 'band'>;
const RING_SPECS: RingSpec[] = [
  { name: 'near', cell: 7, cap: 60000, every: 120, salt: 11, band: [-2, -1, 530, 650] },
  { name: 'far', cell: 14, cap: 220000, every: 300, salt: 23, band: [530, 650, 2500, 3200] }
  // No trees beyond 3.2 km: a sparse distant ring read as scattered dots on the far mountains,
  // which look better as the painted canopy under blue haze.
];
export const FOREST: Ring[] = [];
export const forestTuning = { budgetMs: 2 }; // per frame, shared by all ring rebuilds

const treeU = {
  tAlbedo: { value: null as THREE.Texture | null }, tNormal: { value: null as THREE.Texture | null },
  uViews: { value: IMP.views }, uRows: { value: IMP.rows },
  uAtlas: { value: new THREE.Vector2(IMP.fw * IMP.views, IMP.fh * IMP.rows) }, uAspect: { value: 0.5 },
  uSpecies: { value: -1 } // -1: each tree's own species; 0-2: that species everywhere
};
// One material per ring (for its fade band); the other uniforms are shared.
const makeTreeMat = (band: number[]) => new THREE.ShaderMaterial({
  uniforms: { ...U, ...treeU, uBand: { value: new THREE.Vector4(...band) } },
  side: THREE.DoubleSide,
  vertexShader: treeVert,
  fragmentShader: SKY_COMMON + treeFrag
});
// Normals in the bake camera's space. Not flipped on back faces: the foliage cards carry authored
// outward normals that round the crown, and flipping them for the back of a double-sided card
// would leave seams.
const bakeNormalMat = (map: THREE.Texture | null) => new THREE.ShaderMaterial({
  uniforms: { map: { value: map } },
  defines: map ? { HAS_MAP: '' } : {},
  side: THREE.DoubleSide,
  vertexShader: bakeVert,
  fragmentShader: bakeFrag
});

// three.js r150, which the tree colours were tuned on, tone-mapped render targets too, so the baked
// colours came out tone-mapped (ACES at the renderer's exposure). Newer three only tone-maps on
// screen, so the colour bake does it itself.
const toneMapBake = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + THREE.ShaderChunk.tonemapping_pars_fragment)
    .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );');
};
const gltfLoader = new GLTFLoader();
// Render each species (its LOD0 mesh) from IMP.views directions into one colour and one normal
// atlas, a row per species. Every species uses the same width-to-height frame, so one quad shape
// fits all trees; each is framed to its own height.
async function bakeForestAtlas() {
  const models = await Promise.all(SPECIES.map(id => gltfLoader.loadAsync(`${TREE_DIR}${id}.glb`).then(g => g.scene)));
  const frames = models.map(model => {
    model.traverse(o => { if (o.name === 'LOD1') o.visible = false; });
    model.updateMatrixWorld(true);
    const lod0 = model.getObjectByName('LOD0') || model;
    const box = new THREE.Box3().setFromObject(lod0);
    return { model, size: box.getSize(new THREE.Vector3()), ctr: box.getCenter(new THREE.Vector3()) };
  });
  const aspect = Math.max(...frames.map(f => Math.max(f.size.x, f.size.z) * 0.55 / (f.size.y * 0.51)));
  const rtOpts = { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter };
  const W = IMP.fw * IMP.views, Hh = IMP.fh * IMP.rows;
  const rtA = new THREE.WebGLRenderTarget(W, Hh, rtOpts), rtN = new THREE.WebGLRenderTarget(W, Hh, rtOpts);
  const oldColour = renderer.getClearColor(new THREE.Color()), oldAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  for (const rt of [rtA, rtN]) { renderer.setRenderTarget(rt); rt.scissorTest = false; renderer.clear(); }
  const disposables: { dispose(): void }[] = [];
  frames.forEach(({ model, size, ctr }, row) => {
    const halfH = size.y * 0.51, halfW = aspect * halfH, reach = Math.max(size.x, size.y, size.z);
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, reach * 0.1, reach * 6);
    const bakeScene = new THREE.Scene();
    bakeScene.add(model);
    const meshes: THREE.Mesh[] = [];
    model.traverse(o => { if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh); });
    const originals = meshes.map(o => o.material as THREE.MeshStandardMaterial);
    const colour = originals.map(m => {
      const mat = new THREE.MeshBasicMaterial({
        map: m.map || null, color: m.color ? m.color.clone() : new THREE.Color(1, 1, 1),
        alphaTest: m.alphaTest > 0 || m.transparent ? 0.5 : 0, side: THREE.DoubleSide
      });
      mat.onBeforeCompile = toneMapBake;
      return mat;
    });
    const normals = originals.map(m => bakeNormalMat(m.alphaTest > 0 ? m.map : null));
    for (const [rt, mats] of [[rtA, colour], [rtN, normals]] as const) {
      meshes.forEach((o, i) => { o.material = mats[i]; });
      for (let i = 0; i < IMP.views; i++) {
        const a = i / IMP.views * Math.PI * 2;
        cam.position.set(ctr.x + Math.sin(a) * reach * 2, ctr.y, ctr.z + Math.cos(a) * reach * 2);
        cam.lookAt(ctr);
        cam.updateMatrixWorld();
        rt.viewport.set(i * IMP.fw, row * IMP.fh, IMP.fw, IMP.fh);
        rt.scissor.copy(rt.viewport);
        rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.clear(); // autoClear is off
        renderer.render(bakeScene, cam);
      }
    }
    model.traverse(o => { if ((o as THREE.Mesh).isMesh) disposables.push((o as THREE.Mesh).geometry, (o as THREE.Mesh).material as THREE.Material); });
    disposables.push(...originals, ...colour, ...normals);
    originals.forEach(m => { if (m.map) disposables.push(m.map); });
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(oldColour, oldAlpha);
  // Only the atlases are kept; free the models.
  new Set(disposables).forEach(d => d.dispose());
  return { albedo: rtA.texture, normal: rtN.texture, aspect };
}

function cellHash(ix: number, iz: number, k: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Chance of a tree at a spot: none on cliffs, thinning toward the tree line, few in towns.
function treeChance(x: number, z: number, h: number) {
  if (h < 1.5 || h > 1350) return 0;
  const gx = sampleH(x + 10, z) - sampleH(x - 10, z), gz = sampleH(x, z + 10) - sampleH(x, z - 10);
  const grade = Math.hypot(gx, gz) / 20;
  // Trees start a few metres above the water, leaving the shore's band of bare rock.
  let c = 0.95 * (1 - smooth(0.9, 1.5, grade)) * (1 - 0.85 * smooth(900, 1350, h)) * smooth(2.5, 8, h);
  if (isTown(x, z)) c *= 0.12;
  return c * (0.8 + 0.2 * snoise(x * 0.004, z * 0.004));
}
// Species of a tree from a per-cell random number r and the ground height: Douglas fir dominates;
// western red cedar is common low down and near water, rare high up; western hemlock throughout.
function treeSpecies(r: number, h: number) {
  const cedar = h < 150 ? 0.30 : h < 500 ? 0.12 : 0.03, hemlock = 0.28;
  return r < cedar ? 1 : r < cedar + hemlock ? 2 : 0;
}
// One quad per tree, with per-tree attributes written straight into typed arrays.
const TREE_ATTRS = [['iPos', 3], ['iSize', 3], ['iMisc', 3]] as const;
function forestMesh(cap: number, material: THREE.ShaderMaterial) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, size] of TREE_ATTRS) {
    g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage));
  }
  g.instanceCount = 0;
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 2;
  mesh.userData.isForest = true;
  return mesh;
}
// Fill a ring around (cx, cz) into a mesh, yielding after every few grid rows so the work can be
// spread over frames. ring.written tracks progress so each slice can be uploaded as it is made.
function* ringJob(ring: Ring, mesh: Ring['back'], cx: number, cz: number): Generator<undefined, number> {
  const cell = ring.cell, salt = ring.salt, cap = ring.cap, g = mesh.geometry, reach = ring.reach + ring.margin;
  const P = g.attributes.iPos.array as Float32Array, S = g.attributes.iSize.array as Float32Array, M = g.attributes.iMisc.array as Float32Array;
  const i0 = Math.floor((cx - reach) / cell), i1 = Math.floor((cx + reach) / cell);
  const k0 = Math.floor((cz - reach) / cell), k1 = Math.floor((cz + reach) / cell);
  let n = 0;
  for (let k = k0; k <= k1 && n < cap; k++) {
    for (let i = i0; i <= i1 && n < cap; i++) {
      const x = (i + 0.1 + 0.8 * cellHash(i, k, salt)) * cell, z = (k + 0.1 + 0.8 * cellHash(i, k, salt + 1)) * cell;
      const w = ring.maxWeight(Math.hypot(x - cx, z - cz));
      const pick = cellHash(i, k, salt + 2);
      if (pick >= w) continue; // cheap reject before any height lookups
      const h = sampleH(x, z);
      if (h < 1.5) continue;
      const chance = treeChance(x, z, h);
      if (pick >= w * chance) continue;
      const v = cellHash(i, k, salt + 3);
      const species = treeSpecies(cellHash(i, k, salt + 7), h);
      P[n * 3] = x; P[n * 3 + 1] = h - 1.0; P[n * 3 + 2] = z;
      S[n * 3] = lerp(22, 48, v * v) * (1 - 0.55 * smooth(700, 1300, h)) * (species ? 0.88 : 1); // height, m; fir tallest
      S[n * 3 + 1] = lerp(0.85, 1.2, cellHash(i, k, salt + 4)); // width factor
      S[n * 3 + 2] = species;
      M[n * 3] = cellHash(i, k, salt + 5) * 6.2832; // yaw
      M[n * 3 + 1] = cellHash(i, k, salt + 6); // shade
      M[n * 3 + 2] = pick / chance; // shown while the ring's weight at the camera is above this
      n++;
    }
    ring.written = n;
    if ((k - k0) % 3 === 2) yield;
  }
  ring.written = n;
  return n;
}
// Mark the trees written since the last call for upload. The back mesh stays in the scene with
// zero instances, so three uploads each slice the frame it is made instead of all at once on swap.
function uploadSlice(ring: Ring) {
  if (ring.written <= ring.uploaded) return;
  const g = ring.back.geometry;
  for (const [name, size] of TREE_ATTRS) {
    const a = g.attributes[name] as THREE.InstancedBufferAttribute;
    a.addUpdateRange(ring.uploaded * size, (ring.written - ring.uploaded) * size);
    a.needsUpdate = true;
  }
  ring.uploaded = ring.written;
}

const treeState = { style: null as TreeStyle | null, ready: false, atlas: null as ReturnType<typeof bakeForestAtlas> | null };

export function buildForest() {
  for (const spec of RING_SPECS) {
    const [a, b, c, d] = spec.band;
    const margin = spec.every * 2; // how far the camera may move before the next rebuild is swapped in
    const mat = makeTreeMat(spec.band);
    const ring: Ring = {
      ...spec, reach: d, margin,
      // The highest weight any camera within the margin could give a tree at distance dist from the job centre.
      maxWeight: dist => smooth(a, b, dist + margin) * (1 - smooth(c, d, dist - margin)),
      front: forestMesh(spec.cap, mat), back: forestMesh(spec.cap, mat),
      cx: Infinity, cz: Infinity, jobX: 0, jobZ: 0, jobStart: 0, job: null, written: 0, uploaded: 0, enabled: true
    };
    ring.back.visible = true; // drawn with zero instances, so its uploads happen as the job runs
    scene.add(ring.front, ring.back);
    notReflectedOnLowerPresets.push(ring.front, ring.back);
    FOREST.push(ring);
  }
  applyForestQuality();
}
/** Turn the far ring on or off for the current preset. */
export function applyForestQuality() {
  for (const ring of FOREST) ring.enabled = ring.name !== 'far' || quality.farTrees;
  showForest();
}
function showForest() {
  for (const ring of FOREST) { ring.front.visible = treeState.ready && ring.enabled; ring.back.visible = ring.enabled; }
}
/** Rebuild the rings that the camera has moved away from, within the per-frame budget. */
export function updateForest(pos: THREE.Vector3) {
  const t0 = performance.now(); // one budget for all rings, so simultaneous rebuilds don't stack up
  for (const ring of FOREST) {
    if (!ring.enabled) continue;
    if (!ring.job) {
      if (Math.hypot(pos.x - ring.cx, pos.z - ring.cz) < ring.every) continue;
      ring.back.geometry.instanceCount = 0;
      ring.job = ringJob(ring, ring.back, pos.x, pos.z);
      ring.written = ring.uploaded = 0;
      ring.jobX = pos.x; ring.jobZ = pos.z;
      ring.jobStart = performance.now();
    }
    // The first fill runs to completion; later rebuilds share a small slice of each frame.
    const first = ring.cx === Infinity;
    if (!first && performance.now() - t0 >= forestTuning.budgetMs) continue;
    let r: IteratorResult<undefined, number>;
    do { r = ring.job.next(); } while (!r.done && (first || performance.now() - t0 < forestTuning.budgetMs));
    uploadSlice(ring);
    if (!r.done) continue;
    ring.back.geometry.instanceCount = r.value;
    [ring.front, ring.back] = [ring.back, ring.front];
    ring.back.geometry.instanceCount = 0;
    ring.cx = ring.jobX; ring.cz = ring.jobZ; ring.job = null;
    showForest();
    if (!ring.logged) { ring.logged = true; console.info(`Forest ${ring.name} ring: ${r.value} trees in ${(performance.now() - ring.jobStart).toFixed(0)} ms`); }
  }
}
/** Rebuild every ring around the camera at once on the next frame (after a jump). */
export function resetForest() {
  for (const ring of FOREST) { ring.cx = ring.cz = Infinity; ring.job = null; }
}
/** Show the trees or hide them, for benchmarks (?debug). */
export function setTreesShown(on: boolean) {
  for (const r of FOREST) r.front.visible = on && treeState.ready && r.enabled;
}

/** Switch the tree style (baking the species atlas on first use), or turn trees off. */
export async function setTreeStyle(name: string) {
  const style: TreeStyle = name in TREE_STYLES ? name as TreeStyle : 'off';
  treeState.style = style;
  document.querySelectorAll<HTMLElement>('#trees button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.style === style)));
  if (style === 'off') { treeState.ready = false; showForest(); return; }
  try {
    const t0 = performance.now();
    const imp = await (treeState.atlas ||= bakeForestAtlas());
    if (treeState.style !== style) return;
    treeU.tAlbedo.value = imp.albedo; treeU.tNormal.value = imp.normal;
    treeU.uAspect.value = imp.aspect; treeU.uSpecies.value = TREE_STYLES[style];
    treeState.ready = true;
    showForest();
    console.info(`Trees (${style}) ready in ${(performance.now() - t0).toFixed(0)} ms`);
  } catch (err) {
    console.error(`Could not load the tree models from ${TREE_DIR}`, err);
    treeState.ready = false; showForest();
  }
}
