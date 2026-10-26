/* Photon filter rules from FILT.cpp (The Powder Toy, GPL-3.0). Wavelength masks are 30-bit integers stored in ctype. */
import type { PowderSim } from './sim';

/** Element_FILT_getWavelengths: ctype if set, otherwise a band chosen by temperature. */
export function filtWavelengths(s: PowderSim, f: number): number {
  if (s.ctype[f] & 0x3fffffff) return s.ctype[f];
  let bin = Math.trunc((s.temp[f] - 273) * 0.025);
  if (bin < 0) bin = 0;
  if (bin > 25) bin = 25;
  return 0x1f << bin;
}

/** Element_FILT_interactWavelengths: wavelengths after a photon-like particle with `orig` passes filter particle `f`. */
export function filtInteract(s: PowderSim, f: number, orig: number): number {
  const mask = 0x3fffffff, wl = filtWavelengths(s, f);
  switch (s.tmp[f]) {
    case 0: return wl;
    case 1: return orig & wl;
    case 2: return orig | wl;
    case 3: return orig & ~wl;
    case 4: { let shift = Math.trunc((s.temp[f] - 273) * 0.025); if (shift <= 0) shift = 1; return (orig << shift) & mask; }
    case 5: { let shift = Math.trunc((s.temp[f] - 273) * 0.025); if (shift <= 0) shift = 1; return (orig >> shift) & mask; }
    case 6: return orig;
    case 7: return orig ^ wl;
    case 8: return ~orig & mask;
    case 9: {
      const t1 = (orig & 0x0000ff) + s.rng.between(-2, 2), t2 = ((orig & 0x00ff00) >> 8) + s.rng.between(-2, 2), t3 = ((orig & 0xff0000) >> 16) + s.rng.between(-2, 2);
      return (orig & 0xff000000) | (t3 << 16) | (t2 << 8) | t1;
    }
    case 10: { const lsb = BigInt(wl & -wl); return Number((BigInt(orig) * lsb) & 0x3fffffffn); }
    case 11: { const lsb = wl & -wl; return lsb ? Math.trunc(orig / lsb) & mask : 0; }
    default: return wl;
  }
}
