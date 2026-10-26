/* Viruses, exotic matter, lightning, fireworks and force-field shields. Ported from VIRS/EXOT/VIBR/GRAV/INVIS/LIGH/
 * FIRW/FWRK/C5/SHLD1-4.cpp, The Powder Toy (GPL-3.0). Not ported: LIGH's STKM damage, VIBR/EXOT graphics, firework colour
 * tables (EMBR ctype is set to a random colour instead of Renderer::firwTable). */
import { CFDS, ELEMENTS, ID, MAX_PRESSURE, MAX_TEMP, MIN_PRESSURE, PROP_CONDUCTS, PT, TYP } from '../elements';
import type { PowderSim } from '../sim';
import { restrictTemp } from '../sim';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
const near = (s: PowderSim, x: number, y: number, rx: number, ry: number) => s.pmap[(y + ry) * s.XRES + x + rx];
const clampP = (v: number) => Math.min(MAX_PRESSURE, Math.max(MIN_PRESSURE, v));
const ORX = [-1, 0, 1, 1, 1, 0, -1, -1], ORY = [-1, -1, -1, 0, 1, 1, 1, 0];

export const virs: Hook = (s, i, x, y, ss) => {
  let rnd = s.rng.gen();
  if (s.tmp3[i]) {
    s.tmp3[i] -= (rnd & 1) ? 0 : 1;
    if (!s.tmp3[i]) { s.changeType(i, x, y, s.tmp2[i]); s.tmp2[i] = 0; s.tmp3[i] = 0; s.tmp4[i] = 0; }
    return false;
  }
  if (s.tmp4[i]) {
    if (!(rnd & 7) && --s.tmp4[i] <= 0) { s.killPart(i); return true; }
    rnd >>= 3;
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (rx || ry) {
      const r = near(s, x, y, rx, ry);
      if (!r) continue;
      const rt = TYP(r), rid = ID(r);
      const virus = rt === PT.VIRS || rt === PT.VRSS || rt === PT.VRSG;
      if (s.tmp3[rid] && virus) { s.tmp3[i] = s.tmp3[rid] + ((rnd & 3) ? 2 : 1); return false; }
      else if (rt === PT.SOAP) { s.tmp3[i] += 10; if (!(rnd & 3)) s.killPart(rid); return false; }
      else if (rt === PT.PLSM) {
        if (ss && s.rng.chance(10 + Math.trunc(s.pv[s.cell(x + rx, y + ry)]), 100)) { s.createPart(i, x, y, PT.PLSM); return true; }
      } else if (!virus && rt !== PT.DMND && rt !== PT.BASE) {
        if (!(rnd & 7)) {
          s.tmp2[rid] = rt; s.tmp3[rid] = 0;
          s.tmp4[rid] = s.tmp4[i] ? s.tmp4[i] + 1 : 0;
          if (s.temp[rid] < 305) s.changeType(rid, x + rx, y + ry, PT.VRSS);
          else if (s.temp[rid] > 673) s.changeType(rid, x + rx, y + ry, PT.VRSG);
          else s.changeType(rid, x + rx, y + ry, PT.VIRS);
        }
        rnd >>= 3;
      } else if (TYP(s.photons[(y + ry) * s.XRES + x + rx]) === PT.PROT) s.tmp4[i] = 0;
    } else rnd = s.rng.gen();
  }
};

