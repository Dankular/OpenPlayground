/* Glass, crystals, metals and reactive chemicals. Ported from YEST/BRMT/GLAS/CLST/QRTZ/BREC/SLCN/LITH/BASE/RFRG/HEAC/
 * PTNM/CRMC.cpp, The Powder Toy (GPL-3.0). */
import { ELEMENTS, ID, PROP_CONDUCTS, PT, TYP, TYPE_SOLID } from '../elements';
import type { PowderSim } from '../sim';
import { restrictTemp } from '../sim';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
const near = (s: PowderSim, x: number, y: number, rx: number, ry: number) => s.pmap[(y + ry) * s.XRES + x + rx];

export const yest: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (r && TYP(r) === PT.DYST && s.rng.chance(1, 6) && !s.legacyEnable) s.changeType(i, x, y, PT.DYST);
  }
  if (s.temp[i] > 303 && s.temp[i] < 317) s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), PT.YEST);
};

export const brmt: Hook = (s, i, x, y) => {
  if (s.temp[i] > 523.15) {
    const tempFactor = Math.max(2, Math.trunc(1000 - (523.15 - s.temp[i]) * 2));
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (r && TYP(r) === PT.BREC && s.rng.chance(1, tempFactor)) {
        if (s.rng.chance(1, 2)) s.createPart(ID(r), x + rx, y + ry, PT.THRM); else s.createPart(i, x, y, PT.THRM);
      }
    }
  }
};

export const glas: Hook = (s, i, x, y) => {
  const c = s.cell(x, y), press = Math.trunc(s.pv[c] * 64), diff = press - s.tmp3[i];
  const strength = Math.max(16, Math.trunc(s.life[i] / 120) + 16);
  if (diff > strength || diff < -strength) s.changeType(i, x, y, PT.BGLA);
  s.tmp3[i] = press;
  if (strength > 200 && s.temp[i] < 77 && s.hv[c] < 77 && s.pv[c] > 5 && s.rng.chance(1, 100)) {
    const adj = s.rng.between(0, 3);
    const rx = (1 - 2 * (adj % 2)) * (1 - Math.trunc(adj / 2)), ry = (1 - 2 * (adj % 2)) * Math.trunc(adj / 2);
    if (!near(s, x, y, rx, ry) && s.createPart(-1, x + rx, y + ry, PT.LNTG) > -1) { s.pv[c] -= 1; s.temp[i] += 200; }
  }
};

export const clst: Hook = (s, i, x, y) => {
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r);
    if (rt === PT.WATR) {
      if (s.rng.chance(1, 1500)) { s.createPart(i, x, y, PT.PSTS); s.killPart(ID(r)); }
    } else if (rt === PT.NITR) { s.createPart(i, x, y, PT.BANG); s.createPart(ID(r), x + rx, y + ry, PT.BANG); }
    else if (rt === PT.CLST) {
      const t = s.temp[i], cxy = t < 195 ? 0.05 : t < 295 ? 0.015 : t < 350 ? 0.01 : 0.005;
      s.vx[i] += cxy * rx; s.vy[i] += cxy * ry;
    }
  }
};

