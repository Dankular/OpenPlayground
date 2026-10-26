/* PIPE / PPIP particle pipes (PIPE.cpp, PPIP.cpp; The Powder Toy, GPL-3.0). Pipe colour state lives in tmp bits, PFLAG_NORMALSPEED in
 * flags, the stored particle in ctype/tmp2/tmp3/tmp4. Decoration colour transfer is omitted (not tracked). */
import { CELL, ELEMENTS, ID, PT, PT_NUM, TYP, TYPE_ENERGY, TYPE_GAS, TYPE_LIQUID, TYPE_PART, WL } from '../elements';
import { type PortalRecord, type PowderSim } from '../sim';
import { soapDetach } from './soap';

const E = ELEMENTS;
type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
export const PFLAG_CAN_CONDUCT = 1, PFLAG_NORMALSPEED = 0x10000, PFLAG_INITIALIZING = 0x20000;
const RED = 0x40000, GREEN = 0x80000, BLUE = 0xc0000, COLORS = 0xc0000;
const REVERSED = 0x1000000, PAUSED = 0x2000000, T_REVERSE = 0x4000000, T_OFF = 0x8000000, T_ON = 0x10000000, TRIGGERS = 0x1c000000;
const OFFS: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const MOVING = TYPE_PART | TYPE_LIQUID | TYPE_GAS | TYPE_ENERGY;

const prevColor = (f: number) => { const c = f & COLORS; return c === RED ? GREEN : c === GREEN ? BLUE : c === BLUE ? RED : RED; };
const nextColor = (f: number) => { const c = f & COLORS; return c === RED ? BLUE : c === GREEN ? RED : GREEN; };

/** props_pipe_to_part writing into a free-standing record (portal slot). */
export function pipeToRecord(s: PowderSim, pipe: number, rec: PortalRecord, stor: boolean): void {
  rec.type = TYP(stor ? s.tmp[pipe] : s.ctype[pipe]);
  rec.temp = s.temp[pipe]; rec.life = s.tmp2[pipe]; rec.tmp = s.tmp3[pipe]; rec.ctype = s.tmp4[pipe];
  if (!(E[rec.type].Properties & TYPE_ENERGY)) { rec.vx = 0; rec.vy = 0; }
  rec.tmp2 = 0; rec.flags = 0;
  if (stor) s.tmp[pipe] = 0; else s.ctype[pipe] = 0;
}
/** Element_PIPE_transfer_pipe_to_part for a live particle. */
export function pipeToPart(s: PowderSim, pipe: number, part: number): void {
  const t = TYP(s.ctype[pipe]);
  s.type[part] = t; // keep type consistent with ctype payload as upstream does
  s.temp[part] = s.temp[pipe]; s.life[part] = s.tmp2[pipe]; s.tmp[part] = s.tmp3[pipe]; s.ctype[part] = s.tmp4[pipe];
  if (!(E[t].Properties & TYPE_ENERGY)) { s.vx[part] = 0; s.vy[part] = 0; }
  s.tmp2[part] = 0; s.flags[part] = 0;
  s.ctype[pipe] = 0;
}
function partToPipe(s: PowderSim, part: number, pipe: number): void {
  s.ctype[pipe] = s.type[part];
  if ((s.tmp[pipe] & PFLAG_CAN_CONDUCT) === 0) s.temp[pipe] = s.temp[part];
  else { const cp = E[s.type[pipe]].HeatCapacity, cq = E[s.type[part]].HeatCapacity; s.temp[pipe] = (cq * s.temp[part] + cp * s.temp[pipe]) / (cq + cp); }
  s.tmp2[pipe] = s.life[part]; s.tmp3[pipe] = s.tmp[part]; s.tmp4[pipe] = s.ctype[part];
}
function pipeToPipe(s: PowderSim, src: number, dest: number, stor: boolean): void {
  if (stor) { s.ctype[dest] = s.tmp[src]; s.tmp[src] = 0; } else { s.ctype[dest] = s.ctype[src]; s.ctype[src] = 0; }
  if ((s.tmp[dest] & PFLAG_CAN_CONDUCT) === 0) s.temp[dest] = s.temp[src];
  else {
    const sc = s.ctype[dest] /* already moved payload type */, cSrc = sc > 0 && sc < PT_NUM ? E[sc].HeatCapacity : 1, cDest = E[s.type[dest]].HeatCapacity;
    s.temp[dest] = (cSrc * s.temp[src] + cDest * s.temp[dest]) / (cSrc + cDest);
  }
  s.tmp2[dest] = s.tmp2[src]; s.tmp3[dest] = s.tmp3[src]; s.tmp4[dest] = s.tmp4[src];
}
export function pipeToPipeFromStor(s: PowderSim, stor: number, pipe: number): void { pipeToPipe(s, stor, pipe, true); }

