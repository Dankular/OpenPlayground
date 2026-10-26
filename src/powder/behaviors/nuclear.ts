/* Radiation, energy particles and fissile/exotic matter. Ported from NEUT/PLUT/URAN/ISOZ/ISZS/DEUT/PHOT/ELEC/PROT/POLO/
 * AMTR/ANAR/SING/WARP.cpp, The Powder Toy (GPL-3.0). Newtonian gravity is not simulated, so gravtot is 0 where used.
 * Not ported: SEED gene mutation and RSST/RSSS liquefaction cases that need those elements' own updates. */
import { CELL, CFDS, ELEMENTS, ID, MAX_PRESSURE, MAX_TEMP, MIN_PRESSURE, MIN_TEMP, PMAP, PROP_CONDUCTS, PT, PT_NUM, TYP } from '../elements';
import type { PowderSim } from '../sim';
import { restrictTemp } from '../sim';
import { fireUpdate } from './fire';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
const near = (s: PowderSim, x: number, y: number, rx: number, ry: number) => s.pmap[(y + ry) * s.XRES + x + rx];
const clampP = (v: number) => Math.min(MAX_PRESSURE, Math.max(MIN_PRESSURE, v));

function deutBurst(s: PowderSim, n: number, x: number, y: number, temp: number, t: number, sign: 1 | -1): void {
  n = Math.trunc(n / 50);
  if (n < 1) n = 1; else if (n > 340) n = 340;
  for (let c = 0; c < n; c++) {
    const i = s.createPart(-3, x, y, t);
    if (i >= 0) s.temp[i] = temp; else if (s.active >= s.NPART) break;
  }
  s.pv[s.cell(x, y)] += sign * 6 * CFDS * n;
}

/** NEUT on RSSS / PHOT on RSST: the resist material turns into its stored ctype (or the default state) and the particle is absorbed. */
function resistLiquefy(s: PowderSim, i: number, under: number, x: number, y: number, fallback: number): void {
  const ct = s.ctype[under], tmpUnder = s.tmp[under];
  if (ct > 0 && ct < PT_NUM) {
    s.createPart(under, x, y, ct);
    if (tmpUnder > 0 && tmpUnder < PT_NUM && ELEMENTS[ct].CarriesTypeIn & 1 << 2 /* FIELD_CTYPE */) s.ctype[under] = tmpUnder;
  } else s.changeType(under, x, y, fallback);
  s.killPart(i);
}

