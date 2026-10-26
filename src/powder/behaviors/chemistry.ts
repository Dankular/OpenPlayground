/* Water family, gases, acids, plants and coal. Ported from the corresponding
 * src/simulation/elements/*.cpp files of The Powder Toy (GPL-3.0). */
import { ELEMENTS, ID, MAX_TEMP, PT, TYP, TYPE_PART, TYPE_SOLID } from '../elements';
import { plntTree } from './plants';
import type { PowderSim } from '../sim';
import { restrictTemp, type UpdateFn } from '../sim';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number) => boolean | void;
const near = (s: PowderSim, x: number, y: number, rx: number, ry: number) => s.pmap[(y + ry) * s.XRES + x + rx];

/** WATR */
export const watr: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.SALT && s.rng.chance(1, 50)) {
      s.changeType(i, x, y, PT.SLTW);
      if (s.rng.chance(1, 3)) s.changeType(rid, x + rx, y + ry, PT.SLTW);
    } else if ((rt === PT.RBDM || rt === PT.LRBD) && (s.legacyEnable || s.temp[i] > 273.15 + 12) && s.rng.chance(1, 100)) {
      s.changeType(i, x, y, PT.FIRE); s.life[i] = 4; s.ctype[i] = PT.WATR;
    } else if (rt === PT.FIRE && s.ctype[rid] !== PT.WATR) {
      s.killPart(rid);
      if (s.rng.chance(1, 30)) { s.killPart(i); return true; }
    } else if (rt === PT.SLTW && s.rng.chance(1, 2000)) s.changeType(i, x, y, PT.SLTW);
    else if (rt === PT.ROCK && Math.abs(s.vx[i]) + Math.abs(s.vy[i]) >= 0.5 && s.rng.chance(1, 1000)) {
      s.changeType(rid, x + rx, y + ry, s.rng.chance(1, 3) ? PT.SAND : PT.STNE);
    }
  }
};

export const dstw: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry), rt = TYP(r), rid = ID(r);
    switch (rt) {
      case PT.SALT:
        if (s.rng.chance(1, 50)) { s.changeType(i, x, y, PT.SLTW); if (s.rng.chance(1, 3)) s.changeType(rid, x + rx, y + ry, PT.SLTW); }
        break;
      case PT.SLTW:
        if (s.rng.chance(1, 2000)) { s.changeType(i, x, y, PT.SLTW); break; }
        // falls through to WATR, as in the original switch
      case PT.WATR:
        if (s.rng.chance(1, 100)) s.changeType(i, x, y, PT.WATR);
        break;
      case PT.RBDM: case PT.LRBD:
        if ((s.legacyEnable || s.temp[i] > 12) && s.rng.chance(1, 100)) { s.changeType(i, x, y, PT.FIRE); s.life[i] = 4; }
        break;
      case PT.FIRE:
        s.killPart(rid);
        if (s.rng.chance(1, 30)) { s.killPart(i); return true; }
        break;
      case PT.SMKE:
        if (s.temp[rid] > 40 + 273.15 && s.temp[rid] < 60 + 273.15 && s.temp[i] > 40 + 273.15 && s.temp[i] < 60 + 273.15 && s.rng.chance(1, 100)) {
          s.changeType(i, x, y, PT.BASE); s.life[i] = 1; s.killPart(rid);
        }
        break;
    }
  }
};

export const sltw: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry), rt = TYP(r), rid = ID(r);
    switch (rt) {
      case PT.SALT: if (s.rng.chance(1, 2000)) s.changeType(rid, x + rx, y + ry, PT.SLTW); break;
      case PT.PLNT: if (s.rng.chance(1, 40)) s.killPart(rid); break;
      case PT.RBDM: case PT.LRBD:
        if ((s.legacyEnable || s.temp[i] > 273.15 + 12) && s.rng.chance(1, 100)) { s.changeType(i, x, y, PT.FIRE); s.life[i] = 4; s.ctype[i] = PT.WATR; }
        break;
      case PT.FIRE:
        if (s.ctype[rid] !== PT.WATR) { s.killPart(rid); if (s.rng.chance(1, 30)) { s.killPart(i); return true; } }
        break;
    }
  }
};