function pushParticle(s: PowderSim, i: number, count: number, original: number): void {
  const notctype = nextColor(s.tmp[i]);
  if (!TYP(s.ctype[i]) || count >= 2) return;
  const x = (s.x[i] + 0.5) | 0, y = (s.y[i] + 0.5) | 0, XRES = s.XRES;
  const toPortal = (prti: number) => {
    let ch = s.tmp[prti]; if (ch >= 101) ch = 100; else if (ch < 0) ch = 0;
    for (let n = 0; n < 80; n++) {
      const slot = s.portalSlot(ch, count, n);
      if (!slot.type) { pipeToRecord(s, i, slot, false); return true; }
    }
    return false;
  };
  if (!(s.tmp[i] & 0x200)) {
    let rnd = s.rng.gen();
    for (let q = 0; q < 3; q++) {
      const rn = rnd & 7; rnd >>= 3;
      const r = s.pmap[(y + OFFS[rn][1]) * XRES + x + OFFS[rn][0]];
      if (!r) continue;
      const rid = ID(r);
      if ((TYP(r) === PT.PIPE || TYP(r) === PT.PPIP) && (s.tmp[rid] & COLORS) !== notctype && !TYP(s.ctype[rid])) {
        pipeToPipe(s, i, rid, false);
        if (rid > original) s.flags[rid] |= PFLAG_NORMALSPEED;
        count++;
        pushParticle(s, rid, count, original);
      } else if (TYP(r) === PT.PRTI) { if (toPortal(rid)) count++; }
    }
  } else {
    const coords = 7 - ((s.tmp[i] >> 10) & 7), ox = OFFS[coords][0], oy = OFFS[coords][1];
    const r = s.pmap[(y + oy) * XRES + x + ox], rid = ID(r);
    if ((TYP(r) === PT.PIPE || TYP(r) === PT.PPIP) && (s.tmp[rid] & COLORS) !== notctype && !TYP(s.ctype[rid])) {
      pipeToPipe(s, i, rid, false);
      if (rid > original) s.flags[rid] |= PFLAG_NORMALSPEED;
      count++;
      pushParticle(s, rid, count, original);
    } else if (TYP(r) === PT.PRTI) { if (toPortal(rid)) count++; }
    else if (!r) {
      const np = s.createPart(-1, x + ox, y + oy, TYP(s.ctype[i]));
      if (np !== -1) pipeToPart(s, i, np);
    }
  }
}

export function ppipFloodTrigger(s: PowderSim, x: number, y: number, sparkedBy: number): void {
  const XRES = s.XRES, YRES = s.YRES, t = TYP(s.pmap[y * XRES + x]);
  if (t !== PT.PIPE && t !== PT.PPIP) return;
  let prop = 0;
  if (sparkedBy === PT.PSCN) prop = T_ON << 3; else if (sparkedBy === PT.NSCN) prop = T_OFF << 3;
  else if (sparkedBy === PT.INST) prop = T_REVERSE << 3; else if (sparkedBy === PT.HEAC) prop = PFLAG_CAN_CONDUCT;
  if (prop === 0 || (t !== PT.PPIP && sparkedBy !== PT.HEAC) || (s.tmp[ID(s.pmap[y * XRES + x])] & prop)) return;
  const stack: number[] = [x, y];
  while (stack.length) {
    y = stack.pop()!; x = stack.pop()!;
    let x1 = x, x2 = x;
    while (x1 >= CELL && TYP(s.pmap[y * XRES + x1 - 1]) === t) x1--;
    while (x2 < XRES - CELL && TYP(s.pmap[y * XRES + x2 + 1]) === t) x2++;
    for (x = x1; x <= x2; x++) {
      const id = ID(s.pmap[y * XRES + x]);
      if (!(s.tmp[id] & prop) && sparkedBy !== PT.HEAC) s.ppipChanged = true;
      s.tmp[id] |= prop;
    }
    if (y >= CELL + 1) for (x = x1 - 1; x <= x2 + 1; x++) if (TYP(s.pmap[(y - 1) * XRES + x]) === t && !(s.tmp[ID(s.pmap[(y - 1) * XRES + x])] & prop)) stack.push(x, y - 1);
    if (y < YRES - CELL - 1) for (x = x1 - 1; x <= x2 + 1; x++) if (TYP(s.pmap[(y + 1) * XRES + x]) === t && !(s.tmp[ID(s.pmap[(y + 1) * XRES + x])] & prop)) stack.push(x, y + 1);
  }
}