export const exot: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.WARP) { if (s.tmp2[rid] > 2000 && s.rng.chance(1, 100)) s.tmp2[i] += 100; }
    else if (rt === PT.EXOT) {
      if (s.ctype[rid] === PT.PROT) s.ctype[i] = PT.PROT;
      if (s.life[rid] === 1500 && s.rng.chance(1, 1000)) s.life[i] = 1500;
    } else if (rt === PT.LAVA) {
      if (s.ctype[rid] === PT.TTAN || s.ctype[rid] === PT.GOLD) {
        if (s.rng.chance(1, 10)) { s.ctype[rid] = PT.VIBR; s.killPart(i); return true; }
      } else if (s.ctype[rid] === PT.VIBR && s.rng.chance(1, 1000)) { s.killPart(i); return true; }
    }
    if (s.tmp[i] > 245 && s.life[i] > 1337 && rt !== PT.EXOT && rt !== PT.BREC && rt !== PT.DMND && rt !== PT.CLNE && rt !== PT.PRTI && rt !== PT.PRTO && rt !== PT.PCLN && rt !== PT.VOID && rt !== PT.NBHL && rt !== PT.WARP) {
      if (s.createPart(i, x, y, rt) !== -1) return true;
    }
  }
  s.tmp[i]--; s.tmp2[i]--;
  if (s.tmp[i] < 1 || s.tmp[i] > 250) s.tmp[i] = 250;
  if (s.tmp2[i] < 1) s.tmp2[i] = 1;
  else if (s.tmp2[i] > 6000) {
    s.tmp2[i] = 10000;
    if (s.life[i] < 1001) { s.changeType(i, x, y, PT.WARP); return true; }
  } else if (s.life[i] < 1001) s.pv[c] += s.tmp2[i] * CFDS / 160000;
  if (s.pv[c] > 200 && s.temp[i] > 9000 && s.tmp2[i] > 200) { s.tmp2[i] = 6000; s.changeType(i, x, y, PT.WARP); return true; }
  if (s.tmp2[i] > 100) {
    for (let trade = 0; trade < 9; trade++) {
      const rx = s.rng.between(-2, 2), ry = s.rng.between(-2, 2);
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (!r) continue;
      const rid = ID(r);
      if (TYP(r) === PT.EXOT && s.tmp2[i] > s.tmp2[rid] && s.tmp2[rid] >= 0) {
        const d = s.tmp2[i] - s.tmp2[rid];
        if (d === 1) { s.tmp2[rid]++; s.tmp2[i]--; break; }
        if (d > 0) { s.tmp2[rid] += Math.trunc(d / 2); s.tmp2[i] -= Math.trunc(d / 2); break; }
      }
    }
  }
  if (s.ctype[i] === PT.PROT) {
    if (s.temp[i] < 50) { if (s.createPart(i, x, y, PT.CFLM) !== -1) return true; }
    else s.temp[i] -= 1;
  } else if (s.temp[i] < 273.15) { s.vx[i] = 0; s.vy[i] = 0; s.pv[c] -= 0.01; s.tmp[i]--; }
};

