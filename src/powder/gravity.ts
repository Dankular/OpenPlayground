/* Newtonian gravity: mass map -> force field by FFT convolution with a 1/r^2 point-mass kernel.
 * Ported from simulation/gravity/Fft.cpp and Simulation::UpdateGravityMask (The Powder Toy, GPL-3.0).
 * Differences: this uses its own radix-2 FFT with zero padding to the next power of two (linear convolution, same result for
 * the offsets that occur), runs synchronously instead of on a worker thread (so the field is not one frame late), and
 * recomputes only when the mass map or mask changed, as upstream does. */
import { WL } from './elements';

const M_GRAV = 6.673e-1;

function fft1(re: Float64Array, im: Float64Array, off: number, stride: number, n: number, inverse: boolean, cos: Float64Array, sin: Float64Array): void {
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) {
      const wr = cos[k * step], wi = inverse ? sin[k * step] : -sin[k * step];
      const a = off + (i + k) * stride, b = off + (i + k + half) * stride;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}

export class NewtonianGravity {
  enabled = false;
  readonly mass: Float32Array; readonly mask: Uint8Array;
  readonly forceX: Float32Array; readonly forceY: Float32Array;
  forceRecalc = true;
  private W: number; private H: number;
  private cosW: Float64Array; private sinW: Float64Array; private cosH: Float64Array; private sinH: Float64Array;
  private kxRe?: Float64Array; private kxIm?: Float64Array; private kyRe?: Float64Array; private kyIm?: Float64Array;
  private lastMass: Float32Array; private lastMask: Uint8Array;

  constructor(readonly cellsX: number, readonly cellsY: number) {
    const n = cellsX * cellsY;
    this.mass = new Float32Array(n); this.mask = new Uint8Array(n).fill(1);
    this.forceX = new Float32Array(n); this.forceY = new Float32Array(n);
    this.lastMass = new Float32Array(n); this.lastMask = new Uint8Array(n);
    const pow2 = (v: number) => { let p = 1; while (p < v) p <<= 1; return p; };
    this.W = pow2(2 * cellsX); this.H = pow2(2 * cellsY);
    const table = (n2: number) => { const c = new Float64Array(n2 / 2), s = new Float64Array(n2 / 2); for (let i = 0; i < n2 / 2; i++) { c[i] = Math.cos(2 * Math.PI * i / n2); s[i] = Math.sin(2 * Math.PI * i / n2); } return [c, s] as const; };
    [this.cosW, this.sinW] = table(this.W); [this.cosH, this.sinH] = table(this.H);
  }

  private fft2(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const { W, H } = this;
    for (let y = 0; y < H; y++) fft1(re, im, y * W, 1, W, inverse, this.cosW, this.sinW);
    for (let x = 0; x < W; x++) fft1(re, im, x, W, H, inverse, this.cosH, this.sinH);
    if (inverse) { const k = 1 / (W * H); for (let i = 0; i < re.length; i++) { re[i] *= k; im[i] *= k; } }
  }

  private buildKernels(): void {
    // Upstream divides by NCELL*4 only because FFTW's inverse transform is unnormalised; ours is normalised, so no extra divisor.
    const { W, H, cellsX, cellsY } = this, size = W * H, scale = -M_GRAV;
    const kxr = new Float64Array(size), kxi = new Float64Array(size), kyr = new Float64Array(size), kyi = new Float64Array(size);
    for (let dy = -(cellsY - 1); dy < cellsY; dy++) for (let dx = -(cellsX - 1); dx < cellsX; dx++) {
      if (!dx && !dy) continue;
      const d = Math.hypot(dx, dy), k = ((dy + H) % H) * W + ((dx + W) % W);
      kxr[k] = scale * dx / (d * d * d); kyr[k] = scale * dy / (d * d * d);
    }
    this.fft2(kxr, kxi, false); this.fft2(kyr, kyi, false);
    this.kxRe = kxr; this.kxIm = kxi; this.kyRe = kyr; this.kyIm = kyi;
  }

  /** Recompute forces if the mass map or mask changed since the last call (or forceRecalc). */
  update(): void {
    if (!this.enabled) return;
    let same = !this.forceRecalc;
    if (same) for (let i = 0; i < this.mass.length; i++) if (this.mass[i] !== this.lastMass[i] || this.mask[i] !== this.lastMask[i]) { same = false; break; }
    if (same) return;
    this.forceRecalc = false;
    this.lastMass.set(this.mass); this.lastMask.set(this.mask);
    if (!this.kxRe) this.buildKernels();
    const { W, H, cellsX, cellsY } = this, size = W * H;
    const mr = new Float64Array(size), mi = new Float64Array(size);
    for (let y = 0; y < cellsY; y++) for (let x = 0; x < cellsX; x++) mr[y * W + x] = this.mask[y * cellsX + x] ? this.mass[y * cellsX + x] : 0;
    this.fft2(mr, mi, false);
    const xr = new Float64Array(size), xi = new Float64Array(size), yr = new Float64Array(size), yi = new Float64Array(size);
    const kxr = this.kxRe!, kxi = this.kxIm!, kyr = this.kyRe!, kyi = this.kyIm!;
    for (let i = 0; i < size; i++) {
      xr[i] = mr[i] * kxr[i] - mi[i] * kxi[i]; xi[i] = mr[i] * kxi[i] + mi[i] * kxr[i];
      yr[i] = mr[i] * kyr[i] - mi[i] * kyi[i]; yi[i] = mr[i] * kyi[i] + mi[i] * kyr[i];
    }
    this.fft2(xr, xi, true); this.fft2(yr, yi, true);
    for (let y = 0; y < cellsY; y++) for (let x = 0; x < cellsX; x++) {
      const c = y * cellsX + x, m = this.mask[c];
      this.forceX[c] = m ? xr[y * W + x] : 0; this.forceY[c] = m ? yr[y * W + x] : 0;
    }
  }

  /** Simulation::UpdateGravityMask: cells reachable from the border without crossing a gravity wall carry gravity. */
  updateMask(bmap: Uint8Array): void {
    const { cellsX: X, cellsY: Y } = this;
    this.mask.fill(0);
    const stack: number[] = [];
    const check = (x: number, y: number) => {
      const c = y * X + x;
      if (bmap[c] === WL.GRAV || this.mask[c]) return;
      this.mask[c] = 1;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + ox, ny = y + oy; if (nx >= 0 && ny >= 0 && nx < X && ny < Y) stack.push(nx, ny); }
    };
    for (let x = 0; x < X; x++) { check(x, 0); check(x, Y - 1); }
    for (let y = 1; y < Y - 1; y++) { check(0, y); check(X - 1, y); }
    while (stack.length) { const y = stack.pop()!, x = stack.pop()!; check(x, y); }
    this.forceRecalc = true;
  }

  clearForces(): void { this.forceX.fill(0); this.forceY.fill(0); this.forceRecalc = true; }
}