export const neut: Hook = (s, i, x, y, ss) => {
  const c = s.cell(x, y), pressureFactor = 3 + Math.trunc(s.pv[c]);
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    const r = near(s, x, y, rx, ry), rid = ID(r), px = x + rx, py = y + ry;
    switch (TYP(r)) {
      case PT.WATR:
        if (s.rng.chance(3, 20)) s.changeType(rid, px, py, PT.DSTW);
        // fall through: water slows neutrons like ice
      case PT.ICEI: case PT.SNOW:
        s.vx[i] *= 0.995; s.vy[i] *= 0.995; break;
      case PT.PLUT:
        if (s.rng.chance(pressureFactor, 1000)) {
          if (s.rng.chance(1, 3)) {
            s.createPart(rid, px, py, s.rng.chance(2, 3) ? PT.LAVA : PT.URAN);
            s.temp[rid] = MAX_TEMP;
            if (s.type[rid] === PT.LAVA) { s.tmp[rid] = 100; s.ctype[rid] = PT.PLUT; }
          } else {
            s.createPart(rid, px, py, PT.NEUT);
            s.vx[rid] = 0.25 * s.vx[rid] + s.vx[i]; s.vy[rid] = 0.25 * s.vy[rid] + s.vy[i];
          }
          s.pv[c] += 10 * CFDS;
          fireUpdate(s, i, x, y, ss);
        }
        break;
      case PT.DEUT:
        if (s.rng.chance(pressureFactor + 1 + Math.trunc(s.life[rid] / 100), 1000)) {
          deutBurst(s, s.life[rid], px, py, restrictTemp(s.temp[rid] + s.life[rid] * 500), PT.NEUT, 1);
          s.killPart(rid);
        }
        break;
      case PT.GUNP: if (s.rng.chance(3, 200)) s.changeType(rid, px, py, PT.DUST); break;
      case PT.DYST: if (s.rng.chance(3, 200)) s.changeType(rid, px, py, PT.YEST); break;
      case PT.YEST: s.changeType(rid, px, py, PT.DYST); break;
      case PT.PLEX: if (s.rng.chance(3, 200)) s.changeType(rid, px, py, PT.GOO); break;
      case PT.NITR: if (s.rng.chance(3, 200)) s.changeType(rid, px, py, PT.DESL); break;
      case PT.PLNT: case PT.COAL: if (s.rng.chance(1, 20)) s.createPart(rid, px, py, PT.WOOD); break;
      case PT.DESL: case PT.OIL: if (s.rng.chance(3, 200)) s.changeType(rid, px, py, PT.GAS); break;
      case PT.BCOL: if (s.rng.chance(1, 20)) s.createPart(rid, px, py, PT.SAWD); break;
      case PT.DUST: if (s.rng.chance(1, 20)) s.changeType(rid, px, py, PT.FWRK); break;
      case PT.FWRK: if (s.rng.chance(1, 20)) s.ctype[rid] = PT.DUST; break;
      case PT.ACID: if (s.rng.chance(1, 20)) s.createPart(rid, px, py, PT.ISOZ); break;
      case PT.TTAN: if (s.rng.chance(1, 20)) { s.killPart(i); return true; } break;
      case PT.EXOT: if (s.rng.chance(1, 20)) s.life[rid] = 1500; break;
      case PT.RFRG: s.createPart(rid, px, py, s.rng.chance(1, 2) ? PT.GAS : PT.CAUS); break;
      case PT.BASE: if (s.temp[rid] > 50 + 273.15 && s.rng.chance(1, 35)) s.createPart(rid, px, py, PT.LRBD); break;
      case PT.RSSS:
        if (!rx && !ry) { resistLiquefy(s, i, rid, x, y, PT.RSST); return true; }
        break;
    }
  }
};

export const plut: Hook = (s, i, x, y) => {
  if (s.rng.chance(1, 100) && s.rng.chance(Math.trunc(5 * s.pv[s.cell(x, y)]), 1000)) s.createPart(i, x, y, PT.NEUT);
};

export const uran: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  if (!s.legacyEnable && s.pv[c] > 0) {
    if (s.temp[i] === MIN_TEMP) s.temp[i] += 0.01;
    else s.temp[i] = restrictTemp(s.temp[i] * (1 + s.pv[c] / 2000) + MIN_TEMP);
  }
};

export const isoz: Hook = (s, i, x, y) => {
  if (s.rng.chance(1, 200) && s.rng.chance(Math.trunc(-4 * s.pv[s.cell(x, y)]), 1000)) {
    s.createPart(i, x, y, PT.PHOT);
    const rr = s.rng.between(128, 355) / 127, a = s.rng.between(0, 359) * Math.PI / 180;
    s.vx[i] = rr * Math.cos(a); s.vy[i] = rr * Math.sin(a);
  }
};

