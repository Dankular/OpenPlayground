/* Game of Life engine (Simulation::SimulateGoL, SimulationData::builtinGol, LIFE.cpp create) and the LOVE / LOLZ pattern growth
 * from Simulation::BeforeSim (LOVE.cpp / LOLZ.cpp rule tables). The Powder Toy, GPL-3.0.
 * Not tracked: per-particle decoration colour (LIFE colours are derived from the ruleset instead, see lifeColour) and the custom
 * GOL registry (SimulationData::GetCustomGOLByRule), so custom rulesets (ctype >= NGOL) render white. */
import { CELL, ID, PT, TYP, WL } from './elements';
import type { PowderSim } from './sim';

export const NGOL = 24;
const rgb = (v: number): [number, number, number] => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
/** name, ruleset, colour1, colour2 (SimulationData.cpp). Ruleset: bits 8..0 stay, 16..9 begin (x-8), 20..17 number of states - 2. */
export const BUILTIN_GOL: { name: string; ruleset: number; colour: number; colour2: number; description: string }[] = [
  ['GOL', 0x0080C, 0x0CAC00, 0x0CAC00, 'Game Of Life: Begin 3/Stay 23'],
  ['HLIF', 0x0480C, 0xFF0000, 0xFF0000, 'High Life: B36/S23'],
  ['ASIM', 0x038F0, 0x0000FF, 0x0000FF, 'Assimilation: B345/S4567'],
  ['2X2', 0x04826, 0xFFFF00, 0xFFFF00, '2X2: B36/S125'],
  ['DANI', 0x1C9D8, 0x00FFFF, 0x00FFFF, 'Day and Night: B3678/S34678'],
  ['AMOE', 0x0A92A, 0xFF00FF, 0xFF00FF, 'Amoeba: B357/S1358'],
  ['MOVE', 0x14834, 0xFFFFFF, 0xFFFFFF, "'Move' particles. Does not move things.. it is a life type: B368/S245"],
  ['PGOL', 0x0A90C, 0xE05010, 0xE05010, 'Pseudo Life: B357/S238'],
  ['DMOE', 0x1E9E0, 0x500000, 0x500000, 'Diamoeba: B35678/S5678'],
  ['3-4', 0x01818, 0x500050, 0x500050, '3-4: B34/S34'],
  ['LLIF', 0x03820, 0x505050, 0x505050, 'Long Life: B345/S5'],
  ['STAN', 0x1C9EC, 0x5000FF, 0x5000FF, 'Stains: B3678/S235678'],
  ['SEED', 0x00400, 0xFBEC7D, 0xFBEC7D, 'Seeds: B2/S'],
  ['MAZE', 0x0083E, 0xA8E4A0, 0xA8E4A0, 'Maze: B3/S12345'],
  ['COAG', 0x189EC, 0x9ACD32, 0x9ACD32, 'Coagulations: B378/S235678'],
  ['WALL', 0x1F03C, 0x0047AB, 0x0047AB, 'Walled cities: B45678/S2345'],
  ['GNAR', 0x00202, 0xE5B73B, 0xE5B73B, 'Gnarl: B1/S1'],
  ['REPL', 0x0AAAA, 0x259588, 0x259588, 'Replicator: B1357/S1357'],
  ['MYST', 0x139E1, 0x0C3C00, 0x0C3C00, 'Mystery: B3458/S05678'],
  ['LOTE', 0x48938, 0xFF0000, 0xFFFF00, 'Living on the Edge: B37/S3458/4'],
  ['FRG2', 0x20816, 0x006432, 0x00FF5A, 'Like Frogs rule: B3/S124/3'],
  ['STAR', 0x98478, 0x000040, 0x0000E6, 'Like Star Wars rule: B278/S3456/6'],
  ['FROG', 0x21806, 0x006400, 0x00FF00, 'Frogs: B34/S12/3'],
  ['BRAN', 0x25440, 0xFFFF00, 0x969600, 'Brian 6: B246/S6/3'],
].map(([name, ruleset, colour, colour2, description]) => ({ name, ruleset, colour, colour2, description }) as { name: string; ruleset: number; colour: number; colour2: number; description: string });

/** LIFE.cpp create(): v is the GOL index or a raw ruleset; bit 0x200000 skips the colour lookup. */
export function lifeCreate(s: PowderSim, i: number, _x: number, _y: number, _t: number, v: number): void {
  if (v === -1) v = 0;
  v &= 0x1fffff;
  s.ctype[i] = v;
  if (v < NGOL) { s.tmp[i] = BUILTIN_GOL[v].colour2; v = BUILTIN_GOL[v].ruleset; }
  s.tmp2[i] = ((v >> 17) & 0xf) + 1;
}