/** VIBR and BVBR */
export const vibr: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  let rnd = 0;
  if (!s.life[i]) {
    if (s.temp[i] > 274.65) { s.tmp[i]++; s.temp[i] -= 3; }
    else if (s.temp[i] < 271.65) { s.tmp[i]--; s.temp[i] += 3; }
    if (s.pv[c] > 2.5) { s.tmp[i] += 7; s.pv[c]--; }
    else if (s.pv[c] < -2.5) { s.tmp[i] -= 2; s.pv[c]++; }
    if (s.tmp[i] > 1000) s.life[i] = 750;
  } else {
    rnd = s.rng.gen();
    if (s.life[i] < 300) {
      const rx = ORX[rnd & 7], ry = ORY[rnd & 7];
      rnd >>= 3;
      const r = near(s, x, y, rx, ry);
      if (TYP(r) && TYP(r) !== PT.BREC && (E[TYP(r)].Properties & PROP_CONDUCTS) && !s.life[ID(r)]) { s.life[ID(r)] = 4; s.ctype[ID(r)] = TYP(r); s.changeType(ID(r), x + rx, y + ry, PT.SPRK); }
    }
    if (s.life[i] < 500) {
      const rx = (rnd % 7) - 3, ry = ((rnd >> 3) % 7) - 3, r = near(s, x, y, rx, ry);
      if (TYP(r) && TYP(r) !== PT.VIBR && TYP(r) !== PT.BVBR && !s.isHeatInsulator(ID(r))) { s.temp[ID(r)] = restrictTemp(s.temp[ID(r)] + s.tmp[i] * 3); s.tmp[i] = 0; }
    }
    if (s.life[i] === 1) {
      if (!s.tmp2[i]) {
        rnd = s.rng.gen();
        let idx = s.createPart(-3, x + ORX[rnd & 7], y + ORY[rnd & 7], PT.ELEC); if (idx !== -1) s.temp[idx] = 7000;
        idx = s.createPart(-3, x + ORX[(rnd >> 3) & 7], y + ORY[(rnd >> 3) & 7], PT.PHOT); if (idx !== -1) s.temp[idx] = 7000;
        idx = s.createPart(-1, x + ORX[(rnd >> 6) & 7], y + ORY[(rnd >> 6) & 7], PT.BREC); if (idx !== -1) s.temp[idx] = 7000;
        s.createPart(i, x, y, PT.EXOT);
        s.tmp2[i] = (rnd >> 9) % 1000; s.temp[i] = 9000; s.pv[c] += 50;
        return true;
      }
      s.tmp2[i] = 0; s.temp[i] = 273.15; s.tmp[i] = 0;
    }
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if (s.life[i]) {
      if (rt === PT.VIBR || rt === PT.BVBR) {
        if (!s.life[rid]) s.tmp[rid] += 45;
        else if (s.tmp2[i] && s.life[i] > 75 && s.rng.chance(1, 2)) { s.tmp2[rid] = 1; s.tmp[i] = 0; }
      } else if (rt === PT.CFLM) { s.tmp2[i] = 1; s.tmp[i] = 0; }
    } else if (rt === PT.EXOT && s.rng.chance(1, 25)) { s.changeType(i, x, y, PT.EXOT); return true; }
    if (s.type[i] !== PT.BVBR && rt === PT.ANAR) { s.changeType(i, x, y, PT.BVBR); s.pv[c] -= 1; }
  }
  for (let trade = 0; trade < 9; trade++) {
    if (!(trade % 2)) rnd = s.rng.gen();
    const rx = (rnd % 7) - 3; rnd >>= 3;
    const ry = (rnd % 7) - 3; rnd >>= 3;
    if (rx || ry) {
      const r = near(s, x, y, rx, ry);
      if (TYP(r) !== PT.VIBR && TYP(r) !== PT.BVBR) continue;
      const rid = ID(r);
      if (s.tmp[i] > s.tmp[rid]) { const t = s.tmp[i] - s.tmp[rid]; s.tmp[rid] += Math.trunc(t / 2); s.tmp[i] -= Math.trunc(t / 2); break; }
    }
  }
  s.tmp[i] = Math.min(1 << 15, Math.max(0, s.tmp[i]));
};

export const grav: Hook = (s, i) => {
  if (s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i] >= 0.1 && s.rng.chance(1, 512) && !s.life[i]) s.life[i] = 48;
};

export const invis: Hook = (s, i, x, y) => {
  const res = s.tmp[i] > 0 ? s.tmp[i] : 4, p = s.pv[s.cell(x, y)];
  s.tmp2[i] = p < -res || p > res ? 1 : 0;
};

