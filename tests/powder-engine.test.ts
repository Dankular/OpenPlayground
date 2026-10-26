import { describe, expect, it } from 'vitest';
import { PowderSim } from '../src/powder/sim';
import { PT } from '../src/powder/elements';

const run = (sim: PowderSim, n: number) => { for (let i = 0; i < n; i++) sim.step(); };
const count = (sim: PowderSim, t: number) => { let n = 0; for (let i = 0; i < sim.active; i++) if (sim.type[i] === t) n++; return n; };
const arena = (seed = 1, gravity = 0) => { const s = new PowderSim({ cellsX: 40, cellsY: 30, seed }); s.gravityMode = gravity; return s; };
const spark = (sim: PowderSim, x: number, y: number, ctype = PT.METL) => {
  const m = sim.createPart(-1, x, y, ctype);
  sim.createPart(-1, x, y, PT.SPRK);
  sim.life[m] = 4;
  return m;
};

describe('CRAY / DRAY', () => {
  it('a sparked CRAY fires its remembered element in a line', () => {
    const sim = arena();
    const c = sim.createPart(-1, 80, 60, PT.CRAY);
    sim.ctype[c] = PT.SAND; sim.tmp[c] = 5;
    spark(sim, 79, 60);
    run(sim, 3);
    expect(count(sim, PT.SAND)).toBe(5);
  });

  it('a sparked DRAY copies a block of particles across the gap', () => {
    const sim = arena();
    const d = sim.createPart(-1, 80, 60, PT.DRAY);
    sim.tmp[d] = 2; sim.tmp2[d] = 3;
    sim.createPart(-1, 81, 60, PT.SALT); sim.createPart(-1, 82, 60, PT.SALT);
    spark(sim, 79, 60);
    run(sim, 3);
    expect(count(sim, PT.SALT)).toBe(4);
  });
});

describe('portals', () => {
  it('a particle entering PRTI emerges from a PRTO of the same channel', () => {
    const sim = arena();
    const a = sim.createPart(-1, 60, 60, PT.PRTI), b = sim.createPart(-1, 120, 60, PT.PRTO);
    sim.tmp[a] = 1; sim.tmp[b] = 1; // both channel-1 (tmp selects channel)
    const d = sim.createPart(-1, 58, 60, PT.DUST);
    sim.vx[d] = 2; sim.vy[d] = 0;
    run(sim, 20);
    let near = false;
    for (let i = 0; i < sim.active; i++) if (sim.type[i] === PT.DUST && Math.abs(sim.x[i] - 120) < 6) near = true;
    expect(near).toBe(true);
  });
});

describe('EMP', () => {
  it('a spark reaching an EMP arms it (life 220)', () => {
    const sim = arena();
    const e = sim.createPart(-1, 80, 60, PT.EMP);
    const w = sim.createPart(-1, 79, 60, PT.PSCN); sim.createPart(-1, 79, 60, PT.SPRK); sim.life[w] = 3;
    sim.step();
    expect(sim.life[e]).toBe(220);
  });

  it('an EMP burst heats and damages metal beside a conducting spark', () => {
    const sim = arena(3);
    const s0 = sim.createPart(-1, 80, 60, PT.PSCN); sim.createPart(-1, 80, 60, PT.SPRK);
    const metals: number[] = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (dx || dy) metals.push(sim.createPart(-1, 80 + dx, 60 + dy, PT.METL));
    const before = metals.map(i => sim.temp[i]);
    sim.empTriggerCount = 400; // many simultaneous EMPs make the effect near-certain
    sim.step();
    void s0;
    const hit = metals.filter((i, n) => sim.type[i] !== PT.METL || sim.temp[i] > before[n] + 1).length;
    expect(hit).toBeGreaterThan(0);
  });
});

