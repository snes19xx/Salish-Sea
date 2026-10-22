// Terrain: the detail grid and the backdrop around it, each drawn with one draw call per pass.
// Each grid's heights, normals and cavity live in a float texture. One shared patch of
// PATCH x PATCH cells is drawn as many instances, each placed by the vertex shader. Before every
// pass, a quadtree over the grid picks the patches that pass needs: only those in its view, with
// finer patches near the camera and coarser ones (every 2nd, 4th, ... sample) further away.
// One material per grid so each has its own uHole (an xz rectangle not drawn; empty for the
// detail grid); the shared lighting uniforms in U stay shared.
import * as THREE from 'three';
import { U, beforeRenderHooks, passes, scene } from '../core/renderer';
import { params } from '../core/util';
import { BACK_DROP, geo, type Grid } from './data';
import NOISE from '../shaders/noise.glsl?raw';
import SKY_COMMON from '../shaders/sky_common.glsl?raw';
import terrainVert from '../shaders/terrain.vert?raw';
import terrainFrag from '../shaders/terrain.frag?raw';

const PATCH = 32; // cells along a patch side
// A patch is split into four finer ones when the camera is closer than this many patch widths.
// Larger keeps fine detail further out (more triangles); ?lod= to try others.
const LOD_RANGE = Math.max(0.5, parseFloat(params.get('lod') || '') || 3);
const MAX_PATCHES = 4096;

// The shared patch: (PATCH + 1)^2 vertices whose position is (column, row, 0), then the four edges
// again as skirt vertices (column, row, 1), joined to the edge by quads drawn from both sides.
function patchShape() {
  const V = PATCH + 1, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) pos.push(i, j, 0);
  for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
    const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
    idx.push(a, c, b, c, d, b); // counter-clockwise seen from above
  }
  const side = [...Array(V).keys()];
  let v = V * V;
  for (const ring of [side, side.map(i => PATCH * V + i), side.map(j => j * V), side.map(j => j * V + PATCH)]) {
    const base = v;
    for (const top of ring) { pos.push(top % V, Math.floor(top / V), 1); v++; }
    for (let e = 0; e < ring.length - 1; e++) {
      const a = ring[e], b = ring[e + 1], c = base + e, d = base + e + 1;
      idx.push(a, c, b, c, d, b, a, b, c, c, b, d);
    }
  }
  return { position: new THREE.Float32BufferAttribute(pos, 3), index: new THREE.Uint16BufferAttribute(idx, 1), triangles: idx.length / 3 };
}
const shape = patchShape();