/** QRTZ and PQRT */
export const qrtz: Hook = (s, i, x, y) => {
  const t = s.type[i];
  if (t === PT.QRTZ) {
    const press = Math.trunc(s.pv[s.cell(x, y)] * 64), tol = s.temp[i] * 1.0666;
    if (press - s.tmp3[i] > tol || press - s.tmp3[i] < -tol) { s.changeType(i, x, y, PT.PQRT); s.life[i] = 5; }
    s.tmp3[i] = press;
  }
  if (s.life[i] > 5) s.life[i] = 5;
  if (s.tmp[i] !== -1) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (r && TYP(r) === PT.SLTW && s.rng.chance(1, 500)) { s.killPart(ID(r)); s.tmp[i]++; }
    }
  }
  if (s.tmp[i] > 0 && s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i] < 0.2 && s.life[i] <= 0) {
    let stopgrow = false;
    for (let trade = 0; trade < 9; trade++) {
      let rnd = s.rng.gen() % 0x3ff;
      const rx = (rnd % 5) - 2, srx = (rnd % 3) - 1;
      rnd >>= 3;
      const ry = (rnd % 5) - 2, sry = (rnd % 3) - 1;
      if (!rx && !ry) continue;
      if (!stopgrow && !near(s, x, y, srx, sry) && s.tmp[i] !== 0) {
        const np = s.createPart(-1, x + srx, y + sry, PT.QRTZ);
        if (np > -1) {
          s.temp[np] = s.temp[i]; s.tmp2[np] = s.tmp2[i];
          if (s.rng.chance(1, 2)) s.tmp2[np] = Math.min(10, Math.max(0, s.tmp2[np] + s.rng.between(-1, 1)));
          s.tmp[i]--;
          if (t === PT.PQRT) s.changeType(i, x, y, PT.QRTZ);
          if (s.rng.chance(1, 2)) s.tmp[np] = -1;
          else if (!s.tmp[i] && s.rng.chance(1, 15)) s.tmp[i] = -1;
          stopgrow = true;
        }
      }
      const r = near(s, x, y, rx, ry);
      if (!r) continue;
      const rid = ID(r);
      if (TYP(r) === PT.QRTZ && s.tmp[i] > s.tmp[rid] && s.tmp[rid] >= 0) {
        const d = s.tmp[i] - s.tmp[rid];
        if (d === 1) { s.tmp[rid]++; s.tmp[i]--; break; }
        if (d > 0) { s.tmp[rid] += Math.trunc(d / 2); s.tmp[i] -= Math.trunc(d / 2); break; }
      }
    }
  }
};

export const brec: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  if (s.life[i] && s.pv[c] > 10) {
    if (s.temp[i] > 9000 && s.pv[c] > 30 && s.rng.chance(1, 200)) { s.changeType(i, x, y, PT.EXOT); s.life[i] = 1000; }
    s.temp[i] += s.pv[c] / 8;
  }
};

/** SLCN sparkle phase lives in tmp: bits 31-20 phase increment, 19-16 next colour, 15-12 current colour, 11-0 phase. */
export const initSparkles = (s: PowderSim, i: number) => { s.tmp[i] = s.rng.between(0x100000, 0x9fffff); };
export const slcn: Hook = (s, i, x, y) => {
  if (!s.tmp[i]) initSparkles(s, i);
  const tmp = s.tmp[i], phase = (tmp & 0xfff) + ((tmp >> 20) & 0xfff);
  if (phase & 0x1000) s.tmp[i] = (tmp & 0xfff00000) | (phase & 0xfff) | (s.rng.between(0, 15) << 16) | ((tmp >> 4) & 0xf000);
  else s.tmp[i] = (tmp & 0xfffff000) | phase;
  if (s.life[i] === 0 && s.temp[i] < 373.15) {
    const cx = [-4, 4, 0, 0], cy = [0, 0, -4, 4];
    for (let j = 0; j < 4; j++) {
      const n = near(s, x, y, cx[j], cy[j]);
      if (n && TYP(n) === PT.SPRK && s.life[ID(n)] !== 0 && s.life[ID(n)] < 4) { s.changeType(i, x, y, PT.SPRK); s.life[i] = 4; s.ctype[i] = PT.SLCN; }
    }
  }
};

