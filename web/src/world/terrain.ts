// Terrain meshes: the detail grid and the backdrop around it, as square tiles with three levels of
// detail and skirts. One material per mesh so each has its own uHole (an xz rectangle not drawn;
// empty for the detail mesh); the shared lighting uniforms in U stay shared.
import * as THREE from 'three';
import { U, passes, scene } from '../core/renderer';
import { params } from '../core/util';
import { BACK_DROP, geo, type Grid } from './data';
import NOISE from '../shaders/noise.glsl?raw';
import SKY_COMMON from '../shaders/sky_common.glsl?raw';
import terrainVert from '../shaders/terrain.vert?raw';
import terrainFrag from '../shaders/terrain.frag?raw';

const makeTerrainMat = (hole: THREE.Vector4) => new THREE.ShaderMaterial({
  uniforms: { ...U, uHole: { value: hole } },
  vertexShader: terrainVert,
  fragmentShader: SKY_COMMON + NOISE + terrainFrag
});

// Terrain from a grid, using every stride-th sample, as a group of square tiles (TERRAIN_TILE cells
// a side). Each tile is frustum-culled on its own, so a pass only processes the tiles it can see:
// the near pass a few around the camera, the far pass those in view beyond it. As single meshes the
// GPU transformed all 3.3 M terrain triangles in every one of the four passes, which was most of
// the frame time. heightAt(x, z, h) may adjust each vertex; tiles entirely inside hole are skipped.
const TERRAIN_TILE = Math.max(16, parseInt(params.get('tile') || '', 10) || 128);
function terrainMesh(g: Grid, stride: number, hole: THREE.Vector4, heightAt: ((x: number, z: number, h: number) => number) | null, renderOrder: number) {
  const SX = Math.floor((g.nx - 1) / stride), SZ = Math.floor((g.nz - 1) / stride);
  const step = stride * g.dx;
  const MX = SX + 1, MZ = SZ + 1;
  const mh = new Float32Array(MX * MZ);
  for (let r = 0; r < MZ; r++) for (let c = 0; c < MX; c++) {
    const h = g.h[(r * stride) * g.nx + c * stride];
    mh[r * MX + c] = heightAt ? heightAt(g.minX + c * step, g.minZ + r * step, h) : h;
  }
  // Normals from central differences over the whole grid, so tiles meet without seams.
  const nrm = new Float32Array(MX * MZ * 3);
  for (let r = 0; r < MZ; r++) for (let c = 0; c < MX; c++) {
    const c0 = Math.max(c - 1, 0), c1 = Math.min(c + 1, MX - 1), r0 = Math.max(r - 1, 0), r1 = Math.min(r + 1, MZ - 1);
    const gx = (mh[r * MX + c1] - mh[r * MX + c0]) / ((c1 - c0) * step);
    const gz = (mh[r1 * MX + c] - mh[r0 * MX + c]) / ((r1 - r0) * step);
    const inv = 1 / Math.hypot(gx, 1, gz), i = (r * MX + c) * 3;
    nrm[i] = -gx * inv; nrm[i + 1] = inv; nrm[i + 2] = -gz * inv;
  }
  // Cavity (local hollowness) darkens gullies; scaled to the demo's 37.5 m spacing.
  const cavScale = 25 * Math.max(1, stride * g.dx / 37.5);
  const cav = new Float32Array(MX * MZ);
  for (let r = 0; r < MZ; r++) for (let c = 0; c < MX; c++) {
    let s = 0, n = 0;
    for (let dr = -3; dr <= 3; dr += 3) for (let dc = -3; dc <= 3; dc += 3) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < MZ && cc >= 0 && cc < MX && (dr || dc)) { s += mh[rr * MX + cc]; n++; }
    }
    cav[r * MX + c] = Math.max(-1, Math.min(1, (s / n - mh[r * MX + c]) / cavScale));
  }
  // One tile at one level of detail: every s-th grid sample, positions relative to the tile centre
  // (cx, cz), plus a skirt hanging below each edge to hide cracks against neighbours at another level.
  const tileGeometry = (tc: number, tr: number, tw: number, th: number, s: number, cx: number, cz: number) => {
    const cols: number[] = [], rows: number[] = [];
    for (let i = 0; i < tw; i += s) cols.push(tc + i);
    cols.push(tc + tw);
    for (let j = 0; j < th; j += s) rows.push(tr + j);
    rows.push(tr + th);
    const vw = cols.length, vh = rows.length, edge = 2 * (vw + vh), nv = vw * vh + edge;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), cv = new Float32Array(nv);
    const put = (v: number, k: number, drop: number) => {
      const c = k % MX, r = (k - c) / MX;
      pos[v * 3] = g.minX + c * step - cx; pos[v * 3 + 1] = mh[k] - drop; pos[v * 3 + 2] = g.minZ + r * step - cz;
      nor[v * 3] = nrm[k * 3]; nor[v * 3 + 1] = nrm[k * 3 + 1]; nor[v * 3 + 2] = nrm[k * 3 + 2];
      cv[v] = cav[k];
    };
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) put(j * vw + i, rows[j] * MX + cols[i], 0);
    const idx: number[] = [];
    for (let j = 0; j < vh - 1; j++) for (let i = 0; i < vw - 1; i++) {
      const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1;
      idx.push(a, c, b, c, d, b); // counter-clockwise seen from above
    }
    // Skirts: each edge's vertices again, lowered, joined by quads drawn from both sides.
    const skirt = s * step * 2;
    let v = vw * vh;
    for (const ring of [[...Array(vw).keys()], [...Array(vw).keys()].map(i => (vh - 1) * vw + i),
                        [...Array(vh).keys()].map(j => j * vw), [...Array(vh).keys()].map(j => j * vw + vw - 1)]) {
      const base = v;
      for (const top of ring) { put(v++, rows[(top / vw) | 0] * MX + cols[top % vw], skirt); }
      for (let e = 0; e < ring.length - 1; e++) {
        const a = ring[e], b = ring[e + 1], c = base + e, d = base + e + 1;
        idx.push(a, c, b, c, d, b, a, b, c, c, b, d);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geom.setAttribute('cavity', new THREE.BufferAttribute(cv, 1));
    geom.setIndex(idx);
    geom.computeBoundingSphere();
    return geom;
  };
  const mat = makeTerrainMat(hole);
  const group = new THREE.Group(); // renderOrder stays 0 here: a Group's renderOrder would reorder its children against everything else
  const tileSize = TERRAIN_TILE * step;
  let triangles = 0;
  for (let tr = 0; tr < SZ; tr += TERRAIN_TILE) for (let tc = 0; tc < SX; tc += TERRAIN_TILE) {
    const tw = Math.min(TERRAIN_TILE, SX - tc), th = Math.min(TERRAIN_TILE, SZ - tr);
    const x0 = g.minX + tc * step, z0 = g.minZ + tr * step, x1 = x0 + tw * step, z1 = z0 + th * step;
    if (hole.x < x0 && x1 < hole.z && hole.y < z0 && z1 < hole.w) continue; // never drawn
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // Level of detail by distance from the tile centre: full grid nearby, then every 2nd and 4th
    // sample. Distant tiles at full resolution were triangles a few pixels across, which the GPU
    // shades several times over.
    const lod = new THREE.LOD();
    lod.position.set(cx, 0, cz);
    for (const [s, near] of [[1, 0], [2, 1.3], [4, 3.2]]) {
      const mesh = new THREE.Mesh(tileGeometry(tc, tr, tw, th, s, cx, cz), mat);
      mesh.renderOrder = renderOrder;
      lod.addLevel(mesh, near * tileSize);
    }
    group.add(lod);
    triangles += tw * th * 2;
  }
  group.userData.triangles = triangles;
  group.userData.tiles = group.children.length;
  return group;
}

