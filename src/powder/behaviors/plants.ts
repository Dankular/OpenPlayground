/* SEED and the tree-growth branch of PLNT (SEED.cpp, PLNT.cpp, PLNT.h; The Powder Toy, GPL-3.0).
 * ctype layout: bit 0 growth flag, bits 1-2 phase, 3-5 direction, 6-11 colour genes, 12-19 water/life counter. */
import { ID, PT, TYP } from '../elements';
import type { PowderSim } from '../sim';

type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
export const PLNT_PHASE = 1, PLNT_DIR = 3, PLNT_COLOUR = 6, PLNT_LIFE = 12, PLNT_TOTAL_TMP = 15;
export const DIR3X3: [number, number][] = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];
const INV_DIR = [[1, 2, 3], [0, 8, 4], [7, 6, 5]];

/** Element_PLNT_detectDown: index into DIR3X3 of the gravity direction, or 8 when there is none. */
export function detectDown(s: PowderSim, x: number, y: number): number {
  let [gx, gy] = s.gravityField(x, y, 1, 1);
  const len = Math.hypot(gx, gy);
  if (len > 0) { gx /= len; gy /= len; }
  let ix = 1, iy = 1;
  if (gx > 0.5) ix = 2;
  if (gx < -0.5) ix = 0;
  if (gy > 0.5) iy = 2;
  if (gy < -0.5) iy = 0;
  return INV_DIR[ix][iy];
}

const tmpField = (s: PowderSim, i: number, f: number) => f === 0 ? s.tmp[i] : f === 1 ? s.tmp2[i] : f === 2 ? s.tmp3[i] : s.tmp4[i];
const setTmpField = (s: PowderSim, i: number, f: number, v: number) => { if (f === 0) s.tmp[i] = v; else if (f === 1) s.tmp2[i] = v; else if (f === 2) s.tmp3[i] = v; else s.tmp4[i] = v; };
const clearGenes = (s: PowderSim, i: number) => { s.ctype[i] = 0; s.life[i] = 0; s.tmp[i] = 0; s.tmp2[i] = 0; s.tmp3[i] = 0; s.tmp4[i] = 0; };
const copyGenes = (s: PowderSim, dst: number, src: number) => { s.tmp[dst] = s.tmp[src]; s.tmp2[dst] = s.tmp2[src]; s.tmp3[dst] = s.tmp3[src]; s.tmp4[dst] = s.tmp4[src]; };