export const cbnw: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  if (s.pv[c] <= 3 && (s.pv[c] <= -0.5 || s.rng.chance(1, 4000))) { s.changeType(i, x, y, PT.CO2); s.ctype[i] = 5; s.pv[c] += 0.5; }
  if (s.tmp2[i] !== 20) s.tmp2[i] -= s.tmp2[i] > 20 ? 1 : -1;
  else if (s.rng.chance(1, 200)) s.tmp2[i] = s.rng.between(0, 39);
  if (s.tmp[i] > 0) {
    if (s.tmp[i] === 1 && s.rng.chance(3, 4)) { s.changeType(i, x, y, PT.CO2); s.ctype[i] = 5; s.pv[c] += 0.2; }
    s.tmp[i]--;
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if ((E[rt].Properties & TYPE_PART) && s.tmp[i] === 0 && s.rng.chance(1, 83)) s.tmp[i] = s.rng.between(0, 24);
    else if ((E[rt].Properties & TYPE_SOLID) && rt !== PT.DMND && rt !== PT.GLAS && s.tmp[i] === 0 && s.rng.chance(Math.trunc(2 - s.pv[c]), 6667)) {
      s.changeType(i, x, y, PT.CO2); s.ctype[i] = 5; s.pv[c] += 0.2;
    }
    if (rt === PT.CBNW) {
      if (!s.tmp[i]) { if (s.tmp[rid]) { s.tmp[i] = s.tmp[rid]; if (rid > i) s.tmp[i]--; } }
      else if (!s.tmp[rid]) { s.tmp[rid] = s.tmp[i]; if (rid > i) s.tmp[rid]++; }
    } else if (rt === PT.RBDM || rt === PT.LRBD) {
      if ((s.legacyEnable || s.temp[i] > 273.15 + 12) && s.rng.chance(1, 166)) { s.changeType(i, x, y, PT.FIRE); s.life[i] = 4; s.ctype[i] = PT.WATR; }
    } else if (rt === PT.FIRE && s.ctype[rid] !== PT.WATR) {
      s.killPart(rid);
      if (s.rng.chance(1, 50)) { s.killPart(i); return true; }
    }
  }
};

export const frzw: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (r && TYP(r) === PT.WATR && s.rng.chance(1, 14)) s.changeType(ID(r), x + rx, y + ry, PT.FRZW);
  }
  if ((s.life[i] === 0 && s.rng.chance(1, 192)) || s.rng.chance(100 - s.life[i], 50000)) {
    s.changeType(i, x, y, PT.ICEI); s.ctype[i] = PT.FRZW; s.temp[i] = restrictTemp(s.temp[i] - 200);
  }
};

export const frzz: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (r && TYP(r) === PT.WATR && s.rng.chance(1, 20)) {
      s.changeType(ID(r), x + rx, y + ry, PT.FRZW); s.life[ID(r)] = 100; s.killPart(i); return true;
    }
  }
};

export const icei: Hook = (s, i, x, y) => {
  if (s.ctype[i] === PT.FRZW) s.temp[i] = restrictTemp(s.temp[i] - 1);
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r);
    if (rt === PT.SALT || rt === PT.SLTW) {
      if (s.temp[i] > E[PT.SLTW].LowTemperature && s.rng.chance(1, 200)) {
        s.changeType(i, x, y, PT.SLTW); s.changeType(ID(r), x + rx, y + ry, PT.SLTW); return false;
      }
    } else if (rt === PT.FRZZ && s.rng.chance(1, 200)) { s.changeType(ID(r), x + rx, y + ry, PT.ICEI); s.ctype[ID(r)] = PT.FRZW; }
  }
};

export const snow: Hook = (s, i, x, y) => {
  if (s.ctype[i] === PT.FRZW) s.temp[i] = restrictTemp(s.temp[i] - 1);
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    if ((TYP(r) === PT.SALT || TYP(r) === PT.SLTW) && s.rng.chance(1, 333)) { s.changeType(i, x, y, PT.SLTW); s.changeType(ID(r), x + rx, y + ry, PT.SLTW); }
  }
};