export const deut: Hook = (s, i, x, y) => {
  const temp = Math.max(1, s.temp[i] + 1);
  let maxlife = Math.trunc(10000 / (temp + 1) - 1);
  if (s.rng.chance(10000 % Math.trunc(temp + 1), Math.trunc(temp + 1))) maxlife++;
  maxlife *= Math.trunc(5 - 8 / 2); // gravtot = 0
  if (s.life[i] < maxlife) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (!r || s.life[i] >= maxlife) continue;
      if (TYP(r) === PT.DEUT && s.rng.chance(1, 3) && s.life[ID(r)] <= maxlife - s.life[i] - 1) { s.life[i] += s.life[ID(r)] + 1; s.killPart(ID(r)); }
    }
  } else {
    outer: for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      if (s.life[i] <= maxlife) break outer;
      const r = near(s, x, y, rx, ry);
      if (!r && s.life[i] >= 1) {
        const np = s.createPart(-1, x + rx, y + ry, PT.DEUT);
        if (np < 0) continue;
        s.life[i]--; s.temp[np] = s.temp[i]; s.life[np] = 0;
      }
    }
  }
  for (let trade = 0; trade < 4; trade++) {
    const rx = s.rng.between(-2, 2), ry = s.rng.between(-2, 2);
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) === PT.DEUT && s.life[i] > s.life[rid] && s.life[i] > 0) {
      const d = s.life[i] - s.life[rid];
      if (d === 1) { s.life[rid]++; s.life[i]--; } else if (d > 0) { s.life[rid] += Math.trunc(d / 2); s.life[i] -= Math.trunc(d / 2); }
    }
  }
};

export const phot: Hook = (s, i, x, y, ss) => {
  if (!(s.ctype[i] & 0x3fffffff)) { s.killPart(i); return true; }
  if (s.temp[i] > 506 && s.rng.chance(1, 10)) fireUpdate(s, i, x, y, ss);
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.ISOZ || rt === PT.ISZS) {
      if (s.rng.chance(1, 400)) {
        s.vx[i] *= 0.9; s.vy[i] *= 0.9;
        s.createPart(rid, x + rx, y + ry, PT.PHOT);
        const a = s.rng.between(0, 359) * Math.PI / 180;
        const rr = Math.trunc(rt === PT.ISOZ ? s.rng.between(128, 255) / 127 : s.rng.between(128, 355) / 127);
        s.vx[rid] = rr * Math.cos(a); s.vy[rid] = rr * Math.sin(a);
        s.pv[s.cell(x, y)] -= 15 * CFDS;
      }
    } else if ((rt === PT.QRTZ || rt === PT.PQRT) && !ry && !rx) {
      const a = s.rng.between(0, 359) * Math.PI / 180;
      s.vx[i] = 3 * Math.cos(a); s.vy[i] = 3 * Math.sin(a);
      if (s.ctype[i] === 0x3fffffff) s.ctype[i] = 0x1f << s.rng.between(0, 25);
      if (s.life[i]) s.life[i]++;
    } else if (rt === PT.BGLA && !ry && !rx) {
      const a = s.rng.between(-50, 50) * 0.001, cr = Math.cos(a), sr = Math.sin(a);
      const vx = cr * s.vx[i] + sr * s.vy[i], vy = cr * s.vy[i] - sr * s.vx[i];
      s.vx[i] = vx; s.vy[i] = vy;
    } else if (rt === PT.RSST && !ry && !rx) {
      resistLiquefy(s, i, rid, x, y, PT.RSSS); return true;
    } else if (rt === PT.FILT && s.tmp[rid] === 9) {
      s.vx[i] += s.rng.between(-500, 500) / 1000; s.vy[i] += s.rng.between(-500, 500) / 1000;
    }
  }
};

