/* SOAP bubbles (SOAP.cpp; The Powder Toy, GPL-3.0). The final loop that washes decoration colour off neighbours is not ported
 * (decoration colour is not tracked). Edge-loop wrapping in neighbourLoop does not apply (only the void edge mode exists). */
import { ELEMENTS, ID, PT, TYP, TYPE_GAS } from '../elements';
import type { PowderSim } from '../sim';

const E = ELEMENTS, FREEZING = 248.15;

export function soapDetach(s: PowderSim, i: number): void {
  const v = (n: number) => n >= 0 && n < s.NPART;
  if ((s.ctype[i] & 2) === 2 && v(s.tmp[i]) && s.type[s.tmp[i]] === PT.SOAP) { if ((s.ctype[s.tmp[i]] & 4) === 4) s.ctype[s.tmp[i]] ^= 4; }
  if ((s.ctype[i] & 4) === 4 && v(s.tmp2[i]) && s.type[s.tmp2[i]] === PT.SOAP) { if ((s.ctype[s.tmp2[i]] & 2) === 2) s.ctype[s.tmp2[i]] ^= 2; }
  s.ctype[i] = 0;
}
function attach(s: PowderSim, a: number, b: number): void {
  if (!(s.ctype[b] & 4)) { s.ctype[a] |= 2; s.tmp[a] = b; s.ctype[b] |= 4; s.tmp2[b] = a; }
  else if (!(s.ctype[b] & 2)) { s.ctype[a] |= 4; s.tmp2[a] = b; s.ctype[b] |= 2; s.tmp[b] = a; }
}
export const soapChangeType = (s: PowderSim, i: number, _x: number, _y: number, from: number, to: number) => { if (from === PT.SOAP && to !== PT.SOAP) soapDetach(s, i); };

export const soap = (s: PowderSim, i: number, x: number, y: number): boolean | void => {
  const v = (n: number) => n >= 0 && n < s.NPART, XRES = s.XRES;
  if (s.ctype[i] & 1) {
    if (!v(s.tmp[i]) || !v(s.tmp2[i])) { s.tmp[i] = s.tmp2[i] = s.ctype[i] = 0; return false; }
    if (s.temp[i] > FREEZING) {
      if (s.life[i] <= 0) {
        if ((s.ctype[i] & 6) !== 6 && (s.ctype[i] & 6)) {
          let target = i;
          while ((s.ctype[target] & 6) !== 6 && (s.ctype[target] & 6) && s.type[target] === PT.SOAP) {
            if (s.ctype[target] & 2) { target = s.tmp[target]; if (!v(target)) break; soapDetach(s, target); }
            if (s.ctype[target] & 4) { target = s.tmp2[target]; if (!v(target)) break; soapDetach(s, target); }
          }
        }
        if ((s.ctype[i] & 6) !== 6) s.ctype[i] = 0;
        if (v(s.tmp[i]) && (s.ctype[i] & 6) === 6 && (s.ctype[s.tmp[i]] & 6) === 6 && s.tmp[s.tmp[i]] === i) soapDetach(s, i);
      }
      s.vy[i] = (s.vy[i] - 0.1) * 0.5; s.vx[i] *= 0.5;
    }
    if (!(s.ctype[i] & 2)) {
      for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
        if (!rx && !ry) continue;
        const r = s.pmap[(y + ry) * XRES + x + rx];
        if (r && s.type[ID(r)] === PT.SOAP && (s.ctype[ID(r)] & 1) && !(s.ctype[ID(r)] & 4)) attach(s, i, ID(r));
      }
    } else if (s.life[i] <= 0) {
      for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
        if (!rx && !ry) continue;
        const r = s.pmap[(y + ry) * XRES + x + rx], wall = s.bmap[s.cell(x + rx, y + ry)];
        if (!r && !wall) continue;
        if (s.temp[i] > FREEZING && (wall || (r && !(E[TYP(r)].Properties & TYPE_GAS) && TYP(r) !== PT.SOAP && TYP(r) !== PT.GLAS))) { soapDetach(s, i); continue; }
        if (TYP(r) === PT.SOAP) {
          const rid = ID(r);
          if (s.ctype[rid] === 1) {
            const buf = s.tmp[i];
            s.tmp[i] = rid;
            if (v(buf) && s.type[buf] === PT.SOAP) s.tmp2[buf] = rid;
            s.tmp2[rid] = i; s.tmp[rid] = buf; s.ctype[rid] = 7;
          } else if (s.ctype[rid] === 7 && s.tmp[i] !== rid && s.tmp2[i] !== rid) {
            if (v(s.tmp[i]) && s.type[s.tmp[i]] === PT.SOAP) s.tmp2[s.tmp[i]] = s.tmp2[rid];
            if (v(s.tmp2[rid]) && s.type[s.tmp2[rid]] === PT.SOAP) s.tmp[s.tmp2[rid]] = s.tmp[i];
            s.tmp2[rid] = i; s.tmp[i] = rid;
          }
        }
      }
    }
    if ((s.ctype[i] & 2) && v(s.tmp[i])) {
      const t = s.tmp[i];
      let dx = s.x[i] - s.x[t], dy = s.y[i] - s.y[t], d = 9 / (dx * dx + dy * dy + 9) - 0.5;
      s.vx[t] -= dx * d; s.vy[t] -= dy * d; s.vx[i] += dx * d; s.vy[i] += dy * d;
      if ((s.ctype[t] & 2) && (s.ctype[t] & 1) && v(s.tmp[t]) && (s.ctype[s.tmp[t]] & 2) && (s.ctype[s.tmp[t]] & 1)) {
        const ii = s.tmp[s.tmp[t]];
        if (v(ii)) {
          dx = s.x[ii] - s.x[t]; dy = s.y[ii] - s.y[t];
          d = 81 / (dx * dx + dy * dy + 81) - 0.5;
          s.vx[t] -= dx * d * 0.5; s.vy[t] -= dy * d * 0.5; s.vx[ii] += dx * d * 0.5; s.vy[ii] += dy * d * 0.5;
        }
      }
    }
  } else {
    const c = s.cell(x, y);
    if (s.pv[c] > 0.5 || s.pv[c] < -0.5) { s.ctype[i] = 1; s.life[i] = 10; }
    for (let rx = -2; rx < 3; rx++) for (let ry = -2; ry < 3; ry++) {
      if (!rx && !ry) continue;
      const r = s.pmap[(y + ry) * XRES + x + rx];
      if (r && TYP(r) === PT.OIL) {
        s.gravityXY(x, y, E[PT.SOAP].Gravity, 1);
        const ax = ((s.vx[i] - s.gfx) * 0.5 + s.vx[ID(r)]) / 2, ay = ((s.vy[i] - s.gfy) * 0.5 + s.vy[ID(r)]) / 2;
        s.vx[i] = s.vx[ID(r)] = ax; s.vy[i] = s.vy[ID(r)] = ay;
      }
    }
  }
};