export const wtrv: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    if ((TYP(r) === PT.RBDM || TYP(r) === PT.LRBD) && !s.legacyEnable && s.temp[i] > 273.15 + 12 && s.rng.chance(1, 100)) {
      s.changeType(i, x, y, PT.FIRE); s.life[i] = 4; s.ctype[i] = PT.WATR;
    }
  }
  if (s.temp[i] > 1273 && s.ctype[i] === PT.FIRE) s.temp[i] -= s.temp[i] / 1000;
};

export const fog: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if ((E[rt].Properties & TYPE_SOLID) && s.rng.chance(1, 10) && s.life[i] === 0 && !(rt === PT.CLNE || rt === PT.PCLN || rt === PT.BCLN || rt === PT.PBCN)) s.changeType(i, x, y, PT.RIME);
    if (rt === PT.SPRK) s.life[i] += s.rng.between(0, 19);
    if (rt === PT.GAS && s.tmp[i] < 10) { s.killPart(rid); if (s.ctype[i] === PT.DSTW) s.ctype[i] = 0; else s.tmp[i]++; }
  }
};

export const rime: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.SPRK) { s.changeType(i, x, y, PT.FOG); s.life[i] = s.rng.between(60, 119); }
    else if (rt === PT.GAS && s.tmp[i] < 10) { s.killPart(rid); if (s.ctype[i] === PT.DSTW) s.ctype[i] = 0; else s.tmp[i]++; }
    else if (rt === PT.FOG && s.life[rid] > 0) { s.changeType(i, x, y, PT.FOG); s.life[i] = s.life[rid]; }
  }
};

export const co2: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) {
      if (s.ctype[i] === 5 && s.rng.chance(1, 2000) && s.createPart(-1, x + rx, y + ry, PT.WATR) >= 0) s.ctype[i] = 0;
      continue;
    }
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.FIRE) { s.killPart(rid); if (s.rng.chance(1, 30)) { s.killPart(i); return true; } }
    else if ((rt === PT.WATR || rt === PT.DSTW) && s.rng.chance(1, 50)) {
      s.changeType(rid, x + rx, y + ry, PT.CBNW);
      if (s.ctype[i] === 5) { s.createPart(i, x, y, PT.WATR); return false; }
      s.killPart(i); return true;
    }
  }
  const c = s.cell(x, y);
  if (s.temp[i] > 9773.15 && s.pv[c] > 200 && s.rng.chance(1, 5)) {
    s.createPart(i, x, y, PT.O2);
    let j = s.createPart(-3, x, y, PT.NEUT);
    if (j !== -1) s.temp[j] = MAX_TEMP;
    if (s.rng.chance(1, 50)) { j = s.createPart(-3, x, y, PT.ELEC); if (j !== -1) s.temp[j] = MAX_TEMP; }
    s.temp[i] = MAX_TEMP; s.pv[c] += 100;
  }
};

export const boyl: Hook = (s, i, x, y) => {
  const XC = s.XCELLS, c = s.cell(x, y), limit = s.temp[i] / 100, pv = s.pv;
  if (pv[c] < limit) pv[c] += 0.001 * (limit - pv[c]);
  if (pv[c + XC] < limit) pv[c + XC] += 0.001 * (limit - pv[c + XC]);
  if (pv[c - XC] < limit) pv[c - XC] += 0.001 * (limit - pv[c - XC]);
  pv[c + 1] += 0.001 * (limit - pv[c + 1]);
  pv[c + XC + 1] += 0.001 * (limit - pv[c + XC + 1]);
  pv[c - 1] += 0.001 * (limit - pv[c - 1]);
  pv[c - XC - 1] += 0.001 * (limit - pv[c - XC - 1]);
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    if (TYP(r) === PT.WATR) { if (s.rng.chance(1, 30)) s.changeType(ID(r), x + rx, y + ry, PT.FOG); }
    else if (TYP(r) === PT.O2 && s.rng.chance(1, 9)) { s.killPart(ID(r)); s.changeType(i, x, y, PT.WATR); s.pv[c] += 4; return true; }
  }
};

