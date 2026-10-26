/* Force fields, converters and simple powered devices. Ported from ACEL/DCEL/RPEL/DMG/CONV/MORT/PVOD/LCRY/HSWC/DLAY.cpp,
 * The Powder Toy (GPL-3.0). HSWC's FILT temperature deserialisation is not ported (FILT has no behaviour here). */
import { ELEMENTS, ID, MAX_PRESSURE, MAX_VELOCITY, MIN_PRESSURE, PMAPBITS, PROP_CONDUCTS, PT, PT_NUM, TYP, TYPE_ENERGY, TYPE_GAS, TYPE_LIQUID, TYPE_PART, TYPE_SOLID } from '../elements';
import type { PowderSim } from '../sim';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
const near = (s: PowderSim, x: number, y: number, rx: number, ry: number) => s.pmap[(y + ry) * s.XRES + x + rx];
const either = (s: PowderSim, x: number, y: number, rx: number, ry: number) => { const k = (y + ry) * s.XRES + x + rx; return s.pmap[k] || s.photons[k]; };
const MOVING = TYPE_PART | TYPE_LIQUID | TYPE_GAS | TYPE_ENERGY;
const sign = (v: number) => (v < 0 ? -1 : v > 0 ? 1 : 0);

export const acel: Hook = (s, i, x, y) => {
  const mult = s.life[i] !== 0 ? 1 + Math.min(1000, Math.max(0, s.life[i])) / 100 : 1.1;
  s.tmp[i] = 0;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx !== !ry) {
      const r = either(s, x, y, rx, ry);
      if (!r || !(E[TYP(r)].Properties & MOVING)) continue;
      const id = ID(r);
      let vx = s.vx[id] * mult, vy = s.vy[id] * mult;
      const mv = Math.max(Math.abs(vx), Math.abs(vy));
      if (mv > MAX_VELOCITY) { vx *= MAX_VELOCITY / mv; vy *= MAX_VELOCITY / mv; }
      s.vx[id] = vx; s.vy[id] = vy; s.tmp[i] = 1;
    }
  }
};

export const dcel: Hook = (s, i, x, y) => {
  const mult = s.life[i] !== 0 ? 1 - Math.min(100, Math.max(0, s.life[i])) / 100 : 1 / 1.1;
  s.tmp[i] = 0;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if ((rx || ry) && !(rx && ry)) {
      const r = either(s, x, y, rx, ry);
      if (!r || !(E[TYP(r)].Properties & MOVING)) continue;
      s.vx[ID(r)] *= mult; s.vy[ID(r)] *= mult; s.tmp[i] = 1;
    }
  }
};

export const rpel: Hook = (s, i, x, y) => {
  for (let ri = 0; ri <= 10; ri++) {
    const rx = s.rng.between(-10, 10), ry = s.rng.between(-10, 10);
    if (x + rx >= 0 && x + rx < s.XRES && y + ry >= 0 && y + ry < s.YRES && (rx || ry)) {
      const r = either(s, x, y, rx, ry);
      if (r && !(E[TYP(r)].Properties & TYPE_SOLID) && (!s.ctype[i] || s.ctype[i] === s.type[ID(r)])) {
        const id = ID(r), k = (s.temp[i] - 273.15) / 10;
        s.vx[id] = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, s.vx[id] + sign(rx) * k));
        s.vy[id] = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, s.vy[id] + sign(ry) * k));
      }
    }
  }
};

