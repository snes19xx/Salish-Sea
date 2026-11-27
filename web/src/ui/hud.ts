// Modes (Flyover / Sail), the instrument readings, the motor, and the area's title and notes.
import { chaseView } from '../boat/chase';
import { pointName, sail, wind } from '../boat/sailing';
import { look } from '../core/input';
import { stage } from '../core/renderer';
import { state, view, type Mode } from '../core/state';
import { $, angDiff, compass } from '../core/util';
import { AREA, sampleH, type AreaMeta } from '../world/data';
import { setAttr, setText } from './dom';
import { updateMap } from './map';

const coarse = matchMedia('(pointer: coarse)').matches;

export function setMode(m: Mode) {
  state.mode = m;
  $('#mode-fly').setAttribute('aria-pressed', String(m === 'fly'));
  $('#mode-sail').setAttribute('aria-pressed', String(m === 'sail'));
  $('#inst').hidden = m !== 'sail';
  $('#rudder').hidden = !(m === 'sail' && coarse);
  $('#keys').hidden = m !== 'sail'; // only sailing keys need explaining
  stage.classList.toggle('sailing', m === 'sail');
  look.yaw = 0; look.pitch = 0;
  if (m === 'sail') look.dist = chaseView.dist;
  view.camInit = false;
}
$('#mode-fly').addEventListener('click', () => setMode('fly'));
$('#mode-sail').addEventListener('click', () => setMode('sail'));

// Map links: mark the loaded area, name it on the loading screen, carry the other options along.
for (const a of document.querySelectorAll<HTMLAnchorElement>('#areas a')) {
  const area = a.dataset.area!;
  const q = new URLSearchParams(location.search);
  if (area === 'howe') q.delete('area'); else q.set('area', area);
  a.href = `?${String(q).replace(/=(?=&|$)/g, '')}`; // ?gui, not ?gui=
  if (area === AREA) {
    a.setAttribute('aria-current', 'page');
    $('#loader h2').textContent = a.textContent;
  }
}

export function toggleMotor() {
  sail.motor = !sail.motor;
  $('#rud-m').textContent = sail.motor ? 'Motor on' : 'Motor off';
}
$('#rud-m').addEventListener('click', () => toggleMotor());

/** Heading, speed, wind, depth and point of sail, and the minimap (Sail mode only). */
export function updateInstruments() {
  if (state.mode !== 'sail') return; // the instruments are hidden
  const a = Math.abs(angDiff(sail.hdg, wind.from));
  const hdg = Math.round(sail.hdg) % 360;
  setText('#r-hdg', `${String(hdg).padStart(3, '0')}° ${compass(sail.hdg)}`);
  setText('#r-spd', `${Math.max(0, sail.kn).toFixed(1)} kn`);
  setText('#r-wind', `${wind.kn} kn ${compass(wind.from)}`);
  const dep = -sampleH(sail.x, sail.z);
  setText('#r-dep', dep >= 299 ? '300+ m' : `${Math.max(0, dep).toFixed(0)} m`);
  setText('#r-pos', sail.boost ? 'Boost' : sail.motor ? 'Under power' : pointName(a));
  setAttr('#boatMark', 'transform', `rotate(${hdg})`);
  setAttr('#windArrow', 'transform', `rotate(${wind.from.toFixed(0)})`);
  updateMap();
}

/** The area's title, extent and data notes in the masthead and credits. */
export function showAreaInfo(meta: AreaMeta) {
  $('#b-title').textContent = meta.title;
  const span = (meta.coord.split('·')[1] || '').trim(); // place span after the dot
  if (span) $('#b-sub').textContent = `${span} on real elevation and seafloor data`;
  $('#b-note').textContent = meta.note;
  document.title = `${meta.title}, Sunshine Coast`;
}