const LIGHTING_POWER = 0.65;
function createLigh(s: PowderSim, x: number, y: number, temp: number, life: number, tmp: number, tmp2: number, last: boolean, i: number): boolean {
  const p = s.createPart(-1, x, y, PT.LIGH);
  if (p !== -1) {
    s.temp[p] = temp; s.tmp[p] = tmp;
    if (last) {
      const next = Math.trunc(life / 1.5 - s.rng.between(0, 1));
      s.life[p] = next;
      if (next > 1) { const branch = s.rng.chance(7, 10); s.tmp2[p] = (branch ? 2 : 0) + (p > i && tmp2 !== 4 ? 1 : 0); }
      else s.tmp2[p] = 7 + (p > i ? 1 : 0);
    } else { s.life[p] = life; s.tmp2[p] = 7 + (p > i ? 1 : 0); }
  } else if (x >= 0 && x < s.XRES && y >= 0 && y < s.YRES) {
    const r = s.pmap[y * s.XRES + x], rt = TYP(r), rid = ID(r);
    if (((rt === PT.VOID || (rt === PT.PVOD && s.life[rid] >= 10)) && (!s.ctype[rid] || (s.ctype[rid] === PT.LIGH) !== ((s.tmp[rid] & 1) !== 0))) || rt === PT.BHOL || rt === PT.NBHL) return true;
  } else return true;
  return false;
}
function createLineParallel(s: PowderSim, x1: number, y1: number, x2: number, y2: number, temp: number, life: number, tmp: number, tmp2: number, i: number): void {
  const rev = Math.abs(y2 - y1) > Math.abs(x2 - x1);
  if (rev) { [x1, y1] = [y1, x1]; [x2, y2] = [y2, x2]; }
  const back = x1 > x2, dx = x2 - x1, dy = Math.abs(y2 - y1), de = dx ? dy / dx : 0, ystep = y1 < y2 ? 1 : -1;
  let e = 0, y = y1;
  if (!back) {
    for (let x = x1; x <= x2; x++) {
      if (rev ? createLigh(s, y, x, temp, life, tmp, tmp2, x === x2, i) : createLigh(s, x, y, temp, life, tmp, tmp2, x === x2, i)) return;
      e += de; if (e >= 0.5) { y += ystep; e -= 1; }
    }
  } else {
    for (let x = x1; x >= x2; x--) {
      if (rev ? createLigh(s, y, x, temp, life, tmp, tmp2, x === x2, i) : createLigh(s, x, y, temp, life, tmp, tmp2, x === x2, i)) return;
      e += de; if (e <= -0.5) { y += ystep; e += 1; }
    }
  }
}
export const ligh: Hook = (s, i, x, y, ss) => {
  const c = s.cell(x, y), powderful = Math.trunc(s.temp[i] * (1 + Math.trunc(s.life[i] / 40)) * LIGHTING_POWER);
  if (s.aheatEnable) {
    s.hv[c] += Math.trunc(powderful / 50);
    if (s.hv[c] > MAX_TEMP) s.hv[c] = MAX_TEMP; else if (s.hv[c] < 0) s.hv[c] = MAX_TEMP;
  }
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r), px = x + rx, py = y + ry;
    if ((ss || E[rt].Explosive) && (rt !== PT.SPNG || s.life[rid] === 0) && E[rt].Flammable && s.rng.chance(E[rt].Flammable + Math.trunc(s.pv[s.cell(px, py)] * 10), 1000)) {
      s.changeType(rid, px, py, PT.FIRE);
      s.temp[rid] = restrictTemp(E[PT.FIRE].default.temp + E[rt].Flammable / 2);
      s.life[rid] = s.rng.between(180, 259); s.tmp[rid] = s.ctype[rid] = 0;
      if (E[rt].Explosive) s.pv[c] += 0.25 * CFDS;
    }
    switch (rt) {
      case PT.LIGH: case PT.TESC: continue;
      case PT.CLNE: case PT.THDR: case PT.DMND: case PT.FIRE: s.temp[rid] = restrictTemp(s.temp[rid] + Math.trunc(powderful / 10)); continue;
      case PT.DEUT: case PT.PLUT:
        s.temp[rid] = restrictTemp(s.temp[rid] + powderful); s.pv[c] = clampP(s.pv[c] + Math.trunc(powderful / 35));
        if (s.rng.chance(1, 3)) { s.changeType(rid, px, py, PT.NEUT); s.life[rid] = s.rng.between(480, 959); s.vx[rid] = s.rng.between(-5, 5); s.vy[rid] = s.rng.between(-5, 5); }
        break;
      case PT.COAL: case PT.BCOL: if (s.life[rid] > 100) s.life[rid] = 99; break;
      case PT.HEAC:
        s.temp[rid] = restrictTemp(s.temp[rid] + Math.trunc(powderful / 10));
        if (s.temp[rid] > E[PT.HEAC].HighTemperature) { s.changeType(rid, px, py, PT.LAVA); s.ctype[rid] = PT.HEAC; }
        break;
    }
    if ((E[rt].Properties & PROP_CONDUCTS) && s.life[rid] === 0) s.createPart(rid, px, py, PT.SPRK);
    s.pv[c] = clampP(s.pv[c] + Math.trunc(powderful / 400));
    if (!s.isHeatInsulator(rid)) s.temp[rid] = restrictTemp(s.temp[rid] + powderful / 1.3);
  }
  if (s.tmp2[i] === 1 || s.tmp2[i] === 3 || (s.tmp2[i] >= 6 && s.tmp2[i] <= 8)) {
    if (s.tmp2[i] >= 9) s.tmp2[i] = 7; else s.tmp2[i]--;
    return false;
  }
  if (s.tmp2[i] === 5 || s.life[i] <= 1) { s.killPart(i); return true; }
  const angle = (s.tmp[i] + s.rng.between(-30, 30)) % 360;
  const mult = Math.trunc(s.life[i] * 1.5) + s.rng.between(0, s.life[i]);
  let rx = Math.trunc(Math.cos(angle * Math.PI / 180) * mult), ry = Math.trunc(-Math.sin(angle * Math.PI / 180) * mult);
  createLineParallel(s, x, y, x + rx, y + ry, s.temp[i], s.life[i], Math.trunc(angle), s.tmp2[i], i);
  if (s.tmp2[i] === 2) {
    const angle2 = (Math.trunc(angle) + s.rng.between(-100, 100)) % 360;
    rx = Math.trunc(Math.cos(angle2 * Math.PI / 180) * mult); ry = Math.trunc(-Math.sin(angle2 * Math.PI / 180) * mult);
    createLineParallel(s, x, y, x + rx, y + ry, s.temp[i], s.life[i], Math.trunc(angle2), s.tmp2[i], i);
  }
  s.tmp2[i] = 7;
};