export const dmg: Hook = (s, i, x, y) => {
  const rad = 25;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r);
    if (rt !== PT.DMG && rt !== PT.EMBR && rt !== PT.DMND && rt !== PT.CLNE && rt !== PT.PCLN && rt !== PT.BCLN) {
      s.killPart(i);
      for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++) {
        if (!(x + k >= 0 && y + j >= 0 && x + k < s.XRES && y + j < s.YRES && (k || j))) continue;
        const dist = Math.trunc(Math.sqrt(k * k + j * j));
        if (dist && dist > rad) continue;
        const rr = s.pmap[(y + j) * s.XRES + x + k];
        if (!rr) continue;
        const a = Math.atan2(j, k), fx = Math.cos(a) * 7, fy = Math.sin(a) * 7, id = ID(rr), c = s.cell(x + k, y + j);
        s.vx[id] += fx; s.vy[id] += fy; s.avx[c] += fx; s.avy[c] += fy; s.pv[c] += 1;
        const t = TYP(rr), px = x + k, py = y + j;
        if (t && E[t].HighPressureTransition > -1 && E[t].HighPressureTransition < PT_NUM) s.changeType(id, px, py, E[t].HighPressureTransition);
        else if (t === PT.BMTL) s.changeType(id, px, py, PT.BRMT);
        else if (t === PT.GLAS) s.changeType(id, px, py, PT.BGLA);
        else if (t === PT.COAL) s.changeType(id, px, py, PT.BCOL);
        else if (t === PT.QRTZ) s.changeType(id, px, py, PT.PQRT);
        else if (t === PT.TUNG) { s.changeType(id, px, py, PT.BRMT); s.ctype[id] = PT.TUNG; }
        else if (t === PT.WOOD) s.changeType(id, px, py, PT.SAWD);
      }
      return true;
    }
  }
};

export const conv: Hook = (s, i, x, y) => {
  const ctype = TYP(s.ctype[i]);
  if (ctype <= 0 || ctype >= PT_NUM || !E[ctype].Enabled || ctype === PT.CONV) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      const k = (y + ry) * s.XRES + x + rx, r = s.photons[k] || s.pmap[k];
      if (!r) continue;
      const rt = TYP(r);
      if (rt !== PT.CLNE && rt !== PT.PCLN && rt !== PT.BCLN && rt !== PT.STKM && rt !== PT.PBCN && rt !== PT.STKM2 && rt !== PT.CONV && rt < PT_NUM) {
        s.ctype[i] = rt;
        if (rt === PT.LIFE) s.ctype[i] |= s.ctype[ID(r)] << PMAPBITS;
      }
    }
  } else {
    const restrict = s.tmp[i] > 0 && s.tmp[i] < PT_NUM && E[s.tmp[i]].Enabled ? s.tmp[i] : 0;
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!(x + rx >= 0 && y + ry >= 0 && x + rx < s.XRES && y + ry < s.YRES)) continue;
      const k = (y + ry) * s.XRES + x + rx;
      let r = s.photons[k];
      if (!r || (restrict && (TYP(r) === restrict) === (s.tmp2[i] === 1))) r = s.pmap[k];
      if (!r || (restrict && (TYP(r) === restrict) === (s.tmp2[i] === 1))) continue;
      if (TYP(r) !== PT.CONV && TYP(r) !== PT.DMND && TYP(r) !== ctype) s.createPart(ID(r), x + rx, y + ry, TYP(s.ctype[i]), ID(s.ctype[i]));
    }
  }
};

export const mort: Hook = (s, _i, x, y) => { s.createPart(-1, x, y - 1, PT.SMKE); };

export const pvod: Hook = (s, i, x, y) => {
  if (s.life[i] > 0 && s.life[i] !== 10) s.life[i]--;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) === PT.SPRK) {
      if (s.life[rid] > 0 && s.life[rid] < 4) { if (s.ctype[rid] === PT.PSCN) s.life[i] = 10; else if (s.ctype[rid] === PT.NSCN) s.life[i] = 9; }
    } else if (TYP(r) === PT.PVOD) {
      if (s.life[i] === 10 && s.life[rid] < 10 && s.life[rid] > 0) s.life[i] = 9;
      else if (s.life[i] === 0 && s.life[rid] === 10) s.life[i] = 10;
    }
  }
};

export const lcry: Hook = (s, i, x, y) => {
  let check: number, setto: number;
  switch (s.tmp[i]) {
    case 1:
      if (s.life[i] <= 0) s.tmp[i] = 0; else { s.life[i] = Math.max(0, s.life[i] - 2); s.tmp2[i] = s.life[i]; }
      check = 3; setto = 1; break; // case 1 falls through to case 0
    case 0: check = 3; setto = 1; break;
    case 2:
      if (s.life[i] >= 10) s.tmp[i] = 3; else { s.life[i] = Math.min(10, s.life[i] + 2); s.tmp2[i] = s.life[i]; }
      check = 0; setto = 2; break;
    case 3: check = 0; setto = 2; break;
    default: s.tmp[i] = 0; s.life[i] = 0; return false;
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (r && TYP(r) === PT.LCRY && s.tmp[ID(r)] === check) s.tmp[ID(r)] = setto;
  }
};