export const elec: Hook = (s, i, x, y) => {
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    const k = (y + ry) * s.XRES + x + rx;
    const r = s.pmap[k] || s.photons[k];
    if (!r) continue;
    const rt = TYP(r), rid = ID(r), px = x + rx, py = y + ry;
    switch (rt) {
      case PT.GLAS:
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          if (px + a >= 0 && py + b >= 0 && px + a < s.XRES && py + b < s.YRES) {
            const nb = s.createPart(-1, px + a, py + b, PT.EMBR);
            if (nb !== -1) { s.tmp[nb] = 0; s.life[nb] = 50; s.temp[nb] = s.temp[i] * 0.8; s.vx[nb] = s.rng.between(-10, 10); s.vy[nb] = s.rng.between(-10, 10); }
          }
        }
        s.killPart(i); return true;
      case PT.LCRY: s.tmp2[rid] = s.rng.between(5, 9); break;
      case PT.WATR: case PT.DSTW: case PT.SLTW: case PT.CBNW:
        if (s.rng.chance(1, 3)) s.createPart(rid, px, py, PT.O2); else s.createPart(rid, px, py, PT.H2);
        s.killPart(i); return true;
      case PT.PROT:
        if (s.tmp2[rid] & 1) break;
        // fall through
      case PT.NEUT:
        // upstream quirk, kept: after killing the electron the scan continues (kill_part is idempotent) and may react again
        s.changeType(rid, px, py, PT.H2); s.life[rid] = 0; s.ctype[rid] = 0; s.killPart(i); break;
      case PT.DEUT:
        if (s.life[rid] < 6000) s.life[rid]++;
        s.temp[rid] = 0; s.killPart(i); return true;
      case PT.EXOT: s.tmp2[rid] += 5; s.life[rid] = 1000; break;
      case PT.RSST: if (!rx && !ry) { s.killPart(rid); s.killPart(i); return true; } break;
      case PT.NONE: break;
      default:
        if ((E[rt].Properties & PROP_CONDUCTS) && (rt !== PT.NBLE || s.temp[i] < 2273.15)) { s.createPart(-1, px, py, PT.SPRK); s.killPart(i); return true; }
    }
  }
};

export const prot: Hook = (s, i, x, y) => {
  const c = s.cell(x, y), XRES = s.XRES;
  s.pv[c] -= 0.003;
  const under = s.pmap[y * XRES + x];
  let utype = TYP(under);
  const uid = ID(under);
  switch (utype) {
    case PT.SPRK: {
      const sparked = s.ctype[uid];
      if (!s.changeType(uid, x, y, sparked)) { s.life[uid] = 44 + s.life[uid]; s.ctype[uid] = 0; } else utype = 0;
      break;
    }
    case PT.DEUT:
      if (s.rng.chance(-(Math.trunc(s.pv[c]) - 4) + Math.trunc(s.life[uid] / 100), 200)) {
        deutBurst(s, s.life[uid], x, y, restrictTemp(s.temp[uid] + s.life[uid] * 500), PT.PROT, -1);
        s.killPart(uid);
      }
      break;
    case PT.LCRY:
      if (s.life[uid] > 5 && s.rng.chance(1, 10)) { s.changeType(i, x, y, PT.PHOT); s.life[i] *= 2; s.ctype[i] = 0x3fffffff; }
      break;
    case PT.EXOT: s.ctype[uid] = PT.PROT; break;
    case PT.WIFI: {
      const t = s.temp[i];
      const change = t < 173.15 ? -1000 : t < 273.15 ? -100 : t > 473.15 ? 1000 : t > 373.15 ? 100 : 0;
      s.temp[uid] = restrictTemp(s.temp[uid] + change);
      break;
    }
    case PT.RSSS: s.killPart(uid); s.killPart(i); return true;
    case PT.NONE:
      if (s.life[i] && !--s.life[i]) { s.killPart(i); return true; }
      break;
    default:
      if (s.temp[i] > 273.15 + 500 && (E[utype].Flammable || E[utype].Explosive || utype === PT.BANG)) {
        s.createPart(uid, x, y, PT.FIRE);
        s.temp[uid] += restrictTemp(E[utype].Flammable * 5); s.pv[c] += 1;
      } else if ((E[utype].Properties & PROP_CONDUCTS) && s.life[uid] <= 4) s.life[uid] = 40 + s.life[uid];
  }
  if (utype && utype !== PT.WIFI) s.temp[uid] = restrictTemp(s.temp[uid] - (s.temp[uid] - s.temp[i]) / 4);
  if (s.tmp[i]) {
    let element: number;
    const t = s.tmp[i];
    if (t > 500000) element = utype === PT.TUNG ? PT.AMTR : PT.SING;
    else if (t > 700) element = PT.PLUT; else if (t > 420) element = PT.URAN; else if (t > 310) element = PT.POLO;
    else if (t > 250) element = PT.PLSM; else if (t > 100) element = PT.O2; else if (t > 50) element = PT.CO2; else element = PT.NBLE;
    const nid = s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), element);
    if (nid >= 0) s.temp[nid] = restrictTemp(100 * t);
    s.killPart(i); return true;
  }
  const ahead = s.photons[y * XRES + x];
  if (ID(ahead) !== i && TYP(ahead) === PT.PROT) {
    const a = ID(ahead);
    const v1 = s.vx[i] ** 2 + s.vy[i] ** 2, v2 = s.vx[a] ** 2 + s.vy[a] ** 2;
    const d1 = Math.atan2(-s.vy[i], s.vx[i]), d2 = Math.atan2(-s.vy[a], s.vx[a]);
    let diff = d1 - d2; if (diff < 0) diff += 6.28319;
    if (diff > 3.12659 && diff < 3.15659 && v1 + v2 > 10) { s.tmp[a] += Math.trunc(v1 + v2); s.killPart(i); return true; }
  }
};

