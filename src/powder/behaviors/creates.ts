/* Per-element Create hooks (randomised initial properties). Ported from the static create() functions in
 * src/simulation/elements/*.cpp, The Powder Toy (GPL-3.0). */
import { ID, PT, TYP } from '../elements';
import { filtInteract } from '../optics';
import type { Behavior } from '../sim';

const rad = (deg: number) => deg * Math.PI / 180;
const lifeOnly = (lo: number, hi: number): Behavior['create'] => (s, i) => { s.life[i] = s.rng.between(lo, hi); };
const emit = (speed: number, life: (s: any) => number, angle: (s: any) => number): Behavior['create'] => (s, i) => {
  const a = angle(s); s.life[i] = life(s); s.vx[i] = speed * Math.cos(a); s.vy[i] = speed * Math.sin(a);
};

export const CREATES: Record<string, Behavior['create']> = {
  FIRE: lifeOnly(120, 169), PLSM: lifeOnly(50, 199), CFLM: lifeOnly(50, 199), LAVA: lifeOnly(240, 359),
  SING: lifeOnly(60, 109), WARP: lifeOnly(70, 164),
  CLST: (s, i) => { s.tmp[i] = s.rng.between(0, 6); },
  CRMC: (s, i) => { s.tmp2[i] = s.rng.between(0, 4); },
  PQRT: (s, i) => { s.tmp2[i] = s.rng.between(0, 10); },
  ROCK: (s, i) => { s.tmp2[i] = s.rng.between(0, 10); },
  QRTZ: (s, i, x, y) => { s.tmp2[i] = s.rng.between(0, 10); s.tmp3[i] = Math.trunc(s.pv[s.cell(x, y)] * 64); },
  GLAS: (s, i, x, y) => { s.tmp3[i] = Math.trunc(s.pv[s.cell(x, y)] * 64); },
  TUNG: (s, i, x, y) => { s.tmp3[i] = Math.trunc(s.pv[s.cell(x, y)] * 64); },
  PTNM: (s, i) => { if (s.rng.chance(1, 15)) s.tmp[i] = 1; },
  FILT: (s, i, _x, _y, _t, v) => { s.tmp[i] = v; },
  TESC: (s, i, _x, _y, _t, v) => { if (v >= 0) s.tmp[i] = Math.min(v, 300); },
  ELEC: emit(2, () => 680, s => rad(s.rng.between(0, 359))),
  GRVT: emit(2, s => 250 + s.rng.between(0, 199), s => rad(s.rng.between(0, 359))),
  PROT: emit(2, () => 680, s => s.rng.between(0, 35) * 0.17453),
  NEUT: (s, i) => {
    const r = s.rng.between(128, 255) / 127, a = rad(s.rng.between(0, 359));
    s.life[i] = s.rng.between(480, 959); s.vx[i] = r * Math.cos(a); s.vy[i] = r * Math.sin(a);
  },
  PHOT: (s, i, x, y) => {
    const a = s.rng.between(0, 7) * 0.7854;
    s.vx[i] = 3 * Math.cos(a); s.vy[i] = 3 * Math.sin(a);
    const under = s.pmap[y * s.XRES + x];
    if (TYP(under) === PT.FILT) s.ctype[i] = filtInteract(s, ID(under), s.ctype[i]);
  },
  LIGH: (s, i, x, y, _t, v) => {
    s.life[i] = v >= 0 ? Math.min(v, 55) : 30;
    s.temp[i] = s.life[i] * 150;
    let [gx, gy] = s.gravityField(x, y, 1);
    let gsize = gx * gx + gy * gy;
    if (gsize < 0.0016) {
      const angle = s.rng.between(0, 6283) * 0.001;
      gsize = Math.sqrt(gsize);
      gx += Math.cos(angle) * (0.04 - gsize); gy += Math.sin(angle) * (0.04 - gsize);
    }
    s.tmp[i] = (Math.trunc(Math.atan2(-gy, gx) * 180 / Math.PI) + s.rng.between(-20, 20) + 360) % 360;
    s.tmp2[i] = 4;
  },
};
