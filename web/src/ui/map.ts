/* Minimap and chart.
   Toner Lite style: white land, grey water, roads in three greys, dashed ferries, dark labels
   with a white halo. pilot_map.json (tools/export_pilot.py) is turned into world-space paths once;
   every view draws those paths at its own scale, so the map stays sharp at any zoom. Labels are
   placed on top, nudged inside the edges and skipped where they would overlap a more important one.
   Minimap: north-up around the boat; the scroll wheel zooms it. Rather than redraw the paths every
   frame, it draws a patch three times its size around the boat and copies the view out of it,
   redrawing the patch only when the boat nears its edge or the zoom changes.
   Chart (M, or a click on the minimap): the whole area in a large panel. Scroll zooms about the
   cursor, drag moves it, and a click on open water sails the boat there (fast travel). */
import { inSailingBounds, sail } from '../boat/sailing';
import { state, view } from '../core/state';
import { $ } from '../core/util';
import { DATA, sampleH } from '../world/data';
import { resetForest } from '../world/trees';
import { setAttr } from './dom';
import { setMode } from './hud';

const MAP_MPP = 45; // the minimap's starting scale, metres per CSS pixel: about 12 x 8 km
const MAP_ZOOM = [10, 120]; // the minimap's range of scales
const MAP_DPR = Math.min(2, window.devicePixelRatio || 1);
const MAP_WATER = '#dcdcdc', MAP_LAND = '#ffffff', MAP_OFF = '#ece9e2'; // off the map: paper
const MAP_ROADS = [['minor', '#c8c8c8', 0.6], ['main', '#acacac', 1], ['major', '#808080', 1.5]] as const;
const MAP_MINOR_MPP = 70; // minor roads only when closer than this (zoomed out, they're clutter)
// Font and colour per kind, in priority order for placing labels.
const MAP_LABELS: Record<string, [string, string]> = {
  town: ['600 11.5px "Public Sans"', '#1c1c1c'],
  island: ['500 11px "Public Sans"', '#2e2e2e'],
  water: ['italic 400 10px "Public Sans"', '#727272'],
  place: ['500 10px "Public Sans"', '#4c4c4c']
};

interface MapLabel { name: string; kind: string; x: number; z: number; hw: number }
interface MapData {
  extent: [number, number, number, number];
  land: number[][][]; lakes: number[][][];
  roads: Record<string, number[][]>;
  labels: MapLabel[];
}
type Box = [number, number, number, number]; // left, top, right, bottom

const mapView = $<HTMLCanvasElement>('#map');
export const MAP = {
  layers: null as { land: Path2D; lakes: Path2D; roads: Record<string, Path2D> } | null,
  labels: [] as MapLabel[], extent: null as MapData['extent'] | null,
  view: mapView, ctx: mapView.getContext('2d')!, mpp: MAP_MPP,
  patch: null as { canvas: HTMLCanvasElement; gen: number; x0: number; z0: number; mpp: number } | null,
  last: ''
};

export async function loadMap() {
  const r = await fetch(DATA + 'pilot_map.json');
  if (!r.ok) throw new Error(`${DATA}pilot_map.json: HTTP ${r.status}`);
  const m = await r.json() as MapData;
  await Promise.all(Object.values(MAP_LABELS).map(([font]) => document.fonts.load(font)));
  // One path per layer, in world metres.
  const path = (lines: number[][], close: boolean) => {
    const p = new Path2D();
    for (const pts of lines) {
      p.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
      if (close) p.closePath();
    }
    return p;
  };
  const layers = {
    land: path(m.land.flat(), true), lakes: path(m.lakes.flat(), true),
    roads: Object.fromEntries(Object.entries(m.roads).map(([kind, lines]) => [kind, path(lines, false)]))
  };
  // Label widths in CSS pixels, measured once; most important kinds first.
  const kinds = Object.keys(MAP_LABELS);
  const labels = m.labels.filter(l => l.kind in MAP_LABELS).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  for (const l of labels) { MAP.ctx.font = MAP_LABELS[l.kind][0]; l.hw = MAP.ctx.measureText(l.name).width / 2; }
  Object.assign(MAP, { layers, labels, extent: m.extent, patch: null, last: '' });
  BIGMAP.dirty = true;
}