/** LIFE.cpp graphics(): colour of one LIFE cell. */
export function lifeColour(s: PowderSim, i: number, out: number[]): void {
  let c1 = rgb(0xffffff), c2 = rgb(s.tmp[i] & 0xffffff), ruleset = s.ctype[i];
  if (ruleset >= 0 && ruleset < NGOL) { c1 = rgb(BUILTIN_GOL[ruleset].colour); c2 = rgb(BUILTIN_GOL[ruleset].colour2); ruleset = BUILTIN_GOL[ruleset].ruleset; }
  const states = ((ruleset >> 17) & 0xf) + 2;
  if (states === 2) { out[0] = c1[0]; out[1] = c1[1]; out[2] = c1[2]; return; }
  const mul = (s.tmp2[i] - 1) / (states - 2);
  for (let k = 0; k < 3; k++) out[k] = Math.trunc(c1[k] * mul + c2[k] * (1 - mul));
}

export function simulateGoL(s: PowderSim): void {
  const XRES = s.XRES, YRES = s.YRES, gol = s.golCells;
  s.cgol = 0;
  for (let i = 0; i < s.active; i++) {
    if (s.type[i] !== PT.LIFE) continue;
    const x = (s.x[i] + 0.5) | 0, y = (s.y[i] + 0.5) | 0;
    if (x < CELL || y < CELL || x >= XRES - CELL || y >= YRES - CELL) continue;
    let golnum = s.ctype[i] >>> 0, ruleset = golnum;
    if (golnum < NGOL) { ruleset = BUILTIN_GOL[golnum].ruleset; golnum += 1; }
    if (s.tmp2[i] === ((ruleset >>> 17) & 0xf) + 1) {
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
        if (!xx && !yy) continue;
        // the GOL space is 2 cells narrower than the simulation area in both dimensions, hence the odd wraparound
        const ax = ((x + xx + XRES - 3 * CELL) % (XRES - 2 * CELL)) + CELL, ay = ((y + yy + YRES - 3 * CELL) % (YRES - 2 * CELL)) + CELL;
        const pk = s.pmap[ay * XRES + ax];
        if (pk && TYP(pk) !== PT.LIFE) continue;
        const base = (ay * XRES + ax) * 5;
        gol[base] += 1 << 28;
        for (let l = 0; l < 5; l++) {
          const nr = gol[base + l] & 0x1fffff;
          if (nr === golnum) { gol[base + l] += 1 << 21; break; }
          if (nr === 0) { gol[base + l] = ((yy & 3) << 26) | ((xx & 3) << 24) | golnum; break; }
        }
      }
    } else if (!(s.bmap[s.cell(x, y)] === WL.STASIS && s.emap[s.cell(x, y)] < 8)) s.tmp2[i] -= 1;
  }
  for (let y = CELL; y < YRES - CELL; y++) for (let x = CELL; x < XRES - CELL; x++) {
    const r = s.pmap[y * XRES + x];
    if (r && TYP(r) !== PT.LIFE) continue;
    const base = (y * XRES + x) * 5, nl0 = gol[base];
    if (!(r || nl0)) continue;
    const neighbours = nl0 ? ((nl0 >>> 28) & 7) + 1 : 0;
    if (!(s.bmap[s.cell(x, y)] === WL.STASIS && s.emap[s.cell(x, y)] < 8)) {
      if (r) {
        const pid = ID(r);
        let ruleset = s.ctype[pid] >>> 0;
        if (ruleset < NGOL) ruleset = BUILTIN_GOL[ruleset].ruleset;
        if (!((ruleset >>> neighbours) & 1) && s.tmp2[pid] === (ruleset >>> 17) + 1) s.tmp2[pid] -= 1; // start death sequence
      } else {
        let toCreate = 0xffffffff, fromEntry = 0;
        const majority = Math.trunc(neighbours / 2) + (neighbours % 2);
        for (let l = 0; l < 5; l++) {
          let golnum = gol[base + l] & 0x1fffff;
          if (!golnum) break;
          let ruleset = golnum;
          if (golnum - 1 < NGOL) { ruleset = BUILTIN_GOL[golnum - 1].ruleset; golnum -= 1; }
          if (((ruleset >>> (neighbours + 8)) & 1) && ((gol[base + l] >>> 21) & 7) + 1 >= majority && golnum < toCreate) { toCreate = golnum; fromEntry = gol[base + l]; }
        }
        if (toCreate !== 0xffffffff) {
          const i = s.createPart(-1, x, y, PT.LIFE, toCreate | 0x200000);
          if (i >= 0) {
            let xx = (fromEntry >>> 24) & 3, yy = (fromEntry >>> 26) & 3;
            if (xx === 3) xx = -1;
            if (yy === 3) yy = -1;
            const ax = ((x - xx + XRES - 3 * CELL) % (XRES - 2 * CELL)) + CELL, ay = ((y - yy + YRES - 3 * CELL) % (YRES - 2 * CELL)) + CELL;
            s.tmp[i] = s.tmp[ID(s.pmap[ay * XRES + ax])];
          }
        }
      }
    }
    for (let l = 0; l < 5 && gol[base + l]; l++) gol[base + l] = 0;
  }
  for (let y = CELL; y < YRES - CELL; y++) for (let x = CELL; x < XRES - CELL; x++) {
    const r = s.pmap[y * XRES + x];
    if (r && TYP(r) === PT.LIFE && s.tmp2[ID(r)] <= 0) s.killPart(ID(r));
  }
}