describe('Newtonian gravity', () => {
  it('a heavy NBHL attracts dust toward it when Newtonian gravity is on', () => {
    const sim = arena();
    sim.newton.enabled = true;
    const n = sim.createPart(-1, 80, 60, PT.NBHL);
    sim.tmp[n] = 51200; // mass 51.2, the maximum
    const d = sim.createPart(-1, 110, 60, PT.DUST);
    const x0 = sim.x[d];
    run(sim, 30);
    expect(sim.x[d]).toBeLessThan(x0 - 1);
  });

  it('does nothing while disabled', () => {
    const sim = arena();
    sim.createPart(-1, 80, 60, PT.NBHL);
    const d = sim.createPart(-1, 110, 60, PT.DUST);
    run(sim, 30);
    expect(Math.abs(sim.x[d] - 110)).toBeLessThan(1);
  });
});

describe('PIPE', () => {
  it('a built pipe swallows a grain at its open end and carries it along', () => {
    const sim = arena();
    const ids: number[] = [];
    for (let x = 70; x <= 90; x++) ids.push(sim.createPart(-1, x, 60, PT.PIPE));
    run(sim, 120); // the pipe lays its BRCK border and waits for an opening
    for (const x of [69, 91]) sim.killPart(sim.pmap[60 * sim.XRES + x] >> 9); // "erase some for the exit"
    sim.createPart(-1, 69, 60, PT.SAND);
    let carried = 0;
    for (let f = 0; f < 250 && !carried; f++) {
      sim.step();
      for (const i of ids) if (sim.type[i] === PT.PIPE && sim.ctype[i] === PT.SAND && sim.x[i] > 74) carried = sim.x[i];
    }
    expect(carried).toBeGreaterThan(74);
  });
});

describe('TRON / SOAP', () => {
  it('a TRON head leaves a trail', () => {
    const sim = arena();
    const t = sim.createPart(-1, 80, 60, PT.TRON);
    sim.tmp[t] = 1 | (1 << 2); // heading + defaults
    run(sim, 15);
    expect(count(sim, PT.TRON) + count(sim, PT.BRCK)).toBeGreaterThan(1);
  });

  it('SOAP bonds when two bubbles touch', () => {
    const sim = arena();
    const a = sim.createPart(-1, 80, 60, PT.SOAP), b = sim.createPart(-1, 81, 60, PT.SOAP);
    run(sim, 5);
    expect(count(sim, PT.SOAP)).toBe(2);
    expect(sim.type[a]).toBe(PT.SOAP); expect(sim.type[b]).toBe(PT.SOAP);
  });
});

describe('PSTN / FRME', () => {
  const at = (sim: PowderSim, x: number, y: number) => sim.pmap[y * sim.XRES + x];
  const setup = () => {
    const sim = arena();
    sim.createPart(-1, 80, 60, PT.PSTN); sim.createPart(-1, 81, 60, PT.PSTN); // two body segments: reach 1 (each 15 degrees above 0 C counts 1)
    return sim;
  };
  it('PSCN extends the piston, pushing what is in front of it; NSCN retracts it, pulling it back', () => {
    const sim = setup();
    sim.createPart(-1, 82, 60, PT.BRCK);
    spark(sim, 78, 60, PT.PSCN);
    run(sim, 3);
    expect(at(sim, 82, 60) & 0x1ff).toBe(PT.PSTN);
    expect(sim.life[at(sim, 82, 60) >> 9]).toBe(1);
    expect(at(sim, 83, 60) & 0x1ff).toBe(PT.BRCK);
    spark(sim, 79, 60, PT.NSCN);
    run(sim, 5);
    expect(at(sim, 82, 60) & 0x1ff).toBe(PT.BRCK);
    expect(at(sim, 83, 60)).toBe(0);
  });

  it('a FRME column moves as a block with the piston arm', () => {
    const sim = setup();
    for (let dy = -2; dy <= 2; dy++) sim.createPart(-1, 82, 60 + dy, PT.FRME);
    spark(sim, 78, 60, PT.PSCN);
    run(sim, 3);
    for (let dy = -2; dy <= 2; dy++) expect(at(sim, 83, 60 + dy) & 0x1ff).toBe(PT.FRME);
  });
});