export const hswc: Hook = (s, i, x, y) => {
  if (s.life[i] !== 10) { if (s.life[i] > 0) s.life[i]--; return; }
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = either(s, x, y, rx, ry);
    if (r && TYP(r) === PT.HSWC) {
      const rid = ID(r);
      if (s.life[rid] < 10 && s.life[rid] > 0) s.life[i] = 9; else if (s.life[rid] === 0) s.life[rid] = 10;
    }
  }
};

export const dlay: Hook = (s, i, x, y) => {
  const oldl = s.life[i];
  if (s.life[i] > 0) s.life[i]--;
  if (s.temp[i] <= 1 + 273.15) s.temp[i] = 1 + 273.15;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r), pavg = s.partsAvg(rid, i, PT.INSL);
    if (pavg === PT.INSL || pavg === PT.RSSS) continue;
    if (TYP(r) === PT.SPRK && s.life[i] === 0 && s.life[rid] > 0 && s.life[rid] < 4 && s.ctype[rid] === PT.PSCN) s.life[i] = Math.trunc(s.temp[i] - 273.15 + 0.5);
    else if (TYP(r) === PT.DLAY) {
      if (!s.life[i]) { if (s.life[rid]) { s.life[i] = s.life[rid]; if (rid > i) s.life[i]--; } }
      else if (!s.life[rid]) { s.life[rid] = s.life[i]; if (rid > i) s.life[rid]++; }
    } else if (TYP(r) === PT.NSCN && oldl === 1) s.createPart(-1, x + rx, y + ry, PT.SPRK);
  }
};
/* ---- pumps and sensors (PUMP/GPMP/TSNS/PSNS/DTEC/FRAY.cpp) ---- */

const SENSOR_SKIP = new Set<number>([PT.WATR, PT.SLTW, PT.NTCT, PT.PTCT, PT.INWR]);
function sparkNeighbours(s: PowderSim, i: number, x: number, y: number, useEither = false): void {
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = useEither ? either(s, x, y, rx, ry) : near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r), pavg = s.partsAvg(i, rid, PT.INSL);
    if (pavg !== PT.INSL && pavg !== PT.RSSS && (E[rt].Properties & PROP_CONDUCTS) && !SENSOR_SKIP.has(rt) && s.life[rid] === 0) {
      s.life[rid] = 4; s.ctype[rid] = rt; s.changeType(rid, x + rx, y + ry, PT.SPRK);
    }
  }
}
function setFilterChain(s: PowderSim, x: number, y: number, value: number): void {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    let r = near(s, x, y, rx, ry);
    if (!r) continue;
    let nx = x + rx, ny = y + ry;
    while (TYP(r) === PT.FILT) {
      s.ctype[ID(r)] = value;
      nx += rx; ny += ry;
      if (nx < 0 || ny < 0 || nx >= s.XRES || ny >= s.YRES) break;
      r = s.pmap[ny * s.XRES + nx];
    }
  }
}

export const pump: Hook = (s, i, x, y) => {
  if (s.life[i] !== 10) { if (s.life[i] > 0) s.life[i]--; return; }
  s.temp[i] = Math.min(MAX_PRESSURE + 273.15, Math.max(MIN_PRESSURE + 273.15, s.temp[i]));
  const c = s.cell(x, y), XC = s.XCELLS;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (s.tmp[i] !== 1) { if (!(rx && ry)) { const k = c + ry * XC + rx; s.pv[k] += 0.1 * ((s.temp[i] - 273.15) - s.pv[k]); } }
    else {
      const r = near(s, x, y, rx, ry);
      if (TYP(r) === PT.FILT) {
        const np = s.ctype[ID(r)] - 0x10000000;
        if (np >= 0 && np <= MAX_PRESSURE - MIN_PRESSURE) s.pv[s.cell(x + rx, y + ry)] = np + MIN_PRESSURE;
      }
    }
  }
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (r && TYP(r) === PT.PUMP) {
      const rid = ID(r);
      if (s.life[rid] < 10 && s.life[rid] > 0) s.life[i] = 9; else if (s.life[rid] === 0) s.life[rid] = 10;
    }
  }
};

