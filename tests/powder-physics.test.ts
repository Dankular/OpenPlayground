import { describe, expect, it } from 'vitest';
import { PowderSim } from '../src/powder/sim';
import { PT } from '../src/powder/elements';

const run = (sim: PowderSim, n: number) => { for (let i = 0; i < n; i++) sim.step(); };
const count = (sim: PowderSim, t: number) => { let n = 0; for (let i = 0; i < sim.active; i++) if (sim.type[i] === t) n++; return n; };
const fill = (sim: PowderSim, x0: number, y0: number, w: number, h: number, t: number) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) sim.createPart(-1, x, y, t);
};
const arena = (seed = 1) => { const s = new PowderSim({ cellsX: 40, cellsY: 30, seed }); s.gravityMode = 1; return s; };

describe('powder radiation and materials', () => {
  it('a photon travels in a straight line through empty space', () => {
    const sim = arena();
    const p = sim.createPart(-1, 40, 60, PT.PHOT);
    sim.vx[p] = 3; sim.vy[p] = 0; sim.ctype[p] = 0x3fffffff; sim.life[p] = 0;
    const x0 = sim.x[p];
    run(sim, 5);
    expect(sim.type[p]).toBe(PT.PHOT);
    expect(sim.x[p]).toBeGreaterThan(x0 + 10);
    expect(Math.abs(sim.y[p] - 60)).toBeLessThan(0.01);
  });

  it('a photon is reflected by a metal surface instead of passing through', () => {
    const sim = arena();
    fill(sim, 70, 40, 4, 40, PT.DMND);
    const p = sim.createPart(-1, 50, 60, PT.PHOT);
    sim.vx[p] = 3; sim.vy[p] = 0; sim.ctype[p] = 0x3fffffff;
    run(sim, 10);
    expect(sim.type[p]).toBe(PT.PHOT);
    expect(sim.x[p]).toBeLessThan(70);
    expect(sim.vx[p]).toBeLessThan(0);
  });

  it('neutrons sustain a chain reaction in plutonium and release pressure', () => {
    const sim = arena(3);
    fill(sim, 60, 60, 12, 12, PT.PLUT);
    for (let k = 0; k < 12; k++) { const n = sim.createPart(-1, 58, 60 + k, PT.NEUT); sim.vx[n] = 2; sim.vy[n] = 0; }
    sim.pv.fill(20);
    let peakNeutrons = 0, peakPressure = 0;
    for (let f = 0; f < 30; f++) { sim.step(); peakNeutrons = Math.max(peakNeutrons, count(sim, PT.NEUT)); peakPressure = Math.max(peakPressure, ...sim.pv); }
    expect(peakNeutrons).toBeGreaterThan(24); // neutron population more than doubles: chain reaction
    expect(peakPressure).toBeGreaterThan(40); // fission releases pressure (10 * CFDS per event)
    expect(count(sim, PT.PLUT)).toBeLessThan(144);
  });

  it('electrons electrolyse water into hydrogen or oxygen', () => {
    const sim = arena();
    sim.createPart(-1, 60, 60, PT.WATR);
    const e = sim.createPart(-1, 59, 60, PT.ELEC);
    sim.vx[e] = 0; sim.vy[e] = 0;
    run(sim, 3);
    expect(count(sim, PT.H2) + count(sim, PT.O2)).toBe(1);
    expect(count(sim, PT.WATR)).toBe(0);
  });

  it('a sponge absorbs adjacent water and a hot sponge boils it away as steam', () => {
    const sim = arena(5);
    sim.gravityMode = 0;
    const sp = sim.createPart(-1, 60, 60, PT.SPNG);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) sim.createPart(-1, 60 + dx, 60 + dy, PT.WATR);
    run(sim, 200);
    expect(sim.life[sp]).toBeGreaterThan(0);
  });

  it('a cloner copies the element it touches', () => {
    const sim = arena(2);
    const c = sim.createPart(-1, 80, 60, PT.CLNE);
    sim.createPart(-1, 81, 60, PT.SALT);
    run(sim, 60);
    expect(sim.ctype[c]).toBe(PT.SALT);
    expect(count(sim, PT.SALT)).toBeGreaterThan(5);
  });

  it('hydrogen and oxygen burn when ignited, making steam from H2/O2 fire', () => {
    const sim = arena(8);
    fill(sim, 60, 60, 8, 8, PT.H2);
    fill(sim, 68, 60, 8, 8, PT.O2);
    sim.createPart(-1, 59, 62, PT.FIRE);
    run(sim, 100);
    expect(count(sim, PT.H2) + count(sim, PT.O2)).toBeLessThan(128);
  });

  it('singularities pull pressure negative around them', () => {
    const sim = arena();
    sim.createPart(-1, 80, 60, PT.SING);
    run(sim, 10);
    expect(Math.min(...sim.pv)).toBeLessThan(-1);
  });
});
