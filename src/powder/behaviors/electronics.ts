/* Electricity: SPRK conduction rules, switches, thermistors, wireless, WIRE, and metal corrosion.
 * Ported from SPRK/NTCT/PTCT/BTRY/SWCH/ETRD/IRON/GOLD/BMTL/TUNG/WIFI/WIRE/TTAN.cpp and
 * Simulation::FloodINST, The Powder Toy (GPL-3.0). Unported SPRK receivers: EMP, PPIP, LCRY, PUMP/GPMP/HSWC/PBCN
 * receive-side life toggles are ported, their own update functions are not. */
import { CELL, ELEMENTS, ID, PROP_CONDUCTS, PT, PT_NUM, R_TEMP, TYP } from '../elements';
import type { PowderSim } from '../sim';
import { restrictTemp } from '../sim';
import { fireUpdate } from './fire';
import { ppipFloodTrigger } from './pipes';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
const near = (s: PowderSim, x: number, y: number, rx: number, ry: number) => s.pmap[(y + ry) * s.XRES + x + rx];
const insulated = (p: number) => p === PT.INSL || p === PT.RSSS;

export const ntct: Hook = (s, i) => { if (s.temp[i] > 295) s.temp[i] -= 2.5; };

/** Nearest ETRD with life 0 within the (tmp, tmp2) distance window. */
function nearestSparkable(s: PowderSim, target: number): number {
  if (!s.elementCount[PT.ETRD]) return -1;
  if (s.tmp2[target] && s.tmp[target] > s.tmp2[target]) return -1;
  const maxD = Math.trunc(Math.hypot(s.XRES, s.YRES));
  let found = s.tmp2[target] ? Math.min(s.tmp2[target], maxD) : maxD, foundI = -1;
  const tx = Math.trunc(s.x[target]), ty = Math.trunc(s.y[target]);
  for (let i = 0; i < s.active; i++) {
    if (s.type[i] === PT.ETRD && !s.life[i]) {
      const d = Math.trunc(Math.hypot(Math.trunc(s.x[i]) - tx, Math.trunc(s.y[i]) - ty));
      if (d < found && d > s.tmp[target] && i !== target) { found = d; foundI = i; }
    }
  }
  return foundI;
}

export function floodInst(s: PowderSim, x: number, y: number): number {
  const XRES = s.XRES, YRES = s.YRES;
  const sparkable = (xx: number, yy: number) => TYP(s.pmap[yy * XRES + xx]) === PT.INST && s.life[ID(s.pmap[yy * XRES + xx])] === 0;
  const isInst = (xx: number, yy: number) => { const t = TYP(s.pmap[yy * XRES + xx]); return t === PT.INST || (t === PT.SPRK && s.ctype[ID(s.pmap[yy * XRES + xx])] === PT.INST); };
  if (!sparkable(x, y)) return 1;
  const stack = [x, y];
  let created = 0;
  while (stack.length) {
    y = stack.pop()!; x = stack.pop()!;
    let x1 = x, x2 = x;
    while (x1 >= CELL && sparkable(x1 - 1, y)) x1--;
    while (x2 < XRES - CELL && sparkable(x2 + 1, y)) x2++;
    for (x = x1; x <= x2; x++) if (s.createPart(-1, x, y, PT.SPRK) >= 0) created = 1;
    if (y >= CELL + 1 && x1 === x2 && isInst(x1 - 1, y - 1) && isInst(x1, y - 1) && isInst(x1 + 1, y - 1) && !isInst(x1 - 1, y - 2) && isInst(x1, y - 2) && !isInst(x1 + 1, y - 2)) {
      if (sparkable(x1, y - 2)) stack.push(x1, y - 2);
    } else if (y >= CELL + 1) {
      for (x = x1; x <= x2; x++) if (sparkable(x, y - 1) && (x === x1 || x === x2 || y >= YRES - CELL - 1 || !isInst(x, y + 1) || isInst(x + 1, y + 1) || isInst(x - 1, y + 1))) stack.push(x, y - 1);
    }
    if (y < YRES - CELL - 1 && x1 === x2 && isInst(x1 - 1, y + 1) && isInst(x1, y + 1) && isInst(x1 + 1, y + 1) && !isInst(x1 - 1, y + 2) && isInst(x1, y + 2) && !isInst(x1 + 1, y + 2)) {
      if (sparkable(x1, y + 2)) stack.push(x1, y + 2);
    } else if (y < YRES - CELL - 1) {
      for (x = x1; x <= x2; x++) if (sparkable(x, y + 1) && (x === x1 || x === x2 || y < 0 || !isInst(x, y - 1) || isInst(x + 1, y - 1) || isInst(x - 1, y - 1))) stack.push(x, y + 1);
    }
  }
  return created;
}