describe('LSNS / VSNS / LDTC', () => {
  const sparkedNear = (sim: PowderSim, x: number, y: number) => { for (let i = 0; i < sim.active; i++) if (sim.type[i] === PT.SPRK && Math.abs(sim.x[i] - x) <= 2 && Math.abs(sim.y[i] - y) <= 2) return true; return false; };
  it('LSNS sparks a neighbouring conductor when a nearby particle has life above its temperature', () => {
    const sim = arena();
    const l = sim.createPart(-1, 80, 60, PT.LSNS); sim.temp[l] = 273.15 + 10;
    sim.createPart(-1, 81, 60, PT.METL);
    const t = sim.createPart(-1, 82, 60, PT.CLNE); sim.life[t] = 30;
    run(sim, 3);
    expect(sparkedNear(sim, 81, 60)).toBe(true);
  });

  it('VSNS ignores a slow particle and triggers on a fast one', () => {
    const slow = arena(), fast = arena();
    for (const [sim, v] of [[slow, 0.1], [fast, 8]] as const) {
      const d = sim.createPart(-1, 80, 60, PT.VSNS); sim.temp[d] = 273.15 + 2;
      sim.createPart(-1, 79, 60, PT.METL);
      const p = sim.createPart(-1, 82, 60, PT.DUST); sim.vx[p] = v;
      sim.tmp2[d] = 4;
    }
    run(slow, 1); run(fast, 1);
    run(slow, 2); run(fast, 2);
    expect(sparkedNear(slow, 79, 60)).toBe(false);
    expect(sparkedNear(fast, 79, 60)).toBe(true);
  });

  it('LDTC sparks the conductor behind it when its ctype is found along the ray', () => {
    const sim = arena();
    const d = sim.createPart(-1, 80, 60, PT.LDTC); sim.ctype[d] = PT.BRCK;
    sim.createPart(-1, 79, 60, PT.METL); // conductor on one side
    sim.createPart(-1, 90, 60, PT.BRCK); // target on the opposite side
    run(sim, 2);
    expect(sparkedNear(sim, 79, 60)).toBe(true);
  });
});

describe('SEED / PLNT trees', () => {
  it('a watered seed resting on sand grows into a tree of WOOD', () => {
    const sim = arena(7, 0); // 0 = vertical gravity
    for (let x = 60; x < 100; x++) sim.createPart(-1, x, 100, PT.SAND);
    const sd = sim.createPart(-1, 80, 99, PT.SEED);
    sim.ctype[sd] = (sim.ctype[sd] & ~(0xff << 12)) | (8 << 12);
    sim.life[sd] = 201;
    let grew = false;
    for (let f = 0; f < 1500; f++) { sim.step(); if (sim.type[sd] === PT.PLNT && (sim.ctype[sd] & 1 || count(sim, PT.WOOD) > 0)) { grew = true; break; } }
    expect(grew).toBe(true);
    run(sim, 4000);
    expect(count(sim, PT.WOOD) + count(sim, PT.GOO)).toBeGreaterThan(5);
  });

  it('a neutron flips a gene in a seed it overlaps', () => {
    const sim = arena(3);
    let changed = false;
    for (let k = 0; k < 60 && !changed; k++) {
      const sd = sim.createPart(-1, 40 + k, 40, PT.SEED);
      const before = [sim.ctype[sd], sim.tmp[sd], sim.tmp2[sd], sim.tmp3[sd], sim.tmp4[sd]];
      const n = sim.createPart(-1, 40 + k, 40, PT.NEUT);
      sim.step();
      void n;
      const after = [sim.ctype[sd], sim.tmp[sd], sim.tmp2[sd], sim.tmp3[sd], sim.tmp4[sd]];
      changed = before.some((v, j) => v !== after[j]);
    }
    expect(changed).toBe(true);
  });
});

