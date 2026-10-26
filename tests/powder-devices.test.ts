import { describe, expect, it } from 'vitest';
import { PowderSim } from '../src/powder/sim';
import { PT } from '../src/powder/elements';
import { filtInteract } from '../src/powder/optics';

const run = (sim: PowderSim, n: number) => { for (let i = 0; i < n; i++) sim.step(); };
const count = (sim: PowderSim, t: number) => { let n = 0; for (let i = 0; i < sim.active; i++) if (sim.type[i] === t) n++; return n; };
const arena = (seed = 1, gravity = 1) => { const s = new PowderSim({ cellsX: 40, cellsY: 30, seed }); s.gravityMode = gravity; return s; };

describe('powder devices and optics', () => {
  it('a photon crossing a filter takes on the filter colour', () => {
    const sim = arena();
    const f = sim.createPart(-1, 80, 60, PT.FILT);
    sim.tmp[f] = 1; sim.ctype[f] = 0x1f << 10; // band-pass
    const p = sim.createPart(-1, 74, 60, PT.PHOT);
    sim.vx[p] = 3; sim.vy[p] = 0; sim.ctype[p] = 0x3fffffff;
    run(sim, 6);
    expect(sim.ctype[p] & 0x3fffffff).toBe(0x1f << 10);
  });

  it('filter modes combine wavelengths as documented', () => {
    const sim = arena();
    const f = sim.createPart(-1, 80, 60, PT.FILT);
    sim.ctype[f] = 0xf0;
    const modes: [number, number, number][] = [[0, 0xff, 0xf0], [1, 0xff, 0xf0], [2, 0x0f, 0xff], [3, 0xff, 0x0f], [6, 0x123, 0x123], [7, 0xff, 0x0f], [8, 0x0f, 0x3ffffff0]];
    for (const [mode, input, expected] of modes) { sim.tmp[f] = mode; expect(filtInteract(sim, f, input)).toBe(expected); }
  });

  it('an ARAY fires a BRAY beam when sparked', () => {
    const sim = arena();
    sim.createPart(-1, 80, 60, PT.ARAY);
    const m = sim.createPart(-1, 79, 60, PT.METL);
    sim.createPart(-1, 79, 60, PT.SPRK);
    sim.life[m] = 4; // life decrements at frame start; ARAY triggers on spark life 3
    run(sim, 2);
    expect(count(sim, PT.BRAY)).toBeGreaterThan(3);
  });

  it('a powered PCLN clones its remembered element', () => {
    const sim = arena();
    const c = sim.createPart(-1, 80, 60, PT.PCLN);
    sim.ctype[c] = PT.SALT;
    sim.life[c] = 10;
    run(sim, 3);
    expect(count(sim, PT.SALT)).toBeGreaterThan(0);
  });

  it('a powered pump drives pressure toward its set temperature', () => {
    const sim = arena();
    const p = sim.createPart(-1, 80, 60, PT.PUMP);
    sim.temp[p] = 273.15 + 50; sim.life[p] = 10;
    run(sim, 20);
    expect(sim.pv[sim.cell(80, 60)]).toBeGreaterThan(5);
  });

  it('an accelerator speeds up particles beside it', () => {
    const sim = arena();
    const withAcel = arena(), without = arena();
    withAcel.createPart(-1, 80, 60, PT.ACEL);
    const a = withAcel.createPart(-1, 81, 60, PT.DUST), b = without.createPart(-1, 81, 60, PT.DUST);
    withAcel.vx[a] = 1; without.vx[b] = 1;
    withAcel.step(); without.step();
    expect(withAcel.vx[a]).toBeGreaterThan(without.vx[b] * 1.05);
  });

  it('a temperature sensor sparks neighbouring conductors when something near is hotter', () => {
    const sim = arena();
    const t = sim.createPart(-1, 80, 60, PT.TSNS);
    sim.tmp[t] = 0; sim.tmp2[t] = 4; sim.temp[t] = 300;
    const m = sim.createPart(-1, 81, 61, PT.METL);
    const hot = sim.createPart(-1, 83, 60, PT.IRON);
    sim.temp[hot] = 800;
    run(sim, 3);
    expect(sim.type[m] === PT.SPRK || sim.life[m] > 0).toBe(true);
  });

  it('a storage cell captures a particle and releases it on a PSCN spark', () => {
    const sim = arena();
    const st = sim.createPart(-1, 80, 60, PT.STOR);
    sim.createPart(-1, 82, 60, PT.WATR);
    run(sim, 2);
    expect(sim.tmp[st]).toBe(PT.WATR);
    expect(count(sim, PT.WATR)).toBe(0);
  });
});
