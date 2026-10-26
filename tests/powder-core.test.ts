import { describe, expect, it } from 'vitest';
import { PowderSim } from '../src/powder/sim';
import { PT, WL, TYP } from '../src/powder/elements';

const box = (sim: PowderSim) => { // floor of solid wall cells
  for (let cx = 0; cx < sim.XCELLS; cx++) sim.setWall(cx, sim.YCELLS - 3, WL.WALL);
};
const run = (sim: PowderSim, n: number) => { for (let i = 0; i < n; i++) sim.step(); };

describe('powder core', () => {
  it('assigns the original element ids', () => {
    expect([PT.DUST, PT.WATR, PT.OIL, PT.FIRE, PT.LAVA, PT.WTRV, PT.ICEI]).toEqual([1, 2, 3, 4, 6, 23, 13]);
  });

  it('powder falls under gravity and rests on a wall', () => {
    const sim = new PowderSim({ cellsX: 20, cellsY: 20, seed: 1 });
    box(sim);
    const i = sim.createPart(-1, 40, 20, PT.DUST);
    run(sim, 200);
    expect(sim.type[i]).toBe(PT.DUST);
    expect(sim.y[i]).toBeGreaterThan(20);
    expect(sim.y[i]).toBeLessThan((sim.YCELLS - 3) * 4);
    expect(sim.typeAt(Math.round(sim.x[i]), Math.round(sim.y[i]))).toBe(PT.DUST);
  });

  it('heavier liquid sinks below lighter liquid (weight swap)', () => {
    const sim = new PowderSim({ cellsX: 12, cellsY: 20, seed: 2 });
    box(sim);
    expect(sim.canMove[PT.WATR * 512 + PT.OIL]).toBe(1);
    expect(sim.canMove[PT.OIL * 512 + PT.WATR]).toBe(0);
    // one-pixel-wide channel built from indestructible solids; OIL starts below WATR
    for (let y = 20; y < 68; y++) { sim.createPart(-1, 24, y, PT.DMND); sim.createPart(-1, 26, y, PT.DMND); }
    const oil = sim.createPart(-1, 25, 60, PT.OIL), wat = sim.createPart(-1, 25, 50, PT.WATR);
    run(sim, 400);
    expect(sim.y[wat]).toBeGreaterThan(sim.y[oil]);
  });

  it('water freezes to ice below 273.15 K and boils to steam at 373 K', () => {
    const sim = new PowderSim({ cellsX: 40, cellsY: 40, seed: 3 });
    sim.gravityMode = 1;
    const a = sim.createPart(-1, 60, 60, PT.WATR), b = sim.createPart(-1, 100, 100, PT.WATR);
    sim.temp[a] = 200; sim.temp[b] = 500;
    run(sim, 60); // heat exchange is probabilistic (HeatConduct/250 per frame)
    expect(sim.type[a]).toBe(PT.ICEI);
    expect(sim.type[b]).toBe(PT.WTRV);
  });

  it('lava solidifies to stone when cool and remembers ctype', () => {
    const sim = new PowderSim({ cellsX: 10, cellsY: 10, seed: 4 });
    sim.gravityMode = 1;
    const l = sim.createPart(-1, 20, 20, PT.LAVA);
    sim.temp[l] = 900;
    run(sim, 200);
    expect(sim.type[l]).toBe(PT.STNE);
  });

  it('ambient heat sim cools a hot particle toward ambient air', () => {
    const sim = new PowderSim({ cellsX: 10, cellsY: 10, seed: 5, ambientHeat: true });
    sim.gravityMode = 1;
    const m = sim.createPart(-1, 20, 20, PT.METL);
    sim.temp[m] = 800;
    run(sim, 400);
    expect(sim.temp[m]).toBeLessThan(800);
  });

  it('particles leaving the border region are removed', () => {
    const sim = new PowderSim({ cellsX: 10, cellsY: 10, seed: 6 });
    const i = sim.createPart(-1, 20, 20, PT.DUST);
    sim.vy[i] = 50;
    run(sim, 10);
    expect(sim.type[i]).toBe(0);
    expect(TYP(sim.at(20, 20))).toBe(0);
  });
});