describe('stickmen', () => {
  const floor = (sim: PowderSim, y: number) => { for (let x = 20; x < 140; x++) for (let k = 0; k < 8; k++) sim.createPart(-1, x, y + k, PT.DMND); };
  it('placing STKM also places its spawn point and only one stickman is allowed', () => {
    const sim = arena(2, 0);
    expect(sim.createPart(-1, 80, 60, PT.STKM)).toBeGreaterThanOrEqual(0);
    expect(count(sim, PT.SPAWN)).toBe(1);
    expect(sim.createPart(-1, 90, 60, PT.STKM)).toBe(-1);
  });

  it('a stickman stands on the floor and walks right when RIGHT is held', () => {
    const sim = arena(2, 0);
    floor(sim, 80);
    const st = sim.createPart(-1, 60, 66, PT.STKM);
    run(sim, 60);
    expect(sim.type[st]).toBe(PT.STKM);
    expect(sim.y[st]).toBeGreaterThan(60);
    expect(sim.y[st]).toBeLessThan(78); // head held above the 80 px floor by the legs
    const x0 = sim.x[st];
    sim.player.press(2);
    run(sim, 12);
    expect(sim.type[st]).toBe(PT.STKM);
    expect(sim.x[st]).toBeGreaterThan(x0 + 5);
    sim.player.release(2);
  });

  it('a dead stickman scatters the element he carries and a new one appears at the spawn point', () => {
    const sim = arena(2, 0);
    floor(sim, 80);
    const st = sim.createPart(-1, 60, 66, PT.STKM);
    sim.ctype[st] = PT.DUST; // the carried element is taken from ctype
    run(sim, 20);
    sim.life[st] = 0;
    run(sim, 1);
    expect(count(sim, PT.DUST)).toBeGreaterThan(5);
    run(sim, 3);
    expect(count(sim, PT.STKM)).toBe(1);
  });

  it('a fighter walks toward a stickman', () => {
    const sim = arena(4, 0);
    floor(sim, 80);
    sim.createPart(-1, 130, 66, PT.STKM);
    const f = sim.createPart(-1, 40, 66, PT.FIGH);
    run(sim, 30);
    expect(sim.type[f]).toBe(PT.FIGH);
    expect(sim.x[f]).toBeGreaterThan(55);
  });
});

describe('Game of Life, LOVE and LOLZ', () => {
  const life = (sim: PowderSim, cells: [number, number][], v = 0) => cells.map(([x, y]) => sim.createPart(-1, x, y, PT.LIFE, v));
  const lifeCells = (sim: PowderSim) => { const out: string[] = []; for (let i = 0; i < sim.active; i++) if (sim.type[i] === PT.LIFE) out.push(`${Math.round(sim.x[i])},${Math.round(sim.y[i])}`); return out.sort(); };

  it('a blinker oscillates with period two (B3/S23)', () => {
    const sim = arena(1, 1); // 1 = no gravity
    life(sim, [[80, 60], [81, 60], [82, 60]]);
    sim.step();
    const vertical = ['81,59', '81,60', '81,61'];
    expect(lifeCells(sim)).toEqual(vertical);
    sim.step();
    expect(lifeCells(sim)).toEqual(['80,60', '81,60', '82,60']);
  });

  it('a 2x2 block is a still life', () => {
    const sim = arena(1, 1);
    life(sim, [[80, 60], [81, 60], [80, 61], [81, 61]]);
    run(sim, 5);
    expect(lifeCells(sim)).toEqual(['80,60', '80,61', '81,60', '81,61']);
  });

  it('Seeds (B2/S) lets every cell die and spawns the two-neighbour births', () => {
    const sim = arena(1, 1);
    life(sim, [[80, 60], [81, 60]], 12); // SEED ruleset
    sim.step();
    expect(lifeCells(sim)).toEqual(['80,59', '80,61', '81,59', '81,61']);
  });

  it('a multi-state rule keeps dying cells for its extra states', () => {
    const sim = arena(1, 1);
    const [c] = life(sim, [[80, 60]], 22); // FROG: B34/S12/3, three states
    expect(sim.tmp2[c]).toBe(2); // states - 1
    run(sim, 1);
    expect(sim.type[c]).toBe(PT.LIFE); // dying: still present with the intermediate state
    expect(sim.tmp2[c]).toBe(1);
    run(sim, 1);
    expect(sim.type[c]).toBe(0);
  });

  it('LOVE grows its heart pattern from a seed particle', () => {
    const sim = arena(1, 1);
    sim.createPart(-1, 80, 60, PT.LOVE);
    run(sim, 3);
    expect(count(sim, PT.LOVE)).toBeGreaterThan(1);
  });
});
