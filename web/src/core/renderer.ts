// Renderer, scene, cameras and lights, the uniforms shared by every shader, and the two-range
// depth split that draws each view.
import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { quality, type AntiAlias } from './quality';
import { $, params } from './util';

export const stage = $('#stage'); // the scene fills everything under the masthead
export const canvas = $<HTMLCanvasElement>('#c');

// No logarithmic depth: it writes depth from every fragment shader, which turns off the GPU's
// early rejection of hidden pixels and doubled the frame time. Each view is instead drawn in two
// depth ranges (far, then near); see renderSplit().
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.aa === 'msaa', powerPreference: 'high-performance' });
const canvasMsaa = !!renderer.getContext().getContextAttributes()?.antialias;
renderer.autoClear = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// The render scale in use: the preset's, lowered by dynamic resolution (core/dynres.ts) when
// frames run long.
let renderScale = quality.renderScale;
export const currentRenderScale = () => renderScale;
/** Change the render scale and (unless told not to) resize the drawing buffers to match. */
export function setRenderScale(s: number, doResize = true) {
  if (s === renderScale) return;
  renderScale = s;
  if (doResize) resize();
}

/** Canvas pixels per CSS pixel: the render scale, or ?pr= (capped at the screen's). */
export function pixelRatio() {
  const pr = parseFloat(params.get('pr') || '');
  return pr > 0 ? Math.min(window.devicePixelRatio || 1, pr) : renderScale;
}
renderer.setPixelRatio(pixelRatio());
renderer.setSize(stage.clientWidth, stage.clientHeight);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1.5, 140000);
export const mirrorCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1.5, 140000);
// Depth split: about 2.5 cm of depth precision at the split distance and a few cm at 20 km.
export const SPLIT = 800;
const camNear = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1.5, SPLIT);
const camFar = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, SPLIT * 0.95, 140000);
scene.add(camera);
scene.fog = new THREE.FogExp2(0x8899aa, 5e-5);
// Light units: three.js r150 scaled punctual lights by pi in its legacy mode, which r165 removed,
// so the same look needs intensity pi. Only the boat's standard materials use these lights; the
// terrain, water, sky and trees light themselves from the uniforms below.
export const sunLight = new THREE.DirectionalLight(0xffffff, Math.PI);
export const hemi = new THREE.HemisphereLight(0x8899bb, 0x223322, Math.PI);
scene.add(sunLight, sunLight.target, hemi);

/** Uniforms shared by the sky, terrain, water and tree shaders (spread into each material). */
export const U = {
  sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Vector3(1, 1, 1) },
  ambSky: { value: new THREE.Vector3(0.3, 0.35, 0.45) }, ambGround: { value: new THREE.Vector3(0.05, 0.06, 0.05) },
  fogDensity: { value: 5e-5 }, uOvercast: { value: 0 }, uTime: { value: 0 }, uClip: { value: 0 },
  // Night sky: star visibility (0-1) and the rotation from local east-north-up to J2000 equatorial.
  uStars: { value: 0 }, uEq: { value: new THREE.Matrix3() },
  uDetail: { value: 1 } // 1 = terrain crowns and fine relief on, 0 = off
};

/** Objects the depth split treats specially, registered by the modules that make them. */
export const passes = {
  dome: null as THREE.Object3D | null,
  backdrop: null as THREE.Object3D | null,
  backdropHole: null as THREE.Vector4 | null
};

// Draw a view in two depth ranges so a standard depth buffer has enough precision for 1.5 m to
// 140 km: everything beyond SPLIT into the back half of the depth buffer, then the near range into
// the front half, so near geometry always wins. Not a depth clear between them: on tiled GPUs
// (Apple) a mid-frame clear makes Firefox store and reload the whole multisampled framebuffer,
// which cost about 3 ms a frame at 1080p.
export function renderSplit(cam: THREE.Camera, target: THREE.WebGLRenderTarget | null) {
  const gl = renderer.getContext();
  for (const c of [camFar, camNear]) { c.position.copy(cam.position); c.quaternion.copy(cam.quaternion); }
  renderer.setRenderTarget(target);
  renderer.clear();
  gl.depthRange(0.5, 1);
  renderer.render(scene, camFar);
  gl.depthRange(0, 0.5);
  // The near range never needs the sky, nor the backdrop when the camera is well inside the detail area.
  const p = cam.position, hb = passes.backdropHole, dome = passes.dome, back = passes.backdrop;
  const skipBack = hb && p.x - hb.x > SPLIT && hb.z - p.x > SPLIT && p.z - hb.y > SPLIT && hb.w - p.z > SPLIT;
  const domeVis = dome ? dome.visible : false, backVis = back ? back.visible : false;
  if (dome) dome.visible = false;
  if (back && skipBack) back.visible = false;
  renderer.render(scene, camNear);
  gl.depthRange(0, 1);
  if (dome) dome.visible = domeVis;
  if (back) back.visible = backVis;
  renderer.setRenderTarget(null);
}
/** The antialiasing in effect: MSAA falls back to SMAA if the canvas wasn't made multisampled. */
export function antiAlias(): AntiAlias {
  return quality.aa === 'msaa' && !canvasMsaa ? 'smaa' : quality.aa;
}

// SMAA: the scene is drawn into an off-screen target, then the SMAA pass finds the edges and
// writes the smoothed image to the canvas. Flagging the target the way three.js flags WebXR's
// makes it draw exactly as onto the canvas: tone-mapped and sRGB-encoded into plain 8-bit
// (an ordinary target would get linear, un-tone-mapped colour), so no shader changes, and SMAA
// sees the display colours it is tuned for. Both are made on first use and sized with the canvas.
let smaa: { target: THREE.WebGLRenderTarget; pass: SMAAPass } | null = null;
function smaaTarget() {
  if (!smaa) {
    const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    Object.assign(target, { isXRRenderTarget: true });
    const pass = new SMAAPass();
    pass.clear = true; // its edge pass skips flat pixels, and autoClear is off
    pass.renderToScreen = true;
    smaa = { target, pass };
    sizeSmaa();
  }
  return smaa;
}
function sizeSmaa() {
  if (!smaa) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  smaa.target.setSize(size.x, size.y);
  smaa.pass.setSize(size.x, size.y);
}

export function renderMain() {
  if (antiAlias() !== 'smaa') { renderSplit(camera, null); return; }
  const { target, pass } = smaaTarget();
  renderSplit(camera, target);
  pass.render(renderer, target, target, 0, false);
}

/** Called with the stage size in CSS pixels and the pixel ratio whenever either changes. */
export const resizeHooks: ((w: number, h: number, pr: number) => void)[] = [];
export function resize() {
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h);
  sizeSmaa();
  camera.aspect = mirrorCam.aspect = camNear.aspect = camFar.aspect = w / h;
  for (const c of [camera, mirrorCam, camNear, camFar]) c.updateProjectionMatrix();
  for (const fn of resizeHooks) fn(w, h, renderer.getPixelRatio());
}
new ResizeObserver(resize).observe(stage); // window resizes, and the masthead wrapping to two lines