// Terrain for a grid, using every stride-th sample. heightAt(x, z, h) may adjust each sample;
// patches entirely inside hole are never drawn.
function terrainMesh(g: Grid, stride: number, hole: THREE.Vector4, heightAt: ((x: number, z: number, h: number) => number) | null, renderOrder: number) {
  const SX = Math.floor((g.nx - 1) / stride), SZ = Math.floor((g.nz - 1) / stride);
  const step = stride * g.dx;
  const MX = SX + 1, MZ = SZ + 1;
  const mh = new Float32Array(MX * MZ);
  for (let r = 0; r < MZ; r++) for (let c = 0; c < MX; c++) {
    const h = g.h[(r * stride) * g.nx + c * stride];
    mh[r * MX + c] = heightAt ? heightAt(g.minX + c * step, g.minZ + r * step, h) : h;
  }
  // Texture: height, then the normal from central differences over the whole grid (x and z; y is
  // rebuilt in the shader), then cavity (local hollowness, which darkens gullies; scaled to the
  // demo's 37.5 m spacing).
  const tex = new Float32Array(MX * MZ * 4);
  const cavScale = 25 * Math.max(1, stride * g.dx / 37.5);
  for (let r = 0; r < MZ; r++) for (let c = 0; c < MX; c++) {
    const c0 = Math.max(c - 1, 0), c1 = Math.min(c + 1, MX - 1), r0 = Math.max(r - 1, 0), r1 = Math.min(r + 1, MZ - 1);
    const gx = (mh[r * MX + c1] - mh[r * MX + c0]) / ((c1 - c0) * step);
    const gz = (mh[r1 * MX + c] - mh[r0 * MX + c]) / ((r1 - r0) * step);
    const inv = 1 / Math.hypot(gx, 1, gz), k = r * MX + c;
    let s = 0, n = 0;
    for (let dr = -3; dr <= 3; dr += 3) for (let dc = -3; dc <= 3; dc += 3) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < MZ && cc >= 0 && cc < MX && (dr || dc)) { s += mh[rr * MX + cc]; n++; }
    }
    tex[k * 4] = mh[k]; tex[k * 4 + 1] = -gx * inv; tex[k * 4 + 2] = -gz * inv;
    tex[k * 4 + 3] = Math.max(-1, Math.min(1, (s / n - mh[k]) / cavScale));
  }
  const map = new THREE.DataTexture(tex, MX, MZ, THREE.RGBAFormat, THREE.FloatType);
  map.minFilter = map.magFilter = THREE.NearestFilter;
  map.needsUpdate = true;

  // Quadtree levels: a node at level L covers PATCH << L cells and is drawn with every (1 << L)-th
  // sample. Each level keeps its nodes' lowest and highest ground, for culling and distance.
  const levels: { nx: number; nz: number; lo: Float32Array; hi: Float32Array }[] = [];
  let nx = Math.ceil(SX / PATCH), nz = Math.ceil(SZ / PATCH);
  {
    const lo = new Float32Array(nx * nz).fill(Infinity), hi = new Float32Array(nx * nz).fill(-Infinity);
    for (let r = 0; r < MZ; r++) for (let c = 0; c < MX; c++) {
      const h = mh[r * MX + c];
      // A sample on a patch edge belongs to the patches on both sides.
      const iz1 = Math.min(Math.floor(r / PATCH), nz - 1), ix1 = Math.min(Math.floor(c / PATCH), nx - 1);
      for (let iz = Math.max(Math.ceil(r / PATCH) - 1, 0); iz <= iz1; iz++)
        for (let ix = Math.max(Math.ceil(c / PATCH) - 1, 0); ix <= ix1; ix++) {
          const k = iz * nx + ix;
          if (h < lo[k]) lo[k] = h;
          if (h > hi[k]) hi[k] = h;
        }
    }
    levels.push({ nx, nz, lo, hi });
  }
  while (nx > 1 || nz > 1) {
    const prev = levels[levels.length - 1];
    nx = Math.ceil(nx / 2); nz = Math.ceil(nz / 2);
    const lo = new Float32Array(nx * nz).fill(Infinity), hi = new Float32Array(nx * nz).fill(-Infinity);
    for (let iz = 0; iz < prev.nz; iz++) for (let ix = 0; ix < prev.nx; ix++) {
      const k = (iz >> 1) * nx + (ix >> 1), p = iz * prev.nx + ix;
      lo[k] = Math.min(lo[k], prev.lo[p]); hi[k] = Math.max(hi[k], prev.hi[p]);
    }
    levels.push({ nx, nz, lo, hi });
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(shape.index);
  geometry.setAttribute('position', shape.position);
  const patches = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PATCHES * 3), 3);
  patches.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPatch', patches);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...U, uHole: { value: hole }, tTerrain: { value: map },
      uGrid: { value: new THREE.Vector3(g.minX, g.minZ, step) }, uLast: { value: new THREE.Vector2(SX, SZ) }
    },
    vertexShader: terrainVert,
    fragmentShader: SKY_COMMON + NOISE + terrainFrag
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // culled patch by patch below
  mesh.renderOrder = renderOrder;
  mesh.userData.triangles = SX * SZ * 2; // at full detail

  // Pick the patches for one pass.
  const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4(), box = new THREE.Box3();
  let count = 0, eye = new THREE.Vector3(), range = LOD_RANGE;
  const visit = (L: number, ix: number, iz: number) => {
    const lv = levels[L];
    if (ix >= lv.nx || iz >= lv.nz) return;
    const k = iz * lv.nx + ix, cells = PATCH << L, s = 1 << L, c0 = ix * cells, r0 = iz * cells;
    const x0 = g.minX + c0 * step, x1 = g.minX + Math.min(c0 + cells, SX) * step;
    const z0 = g.minZ + r0 * step, z1 = g.minZ + Math.min(r0 + cells, SZ) * step;
    if (hole.x < x0 && x1 < hole.z && hole.y < z0 && z1 < hole.w) return;
    // Wholly under water: the sea is opaque and flat at 0 m and the cameras stay above it (chase
    // 2.5 m, flyover 55 m), and the reflection discards terrain below the surface, so it never shows.
    if (lv.hi[k] < -1) return;
    box.min.set(x0, lv.lo[k] - 2 * s * step, z0); // down to the bottom of the skirts
    box.max.set(x1, lv.hi[k], z1);
    if (!frustum.intersectsBox(box)) return;
    if (L > 0 && box.distanceToPoint(eye) < range * cells * step) {
      // Nearest child first, so the patches come out front to back: the GPU then skips shading
      // ground hidden behind ground it has already drawn.
      const half = cells / 2;
      const fx = eye.x < g.minX + (c0 + half) * step ? 0 : 1, fz = eye.z < g.minZ + (r0 + half) * step ? 0 : 1;
      visit(L - 1, 2 * ix + fx, 2 * iz + fz); visit(L - 1, 2 * ix + 1 - fx, 2 * iz + fz);
      visit(L - 1, 2 * ix + fx, 2 * iz + 1 - fz); visit(L - 1, 2 * ix + 1 - fx, 2 * iz + 1 - fz);
      return;
    }
    if (count === MAX_PATCHES) return;
    patches.array[count * 3] = c0; patches.array[count * 3 + 1] = r0; patches.array[count * 3 + 2] = s;
    count++;
  };
  beforeRenderHooks.push(cam => {
    if (!mesh.visible) return;
    viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    eye = cam.position;
    // The reflection (uClip on) is drawn at a third of the resolution or less and blurred by the
    // waves, so it gets coarser patches.
    range = U.uClip.value > 0.5 ? LOD_RANGE / 2 : LOD_RANGE;
    count = 0;
    const top = levels.length - 1;
    for (let iz = 0; iz < levels[top].nz; iz++) for (let ix = 0; ix < levels[top].nx; ix++) visit(top, ix, iz);
    geometry.instanceCount = count;
    patches.clearUpdateRanges();
    patches.addUpdateRange(0, count * 3);
    patches.needsUpdate = true;
  });
  return { mesh, levels: levels.length, patchesDrawn: () => geometry.instanceCount };
}