// Draw the map into ctx (w x h device pixels) with world point (x0, z0) at the top-left corner,
// at mpp metres per CSS pixel. Line widths and dashes are in CSS pixels at every scale.
export function drawMapArea(ctx: CanvasRenderingContext2D, w: number, h: number, x0: number, z0: number, mpp: number) {
  const L = MAP.layers!, s = MAP_DPR / mpp; // device pixels per metre
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = MAP_WATER; ctx.fillRect(0, 0, w, h);
  ctx.setTransform(s, 0, 0, s, -x0 * s, -z0 * s);
  ctx.fillStyle = MAP_LAND; ctx.fill(L.land, 'evenodd');
  ctx.fillStyle = MAP_WATER; ctx.fill(L.lakes, 'evenodd');
  ctx.lineCap = ctx.lineJoin = 'round';
  const stroke = (p: Path2D, colour: string, px: number, dash: number[] = []) => {
    ctx.strokeStyle = colour; ctx.lineWidth = px * mpp; ctx.setLineDash(dash.map(d => d * mpp)); ctx.stroke(p);
  };
  for (const [kind, colour, px] of MAP_ROADS) if (kind !== 'minor' || mpp < MAP_MINOR_MPP) stroke(L.roads[kind], colour, px);
  stroke(L.roads.ferry, '#a2a2a2', 0.8, [3, 2.5]);
  ctx.setLineDash([]);
  // Beyond the mapped area there is no data: paper with a hairline edge, not grey water.
  const [ex0, ez0, ex1, ez1] = MAP.extent!, x1 = x0 + w / s, z1 = z0 + h / s;
  if (x0 < ex0 || z0 < ez0 || x1 > ex1 || z1 > ez1) {
    const off = new Path2D();
    off.rect(x0 - 1, z0 - 1, x1 - x0 + 2, z1 - z0 + 2); off.rect(ex0, ez0, ex1 - ex0, ez1 - ez0);
    ctx.fillStyle = MAP_OFF; ctx.fill(off, 'evenodd');
    ctx.strokeStyle = '#bdbab2'; ctx.lineWidth = mpp; ctx.strokeRect(ex0, ez0, ex1 - ex0, ez1 - ez0);
  }
}
// Place the labels on a view of W x H CSS pixels whose top-left is world (x0, z0). The boxes in
// keepClear stay free; a label that lands on the boat (at boat, if given) moves to just below or
// above it.
function drawMapLabels(ctx: CanvasRenderingContext2D, W: number, H: number, x0: number, z0: number, mpp: number, keepClear: Box[], boat?: [number, number]) {
  ctx.setTransform(MAP_DPR, 0, 0, MAP_DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  const hh = 8, placed = keepClear.slice();
  const free = (x: number, y: number, hw: number) => !placed.some(b => x - hw < b[2] && x + hw > b[0] && y - hh < b[3] && y + hh > b[1]);
  for (const l of MAP.labels) {
    let x = (l.x - x0) / mpp, y: number | undefined = (l.z - z0) / mpp;
    if (x < 0 || x > W || y < 0 || y > H) continue;
    const hw = l.hw + 3;
    x = Math.min(Math.max(x, hw), W - hw); y = Math.min(Math.max(y, hh), H - hh);
    if (!free(x, y, hw)) {
      const onBoat = boat && Math.abs(x - boat[0]) < hw + 12 && Math.abs(y - boat[1]) < hh + 12;
      y = onBoat ? [boat[1] + 12 + hh, boat[1] - 12 - hh].find(yy => free(x, yy, hw)) : undefined;
      if (y === undefined) continue;
    }
    placed.push([x - hw, y - hh, x + hw, y + hh]);
    const [font, colour] = MAP_LABELS[l.kind];
    ctx.font = font; ctx.fillStyle = colour;
    ctx.strokeText(l.name, x, y); ctx.fillText(l.name, x, y);
  }
}
// A scale bar in the bottom-left corner: the longest round distance that fits in about 70 px.
const SCALE_BOX = (H: number): Box => [0, H - 22, 110, H]; // kept clear of labels
function drawScaleBar(ctx: CanvasRenderingContext2D, H: number, mpp: number) {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
  const d = steps.filter(m => m / mpp <= 70).pop() || steps[0];
  const x = 8, y = H - 8, len = d / mpp;
  ctx.setTransform(MAP_DPR, 0, 0, MAP_DPR, 0, 0);
  const bar = () => { ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 4); ctx.stroke(); };
  ctx.lineCap = 'square';
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3; bar();
  ctx.strokeStyle = '#4c4c4c'; ctx.lineWidth = 1; bar();
  ctx.font = '500 9.5px "Public Sans"'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const text = d >= 1000 ? `${d / 1000} km` : `${d} m`;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3; ctx.strokeText(text, x + len + 5, y + 1);
  ctx.fillStyle = '#4c4c4c'; ctx.fillText(text, x + len + 5, y + 1);
}
// Size the view canvas to its CSS box (it has none while the panel is hidden).
new ResizeObserver(() => {
  const v = MAP.view, w = Math.round(v.clientWidth * MAP_DPR), h = Math.round(v.clientHeight * MAP_DPR);
  if (w > 0 && h > 0 && (w !== v.width || h !== v.height)) { v.width = w; v.height = h; MAP.last = ''; }
}).observe(MAP.view);