export const caus: Hook = (s, i, x, y) => {
  let converted = false;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.GAS) {
      if (s.pv[s.cell(x + rx, y + ry)] > 3) { s.changeType(rid, x + rx, y + ry, PT.RFRG); s.changeType(i, x, y, PT.RFRG); converted = true; }
    } else if (rt !== PT.ACID && rt !== PT.CAUS && rt !== PT.RFRG && rt !== PT.RFGL) {
      if ((rt !== PT.CLNE && rt !== PT.PCLN && ((rt !== PT.FOG && rt !== PT.RIME) || s.tmp[rid] <= 5) && s.rng.chance(E[rt].Hardness, 1000)) && s.life[i] > 50) {
        if (s.partsAvg(i, rid, PT.GLAS) !== PT.GLAS) {
          const newtemp = Math.max(0, (60 - E[rt].Hardness) * 7);
          s.temp[i] += newtemp; s.life[i]--; s.killPart(rid);
        }
      } else if (s.life[i] <= 50) { s.killPart(i); return true; }
    }
  }
  return converted;
};

export const acid: Hook = (s, i, x, y) => {
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.ACID || rt === PT.CAUS) continue;
    if (rt === PT.PLEX || rt === PT.NITR || rt === PT.GUNP || rt === PT.RBDM || rt === PT.LRBD) {
      s.changeType(i, x, y, PT.FIRE); s.changeType(rid, x + rx, y + ry, PT.FIRE); s.life[i] = 4; s.life[rid] = 4;
    } else if (rt === PT.WTRV) {
      if (s.rng.chance(1, 250)) { s.changeType(i, x, y, PT.CAUS); s.life[i] = s.rng.between(25, 74); s.killPart(rid); }
    } else if (rt !== PT.CLNE && rt !== PT.PCLN && ((rt !== PT.FOG && rt !== PT.RIME) || s.tmp[rid] <= 5) && s.life[i] > 50 && s.rng.chance(E[rt].Hardness, 1000)) {
      if (s.partsAvg(i, rid, PT.GLAS) !== PT.GLAS) {
        s.temp[i] += Math.max(0, (60 - E[rt].Hardness) * 7); s.life[i]--;
        if (rt === PT.LITH) s.changeType(rid, x + rx, y + ry, PT.H2); else s.killPart(rid);
      }
    } else if (s.life[i] <= 50) { s.killPart(i); return true; }
  }
  for (let trade = 0; trade < 2; trade++) {
    const rx = s.rng.between(-2, 2), ry = s.rng.between(-2, 2);
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) === PT.ACID && s.life[i] > s.life[rid] && s.life[i] > 0) {
      const d = s.life[i] - s.life[rid];
      if (d === 1) { s.life[rid]++; s.life[i]--; }
      else if (d > 0) { s.life[rid] += (d / 2) | 0; s.life[i] -= (d / 2) | 0; }
    }
  }
};

export const o2: Hook = (s, i, x, y) => {
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) === PT.FIRE) {
      s.temp[rid] += s.rng.between(0, 99);
      if (s.tmp[rid] & 1) s.temp[rid] = 3473;
      s.tmp[rid] |= 2;
      s.createPart(i, x, y, PT.FIRE); s.temp[i] += s.rng.between(0, 99); s.tmp[i] |= 2;
    } else if (TYP(r) === PT.PLSM && !(s.tmp[rid] & 4)) {
      s.createPart(i, x, y, PT.FIRE); s.temp[i] += s.rng.between(0, 99); s.tmp[i] |= 2;
    }
  }
  const c = s.cell(x, y);
  if (s.temp[i] > 9973.15 && s.pv[c] > 250) {
    const gx = s.newton.forceX[c], gy = s.newton.forceY[c];
    if (gx * gx + gy * gy > 400 && s.rng.chance(1, 5)) {
      s.createPart(i, x, y, PT.BRMT);
      let j = s.createPart(-3, x, y, PT.NEUT); if (j !== -1) s.temp[j] = MAX_TEMP;
      j = s.createPart(-3, x, y, PT.PHOT); if (j !== -1) { s.temp[j] = MAX_TEMP; s.tmp[j] = 1; }
      const rx = x + s.rng.between(-1, 1), ry = y + s.rng.between(-1, 1), r = TYP(s.pmap[ry * s.XRES + rx]);
      if (s.canMove[PT.PLSM * 512 + r] || r === PT.O2) { j = s.createPart(-3, rx, ry, PT.PLSM); if (j > -1) { s.temp[j] = MAX_TEMP; s.tmp[j] |= 4; } }
      j = s.createPart(-3, x, y, PT.GRVT); if (j !== -1) s.temp[j] = MAX_TEMP;
      s.temp[i] = MAX_TEMP; s.pv[c] = 256;
    }
  }
};

