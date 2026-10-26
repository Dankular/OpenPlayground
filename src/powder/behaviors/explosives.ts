/* Explosives and flame-like helpers. Ported from BANG/BOMB/DEST/IGNT/FUSE/FSEP/EMBR/THDR.cpp, The Powder Toy (GPL-3.0). */
import { ELEMENTS, ID, MAX_PRESSURE, MAX_TEMP, MIN_PRESSURE, PROP_CONDUCTS, PROP_SPARKSETTLE, PT, TYP, TYPE_LIQUID, TYPE_PART, TYPE_SOLID } from '../elements';
import type { PowderSim } from '../sim';
import { restrictTemp } from '../sim';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number) => boolean | void;
const near = (s: PowderSim, x: number, y: number, rx: number, ry: number) => s.pmap[(y + ry) * s.XRES + x + rx];
const clampP = (v: number) => Math.min(MAX_PRESSURE, Math.max(MIN_PRESSURE, v));

export const bang: Hook = (s, i, x, y) => {
  const c = s.cell(x, y);
  if (s.tmp[i] === 0) {
    if (s.temp[i] >= 673) s.tmp[i] = 1;
    else for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (!r) continue;
      const rt = TYP(r);
      if (rt === PT.FIRE || rt === PT.PLSM || rt === PT.SPRK || rt === PT.LIGH) s.tmp[i] = 1;
    }
  } else if (s.tmp[i] === 1) {
    if (s.pmap[y * s.XRES + x] && ID(s.pmap[y * s.XRES + x]) === i) s.floodProp(x, y, 'tmp', 2);
    s.tmp[i] = 2;
  } else if (s.tmp[i] === 2) s.tmp[i] = 3;
  else {
    const otemp = s.temp[i] - 273.15;
    s.pv[c] += 0.5; s.tmp[i] = 0;
    if (s.rng.chance(1, 3)) {
      if (s.rng.chance(1, 2)) s.createPart(i, x, y, PT.FIRE);
      else { s.createPart(i, x, y, PT.SMKE); s.life[i] = s.rng.between(500, 549); }
      s.temp[i] = restrictTemp(MAX_TEMP / 4 + otemp);
    } else if (s.rng.chance(1, 15)) {
      s.createPart(i, x, y, PT.EMBR); s.tmp[i] = 0; s.life[i] = 50;
      s.temp[i] = restrictTemp(MAX_TEMP / 3 + otemp);
      s.vx[i] = s.rng.between(-10, 10); s.vy[i] = s.rng.between(-10, 10);
    } else s.killPart(i);
    return true;
  }
};

export const bomb: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r);
    if (rt !== PT.BOMB && rt !== PT.EMBR && rt !== PT.DMND && rt !== PT.CLNE && rt !== PT.PCLN && rt !== PT.BCLN && rt !== PT.VIBR) {
      const rad = 8;
      s.killPart(i);
      for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++) {
        if (k * k + j * j > rad * rad) continue;
        const yy = y + j, xx = x + k;
        if (yy < 0 || yy >= s.YRES || xx < 0 || xx >= s.XRES) continue;
        const nt = TYP(s.pmap[yy * s.XRES + xx]);
        if (nt !== PT.DMND && nt !== PT.CLNE && nt !== PT.PCLN && nt !== PT.BCLN && nt !== PT.VIBR) {
          if (nt) s.killPart(ID(s.pmap[yy * s.XRES + xx]));
          s.pv[s.cell(xx, yy)] += 0.1;
          const nb = s.createPart(-3, xx, yy, PT.EMBR);
          if (nb !== -1) { s.tmp[nb] = 2; s.life[nb] = 2; s.temp[nb] = MAX_TEMP; }
        }
      }
      for (let j = -(rad + 1); j <= rad + 1; j++) for (let k = -(rad + 1); k <= rad + 1; k++) {
        if (k * k + j * j > (rad + 1) * (rad + 1)) continue;
        const yy = y + j, xx = x + k;
        if (yy < 0 || yy >= s.YRES || xx < 0 || xx >= s.XRES) continue;
        if (TYP(s.pmap[yy * s.XRES + xx])) continue;
        const nb = s.createPart(-3, xx, yy, PT.EMBR);
        if (nb !== -1) { s.tmp[nb] = 0; s.life[nb] = 50; s.temp[nb] = MAX_TEMP; s.vx[nb] = s.rng.between(-20, 20); s.vy[nb] = s.rng.between(-20, 20); }
      }
      return true;
    }
  }
};