export const lith: Hook = (s, i, x, y) => {
  // tmp: hydrogenation, life: burn timer, tmp2: carbonation, ctype: stored energy
  if (s.ctype[i] < 0) s.ctype[i] = 0;
  let charged = false, discharged = false;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const n = near(s, x, y, rx, ry);
    if (!n) { if (s.life[i] > 1012 && s.rng.chance(1, 10)) s.createPart(-1, x + rx, y + ry, PT.FIRE); continue; }
    const nid = ID(n), pavg = s.partsAvg(i, nid, PT.INSL);
    switch (TYP(n)) {
      case PT.SLTW: case PT.WTRV: case PT.WATR: case PT.DSTW: case PT.CBNW:
        if (s.life[i] > 1016) { s.changeType(nid, x + rx, y + ry, PT.WTRV); s.temp[nid] = 440; continue; }
        if (s.tmp[i] + s.tmp2[i] >= 10) continue;
        if (s.temp[i] > 440) { s.life[i] = 1024 + (s.ctype[i] > 24 ? 96 : s.ctype[i] * 4); s.changeType(nid, x + rx, y + ry, PT.H2); s.tmp[i] = 10; }
        else { s.temp[i] = restrictTemp(s.temp[i] + 20.365 + s.ctype[i] * s.ctype[i] * 1.5); s.changeType(nid, x + rx, y + ry, PT.H2); s.tmp[i] += 1; }
        break;
      case PT.CO2:
        if (s.tmp[i] + s.tmp2[i] >= 10) continue;
        s.killPart(nid); s.tmp2[i] += 1;
        break;
      case PT.SPRK:
        if (pavg === PT.INSL || pavg === PT.RSSS) break;
        if (s.tmp[i] + s.tmp2[i] >= 5) continue;
        if (s.ctype[nid] === PT.PSCN && s.life[nid] === 3 && !charged && !s.life[i]) charged = true;
        break;
      case PT.NSCN:
        if (pavg === PT.INSL || pavg === PT.RSSS) break;
        if (s.life[nid] === 0 && s.ctype[i] > 0 && !s.life[i]) { s.changeType(nid, x + rx, y + ry, PT.SPRK); s.life[nid] = 4; s.ctype[nid] = PT.NSCN; discharged = true; }
        break;
      case PT.FIRE:
        if (s.temp[i] > 440 && s.rng.chance(1, 40) && s.tmp[i] < 6) { s.life[i] = 1013; s.tmp[i] += 1; }
        break;
      case PT.O2:
        if (s.life[i] > 1000 && s.rng.chance(1, 10)) {
          s.changeType(i, x, y, PT.PLSM); s.changeType(nid, x + rx, y + ry, PT.PLSM); s.pv[s.cell(x, y)] += 4;
          return false;
        }
        break;
    }
  }
  if (charged) { s.ctype[i] += 1; s.life[i] = 8; }
  if (discharged) { s.ctype[i] -= 1; s.life[i] = 8; }
  for (let trade = 0; trade < 9; trade++) {
    const rx = s.rng.between(-3, 3), ry = s.rng.between(-3, 3);
    if (!rx && !ry) continue;
    const n = near(s, x, y, rx, ry);
    if (TYP(n) !== PT.LITH) continue;
    const nid = ID(n);
    if (s.life[i] < 1000 && s.ctype[i] > 90 && s.life[nid] > 1000) s.life[i] = 1024;
    if (s.ctype[i] > s.ctype[nid]) {
      let transfer = s.ctype[i] - s.ctype[nid];
      transfer -= Math.trunc(transfer / 2);
      s.ctype[nid] += transfer; s.ctype[i] -= transfer;
      break;
    }
  }
  if (s.life[i] < 1000 && s.ctype[i] >= 100) s.life[i] = 1024;
  if (s.life[i] === 1000) {
    s.life[i] = 0; s.changeType(i, x, y, PT.LAVA);
    if (s.tmp2[i] < 3) { s.temp[i] = restrictTemp(500 + s.ctype[i] * 10); s.ctype[i] = PT.LITH; }
    else { s.temp[i] = restrictTemp(2000 + s.ctype[i] * 10); s.ctype[i] = PT.GLAS; }
  }
};