export const polo: Hook = (s, i, x, y) => {
  const COOLDOWN = 15, LIMIT = 5;
  const r = s.photons[y * s.XRES + x];
  if (s.tmp[i] < LIMIT && !s.life[i]) {
    if (s.rng.chance(1, 10000) && !s.tmp[i]) {
      const n = s.createPart(-3, x, y, PT.NEUT);
      if (n >= 0) { s.life[i] = COOLDOWN; s.tmp[i]++; s.temp[i] = (s.temp[i] + s.temp[n] + 600) / 2; s.temp[n] = s.temp[i]; }
    }
    if (r && s.rng.chance(1, 100)) {
      const n = s.createPart(-3, x, y, PT.NEUT);
      if (n >= 0) {
        s.temp[i] = (s.temp[i] + s.temp[ID(r)] + s.temp[ID(r)] + 600) / 3; s.life[i] = COOLDOWN; s.tmp[i]++;
        s.temp[ID(r)] = s.temp[i]; s.temp[n] = s.temp[i]; s.vx[n] = s.vx[ID(r)]; s.vy[n] = s.vy[ID(r)];
      }
    }
  }
  if (s.tmp2[i] >= 10) { s.changeType(i, x, y, PT.PLUT); s.temp[i] = (s.temp[i] + 600) / 2; return true; }
  if (TYP(r) === PT.PROT) { s.tmp2[i]++; s.killPart(ID(r)); }
  if (s.temp[i] < 388.15) s.temp[i] += 0.2;
};

export const amtr: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r);
    if (rt !== PT.AMTR && rt !== PT.DMND && rt !== PT.CLNE && rt !== PT.PCLN && rt !== PT.VOID && rt !== PT.BHOL && rt !== PT.NBHL && rt !== PT.PRTI && rt !== PT.PRTO) {
      s.life[i]++;
      if (s.life[i] === 4) { s.killPart(i); return true; }
      if (s.rng.chance(1, 10)) s.createPart(ID(r), x + rx, y + ry, PT.PHOT); else s.killPart(ID(r));
      s.pv[s.cell(x, y)] -= 2;
    }
  }
};

export const anar: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (r && TYP(r) === PT.CFLM && s.rng.chance(1, 4)) {
      s.changeType(i, x, y, PT.CFLM); s.life[i] = s.rng.between(50, 199);
      s.temp[ID(r)] = s.temp[i] = 0; s.pv[s.cell(x, y)] -= 0.5;
    }
  }
};