/** GPMP: only the on/off propagation; the Newtonian gravity source it drives is not simulated. */
export const gpmp: Hook = (s, i, x, y) => {
  if (s.life[i] !== 10) { if (s.life[i] > 0) s.life[i]--; return; }
  s.temp[i] = Math.min(256 + 273.15, Math.max(-256 + 273.15, s.temp[i]));
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (r && TYP(r) === PT.GPMP) {
      const rid = ID(r);
      if (s.life[rid] < 10 && s.life[rid] > 0) s.life[i] = 9; else if (s.life[rid] === 0) s.life[rid] = 10;
    }
  }
};

export const tsns: Hook = (s, i, x, y) => {
  let rd = s.tmp2[i];
  if (rd > 25) s.tmp2[i] = rd = 25;
  if (s.life[i]) { s.life[i] = 0; sparkNeighbours(s, i, x, y, true); }
  let setFilt = false, wl = 0;
  for (let rx = -rd; rx <= rd; rx++) for (let ry = -rd; ry <= rd; ry++) {
    if (!(x + rx >= 0 && y + ry >= 0 && x + rx < s.XRES && y + ry < s.YRES && (rx || ry))) continue;
    const r = either(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (s.tmp[i] === 0 && rt !== PT.TSNS && rt !== PT.METL && s.temp[rid] > s.temp[i]) s.life[i] = 1;
    if (s.tmp[i] === 2 && rt !== PT.TSNS && rt !== PT.METL && s.temp[rid] < s.temp[i]) s.life[i] = 1;
    if (s.tmp[i] === 1 && rt !== PT.TSNS && rt !== PT.FILT) { setFilt = true; wl = Math.trunc(s.temp[rid]); }
  }
  if (setFilt) setFilterChain(s, x, y, 0x10000000 + wl);
};

export const psns: Hook = (s, i, x, y) => {
  const p = s.pv[s.cell(x, y)];
  if ((s.tmp[i] === 0 && p > s.temp[i] - 273.15) || (s.tmp[i] === 2 && p < s.temp[i] - 273.15)) sparkNeighbours(s, i, x, y);
  if (s.tmp[i] === 1) setFilterChain(s, x, y, 0x10000000 + Math.round(p) - MIN_PRESSURE);
};

export const dtec: Hook = (s, i, x, y) => {
  let rd = s.tmp2[i];
  if (rd > 25) s.tmp2[i] = rd = 25;
  if (s.life[i]) { s.life[i] = 0; sparkNeighbours(s, i, x, y); }
  let setFilt = false, wl = 0;
  for (let rx = -rd; rx < rd + 1; rx++) for (let ry = -rd; ry < rd + 1; ry++) {
    if (!(x + rx >= 0 && y + ry >= 0 && x + rx < s.XRES && y + ry < s.YRES && (rx || ry))) continue;
    const r = either(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === s.ctype[i] && (s.ctype[i] !== PT.LIFE || s.tmp[i] === s.ctype[rid] || !s.tmp[i])) s.life[i] = 1;
    if (rt === PT.PHOT || (rt === PT.BRAY && s.tmp[rid] !== 2) || rt === PT.BIZR || rt === PT.BIZRG || rt === PT.BIZRS) { setFilt = true; wl = s.ctype[rid]; }
  }
  if (setFilt) setFilterChain(s, x, y, wl);
};

export const fray: Hook = (s, i, x, y) => {
  const curlen = s.tmp[i] > 0 ? s.tmp[i] : 10;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    if (TYP(near(s, x, y, rx, ry)) !== PT.SPRK) continue;
    for (let nxx = 0, nyy = 0, nxi = -rx, nyi = -ry, len = 0; ; nyy += nyi, nxx += nxi, len++) {
      if (!(x + nxi + nxx < s.XRES && y + nyi + nyy < s.YRES && x + nxi + nxx >= 0 && y + nyi + nyy >= 0) || len > curlen) break;
      const r = either(s, x, y, nxi + nxx, nyi + nyy);
      if (r && !(E[TYP(r)].Properties & TYPE_SOLID)) {
        const coef = (s.temp[i] - 273.15) / 10, id = ID(r);
        s.vx[id] = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, s.vx[id] + nxi * coef));
        s.vy[id] = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, s.vy[id] + nyi * coef));
      }
    }
  }
};