export const sprk: Hook = (s, i, x, y, ss, nt) => {
  let ct = s.ctype[i];
  fireUpdate(s, i, x, y, ss);
  if (s.life[i] <= 0) {
    if (ct === PT.WATR || ct === PT.SLTW || ct === PT.PSCN || ct === PT.NSCN || ct === PT.ETRD || ct === PT.INWR) s.temp[i] = R_TEMP + 273.15;
    if (ct <= 0 || ct >= PT_NUM || !E[s.ctype[i]]?.Enabled) ct = PT.METL;
    s.ctype[i] = PT.NONE; s.life[i] = 4;
    if (ct === PT.WATR) s.life[i] = 64; else if (ct === PT.SLTW) s.life[i] = 54; else if (ct === PT.SWCH) s.life[i] = 14;
    else if (ct === PT.RSST) { s.killPart(i); return true; }
    return s.changeType(i, x, y, ct);
  }
  switch (ct) {
    case PT.SPRK: s.killPart(i); return true;
    case PT.NTCT: case PT.PTCT: ntct(s, i, x, y, ss, nt); break;
    case PT.ETRD:
      if (s.life[i] === 1) {
        const nearp = nearestSparkable(s, i);
        if (nearp === -1) break;
        const pavg = s.partsAvg(i, nearp, PT.INSL);
        if (pavg !== PT.INSL && pavg !== PT.RSSS) {
          const nx = (s.x[nearp] + 0.5) | 0, ny = (s.y[nearp] + 0.5) | 0;
          s.createLine(x, y, nx, ny, PT.PLSM);
          s.life[i] = 20; s.changeType(i, x, y, ct);
          ct = s.ctype[i] = PT.NONE;
          s.changeType(nearp, nx, ny, PT.SPRK); s.life[nearp] = 9; s.ctype[nearp] = PT.ETRD;
        }
      }
      break;
    case PT.NBLE:
      if (s.life[i] <= 1 && !(s.tmp[i] & 1)) {
        s.life[i] = s.rng.between(50, 199); s.changeType(i, x, y, PT.PLSM); s.ctype[i] = PT.NBLE;
        if (s.temp[i] > 5273.15) s.tmp[i] |= 4;
        s.temp[i] = 3500; s.pv[s.cell(x, y)] += 1;
      }
      break;
    case PT.TESC: {
      if (s.tmp[i] > 300) s.tmp[i] = 300;
      for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
        if (!rx && !ry) continue;
        if (near(s, x, y, rx, ry)) continue;
        if (s.tmp[i] > 4 && s.rng.chance(1, Math.trunc(s.tmp[i] * s.tmp[i] / 20) + 6)) {
          const p = s.createPart(-1, x + rx * 2, y + ry * 2, PT.LIGH);
          if (p !== -1) {
            s.life[p] = s.rng.between(0, 2 + Math.trunc(s.tmp[i] / 15)) + Math.trunc(s.tmp[i] / 7);
            if (s.life[i] > 60) s.life[i] = 60;
            s.temp[p] = s.life[p] * s.tmp[i] / 2.5; s.tmp2[p] = 1;
            s.tmp[p] = Math.trunc(Math.atan2(-ry, rx) * 360 / Math.PI);
            s.temp[i] = restrictTemp(s.temp[i] - (s.tmp[i] * 2 + s.temp[i] / 5));
            const c = s.cell(x, y);
            if (Math.abs(s.pv[c]) !== 0) { if (Math.abs(s.pv[c]) <= 0.5) s.pv[c] = 0; else s.pv[c] -= s.pv[c] > 0 ? 0.5 : -0.5; }
          }
        }
      }
      break;
    }
    case PT.IRON:
      for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
        if (!rx && !ry) continue;
        const r = near(s, x, y, rx, ry);
        if (!r) continue;
        const rt = TYP(r);
        if (rt === PT.DSTW || rt === PT.SLTW || rt === PT.WATR) {
          const rnd = s.rng.gen() % 100;
          if (!rnd) s.changeType(ID(r), x + rx, y + ry, PT.O2); else if (3 > rnd) s.changeType(ID(r), x + rx, y + ry, PT.H2);
        }
      }
      break;
    case PT.TUNG: if (s.temp[i] < 3595) s.temp[i] += s.rng.between(-4, 15); break;
  }
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const receiver = TYP(r), rid = ID(r), sender = ct, pavg = s.partsAvg(rid, i, PT.INSL);
    switch (receiver) {
      case PT.SWCH:
        if (!insulated(pavg) && s.life[i] < 4) {
          if (sender === PT.PSCN && s.life[rid] < 10) s.life[rid] = 10;
          else if (sender === PT.NSCN) { s.ctype[rid] = PT.NONE; s.life[rid] = 9; }
        }
        break;
      case PT.SPRK:
        if (!insulated(pavg) && s.life[i] < 4) {
          if (s.ctype[rid] === PT.SWCH) {
            if (sender === PT.NSCN) { s.changeType(rid, x + rx, y + ry, PT.SWCH); s.ctype[rid] = PT.NONE; s.life[rid] = 9; }
          } else if ((s.ctype[rid] === PT.NTCT || s.ctype[rid] === PT.PTCT) && sender === PT.METL) s.temp[rid] = 473;
        }
        continue;
      case PT.PUMP: case PT.GPMP: case PT.HSWC: case PT.PBCN:
        if (s.life[i] < 4) {
          if (sender === PT.PSCN) s.life[rid] = 10;
          else if (sender === PT.NSCN && s.life[rid] >= 10) s.life[rid] = 9;
        }
        continue;
      case PT.LCRY:
        if (Math.abs(rx) < 2 && Math.abs(ry) < 2 && s.life[i] < 4) {
          if (sender === PT.PSCN && s.tmp[rid] === 0) s.tmp[rid] = 2;
          else if (sender === PT.NSCN && s.tmp[rid] === 3) s.tmp[rid] = 1;
        }
        continue;
      case PT.PPIP:
        if (s.life[i] === 3 && !insulated(pavg) && (sender === PT.NSCN || sender === PT.PSCN || sender === PT.INST)) ppipFloodTrigger(s, x + rx, y + ry, sender);
        continue;
      case PT.EMP:
        if (!s.life[rid] && s.life[i] > 0 && s.life[i] < 4) { s.empTriggerCount++; s.empDecor = Math.min(40, s.empDecor + 3); s.life[rid] = 220; }
        continue;
      case PT.NTCT: case PT.PTCT: case PT.INWR:
        if (sender === PT.METL && !insulated(pavg) && s.life[i] < 4) {
          s.temp[rid] = 473;
          if (receiver === PT.NTCT || receiver === PT.PTCT) continue;
        }
        break;
    }
    if (insulated(pavg)) continue;
    if (!((E[receiver].Properties & PROP_CONDUCTS) || receiver === PT.INST || receiver === PT.QRTZ)) continue;
    if (Math.abs(rx) + Math.abs(ry) >= 4 && sender !== PT.SWCH && receiver !== PT.SWCH) continue;
    const tryConduct = (): boolean => {
      if (receiver === sender && receiver !== PT.INST && receiver !== PT.QRTZ) return true;
      switch (sender) {
        case PT.INST: return receiver === PT.NSCN;
        case PT.SWCH: if ([PT.PSCN, PT.NSCN, PT.WATR, PT.SLTW, PT.NTCT, PT.PTCT, PT.INWR].includes(receiver)) return false; break;
        case PT.ETRD: return [PT.METL, PT.BMTL, PT.BRMT, PT.LRBD, PT.RBDM, PT.PSCN, PT.NSCN].includes(receiver);
        case PT.NTCT: return receiver === PT.PSCN || (receiver === PT.NSCN && s.temp[i] > 373);
        case PT.PTCT: return receiver === PT.PSCN || (receiver === PT.NSCN && s.temp[i] < 373);
        case PT.INWR: return receiver === PT.NSCN || receiver === PT.PSCN;
      }
      switch (receiver) {
        case PT.QRTZ: return (sender === PT.NSCN || sender === PT.METL || sender === PT.PSCN || sender === PT.QRTZ) && (s.temp[rid] < 173.15 || s.pv[s.cell(x + rx, y + ry)] > 8);
        case PT.NTCT: return sender === PT.NSCN || (sender === PT.PSCN && s.temp[rid] > 373);
        case PT.PTCT: return sender === PT.NSCN || (sender === PT.PSCN && s.temp[rid] < 373);
        case PT.INWR: return sender === PT.NSCN || sender === PT.PSCN;
        case PT.INST: return sender === PT.PSCN;
        case PT.NBLE: return !(s.tmp[i] & 1);
        case PT.PSCN: return sender !== PT.NSCN;
      }
      return true;
    };
    if (!tryConduct()) continue;
    if (receiver === PT.WATR || receiver === PT.SLTW) {
      if (s.life[rid] === 0 && s.life[i] < 3) {
        s.changeType(rid, x + rx, y + ry, PT.SPRK);
        s.life[rid] = receiver === PT.WATR ? 6 : 5; s.ctype[rid] = receiver;
      }
    } else if (receiver === PT.INST) {
      if (s.life[rid] === 0 && s.life[i] < 4) floodInst(s, x + rx, y + ry);
    } else if (receiver === PT.RSST) {
      if (s.life[rid] === 0 && s.life[i] < 4) { s.changeType(rid, x + rx, y + ry, PT.SPRK); s.life[rid] = 5; s.ctype[rid] = receiver; }
    } else if (s.life[rid] === 0 && s.life[i] < 4) {
      s.life[rid] = 4; s.ctype[rid] = receiver; s.changeType(rid, x + rx, y + ry, PT.SPRK);
      if (s.temp[rid] + 10 < 673 && !s.legacyEnable && [PT.METL, PT.BMTL, PT.BRMT, PT.PSCN, PT.NSCN, PT.ETRD, PT.NBLE, PT.IRON].includes(receiver)) s.temp[rid] += 10;
    } else if (!s.life[rid] && sender === PT.ETRD && s.life[i] === 5) {
      s.changeType(i, x, y, sender); s.ctype[i] = PT.NONE; s.life[i] = 20;
      s.life[rid] = 4; s.ctype[rid] = receiver; s.changeType(rid, x + rx, y + ry, PT.SPRK);
    }
  }
};

