// The control strip: time of day, weather, tree style and place names.
import { state, type Weather } from '../core/state';
import { $ } from '../core/util';
import { labelState } from '../world/labels';
import { updateSky } from '../world/sky';
import { setTreeStyle } from '../world/trees';

/** Move the time of day, keeping the slider in step (also used by the debug panel). */
export function setHour(hour: number) {
  state.hour = hour;
  $<HTMLInputElement>('#tod').value = String(hour);
  updateSky();
}
export function setWeather(key: Weather) {
  state.weather = key;
  const id = { clear: 'wx-clear', haze: 'wx-haze', over: 'wx-over' }[key];
  document.querySelectorAll('#weather button').forEach(b => b.setAttribute('aria-pressed', String(b.id === id)));
  updateSky();
}

export function wireControls() {
  $<HTMLInputElement>('#tod').addEventListener('input', e => { state.hour = parseFloat((e.target as HTMLInputElement).value); updateSky(); });
  for (const [id, key] of [['#wx-clear', 'clear'], ['#wx-haze', 'haze'], ['#wx-over', 'over']] as const) {
    $(id).addEventListener('click', () => setWeather(key));
  }
  document.querySelectorAll<HTMLElement>('#trees button').forEach(b => b.addEventListener('click', () => setTreeStyle(b.dataset.style || 'off')));
  // Place names on or off.
  document.querySelectorAll<HTMLElement>('#label-toggle button').forEach(b => b.addEventListener('click', () => {
    labelState.on = b.dataset.labels === 'on';
    $('#labels').hidden = !labelState.on;
    document.querySelectorAll('#label-toggle button').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
  }));
}