/** PLNT update when ctype bit 0 is set (tree growth). Returns true like the original's `return 1`. */
export function plntTree(s: PowderSim, i: number, x: number, y: number): boolean {
  const temp = s.temp[i];
  if (temp > 373.15 || temp < 223.15) { const keep = s.life[i]; clearGenes(s, i); s.life[i] = keep; return false; }
  if (temp > 343.15 || temp < 278.15) return false;
  if (s.rng.chance(9, 10)) return false;
  const phase = (s.ctype[i] >> PLNT_PHASE) & 3, dir = (s.ctype[i] >> PLNT_DIR) & 7, life = (s.ctype[i] >> PLNT_LIFE) & 0xff;
  const prog = tmpField(s, i, phase);
  const down = detectDown(s, x, y);
  let stopped = false;
  if (life > 0) {
    if (!s.life[i]) {
      const bmask = prog & 0x1f;
      let phases = prog >> 5;
      if (bmask) {
        for (let phi = 0; phi < 5; phi++) {
          if ((bmask >> phi) & 1) {
            const ndir = (dir + phi + 6) % 8, nphase = phases & 3;
            let nlife = Math.trunc((2 * life) / 3);
            if (down < 8) {
              if (ndir === down) nlife = Math.trunc(life / 3);
              if (ndir === (down + 1) % 8 || ndir === (down + 7) % 8) nlife = Math.trunc(life / 3);
              if (life > 4 && (ndir === (down + 2) % 8 || ndir === (down + 6) % 8)) nlife = Math.trunc(life / 2);
            }
            const si = s.createPart(-1, x + DIR3X3[ndir][0], y + DIR3X3[ndir][1], PT.PLNT);
            if (si >= 0) {
              s.ctype[si] = ((nlife & 0xff) << PLNT_LIFE) | (s.ctype[i] & (0x3f << PLNT_COLOUR)) | ((ndir & 7) << PLNT_DIR) | ((nphase & 3) << PLNT_PHASE) | 1;
              s.life[si] = ndir % 2 === 1 ? 7 * nlife : 10 * nlife;
              copyGenes(s, si, i);
            }
          }
          phases >>= 2;
        }
      } else stopped = true;
    } else {
      const si = s.createPart(-1, x + DIR3X3[dir][0], y + DIR3X3[dir][1], PT.PLNT);
      if (si >= 0) {
        s.ctype[si] = ((life & 0xff) << PLNT_LIFE) | (s.ctype[i] & (0x3f << PLNT_COLOUR)) | ((dir & 7) << PLNT_DIR) | ((phase & 3) << PLNT_PHASE) | 1;
        s.life[si] = s.life[i];
        copyGenes(s, si, i);
      }
    }
    if (!stopped) {
      if (phase || life < 12) {
        s.createPart(i, x, y, PT.WOOD);
        clearGenes(s, i);
      } else {
        s.createPart(i, x, y, PT.GOO);
        clearGenes(s, i);
        let left = (dir + 6) % 8, right = (dir + 2) % 8;
        if (dir % 2) { left = (dir + 5) % 8; right = (dir + 3) % 8; }
        s.createPart(-1, x + DIR3X3[left][0], y + DIR3X3[left][1], PT.WOOD);
        s.createPart(-1, x + DIR3X3[right][0], y + DIR3X3[right][1], PT.WOOD);
      }
    }
  } else stopped = true;
  if (stopped) {
    if (s.rng.chance(1, 10)) {
      const si = s.createPart(-1, x + 2 * DIR3X3[dir][0], y + 2 * DIR3X3[dir][1], PT.SEED);
      if (si >= 0) {
        s.vx[si] = DIR3X3[dir][0]; s.vy[si] = DIR3X3[dir][1];
        s.ctype[si] = s.ctype[i] & (0x3f << PLNT_COLOUR);
        copyGenes(s, si, i);
      }
    }
    s.ctype[i] = (s.ctype[i] & (0x3f << PLNT_COLOUR)) | (7 << PLNT_DIR);
    s.life[i] = 0; s.tmp[i] = 0; s.tmp2[i] = 0; s.tmp3[i] = 0; s.tmp4[i] = 0;
  }
  return true;
}

export const seed: Hook = (s, i, x, y) => {
  const temp = s.temp[i];
  if (temp > 320 && s.pv[s.cell(x, y)] > 50 && s.rng.chance(1, 150)) {
    s.createPart(i, x, y, PT.MWAX);
    clearGenes(s, i);
    return;
  }
  if (temp > 343.15 || temp < 278.15) { s.ctype[i] &= ~(0xff << PLNT_LIFE); s.life[i] = 0; return; }
  let water = (s.ctype[i] >> PLNT_LIFE) & 0xff;
  if (water > 3) {
    let down = detectDown(s, x, y);
    if (down < 0 || down > 7) down = 4;
    const up = (down + 4) % 8, XRES = s.XRES;
    const downPart = s.pmap[(y + DIR3X3[down][1]) * XRES + x + DIR3X3[down][0]];
    if ((TYP(downPart) === PT.SAND || TYP(downPart) === PT.SPNG) && !TYP(s.pmap[(y + DIR3X3[up][1]) * XRES + x + DIR3X3[up][0]])) {
      if (s.life[i] > 200) {
        s.changeType(i, x, y, PT.PLNT);
        s.ctype[i] &= ~((7 << PLNT_DIR) | (3 << PLNT_PHASE));
        s.ctype[i] |= ((up & 7) << PLNT_DIR) | 1;
        s.life[i] = 15 * water;
        return true;
      }
      s.life[i]++;
    } else s.life[i] = 0;
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = s.pmap[(y + ry) * s.XRES + x + rx], rid = ID(r);
    switch (TYP(r)) {
      case PT.WATR: if (water < 31) { s.killPart(rid); water++; s.life[i] = 0; } break;
      case PT.DEUT: if (water < 255) { s.killPart(rid); water++; s.life[i] = 0; } break;
      case PT.CBNW: case PT.DSTW: if (water < 3) { s.killPart(rid); water++; s.life[i] = 0; } break;
      case PT.SLTW: if (water > 0) { s.killPart(rid); water--; s.life[i] = 0; } break;
      case PT.SPNG: if (water < 15 && s.life[rid] > 0) { s.life[rid]--; water++; s.life[i] = 0; } break;
      case PT.SEED:
        if (water > 0 && !(s.ctype[i] & 1) && !(s.ctype[rid] & 1) && s.rng.chance(1, 10)) breed(s, i, rid);
        break;
    }
  }
  s.ctype[i] &= ~(0xff << PLNT_LIFE);
  s.ctype[i] |= (water & 0xff) << PLNT_LIFE;
};

