/* Toolbar button, brush panel and cursor readout for the powder grid. */
import type * as THREE from 'three';
import './powder.css';
import { ELEMENTS, ID, TYP, PT } from './elements';
import { BEHAVIORS } from './behaviors';
import { COMM, type Player } from './behaviors/stickman';
import { PowderLayer, type PowderView } from './layer';
import { GOL_BRUSH, type PowderWorld } from './world';
import { BUILTIN_GOL } from './gol';

const SECTIONS = ['Walls', 'Electronics', 'Powered', 'Sensors', 'Force', 'Explosives', 'Gases', 'Liquids', 'Powders', 'Solids', 'Radioactive', 'Special', 'Life', 'Tools', 'Favorites', 'Decoration'];

export interface PowderUIOptions {
  viewport: HTMLElement; toolbar: HTMLElement; world: PowderWorld; scene: THREE.Scene;
  cameraCenter: () => { x: number; y: number }; toast: (message: string) => void; onActivate?: () => void;
}

export class PowderUI {
  active = false;
  layer: PowderLayer | null = null;
  tool: 'draw' | 'erase' | 'wall' | 'unwall' = 'draw';
  element: number = PT.SAND;
  radius = 3;
  private last: { x: number; y: number } | null = null;
  private placed = false;
  private panel: HTMLElement;
  private button: HTMLButtonElement;
  private readout: HTMLElement;
  private status: HTMLElement;
  private ticks = 0;

