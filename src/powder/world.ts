/* Placement of the powder grid in the Planck world and its coupling to rigid bodies.
 *
 * Everything in this file is OpenPlayground glue, not a port: the Powder Toy has no rigid bodies. The coupling rules
 * (solid masks, contact heat exchange, ignition, wetting, pressure force) are heuristics chosen here and are listed as
 * such in research/POWDER.md. Grid y grows downward; world y grows upward.
 */
import { Vec2, type Body, type Fixture, type World } from 'planck';
import { GRAV, PowderSim } from './sim';
import { CELL, ELEMENTS, ID, PT, TYP, WL } from './elements';
import { getHeatCapacity, ignite, type PhysicalObject } from '../systems/physical';

export interface PowderWorldOptions {
  /** World position of the grid's lower-left corner, metres. */
  origin?: { x: number; y: number };
  /** Metres per grid pixel. */
  pixelSize?: number;
  cellsX?: number; cellsY?: number; seed?: number;
  ambientCelsius?: number;
}
export interface PowderCoupling {
  physicalFor(body: Body): PhysicalObject | undefined;
  random?: () => number;
}

const WET = new Set<number>([PT.WATR, PT.DSTW, PT.SLTW, PT.CBNW, PT.FRZW, PT.ICEI]);
const FLAME = new Set<number>([PT.FIRE, PT.PLSM, PT.LAVA, PT.CFLM, PT.EMBR]);
/** Newtons per (pressure unit per cell) per square metre. OpenPlayground heuristic, not derived from either game. */
export const PRESSURE_FORCE = 40;

/** Brush ids at or above this paint LIFE with the ruleset index `id - GOL_BRUSH`. */
export const GOL_BRUSH = 1000;
export class PowderWorld {
  readonly sim: PowderSim;
  readonly pixel: number;
  origin: { x: number; y: number };
  enabled = true;
  /** Seconds of simulated time per Powder Toy frame (the game runs at 60 frames per second). */
  readonly frameTime = 1 / 60;
  private accumulator = 0;
  /** Smoothed wall-clock milliseconds per Powder Toy frame (diagnostic). */
  stepMs = 0;
  private staticSignature = NaN;
  private dynamicPixels: number[] = [];
  private fixtureIds = new WeakMap<Fixture, number>();
  private nextFixtureId = 1;
  readonly solid: Uint8Array;
  /** Latest per-body contact summary, exposed for tests and the HUD. */
  readonly contacts = new Map<Body, { particles: number; hottest: number; wet: boolean; flame: boolean }>();

  constructor(options: PowderWorldOptions = {}) {
    this.pixel = options.pixelSize ?? 0.04;
    this.sim = new PowderSim({ cellsX: options.cellsX, cellsY: options.cellsY, seed: options.seed, ambientHeat: true, ambientTemp: (options.ambientCelsius ?? 18) + 273.15 });
    this.solid = new Uint8Array(this.sim.XRES * this.sim.YRES);
    this.sim.solid = this.solid;
    const w = this.sim.XRES * this.pixel;
    this.origin = options.origin ?? { x: -w / 2, y: -CELL * this.pixel };
  }

  get width() { return this.sim.XRES * this.pixel; }
  get height() { return this.sim.YRES * this.pixel; }
  /** Centre of the zone in world coordinates. */
  get center() { return { x: this.origin.x + this.width / 2, y: this.origin.y + this.height / 2 }; }

  worldToPixel(x: number, y: number) {
    return { x: Math.floor((x - this.origin.x) / this.pixel), y: Math.floor((this.origin.y + this.height - y) / this.pixel) };
  }
  pixelToWorld(px: number, py: number) {
    return { x: this.origin.x + (px + 0.5) * this.pixel, y: this.origin.y + this.height - (py + 0.5) * this.pixel };
  }
  contains(x: number, y: number) {
    return x >= this.origin.x && y >= this.origin.y && x < this.origin.x + this.width && y < this.origin.y + this.height;
  }

  moveTo(x: number, y: number) { this.origin = { x, y }; this.staticSignature = NaN; this.revision++; }

