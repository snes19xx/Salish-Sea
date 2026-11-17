// Bloom (High): a soft glow around the sun and bright glints on the water. Works on the finished
// frame, so the scene is drawn to the canvas as usual (with MSAA): the frame is copied into a
// texture, its near-white pixels are kept at half resolution, blurred at a quarter and an eighth,
// and the glow is added back onto the canvas. Everything happens in display colours, after tone
// mapping, so the threshold means "close to white on screen".
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Threshold above sunlit white sails (about 0.85-0.9 on screen), so only the sun and glints glow.
export const bloomTuning = { threshold: 0.92, strength: 0.3 };

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
// Keep what is close to white (soft knee), averaging 4 texels as it halves the size.
const BRIGHT = `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThresh; varying vec2 vUv;
vec3 keep(vec2 uv){ vec3 c = texture2D(tSrc, uv).rgb; return c * smoothstep(uThresh, 1.0, max(c.r, max(c.g, c.b))); }
void main(){ vec2 o = uTexel * 0.5;
  gl_FragColor = vec4((keep(vUv + vec2(-o.x, -o.y)) + keep(vUv + vec2(o.x, -o.y)) + keep(vUv + vec2(-o.x, o.y)) + keep(vUv + o)) * 0.25, 1.0); }`;
// 9-tap Gaussian along uDir (in texels of the source).
const BLUR = `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main(){ vec3 s = texture2D(tSrc, vUv).rgb * 0.2270;
  s += (texture2D(tSrc, vUv + uDir * 1.385).rgb + texture2D(tSrc, vUv - uDir * 1.385).rgb) * 0.3162;
  s += (texture2D(tSrc, vUv + uDir * 3.231).rgb + texture2D(tSrc, vUv - uDir * 3.231).rgb) * 0.0703;
  gl_FragColor = vec4(s, 1.0); }`;
const ADD = `uniform sampler2D tA; uniform sampler2D tB; uniform float uStrength; varying vec2 vUv;
void main(){ gl_FragColor = vec4((texture2D(tA, vUv).rgb + texture2D(tB, vUv).rgb) * uStrength, 1.0); }`;

const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, extra: Partial<THREE.ShaderMaterial> = {}) =>
  Object.assign(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false }), extra);
const bright = mat(BRIGHT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: 0.8 } });
const blur = mat(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
const add = mat(ADD, { tA: { value: null }, tB: { value: null }, uStrength: { value: 0.35 } },
  { blending: THREE.AdditiveBlending, transparent: true });
const quad = new FullScreenQuad();

const rt = (): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
let frame: THREE.FramebufferTexture | null = null;
const half = rt(), q1 = rt(), q2 = rt(), e1 = rt(), e2 = rt();
const size = new THREE.Vector2();

function pass(m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, renderer: THREE.WebGLRenderer) {
  quad.material = m;
  renderer.setRenderTarget(target);
  quad.render(renderer);
}
function blurInto(src: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, renderer: THREE.WebGLRenderer) {
  blur.uniforms.tSrc.value = src.texture; blur.uniforms.uDir.value.set(1 / src.width, 0);
  pass(blur, tmp, renderer);
  blur.uniforms.tSrc.value = tmp.texture; blur.uniforms.uDir.value.set(0, 1 / tmp.height);
  pass(blur, dst, renderer);
}

/** Add the glow to what is on the canvas now (call right after drawing the frame to it). */
export function applyBloom(renderer: THREE.WebGLRenderer) {
  renderer.getDrawingBufferSize(size);
  const w = Math.max(8, size.x), h = Math.max(8, size.y);
  if (!frame || frame.image.width !== w || frame.image.height !== h) {
    frame?.dispose();
    frame = new THREE.FramebufferTexture(w, h);
    half.setSize(w >> 1, h >> 1); q1.setSize(w >> 2, h >> 2); q2.setSize(w >> 2, h >> 2);
    e1.setSize(w >> 3, h >> 3); e2.setSize(w >> 3, h >> 3);
  }
  renderer.setRenderTarget(null);
  renderer.copyFramebufferToTexture(frame);
  bright.uniforms.tSrc.value = frame; bright.uniforms.uTexel.value.set(1 / w, 1 / h);
  bright.uniforms.uThresh.value = bloomTuning.threshold;
  pass(bright, half, renderer);
  blurInto(half, q1, q2, renderer);   // quarter resolution
  blurInto(q2, e1, e2, renderer);     // eighth: the wide part of the glow
  add.uniforms.tA.value = q2.texture; add.uniforms.tB.value = e2.texture;
  add.uniforms.uStrength.value = bloomTuning.strength;
  pass(add, null, renderer);
}