export const btry: Hook = (s, i, x, y) => {
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if ((rx || ry) && Math.abs(rx) + Math.abs(ry) < 4) {
      const r = near(s, x, y, rx, ry);
      if (!r) continue;
      const rt = TYP(r), rid = ID(r), pavg = s.partsAvg(i, rid, PT.INSL);
      if (!insulated(pavg) && (E[rt].Properties & PROP_CONDUCTS) && ![PT.WATR, PT.SLTW, PT.NTCT, PT.PTCT, PT.INWR].includes(rt) && s.life[rid] === 0) {
        s.life[rid] = 4; s.ctype[rid] = rt; s.changeType(rid, x + rx, y + ry, PT.SPRK);
      }
    }
  }
};

export const swch: Hook = (s, i, x, y) => {
  if (s.life[i] > 0 && s.life[i] !== 10) s.life[i]--;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r), pavg = s.partsAvg(i, rid, PT.INSL);
    if (!insulated(pavg)) {
      const rt = TYP(r);
      if (rt === PT.SWCH) {
        if (s.life[i] >= 10 && s.life[rid] < 10 && s.life[rid] > 0) s.life[i] = 9;
        else if (s.life[i] === 0 && s.life[rid] >= 10) s.life[i] = s.life[rid];
      } else if (rt === PT.SPRK && s.life[i] === 10 && s.life[rid] > 0 && s.ctype[rid] !== PT.PSCN && s.ctype[rid] !== PT.NSCN) {
        s.changeType(i, x, y, PT.SPRK); s.ctype[i] = PT.SWCH; s.life[i] = 4;
      }
    }
  }
  const red = (xx: number, yy: number) => TYP(s.pmap[yy * s.XRES + xx]) === PT.BRAY && s.tmp[ID(s.pmap[yy * s.XRES + xx])] === 2;
  if (!TYP(near(s, x, y, -1, -1)) && !TYP(near(s, x, y, 1, -1)) && (red(x, y - 1) || red(x, y + 1)) && (red(x + 1, y) || red(x - 1, y))) {
    if (s.life[i] === 10) s.life[i] = 9; else if (s.life[i] <= 5) s.life[i] = 14;
  }
};