export const h2: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (s.pv[c] > 8 && rt === PT.DESL) { s.changeType(rid, x + rx, y + ry, PT.WATR); s.changeType(i, x, y, PT.OIL); return true; }
    if (s.pv[c] > 45) { if (s.temp[rid] > 2273.15) continue; }
    else if (rt === PT.FIRE) {
      s.temp[rid] = (s.tmp[rid] & 2) ? 3473 : 2473.15;
      s.tmp[rid] |= 1;
      s.createPart(i, x, y, PT.FIRE); s.temp[i] += s.rng.between(0, 99); s.tmp[i] |= 1;
      return true;
    } else if ((rt === PT.PLSM && !(s.tmp[rid] & 4)) || (rt === PT.LAVA && s.ctype[rid] !== PT.BMTL)) {
      s.createPart(i, x, y, PT.FIRE); s.temp[i] += s.rng.between(0, 99); s.tmp[i] |= 1;
      return true;
    }
  }
  if (s.temp[i] > 2273.15 && s.pv[c] > 50 && s.rng.chance(1, 5)) {
    const temp = s.temp[i];
    s.createPart(i, x, y, PT.NBLE); s.tmp[i] = 1;
    let j = s.createPart(-3, x, y, PT.NEUT); if (j > -1) s.temp[j] = temp;
    if (s.rng.chance(1, 10)) { j = s.createPart(-3, x, y, PT.ELEC); if (j > -1) s.temp[j] = temp; }
    j = s.createPart(-3, x, y, PT.PHOT);
    if (j > -1) { s.ctype[j] = 0x7c0000; s.temp[j] = temp; s.tmp[j] = 1; }
    const rx = x + s.rng.between(-1, 1), ry = y + s.rng.between(-1, 1), rt = TYP(s.pmap[ry * s.XRES + rx]);
    if (s.canMove[PT.PLSM * 512 + rt] || rt === PT.H2) {
      j = s.createPart(-3, rx, ry, PT.PLSM);
      if (j > -1) { s.temp[j] = temp; s.tmp[j] |= 4; }
    }
    s.temp[i] = temp + s.rng.between(750, 1249);
    s.pv[c] += 30;
    return true;
  }
};

export const nble: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  if (s.temp[i] > 5273.15 && s.pv[c] > 100) {
    s.tmp[i] |= 1;
    if (s.rng.chance(1, 5)) {
      const temp = s.temp[i];
      s.createPart(i, x, y, PT.CO2);
      let j = s.createPart(-3, x, y, PT.NEUT); if (j !== -1) s.temp[j] = temp;
      if (s.rng.chance(1, 25)) { j = s.createPart(-3, x, y, PT.ELEC); if (j !== -1) s.temp[j] = temp; }
      j = s.createPart(-3, x, y, PT.PHOT);
      if (j !== -1) { s.ctype[j] = 0xf800000; s.temp[j] = temp; s.tmp[j] = 1; }
      const rx = x + s.rng.between(-1, 1), ry = y + s.rng.between(-1, 1), rt = TYP(s.pmap[ry * s.XRES + rx]);
      if (s.canMove[PT.PLSM * 512 + rt] || rt === PT.NBLE) {
        j = s.createPart(-3, rx, ry, PT.PLSM);
        if (j !== -1) { s.temp[j] = temp; s.tmp[j] |= 4; }
      }
      s.temp[i] = temp + 1750 + s.rng.between(0, 499);
      s.pv[c] += 50;
    }
  }
};

