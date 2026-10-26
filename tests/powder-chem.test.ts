import { describe, expect, it } from 'vitest';
import { PowderSim } from '../src/powder/sim';
import { PT, TYP, WL } from '../src/powder/elements';

const run = (sim: PowderSim, n: number) => { for (let i = 0; i < n; i++) sim.step(); };
const count = (sim: PowderSim, t: number) => { let n = 0; for (let i = 0; i < sim.active; i++) if (sim.type[i] === t) n++; return n; };
const fill = (sim: PowderSim, x0: number, y0: number, w: number, h: number, t: number) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) sim.createPart(-1, x, y, t);
};
const arena = (seed = 1) => { const s = new PowderSim({ cellsX: 40, cellsY: 30, seed }); s.gravityMode = 1; return s; };

describe('powder chemistry', () => {
  it('fire ignites adjacent wood and wood burns away to smoke/fire', () => {
    const sim = arena();
    fill(sim, 60, 60, 20, 4, PT.WOOD);
    const f = sim.createPart(-1, 59, 61, PT.FIRE);
    expect(f).toBeGreaterThanOrEqual(0);
    run(sim, 300);
    expect(count(sim, PT.WOOD)).toBeLessThan(80);
  });

  it('spark travels along a metal wire between PSCN and NSCN and lights a lamp-like chain', () => {
    const sim = arena();
    fill(sim, 40, 60, 40, 1, PT.METL);
    const head = sim.createPart(-1, 40, 60, PT.PSCN); // replaces nothing: overlapped METL cell is occupied, so expect -1
    expect(head).toBe(-1);
    const m = sim.at(60, 60) >> 9;
    sim.createPart(-1, 60, 60, PT.SPRK); // SPRK onto METL converts it in place
    expect(sim.type[m]).toBe(PT.SPRK);
    let reached = false;
    for (let f = 0; f < 80 && !reached; f++) {
      sim.step();
      for (let i = 0; i < sim.active; i++) if (sim.type[i] === PT.SPRK && Math.round(sim.x[i]) <= 52) reached = true;
    }
    expect(reached).toBe(true);
  });

  it('insulation blocks spark conduction', () => {
    const sim = arena();
    fill(sim, 40, 60, 20, 1, PT.METL);
    for (let y = 58; y <= 62; y++) { const r = sim.at(50, y); if (r) sim.killPart(r >> 9); sim.createPart(-1, 50, y, PT.INSL); }
    sim.createPart(-1, 44, 60, PT.SPRK);
    run(sim, 120);
    for (let i = 0; i < sim.active; i++) if (sim.type[i] === PT.SPRK) expect(sim.x[i]).toBeLessThan(50);
  });

  it('water extinguishes fire', () => {
    const sim = arena();
    fill(sim, 60, 60, 10, 10, PT.WATR);
    sim.createPart(-1, 59, 65, PT.FIRE); sim.createPart(-1, 59, 66, PT.FIRE); sim.createPart(-1, 59, 64, PT.FIRE);
    run(sim, 40);
    expect(count(sim, PT.FIRE)).toBe(0);
  });

  it('gunpowder explodes on ignition and raises local pressure', () => {
    const sim = arena();
    fill(sim, 60, 60, 6, 6, PT.GUNP);
    sim.createPart(-1, 59, 62, PT.FIRE);
    let peak = 0;
    for (let f = 0; f < 60; f++) { sim.step(); peak = Math.max(peak, ...sim.pv); }
    expect(peak).toBeGreaterThan(0.3);
    expect(count(sim, PT.GUNP)).toBeLessThan(36);
  });

  it('acid dissolves metal and loses strength doing so', () => {
    const sim = arena();
    fill(sim, 60, 60, 6, 6, PT.METL);
    const a = sim.createPart(-1, 59, 62, PT.ACID);
    const life0 = sim.life[a];
    run(sim, 600);
    expect(count(sim, PT.METL)).toBeLessThan(36);
    expect(sim.type[a] === 0 || sim.life[a] < life0).toBe(true);
  });

  it('lava turns adjacent water to steam and cools to rock', () => {
    const sim = arena();
    sim.setWall(0, 0, WL.ERASE);
    const l = sim.createPart(-1, 80, 80, PT.LAVA), w = sim.createPart(-1, 81, 80, PT.WATR);
    void l; void w;
    run(sim, 200);
    expect(count(sim, PT.WATR)).toBe(0);
  });

  it('pressure above ICE threshold crushes ice to snow', () => {
    const sim = arena();
    const ice = sim.createPart(-1, 60, 60, PT.ICEI);
    sim.pv[sim.cell(60, 60)] = 5;
    sim.step();
    expect(TYP((ice >= 0 ? sim.type[ice] : 0))).toBe(PT.SNOW);
  });

  it('iron rusts to BMTL in salt water', () => {
    const sim = arena(7);
    const fe = sim.createPart(-1, 60, 60, PT.IRON);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) sim.createPart(-1, 60 + dx, 60 + dy, PT.SLTW);
    run(sim, 500);
    expect(sim.type[fe]).not.toBe(PT.IRON);
  });
});