function burst(s: PowderSim, i: number, x: number, y: number, col: number): void {
  for (let n = 0; n < 40; n++) {
    const np = s.createPart(-3, x, y, PT.EMBR);
    if (np > -1) {
      const mag = s.rng.between(40, 99) * 0.05, a = s.rng.between(0, 6283) * 0.001;
      s.vx[np] = s.vx[i] * 0.5 + Math.cos(a) * mag; s.vy[np] = s.vy[i] * 0.5 + Math.sin(a) * mag;
      s.ctype[np] = col; s.tmp[np] = 1; s.life[np] = s.rng.between(70, 109); s.temp[np] = s.rng.between(5750, 6249);
    }
  }
  s.pv[s.cell(x, y)] += 8;
  s.killPart(i);
}
function launchDirection(s: PowderSim, x: number, y: number, g: number): [number, number] {
  s.gravityXY(x, y, g);
  let gx = s.gfx, gy = s.gfy;
  if (gx * gx + gy * gy < 0.001) { const a = s.rng.between(0, 6283) * 0.001; gx += Math.sin(a) * g * 0.5; gy += Math.cos(a) * g * 0.5; }
  return [gx, gy];
}
export const firw: Hook = (s, i, x, y) => {
  if (s.tmp[i] <= 0) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry), rt = TYP(r);
      if (rt === PT.FIRE || rt === PT.PLSM || rt === PT.THDR) {
        const [gx, gy] = launchDirection(s, x, y, E[PT.FIRW].Gravity);
        s.tmp[i] = 1; s.life[i] = s.rng.between(20, 29);
        const m = (s.life[i] + 20) * 0.2 / Math.sqrt(gx * gx + gy * gy);
        s.vx[i] -= gx * m; s.vy[i] -= gy * m;
        return false;
      }
    }
  } else if (s.tmp[i] === 1) {
    if (s.life[i] <= 0) s.tmp[i] = 2; else s.flags[i] &= ~1;
  } else { burst(s, i, x, y, (s.rng.between(11, 255) << 16) | (s.rng.between(11, 255) << 8) | s.rng.between(11, 255)); return true; }
};
export const fwrk: Hook = (s, i, x, y, ss) => {
  if (s.life[i] === 0 && ((ss && s.temp[i] > 400 && s.rng.chance(Math.trunc(9 + s.temp[i] / 40), 100000)) || s.ctype[i] === PT.DUST)) {
    let [gx, gy] = launchDirection(s, x, y, E[PT.FWRK].Gravity);
    const gmax = Math.max(Math.abs(gx), Math.abs(gy));
    if (s.evalMove(PT.FWRK, Math.trunc(x - gx / gmax + 0.5), Math.trunc(y - gy / gmax + 0.5))) {
      const m = 15 / Math.sqrt(gx * gx + gy * gy);
      let t = s.rng.between(-100, 100); gx += gx * t * 0.002; gy += gy * t * 0.002;
      t = s.rng.between(-100, 100); gx += -gy * t * 0.005; gy += gx * t * 0.005;
      s.life[i] = s.rng.between(18, 27); s.ctype[i] = 0; s.vx[i] -= gx * m; s.vy[i] -= gy * m;
      return false;
    }
  }
  if (s.life[i] < 3 && s.life[i] > 0) { burst(s, i, x, y, (s.rng.between(11, 255) << 16) | (s.rng.between(11, 255) << 8) | s.rng.between(11, 255)); return true; }
  if (s.life[i] >= 45) s.life[i] = 0;
};

