// DOM writes only when the value changes (writing every frame forces style and layout work).
import { $ } from '../core/util';

const cache = new Map<string, string>();
export function setText(sel: string, s: string) { setAttr(sel, null, s); }
export function setAttr(sel: string, attr: string | null, s: string) {
  const key = sel + (attr || '');
  if (cache.get(key) === s) return;
  cache.set(key, s);
  if (attr) $(sel).setAttribute(attr, s); else $(sel).textContent = s;
}
