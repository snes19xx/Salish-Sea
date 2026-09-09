// Keyboard, mouse and touch input. Keys pressed now, the camera's orbit offset (drag) and zoom
// (wheel), and the touch steering buttons. Actions on key presses (motor, chart) are wired in main.ts.
import { canvas } from './renderer';
import { $ } from './util';

export const keys: Record<string, boolean> = {};
addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  keys[e.key.toLowerCase()] = true;
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

/** Orbit offset from the camera's own direction (yaw, pitch, radians) and the chase distance. */
export const look = { yaw: 0, pitch: 0, dragging: false, lx: 0, ly: 0, dist: 30 };
canvas.addEventListener('pointerdown', e => { look.dragging = true; look.lx = e.clientX; look.ly = e.clientY; canvas.classList.add('dragging'); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!look.dragging) return;
  look.yaw -= (e.clientX - look.lx) * 0.005; look.pitch -= (e.clientY - look.ly) * 0.004;
  look.pitch = Math.max(-0.9, Math.min(0.7, look.pitch)); look.lx = e.clientX; look.ly = e.clientY;
});
const endDrag = () => { look.dragging = false; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', e => { e.preventDefault(); look.dist = Math.max(12, Math.min(160, look.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false });

/** Touch steering buttons (shown in Sail mode on touch screens). */
export const touchSteer = { l: false, r: false, boost: false };
for (const [id, k] of [['#rud-l', 'l'], ['#rud-r', 'r'], ['#rud-b', 'boost']] as const) {
  const b = $(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); touchSteer[k] = true; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { touchSteer[k] = false; });
}