/* ---- powered cloners, storage and the ARAY ray emitter (PCLN/PBCN/STOR/ARAY.cpp) ---- */
import { filtInteract } from '../optics';

function copyTarget(s: PowderSim, i: number, x: number, y: number, skip: number[]): void {
  if (s.ctype[i] > 0 && s.ctype[i] < PT_NUM && E[s.ctype[i]].Enabled) return;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    const k = (y + ry) * s.XRES + x + rx, r = s.photons[k] || s.pmap[k];
    if (!r) continue;
    const rt = TYP(r);
    if (!skip.includes(rt) && rt < PT_NUM) { s.ctype[i] = rt; if (rt === PT.LIFE || rt === PT.LAVA) s.tmp[i] = s.ctype[ID(r)]; }
  }
}
function emitClone(s: PowderSim, i: number, x: number, y: number): void {
  const ct = s.ctype[i];
  if (!(ct > 0 && ct < PT_NUM && E[ct].Enabled)) return;
  if (ct === PT.PHOT) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = s.createPart(-1, x + rx, y + ry, PT.PHOT);
      if (r !== -1) { s.vx[r] = rx * 3; s.vy[r] = ry * 3; if (r > i) s.flags[r] |= 2; }
    }
  } else if (ct === PT.LIFE) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) s.createPart(-1, x + rx, y + ry, PT.LIFE, s.tmp[i]);
  } else if (ct !== PT.LIGH || s.rng.chance(1, 30)) {
    const np = s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), TYP(ct));
    if (np >= 0 && ct === PT.LAVA && s.tmp[i] > 0 && s.tmp[i] < PT_NUM && E[s.tmp[i]].HighTemperatureTransition === PT.LAVA) s.ctype[np] = s.tmp[i];
  }
}
const CLONE_SKIP = [PT.CLNE, PT.PCLN, PT.BCLN, PT.SPRK, PT.NSCN, PT.PSCN, PT.STKM, PT.STKM2, PT.PBCN];

export const pcln: Hook = (s, i, x, y) => {
  if (s.life[i] > 0 && s.life[i] !== 10) s.life[i]--;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) === PT.SPRK) {
      if (s.life[rid] > 0 && s.life[rid] < 4) { if (s.ctype[rid] === PT.PSCN) s.life[i] = 10; else if (s.ctype[rid] === PT.NSCN) s.life[i] = 9; }
    } else if (TYP(r) === PT.PCLN) {
      if (s.life[i] === 10 && s.life[rid] < 10 && s.life[rid] > 0) s.life[i] = 9; else if (s.life[i] === 0 && s.life[rid] === 10) s.life[i] = 10;
    }
  }
  copyTarget(s, i, x, y, CLONE_SKIP);
  if (s.life[i] === 10) emitClone(s, i, x, y);
};

export const pbcn: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  if (!s.tmp2[i] && s.pv[c] > 4) s.tmp2[i] = s.rng.between(80, 119);
  if (s.tmp2[i]) {
    s.vx[i] += 0.1 * s.avx[c]; s.vy[i] += 0.1 * s.avy[c];
    if (!--s.tmp2[i]) { s.killPart(i); return true; }
  }
  copyTarget(s, i, x, y, CLONE_SKIP);
  if (s.life[i] !== 10) { if (s.life[i] > 0) s.life[i]--; return; }
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (r && TYP(r) === PT.PBCN) {
      const rid = ID(r);
      if (s.life[rid] < 10 && s.life[rid] > 0) s.life[i] = 9; else if (s.life[rid] === 0) s.life[rid] = 10;
    }
  }
  emitClone(s, i, x, y);
};