export const base: Hook = (s, i, x, y) => {
  s.tmp[i] = 0;
  if (s.life[i] < 1) s.life[i] = 1;
  if (s.life[i] > 100) s.life[i] = 100;
  const c = s.cell(x, y), pres = s.pv[c];
  if (s.life[i] < 100 && pres < 10 && s.temp[i] > 120 + 273.15 && s.rng.chance(1, 20)) {
    if (s.rng.chance(1, s.life[i] + 1)) { s.createPartTempVel(i, x, y, PT.BOYL); return true; }
    s.life[i]++; s.temp[i] -= 20 / s.life[i];
  }
  if (s.temp[i] < 273.15 - s.life[i] / 4) {
    s.createPartTempVel(i, x, y, PT.ICEI); s.ctype[i] = PT.BASE; s.life[i] = 0; return true;
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r), px = x + rx, py = y + ry;
    if (rt === PT.BASE || rt === PT.SALT || rt === PT.SLTW || rt === PT.BOYL || rt === PT.MERC || rt === PT.BMTL || rt === PT.BRMT || rt === PT.SOAP || rt === PT.CLNE || rt === PT.PCLN ||
      (rt === PT.ICEI && s.ctype[rid] === PT.BASE) || (rt === PT.SNOW && s.ctype[rid] === PT.BASE) ||
      (rt === PT.SPRK && s.ctype[rid] === PT.BMTL) || (rt === PT.SPRK && s.ctype[rid] === PT.BRMT)) continue;
    if (s.life[i] > 1 && (rt === PT.WATR || rt === PT.DSTW || rt === PT.CBNW)) {
      if (s.rng.chance(1, 20)) {
        const sat = Math.trunc(s.life[i] / 2);
        s.createPartTempVel(rid, px, py, PT.BASE); s.life[rid] = sat; s.temp[rid] += sat / 10; s.life[i] -= sat;
      }
    } else if (rt === PT.ACID) {
      if (s.life[rid] > 50 && s.life[i] > 0) { s.life[rid]--; s.life[i]--; }
      if (s.life[rid] <= 50) s.createPartTempVel(rid, px, py, PT.SLTW);
      if (s.life[i] <= 0) { s.createPartTempVel(i, x, y, PT.SLTW); return true; }
    } else if (rt === PT.CAUS) {
      if (s.life[rid] > 50 && s.life[i] > 0) { s.life[rid]--; s.life[i]--; }
      if (s.life[rid] <= 50) s.killPart(rid);
      if (s.life[i] <= 0) { s.createPartTempVel(i, x, y, PT.SLTW); return true; }
    } else if (s.life[i] >= 70 && rt === PT.OIL) { s.createPartTempVel(i, x, y, PT.SOAP); s.killPart(rid); return true; }
    else if (s.life[i] > 1 && rt === PT.GOO) { s.createPartTempVel(rid, px, py, PT.GEL); s.life[i]--; }
    else if (s.life[i] > 1 && rt === PT.BCOL) { s.createPartTempVel(rid, px, py, PT.GUNP); s.life[i]--; }
    else if (rt === PT.LAVA && s.ctype[rid] === PT.ROCK && pres >= 10 && s.rng.chance(1, 1000)) { s.createPartTempVel(i, x, y, PT.MERC); s.killPart(rid); return true; }
    else if (s.life[i] >= 10 && (E[rt].Properties & (TYPE_SOLID | PROP_CONDUCTS)) === (TYPE_SOLID | PROP_CONDUCTS) && s.rng.chance(1, 10)) {
      s.createPartTempVel(rid, px, py, PT.BMTL); s.tmp[rid] = s.rng.between(20, 29); s.life[i]--; s.tmp[i] = 1;
    } else if (E[rt].Hardness > 0 && E[rt].Hardness < 50 && s.life[i] >= 2 * E[rt].Hardness && s.rng.chance(50 - E[rt].Hardness, 1000)) {
      s.killPart(rid); s.life[i] -= 2; s.tmp[i] = 1;
    }
  }
  for (let trade = 0; trade < 2; trade++) {
    const rx = s.rng.between(-1, 1), ry = s.rng.between(-1, 1);
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) === PT.BASE && s.life[i] > s.life[rid] && s.life[i] > 1) {
      const d = s.life[i] - s.life[rid];
      if (d === 1) { s.life[rid]++; s.life[i]--; } else if (d > 0) { s.life[rid] += Math.trunc(d / 2); s.life[i] -= Math.trunc(d / 2); }
    }
  }
};

const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
/** RFRG / RFGL: tmp holds the previous pressure as a float bit pattern. */
export const rfrg: Hook = (s, i, x, y) => {
  const np = s.pv[s.cell(x, y)];
  i32[0] = s.tmp[i];
  const old = f32[0];
  if (Number.isNaN(old)) { f32[0] = np; s.tmp[i] = i32[0]; return false; }
  s.temp[i] = restrictTemp(s.temp[i] * ((np + 257) / (old + 257)));
  f32[0] = np; s.tmp[i] = i32[0];
};