/** Build the detail and backdrop meshes for the loaded area. Returns a one-line summary. */
export function buildTerrain() {
  const g = geo.detail, BG = geo.backdrop;
  // Detail mesh: ?stride=2 for a lighter mesh. sampleH keeps full resolution.
  const STRIDE = Math.max(1, parseInt(params.get('stride') || '', 10) || 1);
  const detail = terrainMesh(g, STRIDE, new THREE.Vector4(1, 1, 0, 0), null, 1);
  scene.add(detail);
  // Backdrop mesh: not drawn inside the detail area (inset by 300 m so the two overlap slightly),
  // and lowered a little under the detail so they never fight for the same pixels.
  const inset = 300;
  const hole = new THREE.Vector4(g.minX + inset, g.minZ + inset, geo.maxX - inset, geo.maxZ - inset);
  const inDetail = (x: number, z: number) => x >= g.minX - BG.dx && x <= geo.maxX + BG.dx && z >= g.minZ - BG.dx && z <= geo.maxZ + BG.dx;
  const backdrop = terrainMesh(BG, 1, hole, (x, z, h) => inDetail(x, z) ? h - BACK_DROP : h, 3);
  scene.add(backdrop);
  passes.backdrop = backdrop; passes.backdropHole = hole;
  return `detail ${g.nx} x ${g.nz} at ${g.dx} m, stride ${STRIDE} (${(detail.userData.triangles / 1e6).toFixed(2)} M tris, ${detail.userData.tiles} tiles); ` +
    `backdrop ${BG.nx} x ${BG.nz} at ${BG.dx} m (${(backdrop.userData.triangles / 1e6).toFixed(2)} M tris, ${backdrop.userData.tiles} tiles)`;
}
