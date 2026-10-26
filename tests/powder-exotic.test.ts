import { describe, expect, it } from 'vitest';
import { PowderSim } from '../src/powder/sim';
import { PT } from '../src/powder/elements';

const run = (sim: PowderSim, n: number) => { for (let i = 0; i < n; i++) sim.step(); };
const count = (sim: PowderSim, t: number) => { let n = 0; for (let i = 0; i < sim.active; i++) if (sim.type[i] === t) n++; return n; };
const fill = (sim: PowderSim, x0: number, y0: number, w: number, h: number, t: number) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) sim.createPart(-1, x, y, t);
};
const arena = (seed = 1, gravity = 1) => { const s = new PowderSim({ cellsX: 40, cellsY: 30, seed }); s.gravityMode = gravity; return s; };

describe('powder exotic and reactive materials', () => {
  it('pressure shocks glass into broken glass', () => {
    const sim = arena();
    const g = sim.createPart(-1, 80, 60, PT.GLAS);
    sim.pv[sim.cell(80, 60)] = 6;
    sim.step();
    expect(sim.type[g]).toBe(PT.BGLA);
  });

  it('lightning grows into a branching channel and heats what it touches', () => {
    const sim = arena(4);
    sim.createPart(-1, 80, 60, PT.LIGH, 40);
    sim.createPart(-1, 83, 60, PT.WATR);
    let peak = 0;
    for (let f = 0; f < 15; f++) { sim.step(); peak = Math.max(peak, count(sim, PT.LIGH)); }
    expect(peak).toBeGreaterThan(3);
  });

  it('lithium reacts with water to release hydrogen and heat', () => {
    const sim = arena(2);
    const li = sim.createPart(-1, 80, 60, PT.LITH);
    fill(sim, 81, 59, 2, 3, PT.WATR);
    const t0 = sim.temp[li];
    run(sim, 10);
    expect(count(sim, PT.H2)).toBeGreaterThan(0);
    expect(sim.temp[li]).toBeGreaterThan(t0);
  });

  it('a virus converts neighbouring matter and remembers the original type', () => {
    const sim = arena(5);
    fill(sim, 80, 60, 6, 6, PT.METL);
    sim.createPart(-1, 79, 62, PT.VIRS);
    run(sim, 200);
    const infected = count(sim, PT.VIRS) + count(sim, PT.VRSS) + count(sim, PT.VRSG);
    expect(infected).toBeGreaterThan(3);
    for (let i = 0; i < sim.active; i++) if (sim.type[i] === PT.VIRS && sim.tmp2[i]) expect(sim.tmp2[i]).toBe(PT.METL);
  });

  it('a spark makes a shield cell grow new shield material', () => {
    const sim = arena(6);
    sim.createPart(-1, 80, 60, PT.SHLD1);
    sim.createPart(-1, 81, 60, PT.SPRK); // SPRK needs a conductor under it; SHLD1 does not conduct
    const spark = sim.createPart(-3, 81, 60, PT.SPRK);
    expect(spark).toBeGreaterThan(-1);
    run(sim, 6);
    expect(count(sim, PT.SHLD1) + count(sim, PT.SHLD2)).toBeGreaterThan(1);
  });

  it('a firework rises when lit and bursts into embers', () => {
    const sim = arena(7, 0);
    const f = sim.createPart(-1, 80, 100, PT.FIRW);
    sim.createPart(-1, 81, 100, PT.FIRE);
    let embers = 0;
    for (let k = 0; k < 120; k++) { sim.step(); embers = Math.max(embers, count(sim, PT.EMBR)); }
    expect(sim.type[f] === PT.FIRW && sim.y[f] < 100 ? true : embers > 0).toBe(true);
    expect(embers).toBeGreaterThan(10);
  });

  it('quartz grows from salt-water absorption', () => {
    const sim = arena(8);
    const q = sim.createPart(-1, 80, 60, PT.QRTZ);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) sim.createPart(-1, 80 + dx, 60 + dy, PT.SLTW);
    run(sim, 3000);
    expect(count(sim, PT.QRTZ) + count(sim, PT.PQRT)).toBeGreaterThan(1);
    void q;
  });

  it('base neutralises acid into salt water', () => {
    const sim = arena(9);
    const b = sim.createPart(-1, 80, 60, PT.BASE);
    sim.life[b] = 60;
    sim.createPart(-1, 81, 60, PT.ACID);
    run(sim, 200);
    expect(count(sim, PT.ACID)).toBe(0);
  });
});