function releaseStored(s: PowderSim, src: number, x: number, y: number): boolean {
  for (let ry1 = 1; ry1 >= -1; ry1--) for (let rx1 = 0; rx1 >= -1 && rx1 <= 1; rx1 = -rx1 - rx1 + 1) {
    const np = s.createPart(-1, x + rx1, y + ry1, TYP(s.tmp[src]));
    if (np !== -1) {
      s.temp[np] = s.temp[src]; s.life[np] = s.tmp2[src]; s.tmp[np] = s.tmp3[src]; s.ctype[np] = s.tmp4[src];
      s.tmp[src] = 0; s.life[src] = 10;
      return true;
    }
  }
  return false;
}
export const stor: Hook = (s, i, x, y) => {
  if (!(s.tmp[i] === 0 || (s.tmp[i] > 0 && s.tmp[i] < PT_NUM && E[s.tmp[i]].Enabled))) s.tmp[i] = 0;
  if (s.life[i] && !s.tmp[i]) s.life[i]--;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = either(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r), rt = TYP(r);
    if (!s.tmp[i] && !s.life[i] && rt !== PT.STOR && !(E[rt].Properties & TYPE_SOLID) && (!s.ctype[i] || rt === s.ctype[i])) {
      s.tmp[i] = s.type[rid]; s.temp[i] = s.temp[rid]; s.tmp2[i] = s.life[rid]; s.tmp3[i] = s.tmp[rid]; s.tmp4[i] = s.ctype[rid];
      s.killPart(rid);
    }
    if (s.tmp[i] && rt === PT.SPRK && s.ctype[rid] === PT.PSCN && s.life[rid] > 0 && s.life[rid] < 4) releaseStored(s, i, x, y);
  }
};

export const aray: Hook = (s, i, x, y) => {
  const shortLife = s.life[i] > 0 ? s.life[i] : 30, longLife = s.life[i] > 0 ? s.life[i] : 1020;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const spark = near(s, x, y, rx, ry);
    if (!spark || TYP(spark) !== PT.SPRK || s.life[ID(spark)] !== 3) continue;
    const destroy = s.ctype[ID(spark)] === PT.PSCN, nostop = s.ctype[ID(spark)] === PT.INST;
    let colored = 0;
    for (let go = true, nxx = 0, nyy = 0; go; nyy += -ry, nxx += -rx) {
      const px = x - rx + nxx, py = y - ry + nyy;
      if (!(px < s.XRES && py < s.YRES && px >= 0 && py >= 0)) break;
      const r = s.pmap[py * s.XRES + px], rt = TYP(r), rid = ID(r);
      if (!rt) {
        const nr = s.createPart(-1, px, py, PT.BRAY);
        if (nr !== -1) {
          if (destroy) { s.tmp[nr] = 2; s.life[nr] = 2; } else { s.ctype[nr] = colored; s.life[nr] = shortLife; }
          s.temp[nr] = s.temp[i];
        }
      } else if (!destroy) {
        if (rt === PT.BRAY) {
          switch (s.tmp[rid]) {
            case 0:
              if (nyy !== 0 || nxx !== 0) { s.life[rid] = longLife; s.tmp[rid] = 1; if (!s.ctype[rid]) s.ctype[rid] = colored; }
              go = false; break;
            case 1: s.life[rid] = longLife; break;
            default: go = false;
          }
        } else if (rt === PT.FILT) {
          if (s.tmp[rid] !== 6) { colored = filtInteract(s, rid, colored); if (!colored) break; }
          s.life[rid] = 4;
        } else if (rt === PT.STOR) {
          if (s.tmp[rid]) releaseStored(s, rid, px, py); else s.life[rid] = 10;
        } else if (rt !== PT.INWR && (rt !== PT.SPRK || s.ctype[rid] !== PT.INWR) && rt !== PT.ARAY && rt !== PT.WIFI && !(rt === PT.SWCH && s.life[rid] >= 10)) {
          if (nyy !== 0 || nxx !== 0) s.createPart(-1, px, py, PT.SPRK);
          go = nostop && s.type[rid] === PT.SPRK && s.ctype[rid] >= 0 && s.ctype[rid] < PT_NUM && !!(E[s.ctype[rid]].Properties & PROP_CONDUCTS);
        }
      } else {
        if (rt === PT.BRAY) { s.tmp[rid] = 2; s.life[rid] = 1; go = true; }
        else if (rt === PT.STOR || rt === PT.INWR || (rt === PT.SPRK && s.ctype[rid] === PT.INWR) || rt === PT.ARAY || rt === PT.WIFI || rt === PT.FILT || (rt === PT.SWCH && s.life[rid] >= 10)) {
          if (rt === PT.STOR) { s.tmp[rid] = 0; s.life[rid] = 0; } else if (rt === PT.FILT) s.life[rid] = 2;
          go = true;
        } else go = false;
      }
    }
  }
};
