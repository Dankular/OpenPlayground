/* CRAY (particle ray) and DRAY (duplicator ray). Ported from CRAY.cpp / DRAY.cpp, The Powder Toy (GPL-3.0).
 * Decoration colour (dcolour) tinting through FILT is not tracked, so it is skipped. */
import { ELEMENTS, ID, PT, PT_NUM, TYP, TYPE_ENERGY } from '../elements';
import type { PowderSim } from '../sim';
import { MAX_FIGHTERS } from './stickman';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;

export const cray: Hook = (s, i, x, y) => {
  const XRES = s.XRES, YRES = s.YRES;
  const ct = s.ctype[i];
  if (ct <= 0 || !E[TYP(ct)]?.Enabled) {
    for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
      const k = (y + ry) * XRES + x + rx, r = s.photons[k] || s.pmap[k];
      if (!r) continue;
      const rt = TYP(r);
      if (rt !== PT.CRAY && rt !== PT.PSCN && rt !== PT.INST && rt !== PT.METL && rt !== PT.SPRK && rt < PT_NUM) { s.ctype[i] = rt; s.temp[i] = s.temp[ID(r)]; }
    }
    return;
  }
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const sp = s.pmap[(y + ry) * XRES + x + rx];
    if (TYP(sp) !== PT.SPRK || s.life[ID(sp)] !== 3) continue;
    const sid = ID(sp), destroy = s.ctype[sid] === PT.PSCN, nostop = s.ctype[sid] === PT.INST, createSpark = s.ctype[sid] === PT.INWR;
    let remaining = s.tmp[i] ? s.tmp[i] : 255;
    const spaces = s.tmp2[i], nxi = -rx, nyi = -ry;
    for (let go = true, nxx = spaces * nxi, nyy = spaces * nyi; go; nyy += nyi, nxx += nxi) {
      const px = x + nxi + nxx, py = y + nyi + nyy;
      if (!(px < XRES && py < YRES && px >= 0 && py >= 0)) break;
      const r = s.pmap[py * XRES + px];
      if (!s.isWallBlocking(px, py, TYP(s.ctype[i])) && (!r || createSpark)) {
        const nr = s.createPart(-1, px, py, TYP(s.ctype[i]), ID(s.ctype[i]));
        if (nr !== -1) {
          s.temp[nr] = s.temp[i];
          if (s.life[i] > 0) s.life[nr] = s.life[i];
          if (!--remaining) go = false;
        }
      } else if (TYP(r) === PT.FILT) s.life[ID(r)] = 4;
      else if (TYP(r) === PT.CRAY || nostop) go = true;
      else if (destroy && r && TYP(r) !== PT.DMND) { s.killPart(ID(r)); if (!--remaining) go = false; }
      else go = false;
      if (!remaining) go = false;
    }
  }
};

export const dray: Hook = (s, i, x, y) => {
  const XRES = s.XRES, ctype = TYP(s.ctype[i]), extra = ID(s.ctype[i]);
  let copyLength = s.tmp[i], copySpaces = s.tmp2[i];
  if (copySpaces < 0) copySpaces = s.tmp2[i] = 0;
  if (copyLength < 0) copyLength = s.tmp[i] = 0; else if (copyLength > 0) copySpaces++;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!rx && !ry) continue;
    const r = s.pmap[(y + ry) * XRES + x + rx];
    if (TYP(r) !== PT.SPRK || s.life[ID(r)] !== 3) continue;
    const sid = ID(r), overwrite = s.ctype[sid] === PT.PSCN;
    if (s.ctype[sid] === PT.INWR && rx && ry) continue;
    let partsRemaining = copyLength, xTo = -1, yTo = -1, localLength = copyLength;
    let found = false, isEnergy = false;
    const xs = -rx, ys = -ry;
    for (let xc = x + xs, yc = y + ys; ; xc += xs, yc += ys) {
      if (!s.inBounds(xc, yc)) break;
      let rr: number;
      if (!found) {
        rr = s.pmap[yc * XRES + xc];
        if (!rr) { rr = s.photons[yc * XRES + xc]; if (rr) found = isEnergy = true; } else found = true;
      }
      rr = ((ctype && (E[ctype].Properties & TYPE_ENERGY)) || isEnergy) ? s.photons[yc * XRES + xc] : s.pmap[yc * XRES + xc];
      if ((!localLength && TYP(rr) === ctype && (ctype !== PT.LIFE || s.ctype[ID(rr)] === extra)) || !--partsRemaining) {
        localLength -= partsRemaining;
        xTo = xc + xs * copySpaces; yTo = yc + ys * copySpaces;
        break;
      }
    }
    partsRemaining = localLength + 1;
    for (let xc = x + xs, yc = y + ys; s.inBounds(xTo, yTo) && --partsRemaining; xc += xs, yc += ys, xTo += xs, yTo += ys) {
      const src = isEnergy ? s.photons[yc * XRES + xc] : s.pmap[yc * XRES + xc], type = TYP(src);
      if (overwrite) {
        const dst = isEnergy ? s.photons[yTo * XRES + xTo] : s.pmap[yTo * XRES + xTo];
        if (dst) s.killPart(ID(dst));
      }
      let p: number;
      if (type === PT.SPRK) p = s.createPart(-1, xTo, yTo, PT.METL);
      else if (type === PT.STKM || type === PT.STKM2) continue;
      else if (type) p = s.createPart(-1, xTo, yTo, type);
      else continue;
      if (p >= 0) {
        if (type === PT.SPRK) s.changeType(p, xTo, yTo, PT.SPRK);
        if (isEnergy || type !== PT.FIGH) s.copyPart(p, ID(src));
        else {
          // FIGH: .tmp points to fighter metadata, keep it and copy only the fighter's settings
          const keep = s.tmp[p], other = ID(src), otherTmp = s.tmp[other];
          s.copyPart(p, other); s.tmp[p] = keep;
          if (otherTmp >= 0 && otherTmp < MAX_FIGHTERS) {
            const from = s.fighters[otherTmp], to = s.fighters[keep & 0xff];
            to.rocketBoots = from.rocketBoots; to.fan = from.fan; to.elem = from.elem;
          }
        }
        s.x[p] = xTo; s.y[p] = yTo;
      }
    }
  }
};
