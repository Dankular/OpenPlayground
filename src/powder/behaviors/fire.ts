/* FIRE / PLSM / LAVA shared update (Element_FIRE_update). Ported from FIRE.cpp, The Powder Toy (GPL-3.0). */
import { CFDS, ELEMENTS, ID, PT, TYP } from '../elements';
import type { PowderSim } from '../sim';
import { restrictTemp } from '../sim';

export function fireUpdate(s: PowderSim, i: number, x: number, y: number, surroundSpace: number): boolean {
  const E = ELEMENTS, t = s.type[i], XRES = s.XRES;
  switch (t) {
    case PT.PLSM:
      if (s.life[i] <= 1) {
        if (s.ctype[i] === PT.NBLE) { s.changeType(i, x, y, PT.NBLE); s.life[i] = 0; }
        else if ((s.tmp[i] & 3) === 3) { s.changeType(i, x, y, PT.WTRV); s.life[i] = 0; s.ctype[i] = PT.FIRE; }
      }
      break;
    case PT.FIRE:
      if (s.life[i] <= 1) {
        if ((s.tmp[i] & 3) === 3) { s.changeType(i, x, y, PT.WTRV); s.life[i] = 0; s.ctype[i] = PT.FIRE; }
        else if (s.temp[i] < 625) { s.changeType(i, x, y, PT.SMKE); s.life[i] = s.rng.between(250, 269); }
      }
      break;
    case PT.LAVA: {
      const c = s.cell(x, y), pres = s.pv[c];
      if (s.ctype[i] === PT.ROCK) {
        if (pres <= -9) { s.ctype[i] = PT.STNE; break; }
        if (pres >= 25 && s.rng.chance(1, 12500)) {
          if (pres <= 50) s.ctype[i] = s.rng.chance(1, 2) ? PT.BRMT : PT.CNCT;
          else if (pres <= 75) s.ctype[i] = (pres >= 73 || s.rng.chance(1, 8)) ? PT.GOLD : PT.QRTZ;
          else if (pres <= 100 && s.temp[i] >= 5000) s.ctype[i] = s.rng.chance(1, 5) ? PT.TTAN : PT.IRON;
          else if (s.temp[i] >= 5000 && s.rng.chance(1, 5)) {
            if (s.rng.chance(1, 5)) s.ctype[i] = PT.URAN;
            else if (s.rng.chance(1, 5)) s.ctype[i] = PT.PLUT;
            else s.ctype[i] = PT.TUNG;
          }
        }
      } else if (s.ctype[i] === PT.GOLD && pres < -200 && s.temp[i] > E[PT.PTNM].HighTemperature && s.rng.chance(1, 20000)) {
        s.ctype[i] = PT.PTNM; s.pv[c] += 2;
      } else if ((s.ctype[i] === PT.STNE || !s.ctype[i]) && pres >= 30 && (s.temp[i] > E[PT.ROCK].HighTemperature || pres < E[PT.ROCK].HighPressure)) {
        s.tmp2[i] = s.rng.between(0, 10); s.ctype[i] = PT.ROCK;
      }
      break;
    }
  }
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = s.pmap[(y + ry) * XRES + x + rx];
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.THRM && (t === PT.FIRE || t === PT.PLSM || t === PT.LAVA)) {
      if (s.rng.chance(1, 500)) {
        s.changeType(rid, x + rx, y + ry, PT.LAVA); s.ctype[rid] = PT.BMTL; s.temp[rid] = 3500; s.pv[s.cell(x + rx, y + ry)] += 50;
      } else {
        s.changeType(rid, x + rx, y + ry, PT.LAVA); s.life[rid] = 400; s.ctype[rid] = PT.THRM; s.temp[rid] = 3500; s.tmp[rid] = 20;
      }
      continue;
    }
    if (rt === PT.COAL || rt === PT.BCOL) {
      if (t === PT.FIRE || t === PT.PLSM) {
        if (s.life[rid] > 100 && s.rng.chance(1, 500)) s.life[rid] = 99;
      } else if (t === PT.LAVA) {
        if (s.ctype[i] === PT.IRON && s.rng.chance(1, 500)) { s.ctype[i] = PT.METL; s.killPart(rid); continue; }
        if ((s.ctype[i] === PT.STNE || s.ctype[i] === PT.NONE) && s.rng.chance(1, 60)) { s.ctype[i] = PT.SLCN; s.killPart(rid); continue; }
      }
    }
    if (t === PT.LAVA) {
      const ct = s.ctype[i];
      if (ct === PT.QRTZ && rt === PT.LAVA && s.ctype[rid] === PT.CLST) {
        const pres = Math.max(s.pv[s.cell(x, y)] * 10, 0);
        if (s.temp[i] >= pres + E[PT.CRMC].HighTemperature + 50) { s.ctype[i] = PT.CRMC; s.ctype[rid] = PT.CRMC; }
      } else if (rt === PT.O2 && ct === PT.SLCN) {
        switch (s.rng.between(0, 2)) {
          case 0: s.ctype[i] = PT.SAND; break;
          case 1: s.ctype[i] = PT.CLST; if (s.temp[i] >= E[PT.PQRT].HighTemperature * 3) s.ctype[i] = PT.PQRT; break;
          case 2: s.ctype[i] = PT.STNE; break;
        }
        s.tmp[i] = 0; s.killPart(rid); continue;
      } else if (rt === PT.LAVA && (s.ctype[rid] === PT.METL || s.ctype[rid] === PT.BMTL) && ct === PT.SLCN) {
        s.tmp[i] = 0; s.ctype[i] = PT.NSCN; s.ctype[rid] = PT.PSCN;
      } else if (ct === PT.SLCN && rt === PT.LAVA && s.ctype[rid] === PT.SALT) {
        if (s.temp[i] > E[PT.LITH].HighTemperature && s.rng.chance(1, 1000)) {
          s.ctype[i] = PT.LITH; s.tmp[i] = 0; s.tmp2[i] = 0; s.life[i] = 0; s.killPart(rid); continue;
        }
      } else if (rt === PT.HEAC && ct === PT.HEAC) {
        if (s.temp[rid] > E[PT.HEAC].HighTemperature) { s.changeType(rid, x + rx, y + ry, PT.LAVA); s.ctype[rid] = PT.HEAC; }
      } else if (ct === PT.ROCK && rt === PT.LAVA && s.ctype[rid] === PT.GOLD && s.tmp[rid] === 0 && s.pv[s.cell(x, y)] >= 50 && s.rng.chance(1, 10000)) {
        s.ctype[i] = PT.GOLD;
        if (rx > 1 || rx < -1) s.tmp[i] = 1;
      } else if (ct === PT.SALT && rt === PT.GLAS && s.life[rid] < 234 * 120) s.life[rid]++;
    }
    if ((surroundSpace || E[rt].Explosive) && E[rt].Flammable &&
      s.rng.chance(Math.trunc(E[rt].Flammable + s.pv[s.cell(x + rx, y + ry)] * 10), 1000) &&
      (t !== PT.SPRK || (rt !== PT.RBDM && rt !== PT.LRBD && rt !== PT.INSL)) &&
      (t !== PT.PHOT || rt !== PT.INSL) && (rt !== PT.SPNG || s.life[rid] === 0)) {
      s.changeType(rid, x + rx, y + ry, PT.FIRE);
      s.temp[rid] = restrictTemp(E[PT.FIRE].default.temp + E[rt].Flammable / 2);
      s.life[rid] = s.rng.between(180, 259);
      s.tmp[rid] = s.ctype[rid] = 0;
      if (E[rt].Explosive) s.pv[s.cell(x, y)] += 0.25 * CFDS;
    }
  }
  return false;
}