export function updateMap() {
  const { layers, view: v, ctx } = MAP, w = v.width, h = v.height;
  if (!layers || w < 2 || h < 2) return;
  const mpp = MAP.mpp, s = MAP_DPR / mpp, pw = 3 * w, ph = 3 * h;
  let P = MAP.patch, bx = 0, by = 0;
  if (P) { bx = (sail.x - P.x0) * s; by = (sail.z - P.z0) * s; }
  // Redraw the patch around the boat when the view would run off it, or the zoom or size changed.
  if (!P || P.mpp !== mpp || P.canvas.width !== pw || P.canvas.height !== ph || Math.abs(bx - pw / 2) > w || Math.abs(by - ph / 2) > h) {
    P = MAP.patch ||= { canvas: document.createElement('canvas'), gen: 0, x0: 0, z0: 0, mpp: 0 };
    if (P.canvas.width !== pw || P.canvas.height !== ph) { P.canvas.width = pw; P.canvas.height = ph; }
    // The patch corner on a whole device pixel, so the copied view doesn't shimmer.
    P.x0 = Math.floor(sail.x * s - pw / 2) / s; P.z0 = Math.floor(sail.z * s - ph / 2) / s;
    P.mpp = mpp; P.gen++;
    drawMapArea(P.canvas.getContext('2d')!, pw, ph, P.x0, P.z0, mpp);
    bx = (sail.x - P.x0) * s; by = (sail.z - P.z0) * s;
  }
  const sx = Math.round(bx - w / 2), sy = Math.round(by - h / 2);
  const key = `${sx},${sy},${P.gen}`;
  if (key === MAP.last) return;
  MAP.last = key;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(P.canvas, sx, sy, w, h, 0, 0, w, h);
  // Labels keep the compass corner, the scale bar and the boat clear.
  const W = w / MAP_DPR, H = h / MAP_DPR;
  drawMapLabels(ctx, W, H, P.x0 + sx / s, P.z0 + sy / s, mpp,
    [[W - 44, 0, W, 44], SCALE_BOX(H), [W / 2 - 12, H / 2 - 12, W / 2 + 12, H / 2 + 12]], [W / 2, H / 2]);
  drawScaleBar(ctx, H, mpp);
}
// Wheel steps in pixels (Firefox reports lines for a mouse wheel), as a zoom factor: 1.2 per notch.
const wheelZoom = (e: WheelEvent) => Math.exp(e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1) * 0.0018);
$('#minimap').addEventListener('wheel', e => {
  e.preventDefault();
  MAP.mpp = Math.min(MAP_ZOOM[1], Math.max(MAP_ZOOM[0], MAP.mpp * wheelZoom(e)));
  updateMap();
}, { passive: false });
$('#minimap').addEventListener('click', () => toggleBigMap(true));

