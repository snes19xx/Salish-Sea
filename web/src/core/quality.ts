// Quality presets. Every feature with a cost reads its settings
// from `quality`; switching preset updates it and tells the listeners. High is the pilot's look.
// The default comes from the GPU's name: Intel and other integrated or mobile GPUs get Balanced.
// ?quality=low|balanced|high overrides it, ?aa= the antialiasing.
import { params } from './util';

export type QualityName = 'low' | 'balanced' | 'high';
/**
 * Antialiasing. 'msaa' multisamples the canvas, which can only be set when the page loads: it
 * applies if the page loaded with it, and otherwise falls back to 'smaa'. 'smaa' draws the scene
 * off screen and smooths the edges in a post pass (cheaper on integrated GPUs).
 */
export type AntiAlias = 'none' | 'smaa' | 'msaa';

export interface QualitySettings {
  /** Canvas pixels per CSS pixel. Rendering at full retina resolution costs far more than it shows. */
  renderScale: number;
  aa: AntiAlias;
  /** Reflection target size as a share of the canvas. */
  reflScale: number;
  /** Draw the trees into the water reflection. */
  reflTrees: boolean;
  /** Draw the outer tree ring (650 m to 3.2 km); without it the painted canopy takes over sooner. */
  farTrees: boolean;
  /** Terrain crowns and fine relief. */
  detail: boolean;
}

export const PRESETS: Record<QualityName, QualitySettings> = {
  low: { renderScale: 0.67, aa: 'none', reflScale: 0.25, reflTrees: false, farTrees: false, detail: false },
  balanced: { renderScale: 0.85, aa: 'smaa', reflScale: 0.35, reflTrees: false, farTrees: true, detail: true },
  high: { renderScale: 1.0, aa: 'msaa', reflScale: 0.5, reflTrees: true, farTrees: true, detail: true }
};

/** The GPU's name, from a throwaway WebGL 2 context. */
export function gpuName(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return '';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
}

function defaultPreset(gpu: string): QualityName {
  const asked = params.get('quality');
  if (asked && asked in PRESETS) return asked as QualityName;
  return /apple|nvidia|geforce|quadro|radeon (rx|pro)/i.test(gpu) ? 'high' : 'balanced';
}

export const GPU = gpuName();
export const quality: QualitySettings & { name: QualityName } = { name: 'high', ...PRESETS.high };
setQuality(defaultPreset(GPU), false);
// ?aa=none|smaa|msaa overrides the preset's antialiasing at load (to compare them on one preset).
const askedAA = params.get('aa');
if (askedAA === 'none' || askedAA === 'smaa' || askedAA === 'msaa') quality.aa = askedAA;

const listeners: (() => void)[] = [];
export const onQualityChange = (fn: () => void) => { listeners.push(fn); };

/** Switch preset; applies at once (MSAA only if the page loaded with it, see AntiAlias). */
export function setQuality(name: QualityName, notify = true) {
  Object.assign(quality, PRESETS[name], { name });
  if (notify) applyQuality();
}
/** Tell every listener the settings changed (also after editing one setting by hand). */
export function applyQuality() { for (const fn of listeners) fn(); }
