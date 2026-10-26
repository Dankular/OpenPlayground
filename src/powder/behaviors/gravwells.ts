/* Elements that write the Newtonian-gravity mass map: NBHL, NWHL, GBMB, GRVT (and GPMP's mass term, see devices.ts).
 * Ported from the same-named files of The Powder Toy (GPL-3.0). */
import { PT, TYP } from '../elements';
import type { PowderSim } from '../sim';

type Hook = (s: PowderSim, i: number, x: number, y: number) => boolean | void;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const nbhl: Hook = (s, i, x, y) => { s.newton.mass[s.cell(x, y)] += s.tmp[i] ? clamp(0.001 * s.tmp[i], 0.1, 51.2) : 0.1; };
export const nwhl: Hook = (s, i, x, y) => { s.newton.mass[s.cell(x, y)] -= s.tmp[i] ? clamp(0.001 * s.tmp[i], 0.1, 51.2) : 0.1; };
export const gbmb: Hook = (s, i, x, y) => {
  if (s.life[i] <= 0) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      const r = s.pmap[(y + ry) * s.XRES + x + rx];
      if (!r) continue;
      const t = TYP(r);
      if (t !== PT.BOMB && t !== PT.GBMB && t !== PT.CLNE && t !== PT.PCLN && t !== PT.DMND) { s.life[i] = 60; break; }
    }
  }
  if (s.life[i] > 20) s.newton.mass[s.cell(x, y)] = 20; else if (s.life[i] >= 1) s.newton.mass[s.cell(x, y)] = -80;
};
export const grvt: Hook = (s, i, x, y) => {
  s.tmp[i] = clamp(s.tmp[i], -100, 100);
  if (TYP(s.pmap[y * s.XRES + x]) === PT.RSSS && s.rng.chance(1, 5)) { s.killPart(i); return true; }
  s.newton.mass[s.cell(x, y)] = 0.2 * s.tmp[i];
};