export const sing: Hook = (s, i, x, y) => {
  const XC = s.XCELLS, c = s.cell(x, y), pv = s.pv, singularity = -s.life[i];
  if (pv[c] < singularity) pv[c] += 0.1 * (singularity - pv[c]);
  if (pv[c + XC] < singularity) pv[c + XC] += 0.1 * (singularity - pv[c + XC]);
  if (pv[c - XC] < singularity) pv[c - XC] += 0.1 * (singularity - pv[c - XC]);
  for (const o of [1, XC + 1, -1, -XC - 1]) pv[c + o] = clampP(pv[c + o] + 0.1 * (singularity - pv[c + o]));
  if (s.life[i] < 1) {
    for (let rx = -1; rx <= 1; rx++) {
      const crx = Math.trunc(x / CELL) + rx;
      for (let ry = -1; ry <= 1; ry++) {
        const cry = Math.trunc(y / CELL) + ry;
        if (cry >= 0 && crx >= 0 && crx < s.XCELLS && cry < s.YCELLS) pv[cry * XC + crx] = clampP(pv[cry * XC + crx] + s.tmp[i]);
      }
    }
    let spawn = Math.abs(s.tmp[i]);
    spawn = spawn > 255 ? 3019 : Math.trunc(Math.pow(Math.trunc(spawn / 8), 2) * Math.PI);
    for (let j = 0; j < spawn; j++) {
      const nb = s.createPart(-3, x, y, [PT.PHOT, PT.NEUT, PT.ELEC][s.rng.gen() % 3]);
      if (nb !== -1) {
        s.life[nb] = s.rng.between(0, 299); s.temp[nb] = MAX_TEMP / 2;
        const a = s.rng.uniform01() * 2 * Math.PI, v = s.rng.uniform01() * 5;
        s.vx[nb] = v * Math.cos(a); s.vy[nb] = v * Math.sin(a);
      } else if (s.active >= s.NPART) break;
    }
    s.killPart(i); return true;
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r);
    if (TYP(r) !== PT.DMND && s.rng.chance(1, 3)) {
      if (TYP(r) === PT.SING && s.life[rid] > 10) {
        if (s.life[i] + s.life[rid] > 255) continue;
        s.life[i] += s.life[rid];
      } else {
        if (s.life[i] + 3 > 255) {
          if (s.type[rid] !== PT.SING && s.rng.chance(1, 1000)) { const np = s.createPart(rid, x + rx, y + ry, PT.SING); s.life[np] = s.rng.between(60, 109); }
          continue;
        }
        s.life[i] += 3; s.tmp[i]++;
      }
      s.temp[i] = restrictTemp(s.temp[rid] + s.temp[i]);
      s.killPart(rid);
    }
  }
};

export const warp: Hook = (s, i, x, y) => {
  if (s.tmp2[i] > 2000) {
    const c = s.cell(x, y);
    s.temp[i] = 10000; s.pv[c] = clampP(s.pv[c] + Math.trunc(s.tmp2[i] / 5000) * CFDS);
    if (s.rng.chance(1, 50)) s.createPart(-3, x, y, PT.ELEC);
  }
  for (let trade = 0; trade < 5; trade++) {
    const rx = s.rng.between(-1, 1), ry = s.rng.between(-1, 1);
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt !== PT.WARP && rt !== PT.STKM && rt !== PT.STKM2 && rt !== PT.DMND && rt !== PT.CLNE && rt !== PT.BCLN && rt !== PT.PCLN) {
      s.x[i] = s.x[rid]; s.y[i] = s.y[rid]; s.x[rid] = x; s.y[rid] = y;
      s.vx[rid] = s.rng.between(-2, 1) + 0.5; s.vy[rid] = s.rng.between(-2, 1);
      s.life[i] += 4;
      s.pmap[y * s.XRES + x] = r; s.pmap[(y + ry) * s.XRES + x + rx] = PMAP(i, s.type[i]);
      trade = 5;
    }
  }
};
