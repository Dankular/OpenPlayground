/* Portals PRTI / PRTO (PRTI.cpp, PRTO.cpp, orbitalparts.h; The Powder Toy, GPL-3.0). Stickmen enter portals through STKM's interact(). */
import { ELEMENTS, ID, PT, TYP, TYPE_ENERGY, TYPE_GAS, TYPE_LIQUID, TYPE_PART } from '../elements';
import { clearRecord, type PowderSim } from '../sim';
import { soapDetach } from './soap';
import { pipeToRecord } from './pipes';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
export const PRX = [-1, 0, 1, 1, 1, 0, -1, -1], PRY = [-1, -1, -1, 0, 1, 1, 1, 0];
const MOVING = TYPE_PART | TYPE_LIQUID | TYPE_GAS | TYPE_ENERGY;

function orbitGet(b1: number, b2: number, d: number[], l: number[]): void {
  for (let k = 0; k < 4; k++) { d[k] = (b1 >>> (8 * k)) & 0xff; l[k] = (b2 >>> (8 * k)) & 0xff; }
}
function orbitSet(s: PowderSim, i: number, d: number[], l: number[]): void {
  let b1 = 0, b2 = 0;
  for (let k = 0; k < 4; k++) { b1 |= (d[k] & 0xff) << (8 * k); b2 |= (l[k] & 0xff) << (8 * k); }
  s.life[i] = b1; s.ctype[i] = b2;
}
const channel = (s: PowderSim, i: number) => {
  let c = Math.trunc((s.temp[i] - 73.15) / 100 + 1);
  if (c >= 101) c = 100; else if (c < 0) c = 0;
  s.tmp[i] = c;
  return c;
};

export const prti: Hook = (s, i, x, y) => {
  let fe = 0;
  const ch = channel(s, i);
  for (let count = 0; count < 8; count++) {
    const rx = PRX[count], ry = PRY[count], k = (y + ry) * s.XRES + x + rx;
    let r = s.pmap[k];
    if (!r || TYP(r) === PT.STOR) fe = 1;
    if (!r || (!(E[TYP(r)].Properties & MOVING) && TYP(r) !== PT.SPRK && TYP(r) !== PT.STOR)) { r = s.photons[k]; if (!r) continue; }
    const rt = TYP(r), rid = ID(r);
    if (rt === PT.STKM || rt === PT.STKM2 || rt === PT.FIGH) continue;
    if (rt === PT.SOAP) soapDetach(s, rid);
    for (let n = 0; n < 80; n++) {
      const slot = s.portalSlot(ch, count, n);
      if (!slot.type) {
        if (rt === PT.STOR) {
          if (s.tmp[rid] > 0 && s.tmp[rid] < 512 && (E[s.tmp[rid]].Properties & MOVING)) { pipeToRecord(s, rid, slot, true); break; }
          break;
        }
        s.storeRecord(slot, rid);
        if (rt === PT.SPRK) s.changeType(rid, x + rx, y + ry, s.ctype[rid]); else s.killPart(rid);
        fe = 1;
        break;
      }
    }
  }
  const d = [0, 0, 0, 0], l = [0, 0, 0, 0];
  if (fe) {
    if (!s.life[i]) s.life[i] = s.rng.gen();
    if (!s.ctype[i]) s.ctype[i] = s.rng.gen();
    orbitGet(s.life[i], s.ctype[i], d, l);
    for (let r = 0; r < 4; r++) {
      if (d[r] > 1) {
        d[r] -= 12;
        if (d[r] < 1) { d[r] = s.rng.between(128, 255); l[r] = s.rng.between(0, 254); } else { l[r] += 2; l[r] %= 255; }
      } else { d[r] = s.rng.between(128, 255); l[r] = s.rng.between(0, 254); }
    }
    orbitSet(s, i, d, l);
  } else { s.life[i] = 0; s.ctype[i] = 0; }
};

export const prto: Hook = (s, i, x, y) => {
  let fe = 0;
  const ch = channel(s, i);
  for (let count = 0; count < 8; count++) {
    const rx = PRX[count], ry = PRY[count];
    if (s.pmap[(y + ry) * s.XRES + x + rx]) continue;
    fe = 1;
    for (let n = 0; n < 80; n++) {
      const dir = (count + s.rng.between(-1, 1) + 4) % 8, slot = s.portalSlot(ch, dir, n);
      if (slot.type === PT.SPRK) {
        for (const [ox, oy] of [[1, 0], [1, 1], [1, -1], [0, -1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) s.createPart(-1, x + ox, y + oy, PT.SPRK);
        clearRecord(slot);
        break;
      } else if (slot.type) {
        if (slot.type === PT.STKM) s.player.spwn = 0;
        if (slot.type === PT.STKM2) s.player2.spwn = 0;
        if (slot.type === PT.FIGH) { s.fighcount--; s.fighters[slot.tmp & 0xff].spwn = 0; }
        const np = s.createPart(-1, x + rx, y + ry, slot.type);
        if (np < 0) {
          if (slot.type === PT.STKM) s.player.spwn = 1;
          if (slot.type === PT.STKM2) s.player2.spwn = 1;
          if (slot.type === PT.FIGH) { s.fighcount++; s.fighters[slot.tmp & 0xff].spwn = 1; }
          continue;
        }
        if (s.type[np] === PT.FIGH) { s.fighters[s.tmp[np] & 0xff].spwn = 0; s.fighters[slot.tmp & 0xff].spwn = 1; }
        if (slot.vx === 0 && slot.vy === 0) { const vx = s.vx[np], vy = s.vy[np]; s.loadRecord(np, slot); s.vx[np] = vx; s.vy[np] = vy; }
        else s.loadRecord(np, slot);
        s.x[np] = x + rx; s.y[np] = y + ry;
        clearRecord(slot);
        break;
      }
    }
  }
  const d = [0, 0, 0, 0], l = [0, 0, 0, 0];
  if (fe) {
    if (!s.life[i]) s.life[i] = s.rng.gen();
    if (!s.ctype[i]) s.ctype[i] = s.rng.gen();
    orbitGet(s.life[i], s.ctype[i], d, l);
    for (let r = 0; r < 4; r++) {
      if (d[r] < 254) {
        d[r] += 16;
        if (d[r] > 254) { d[r] = 0; l[r] = s.rng.between(0, 254); } else { l[r] += 1; l[r] %= 255; }
      } else { d[r] = 0; l[r] = s.rng.between(0, 254); }
    }
    orbitSet(s, i, d, l);
  } else { s.life[i] = 0; s.ctype[i] = 0; }
};
