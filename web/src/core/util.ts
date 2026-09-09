// Small helpers shared everywhere.

export const params = new URLSearchParams(location.search);

export function $<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

/** Smoothstep from a to b (a may be greater than b, which reverses it). */
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Signed difference a - b between two compass angles, in degrees (-180 to 180). */
export const angDiff = (a: number, b: number) => ((a - b) % 360 + 540) % 360 - 180;

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
