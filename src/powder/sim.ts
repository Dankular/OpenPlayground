/* Powder-grid particle simulation core.
 *
 * Ported from The Powder Toy's Simulation.cpp / Air.cpp (GPL-3.0,
 * https://github.com/The-Powder-Toy/The-Powder-Toy; see research/POWDER.md for the
 * commit and the list of ported/unported behaviour). Particles live on a 1-pixel grid
 * (pmap); air pressure, velocity and ambient heat live on CELL x CELL blocks.
 * The random generator is NOT the original xoroshiro128+, so seeded runs do not
 * reproduce the original game's sequences.
 */
import {
  CELL, CFDS, ELEMENTS, FLAG_MOVABLE, FLAG_STAGNANT, ID, ISTP, MAX_PRESSURE, MAX_TEMP, MAX_VELOCITY, MIN_PRESSURE, MIN_TEMP,
  NT, PMAP, PT, PT_NUM, R_TEMP, ST, TYP, TYPE_ENERGY, TYPE_GAS, TYPE_LIQUID, TYPE_PART, TYPE_SOLID, WL, buildCanMove,
  PROP_CONDUCTS, PROP_LIFE_DEC, PROP_LIFE_KILL, PROP_LIFE_KILL_DEC, PROP_NEUTABSORB, PROP_NEUTPENETRATE, PROP_NOAMBHEAT,
  type ElementDef,
} from './elements';
import { BEHAVIORS } from './behaviors';
import { filtInteract } from './optics';
import { floodInst } from './behaviors/electronics';