/* The chart. Its view is a centre (cx, cz) in world metres and a scale; it opens showing the
   whole area. The paths are redrawn only when the view changes; the boat mark is SVG on top. */
const bigCanvas = $<HTMLCanvasElement>('#bigmap-canvas');
export const BIGMAP = {
  el: $('#bigmap'), view: $('#bigmap-view'), canvas: bigCanvas, ctx: bigCanvas.getContext('2d')!, open: false,
  cx: 0, cz: 0, mpp: 45, dirty: true,
  drag: null as { x: number; y: number; moved: number } | null,
  labelBoat: null as [number, number] | null
};
function sizeBigMap() {
  const c = BIGMAP.canvas, w = Math.round(c.clientWidth * MAP_DPR), h = Math.round(c.clientHeight * MAP_DPR);
  if (w > 0 && h > 0 && (w !== c.width || h !== c.height)) { c.width = w; c.height = h; BIGMAP.dirty = true; }
}
new ResizeObserver(sizeBigMap).observe(BIGMAP.canvas);
// The scale that fits the whole area, and the limits of zooming and moving.
function bigMapFit() {
  const [x0, z0, x1, z1] = MAP.extent!, W = BIGMAP.canvas.clientWidth || 1, H = BIGMAP.canvas.clientHeight || 1;
  return Math.max((x1 - x0) / W, (z1 - z0) / H) * 1.03;
}
function bigMapClamp() {
  const [x0, z0, x1, z1] = MAP.extent!;
  BIGMAP.mpp = Math.min(bigMapFit() * 1.5, Math.max(6, BIGMAP.mpp));
  BIGMAP.cx = Math.min(x1, Math.max(x0, BIGMAP.cx)); BIGMAP.cz = Math.min(z1, Math.max(z0, BIGMAP.cz));
  BIGMAP.dirty = true;
}
export function toggleBigMap(open = !BIGMAP.open) {
  if (open && !MAP.extent) return; // the map data hasn't loaded
  BIGMAP.open = open;
  BIGMAP.el.hidden = !open;
  if (!open) return;
  sizeBigMap(); // now, rather than a frame later from the ResizeObserver
  const [x0, z0, x1, z1] = MAP.extent!;
  BIGMAP.cx = (x0 + x1) / 2; BIGMAP.cz = (z0 + z1) / 2; BIGMAP.mpp = bigMapFit();
  BIGMAP.dirty = true;
}
// World position under a pointer event.
function bigMapWorld(e: MouseEvent): [number, number] {
  const r = BIGMAP.canvas.getBoundingClientRect();
  return [BIGMAP.cx + (e.clientX - r.left - r.width / 2) * BIGMAP.mpp, BIGMAP.cz + (e.clientY - r.top - r.height / 2) * BIGMAP.mpp];
}
/** Open water the boat may sail to: inside the sailing area and at least 3 m deep around the spot. */
export function canSailTo(x: number, z: number) {
  if (!inSailingBounds(x, z)) return false;
  return [[0, 0], [15, 0], [-15, 0], [0, 15], [0, -15]].every(([dx, dz]) => sampleH(x + dx, z + dz) < -3);
}
// Fast travel: the boat starts from rest at the new spot, the chase camera snaps behind it, and
// both tree rings are rebuilt there at once (one long frame) rather than filling in over a second.
function sailTo(x: number, z: number) {
  sail.x = x; sail.z = z; sail.kn = 0;
  resetForest();
  if (state.mode !== 'sail') setMode('sail'); else view.camInit = false;
  toggleBigMap(false);
}
BIGMAP.view.addEventListener('wheel', e => {
  e.preventDefault();
  // Zoom about the cursor: the point under it stays put.
  const [wx, wz] = bigMapWorld(e), f = wheelZoom(e);
  const before = BIGMAP.mpp;
  BIGMAP.mpp *= f; bigMapClamp();
  const k = BIGMAP.mpp / before;
  BIGMAP.cx = wx + (BIGMAP.cx - wx) * k; BIGMAP.cz = wz + (BIGMAP.cz - wz) * k;
  bigMapClamp();
}, { passive: false });
BIGMAP.view.addEventListener('pointerdown', e => {
  BIGMAP.drag = { x: e.clientX, y: e.clientY, moved: 0 };
  BIGMAP.view.setPointerCapture(e.pointerId);
});
BIGMAP.view.addEventListener('pointermove', e => {
  const d = BIGMAP.drag;
  if (!d) { const [x, z] = bigMapWorld(e); BIGMAP.view.classList.toggle('water', canSailTo(x, z)); return; }
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  d.moved += Math.abs(dx) + Math.abs(dy); d.x = e.clientX; d.y = e.clientY;
  if (d.moved < 4) return; // still a click
  BIGMAP.view.classList.add('dragging');
  BIGMAP.cx -= dx * BIGMAP.mpp; BIGMAP.cz -= dy * BIGMAP.mpp;
  bigMapClamp();
});
BIGMAP.view.addEventListener('pointerup', e => {
  const d = BIGMAP.drag;
  BIGMAP.drag = null; BIGMAP.view.classList.remove('dragging');
  if (!d || d.moved >= 4) return;
  const [x, z] = bigMapWorld(e);
  if (canSailTo(x, z)) sailTo(x, z);
});
BIGMAP.view.addEventListener('pointercancel', () => { BIGMAP.drag = null; BIGMAP.view.classList.remove('dragging'); });
$('#bigmap-close').addEventListener('click', () => toggleBigMap(false));

