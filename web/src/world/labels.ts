// Place names over the 3D view (positions from pilot_height.json).
import * as THREE from 'three';
import { sail } from '../boat/sailing';
import { camera, stage } from '../core/renderer';
import { state } from '../core/state';
import { $, smooth } from '../core/util';
import type { Label } from './data';

interface Placed { el: HTMLDivElement; pos: THREE.Vector3; max: number; op?: string; tf?: string }
let LABELS: Placed[] = [];
export const labelState = { on: true };

export function makeLabels(list: Label[]) {
  LABELS = list.map(({ name, kind, x, y, z, max }) => {
    const el = document.createElement('div');
    el.className = 'lbl ' + kind; el.textContent = name;
    $('#labels').appendChild(el);
    return { el, pos: new THREE.Vector3(x, y, z), max };
  });
}

// In Sail mode a place's name fades out as the boat arrives: gone within NEAR_BOAT[0] metres of
// the label's spot, full again beyond NEAR_BOAT[1].
const NEAR_BOAT = [800, 1600];
const _v = new THREE.Vector3();
export function updateLabels() {
  if (!labelState.on) return;
  const sailing = state.mode === 'sail';
  for (const L of LABELS) {
    const d = L.pos.distanceTo(camera.position);
    _v.copy(L.pos).project(camera);
    const vis = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && d < L.max;
    const atBoat = sailing ? smooth(NEAR_BOAT[0], NEAR_BOAT[1], Math.hypot(L.pos.x - sail.x, L.pos.z - sail.z)) : 1;
    const op = vis ? (smooth(L.max, L.max * 0.6, d) * smooth(150, 600, d) * atBoat).toFixed(2) : '0';
    if (op !== L.op) { L.op = op; L.el.style.opacity = op; }
    if (op === '0') continue;
    const tf = `translate(${((_v.x + 1) / 2 * stage.clientWidth).toFixed(1)}px, ${((1 - _v.y) / 2 * stage.clientHeight).toFixed(1)}px) translate(-50%, -100%)`;
    if (tf !== L.tf) { L.tf = tf; L.el.style.transform = tf; }
  }
}