export const dest: Hook = (s, i, x, y) => {
  const rx = s.rng.between(-2, 2), ry = s.rng.between(-2, 2), r = near(s, x, y, rx, ry);
  if (!r) return false;
  const rt = TYP(r), rid = ID(r), c = s.cell(x, y);
  if (rt === PT.DEST || rt === PT.DMND || rt === PT.BCLN || rt === PT.CLNE || rt === PT.PCLN || rt === PT.PBCN) return false;
  if (s.life[i] <= 0 || s.life[i] > 37) { s.life[i] = s.rng.between(30, 49); s.pv[c] += 60; }
  if (rt === PT.PLUT || rt === PT.DEUT) {
    s.pv[c] += 20;
    if (s.rng.chance(1, 2)) { s.createPart(rid, x + rx, y + ry, PT.NEUT); s.temp[rid] = MAX_TEMP; s.pv[c] += 10; s.life[i] -= 4; }
  } else if (rt === PT.INSL) s.createPart(rid, x + rx, y + ry, PT.PLSM);
  else if (s.rng.chance(1, 3)) {
    s.killPart(rid);
    s.life[i] -= 4 * ((E[rt].Properties & TYPE_SOLID) ? 3 : 1);
    if (s.life[i] <= 0) s.life[i] = 1;
  } else if (!s.isHeatInsulator(rid)) s.temp[rid] = MAX_TEMP;
  s.temp[i] = MAX_TEMP;
  s.pv[c] = clampP(s.pv[c] + 80);
};

export const ignt: Hook = (s, i, x, y) => {
  if (s.tmp[i] === 0) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      if (!rx && !ry) continue;
      const r = near(s, x, y, rx, ry);
      if (!r) continue;
      const rt = TYP(r);
      if (rt === PT.FIRE || rt === PT.PLSM || rt === PT.SPRK || rt === PT.LIGH || (rt === PT.IGNT && s.life[ID(r)] === 1)) s.tmp[i] = 1;
    }
  } else if (s.life[i] > 0) {
    if (s.rng.chance(2, 3)) {
      const nb = s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), PT.EMBR);
      if (nb !== -1) {
        s.tmp[nb] = 0; s.life[nb] = 30; s.vx[nb] = s.rng.between(-10, 10); s.vy[nb] = s.rng.between(-10, 10);
        s.temp[nb] = restrictTemp(s.temp[i] - 273.15 + 400);
      }
    } else s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), PT.FIRE);
    s.life[i]--;
  }
};

export const fuse: Hook = (s, i, x, y) => {
  if (s.life[i] <= 0) { const r = s.createPart(i, x, y, PT.PLSM); if (r > -1) s.life[r] = 50; return true; }
  else if (s.life[i] < 40) {
    s.life[i]--;
    if (s.rng.chance(1, 100)) { const r = s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), PT.PLSM); if (r > -1) s.life[r] = 50; }
  }
  if (s.pv[s.cell(x, y)] > 2.7 && s.tmp[i] > 40) s.tmp[i] = 39;
  else if (s.tmp[i] <= 0) { s.createPart(i, x, y, PT.FSEP); return true; }
  else if (s.tmp[i] < 40) s.tmp[i]--;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    if (TYP(r) === PT.SPRK || (s.temp[i] >= 273.15 + 700 && s.rng.chance(1, 20))) if (s.life[i] > 40) s.life[i] = 39;
  }
};

export const fsep: Hook = (s, i, x, y) => {
  if (s.life[i] <= 0) { const r = s.createPart(i, x, y, PT.PLSM); if (r !== -1) s.life[r] = 50; return true; }
  else if (s.life[i] < 40) {
    s.life[i]--;
    if (s.rng.chance(1, 10)) { const r = s.createPart(-1, x + s.rng.between(-1, 1), y + s.rng.between(-1, 1), PT.PLSM); if (r > -1) s.life[r] = 50; }
  } else for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    if ((TYP(r) === PT.SPRK || s.temp[i] >= 273.15 + 400) && s.life[i] > 40 && s.rng.chance(1, 15)) s.life[i] = 39;
  }
};

export const embr: Hook = (s, i, x, y) => {
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const p = E[TYP(r)].Properties;
    if ((p & (TYPE_SOLID | TYPE_PART | TYPE_LIQUID)) && !(p & PROP_SPARKSETTLE)) { s.killPart(i); return true; }
  }
};

export const thdr: Hook = (s, i, x, y) => {
  let kill = false;
  const c = s.cell(x, y);
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!rx && !ry) continue;
    const r = near(s, x, y, rx, ry);
    if (!r) continue;
    const rt = TYP(r), rid = ID(r);
    if ((E[rt].Properties & PROP_CONDUCTS) && s.life[rid] === 0 && !(rt === PT.WATR || rt === PT.SLTW) && s.ctype[rid] !== PT.SPRK) {
      s.ctype[rid] = s.type[rid]; s.changeType(rid, x + rx, y + ry, PT.SPRK); s.life[rid] = 4; kill = true;
    } else if (rt !== PT.CLNE && rt !== PT.THDR && rt !== PT.SPRK && rt !== PT.DMND && rt !== PT.FIRE) {
      s.pv[c] = clampP(s.pv[c] + 100);
      if (s.legacyEnable && s.rng.chance(1, 200)) { s.life[i] = s.rng.between(120, 169); s.changeType(i, x, y, PT.FIRE); }
      else kill = true;
    }
  }
  if (kill) { s.killPart(i); return true; }
};
