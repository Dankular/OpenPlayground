/* Absorbing, cloning and sticky materials: GLOW, MERC, GEL, SPNG, CLNE, BCLN. Ported from the same-named
 * src/simulation/elements/*.cpp files of The Powder Toy (GPL-3.0). */
import { ELEMENTS, ID, PT, PT_NUM, TYP, TYPE_LIQUID, TYPE_PART } from '../elements';
import type { PowderSim } from '../sim';
import { restrictTemp } from '../sim';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
const near = (s: PowderSim, x: number, y: number, rx: number, ry: number) => s.pmap[(y + ry) * s.XRES + x + rx];

export const glow: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    if (TYP(r) === PT.WATR && s.rng.chance(1, 400)) {
      s.killPart(i); s.changeType(ID(r), x + rx, y + ry, PT.DEUT); s.life[ID(r)] = 10; return true;
    } else if (TYP(r) === PT.GEL) {
      s.killPart(i); s.changeType(ID(r), x + rx, y + ry, PT.RSST); s.tmp[ID(r)] = 0; return true;
    }
  }
  const c = s.cell(x, y);
  s.ctype[i] = Math.max(0, Math.trunc(s.pv[c] * 16));
  s.tmp[i] = Math.abs(Math.trunc((s.avx[c] + s.avy[c]) * 16)) + Math.abs(Math.trunc((s.vx[i] + s.vy[i]) * 64));
};

export const merc: Hook = (s, i, x, y) => {
  const absorb = 10000;
  s.temp[i] = restrictTemp(s.temp[i]);
  let maxtmp = Math.trunc(absorb / (s.temp[i] + 1)) - 1;
  const it1 = Math.max(1, Math.trunc(s.temp[i]) + 1);
  if (s.rng.chance(absorb % it1, it1)) maxtmp++;
  if (s.tmp[i] < 0) s.tmp[i] = 0;
  if (s.tmp[i] > absorb) s.tmp[i] = absorb;
  if (s.tmp[i] < maxtmp) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (!r || s.tmp[i] >= maxtmp) continue;
      if (TYP(r) === PT.MERC && s.rng.chance(1, 3) && s.tmp[i] + s.tmp[ID(r)] + 1 <= maxtmp) { s.tmp[i] += s.tmp[ID(r)] + 1; s.killPart(ID(r)); }
    }
  } else {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (s.tmp[i] <= maxtmp) continue;
      if (!r && s.tmp[i] >= 1) {
        const np = s.createPart(-1, x + rx, y + ry, PT.MERC);
        if (np < 0) continue;
        s.tmp[i]--; s.temp[np] = s.temp[i]; s.tmp[np] = 0;
      }
    }
  }
  for (let trade = 0; trade < 4; trade++) {
    const rx = s.rng.between(-2, 2), ry = s.rng.between(-2, 2);
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) === PT.MERC && s.tmp[i] > s.tmp[rid] && s.tmp[i] > 0) {
      const d = s.tmp[i] - s.tmp[rid];
      if (d === 1) { s.tmp[rid]++; s.tmp[i]--; } else if (d > 0) { s.tmp[rid] += Math.trunc(d / 2); s.tmp[i] -= Math.trunc(d / 2); }
    }
  }
};

export const gel: Hook = (s, i, x, y) => {
  if (s.tmp[i] > 100) s.tmp[i] = 100;
  if (s.tmp[i] < 0) s.tmp[i] = 0;
  const denom = s.tmp[i] * 10 + 500;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    let isGel = false;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r), px = x + rx, py = y + ry;
    switch (rt) {
      case PT.WATR: case PT.DSTW: case PT.FRZW:
        if (s.tmp[i] < 100 && s.rng.chance(500, denom)) { s.tmp[i]++; s.killPart(rid); }
        break;
      case PT.PSTE:
        if (s.tmp[i] < 100 && s.rng.chance(20, denom)) { s.tmp[i]++; s.createPart(rid, px, py, PT.CLST); }
        break;
      case PT.SLTW:
        if (s.tmp[i] < 100 && s.rng.chance(50, denom)) { s.tmp[i]++; if (s.rng.chance(3, 4)) s.killPart(rid); else s.changeType(rid, px, py, PT.SALT); }
        break;
      case PT.CBNW:
        if (s.tmp[i] < 100 && s.rng.chance(100, denom)) { s.tmp[i]++; s.changeType(rid, px, py, PT.CO2); }
        break;
      case PT.SPNG:
        if (s.life[rid] > 0 && s.tmp[i] < 100 && s.life[rid] + 1 > s.tmp[i]) { s.life[rid]--; s.tmp[i]++; }
        else if (s.tmp[i] > 0 && s.life[rid] + 1 < s.tmp[i]) { s.life[rid]++; s.tmp[i]--; }
        break;
      case PT.GEL:
        if (s.tmp[rid] + 1 < s.tmp[i]) { s.tmp[rid]++; s.tmp[i]--; }
        isGel = true;
        break;
      case PT.BASE:
        if (s.tmp[i] > 0 && s.life[rid] > 1) { s.life[rid]--; s.tmp[i]--; }
        break;
    }
    let dx = s.x[i] - s.x[rid], dy = s.y[i] - s.y[rid];
    if (dx * dx + dy * dy > 1.5 && (isGel || !E[rt].Falldown || (Math.abs(rx) < 2 && Math.abs(ry) < 2))) {
      const nd = dx * dx + dy * dy - 0.5;
      let per = 5 * (1 - s.tmp[i] / 100) * (nd / (dx * dx + dy * dy + nd) - 0.5);
      if (E[rt].Properties & TYPE_LIQUID) per *= 0.1;
      dx *= per; dy *= per;
      s.vx[i] += dx; s.vy[i] += dy;
      if ((E[rt].Properties & TYPE_PART) || rt === PT.GOO) { s.vx[rid] -= dx; s.vy[rid] -= dy; }
    }
  }
};

