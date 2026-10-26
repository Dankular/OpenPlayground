/* Three.js presentation of a PowderWorld: one textured quad, one texel per grid pixel.
 * Colours come from the generated element table; fire, plasma, lava and the heat/pressure overlays follow the
 * gradients and formulas in The Powder Toy's Renderer.cpp / FIRE.cpp / PLSM.cpp / LAVA.cpp (GPL-3.0). */
import * as THREE from 'three';
import { ELEMENTS, PROP_HOT_GLOW, PT } from './elements';
import type { PowderWorld } from './world';

type Stop = [number, number];
function gradient(stops: [number, number, number, number][], size: number): Uint8Array {
  const out = new Uint8Array(size * 3);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let a = stops[0], b = stops[stops.length - 1];
    for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) { a = stops[k - 1]; b = stops[k]; break; }
    const f = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
  }
  return out;
}
const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const stops = (list: [number, number][]) => list.map(([t, hex]) => [t, ...rgb(hex)] as [number, number, number, number]);
// Renderer::PopulateTables
const FLAME = gradient(stops([[0, 0x000000], [0.5, 0x60300f], [0.9, 0xdfbf6f], [1, 0xaf9f0f]] as Stop[]), 200);
const PLASMA = gradient(stops([[0, 0x000000], [0.25, 0x301040], [0.5, 0x301060], [0.9, 0xafffff], [1, 0xafffff]] as Stop[]), 200);
const HEAT = gradient(stops([[0, 0x2b00ff], [0.01, 0x003cff], [0.05, 0x00c0ff], [0.08, 0x00ffeb], [0.19, 0x00ff14], [0.25, 0x4bff00],
  [0.37, 0xc8ff00], [0.45, 0xffdc00], [0.71, 0xff0000], [1, 0xff00dc]] as Stop[]), 1024);

export type PowderView = 'particles' | 'pressure' | 'heat' | 'velocity';

export class PowderLayer {
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.DataTexture;
  private data: Uint8Array;
  view: PowderView = 'particles';
  showWalls = true;
  private base: Uint8Array;

  constructor(readonly world: PowderWorld, readonly scene: THREE.Scene) {
    const { XRES, YRES } = world.sim;
    this.data = new Uint8Array(XRES * YRES * 4);
    this.base = new Uint8Array(ELEMENTS.length * 3);
    for (const e of ELEMENTS) this.base.set(rgb(e.colour), e.id * 3);
    this.texture = new THREE.DataTexture(this.data, XRES, YRES, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter; this.texture.minFilter = THREE.NearestFilter;
    this.texture.flipY = true; this.texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.name = 'Powder grid'; this.mesh.frustumCulled = false; this.mesh.renderOrder = -50;
    this.mesh.position.z = -1;
    scene.add(this.mesh);
    this.place();
  }

  /** Sync the quad with the world's current origin and pixel size. */
  place(): void {
    const w = this.world;
    this.mesh.scale.set(w.width, w.height, 1);
    this.mesh.position.set(w.origin.x + w.width / 2, w.origin.y + w.height / 2, -1);
  }

  /** Colour of one particle (r, g, b) written into `out`. */
  color(i: number, out: number[]): void {
    const s = this.world.sim, t = s.type[i], e = ELEMENTS[t];
    let r = this.base[t * 3], g = this.base[t * 3 + 1], b = this.base[t * 3 + 2];
    const life = s.life[i];
    if (t === PT.FIRE || t === PT.CFLM) { const k = Math.min(199, Math.max(0, life)) * 3; r = FLAME[k]; g = FLAME[k + 1]; b = FLAME[k + 2]; if (t === PT.CFLM) { r = Math.min(255, r * 0.4); g = Math.min(255, g * 0.8 + 60); b = Math.min(255, b + 150); } }
    else if (t === PT.PLSM) { const k = Math.min(199, Math.max(0, life)) * 3; r = PLASMA[k]; g = PLASMA[k + 1]; b = PLASMA[k + 2]; }
    else if (t === PT.LAVA) { r = Math.min(255, life * 2 + 0xe0); g = Math.min(192, life + 0x50); b = Math.min(128, (life >> 1) + 0x10); }
    else if (t === PT.EMBR || t === PT.SPRK) { r = 255; g = t === PT.SPRK ? 255 : 160; b = t === PT.SPRK ? 128 : 60; }
    else if (e.Properties & PROP_HOT_GLOW) {
      const heat = Math.max(0, Math.min(1, (s.temp[i] - 673) / 900));
      r += (255 - r) * heat; g += (110 - g) * heat * 0.6; b += (40 - b) * heat * 0.6;
    } else if (t === PT.WATR || t === PT.DSTW || t === PT.SLTW) {
      const k = Math.min(1, Math.max(0, (s.temp[i] - 273) / 100)); r += k * 40; g += k * 40;
    }
    out[0] = r; out[1] = g; out[2] = b;
  }

  private drawn = { frame: -1, revision: -1, view: '' as PowderView | '' };
  /** Redraw the texture if the grid stepped or was edited since the last call (or `force`). */
  update(force = false): void {
    const w = this.world;
    if (!force && this.drawn.frame === w.sim.frameCount && this.drawn.revision === w.revision && this.drawn.view === this.view) { this.place(); return; }
    this.drawn = { frame: w.sim.frameCount, revision: w.revision, view: this.view };
    const s = w.sim, XRES = s.XRES, YRES = s.YRES, d = this.data, c = [0, 0, 0];
    d.fill(0);
    if (this.view !== 'particles') {
      for (let y = 0; y < YRES; y++) for (let x = 0; x < XRES; x++) {
        const cell = (y / 4 | 0) * s.XCELLS + (x / 4 | 0), o = (y * XRES + x) * 4;
        if (this.view === 'heat') { const t = Math.min(1, Math.max(0, (s.hv[cell] - 0) / 9999)); const k = Math.min(1023, Math.round(Math.pow(t, 0.5) * 1023)) * 3; d[o] = HEAT[k]; d[o + 1] = HEAT[k + 1]; d[o + 2] = HEAT[k + 2]; d[o + 3] = 170; }
        else if (this.view === 'pressure') { const p = s.pv[cell]; const m = Math.min(1, Math.abs(p) / 16); d[o] = p > 0 ? 255 * m : 20; d[o + 1] = 20; d[o + 2] = p < 0 ? 255 * m : 20; d[o + 3] = Math.round(30 + 190 * m); }
        else { const v = Math.hypot(s.avx[cell], s.avy[cell]); const m = Math.min(1, v / 8); d[o] = 255 * m; d[o + 1] = 200 * m; d[o + 2] = 80; d[o + 3] = Math.round(20 + 200 * m); }
      }
    }
    if (this.showWalls) for (let y = 0; y < YRES; y++) for (let x = 0; x < XRES; x++) {
      if (s.bmap[(y / 4 | 0) * s.XCELLS + (x / 4 | 0)]) { const o = (y * XRES + x) * 4; d[o] = 120; d[o + 1] = 128; d[o + 2] = 140; d[o + 3] = 255; }
    }
    for (let i = 0; i < s.active; i++) {
      if (!s.type[i]) continue;
      const x = (s.x[i] + 0.5) | 0, y = (s.y[i] + 0.5) | 0;
      if (x < 0 || y < 0 || x >= XRES || y >= YRES) continue;
      this.color(i, c);
      const o = (y * XRES + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    this.texture.needsUpdate = true;
    this.place();
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.texture.dispose();
  }
}
