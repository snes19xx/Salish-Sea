// Geography: the real heightmaps written by tools/export_pilot.py into pilot/data/<area>/.
// Metres, x east, -z north, origin set per area. Grids are row-major, row 0 = north (min z).
// The detail grid (30 m) is where you sail; the backdrop grid (100 m) shows the mountains around it.
import { lerp, params, smooth } from '../core/util';

export interface Grid { nx: number; nz: number; dx: number; minX: number; minZ: number; h: Float32Array }

export interface Label { name: string; kind: string; x: number; y: number; z: number; max: number }
export interface AreaMeta {
  area: string; title: string; coord: string; note: string;
  width: number; height: number; spacing: number; minX: number; minZ: number;
  backdrop: { width: number; height: number; spacing: number; minX: number; minZ: number };
  origin: { lon: number; lat: number; E0: number; N0: number };
  labels: Label[];
  flyover: [number, number, number][];
  boat: { x: number; z: number; hdg: number };
  wind: { from: number; kn: number };
  lakes?: { name: string | null; surface: number; rings: [number, number][][] }[];
}

export const AREA = (params.get('area') || 'howe').replace(/[^a-z0-9_-]/gi, '');
export const DATA = `${import.meta.env.BASE_URL}data/${AREA}/`;
/** The 2 m lidar window is on by default where one exists (howe); ?lidar=0 turns it off. */
export const LIDAR_ON = AREA === 'howe' && params.get('lidar') !== '0';

const EDGE_BLEND = 900; // detail heights blend into the backdrop over this many metres at the grid edge
const BACK_FADE = 3000; // the backdrop's own outer edge sinks into the sea over this distance
export const BACK_DROP = 3; // backdrop sits this far below the detail where they overlap

/** The loaded area. `detail.h` is blended into the backdrop at its edge; `seabed` keeps the
 *  unblended heights for the water shader, so the sea colour stays right at the edge. */
export const geo = {
  detail: { nx: 2, nz: 2, dx: 30, minX: 0, minZ: 0, h: new Float32Array(4) } as Grid,
  maxX: 1, maxZ: 1,
  seabed: new Float32Array(4),
  mask: new Uint8Array(4), // 1 = built-up
  backdrop: { nx: 0, nz: 0, dx: 100, minX: 0, minZ: 0, h: new Float32Array(0) } as Grid, // empty until loaded
  // A 2 m lidar window around Horseshoe Bay (tools/spike_lidar.py), drawn over the 30 m ground.
  lidar: null as Grid | null,
  meta: null as AreaMeta | null
};

export function gridSample(g: Grid, x: number, z: number, outside: number) {
  const fx = (x - g.minX) / g.dx, fz = (z - g.minZ) / g.dx;
  if (fx < 0 || fz < 0 || fx >= g.nx - 1 || fz >= g.nz - 1) return outside;
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * g.nx + ix, h = g.h;
  return (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - tz) + (h[i + g.nx] * (1 - tx) + h[i + g.nx + 1] * tx) * tz;
}
/** Ground height at (x, z): the detail grid, the backdrop around it, -300 m beyond both. */
export function sampleH(x: number, z: number) {
  if (geo.lidar) { const l = gridSample(geo.lidar, x, z, NaN); if (l === l) return l; }
  const g = geo.detail;
  const fx = (x - g.minX) / g.dx, fz = (z - g.minZ) / g.dx;
  if (fx < 0 || fz < 0 || fx >= g.nx - 1 || fz >= g.nz - 1) return gridSample(geo.backdrop, x, z, -300);
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * g.nx + ix, H = g.h, NX = g.nx;
  return (H[i] * (1 - tx) + H[i + 1] * tx) * (1 - tz) + (H[i + NX] * (1 - tx) + H[i + NX + 1] * tx) * tz;
}
export function isTown(x: number, z: number) {
  const g = geo.detail;
  const c = Math.round((x - g.minX) / g.dx), r = Math.round((z - g.minZ) / g.dx);
  return c >= 0 && r >= 0 && c < g.nx && r < g.nz && geo.mask[r * g.nx + c] === 1;
}

export async function loadData() {
  const get = (name: string) => fetch(DATA + name).then(r => {
    if (!r.ok) throw new Error(`${DATA}${name}: HTTP ${r.status}`);
    return r;
  });
  const [meta, hBuf, bBuf, mBuf] = await Promise.all([
    get('pilot_height.json').then(r => r.json() as Promise<AreaMeta>),
    get('pilot_height.bin').then(r => r.arrayBuffer()),
    get('pilot_backdrop.bin').then(r => r.arrayBuffer()),
    get('pilot_mask.bin').then(r => r.arrayBuffer())
  ]);
  const NX = meta.width, NZ = meta.height, DX = meta.spacing;
  const H = new Float32Array(hBuf), MASK = new Uint8Array(mBuf);
  if (H.length !== NX * NZ || MASK.length !== NX * NZ) throw new Error(`detail grid size mismatch (${H.length}, ${MASK.length}, expected ${NX * NZ})`);
  const b = meta.backdrop;
  const BG: Grid = { nx: b.width, nz: b.height, dx: b.spacing, minX: b.minX, minZ: b.minZ, h: new Float32Array(bBuf) };
  if (BG.h.length !== BG.nx * BG.nz) throw new Error('backdrop grid size mismatch');
  // Sink the backdrop's outer edge into the sea so the world has no walls.
  for (let r = 0; r < BG.nz; r++) for (let c = 0; c < BG.nx; c++) {
    const d = Math.min(c, BG.nx - 1 - c, r, BG.nz - 1 - r) * BG.dx;
    if (d < BACK_FADE) { const i = r * BG.nx + c; BG.h[i] = lerp(-70, BG.h[i], smooth(0, BACK_FADE, d)); }
  }
  // Blend the detail edge into the backdrop so the two meshes meet without a step.
  const seabed = H.slice();
  for (let r = 0; r < NZ; r++) for (let c = 0; c < NX; c++) {
    const d = Math.min(c, NX - 1 - c, r, NZ - 1 - r) * DX;
    if (d < EDGE_BLEND) {
      const i = r * NX + c, bh = gridSample(BG, meta.minX + c * DX, meta.minZ + r * DX, H[i]);
      H[i] = lerp(bh, H[i], smooth(0, EDGE_BLEND, d));
    }
  }
  geo.detail = { nx: NX, nz: NZ, dx: DX, minX: meta.minX, minZ: meta.minZ, h: H };
  geo.maxX = meta.minX + (NX - 1) * DX; geo.maxZ = meta.minZ + (NZ - 1) * DX;
  geo.seabed = seabed; geo.mask = MASK; geo.backdrop = BG; geo.meta = meta;
  if (LIDAR_ON) {
    const [lm, lb] = await Promise.all([
      get('pilot_lidar.json').then(r => r.json() as Promise<{ width: number; height: number; spacing: number; minX: number; minZ: number }>),
      get('pilot_lidar.bin').then(r => r.arrayBuffer())
    ]);
    geo.lidar = { nx: lm.width, nz: lm.height, dx: lm.spacing, minX: lm.minX, minZ: lm.minZ, h: new Float32Array(lb) };
  }
}