export function updateBigMap() {
  if (!BIGMAP.open || !MAP.layers) return;
  const { canvas, ctx } = BIGMAP, w = canvas.width, h = canvas.height, W = w / MAP_DPR, H = h / MAP_DPR;
  if (w < 2 || h < 2) return;
  const x0 = BIGMAP.cx - W / 2 * BIGMAP.mpp, z0 = BIGMAP.cz - H / 2 * BIGMAP.mpp;
  const bx = (sail.x - x0) / BIGMAP.mpp, by = (sail.z - z0) / BIGMAP.mpp;
  // Redraw when the view changed, or the boat has moved far enough to need labels moved off it.
  const lb = BIGMAP.labelBoat;
  if (BIGMAP.dirty || !lb || Math.hypot(bx - lb[0], by - lb[1]) > 6) {
    BIGMAP.dirty = false; BIGMAP.labelBoat = [bx, by];
    drawMapArea(ctx, w, h, x0, z0, BIGMAP.mpp);
    drawMapLabels(ctx, W, H, x0, z0, BIGMAP.mpp, [[W - 58, 0, W, 58], SCALE_BOX(H), [bx - 12, by - 12, bx + 12, by + 12]], [bx, by]);
    drawScaleBar(ctx, H, BIGMAP.mpp);
  }
  setAttr('#bigmapBoat', 'transform', `translate(${bx.toFixed(1)} ${by.toFixed(1)}) rotate(${Math.round(sail.hdg) % 360})`);
}