const LOVE_RULES = [
  [0, 0, 1, 1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 1, 1, 0, 0, 0], [1, 0, 0, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 0, 0, 0, 1, 0], [0, 1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0, 1, 0, 0], [0, 1, 0, 0, 1, 1, 0, 0, 0], [0, 0, 1, 1, 0, 0, 0, 0, 0],
];
const LOLZ_RULES = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 1, 0, 0], [1, 0, 0, 0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0, 0, 1, 0], [1, 0, 1, 0, 0, 1, 0, 1, 0],
  [1, 0, 1, 0, 0, 1, 0, 1, 0], [0, 1, 0, 1, 1, 0, 0, 1, 0], [0, 1, 0, 0, 0, 0, 0, 1, 0], [0, 1, 0, 0, 0, 0, 0, 1, 0],
];

/** LOVE and LOLZ element handling from Simulation::BeforeSim. */
export function growLoveLolz(s: PowderSim): void {
  const XRES = s.XRES, YRES = s.YRES, bw = Math.trunc(XRES / 9) + 1, love = s.loveGrid, lolz = s.lolzGrid;
  for (let ny = 0; ny < YRES - 4; ny++) for (let nx = 0; nx < XRES - 4; nx++) {
    const r = s.pmap[ny * XRES + nx];
    if (!r) continue;
    const t = s.type[ID(r)];
    if ((ny < 9 || nx < 9 || ny > YRES - 7 || nx > XRES - 10) && (t === PT.LOVE || t === PT.LOLZ)) s.killPart(ID(r));
    else if (t === PT.LOVE) love[Math.trunc(nx / 9) * bw + Math.trunc(ny / 9)] = 1;
    else if (t === PT.LOLZ) lolz[Math.trunc(nx / 9) * bw + Math.trunc(ny / 9)] = 1;
  }
  for (let nx = 9; nx <= XRES - 18; nx++) for (let ny = 9; ny <= YRES - 7; ny++) {
    const g = Math.trunc(nx / 9) * bw + Math.trunc(ny / 9);
    if (love[g] === 1) {
      for (let nnx = 0; nnx < 9; nnx++) for (let nny = 0; nny < 9; nny++) {
        if (ny + nny > 0 && ny + nny < YRES && nx + nnx >= 0 && nx + nnx < XRES) {
          const rt = s.pmap[(ny + nny) * XRES + nx + nnx];
          if (!rt && LOVE_RULES[nnx][nny] === 1) s.createPart(-1, nx + nnx, ny + nny, PT.LOVE);
          else if (!rt) continue;
          else if (s.type[ID(rt)] === PT.LOVE && LOVE_RULES[nnx][nny] === 0) s.killPart(ID(rt));
        }
      }
    }
    love[g] = 0;
    if (lolz[g] === 1) {
      for (let nnx = 0; nnx < 9; nnx++) for (let nny = 0; nny < 9; nny++) {
        if (ny + nny > 0 && ny + nny < YRES && nx + nnx >= 0 && nx + nnx < XRES) {
          const rt = s.pmap[(ny + nny) * XRES + nx + nnx];
          if (!rt && LOLZ_RULES[nny][nnx] === 1) s.createPart(-1, nx + nnx, ny + nny, PT.LOLZ);
          else if (!rt) continue;
          else if (s.type[ID(rt)] === PT.LOLZ && LOLZ_RULES[nny][nnx] === 0) s.killPart(ID(rt));
        }
      }
    }
    lolz[g] = 0;
  }
}