/** Build the detail and backdrop terrain for the loaded area. Returns a one-line summary. */
export function buildTerrain() {
  const g = geo.detail, BG = geo.backdrop;
  // Detail: ?stride=2 for a lighter mesh. sampleH keeps full resolution.
  const STRIDE = Math.max(1, parseInt(params.get('stride') || '', 10) || 1);
  const detail = terrainMesh(g, STRIDE, new THREE.Vector4(1, 1, 0, 0), null, 1);
  scene.add(detail.mesh);
  // Backdrop: not drawn inside the detail area (inset by 300 m so the two overlap slightly), and
  // lowered a little under the detail so they never fight for the same pixels.
  const inset = 300;
  const hole = new THREE.Vector4(g.minX + inset, g.minZ + inset, geo.maxX - inset, geo.maxZ - inset);
  const inDetail = (x: number, z: number) => x >= g.minX - BG.dx && x <= geo.maxX + BG.dx && z >= g.minZ - BG.dx && z <= geo.maxZ + BG.dx;
  const backdrop = terrainMesh(BG, 1, hole, (x, z, h) => inDetail(x, z) ? h - BACK_DROP : h, 3);
  scene.add(backdrop.mesh);
  passes.backdrop = backdrop.mesh; passes.backdropHole = hole;
  return `detail ${g.nx} x ${g.nz} at ${g.dx} m, stride ${STRIDE}, ${detail.levels} levels; ` +
    `backdrop ${BG.nx} x ${BG.nz} at ${BG.dx} m, ${backdrop.levels} levels; patches of ${PATCH} cells (${shape.triangles} triangles), lod ${LOD_RANGE}`;
}