export const pipe: Hook = (s, i, x, y, ss, nt) => {
  const XRES = s.XRES, at = (rx: number, ry: number) => s.pmap[(y + ry) * XRES + x + rx];
  if (s.ctype[i] && !E[TYP(s.ctype[i])]?.Enabled) s.ctype[i] = 0;
  if (s.tmp[i] & TRIGGERS) {
    let pauseChanged = false;
    if (s.tmp[i] & T_ON) { if (s.tmp[i] & PAUSED) pauseChanged = true; s.tmp[i] &= ~PAUSED; }
    else if (s.tmp[i] & T_OFF) { if (!(s.tmp[i] & PAUSED)) pauseChanged = true; s.tmp[i] |= PAUSED; }
    if (pauseChanged) {
      for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
        if (!rx && !ry) continue;
        const r = at(rx, ry);
        if (TYP(r) === PT.BRCK) s.tmp[ID(r)] = (s.tmp[i] & PAUSED) ? 0 : 1;
      }
    }
    if (s.tmp[i] & T_REVERSE) {
      s.tmp[i] ^= REVERSED;
      if ((s.tmp[i] & COLORS) !== GREEN) s.tmp[i] ^= GREEN;
      if (s.tmp[i] & 0x100) {
        const c1 = (s.tmp[i] >> 13) & 0xf, c2 = (s.tmp[i] >> 9) & 0xf;
        s.tmp[i] &= ~0x1fe00; s.tmp[i] |= c1 << 9; s.tmp[i] |= c2 << 13;
      }
    }
    s.tmp[i] &= ~TRIGGERS;
  }
  if ((s.tmp[i] & COLORS) && !(s.tmp[i] & PAUSED)) {
    if (s.life[i] === 3) {
      let last = -1, neighbours = 0, count = 0, heat = false;
      for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
        if (!rx && !ry) continue;
        count++;
        const r = at(rx, ry);
        if (!r) continue;
        if (TYP(r) === PT.HEAC) { heat = true; continue; }
        if (TYP(r) !== PT.PIPE && TYP(r) !== PT.PPIP) continue;
        const rid = ID(r), next = nextColor(s.tmp[i]), prev = prevColor(s.tmp[i]);
        if (s.tmp[rid] & PFLAG_INITIALIZING) {
          s.tmp[rid] |= next; s.tmp[rid] &= ~PFLAG_INITIALIZING; s.life[rid] = 6;
          if (s.tmp[i] & 0x100) { s.tmp[rid] |= 0x200; s.tmp[rid] |= (count - 1) << 10; s.tmp[i] |= (8 - count) << 14; s.tmp[i] |= 0x2000; }
          neighbours++; last = rid;
        } else if ((s.tmp[rid] & COLORS) !== prev) { neighbours++; last = rid; }
      }
      if (neighbours === 1) s.tmp[last] |= 0x100;
      if (heat) ppipFloodTrigger(s, x, y, PT.HEAC);
    } else {
      if (s.flags[i] & PFLAG_NORMALSPEED) s.flags[i] &= ~PFLAG_NORMALSPEED; else pushParticle(s, i, 0, i);
      if (nt) {
        const rn = s.rng.gen() & 7, rx = OFFS[rn][0], ry = OFFS[rn][1];
        let r = at(rx, ry);
        if (!r) r = s.photons[(y + ry) * XRES + x + rx];
        if (ss && !r && TYP(s.ctype[i])) {
          const np = s.createPart(-1, x + rx, y + ry, TYP(s.ctype[i]));
          if (np !== -1) pipeToPart(s, i, np);
        } else if (!TYP(s.ctype[i]) && (E[TYP(r)].Properties & MOVING)) {
          if (TYP(r) === PT.SOAP) soapDetach(s, ID(r));
          partToPipe(s, ID(r), i);
          s.killPart(ID(r));
        } else if (!TYP(s.ctype[i]) && TYP(r) === PT.STOR && s.tmp[ID(r)] > 0 && s.tmp[ID(r)] < PT_NUM && (E[s.tmp[ID(r)]].Properties & MOVING)) pipeToPipe(s, ID(r), i, true);
      }
    }
  } else if (!(s.tmp[i] & (COLORS | PFLAG_INITIALIZING)) && s.life[i] <= 10) {
    for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
      if ((rx || ry) && !at(rx, ry)) {
        const index = s.createPart(-1, x + rx, y + ry, PT.BRCK);
        if (s.type[i] === PT.PPIP && index !== -1) s.tmp[index] = 1;
      }
    }
    if (s.life[i] <= 1) s.tmp[i] |= PFLAG_INITIALIZING;
  } else if (s.tmp[i] & PFLAG_INITIALIZING) {
    if (!s.life[i]) {
      for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
        if (!rx && !ry) continue;
        const c = s.cell(x + rx, y + ry), w = s.bmap[c];
        if (!at(rx, ry) && w !== WL.ALLOWAIR && w !== WL.WALL && w !== WL.WALLELEC && (w !== WL.EWALL || s.emap[c])) s.life[i] = 50;
      }
    } else if (s.life[i] === 5) {
      let single = 1;
      for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
        if (!rx && !ry) continue;
        const r = at(rx, ry);
        if ((TYP(r) === PT.PIPE || TYP(r) === PT.PPIP) && s.life[i]) single = 0;
      }
      if (single) s.tmp[i] |= 0x100;
    } else if (s.life[i] === 2) { s.tmp[i] |= RED; s.tmp[i] &= ~PFLAG_INITIALIZING; s.life[i] = 6; }
  }
};