export const iron: Hook = (s, i, x, y) => {
  if (s.life[i]) return false;
  const tryBreak = (): boolean => {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      switch (TYP(near(s, x, y, rx, ry))) {
        case PT.SALT: if (s.rng.chance(1, 47)) return true; break;
        case PT.SLTW: if (s.rng.chance(1, 67)) return true; break;
        case PT.WATR: if (s.rng.chance(1, 1200)) return true; break;
        case PT.O2: if (s.rng.chance(1, 250)) return true; break;
        case PT.LO2: return true;
      }
    }
    return false;
  };
  if (tryBreak()) { s.changeType(i, x, y, PT.BMTL); s.tmp[i] = s.rng.between(20, 29); }
};

export const gold: Hook = (s, i, x, y) => {
  const cx = [-4, 4, 0, 0], cy = [0, 0, -4, 4];
  for (let j = 0; j < 8; j++) {
    let rnd = s.rng.gen();
    const rx = (rnd % 9) - 4; rnd >>= 4;
    const ry = (rnd % 9) - 4;
    if (!rx !== !ry) {
      const r = near(s, x, y, rx, ry);
      if (!r) continue;
      if (TYP(r) === PT.BMTL && s.tmp[ID(r)]) { s.tmp[ID(r)] = 0; s.changeType(ID(r), x + rx, y + ry, PT.IRON); }
    }
  }
  if (!s.life[i]) for (let j = 0; j < 4; j++) {
    const r = near(s, x, y, cx[j], cy[j]);
    if (!r) continue;
    if (TYP(r) === PT.SPRK && s.life[ID(r)] && s.life[ID(r)] < 4) { s.changeType(i, x, y, PT.SPRK); s.life[i] = 4; s.ctype[i] = PT.GOLD; }
  }
  const ph = s.photons[y * s.XRES + x];
  if (TYP(ph) === PT.NEUT && s.rng.chance(1, 7)) s.killPart(ID(ph));
};