export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) { this.s = seed >>> 0 || 1; }
  seed(seed: number) { this.s = seed >>> 0 || 1; }
  /** mulberry32 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  gen() { return this.next() & 0x7fffffff; }
  between(lo: number, hi: number) { return (this.next() % (hi - lo + 1)) + lo; }
  chance(num: number, den: number) { return num < 0 ? false : this.next() % den < num; }
  uniform01() { return this.next() / 0xffffffff; }
}

export const REFRACT = 0x80000000 | 0;
const GLASS_IOR = 1.9, GLASS_DISP = 0.07;
const SURF_RANGE = 10, NORMAL_MIN_EST = 3, NORMAL_INTERP = 20, NORMAL_FRAC = 16;

export type UpdateFn = (sim: PowderSim, i: number, x: number, y: number, surroundSpace: number, nt: number) => boolean | void;
export interface Behavior {
  update?: UpdateFn;
  create?: (sim: PowderSim, i: number, x: number, y: number, t: number, v: number) => void;
  createAllowed?: (sim: PowderSim, i: number, x: number, y: number, t: number) => boolean;
  changeType?: (sim: PowderSim, i: number, x: number, y: number, from: number, to: number) => void;
}

export const GRAV = { VERTICAL: 0, OFF: 1, RADIAL: 2, CUSTOM: 3 } as const;
export const AIR = { ON: 0, PRESSUREOFF: 1, VELOCITYOFF: 2, OFF: 3, NOUPDATE: 4 } as const;
const AIR_TSTEPP = 0.3, AIR_TSTEPV = 0.4, AIR_VADV = 0.3, AIR_VLOSS = 0.999, AIR_PLOSS = 0.9999, ADV_DIST = 0.7;
const clampf = (v: number, lo: number, hi: number) => v < lo ? lo : v > hi ? hi : v;
export const restrictTemp = (v: number) => clampf(v, MIN_TEMP, MAX_TEMP);

export interface PowderOptions { cellsX?: number; cellsY?: number; seed?: number; ambientHeat?: boolean; ambientTemp?: number }

export class PowderSim {
  readonly XCELLS: number; readonly YCELLS: number; readonly XRES: number; readonly YRES: number; readonly NPART: number;
  readonly rng: Rng;
  readonly E: ElementDef[] = ELEMENTS;
  readonly canMove = buildCanMove();
  readonly behaviors: (Behavior | undefined)[] = new Array(PT_NUM);

  // particle store (structure of arrays)
  type: Int32Array; life: Int32Array; ctype: Int32Array; tmp: Int32Array; tmp2: Int32Array; tmp3: Int32Array; tmp4: Int32Array; flags: Int32Array;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; temp: Float32Array;
  nextFree: Int32Array; active = 0; pfree = -1; numParts = 0;

  pmap: Int32Array; photons: Int32Array; pmapCount: Int32Array;
  /** Optional per-pixel mask of external solids (rigid bodies). Non-energy particles cannot move into marked pixels. */
  solid: Uint8Array | null = null;
  bmap: Uint8Array; emap: Uint8Array; blockAir: Uint8Array; blockAirH: Uint8Array;
  // air, per CELL block
  avx: Float32Array; avy: Float32Array; pv: Float32Array; hv: Float32Array; fvx: Float32Array; fvy: Float32Array;
  private ovx: Float32Array; private ovy: Float32Array; private opv: Float32Array; private ohv: Float32Array;
  private kernel = new Float32Array(9);

  airMode: number = AIR.ON; ambientAirTemp: number; edgePressure = 0; edgeVelocityX = 0; edgeVelocityY = 0;
  vorticityCoeff = 0.1; convection: 'off' | 'legacy' | 'boussinesq' = 'boussinesq';
  aheatEnable: boolean; legacyEnable = false; waterEqualTest = false;
  gravityMode: number = GRAV.VERTICAL; customGravityX = 0; customGravityY = 0;
  frameCount = 0; currentTick = 0; forceStackingCheck = false;
  elementCount = new Int32Array(PT_NUM); elementRecount = true;
  /** wireless channels used by WIFI-like elements */
  wireless = new Int32Array(2 * 101);

  // scratch neighbourhood for the particle currently being updated
  surround = new Int32Array(8); surroundSpace = 0; nt = 0; pGravX = 0; pGravY = 0;
  private plan = { finX: 0, finY: 0, clearX: 0, clearY: 0, finXf: 0, finYf: 0, clearXf: 0, clearYf: 0, vx: 0, vy: 0 };

  constructor(o: PowderOptions = {}) {
    this.XCELLS = o.cellsX ?? 153; this.YCELLS = o.cellsY ?? 96;
    this.XRES = this.XCELLS * CELL; this.YRES = this.YCELLS * CELL; this.NPART = this.XRES * this.YRES;
    const n = this.NPART, nc = this.XCELLS * this.YCELLS;
    this.rng = new Rng(o.seed);
    this.type = new Int32Array(n); this.life = new Int32Array(n); this.ctype = new Int32Array(n);
    this.tmp = new Int32Array(n); this.tmp2 = new Int32Array(n); this.tmp3 = new Int32Array(n); this.tmp4 = new Int32Array(n); this.flags = new Int32Array(n);
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.temp = new Float32Array(n);
    this.nextFree = new Int32Array(n);
    this.pmap = new Int32Array(n); this.photons = new Int32Array(n); this.pmapCount = new Int32Array(n);
    this.bmap = new Uint8Array(nc); this.emap = new Uint8Array(nc); this.blockAir = new Uint8Array(nc); this.blockAirH = new Uint8Array(nc);
    this.avx = new Float32Array(nc); this.avy = new Float32Array(nc); this.pv = new Float32Array(nc); this.hv = new Float32Array(nc);
    this.fvx = new Float32Array(nc); this.fvy = new Float32Array(nc);
    this.ovx = new Float32Array(nc); this.ovy = new Float32Array(nc); this.opv = new Float32Array(nc); this.ohv = new Float32Array(nc);
    this.ambientAirTemp = o.ambientTemp ?? R_TEMP + 273.15; this.aheatEnable = o.ambientHeat ?? false;
    this.hv.fill(this.ambientAirTemp);
    let s = 0;
    for (let j = -1; j < 2; j++) for (let i = -1; i < 2; i++) { const v = Math.exp(-2 * (i * i + j * j)); this.kernel[i + 1 + 3 * (j + 1)] = v; s += v; }
    for (let k = 0; k < 9; k++) this.kernel[k] /= s;
    for (const [key, b] of Object.entries(BEHAVIORS)) if (PT[key] !== undefined) this.behaviors[PT[key]] = b;
  }

  // ---- indexing ---------------------------------------------------------------------------------------------------
  cell(x: number, y: number) { return ((y / CELL) | 0) * this.XCELLS + ((x / CELL) | 0); }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.XRES && y < this.YRES; }
  at(x: number, y: number) { return this.pmap[y * this.XRES + x]; }
  /** Particle type at (x, y), 0 if empty. */
  typeAt(x: number, y: number) { return this.inBounds(x, y) ? TYP(this.pmap[y * this.XRES + x]) : 0; }
  setWall(cx: number, cy: number, w: number) { this.bmap[cy * this.XCELLS + cx] = w; }

  // ---- particle lifecycle ---------------------------------------------------------------------------------------------
  private allocPart(): number {
    if (this.pfree !== -1) { const i = this.pfree; this.pfree = this.nextFree[i]; return i; }
    if (this.active < this.NPART) return this.active++;
    return -1;
  }

  killPart(i: number): void {
    if (i < 0 || i >= this.NPART) return;
    const x = (this.x[i] + 0.5) | 0, y = (this.y[i] + 0.5) | 0, t = this.type[i];
    if (t) this.behaviors[t]?.changeType?.(this, i, x, y, t, 0);
    if (this.inBounds(x, y)) {
      const k = y * this.XRES + x;
      if (this.pmap[k] && ID(this.pmap[k]) === i) this.pmap[k] = 0;
      else if (this.photons[k] && ID(this.photons[k]) === i) this.photons[k] = 0;
    }
    if (t === 0) return;
    this.elementCount[t]--;
    this.type[i] = 0; this.nextFree[i] = this.pfree; this.pfree = i;
    this.numParts--;
  }

  /** Returns true if the particle was killed instead. */
  changeType(i: number, x: number, y: number, t: number): boolean {
    if (x < 0 || y < 0 || x >= this.XRES || y >= this.YRES || i >= this.NPART || t < 0 || t >= PT_NUM || !this.type[i]) return false;
    const e = this.E[t];
    if (!e || !e.Enabled || t === 0) { this.killPart(i); return true; }
    const b = this.behaviors[t];
    if (b?.createAllowed && !b.createAllowed(this, i, x, y, t)) return false;
    const from = this.type[i];
    this.behaviors[from]?.changeType?.(this, i, x, y, from, t);
    b?.changeType?.(this, i, x, y, from, t);
    if (from > 0 && from < PT_NUM && this.elementCount[from]) this.elementCount[from]--;
    this.elementCount[t]++;
    this.type[i] = t;
    const k = y * this.XRES + x;
    if (e.Properties & TYPE_ENERGY) { this.photons[k] = PMAP(i, t); if (this.pmap[k] && ID(this.pmap[k]) === i) this.pmap[k] = 0; }
    else { this.pmap[k] = PMAP(i, t); if (this.photons[k] && ID(this.photons[k]) === i) this.photons[k] = 0; }
    return false;
  }

  /** p = -1: new particle; -2: from a brush; -3: skip pmap checks; otherwise replace particle p. Returns index or -1. */
  createPart(p: number, x: number, y: number, t: number, v = -1): number {
    const E = this.E;
    if (x < 0 || y < 0 || x >= this.XRES || y >= this.YRES || t <= 0 || t >= PT_NUM || !E[t]?.Enabled) return -1;
    const k = y * this.XRES + x;
    if (t === PT.SPRK && p !== -3) {
      const type = TYP(this.pmap[k]), index = ID(this.pmap[k]);
      if (type === PT.WIRE) { this.ctype[index] = PT.DUST; return index; }
      if (!(type === PT.INST || (E[type].Properties & PROP_CONDUCTS)) || this.life[index] !== 0) return -1;
      if (p === -2 && type === PT.INST) { floodInst(this, x, y); return index; }
      this.type[index] = PT.SPRK; this.life[index] = 4; this.ctype[index] = type;
      this.pmap[k] = (this.pmap[k] & ~0x1ff) | PT.SPRK;
      if (this.temp[index] + 10 < 673 && !this.legacyEnable && [PT.METL, PT.BMTL, PT.BRMT, PT.PSCN, PT.NSCN, PT.ETRD, PT.NBLE, PT.IRON].includes(type)) this.temp[index] += 10;
      return index;
    }
    if (p === -2) {
      if (this.pmap[k]) return -1;
      if (this.isWallBlocking(x, y, t)) return -1;
      if (this.photons[k] && (E[t].Properties & TYPE_ENERGY)) return -1;
    }
    const b = this.behaviors[t];
    if (b?.createAllowed && !b.createAllowed(this, p, x, y, t)) return -1;
    let i: number, oldType = 0;
    if (p === -1 || p === -2 || p === -3) {
      if (p === -1) {
        if (this.pmap[k] ? this.evalMove(t, x, y) !== 2 : (this.bmap[this.cell(x, y)] && this.evalMove(t, x, y) === 0)) return -1;
      }
      i = this.allocPart();
      if (i === -1) return -1;
      this.numParts++;
    } else {
      const ox = (this.x[p] + 0.5) | 0, oy = (this.y[p] + 0.5) | 0;
      if (this.inBounds(ox, oy)) {
        const ok = oy * this.XRES + ox;
        if (this.pmap[ok] && ID(this.pmap[ok]) === p) this.pmap[ok] = 0;
        if (this.photons[ok] && ID(this.photons[ok]) === p) this.photons[ok] = 0;
      }
      oldType = this.type[p];
      this.behaviors[oldType]?.changeType?.(this, p, ox, oy, oldType, t);
      if (oldType) this.elementCount[oldType]--;
      i = p;
    }
    const d = E[t].default;
    this.type[i] = t; this.life[i] = d.life ?? 0; this.ctype[i] = d.ctype ?? 0; this.tmp[i] = d.tmp ?? 0; this.tmp2[i] = d.tmp2 ?? 0;
    this.tmp3[i] = 0; this.tmp4[i] = d.tmp4 ?? 0; this.flags[i] = 0; this.x[i] = x; this.y[i] = y; this.vx[i] = d.vx ?? 0; this.vy[i] = 0; this.temp[i] = d.temp;
    if (E[t].Properties & TYPE_ENERGY) this.photons[k] = PMAP(i, t);
    else if (t !== PT.STKM && t !== PT.STKM2 && t !== PT.FIGH) this.pmap[k] = PMAP(i, t);
    b?.create?.(this, i, x, y, t, v);
    b?.changeType?.(this, i, x, y, oldType, t);
    this.elementCount[t]++;
    return i;
  }

  /** Change part type but keep temperature and velocity. */
  createPartTempVel(i: number, x: number, y: number, t: number): number {
    const temp = this.temp[i], vx = this.vx[i], vy = this.vy[i];
    const np = this.createPart(i, x, y, t);
    if (np >= 0) { this.temp[np] = temp; this.vx[np] = vx; this.vy[np] = vy; }
    return np;
  }

  deletePart(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    const k = y * this.XRES + x, r = this.photons[k] ? this.photons[k] : this.pmap[k];
    if (r) this.killPart(ID(r));
  }

  clear(): void {
    this.type.fill(0); this.pmap.fill(0); this.photons.fill(0); this.pmapCount.fill(0);
    this.active = 0; this.pfree = -1; this.numParts = 0; this.elementCount.fill(0);
    this.bmap.fill(0); this.emap.fill(0);
    this.avx.fill(0); this.avy.fill(0); this.pv.fill(0); this.hv.fill(this.ambientAirTemp);
  }

  // ---- gravity --------------------------------------------------------------------------------------------------------
  /** Gravity vector at (x, y) for a particle with the given Gravity property; result in this.gfx / this.gfy (no allocation). */
  gfx = 0; gfy = 0;
  gravityXY(x: number, y: number, particleGrav: number): void {
    switch (this.gravityMode) {
      case GRAV.OFF: this.gfx = 0; this.gfy = 0; return;
      case GRAV.RADIAL: {
        const dx = x - (this.XRES >> 1), dy = y - (this.YRES >> 1);
        if (!dx && !dy) { this.gfx = 0; this.gfy = 0; return; }
        const d = 0.01 - Math.hypot(dx, dy);
        this.gfx = particleGrav * (dx / d); this.gfy = particleGrav * (dy / d); return;
      }
      case GRAV.CUSTOM: this.gfx = particleGrav * this.customGravityX; this.gfy = particleGrav * this.customGravityY; return;
      default: this.gfx = 0; this.gfy = particleGrav;
    }
  }
  gravityField(x: number, y: number, particleGrav: number): [number, number] {
    this.gravityXY(x, y, particleGrav);
    return [this.gfx, this.gfy];
  }

  // ---- movement evaluation --------------------------------------------------------------------------------------------
  isWallBlocking(x: number, y: number, type: number): boolean {
    const c = this.cell(x, y), wall = this.bmap[c];
    if (!wall) return false;
    const p = this.E[type].Properties;
    if (wall === WL.ALLOWGAS && !(p & TYPE_GAS)) return true;
    if (wall === WL.ALLOWENERGY && !(p & TYPE_ENERGY)) return true;
    if (wall === WL.ALLOWLIQUID && !(p & TYPE_LIQUID)) return true;
    if (wall === WL.ALLOWPOWDER && !(p & TYPE_PART)) return true;
    if (wall === WL.ALLOWAIR || wall === WL.WALL || wall === WL.WALLELEC) return true;
    if (wall === WL.EWALL && !this.emap[c]) return true;
    if (wall === WL.DETECT && (p & TYPE_SOLID)) return true;
    return false;
  }

  /** 1 = swap, 0 = no move/bounce, 2 = share the space. `lastR` receives the occupant. */
  lastR = 0;
  evalMove(pt: number, nx: number, ny: number): number {
    if (nx < 0 || ny < 0 || nx >= this.XRES || ny >= this.YRES) return 0;
    let r = this.pmap[ny * this.XRES + nx];
    if (r) r = (r & ~0x1ff) | this.type[ID(r)];
    this.lastR = r;
    const rt = TYP(r);
    if (pt >= PT_NUM || rt >= PT_NUM) return 0;
    let result = this.canMove[pt * PT_NUM + rt];
    if (result === 3) {
      const rid = ID(r);
      switch (rt) {
        case PT.LCRY: if (pt === PT.PHOT) result = this.life[rid] > 5 ? 2 : 0; break;
        case PT.GPMP: if (pt === PT.PHOT) result = this.life[rid] < 10 ? 2 : 0; break;
        case PT.INVIS: {
          const res = this.tmp[rid] > 0 ? this.tmp[rid] : 4, p = this.pv[this.cell(nx, ny)];
          result = p < -res || p > res ? 2 : 0; break;
        }
        case PT.PVOD:
          if (this.life[rid] === 10) result = (!this.ctype[rid] || (this.ctype[rid] === pt) !== ((this.tmp[rid] & 1) !== 0)) ? 1 : 0;
          else result = 0;
          break;
        case PT.VOID: result = (!this.ctype[rid] || (this.ctype[rid] === pt) !== ((this.tmp[rid] & 1) !== 0)) ? 1 : 0; break;
        case PT.SWCH: if (pt === PT.TRON) return this.life[rid] >= 10 ? 2 : 0; break;
        default: result = 1;
      }
    }
    if (this.solid !== null && result !== 0 && this.solid[ny * this.XRES + nx] && !(this.E[pt].Properties & TYPE_ENERGY)) return 0;
    const c = this.cell(nx, ny), wall = this.bmap[c];
    if (wall) {
      if (this.isWallBlocking(nx, ny, pt)) return 0;
      if (wall === WL.EHOLE && !this.emap[c] && !(this.E[pt].Properties & TYPE_SOLID) && !(this.E[rt].Properties & TYPE_SOLID)) return 2;
    }
    return result;
  }

  // ---- try_move / do_move ---------------------------------------------------------------------------------------------
  tryMove(i: number, x: number, y: number, nx: number, ny: number): number {
    if (x === nx && y === ny) return 1;
    if (nx < 0 || ny < 0 || nx >= this.XRES || ny >= this.YRES) return 1;
    const E = this.E, XRES = this.XRES, ti = this.type[i];
    let e = this.evalMove(ti, nx, ny);
    const r = this.lastR, rt = TYP(r), rid = ID(r);
    if (!e && ti === PT.PHOT && ((rt === PT.BMTL && this.rng.chance(1, 2)) || TYP(this.pmap[y * XRES + x]) === PT.BMTL)) e = 2;
    if (!e) {
      if (rt === PT.WOOD) {
        const vel = Math.hypot(this.vx[i], this.vy[i]);
        if (vel > 5) this.changeType(rid, nx, ny, PT.SAWD);
      }
      if (!(E[ti].Properties & TYPE_ENERGY)) return 0;
      if (!this.legacyEnable && ti === PT.PHOT && r) {
        if (rt === PT.COAL || rt === PT.BCOL) this.temp[rid] = this.temp[i];
        if (rt < PT_NUM && !this.isHeatInsulator(rid) && rt !== PT.FILT) this.temp[i] = this.temp[rid] = restrictTemp((this.temp[rid] + this.temp[i]) / 2);
      } else if ((ti === PT.NEUT || ti === PT.ELEC) && (rt === PT.CLNE || rt === PT.PCLN || rt === PT.BCLN || rt === PT.PBCN)) {
        if (!this.ctype[rid]) this.ctype[rid] = ti;
      }
      return 0;
    }
    if (e === 2) {
      if (ti === PT.PHOT) {
        switch (rt) {
          case PT.GLOW: if (!this.life[rid] && this.rng.chance(1, 30)) { this.life[rid] = 120; this.createGainPhoton(i); } break;
          case PT.INVIS: {
            const res = this.tmp[rid] > 0 ? this.tmp[rid] : 4, p = this.pv[this.cell(nx, ny)];
            if (p >= -res && p <= res) { this.changeType(i, x, y, PT.NEUT); this.ctype[i] = 0; }
            break;
          }
          case PT.FILT: this.ctype[i] = filtInteract(this, rid, this.ctype[i]); break;
          case PT.C5:
            if (this.life[rid] > 0 && (this.ctype[rid] & this.ctype[i] & 0xffffffc0)) {
              const vx = ((this.tmp[rid] << 16) >> 16) / 255, vy = (this.tmp[rid] >> 16) / 255;
              let vn = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
              if (this.vx[i] + vx === 0 && this.vy[i] + vy === 0) { this.vx[i] = vy; this.vy[i] = -vx; }
              else {
                this.ctype[i] = (this.ctype[rid] & this.ctype[i]) >> 6;
                this.vx[i] += vx; this.vy[i] += vy;
                vn /= this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
                vn = Math.sqrt(vn);
                this.vx[i] *= vn; this.vy[i] *= vn;
              }
              this.life[rid] = 0; this.ctype[rid] = 0;
            } else if (!this.ctype[rid] && (this.ctype[i] & 0xffffffc0)) {
              this.life[rid] = 1; this.ctype[rid] = this.ctype[i];
              this.tmp[rid] = (0xffff & Math.trunc(this.vx[i] * 255)) | (0xffff0000 & Math.trunc(this.vy[i] * 16711680));
              this.tmp2[rid] = (0xffff & Math.trunc((this.x[i] - x) * 255)) | (0xffff0000 & Math.trunc((this.y[i] - y) * 16711680));
              this.killPart(i);
            }
            break;
          case PT.BIZR: case PT.BIZRG: case PT.BIZRS: this.changeType(i, x, y, PT.ELEC); this.ctype[i] = 0; break;
          case PT.H2:
            if (!(this.tmp[i] & 1)) { this.changeType(i, x, y, PT.PROT); this.ctype[i] = 0; this.tmp2[i] = 1; this.createPart(rid, x, y, PT.ELEC); return 1; }
            break;
          case PT.GPMP: if (this.life[rid] === 0) { this.changeType(i, x, y, PT.GRVT); this.tmp[i] = (this.temp[rid] - 273.15) | 0; } break;
        }
      } else if (ti === PT.NEUT) {
        if ((rt === PT.GLAS || rt === PT.BGLA) && this.rng.chance(1, 10)) this.createCherenkovPhoton(i);
      } else if (ti === PT.ELEC) {
        if (rt === PT.GLOW) { this.changeType(i, x, y, PT.PHOT); this.ctype[i] = 0x3fffffff; }
      } else if (ti === PT.PROT) {
        if (rt === PT.INVIS) this.changeType(i, x, y, PT.NEUT);
      }
      else if ((ti === PT.BIZR || ti === PT.BIZRG) && rt === PT.FILT) this.ctype[i] = filtInteract(this, rid, this.ctype[i]);
      return 1;
    }
    switch (rt) {
      case PT.VOID: case PT.PVOD: this.killPart(i); return 0;
      case PT.BHOL: case PT.NBHL:
        if (!this.legacyEnable) this.temp[rid] = restrictTemp(this.temp[rid] + this.temp[i] / 2);
        this.killPart(i); return 0;
      case PT.WHOL: case PT.NWHL:
        if (ti === PT.ANAR) {
          if (!this.legacyEnable) this.temp[rid] = restrictTemp(this.temp[rid] - (MAX_TEMP - this.temp[i]) / 2);
          this.killPart(i); return 0;
        }
        break;
      case PT.DEUT:
        if (ti === PT.ELEC) { if (this.life[rid] < 6000) this.life[rid]++; this.temp[rid] = 0; this.killPart(i); return 0; }
        break;
      case PT.VIBR: case PT.BVBR:
        if (E[ti].Properties & TYPE_ENERGY) { this.tmp[rid] += 20; this.killPart(i); return 0; }
        break;
    }
    if (ti === PT.NEUT && (E[rt].Properties & PROP_NEUTABSORB)) { this.killPart(i); return 0; }
    if (ti === PT.CNCT) {
      const [gx, gy] = this.gravityField(x, y, E[PT.CNCT].Gravity);
      const ox = gx > 0 ? 1 : gx < 0 ? -1 : 0, oy = gy > 0 ? 1 : gy < 0 ? -1 : 0;
      if ((ox !== 0) !== (oy !== 0) && ((nx - x) * ox > 0 || (ny - y) * oy > 0)) {
        const below = this.typeAt(x + ox, y + oy);
        if (below === PT.CNCT || below === PT.ROCK) return 0;
      }
    } else if (ti === PT.GBMB && this.life[i] > 0) return 0;
    const cur = this.cell(x, y), dst = this.cell(nx, ny);
    if (this.bmap[cur] === WL.EHOLE && !this.emap[cur] && !(this.bmap[dst] === WL.EHOLE && !this.emap[dst])) return 0;
    if (r) {
      if (ti === PT.NEUT) {
        const s = this.pmap[y * XRES + x];
        if (s && !(E[TYP(s)].Properties & PROP_NEUTPENETRATE)) return 1;
        if (this.bmap[cur] === WL.ALLOWENERGY) return 1;
        if (s) {
          this.pmap[ny * XRES + nx] = (s & ~0x1ff) | this.type[ID(s)];
          this.x[ID(s)] = nx; this.y[ID(s)] = ny;
        } else this.pmap[ny * XRES + nx] = 0;
        this.x[rid] = x; this.y[rid] = y;
        this.pmap[y * XRES + x] = PMAP(rid, this.type[rid]);
        return 1;
      }
      const dk = ny * XRES + nx;
      if (this.pmap[dk] && ID(this.pmap[dk]) === rid) this.pmap[dk] = 0;
      this.x[rid] = this.x[i]; this.y[rid] = this.y[i];
      const rx = (this.x[rid] + 0.5) | 0, ry = (this.y[rid] + 0.5) | 0;
      this.pmap[ry * XRES + rx] = PMAP(rid, this.type[rid]);
    }
    return 1;
  }

  /** Returns 1 on move, 0 on blocked, -1 if the particle left the grid and died. */
  doMove(i: number, x: number, y: number, nxf: number, nyf: number): number {
    const nx = (nxf + 0.5) | 0, ny = (nyf + 0.5) | 0;
    if (this.type[i] === 0) return 0;
    const result = this.tryMove(i, x, y, nx, ny);
    if (result && !this.move(i, x, y, nxf, nyf)) return -1;
    return result;
  }

  move(i: number, x: number, y: number, nxf: number, nyf: number): boolean {
    const nx = (nxf + 0.5) | 0, ny = (nyf + 0.5) | 0, t = this.type[i], XRES = this.XRES;
    this.x[i] = nxf; this.y[i] = nyf;
    if (ny !== y || nx !== x) {
      const ok = y * XRES + x;
      if (this.pmap[ok] && ID(this.pmap[ok]) === i) this.pmap[ok] = 0;
      if (this.photons[ok] && ID(this.photons[ok]) === i) this.photons[ok] = 0;
      if (nx < CELL || nx >= XRES - CELL || ny < CELL || ny >= this.YRES - CELL) { this.killPart(i); return false; }
      if (this.E[t].Properties & TYPE_ENERGY) this.photons[ny * XRES + nx] = PMAP(i, t);
      else if (t) this.pmap[ny * XRES + nx] = PMAP(i, t);
    }
    return true;
  }

  isHeatInsulator(i: number): boolean {
    const t = this.type[i];
    return this.E[t].HeatConduct === 0 || (t === PT.HSWC && this.life[i] !== 10) || ((t === PT.PIPE || t === PT.PPIP) && (this.tmp[i] & 1) === 0 /* PFLAG_CAN_CONDUCT */);
  }

  heatCapacityOf(i: number): number {
    const t = this.type[i];
    if ((t === PT.PIPE || t === PT.PPIP) && this.ctype[i] > 0 && this.ctype[i] < this.E.length) return this.E[t].HeatCapacity + this.E[this.ctype[i]].HeatCapacity;
    return this.E[t].HeatCapacity;
  }

  // ---- photons (optics) -----------------------------------------------------------------------------------------------
  createGainPhoton(pp: number): void {
    const lx = this.x[pp], ly = this.y[pp];
    const xi = (lx + 0.5) | 0, yi = (ly + 0.5) | 0;
    if (!this.inBounds(xi, yi) || this.photons[yi * this.XRES + xi]) return;
    const i = this.createPart(-1, xi, yi, PT.PHOT);
    if (i < 0) return;
    const a = this.rng.between(0, 359) * Math.PI / 180, s = 3;
    this.life[i] = 680; this.ctype[i] = 0x3fffffff; this.x[i] = lx; this.y[i] = ly;
    this.vx[i] = Math.cos(a) * s; this.vy[i] = Math.sin(a) * s; this.temp[i] = this.temp[pp]; this.tmp[i] = 0;
  }
  createCherenkovPhoton(pp: number): void {
    const xi = (this.x[pp] + 0.5) | 0, yi = (this.y[pp] + 0.5) | 0;
    if (!this.inBounds(xi, yi) || this.photons[yi * this.XRES + xi]) return;
    const nx = this.createPart(-1, xi, yi, PT.PHOT);
    if (nx < 0) return;
    this.life[nx] = 680; this.ctype[nx] = 0x00000f80; this.x[nx] = this.x[pp]; this.y[nx] = this.y[pp]; this.temp[nx] = this.temp[pp];
    const a = this.rng.between(0, 359) * Math.PI / 180;
    this.vx[nx] = Math.cos(a) * 3; this.vy[nx] = Math.sin(a) * 3;
  }

  private isBlocking(t: number, x: number, y: number): boolean {
    if (t & REFRACT) {
      if (x < 0 || y < 0 || x >= this.XRES || y >= this.YRES) return false;
      const k = TYP(this.pmap[y * this.XRES + x]);
      return k === PT.GLAS || k === PT.BGLA;
    }
    return !this.evalMove(t, x, y);
  }
  private isBoundary(pt: number, x: number, y: number): boolean {
    if (!this.isBlocking(pt, x, y)) return false;
    if (this.isBlocking(pt, x, y - 1) && this.isBlocking(pt, x, y + 1) && this.isBlocking(pt, x - 1, y) && this.isBlocking(pt, x + 1, y)) return false;
    return true;
  }
  private static DX = [1, 1, 0, -1, -1, -1, 0, 1]; private static DY = [0, 1, 1, 1, 0, -1, -1, -1]; private static DE = [0x83, 0x07, 0x0e, 0x1c, 0x38, 0x70, 0xe0, 0xc1];
  private findNextBoundary(pt: number, p: { x: number; y: number; em: number }, dm: number, reverse: boolean): boolean {
    if (p.x <= 0 || p.x >= this.XRES - 1 || p.y <= 0 || p.y >= this.YRES - 1) return false;
    if (p.em !== -1) dm &= PowderSim.DE[p.em];
    let mask = 0;
    for (let i = 0; i < 8; i++) if ((dm & (1 << i)) && this.isBlocking(pt, p.x + PowderSim.DX[i], p.y + PowderSim.DY[i])) mask |= 1 << i;
    for (let i = 0; i < 8; i++) {
      const n = (i + (reverse ? 1 : -1)) & 7;
      if ((mask & (1 << i)) && !(mask & (1 << n))) { p.x += PowderSim.DX[i]; p.y += PowderSim.DY[i]; p.em = i; return true; }
    }
    return false;
  }
  private static dirMap(dx: number, dy: number) {
    return (dx >= 0 ? 1 : 0) | ((dx + dy) >= 0 ? 2 : 0) | (dy >= 0 ? 4 : 0) | ((dy - dx) >= 0 ? 8 : 0) | (dx <= 0 ? 16 : 0) | ((dx + dy) <= 0 ? 32 : 0) | (dy <= 0 ? 64 : 0) | ((dy - dx) <= 0 ? 128 : 0);
  }
  getNormal(pt: number, x: number, y: number, dx: number, dy: number): { nx: number; ny: number } | null {
    if (!dx && !dy) return null;
    if (!this.isBoundary(pt, x, y)) return null;
    const refract = (pt & REFRACT) !== 0;
    const ldm = refract ? 0xff : PowderSim.dirMap(-dy, dx), rdm = refract ? 0xff : PowderSim.dirMap(dy, -dx);
    const l = { x, y, em: -1 }, r = { x, y, em: -1 };
    let lv = true, rv = true, j = 0;
    for (let i = 0; i < SURF_RANGE; i++) {
      if (lv) lv = this.findNextBoundary(pt, l, ldm, true);
      if (rv) rv = this.findNextBoundary(pt, r, rdm, false);
      j += (lv ? 1 : 0) + (rv ? 1 : 0);
      if (!lv && !rv) break;
    }
    if (j < NORMAL_MIN_EST) return null;
    if (l.x === r.x && l.y === r.y) return null;
    const ex = r.x - l.x, ey = r.y - l.y, inv = 1 / Math.hypot(ex, ey);
    return { nx: ey * inv, ny: -ex * inv };
  }
  getNormalInterp(pt: number, x0: number, y0: number, dx: number, dy: number, photoelectric = false): { nx: number; ny: number } | null {
    dx /= NORMAL_FRAC; dy /= NORMAL_FRAC;
    let x = 0, y = 0, i: number;
    for (i = 0; i < NORMAL_INTERP; i++) {
      x = (x0 + 0.5) | 0; y = (y0 + 0.5) | 0;
      if (x < 0 || y < 0 || x >= this.XRES || y >= this.YRES) return null;
      if (this.isBoundary(pt, x, y)) break;
      x0 += dx; y0 += dy;
    }
    if (i >= NORMAL_INTERP) return null;
    if (photoelectric && pt === PT.PHOT) this.photoelectricEffect(x, y);
    return this.getNormal(pt, x, y, dx, dy);
  }
  photoelectricEffect(nx: number, ny: number): void {
    const r = this.pmap[ny * this.XRES + nx];
    if (TYP(r) === PT.PSCN && !this.life[ID(r)]) {
      if (this.typeAt(nx - 1, ny) === PT.NSCN || this.typeAt(nx + 1, ny) === PT.NSCN || this.typeAt(nx, ny - 1) === PT.NSCN || this.typeAt(nx, ny + 1) === PT.NSCN) {
        this.ctype[ID(r)] = PT.PSCN; this.changeType(ID(r), nx, ny, PT.SPRK); this.life[ID(r)] = 4;
      }
    }
  }
  /** Picks a wavelength bin and may narrow *wm (returned as `mask`). */
  wavelengthBin(wm: number): { bin: number; mask: number } {
    if (!(wm & 0x3fffffff)) return { bin: -1, mask: wm };
    const lo = wm | 0xc0000000, w0 = 31 - Math.clz32(lo & -lo), wM = 31 - Math.clz32(wm & 0x3fffffff);
    if (wM - w0 < 5) return { bin: wM + w0, mask: wm };
    const r = this.rng.gen();
    let i = (r >> 1) % (wM - w0 - 4);
    i += w0;
    if (r & 1) return { bin: (i + 2) * 2, mask: wm & (0x1f << i) };
    return { bin: (i + 2) * 2 - 1, mask: wm & (0xf << i) };
  }

  // ---- planning a move along the velocity vector ---------------------------------------------------------------------
  private planMove(i: number, x: number, y: number) {
    const p = this.plan, t = this.type[i], XRES = this.XRES;
    let vx = this.vx[i], vy = this.vy[i], mv = Math.max(Math.abs(vx), Math.abs(vy));
    if (mv < ISTP || Number.isNaN(mv)) {
      p.clearX = x; p.clearY = y; p.clearXf = this.x[i]; p.clearYf = this.y[i];
      p.finXf = p.clearXf + vx; p.finYf = p.clearYf + vy; p.finX = (p.finXf + 0.5) | 0; p.finY = (p.finYf + 0.5) | 0;
    } else {
      if (mv > MAX_VELOCITY) { vx *= MAX_VELOCITY / mv; vy *= MAX_VELOCITY / mv; mv = MAX_VELOCITY; }
      const dx = vx * ISTP / mv, dy = vy * ISTP / mv;
      let fxf = this.x[i], fyf = this.y[i], fx = (fxf + 0.5) | 0, fy = (fyf + 0.5) | 0;
      const closedStart = this.inBounds(fx, fy) && this.bmap[this.cell(fx, fy)] === WL.EHOLE && !this.emap[this.cell(fx, fy)];
      for (;;) {
        mv -= ISTP; fxf += dx; fyf += dy; fx = (fxf + 0.5) | 0; fy = (fyf + 0.5) | 0;
        if (mv <= 0) {
          fxf = this.x[i] + vx; fyf = this.y[i] + vy; fx = (fxf + 0.5) | 0; fy = (fyf + 0.5) | 0;
          p.clearXf = fxf - dx; p.clearYf = fyf - dy; p.clearX = (p.clearXf + 0.5) | 0; p.clearY = (p.clearYf + 0.5) | 0;
          break;
        }
        const ev = this.evalMove(t, fx, fy);
        const inb = this.inBounds(fx, fy);
        const occ = inb ? TYP(this.pmap[fy * XRES + fx]) : 0;
        const wall = inb ? this.bmap[this.cell(fx, fy)] : 0;
        const ehole = inb && wall === WL.EHOLE && !this.emap[this.cell(fx, fy)];
        if (!ev || (this.canMove[t * PT_NUM + occ] === 3 && ev === 1) || (t === PT.PHOT && inb && this.pmap[fy * XRES + fx]) || wall === WL.DESTROYALL || closedStart !== ehole) {
          p.clearXf = fxf - dx; p.clearYf = fyf - dy; p.clearX = (p.clearXf + 0.5) | 0; p.clearY = (p.clearYf + 0.5) | 0;
          break;
        }
        if (inb && wall === WL.DETECT && this.emap[this.cell(fx, fy)] < 8) this.setEmap((fx / CELL) | 0, (fy / CELL) | 0);
      }
      p.finX = fx; p.finY = fy; p.finXf = fxf; p.finYf = fyf;
    }
    p.vx = vx; p.vy = vy;
    return p;
  }

  // ---- neighbourhood ----------------------------------------------------------------------------------------------------
  private neighbourhood(i: number): void {
    const t = this.type[i], x = (this.x[i] + 0.5) | 0, y = (this.y[i] + 0.5) | 0, XRES = this.XRES;
    let j = 0, space = 0, nt = 0;
    for (let nx = -1; nx < 2; nx++) for (let ny = -1; ny < 2; ny++) {
      if (nx || ny) {
        const r = this.pmap[(y + ny) * XRES + x + nx];
        this.surround[j++] = r;
        if (!TYP(r)) space++;
        if (TYP(r) !== t) nt++;
      }
    }
    this.surroundSpace = space; this.nt = nt;
    const e = this.E[t];
    this.pGravX = 0; this.pGravY = 0;
    if (!(e.Properties & TYPE_SOLID) && (e.Gravity || e.NewtonianGravity)) { this.gravityXY(x, y, e.Gravity); this.pGravX = this.gfx; this.pGravY = this.gfy; }
  }

  // ---- per-frame --------------------------------------------------------------------------------------------------------
  /** One simulation frame: air, particles, bookkeeping. */
  step(): void {
    this.beforeSim(true);
    this.updateParticles(0, this.active);
    this.frameCount++;
  }

  private beforeSim(willUpdate: boolean): void {
    if (willUpdate) {
      this.updateAir();
      if (this.aheatEnable) this.updateAirH();
      this.currentTick++;
      this.elementRecount ||= !(this.currentTick % 180);
      if (this.elementRecount) this.elementCount.fill(0);
    }
    this.recalcFreeParticles(willUpdate);
    if (!willUpdate) return;
    const nc = this.XCELLS * this.YCELLS;
    for (let c = 0; c < nc; c++) {
      if (this.emap[c]) this.emap[c]--;
      const w = this.bmap[c];
      this.blockAir[c] = (w === WL.WALL || w === WL.WALLELEC || w === WL.BLOCKAIR || (w === WL.EWALL && !this.emap[c])) ? 1 : 0;
      this.blockAirH[c] = (this.blockAir[c] || w === WL.GRAV) ? 0x8 : 0;
    }
    if (this.forceStackingCheck || this.rng.chance(1, 10)) this.checkStacking();
    if (this.elementCount[PT.WIRE] > 0) for (let i = 0; i < this.active; i++) if (this.type[i] === PT.WIRE) this.tmp[i] = this.ctype[i];
    for (let q = 0; q < 101; q++) { this.wireless[q * 2] = this.wireless[q * 2 + 1]; this.wireless[q * 2 + 1] = 0; }
  }

  recalcFreeParticles(doLifeDec: boolean): void {
    const XRES = this.XRES, E = this.E;
    this.pmap.fill(0); this.pmapCount.fill(0); this.photons.fill(0);
    this.numParts = 0;
    for (let i = 0; i < this.active; i++) {
      const t = this.type[i];
      if (!t) continue;
      const x = (this.x[i] + 0.5) | 0, y = (this.y[i] + 0.5) | 0;
      let inBounds = false;
      if (x >= 0 && y >= 0 && x < XRES && y < this.YRES) {
        const k = y * XRES + x;
        if (E[t].Properties & TYPE_ENERGY) this.photons[k] = PMAP(i, t);
        else {
          if (!this.pmap[k] || (t !== PT.INVIS && t !== PT.FILT)) this.pmap[k] = PMAP(i, t);
          if (t !== PT.THDR && t !== PT.EMBR && t !== PT.FIGH && t !== PT.PLSM) this.pmapCount[k]++;
        }
        inBounds = true;
      }
      this.numParts++;
      if (this.elementRecount && t < PT_NUM && E[t].Enabled) this.elementCount[t]++;
      if (doLifeDec) {
        if (t < 0 || t >= PT_NUM || !E[t].Enabled) { this.killPart(i); continue; }
        const p = E[t].Properties, stasis = inBounds && this.bmap[this.cell(x, y)] === WL.STASIS && this.emap[this.cell(x, y)] < 8;
        if (this.life[i] > 0 && (p & PROP_LIFE_DEC) && !stasis) {
          this.life[i]--;
          if (this.life[i] <= 0 && (p & (PROP_LIFE_KILL_DEC | PROP_LIFE_KILL))) { this.killPart(i); continue; }
        } else if (this.life[i] <= 0 && (p & PROP_LIFE_KILL) && !stasis) { this.killPart(i); continue; }
      }
    }
    // flatten
    let newActive = 0;
    this.pfree = -1;
    let tail = -1;
    for (let i = 0; i < this.active; i++) {
      if (this.type[i]) {
        for (let j = newActive; j < i; j++) { if (tail === -1) this.pfree = j; else this.nextFree[tail] = j; tail = j; }
        newActive = i + 1;
      }
    }
    if (tail !== -1) this.nextFree[tail] = -1;
    this.active = newActive;
    this.elementRecount = false;
  }

  private checkStacking(): void {
    this.forceStackingCheck = false;
    const XRES = this.XRES;
    let found = false;
    for (let y = 0; y < this.YRES; y++) for (let x = 0; x < XRES; x++) {
      const k = y * XRES + x, c = this.pmapCount[k];
      if (c > 5) {
        if (this.bmap[this.cell(x, y)] === WL.EHOLE) { if (c > 1500) { this.pmapCount[k] = c + this.NPART; found = true; } }
        else if (c > 1500 || this.rng.between(0, 1599) <= c + 100) { this.pmapCount[k] = c + this.NPART; found = true; }
      }
    }
    if (!found) return;
    for (let i = 0; i < this.active; i++) {
      const t = this.type[i];
      if (!t) continue;
      const x = (this.x[i] + 0.5) | 0, y = (this.y[i] + 0.5) | 0;
      if (this.inBounds(x, y) && !(this.E[t].Properties & TYPE_ENERGY)) {
        const k = y * XRES + x;
        if (this.pmapCount[k] >= this.NPART) {
          if (this.pmapCount[k] > this.NPART) {
            this.createPart(i, x, y, PT.NBHL); this.temp[i] = MAX_TEMP;
            this.tmp[i] = Math.min(51200, this.pmapCount[k] - this.NPART); this.pmapCount[k] = this.NPART;
          } else this.killPart(i);
        }
      }
    }
  }

  // ---- UpdateParticles ----------------------------------------------------------------------------------------------
  updateParticles(start: number, end: number): void {
    const E = this.E, XRES = this.XRES, XC = this.XCELLS;
    for (let i = start; i < end && i < this.active; i++) {
      let t = this.type[i];
      if (!t) continue;
      let x = (this.x[i] + 0.5) | 0, y = (this.y[i] + 0.5) | 0;
      if (x < CELL || y < CELL || x >= XRES - CELL || y >= this.YRES - CELL) { this.killPart(i); continue; }
      const c = (y / CELL | 0) * XC + (x / CELL | 0), wall = this.bmap[c], pr = E[t].Properties;
      if (wall && (wall === WL.WALL || wall === WL.WALLELEC || wall === WL.ALLOWAIR || wall === WL.DESTROYALL ||
        (wall === WL.ALLOWLIQUID && !(pr & TYPE_LIQUID)) || (wall === WL.ALLOWPOWDER && !(pr & TYPE_PART)) ||
        (wall === WL.ALLOWGAS && !(pr & TYPE_GAS)) || (wall === WL.ALLOWENERGY && !(pr & TYPE_ENERGY)) ||
        (wall === WL.EWALL && !this.emap[c])) && t !== PT.STKM && t !== PT.STKM2 && t !== PT.FIGH) { this.killPart(i); continue; }
      if (wall === WL.STASIS && this.emap[c] < 8) continue;
      if (wall === WL.DETECT && this.emap[c] < 8) this.setEmap(x / CELL | 0, y / CELL | 0);

      const e = E[t];
      this.avx[c] = this.avx[c] * e.AirLoss + e.AirDrag * this.vx[i];
      this.avy[c] = this.avy[c] * e.AirLoss + e.AirDrag * this.vy[i];
      if (e.HotAir) {
        if (t === PT.GAS || t === PT.NBLE) { if (this.pv[c] < 3.5) this.pv[c] += 4 * e.HotAir * (3.5 - this.pv[c]); }
        else this.pv[c] += 4 * e.HotAir;
      }
      this.neighbourhood(i);
      if (t !== PT.SPNG || !(this.flags[i] & FLAG_MOVABLE)) { this.vx[i] *= e.Loss; this.vy[i] *= e.Loss; }
      this.vx[i] += e.Advection * this.avx[c] + this.pGravX;
      this.vy[i] += e.Advection * this.avy[c] + this.pGravY;
      if (e.Diffusion) { this.vx[i] += e.Diffusion * (2 * this.rng.uniform01() - 1); this.vy[i] += e.Diffusion * (2 * this.rng.uniform01() - 1); }

      const transitioned = this.transitionPhase(i);
      if (!this.type[i]) continue;
      if (transitioned) t = this.type[i];
      const upd = this.behaviors[t]?.update;
      if (upd) {
        if (upd(this, i, x, y, this.surroundSpace, this.nt)) continue;
        x = (this.x[i] + 0.5) | 0; y = (this.y[i] + 0.5) | 0;
      }
      if (this.type[i] === 0) continue;
      if (transitioned) continue;
      if (!this.vx[i] && !this.vy[i]) continue;
      this.movementPhase(i);
    }
  }

  private transitionPhase(i: number): boolean {
    const E = this.E, XRES = this.XRES;
    let t = this.type[i];
    const x = (this.x[i] + 0.5) | 0, y = (this.y[i] + 0.5) | 0, c = this.cell(x, y);
    let transitionOccurred = false;
    if (!this.legacyEnable) {
      let gelScale = 1;
      if (t === PT.GEL) gelScale = this.tmp[i] * 2.55;
      if ((E[t].Properties & TYPE_LIQUID) && (t !== PT.GEL || gelScale > 1 + this.rng.between(0, 254))) {
        this.gravityXY(x, y, -2);
        const ox = clampf(Math.round(this.gfx + x), x - 1, x + 1), oy = clampf(Math.round(this.gfy + y), y - 1, y + 1);
        if (ox !== x || oy !== y) {
          const r = this.pmap[oy * XRES + ox];
          if (r && this.type[i] === TYP(r) && this.temp[i] > this.temp[ID(r)]) { const s = this.temp[i]; this.temp[i] = this.temp[ID(r)]; this.temp[ID(r)] = s; }
        }
      }
      if (t && !this.isHeatInsulator(i) && this.rng.chance(Math.trunc(E[t].HeatConduct * gelScale), 250)) {
        if (this.aheatEnable && !(E[t].Properties & PROP_NOAMBHEAT)) {
          const dtemp = this.hv[c] - this.temp[i], hc = this.heatCapacityOf(i), alpha = Math.min(0.04, 0.4 * hc);
          this.temp[i] = restrictTemp(this.temp[i] + alpha * dtemp / hc);
          this.hv[c] = restrictTemp(this.hv[c] - alpha * dtemp);
        }
        let hcTotal = 0, cHeat = 0;
        const conduct = this.conductScratch;
        for (let j = 0; j < 8; j++) {
          conduct[j] = i;
          const r = this.surround[j];
          if (!r) continue;
          const rt = TYP(r), rid = ID(r);
          if (!rt || this.isHeatInsulator(rid)
            || (t === PT.FILT && (rt === PT.BRAY || rt === PT.BIZR || rt === PT.BIZRG))
            || (rt === PT.FILT && (t === PT.BRAY || t === PT.PHOT || t === PT.BIZR || t === PT.BIZRG))
            || (t === PT.ELEC && rt === PT.DEUT) || (t === PT.DEUT && rt === PT.ELEC)
            || (t === PT.HSWC && rt === PT.FILT && this.tmp[i] === 1) || (t === PT.FILT && rt === PT.HSWC && this.tmp[rid] === 1)) continue;
          conduct[j] = rid;
          const hc = this.heatCapacityOf(rid);
          cHeat += this.temp[rid] * hc; hcTotal += hc;
        }
        const hc0 = this.heatCapacityOf(i);
        cHeat += this.temp[i] * hc0; hcTotal += hc0;
        let pt = restrictTemp(cHeat / hcTotal);
        this.temp[i] = pt;
        for (let j = 0; j < 8; j++) this.temp[conduct[j]] = pt;

        let ctemph = pt, ctempl = pt;
        const pres = this.pv[c];
        if (((E[t].Properties & TYPE_LIQUID) && this.isElemOrNone(E[t].HighTemperatureTransition) && E[E[t].HighTemperatureTransition] && (E[E[t].HighTemperatureTransition].Properties & TYPE_GAS)) || t === PT.LNTG || t === PT.SLTW) ctemph -= 2 * pres;
        else if (((E[t].Properties & TYPE_GAS) && this.isElemOrNone(E[t].LowTemperatureTransition) && E[E[t].LowTemperatureTransition] && (E[E[t].LowTemperatureTransition].Properties & TYPE_LIQUID)) || t === PT.WTRV) ctempl -= 2 * pres;
        let s = 1;
        if ((t === PT.ICEI || t === PT.SNOW) && (!this.isElem(this.ctype[i]) || this.ctype[i] === PT.ICEI || this.ctype[i] === PT.SNOW)) this.ctype[i] = PT.WATR;
        const el = E[t];
        if (el.HighTemperatureTransition !== NT && ctemph >= el.HighTemperature) {
          if (el.HighTemperatureTransition !== ST) {
            if (t === PT.FOG) this.ctype[i] = 0;
            t = el.HighTemperatureTransition;
          } else if (t === PT.ICEI || t === PT.SNOW) {
            const ct = this.ctype[i];
            if (ct > 0 && ct < PT_NUM && ct !== t) {
              if (E[ct].LowTemperatureTransition === PT.ICEI || E[ct].LowTemperatureTransition === PT.SNOW) { if (pt < E[ct].LowTemperature) s = 0; }
              else if (pt < 273.15) s = 0;
              if (s) { t = ct; this.ctype[i] = 0; this.life[i] = 0; }
            } else s = 0;
          } else if (t === PT.SLTW) t = this.rng.chance(1, 4) ? PT.SALT : PT.WTRV;
          else if (t === PT.BRMT) {
            if (this.ctype[i] === PT.TUNG) {
              if (ctemph < E[this.ctype[i]].HighTemperature) s = 0; else { t = PT.LAVA; this.type[i] = PT.TUNG; }
            } else if (ctemph >= el.HighTemperature) t = PT.LAVA; else s = 0;
          } else if (t === PT.CRMC) {
            if (ctemph < this.cellPress(x, y) + E[PT.CRMC].HighTemperature) s = 0; else t = PT.LAVA;
          } else if (t === PT.RIME) {
            if (this.tmp[i] > 5) { t = PT.ACID; this.life[i] = 25 + 5 * this.tmp[i]; this.tmp[i] = 0; }
            else { t = this.ctype[i] === PT.DSTW ? PT.DSTW : PT.WATR; this.ctype[i] = 0; }
          } else s = 0;
        } else if (el.LowTemperatureTransition !== NT && ctempl < el.LowTemperature) {
          if (el.LowTemperatureTransition !== ST) t = el.LowTemperatureTransition;
          else if (t === PT.WTRV) t = pt < 273 ? PT.RIME : PT.DSTW;
          else if (t === PT.LAVA) {
            const ct = this.ctype[i];
            if (ct > 0 && ct < PT_NUM && ct !== PT.LAVA && E[ct].Enabled) {
              if (ct === PT.THRM && pt >= E[PT.BMTL].HighTemperature) s = 0;
              else if ((ct === PT.VIBR || ct === PT.BVBR) && pt >= 273.15) s = 0;
              else if (ct === PT.TUNG) { if (pt >= E[ct].HighTemperature) s = 0; }
              else if (ct === PT.CRMC) { if (ctemph >= this.cellPress(x, y) + E[PT.CRMC].HighTemperature) s = 0; }
              else if (E[ct].HighTemperatureTransition === PT.LAVA || ct === PT.HEAC) { if (pt >= E[ct].HighTemperature) s = 0; }
              else if (pt >= 973) s = 0;
              if (s) {
                t = ct; this.ctype[i] = 0;
                if (t === PT.THRM) { this.tmp[i] = 0; t = PT.BMTL; }
                if (t === PT.PLUT) { this.tmp[i] = 0; t = PT.LAVA; }
              }
            } else if (pt < 973) t = PT.STNE; else s = 0;
          } else s = 0;
        } else s = 0;

        if (s) {
          if (t === PT.ICEI || t === PT.LAVA || t === PT.SNOW) this.ctype[i] = this.type[i];
          if (t === PT.RIME) this.ctype[i] = PT.DSTW;
          if (!(t === PT.ICEI && this.ctype[i] === PT.FRZW) && t !== PT.ACID) this.life[i] = 0;
          if (t === PT.FIRE) {
            this.tmp[i] = 0;
            if (this.type[i] === PT.SEED) { this.ctype[i] = 0; this.tmp2[i] = 0; this.tmp3[i] = 0; this.tmp4[i] = 0; }
          }
          if ((E[t].Properties & TYPE_GAS) && !(E[this.type[i]].Properties & TYPE_GAS)) this.pv[c] += 0.5;
          if (t === PT.NONE) { this.killPart(i); return true; }
          if (this.changeType(i, x, y, t)) return true;
          if (t === PT.FIRE || t === PT.PLSM || t === PT.CFLM) this.life[i] = this.rng.between(120, 169);
          if (t === PT.LAVA) {
            const ct = this.ctype[i];
            if (ct === PT.BRMT) this.ctype[i] = PT.BMTL; else if (ct === PT.SAND) this.ctype[i] = PT.GLAS; else if (ct === PT.BGLA) this.ctype[i] = PT.GLAS;
            else if (ct === PT.PQRT) this.ctype[i] = PT.QRTZ; else if (ct === PT.LITH && this.tmp2[i] > 3) this.ctype[i] = PT.GLAS;
            this.life[i] = this.rng.between(240, 359);
          }
          transitionOccurred = true;
        }
        pt = this.temp[i] = restrictTemp(this.temp[i]);
        if (t === PT.LAVA) {
          this.life[i] = Math.trunc(clampf((this.temp[i] - 700) / 7, 0, 400));
          if (this.ctype[i] === PT.THRM && this.tmp[i] > 0) { this.tmp[i]--; this.temp[i] = 3500; }
          if (this.ctype[i] === PT.PLUT && this.tmp[i] > 0) { this.tmp[i]--; this.temp[i] = MAX_TEMP; }
        }
      } else {
        if (!(this.blockAirH[c] & 0x8)) this.blockAirH[c]++;
        this.temp[i] = restrictTemp(this.temp[i]);
      }
    }
    if (t === PT.LIFE) this.temp[i] = restrictTemp(this.temp[i] - 50);

    // spark updates from walls
    if ((E[t].Properties & PROP_CONDUCTS) || t === PT.SPRK) {
      let nx = x % CELL; nx = nx === 0 ? (x / CELL | 0) - 1 : nx === CELL - 1 ? (x / CELL | 0) + 1 : (x / CELL | 0);
      let ny = y % CELL; ny = ny === 0 ? (y / CELL | 0) - 1 : ny === CELL - 1 ? (y / CELL | 0) + 1 : (y / CELL | 0);
      if (nx >= 0 && ny >= 0 && nx < this.XCELLS && ny < this.YCELLS) {
        const nc = ny * this.XCELLS + nx;
        if (t !== PT.SPRK) {
          if (this.emap[nc] === 12 && !this.life[i] && this.bmap[nc] !== WL.STASIS) {
            this.changeType(i, x, y, PT.SPRK); this.life[i] = 4; this.ctype[i] = t; t = PT.SPRK;
          }
        } else if ([WL.DETECT, WL.EWALL, WL.ALLOWLIQUID, WL.WALLELEC, WL.ALLOWALLELEC, WL.EHOLE].includes(this.bmap[nc] as never)) this.setEmap(nx, ny);
      }
    }
    // basic explosion from the Explosive variable
    if ((E[t].Explosive & 2) && this.pv[c] > 2.5) {
      this.life[i] = this.rng.between(180, 259);
      this.temp[i] = restrictTemp(E[PT.FIRE].default.temp + E[t].Flammable / 2);
      t = PT.FIRE; this.changeType(i, x, y, t);
      this.pv[c] += 0.25 * CFDS;
    }
    // pressure transitions (no Newtonian gravity field, so gravtot is 0)
    {
      let s = 1;
      const el = E[t], p = this.pv[c], gravtot = 0;
      if (el.HighPressureTransition !== NT && p > el.HighPressure) {
        if (el.HighPressureTransition !== ST) t = el.HighPressureTransition;
        else if (t === PT.BMTL) { if (p > 2.5) t = PT.BRMT; else if (p > 1 && this.tmp[i] === 1) t = PT.BRMT; else s = 0; }
        else s = 0;
      } else if (el.LowPressureTransition !== NT && p < el.LowPressure && gravtot <= el.LowPressure / 4) {
        if (el.LowPressureTransition !== ST) t = el.LowPressureTransition; else s = 0;
      } else s = 0;
      if (s) {
        if (t === PT.NONE) { this.killPart(i); return true; }
        this.life[i] = 0;
        if (t === PT.BRMT) { this.ctype[i] = 0; this.tmp[i] = 0; this.tmp2[i] = 0; this.tmp3[i] = 0; this.tmp4[i] = 0; }
        if (this.changeType(i, x, y, t)) return true;
        if (t === PT.FIRE) this.life[i] = this.rng.between(120, 169);
        transitionOccurred = true;
      }
    }
    return transitionOccurred;
  }
  private conductScratch = new Int32Array(8);
  private isElem(n: number) { return n > 0 && n < this.E.length && !!this.E[n].Enabled; }
  private isElemOrNone(n: number) { return n === 0 || this.isElem(n); }
  private cellPress(x: number, y: number) {
    const g = (xx: number, yy: number) => this.pv[this.cell(xx, yy)];
    return Math.max((g(x, y) + g(x, y - 2) + g(x, y + 2) + g(x - 2, y) + g(x + 2, y)) * 2, 0);
  }

  // ---- movement phase ------------------------------------------------------------------------------------------------
  private movementPhase(i: number): void {
    const E = this.E, XRES = this.XRES, t = this.type[i];
    const x = (this.x[i] + 0.5) | 0, y = (this.y[i] + 0.5) | 0;
    const p = this.planMove(i, x, y);
    let finX = p.finX, finY = p.finY, clearX = p.clearX, clearY = p.clearY, finXf = p.finXf, finYf = p.finYf;
    const clearXf = p.clearXf, clearYf = p.clearYf;
    this.vx[i] = p.vx; this.vy[i] = p.vy;
    const stagnant = this.flags[i] & FLAG_STAGNANT;
    this.flags[i] &= ~FLAG_STAGNANT;
    const nbNt = this.nt, nbSpace = this.surroundSpace;

    if (E[t].Properties & TYPE_ENERGY) {
      if (t === PT.PHOT) {
        if (this.flags[i] & 2 /* FLAG_SKIPMOVE */) { this.flags[i] &= ~2; return; }
        if (this.evalMove(PT.PHOT, finX, finY)) {
          const rt = TYP(this.pmap[finY * XRES + finX]), lt = TYP(this.pmap[y * XRES + x]);
          const rg = rt === PT.GLAS || rt === PT.BGLA, lg = lt === PT.GLAS || lt === PT.BGLA;
          if ((rg && !lg) || (lg && !rg)) {
            const gn = this.getNormalInterp(REFRACT | t, this.x[i], this.y[i], this.vx[i], this.vy[i]);
            if (!gn) { this.killPart(i); return; }
            let nrx = gn.nx, nry = gn.ny;
            const wb = this.wavelengthBin(this.ctype[i]);
            this.ctype[i] = wb.mask;
            if (wb.bin === -1 || !(this.ctype[i] & 0x3fffffff)) { this.killPart(i); return; }
            let nn = GLASS_IOR - GLASS_DISP * (wb.bin - 30) / 30;
            nn *= nn;
            const enter = rg && !lg;
            if (enter) { nrx = -nrx; nry = -nry; nn = 1 / nn; }
            const ct1 = this.vx[i] * nrx + this.vy[i] * nry;
            let ct2 = 1 - nn * nn * (1 - ct1 * ct1);
            if (ct2 < 0) {
              this.vx[i] -= 2 * ct1 * nrx; this.vy[i] -= 2 * ct1 * nry;
              finXf = this.x[i]; finYf = this.y[i]; finX = x; finY = y;
            } else {
              ct2 = Math.sqrt(ct2) - nn * ct1;
              this.vx[i] = nn * this.vx[i] + ct2 * nrx; this.vy[i] = nn * this.vy[i] + ct2 * nry;
            }
          }
        }
      }
      if (stagnant) {
        if (!this.doMove(i, x, y, finX, finY) && this.type[i]) { this.killPart(i); return; }
      } else if (!this.doMove(i, x, y, finXf, finYf)) {
        if (this.type[i] === 0) return;
        this.flags[i] |= FLAG_STAGNANT;
        if (t === PT.NEUT && this.rng.chance(1, 10)) { this.killPart(i); return; }
        const r = this.pmap[finY * XRES + finX];
        if (t === PT.PHOT) {
          let mask = E[TYP(r)].PhotonReflectWavelengths;
          if (TYP(r) === PT.LITH) mask = 0x1f << Math.min(25, Math.max(0, this.ctype[ID(r)] >> 2));
          this.ctype[i] &= mask;
        }
        const gn = this.getNormalInterp(t, this.x[i], this.y[i], this.vx[i], this.vy[i], true);
        if (gn) {
          const nrx = gn.nx, nry = gn.ny;
          if (TYP(r) === PT.CRMC) {
            let rr = this.rng.between(-50, 50) * 0.01; rr = rr * rr * rr;
            const rx = Math.cos(rr), ry = Math.sin(rr), anrx = rx * nrx + ry * nry, anry = rx * nry - ry * nrx;
            const dp = anrx * this.vx[i] + anry * this.vy[i];
            this.vx[i] -= 2 * dp * anrx; this.vy[i] -= 2 * dp * anry;
          } else {
            const dp = nrx * this.vx[i] + nry * this.vy[i];
            this.vx[i] -= 2 * dp * nrx; this.vy[i] -= 2 * dp * nry;
          }
        } else { if (t !== PT.NEUT) this.killPart(i); return; }
        if (!(this.ctype[i] & 0x3fffffff) && t === PT.PHOT) { this.killPart(i); return; }
      }
      return;
    }
    const falldown = E[t].Falldown, coll = E[t].Collision;
    if (falldown === 0) {
      if (!this.doMove(i, x, y, finXf, finYf)) {
        if (this.type[i] === 0) return;
        if (finX > x + ISTP) finX = x + ISTP; if (finX < x - ISTP) finX = x - ISTP;
        if (finY > y + ISTP) finY = y + ISTP; if (finY < y - ISTP) finY = y - ISTP;
        if (this.doMove(i, x, y, 2 * x - finX, finY)) this.vx[i] *= coll;
        else if (this.doMove(i, x, y, finX, 2 * y - finY)) this.vy[i] *= coll;
        else { this.vx[i] *= coll; this.vy[i] *= coll; }
      }
      return;
    }
    // liquids and powders
    if (this.waterEqualTest && falldown === 2 && this.rng.chance(1, 200)) { /* flood_water not ported */ }
    if (this.doMove(i, x, y, finXf, finYf)) return;
    if (this.type[i] === 0) return;
    if (finX !== x && this.doMove(i, x, y, finXf, clearYf)) { this.vx[i] *= coll; this.vy[i] *= coll; return; }
    if (finY !== y && this.doMove(i, x, y, clearXf, finYf)) { this.vx[i] *= coll; this.vy[i] *= coll; return; }
    let pGravX = this.pGravX, pGravY = this.pGravY;
    let r = this.rng.between(0, 1) * 2 - 1;
    if ((clearX !== x || clearY !== y || nbNt || nbSpace) && (Math.abs(this.vx[i]) > 0.01 || Math.abs(this.vy[i]) > 0.01)) {
      let dx = this.vx[i] - this.vy[i] * r, dy = this.vy[i] + this.vx[i] * r;
      const mv = Math.max(Math.abs(dx), Math.abs(dy));
      dx /= mv; dy /= mv;
      if (this.doMove(i, x, y, clearXf + dx, clearYf + dy)) { this.vx[i] *= coll; this.vy[i] *= coll; return; }
      const sw = dx; dx = dy * r; dy = -sw * r;
      if (this.doMove(i, x, y, clearXf + dx, clearYf + dy)) { this.vx[i] *= coll; this.vy[i] *= coll; return; }
    }
    const rtSearch = (!stagnant || nbNt) ? 30 : 10;
    if (falldown > 1 && this.gravityMode === GRAV.VERTICAL && this.vy[i] > Math.abs(this.vx[i])) {
      let s = 0, rt = rtSearch;
      if (t === PT.GEL) rt = Math.trunc(this.tmp[i] * 0.2 + 5);
      let nx = -1, ny = -1;
      for (let j = clearX + r; j >= 0 && j >= clearX - rt && j < clearX + rt && j < XRES; j += r) {
        if ((TYP(this.pmap[finY * XRES + j]) !== t || this.bmap[this.cell(j, finY)]) && (s = this.doMove(i, x, y, j, finYf))) { nx = (this.x[i] + 0.5) | 0; ny = (this.y[i] + 0.5) | 0; break; }
        if (finY !== clearY && (TYP(this.pmap[clearY * XRES + j]) !== t || this.bmap[this.cell(j, clearY)]) && (s = this.doMove(i, x, y, j, clearYf))) { nx = (this.x[i] + 0.5) | 0; ny = (this.y[i] + 0.5) | 0; break; }
        if (TYP(this.pmap[clearY * XRES + j]) !== t || (this.bmap[this.cell(j, clearY)] && this.bmap[this.cell(j, clearY)] !== WL.STREAM)) break;
      }
      r = this.vy[i] > 0 ? 1 : -1;
      if (s === 1) {
        for (let j = ny + r; j >= 0 && j < this.YRES && j >= ny - rt && j < ny + rt; j += r) {
          if ((TYP(this.pmap[j * XRES + nx]) !== t || this.bmap[this.cell(nx, j)]) && this.doMove(i, nx, ny, nx, j)) break;
          if (TYP(this.pmap[j * XRES + nx]) !== t || (this.bmap[this.cell(nx, j)] && this.bmap[this.cell(nx, j)] !== WL.STREAM)) break;
        }
      } else if (s === -1) { /* out of bounds */ }
      else if ((clearX !== x || clearY !== y) && this.doMove(i, x, y, clearXf, clearYf)) { /* moved */ }
      else this.flags[i] |= FLAG_STAGNANT;
      this.vx[i] *= coll; this.vy[i] *= coll;
    } else if (falldown > 1 && Math.abs(pGravX * this.vx[i] + pGravY * this.vy[i]) > Math.abs(pGravY * this.vx[i] - pGravX * this.vy[i])) {
      const ptGrav = E[t].Gravity, rt = rtSearch;
      let s = 0, nxf = clearXf, nyf = clearYf, nx = clearX, ny = clearY, prevX = 0, prevY = 0;
      for (let j = 0; j < rt; j++) {
        this.gravityXY(nx, ny, ptGrav); pGravX = this.gfx; pGravY = this.gfy;
        const mv = Math.max(Math.abs(pGravX), Math.abs(pGravY));
        if (mv < 0.0001) break;
        pGravX /= mv; pGravY /= mv;
        if (j) { nxf += r * (pGravY * 2 - prevY); nyf += -r * (pGravX * 2 - prevX); }
        else { nxf += r * pGravY; nyf += -r * pGravX; }
        prevX = pGravX; prevY = pGravY;
        nx = (nxf + 0.5) | 0; ny = (nyf + 0.5) | 0;
        if (nx < 0 || ny < 0 || nx >= XRES || ny >= this.YRES) break;
        if (TYP(this.pmap[ny * XRES + nx]) !== t || this.bmap[this.cell(nx, ny)]) {
          s = this.doMove(i, x, y, nxf, nyf);
          if (s) { nx = (this.x[i] + 0.5) | 0; ny = (this.y[i] + 0.5) | 0; break; }
          if (TYP(this.pmap[ny * XRES + nx]) !== t || this.bmap[this.cell(nx, ny)] !== WL.STREAM) break;
        }
      }
      if (s === 1) {
        clearX = nx; clearY = ny;
        for (let j = 0; j < rt; j++) {
          this.gravityXY(nx, ny, ptGrav); pGravX = this.gfx; pGravY = this.gfy;
          const mv = Math.max(Math.abs(pGravX), Math.abs(pGravY));
          if (mv < 0.0001) break;
          pGravX /= mv; pGravY /= mv;
          nxf += pGravX; nyf += pGravY;
          nx = (nxf + 0.5) | 0; ny = (nyf + 0.5) | 0;
          if (nx < 0 || ny < 0 || nx >= XRES || ny >= this.YRES) break;
          if (TYP(this.pmap[ny * XRES + nx]) !== t || this.bmap[this.cell(nx, ny)]) {
            s = this.doMove(i, clearX, clearY, nxf, nyf);
            if (s || TYP(this.pmap[ny * XRES + nx]) !== t || this.bmap[this.cell(nx, ny)] !== WL.STREAM) break;
          }
        }
      } else if (s === -1) { /* out of bounds */ }
      else if ((clearX !== x || clearY !== y) && this.doMove(i, x, y, clearXf, clearYf)) { /* moved */ }
      else this.flags[i] |= FLAG_STAGNANT;
      this.vx[i] *= coll; this.vy[i] *= coll;
    } else {
      if ((clearX !== x || clearY !== y) && this.doMove(i, x, y, clearXf, clearYf)) { /* moved */ }
      else this.flags[i] |= FLAG_STAGNANT;
      this.vx[i] *= coll; this.vy[i] *= coll;
    }
  }

  /** Simulation::CreateLine (Bresenham-style, same quirks). c is an element id; v is passed to its create hook. */
  createLine(x1: number, y1: number, x2: number, y2: number, c: number, v = 0): void {
    const rev = Math.abs(y2 - y1) > Math.abs(x2 - x1);
    if (rev) { [x1, y1] = [y1, x1]; [x2, y2] = [y2, x2]; }
    if (x1 > x2) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
    const dx = x2 - x1, dy = Math.abs(y2 - y1), de = dx ? dy / dx : 0, sy = y1 < y2 ? 1 : -1;
    let e = 0, y = y1;
    for (let x = x1; x <= x2; x++) {
      if (rev) this.createPart(-1, y, x, c, v); else this.createPart(-1, x, y, c, v);
      e += de;
      if (e >= 0.5) {
        y += sy;
        if (y1 < y2 ? y <= y2 : y >= y2) { if (rev) this.createPart(-1, y, x, c, v); else this.createPart(-1, x, y, c, v); }
        e -= 1;
      }
    }
  }

  /** Simulation::flood_prop: set a numeric field on every connected particle of the same type. */
  floodProp(x: number, y: number, field: 'tmp' | 'tmp2' | 'tmp3' | 'tmp4' | 'ctype' | 'life', value: number): number {
    const XRES = this.XRES, YRES = this.YRES;
    let r = this.pmap[y * XRES + x];
    if (!r) r = this.photons[y * XRES + x];
    if (!r) return 0;
    const parttype = TYP(r), arr = this[field];
    const seen = new Uint8Array(XRES * YRES);
    const check = (xx: number, yy: number) => {
      const k = yy * XRES + xx;
      if (parttype === 0) return !this.pmap[k] && !this.photons[k];
      return (this.E[parttype].Properties & TYPE_ENERGY) ? TYP(this.photons[k]) === parttype : TYP(this.pmap[k]) === parttype;
    };
    const stack: number[] = [x, y];
    let did = 0;
    while (stack.length) {
      const yy = stack.pop()!, xx = stack.pop()!;
      let x1 = xx, x2 = xx;
      while (x1 >= CELL && check(x1 - 1, yy) && !seen[yy * XRES + x1 - 1]) x1--;
      while (x2 < XRES - CELL && check(x2 + 1, yy) && !seen[yy * XRES + x2 + 1]) x2++;
      for (let cx = x1; cx <= x2; cx++) {
        const k = yy * XRES + cx;
        const q = this.pmap[k] || this.photons[k];
        if (!q) continue;
        arr[ID(q)] = value; seen[k] = 1; did = 1;
      }
      if (yy >= CELL + 1) for (let cx = x1; cx <= x2; cx++) if (check(cx, yy - 1) && !seen[(yy - 1) * XRES + cx]) stack.push(cx, yy - 1);
      if (yy < YRES - CELL - 1) for (let cx = x1; cx <= x2; cx++) if (check(cx, yy + 1) && !seen[(yy + 1) * XRES + cx]) stack.push(cx, yy + 1);
    }
    return did;
  }

  // ---- walls / electricity maps -------------------------------------------------------------------------------------
  private isWire(x: number, y: number) { const w = this.bmap[y * this.XCELLS + x]; return w === WL.DETECT || w === WL.EWALL || w === WL.ALLOWLIQUID || w === WL.WALLELEC || w === WL.ALLOWALLELEC || w === WL.EHOLE || w === WL.STASIS; }
  private isWireOff(x: number, y: number) { return this.isWire(x, y) && this.emap[y * this.XCELLS + x] < 8; }
  setEmap(x: number, y: number): void {
    if (!this.isWireOff(x, y)) return;
    let x1 = x, x2 = x;
    while (x1 > 0 && this.isWireOff(x1 - 1, y)) x1--;
    while (x2 < this.XCELLS - 1 && this.isWireOff(x2 + 1, y)) x2++;
    for (let xx = x1; xx <= x2; xx++) this.emap[y * this.XCELLS + xx] = 16;
    const w = (a: number, b: number) => this.isWire(a, b);
    if (y > 1 && x1 === x2 && w(x1 - 1, y - 1) && w(x1, y - 1) && w(x1 + 1, y - 1) && !w(x1 - 1, y - 2) && w(x1, y - 2) && !w(x1 + 1, y - 2)) this.setEmap(x1, y - 2);
    else if (y > 0) for (let xx = x1; xx <= x2; xx++) if (this.isWireOff(xx, y - 1)) {
      if (xx === x1 || xx === x2 || y >= this.YCELLS - 1 || w(xx - 1, y - 1) || w(xx + 1, y - 1) || w(xx - 1, y + 1) || !w(xx, y + 1) || w(xx + 1, y + 1)) this.setEmap(xx, y - 1);
    }
    if (y < this.YCELLS - 2 && x1 === x2 && w(x1 - 1, y + 1) && w(x1, y + 1) && w(x1 + 1, y + 1) && !w(x1 - 1, y + 2) && w(x1, y + 2) && !w(x1 + 1, y + 2)) this.setEmap(x1, y + 2);
    else if (y < this.YCELLS - 1) for (let xx = x1; xx <= x2; xx++) if (this.isWireOff(xx, y + 1)) {
      if (xx === x1 || xx === x2 || y < 0 || w(xx - 1, y + 1) || w(xx + 1, y + 1) || w(xx - 1, y - 1) || !w(xx, y - 1) || w(xx + 1, y - 1)) this.setEmap(xx, y + 1);
    }
  }

  /** Average-position helper used by electronics (Simulation::parts_avg). */
  partsAvg(ci: number, ni: number, t: number): number {
    const R = (v: number) => (v + 0.5) | 0;
    if (t === PT.INSL) {
      const r = this.pmap[(((R(this.y[ci]) + R(this.y[ni])) / 2) | 0) * this.XRES + (((R(this.x[ci]) + R(this.x[ni])) / 2) | 0)];
      return r ? this.type[ID(r)] : PT.NONE;
    }
    const r = this.pmap[R((this.y[ci] + this.y[ni]) / 2) * this.XRES + R((this.x[ci] + this.x[ni]) / 2)];
    return r && this.type[ID(r)] === t ? t : PT.NONE;
  }

  // ---- air ------------------------------------------------------------------------------------------------------------------
  private offs: Int32Array | null = null;
  private kernelOffsets(XC: number): Int32Array {
    return this.offs ??= Int32Array.from([-XC - 1, -XC, -XC + 1, -1, 0, 1, XC - 1, XC, XC + 1]);
  }
  updateAir(): void {
    if (this.airMode === AIR.NOUPDATE) return;
    const XC = this.XCELLS, YC = this.YCELLS, vx = this.avx, vy = this.avy, pv = this.pv, k = this.kernel;
    const mix = (a: number, b: number, f: number) => a + (b - a) * f;
    for (let i = 0; i < YC; i++) for (let e = 0; e < 4; e++) {
      const c = i * XC + (e < 2 ? e : XC - 4 + e);
      pv[c] = mix(this.edgePressure, pv[c], 0.8); vx[c] = mix(this.edgeVelocityX, vx[c], 0.9); vy[c] = mix(this.edgeVelocityY, vy[c], 0.9);
    }
    for (let i = 0; i < XC; i++) for (let e = 0; e < 4; e++) {
      const c = (e < 2 ? e : YC - 4 + e) * XC + i;
      pv[c] = mix(this.edgePressure, pv[c], 0.8); vx[c] = mix(this.edgeVelocityX, vx[c], 0.9); vy[c] = mix(this.edgeVelocityY, vy[c], 0.9);
    }
    const ba = this.blockAir;
    for (let j = 1; j < YC - 1; j++) for (let i = 1; i < XC - 1; i++) if (ba[j * XC + i]) {
      const c = j * XC + i;
      vx[c] = 0; vx[c - 1] = 0; vx[c + 1] = 0; vy[c] = 0; vy[c - XC] = 0; vy[c + XC] = 0;
    }
    for (let y = 1; y < YC - 1; y++) for (let x = 1; x < XC - 1; x++) {
      const c = y * XC + x;
      const dp = vx[c - 1] - vx[c + 1] + vy[c - XC] - vy[c + XC];
      pv[c] = mix(this.edgePressure, pv[c], AIR_PLOSS);
      pv[c] += dp * AIR_TSTEPP * 0.5;
    }
    for (let y = 1; y < YC - 1; y++) for (let x = 1; x < XC - 1; x++) {
      const c = y * XC + x;
      const dx = pv[c - 1] - pv[c + 1], dy = pv[c - XC] - pv[c + XC];
      vx[c] = mix(this.edgeVelocityX, vx[c], AIR_VLOSS); vy[c] = mix(this.edgeVelocityY, vy[c], AIR_VLOSS);
      vx[c] += dx * AIR_TSTEPV * 0.5; vy[c] += dy * AIR_TSTEPV * 0.5;
      if (ba[c - 1] || ba[c] || ba[c + 1]) vx[c] = 0;
      if (ba[c - XC] || ba[c] || ba[c + XC]) vy[c] = 0;
    }
    for (let y = 0; y < YC; y++) for (let x = 0; x < XC; x++) {
      const c = y * XC + x;
      let dx = 0, dy = 0, dp = 0;
      if (y > 1 && y < YC - 2 && x > 1 && x < XC - 2) {
        const offs = this.kernelOffsets(XC);
        for (let n = 0; n < 9; n++) {
          const f = k[n], cc = c + offs[n];
          if (!ba[cc]) { dx += vx[cc] * f; dy += vy[cc] * f; dp += pv[cc] * f; } else { dx += vx[c] * f; dy += vy[c] * f; dp += pv[c] * f; }
        }
      } else for (let j = -1; j < 2; j++) for (let i = -1; i < 2; i++) {
        const f = k[i + 1 + (j + 1) * 3];
        if (y + j > 0 && y + j < YC - 1 && x + i > 0 && x + i < XC - 1 && !ba[(y + j) * XC + x + i]) {
          const cc = (y + j) * XC + x + i;
          dx += vx[cc] * f; dy += vy[cc] * f; dp += pv[cc] * f;
        } else { dx += vx[c] * f; dy += vy[c] * f; dp += pv[c] * f; }
      }
      let tx = x - dx * ADV_DIST, ty = y - dy * ADV_DIST;
      if ((Math.abs(dx * ADV_DIST) > 1 || Math.abs(dy * ADV_DIST) > 1) && tx >= 2 && tx < XC - 2 && ty >= 2 && ty < YC - 2) {
        let stepX: number, stepY: number, stepLimit: number;
        if (Math.abs(dx) > Math.abs(dy)) { stepX = dx < 0 ? 1 : -1; stepY = -dy / Math.abs(dx); stepLimit = Math.trunc(Math.abs(dx * ADV_DIST)); }
        else { stepY = dy < 0 ? 1 : -1; stepX = -dx / Math.abs(dy); stepLimit = Math.trunc(Math.abs(dy * ADV_DIST)); }
        tx = x; ty = y;
        let step = 0;
        for (; step < stepLimit; step++) {
          tx += stepX; ty += stepY;
          const ix = Math.trunc(tx + 0.5), iy = Math.trunc(ty + 0.5);
          if (ix < 0 || iy < 0 || ix >= XC || iy >= YC || ba[iy * XC + ix]) { tx -= stepX; ty -= stepY; break; }
        }
        if (step === stepLimit) { tx = x - dx * ADV_DIST; ty = y - dy * ADV_DIST; }
      }
      const i0 = Math.trunc(tx), j0 = Math.trunc(ty);
      tx -= i0; ty -= j0;
      if (!ba[c] && i0 >= 2 && i0 < XC - 3 && j0 >= 2 && j0 < YC - 3 && tx >= 0 && ty >= 0) {
        dx *= 1 - AIR_VADV; dy *= 1 - AIR_VADV;
        const a = j0 * XC + i0;
        dx += AIR_VADV * ((1 - tx) * (1 - ty) * vx[a] + tx * (1 - ty) * vx[a + 1] + (1 - tx) * ty * vx[a + XC] + tx * ty * vx[a + XC + 1]);
        dy += AIR_VADV * ((1 - tx) * (1 - ty) * vy[a] + tx * (1 - ty) * vy[a + 1] + (1 - tx) * ty * vy[a + XC] + tx * ty * vy[a + XC + 1]);
      }
      if (this.vorticityCoeff > 0 && x > 1 && x < XC - 2 && y > 1 && y < YC - 2) {
        const dwx = (Math.abs(this.vorticity(y, x + 1)) - Math.abs(this.vorticity(y, x - 1))) * 0.5;
        const dwy = (Math.abs(this.vorticity(y + 1, x)) - Math.abs(this.vorticity(y - 1, x))) * 0.5;
        const norm = Math.hypot(dwx, dwy), w = this.vorticity(y, x);
        dx += this.vorticityCoeff / 5 * dwy / (norm + 0.001) * w;
        dy += this.vorticityCoeff / 5 * (-dwx) / (norm + 0.001) * w;
      }
      if (this.bmap[c] === WL.FAN) { dx += this.fvx[c]; dy += this.fvy[c]; }
      dp = clampf(dp, MIN_PRESSURE, MAX_PRESSURE); dx = clampf(dx, MIN_PRESSURE, MAX_PRESSURE); dy = clampf(dy, MIN_PRESSURE, MAX_PRESSURE);
      switch (this.airMode) {
        case AIR.PRESSUREOFF: dp = 0; break;
        case AIR.VELOCITYOFF: dx = 0; dy = 0; break;
        case AIR.OFF: dx = 0; dy = 0; dp = 0; break;
      }
      this.ovx[c] = dx; this.ovy[c] = dy; this.opv[c] = dp;
    }
    vx.set(this.ovx); vy.set(this.ovy); pv.set(this.opv);
  }

  private vorticity(y: number, x: number): number {
    const XC = this.XCELLS, ba = this.blockAir;
    if (!(x > 1 && x < XC - 2 && y > 1 && y < this.YCELLS - 2)) return 0;
    const c = y * XC + x;
    const dvydx = (ba[c] || ba[c + 1] || ba[c - 1]) ? 0 : this.avy[c + 1] - this.avy[c - 1];
    const dvxdy = (ba[c] || ba[c + XC] || ba[c - XC]) ? 0 : this.avx[c + XC] - this.avx[c - XC];
    return (dvydx - dvxdy) * 0.5;
  }

  updateAirH(): void {
    const XC = this.XCELLS, YC = this.YCELLS, vx = this.avx, vy = this.avy, hv = this.hv, bh = this.blockAirH, k = this.kernel, amb = this.ambientAirTemp;
    for (let i = 0; i < YC; i++) for (const x of [0, 1, XC - 2, XC - 1]) hv[i * XC + x] = amb;
    for (let i = 0; i < XC; i++) for (const y of [0, 1, YC - 2, YC - 1]) hv[y * XC + i] = amb;
    for (let y = 0; y < YC; y++) for (let x = 0; x < XC; x++) {
      const c = y * XC + x;
      let dh = 0, dx = 0, dy = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const f = k[i + 1 + (j + 1) * 3];
        if (y + j > 0 && y + j < YC - 1 && x + i > 0 && x + i < XC - 1 && !(bh[(y + j) * XC + x + i] & 8)) {
          const cc = (y + j) * XC + x + i; dh += hv[cc] * f; dx += vx[cc] * f; dy += vy[cc] * f;
        } else { dh += hv[c] * f; dx += vx[c] * f; dy += vy[c] * f; }
      }
      let tx = x - dx * ADV_DIST, ty = y - dy * ADV_DIST;
      if ((Math.abs(dx * ADV_DIST) > 1 || Math.abs(dy * ADV_DIST) > 1) && tx >= 2 && tx < XC - 2 && ty >= 2 && ty < YC - 2) {
        let stepX: number, stepY: number, stepLimit: number;
        if (Math.abs(dx) > Math.abs(dy)) { stepX = dx < 0 ? 1 : -1; stepY = -dy / Math.abs(dx); stepLimit = Math.trunc(Math.abs(dx * ADV_DIST)); }
        else { stepY = dy < 0 ? 1 : -1; stepX = -dx / Math.abs(dy); stepLimit = Math.trunc(Math.abs(dy * ADV_DIST)); }
        tx = x; ty = y;
        let step = 0;
        for (; step < stepLimit; step++) {
          tx += stepX; ty += stepY;
          const ix = Math.trunc(tx + 0.5), iy = Math.trunc(ty + 0.5);
          if (ix < 0 || iy < 0 || ix >= XC || iy >= YC || (bh[iy * XC + ix] & 8)) { tx -= stepX; ty -= stepY; break; }
        }
        if (step === stepLimit) { tx = x - dx * ADV_DIST; ty = y - dy * ADV_DIST; }
      }
      const i0 = Math.trunc(tx), j0 = Math.trunc(ty);
      tx -= i0; ty -= j0;
      if (!(bh[c] & 8) && i0 >= 0 && i0 < XC - 1 && j0 >= 0 && j0 < YC - 1 && tx >= 0 && ty >= 0) {
        const odh = dh, a = j0 * XC + i0, h = (cc: number) => (bh[cc] & 8) ? odh : hv[cc];
        dh *= 1 - AIR_VADV;
        dh += AIR_VADV * ((1 - tx) * (1 - ty) * h(a) + tx * (1 - ty) * h(a + 1) + (1 - tx) * ty * h(a + XC) + tx * ty * h(a + XC + 1));
      }
      if (bh[c] & 8) dh = hv[c];
      this.ohv[c] = clampf(dh, MIN_TEMP, MAX_TEMP);
      let dvx = vx[c], dvy = vy[c];
      if (x >= 2 && x < XC - 2 && y >= 2 && y < YC - 2 && this.convection !== 'off') {
        let [gx, gy] = this.gravityField(x * CELL, y * CELL, -1);
        if (this.convection === 'legacy') {
          const weight = ((hv[c] - hv[c - 1]) * gx + (hv[c] - hv[c - XC]) * gy) / 5000;
          if (weight > 0 && !(bh[c - XC] & 8)) { dvx += weight * gx; dvy += weight * gy; }
        } else {
          const gm = Math.hypot(gx, gy);
          if (gm > 10) { gx /= 0.1 * gm; gy /= 0.1 * gm; }
          const weight = Math.min(0.01, (hv[c] - amb) / 10000);
          dvx += weight * gx; dvy += weight * gy;
        }
      }
      vx[c] = clampf(dvx, MIN_PRESSURE, MAX_PRESSURE); vy[c] = clampf(dvy, MIN_PRESSURE, MAX_PRESSURE);
    }
    hv.set(this.ohv);
  }
}