  setAmbientCelsius(celsius: number) { this.sim.ambientAirTemp = celsius + 273.15; }
/** Follow the rigid-body world's gravity vector (screen y points down, world y up). */
  setGravity(gx: number, gy: number): void {
    const magnitude = Math.hypot(gx, gy), sim = this.sim;
    if (magnitude < 0.05) { sim.gravityMode = GRAV.OFF; return; }
    if (Math.abs(gx) < 1e-6 && Math.abs(gy + 9.81) < 1e-3) { sim.gravityMode = GRAV.VERTICAL; return; }
    sim.gravityMode = GRAV.CUSTOM; sim.customGravityX = gx / 9.81; sim.customGravityY = -gy / 9.81;
  }

  // ---- painting --------------------------------------------------------------------------------------------------------
  /** Brush: element id (PT.*), GOL_BRUSH + n for the n-th built-in Game of Life ruleset, 'erase', or 'wall'. Radius is in pixels. Returns number of changed pixels. */
  paint(x: number, y: number, what: number | 'erase' | 'wall' | 'unwall', radius = 3): number {
    const c = this.worldToPixel(x, y), sim = this.sim;
    let n = 0;
    this.revision++;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      const px = c.x + dx, py = c.y + dy;
      if (px < CELL || py < CELL || px >= sim.XRES - CELL || py >= sim.YRES - CELL) continue;
      if (what === 'erase') { if (sim.at(px, py) || sim.photons[py * sim.XRES + px]) { sim.deletePart(px, py); n++; } }
      else if (what === 'wall' || what === 'unwall') {
        const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL), w = what === 'wall' ? WL.WALL : WL.ERASE;
        if (sim.bmap[cy * sim.XCELLS + cx] !== w) { sim.bmap[cy * sim.XCELLS + cx] = w; n++; sim.gravWallChanged = true; }
      } else if (typeof what === 'number' && what >= GOL_BRUSH ? sim.createPart(-2, px, py, PT.LIFE, what - GOL_BRUSH) >= 0 : sim.createPart(-2, px, py, what as number, what === PT.LIGH ? -1 : 0) >= 0) n++;
    }
    return n;
  }
  /** Interpolated stroke from the previous brush position so fast drags leave no gaps. */
  stroke(x0: number, y0: number, x1: number, y1: number, what: number | 'erase' | 'wall' | 'unwall', radius = 3): number {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (this.pixel * Math.max(1, radius / 2))));
    let n = 0;
    for (let i = 0; i <= steps; i++) n += this.paint(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, what, radius);
    return n;
  }
  /** Bumped whenever the grid changes outside `advance`, so presentation can skip redundant redraws. */
  revision = 0;
  clear() { this.revision++; this.sim.clear(); this.solid.fill(0); this.dynamicPixels = []; this.staticSignature = NaN; this.accumulator = 0; }

  /** Adds an explosion-like pressure pulse centred on a world point. amount is in Powder Toy pressure units. */
  injectPressure(x: number, y: number, radiusMetres: number, amount: number): void {
    if (!this.contains(x, y)) return;
    const sim = this.sim, cx = (x - this.origin.x) / this.pixel / CELL, cy = (this.origin.y + this.height - y) / this.pixel / CELL, r = Math.max(1, radiusMetres / this.pixel / CELL);
    for (let j = Math.max(1, Math.floor(cy - r)); j <= Math.min(sim.YCELLS - 2, Math.ceil(cy + r)); j++) for (let i = Math.max(1, Math.floor(cx - r)); i <= Math.min(sim.XCELLS - 2, Math.ceil(cx + r)); i++) {
      const d = Math.hypot(i - cx, j - cy);
      if (d <= r) sim.pv[j * sim.XCELLS + i] = Math.max(-256, Math.min(256, sim.pv[j * sim.XCELLS + i] + amount * (1 - d / r)));
    }
  }

  // ---- stepping -------------------------------------------------------------------------------------------------------
  /** Advance by `dt` seconds of scaled simulation time (at most 3 Powder Toy frames per call). */
  advance(dt: number): number {
    if (!this.enabled) return 0;
    this.accumulator = Math.min(this.accumulator + dt, this.frameTime * 3);
    let frames = 0;
    const t0 = performance.now();
    while (this.accumulator >= this.frameTime) { this.sim.step(); this.accumulator -= this.frameTime; frames++; }
    if (frames) this.stepMs = this.stepMs * 0.9 + ((performance.now() - t0) / frames) * 0.1;
    return frames;
  }

  // ---- rigid body coupling -----------------------------------------------------------------------------------------
  private fixtureKey(f: Fixture): number {
    let id = this.fixtureIds.get(f);
    if (!id) { id = this.nextFixtureId++; this.fixtureIds.set(f, id); }
    return id;
  }

  private rasterize(f: Fixture, bit: number, out: number[] | null): number {
    const sim = this.sim, aabb = f.getAABB(0);
    const x0 = Math.max(0, Math.floor((aabb.lowerBound.x - this.origin.x) / this.pixel)), x1 = Math.min(sim.XRES - 1, Math.ceil((aabb.upperBound.x - this.origin.x) / this.pixel));
    const y0 = Math.max(0, Math.floor((this.origin.y + this.height - aabb.upperBound.y) / this.pixel)), y1 = Math.min(sim.YRES - 1, Math.ceil((this.origin.y + this.height - aabb.lowerBound.y) / this.pixel));
    let n = 0;
    const p = Vec2(0, 0);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      p.x = this.origin.x + (px + 0.5) * this.pixel; p.y = this.origin.y + this.height - (py + 0.5) * this.pixel;
      if (f.testPoint(p)) { const k = py * sim.XRES + px; this.solid[k] |= bit; out?.push(k); n++; }
    }
    return n;
  }

  /**
   * Called once per physics step before Planck integrates. Rebuilds the body masks, then exchanges heat, ignition, wetness
   * and pressure force between grid and bodies.
   */
  couple(world: World, coupling: PowderCoupling): void {
    if (!this.enabled) return;
    const rng = coupling.random ?? Math.random, sim = this.sim, XRES = sim.XRES;
    const lower = Vec2(this.origin.x, this.origin.y), upper = Vec2(this.origin.x + this.width, this.origin.y + this.height);
    const statics: Fixture[] = [], dynamics = new Map<Body, Fixture[]>();
    world.queryAABB({ lowerBound: lower, upperBound: upper }, f => {
      if (f.isSensor()) return true;
      const b = f.getBody();
      if (!b.isActive()) return true;
      if (b.isStatic()) statics.push(f);
      else { const list = dynamics.get(b); if (list) list.push(f); else dynamics.set(b, [f]); }
      return true;
    });
    // static mask only changes when static fixtures appear, vanish or move
    let signature = statics.length;
    for (const f of statics) { const b = f.getBody(), p = b.getPosition(); signature = (signature * 31 + this.fixtureKey(f) + Math.round(p.x * 100) * 7 + Math.round(p.y * 100) * 13 + Math.round(b.getAngle() * 100) * 17) % 2147483647; }
    if (signature !== this.staticSignature) {
      for (let k = 0; k < this.solid.length; k++) this.solid[k] &= ~1;
      for (const f of statics) this.rasterize(f, 1, null);
      this.staticSignature = signature;
    }
    for (const k of this.dynamicPixels) this.solid[k] &= ~2;
    this.dynamicPixels = [];
    this.contacts.clear();
    const bodyPixels = new Map<Body, number[]>();
    for (const [body, fixtures] of dynamics) {
      const list: number[] = [];
      for (const f of fixtures) this.rasterize(f, 2, list);
      bodyPixels.set(body, list);
      for (const k of list) this.dynamicPixels.push(k);
    }
    for (const [body, pixels] of bodyPixels) {
      if (!pixels.length) continue;
      const object = coupling.physicalFor(body);
      // contact scan: particles orthogonally adjacent to the body's pixels
      let particles = 0, hottest = 0, wet = false, flame = false, heat = 0;
      const touched = new Set<number>();
      const stride = Math.max(1, Math.floor(pixels.length / 1500));
      for (let n = 0; n < pixels.length; n += stride) {
        const k = pixels[n];
        for (const o of [1, -1, XRES, -XRES]) {
          const kk = k + o;
          if (kk < 0 || kk >= this.solid.length || (this.solid[kk] & 2)) continue;
          const r = sim.pmap[kk];
          if (!r) continue;
          const pid = ID(r), t = TYP(r);
          if (touched.has(pid)) continue;
          touched.add(pid); particles++;
          const tempK = sim.temp[pid];
          hottest = Math.max(hottest, tempK);
          if (WET.has(t)) wet = true;
          if (FLAME.has(t) || (object && tempK - 273.15 > object.properties.BurningTemperatureThreshold)) flame = true;
          if (object && !object.isStatic) {
            const conduct = ELEMENTS[t].HeatConduct / 250;
            const bodyK = object.state.temperature + 273.15;
            const d = tempK - bodyK;
            heat += d * conduct * 0.02 * stride;
            sim.temp[pid] = Math.max(0, tempK - d * conduct * 0.1);
            if (WET.has(t)) object.state.wetness = Math.min(1.5, object.state.wetness + 0.02 * stride);
          }
        }
      }
      this.contacts.set(body, { particles, hottest, wet, flame });
      // heat from surrounding ambient air in the body's block
      const centre = body.getWorldCenter(), cp = this.worldToPixel(centre.x, centre.y);
      const inZone = cp.x >= 0 && cp.y >= 0 && cp.x < sim.XRES && cp.y < sim.YRES;
      if (object && !object.isStatic) {
        const capacity = getHeatCapacity(object);
        if (inZone) {
          const c = sim.cell(cp.x, cp.y);
          heat += (sim.hv[c] - (object.state.temperature + 273.15)) * 0.002;
          sim.hv[c] += ((object.state.temperature + 273.15) - sim.hv[c]) * 0.002 * Math.min(1, pixels.length / 400);
        }
        object.state.temperature = Math.max(-273.15, Math.min(1e6, object.state.temperature + heat / Math.max(1, capacity)));
        if (flame && rng() < 0.05) ignite(object, rng(), false);
        if (object.state.onFire) {
          // burning bodies shed flames and smoke into free neighbouring pixels
          const emits = Math.min(3, Math.ceil(object.state.burnIntensity * 3 + 0.2));
          for (let e = 0; e < emits; e++) {
            if (rng() > 0.35) continue;
            const k = pixels[Math.floor(rng() * pixels.length)], o = [1, -1, XRES, -XRES][Math.floor(rng() * 4)], kk = k + o;
            if (kk < 0 || kk >= this.solid.length || (this.solid[kk] & 2) || sim.pmap[kk]) continue;
            const px = kk % XRES, py = (kk - px) / XRES;
            const id = sim.createPart(-1, px, py, rng() < 0.75 ? PT.FIRE : PT.SMKE);
            if (id >= 0) sim.temp[id] = Math.max(sim.temp[id], object.state.temperature + 273.15);
          }
        }
      }
      // pressure gradient force and air drag on dynamic bodies
      if (inZone && cp.x > 2 * CELL && cp.y > 2 * CELL) {
        const c = sim.cell(cp.x, cp.y), XC = sim.XCELLS, area = pixels.length * this.pixel * this.pixel;
        const gx = (sim.pv[c - 1] - sim.pv[c + 1]) * 0.5, gy = (sim.pv[c + XC] - sim.pv[c - XC]) * 0.5; // world y is up
        const limit = 40 * body.getMass() * 9.81;
        const fx = Math.max(-limit, Math.min(limit, gx * area * PRESSURE_FORCE)), fy = Math.max(-limit, Math.min(limit, gy * area * PRESSURE_FORCE));
        if (fx || fy) body.applyForceToCenter(Vec2(fx, fy), true);
        // moving bodies stir the air in their block
        const v = body.getLinearVelocity();
        const toPixelsPerFrame = this.frameTime / this.pixel;
        sim.avx[c] += (v.x * toPixelsPerFrame - sim.avx[c]) * 0.02;
        sim.avy[c] += (-v.y * toPixelsPerFrame - sim.avy[c]) * 0.02;
      }
    }
  }

  // ---- persistence ------------------------------------------------------------------------------------------------------
  /** Compact JSON-able snapshot: particles as parallel numeric rows plus walls. Air fields are rebuilt by simulation. */
  serialize(maxParticles = Infinity) {
    const sim = this.sim, rows: number[][] = [];
    for (let i = 0; i < sim.active && rows.length < maxParticles; i++) {
      if (!sim.type[i]) continue;
      rows.push([sim.type[i], Math.round(sim.x[i] * 100) / 100, Math.round(sim.y[i] * 100) / 100, Math.round(sim.vx[i] * 1000) / 1000, Math.round(sim.vy[i] * 1000) / 1000,
        Math.round(sim.temp[i] * 100) / 100, sim.life[i], sim.ctype[i], sim.tmp[i], sim.tmp2[i], sim.tmp3[i], sim.tmp4[i], sim.flags[i]]);
    }
    const walls: number[] = [];
    for (let c = 0; c < sim.bmap.length; c++) if (sim.bmap[c]) walls.push(c, sim.bmap[c]);
    return { version: 1, origin: { ...this.origin }, pixelSize: this.pixel, cellsX: sim.XCELLS, cellsY: sim.YCELLS, particles: rows, walls };
  }
  /** Returns false (leaving the world untouched) if the payload is malformed or mismatched. */
  deserialize(data: unknown): boolean {
    const d = data as ReturnType<PowderWorld['serialize']> | null;
    const sim = this.sim;
    if (!d || d.version !== 1 || d.cellsX !== sim.XCELLS || d.cellsY !== sim.YCELLS || !Array.isArray(d.particles) || !Array.isArray(d.walls)) return false;
    if (d.particles.length > sim.NPART || d.walls.length % 2) return false;
    for (const row of d.particles) {
      if (!Array.isArray(row) || row.length !== 13 || row.some(v => typeof v !== 'number' || !Number.isFinite(v))) return false;
      if (!Number.isInteger(row[0]) || row[0] <= 0 || row[0] >= 512 || !ELEMENTS[row[0]]?.Enabled) return false;
    }
    for (let k = 0; k < d.walls.length; k += 2) if (!Number.isInteger(d.walls[k]) || d.walls[k] < 0 || d.walls[k] >= sim.bmap.length || !Number.isInteger(d.walls[k + 1]) || d.walls[k + 1] < 0 || d.walls[k + 1] > 18) return false;
    this.clear();
    if (d.origin && Number.isFinite(d.origin.x) && Number.isFinite(d.origin.y)) this.origin = { x: d.origin.x, y: d.origin.y };
    for (let k = 0; k < d.walls.length; k += 2) sim.bmap[d.walls[k]] = d.walls[k + 1];
    // spawn points first, so a stickman loaded before its spawn point does not create a second one at its head
    const ordered = [...d.particles.filter(r => r[0] === PT.SPAWN || r[0] === PT.SPAWN2), ...d.particles.filter(r => r[0] !== PT.SPAWN && r[0] !== PT.SPAWN2)];
    for (const r of ordered) {
      const x = Math.round(r[1]), y = Math.round(r[2]);
      const i = sim.createPart(-3, Math.min(sim.XRES - 1, Math.max(0, x)), Math.min(sim.YRES - 1, Math.max(0, y)), r[0]);
      if (i < 0) continue;
      sim.x[i] = r[1]; sim.y[i] = r[2]; sim.vx[i] = r[3]; sim.vy[i] = r[4]; sim.temp[i] = r[5]; sim.life[i] = r[6]; sim.ctype[i] = r[7];
      // a FIGH's tmp indexes the fighter table slot that createPart just allocated, so it must not be overwritten
      if (r[0] !== PT.FIGH) sim.tmp[i] = r[8];
      sim.tmp2[i] = r[9]; sim.tmp3[i] = r[10]; sim.tmp4[i] = r[11]; sim.flags[i] = r[12];
    }
    return true;
  }
}