/** COAL and BCOL (Element_COAL_update) */
export const coal: Hook = (s, i, x, y) => {
  if (s.life[i] <= 0) { s.createPart(i, x, y, PT.FIRE); return true; }
  if (s.life[i] < 100) { s.life[i]--; s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), PT.FIRE); }
  if (s.type[i] === PT.COAL) {
    if (s.pv[s.cell(x, y)] > 4.3 && s.tmp[i] > 40) s.tmp[i] = 39;
    else if (s.tmp[i] < 40 && s.tmp[i] > 0) s.tmp[i]--;
    else if (s.tmp[i] <= 0) { s.changeType(i, x, y, PT.BCOL); return true; }
  }
  if (s.temp[i] > s.tmp2[i]) s.tmp2[i] = s.temp[i] | 0;
};

export const wood: Hook = (s, i, x, y) => {
  if (s.temp[i] > 450 && s.temp[i] > s.tmp[i]) s.tmp[i] = s.temp[i] | 0;
  if (s.temp[i] > 773 && s.pv[s.cell(x, y)] <= -10) { const t = s.temp[i]; s.createPart(i, x, y, PT.BCOL); s.temp[i] = t; }
};

export const vine: Hook = (s, i, x, y) => {
  let rnd = s.rng.gen();
  const rx = (rnd % 3) - 1; rnd >>= 2;
  const ry = (rnd % 3) - 1; rnd >>= 2;
  if (rx || ry) {
    const r = near(s, x, y, rx, ry);
    if (!(rnd % 15)) s.changeType(i, x, y, PT.PLNT);
    else if (!r) {
      const np = s.createPart(-1, x + rx, y + ry, PT.VINE);
      if (np < 0) return false;
      s.temp[np] = s.temp[i]; s.changeType(i, x, y, PT.PLNT);
    }
  }
  if (s.temp[i] > 350 && s.temp[i] > s.tmp2[i]) s.tmp2[i] = s.temp[i] | 0;
};

/** PLNT: ordinary branch here; the ctype&1 tree-growth branch lives in plants.ts. */
export const plnt: Hook = (s, i, x, y, surroundSpace) => {
  if (s.ctype[i] & 1) return plntTree(s, i, x, y);
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry), rid = ID(r);
    switch (TYP(r)) {
      case PT.WATR:
        if (s.rng.chance(1, 50)) {
          const np = s.createPart(rid, x + rx, y + ry, PT.PLNT);
          if (np < 0) continue;
          s.life[np] = 0; s.ctype[np] = s.ctype[i];
        }
        break;
      case PT.LAVA: if (s.rng.chance(1, 50)) { s.changeType(i, x, y, PT.FIRE); s.life[i] = 4; } break;
      case PT.SMKE: case PT.CO2:
        if (s.rng.chance(1, 50)) { s.killPart(rid); s.life[i] = s.rng.between(60, 119); }
        break;
      case PT.WOOD: {
        let rnd = s.rng.gen();
        if (surroundSpace && !(rnd % 4) && s.tmp[i] === 1) {
          rnd >>= 3;
          const nnx = (rnd % 3) - 1; rnd >>= 2;
          const nny = (rnd % 3) - 1;
          if (nnx || nny) {
            if (s.pmap[(y + ry + nny) * s.XRES + x + rx + nnx]) continue;
            const np = s.createPart(-1, x + rx + nnx, y + ry + nny, PT.VINE);
            if (np < 0) continue;
            s.temp[np] = s.temp[i];
          }
        }
        break;
      }
    }
  }
  if (s.life[i] === 2) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) if ((rx || ry) && !near(s, x, y, rx, ry)) s.createPart(-1, x + rx, y + ry, PT.O2);
    s.life[i] = 0;
  }
  if (s.temp[i] > 350 && s.temp[i] > s.tmp2[i]) s.tmp2[i] = s.temp[i] | 0;
};

export const goo: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  if (!s.life[i] && s.pv[c] > 1) s.life[i] = s.rng.between(300, 379);
  if (s.life[i]) { s.vx[i] += 0.1 * s.avx[c]; s.vy[i] += 0.1 * s.avy[c]; }
};
export type { UpdateFn };