export const ttan: Hook = (s, i, x, y, _ss, nt) => {
  let n = 0;
  if (nt <= 2) n = 2;
  else if (s.tmp[i]) n = 2;
  else if (nt <= 6) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) if (!rx !== !ry && TYP(near(s, x, y, rx, ry)) === PT.TTAN) n++;
  }
  if (n >= 2) { const c = s.cell(x, y); s.blockAir[c] = 1; s.blockAirH[c] = 8; }
};

export const bmtl: Hook = (s, i, x, y) => {
  if (s.tmp[i] > 1) {
    s.tmp[i]--;
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (!r) continue;
      if ((TYP(r) === PT.METL || TYP(r) === PT.IRON) && s.rng.chance(1, 100)) {
        s.changeType(ID(r), x + rx, y + ry, PT.BMTL);
        s.tmp[ID(r)] = s.tmp[i] <= 7 ? (s.tmp[i] = 1) : s.tmp[i] - s.rng.between(0, 4);
      }
    }
  } else if (s.tmp[i] === 1 && s.rng.chance(1, 1000)) { s.tmp[i] = 0; s.changeType(i, x, y, PT.BRMT); }
};

export const tung: Hook = (s, i, x, y) => {
  let splode = false;
  const melt = E[PT.TUNG].HighTemperature;
  if (s.temp[i] > 2400) for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) if ((rx || ry) && TYP(near(s, x, y, rx, ry)) === PT.O2) splode = true;
  if ((s.temp[i] > melt && s.rng.chance(1, 20)) || splode) {
    if (s.rng.chance(1, 50)) s.pv[s.cell(x, y)] += 50;
    else if (s.rng.chance(1, 100)) { s.changeType(i, x, y, PT.FIRE); s.life[i] = s.rng.between(0, 499); return true; }
    else { s.changeType(i, x, y, PT.LAVA); s.ctype[i] = PT.TUNG; return true; }
    if (splode) s.temp[i] = restrictTemp(melt + s.rng.between(200, 799));
    s.vx[i] += s.rng.between(-50, 50); s.vy[i] += s.rng.between(-50, 50);
    return true;
  }
  const press = Math.trunc(s.pv[s.cell(x, y)] * 64), diff = press - s.tmp3[i];
  if (diff > 32 || diff < -32) { s.changeType(i, x, y, PT.BRMT); s.ctype[i] = PT.TUNG; return true; }
  s.tmp3[i] = press;
};