export const spng: Hook = (s, i, x, y) => {
  const limit = 50, c = s.cell(x, y);
  if (s.life[i] < limit && s.pv[c] <= 3 && s.pv[c] >= -3 && s.temp[i] <= 374) {
    const denom = Math.trunc(s.life[i] * 10000 / limit) + 500;
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry), rid = ID(r);
      switch (TYP(r)) {
        case PT.WATR: case PT.DSTW: case PT.FRZW:
          if (s.life[i] < limit && s.rng.chance(500, denom)) { s.life[i]++; s.killPart(rid); }
          break;
        case PT.SLTW:
          if (s.life[i] < limit && s.rng.chance(50, denom)) { s.life[i]++; if (s.rng.chance(3, 4)) s.killPart(rid); else s.changeType(rid, x + rx, y + ry, PT.SALT); }
          break;
        case PT.CBNW:
          if (s.life[i] < limit && s.rng.chance(100, denom)) { s.life[i]++; s.changeType(rid, x + rx, y + ry, PT.CO2); }
          break;
        case PT.PSTE:
          if (s.life[i] < limit && s.rng.chance(20, denom)) { s.life[i]++; s.createPart(rid, x + rx, y + ry, PT.CLST); }
          break;
      }
    }
  } else {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      if (!near(s, x, y, rx, ry) && s.life[i] >= 1 && s.createPart(-1, x + rx, y + ry, PT.WATR) > -1) s.life[i]--;
    }
  }
  for (let trade = 0; trade < 9; trade++) {
    const rx = s.rng.between(-2, 2), ry = s.rng.between(-2, 2);
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) === PT.SPNG && s.life[i] > s.life[rid] && s.life[i] > 0) {
      const d = s.life[i] - s.life[rid];
      if (d === 1) { s.life[rid]++; s.life[i]--; trade = 9; }
      else if (d > 0) { s.life[rid] += Math.trunc(d / 2); s.life[i] -= Math.trunc(d / 2); trade = 9; }
    }
  }
  let burning = 0;
  if (s.life[i] > 0) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (r && TYP(r) === PT.FIRE) {
        burning++;
        const f = ID(r);
        if (s.life[f] > 60) s.life[f] -= Math.trunc(s.life[f] / 60); else if (s.life[f] > 2) s.life[f]--;
      }
    }
  }
  if (burning && s.life[i] > 3) s.life[i] -= Math.trunc(s.life[i] / 3);
  if (burning > 1) burning = Math.trunc(burning / 2);
  if (burning || s.temp[i] >= 374) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      if (!near(s, x, y, rx, ry) && s.life[i] >= 1) {
        const np = s.createPart(-1, x + rx, y + ry, PT.WTRV);
        if (np > -1) { s.temp[np] = s.temp[i]; burning--; s.life[i]--; s.temp[i] = restrictTemp(s.temp[i] - 20); }
      }
    }
  }
  if (burning > 0) s.life[i] = s.life[i] > burning ? s.life[i] - burning : 0;
};

/** CLNE and BCLN share logic; BCLN additionally drifts with air once its life is set. */
const cloner = (bulk: boolean): Hook => (s, i, x, y) => {
  if (bulk) {
    const c = s.cell(x, y);
    if (!s.life[i] && s.pv[c] > 4) s.life[i] = s.rng.between(80, 119);
    if (s.life[i]) { s.vx[i] += 0.1 * s.avx[c]; s.vy[i] += 0.1 * s.avy[c]; }
  }
  const ct = s.ctype[i];
  if (ct <= 0 || ct >= PT_NUM || !E[ct].Enabled) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      const k = (y + ry) * s.XRES + x + rx;
      const r = s.photons[k] || s.pmap[k];
      if (!r) continue;
      const rt = TYP(r);
      if (rt !== PT.CLNE && rt !== PT.PCLN && rt !== PT.BCLN && rt !== PT.STKM && rt !== PT.PBCN && rt !== PT.STKM2 && rt < PT_NUM) {
        s.ctype[i] = rt;
        if (rt === PT.LIFE || rt === PT.LAVA) s.tmp[i] = s.ctype[ID(r)];
      }
    }
  } else if (ct === PT.LIFE) s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), PT.LIFE, s.tmp[i]);
  else if (ct !== PT.LIGH || s.rng.chance(1, 30)) {
    const np = s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), ct);
    if (np >= 0 && ct === PT.LAVA && s.tmp[i] > 0 && s.tmp[i] < PT_NUM && E[s.tmp[i]].HighTemperatureTransition === PT.LAVA) s.ctype[np] = s.tmp[i];
  }
};
export const clne = cloner(false), bcln = cloner(true);