  constructor(private o: PowderUIOptions) {
    this.button = document.createElement('button');
    this.button.id = 'powder-tool'; this.button.dataset.icon = '▒'; this.button.title = 'Powder, fluids and chemistry (P)'; this.button.textContent = '▒ Powder';
    o.toolbar.append(this.button);
    this.panel = document.createElement('aside');
    this.panel.id = 'powder-panel'; this.panel.className = 'connection-panel powder-panel'; this.panel.hidden = true;
    const groups = new Map<number, string>();
    for (const e of ELEMENTS) {
      if (!e.Enabled || !e.MenuVisible || e.id === 0) continue;
      const ported = !!BEHAVIORS[e.key]?.update || !e.hasUpdate;
      groups.set(e.MenuSection, (groups.get(e.MenuSection) ?? '') + `<option value="${e.id}" title="${e.description.replace(/"/g, '&quot;')}">${e.name}${ported ? '' : ' ◦'}</option>`);
    }
    groups.set(12, (groups.get(12) ?? '') + BUILTIN_GOL.map((g, n) => `<option value="${GOL_BRUSH + n}" title="${g.description}">${g.name}</option>`).join(''));
    const options = [...groups].sort((a, b) => a[0] - b[0]).map(([s, html]) => `<optgroup label="${SECTIONS[s] ?? 'Other'}">${html}</optgroup>`).join('');
    this.panel.innerHTML = `<span class="eyebrow">POWDER &amp; CHEMISTRY</span>
<label for="powder-tool-mode">Tool</label><select id="powder-tool-mode"><option value="draw">Draw material</option><option value="erase">Erase particles</option><option value="wall">Draw wall</option><option value="unwall">Erase wall</option></select>
<label for="powder-element">Material</label><select id="powder-element">${options}</select>
<label for="powder-radius">Brush <b id="powder-radius-value"></b> px</label><input id="powder-radius" type="range" min="1" max="14" value="3">
<label for="powder-view">Overlay</label><select id="powder-view"><option value="particles">Particles</option><option value="pressure">Pressure</option><option value="heat">Ambient heat</option><option value="velocity">Air velocity</option></select>
<label class="connection-breakable"><input type="checkbox" id="powder-run" checked> Run simulation</label>
<label class="connection-breakable" title="Gravity sources (NBHL, NWHL, GBMB, GRVT, GPMP) pull on particles. Off by default, as in the original."><input type="checkbox" id="powder-newton"> Newtonian gravity</label>
<button id="powder-zone">Move grid to view</button><button id="powder-clear">Clear powder</button>
<span id="powder-readout">Hover the grid to inspect.</span><small id="powder-status"></small><small>◦ = static properties only (state changes, flammability, heat); this material's special reaction code is not ported yet.</small>`;
    o.viewport.append(this.panel);
    this.readout = this.panel.querySelector('#powder-readout')!;
    this.status = this.panel.querySelector('#powder-status')!;
    const $ = <T extends HTMLElement>(s: string) => this.panel.querySelector<T>(s)!;
    $<HTMLSelectElement>('#powder-element').value = String(this.element);
    $('#powder-radius-value').textContent = String(this.radius);
    $<HTMLSelectElement>('#powder-tool-mode').onchange = e => { this.tool = (e.target as HTMLSelectElement).value as PowderUI['tool']; };
    $<HTMLSelectElement>('#powder-element').onchange = e => { this.element = Number((e.target as HTMLSelectElement).value); this.tool = 'draw'; $<HTMLSelectElement>('#powder-tool-mode').value = 'draw'; };
    $<HTMLInputElement>('#powder-radius').oninput = e => { this.radius = Number((e.target as HTMLInputElement).value); $('#powder-radius-value').textContent = String(this.radius); };
    $<HTMLSelectElement>('#powder-view').onchange = e => { if (this.layer) this.layer.view = (e.target as HTMLSelectElement).value as PowderView; };
    $<HTMLInputElement>('#powder-run').onchange = e => { o.world.enabled = (e.target as HTMLInputElement).checked; };
    $<HTMLInputElement>('#powder-newton').onchange = e => { const n = o.world.sim.newton; n.enabled = (e.target as HTMLInputElement).checked; n.forceRecalc = true; };
    $<HTMLButtonElement>('#powder-zone').onclick = () => this.placeAtView();
    $<HTMLButtonElement>('#powder-clear').onclick = () => { o.world.clear(); this.layer?.update(true); o.toast('Powder grid cleared'); };
    this.button.onclick = () => this.setActive(!this.active);
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || (document.querySelector('dialog[open]'))) return;
      if (e.key.toLowerCase() === 'p' && !e.repeat) this.setActive(!this.active);
      if (this.stickKey(e, true)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { if (this.stickKey(e, false)) e.preventDefault(); });
  }

  /** Arrow keys drive STKM and W/A/S/D drive STKM2 (GameController::KeyPress). Only taken while that stickman exists and the grid runs. */
  private stickKey(e: KeyboardEvent, down: boolean): boolean {
    if (!this.o.world.enabled || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return false;
    const sim = this.o.world.sim;
    const maps: [Player, Record<string, number>, number][] = [
      [sim.player, { ArrowLeft: COMM.LEFT, ArrowRight: COMM.RIGHT, ArrowUp: COMM.JUMP, ArrowDown: COMM.USE }, sim.elementCount[PT.STKM]],
      [sim.player2, { KeyA: COMM.LEFT, KeyD: COMM.RIGHT, KeyW: COMM.JUMP, KeyS: COMM.USE }, sim.elementCount[PT.STKM2]],
    ];
    for (const [player, keys, present] of maps) {
      const bit = keys[e.code];
      if (!bit || (!present && down)) continue;
      if (e.repeat && down) return true;
      if (down) player.press(bit); else player.release(bit);
      return !!present;
    }
    return false;
  }

  private ensureLayer(): PowderLayer {
    if (!this.layer) this.layer = new PowderLayer(this.o.world, this.o.scene);
    return this.layer;
  }
  /** Centre the grid horizontally on the camera and sit its floor border just under the ground plane. */
  placeAtView(): void {
    const c = this.o.cameraCenter(), w = this.o.world;
    w.moveTo(c.x - w.width / 2, -4 * w.pixel);
    this.placed = true; this.layer?.place();
    this.o.toast('Powder grid placed at the current view');
  }
  setActive(on: boolean): void {
    if (on === this.active) return;
    if (on) this.o.onActivate?.();
    this.active = on;
    this.button.classList.toggle('active', on); this.panel.hidden = !on;
    this.o.viewport.classList.toggle('powder-drawing', on);
    if (on) {
      if (!this.placed && !this.o.world.enabled) this.placeAtView();
      this.o.world.enabled = this.panel.querySelector<HTMLInputElement>('#powder-run')!.checked;
      this.ensureLayer().mesh.visible = true;
      const hint = document.querySelector('#placement-hint'); if (hint) hint.textContent = 'Drag to paint · P or Esc leaves the powder tool';
    } else this.last = null;
  }
  /** Show a world that was filled from outside the tool (scene import): run it, keep its saved position, draw it. */
  adopt(): void {
    this.placed = true;
    this.o.world.enabled = this.panel.querySelector<HTMLInputElement>('#powder-run')!.checked;
    this.ensureLayer().update(true);
  }
  /** Keep the layer drawn while the grid holds particles even when the tool is closed. */
  frame(): void {
    const w = this.o.world;
    if (!this.layer) return;
    const visible = this.active || w.sim.numParts > 0;
    this.layer.mesh.visible = visible;
    if (visible) this.layer.update();
    if (this.active && ++this.ticks % 20 === 0) this.status.textContent = `${w.sim.numParts.toLocaleString()} particles · ${w.stepMs.toFixed(1)} ms per grid frame`;
  }
  private brush(p: { x: number; y: number }): void {
    const w = this.o.world;
    if (!this.last) this.last = p;
    const what = this.tool === 'draw' ? this.element : this.tool;
    w.stroke(this.last.x, this.last.y, p.x, p.y, what, this.radius);
    this.last = p;
  }
  pointerDown(p: { x: number; y: number }): void {
    this.last = null;
    if (!this.o.world.contains(p.x, p.y)) { this.o.toast('Outside the powder grid — use “Move grid to view”'); return; }
    this.brush(p);
  }
  pointerMove(p: { x: number; y: number }, drawing: boolean): void {
    if (drawing && this.o.world.contains(p.x, p.y)) this.brush(p);
    this.inspect(p);
  }
  pointerUp(): void { this.last = null; }
  private inspect(p: { x: number; y: number }): void {
    const w = this.o.world, s = w.sim;
    if (!w.contains(p.x, p.y)) { this.readout.textContent = 'Outside the grid.'; return; }
    const px = w.worldToPixel(p.x, p.y), r = s.pmap[px.y * s.XRES + px.x] || s.photons[px.y * s.XRES + px.x], c = s.cell(px.x, px.y);
    const air = `air ${(s.hv[c] - 273.15).toFixed(0)} °C · ${s.pv[c].toFixed(2)} pressure`;
    if (!r) { this.readout.textContent = `Empty · ${air}`; return; }
    const i = ID(r), e = ELEMENTS[TYP(r)];
    this.readout.textContent = `${e.name} · ${(s.temp[i] - 273.15).toFixed(0)} °C · life ${s.life[i]} · ${air}`;
  }
  dispose(): void { this.layer?.dispose(); this.panel.remove(); this.button.remove(); }
}