export const wifi: Hook = (s, i, x, y) => {
  s.tmp[i] = Math.trunc((s.temp[i] - 73.15) / 100 + 1);
  if (s.tmp[i] >= 101) s.tmp[i] = 100; else if (s.tmp[i] < 0) s.tmp[i] = 0;
  const ch = s.tmp[i];
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rid = ID(r), rt = TYP(r);
    if (s.wireless[ch * 2] && (rt === PT.NSCN || rt === PT.PSCN || rt === PT.INWR) && s.life[rid] === 0) {
      s.ctype[rid] = rt; s.changeType(rid, x + rx, y + ry, PT.SPRK); s.life[rid] = 4;
    }
    if (rt === PT.SPRK && s.ctype[rid] !== PT.NSCN && s.life[rid] >= 3) s.wireless[ch * 2 + 1] = 1;
  }
};

export const wire: Hook = (s, i, x, y) => {
  let count = 0;
  s.ctype[i] = 0;
  if (s.tmp[i] === 1) s.ctype[i] = 2; else if (s.tmp[i] === 2) s.ctype[i] = 0;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r);
    if (rt === PT.SPRK && s.life[ID(r)] === 3 && s.ctype[ID(r)] === PT.PSCN) { s.ctype[i] = 1; return false; }
    else if (rt === PT.NSCN && s.tmp[i] === 1) s.createPart(-1, x + rx, y + ry, PT.SPRK);
    else if (rt === PT.WIRE && s.tmp[ID(r)] === 1 && !s.tmp[i]) count++;
  }
  if (count === 1 || count === 2) s.ctype[i] = 1;
};