function breed(s: PowderSim, i: number, r: number): void {
  const ac = s.ctype[i], bc = s.ctype[r];
  const oldI = [0, 1, 2, 3].map(f => tmpField(s, i, f)), oldR = [0, 1, 2, 3].map(f => tmpField(s, r, f));
  const newI = [...oldI], newR = [...oldR];
  s.ctype[i] = 1; s.ctype[r] = 1;
  for (let ind = 0; ind < 3; ind++) {
    const bits = [[0, 0], [0, 0]];
    for (let kid = 0; kid < 2; kid++) {
      bits[kid][0] = s.rng.chance(1, 2) ? ((ac & (1 << (2 * ind + PLNT_COLOUR))) !== 0 ? 1 : 0) : ((ac & (1 << (1 + 2 * ind + PLNT_COLOUR))) !== 0 ? 1 : 0);
      bits[kid][1] = s.rng.chance(1, 2) ? ((bc & (1 << (2 * ind + PLNT_COLOUR))) !== 0 ? 1 : 0) : ((bc & (1 << (1 + 2 * ind + PLNT_COLOUR))) !== 0 ? 1 : 0);
    }
    s.ctype[i] |= bits[0][0] << (2 * ind + PLNT_COLOUR);
    s.ctype[i] |= bits[0][1] << (1 + 2 * ind + PLNT_COLOUR);
    s.ctype[r] |= bits[1][0] << (2 * ind + PLNT_COLOUR);
    s.ctype[r] |= bits[1][1] << (1 + 2 * ind + PLNT_COLOUR);
  }
  // Upstream ORs the inherited bits into the existing tmp fields (which still hold the parents' own bits), so the children are
  // supersets of the parents; reproduce that exactly.
  for (let ind = 0; ind < 5; ind++) for (let f = 0; f < 4; f++) {
    newI[f] |= s.rng.chance(1, 2) ? (oldI[f] & (1 << ind)) : (oldR[f] & (1 << ind));
    newR[f] |= s.rng.chance(1, 2) ? (oldI[f] & (1 << ind)) : (oldR[f] & (1 << ind));
  }
  for (let ind = 5; ind < PLNT_TOTAL_TMP; ind += 2) for (let f = 0; f < 4; f++) {
    newI[f] |= s.rng.chance(1, 2) ? (oldI[f] & (3 << ind)) : (oldR[f] & (3 << ind));
    newR[f] |= s.rng.chance(1, 2) ? (oldI[f] & (3 << ind)) : (oldR[f] & (3 << ind));
  }
  for (let f = 0; f < 4; f++) { setTmpField(s, i, f, newI[f]); setTmpField(s, r, f, newR[f]); }
}

export const seedCreate = (s: PowderSim, i: number, x: number, y: number): void => {
  s.ctype[i] = 0b111011000000 | 0; // 0b111011'000'00'0
  let down = detectDown(s, x, y);
  if (down < 0 || down > 7) down = s.rng.between(0, 7);
  const up = (down + 4) % 8;
  s.ctype[i] |= (up & 7) << PLNT_DIR;
  s.tmp[i] = 0; s.tmp2[i] = 0; s.tmp3[i] = 0; s.tmp4[i] = 0;
  for (let ind = 0; ind < PLNT_TOTAL_TMP; ind++) {
    if (s.rng.chance(1, 2)) s.tmp[i] |= 1 << ind;
    if (s.rng.chance(1, 2)) s.tmp2[i] |= 1 << ind;
    if (s.rng.chance(1, 2)) s.tmp3[i] |= 1 << ind;
    if (s.rng.chance(1, 2)) s.tmp4[i] |= 1 << ind;
  }
};

