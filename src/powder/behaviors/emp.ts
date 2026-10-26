/* EMP burst (Element_EMP_Trigger, EMP.cpp + Probability.cpp; The Powder Toy, GPL-3.0). Called once at the end of a frame
 * with the number of EMPs triggered during it. */
import { MAX_TEMP, PT, TYP, ID } from '../elements';
import { restrictTemp, type PowderSim } from '../sim';

const binomialGte1 = (n: number, p: number) => 1 - Math.pow(1 - p, n);

class DeltaTemp {
  private cdf: number[] = [];
  constructor(n: number, p: number, private step: number) {
    const maxK = MAX_TEMP / step < 10 ? Math.trunc(MAX_TEMP / step) + 1 : 10;
    let pTerm = Math.pow(1 - p, n), coeffN = 1, coeffD = 1, acc = 0;
    for (let k = 0; k < maxK; k++) {
      acc += pTerm * (coeffN / coeffD);
      this.cdf.push(acc);
      pTerm *= p / (1 - p); coeffN *= n - k; coeffD *= k + 1;
    }
  }
  apply(s: PowderSim, i: number): void {
    const r = s.rng.uniform01();
    let k = this.cdf.length;
    for (let j = 0; j < this.cdf.length; j++) if (r < this.cdf[j]) { k = j; break; }
    s.temp[i] = restrictTemp(s.temp[i] + k * this.step);
  }
}

export function empTrigger(s: PowderSim, count: number): void {
  const pCenter = binomialGte1(count, 1 / 48), tCenter = new DeltaTemp(count, 1 / 100, 3000);
  const pMetl = binomialGte1(count, 1 / 300), pBmtl = binomialGte1(count, 1 / 160), tMetal = new DeltaTemp(count, 1 / 280, 3000);
  const pMetlMore = binomialGte1(Math.trunc(count / 2), 1 / 160);
  const pRandWifi = binomialGte1(count, 1 / 8), pBreakWifi = binomialGte1(count, 1 / 16);
  const pSwch = binomialGte1(count, 1 / 100), tSwch = new DeltaTemp(count, 1 / 100, 2000);
  const pAray = binomialGte1(count, 1 / 60), pDlay = binomialGte1(count, 1 / 70);
  const hot = (n: number) => { s.temp[n] = restrictTemp(s.temp[n] + 1000); };
  for (let r = 0; r < s.active; r++) {
    const t = s.type[r], rx = Math.trunc(s.x[r]), ry = Math.trunc(s.y[r]);
    if (!(t === PT.SPRK || (t === PT.SWCH && s.life[r] !== 0 && s.life[r] !== 10) || (t === PT.WIRE && s.ctype[r] > 0))) continue;
    let isElec = false;
    const ct = s.ctype[r];
    if (ct === PT.PSCN || ct === PT.NSCN || ct === PT.PTCT || ct === PT.NTCT || ct === PT.INST || ct === PT.SWCH || t === PT.WIRE || t === PT.SWCH) {
      isElec = true;
      tCenter.apply(s, r);
      if (s.rng.uniform01() < pCenter) s.changeType(r, rx, ry, s.rng.chance(2, 5) ? PT.BREC : PT.NTCT);
    }
    for (let nx = -2; nx <= 2; nx++) for (let ny = -2; ny <= 2; ny++) {
      if (!(rx + nx >= 0 && ry + ny >= 0 && rx + nx < s.XRES && ry + ny < s.YRES && (rx || ry))) continue;
      const q = s.pmap[(ry + ny) * s.XRES + rx + nx];
      if (!q) continue;
      const nt = TYP(q), n = ID(q), px = rx + nx, py = ry + ny;
      if (isElec) {
        if (nt === PT.METL) {
          tMetal.apply(s, n);
          if (s.rng.uniform01() < pMetl) {
            s.changeType(n, px, py, PT.BMTL);
            if (s.rng.uniform01() < pMetlMore) { s.changeType(n, px, py, PT.BRMT); hot(n); }
          }
        } else if (nt === PT.BMTL) {
          tMetal.apply(s, n);
          if (s.rng.uniform01() < pBmtl) { s.changeType(n, px, py, PT.BRMT); hot(n); }
        } else if (nt === PT.WIFI) {
          if (s.rng.uniform01() < pRandWifi) s.temp[n] = s.rng.between(0, MAX_TEMP - 1);
          if (s.rng.uniform01() < pBreakWifi) { s.createPart(n, px, py, PT.BREC); hot(n); }
          continue;
        }
      }
      if (nt === PT.SWCH) { if (s.rng.uniform01() < pSwch) s.changeType(n, px, py, PT.BREC); tSwch.apply(s, n); }
      else if (nt === PT.ARAY) { if (s.rng.uniform01() < pAray) { s.createPart(n, px, py, PT.BREC); hot(n); } }
      else if (nt === PT.DLAY) { if (s.rng.uniform01() < pDlay) s.temp[n] = s.rng.between(0, 255) + 273.15; }
    }
  }
}