/** CheckLine from HEAC.cpp: true if `pred` holds for any pmap entry along the Bresenham-like line. */
function checkLine(s: PowderSim, x1: number, y1: number, x2: number, y2: number, pred: (p: number) => boolean): boolean {
  const rev = Math.abs(y2 - y1) > Math.abs(x2 - x1);
  if (rev) { [x1, y1] = [y1, x1]; [x2, y2] = [y2, x2]; }
  if (x1 > x2) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
  const dx = x2 - x1, dy = Math.abs(y2 - y1), de = dx ? dy / dx : 0, sy = y1 < y2 ? 1 : -1;
  let e = 0, y = y1;
  const at = (a: number, b: number) => (rev ? s.pmap[a * s.XRES + b] : s.pmap[b * s.XRES + a]);
  for (let x = x1; x <= x2; x++) {
    if (pred(at(x, y))) return true;
    e += de;
    if (e >= 0.5) { y += sy; if (y1 < y2 ? y <= y2 : y >= y2) { if (pred(at(x, y))) return true; } e -= 1; }
  }
  return false;
}
export const heac: Hook = (s, i, x, y) => {
  const rad = 4;
  let cHeat = 0, hcTotal = 0;
  const blocked = (p: number) => !!p && s.isHeatInsulator(ID(p));
  const reach: [number, number][] = [];
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    const rrx = rx * rad, rry = ry * rad;
    if (x + rrx >= 0 && x + rrx < s.XRES && y + rry >= 0 && y + rry < s.YRES && !checkLine(s, x, y, x + rrx, y + rry, blocked)) {
      reach.push([x + rrx, y + rry]);
      for (const map of [s.pmap, s.photons]) {
        const r = map[(y + rry) * s.XRES + x + rrx];
        if (r && !s.isHeatInsulator(ID(r))) { const hc = s.heatCapacityOf(ID(r)); cHeat += s.temp[ID(r)] * hc; hcTotal += hc; }
      }
    }
  }
  if (hcTotal > 0) {
    const pt = restrictTemp(cHeat / hcTotal);
    s.temp[i] = pt;
    for (const [px, py] of reach) for (const map of [s.pmap, s.photons]) {
      const r = map[py * s.XRES + px];
      if (r && !s.isHeatInsulator(ID(r))) s.temp[ID(r)] = pt;
    }
  }
};