export const c5: Hook = (s, i, x, y) => {
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    if ((TYP(r) !== PT.C5 && s.temp[ID(r)] < 100 && !s.isHeatInsulator(ID(r))) || TYP(r) === PT.CFLM) {
      if (s.rng.chance(1, 6)) { s.changeType(i, x, y, PT.CFLM); s.temp[ID(r)] = s.temp[i] = 0; s.life[i] = s.rng.between(50, 199); s.pv[s.cell(x, y)] += 1.5; }
    }
  }
  if (s.ctype[i] && !s.life[i]) {
    const vx = ((s.tmp[i] << 16) >> 16) / 255, vy = (s.tmp[i] >> 16) / 255, dx = ((s.tmp2[i] << 16) >> 16) / 255, dy = (s.tmp2[i] >> 16) / 255;
    const r = s.createPart(-3, x, y, PT.PHOT);
    if (r !== -1) { s.ctype[r] = s.ctype[i]; s.x[r] += dx; s.y[r] += dy; s.vx[r] = vx; s.vy[r] = vy; s.temp[r] = s.temp[i]; }
    s.ctype[i] = 0; s.tmp[i] = 0; s.tmp2[i] = 0;
  }
};

const shield = (stage: 1 | 2 | 3 | 4): Hook => (s, i, x, y) => {
  const next = [0, PT.SHLD2, PT.SHLD3, PT.SHLD4, 0][stage];
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    const grow = () => {
      for (let nx = -1; nx <= 1; nx++) for (let ny = -1; ny <= 1; ny++) if (!s.pmap[(y + ry + ny) * s.XRES + x + rx + nx]) {
        const np = s.createPart(-1, x + rx + nx, y + ry + ny, PT.SHLD1);
        if (np >= 0 && stage > 1) s.life[np] = 7;
      }
    };
    if (!r) {
      if (stage === 2) { if (s.life[i] > 0) s.createPart(-1, x + rx, y + ry, PT.SHLD1); }
      else if (stage === 3 || stage === 4) {
        if (s.rng.chance(1, stage === 3 ? 2500 : 5500)) {
          const np = s.createPart(-1, x + rx, y + ry, PT.SHLD1);
          if (np < 0) continue;
          s.life[np] = 7; s.changeType(i, x, y, PT.SHLD2);
        }
      }
      continue;
    }
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.SPRK && s.life[i] === 0) {
      const chance: [number, number] = stage === 1 ? [11, 40] : stage === 2 ? [1, 8] : stage === 3 ? [3, 500] : [0, 1];
      if (stage < 4 && s.rng.chance(chance[0], chance[1])) { s.changeType(i, x, y, next); s.life[i] = 7; }
      grow();
    } else if (stage === 1 && rt === PT.SHLD3 && s.rng.chance(2, 5)) { s.changeType(i, x, y, PT.SHLD2); s.life[i] = 7; }
    else if (stage === 2 && rt === PT.SHLD4 && s.rng.chance(2, 5)) { s.changeType(i, x, y, PT.SHLD3); s.life[i] = 7; }
    else if (stage === 3 && rt === PT.SHLD1 && s.life[i] > 3) { s.changeType(rid, x + rx, y + ry, PT.SHLD2); s.life[rid] = 7; }
    else if (stage === 4 && rt === PT.SHLD2 && s.life[i] > 3) { s.changeType(rid, x + rx, y + ry, PT.SHLD3); s.life[rid] = 7; }
  }
};
export const shld1 = shield(1), shld2 = shield(2), shld3 = shield(3), shld4 = shield(4);