export const ptnm: Hook = (s, i, x, y) => {
  let hygn = -1, wtrv = -1;
  if (!s.life[i]) {
    const cx = [-4, 4, 0, 0], cy = [0, 0, -4, 4];
    for (let j = 0; j < 4; j++) {
      const r = near(s, x, y, cx[j], cy[j]);
      if (r && TYP(r) === PT.SPRK && s.life[ID(r)] && s.life[ID(r)] < 4) { s.changeType(i, x, y, PT.SPRK); s.life[i] = 4; s.ctype[i] = PT.PTNM; }
    }
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r), px = x + rx, py = y + ry;
    if (rt === PT.H2 && hygn < 0) hygn = rid;
    if (rt === PT.WTRV && wtrv < 0) wtrv = rid;
    if (!s.life[rid] && (rt === PT.SHLD1 || rt === PT.SHLD2 || rt === PT.SHLD3)) {
      const next = rt === PT.SHLD1 ? PT.SHLD2 : rt === PT.SHLD2 ? PT.SHLD3 : PT.SHLD4;
      s.changeType(rid, px, py, next); s.life[rid] = 7; continue;
    }
    if (rt === PT.ISZS || rt === PT.ISOZ) { s.changeType(rid, px, py, PT.PLUT); s.createPart(-3, px, py, PT.PHOT); continue; }
    let prob = Math.min(1, s.temp[i] / (273.15 + 1500)); prob *= prob;
    if (s.rng.uniform01() <= prob) {
      switch (rt) {
        case PT.GAS:
          if (s.temp[rid] >= 200 + 273.15 && s.pv[s.cell(px, py)] > 2) { s.changeType(rid, px, py, PT.INSL); s.temp[i] += 60; }
          break;
        case PT.BREC:
          if (s.temp[rid] > 1000 + 273.15 && s.pv[s.cell(px, py)] > 50) { s.changeType(rid, px, py, PT.EXOT); s.temp[rid] -= 30; s.temp[i] -= 30; }
          break;
        case PT.SMKE: s.changeType(rid, px, py, PT.CO2); break;
        case PT.RSST: s.createPart(rid, px, py, PT.BIZR); break;
      }
    }
  }
  if (hygn >= 0) hygnReactions(s, i, x, y, hygn);
  if (wtrv >= 0) wtrvReactions(s, x, y, wtrv);
};
function wtrvReactions(s: PowderSim, x: number, y: number, wtrv: number): void {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r || ID(r) === wtrv) continue;
    if (TYP(r) === PT.BCOL && s.temp[ID(r)] > 200 + 273.15 && s.temp[wtrv] > 200 + 273.15 && s.pv[s.cell(x + rx, y + ry)] > 7) {
      s.changeType(ID(r), x + rx, y + ry, PT.OIL); s.killPart(wtrv); return;
    }
  }
}
function hygnReactions(s: PowderSim, i: number, x: number, y: number, h: number): void {
  const hx = (s.x[h] + 0.5) | 0, hy = (s.y[h] + 0.5) | 0;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r || ID(r) === h) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.DESL) { s.changeType(rid, x + rx, y + ry, PT.WATR); s.changeType(h, hx, hy, PT.OIL); return; }
    if (rt === PT.O2 && !s.life[i]) {
      s.changeType(rid, x + rx, y + ry, PT.DSTW); s.changeType(h, hx, hy, PT.DSTW);
      s.temp[rid] += 5; s.temp[h] += 5;
      s.ctype[i] = PT.PTNM; s.life[i] = 4; s.changeType(i, x, y, PT.SPRK);
      return;
    }
    if (rt === PT.H2 && s.rng.chance(1, 1000) && s.temp[rid] > 500 + 273.15 && s.temp[h] > 500 + 273.15) {
      s.changeType(rid, x + rx, y + ry, PT.NBLE); s.changeType(h, hx, hy, PT.NEUT);
      s.temp[rid] += 1000; s.temp[h] += 1000; s.pv[s.cell(x + rx, y + ry)] += 10;
      let j = s.createPart(-3, x + rx, y + ry, PT.PHOT);
      if (j > -1) { s.ctype[j] = 0x7c0000; s.temp[j] = s.temp[rid]; s.tmp[j] = 1; }
      if (s.rng.chance(1, 10)) { j = s.createPart(-3, x + rx, y + ry, PT.ELEC); if (j > -1) s.temp[j] = s.temp[rid]; }
      return;
    }
  }
}

export const crmc: Hook = (s, i, x, y) => {
  const orig = s.temp[i];
  if (s.pv[s.cell(x, y)] < -30) s.createPart(i, x, y, PT.CLST);
  s.temp[i] = orig;
};
/** RSST (resist liquid) and RSSS (resist solid): copy ctype/tmp from nearby cloners; RSST also reacts with GUNP/BCOL. */
const resist = (self: number, liquid: boolean): Hook => (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (liquid && rt === PT.GUNP) { s.createPart(i, x, y, PT.FIRW); s.killPart(rid); return true; }
    if (liquid && rt === PT.BCOL) { s.createPart(i, x, y, PT.FSEP); s.life[i] = 50; s.killPart(rid); return true; }
    if ((rt === PT.CLNE || rt === PT.PCLN) && s.ctype[rid] !== self) s.ctype[i] = s.ctype[rid];
    if ((rt === PT.BCLN || rt === PT.PBCN) && s.ctype[rid] !== self) s.tmp[i] = s.ctype[rid];
  }
  if (!liquid) { const c = s.cell(x, y); s.blockAir[c] = 1; s.blockAirH[c] = 8; }
};
export const rsst = resist(PT.RSST, true), rsss = resist(PT.RSSS, false);
