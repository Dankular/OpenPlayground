/* Stickmen: STKM, STKM2, FIGH and their spawn points SPAWN / SPAWN2 (STKM.cpp, STKM2.cpp, FIGH.cpp, SPAWN*.cpp, Stickman.h;
 * The Powder Toy, GPL-3.0). Differences: leg state is Float32Array like the original's float[16], but intermediate arithmetic is
 * double precision; keyboard input is provided through Player.press/release (the original reads SDL keys in GameController). */
import { CELL, ELEMENTS, PROP_DEADLY, PROP_RADIOACTIVE, PT, PT_NUM, TYP, ID, TYPE_ENERGY, TYPE_GAS, TYPE_LIQUID, TYPE_SOLID, WL } from '../elements';
import { GRAV, restrictTemp, type Behavior, type PowderSim } from '../sim';

const E = ELEMENTS;
export const MAX_FIGHTERS = 100;
export const COMM = { LEFT: 1, RIGHT: 2, JUMP: 4, USE: 8 } as const;

export class Player {
  comm = 0; pcomm = 0; elem = 0;
  legs = new Float32Array(16); accs = new Float32Array(8);
  spwn = 0; frames = 0; rocketBoots = false; fan = false; spawnID = -1;
  /** Held-key helpers mirroring GameController::KeyPress / KeyRelease. */
  press(bit: number): void { if ((bit === COMM.JUMP || bit === COMM.USE) && (this.comm & bit)) return; this.comm |= bit; }
  release(bit: number): void {
    if (bit === COMM.LEFT || bit === COMM.RIGHT) { this.pcomm = this.comm; this.comm &= 12; }
    else if (bit === COMM.JUMP) this.comm &= 11;
    else if (bit === COMM.USE) this.comm &= 7;
  }
  reset(): void {
    this.comm = 0; this.pcomm = 0; this.elem = 0; this.legs.fill(0); this.accs.fill(0);
    this.spwn = 0; this.frames = 0; this.rocketBoots = false; this.fan = false; this.spawnID = -1;
  }
}

type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
const inBounds = (s: PowderSim, x: number, y: number) => s.inBounds(x, y);
const blocked = (s: PowderSim, t: number, x: number, y: number) => inBounds(s, x, y) && !s.evalMove(t, x, y);

export function initLegs(s: PowderSim, p: Player, i: number): void {
  const x = Math.trunc(s.x[i] + 0.5), y = Math.trunc(s.y[i] + 0.5);
  p.legs.set([x - 1, y + 6, x - 1, y + 6, x - 3, y + 12, x - 3, y + 12, x + 1, y + 6, x + 1, y + 6, x + 3, y + 12, x + 3, y + 12]);
  p.accs.fill(0);
  p.comm = 0; p.pcomm = 0; p.frames = 0; p.spwn = 0; p.fan = false; p.rocketBoots = false;
}

export function setElement(p: Player, element: number): void {
  const e = E[element];
  if (e.Falldown !== 0 || e.Properties & TYPE_GAS || e.Properties & TYPE_LIQUID || e.Properties & TYPE_ENERGY || element === PT.LOLZ || element === PT.LOVE) {
    if (!p.rocketBoots || element !== PT.PLSM) { p.elem = element; p.fan = false; }
  }
  if (element === PT.TESC || element === PT.LIGH) { p.elem = PT.LIGH; p.fan = false; }
}

function die(s: PowderSim, p: Player, i: number): void {
  if (p.fan) {
    s.pv[s.cell(Math.trunc(s.x[i] + 0.5), Math.trunc(s.y[i] + 0.5))] += 64;
  } else {
    const x = Math.trunc(s.x[i] + 0.5), y = Math.trunc(s.y[i] + 0.5);
    for (let r = -2; r <= 1; r++) {
      s.createPart(-1, x + r, y - 2, p.elem); s.createPart(-1, x + r + 1, y + 2, p.elem);
      s.createPart(-1, x - 2, y + r + 1, p.elem); s.createPart(-1, x + 2, y + r, p.elem);
    }
  }
  s.killPart(i);
}

const CHANNELS = 101;
function interact(s: PowderSim, p: Player, i: number, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= s.XRES || y >= s.YRES || !s.type[i]) return;
  const r = s.pmap[y * s.XRES + x];
  if (!r) return;
  const rt = TYP(r), rid = ID(r);
  let damage = 0;
  if (rt === PT.SPRK && p.elem !== PT.LIGH) damage += s.rng.between(32, 51);
  if (!s.isHeatInsulator(rid) && ((p.elem !== PT.LIGH && s.temp[rid] >= 323) || s.temp[rid] <= 243) && (!p.rocketBoots || rt !== PT.PLSM)) {
    damage += 2;
    p.accs[3] -= 1;
  }
  if (E[rt].Properties & PROP_DEADLY) damage += rt === PT.ACID ? 5 : 1;
  if (E[rt].Properties & PROP_RADIOACTIVE) damage++;
  if (damage) {
    if (damage > s.life[i]) { die(s, p, i); return; }
    s.life[i] -= damage;
  }
  if (rt === PT.PRTI && s.type[i]) {
    let ch = Math.trunc((s.temp[rid] - 73.15) / 100 + 1);
    if (ch >= CHANNELS) ch = CHANNELS - 1; else if (ch < 0) ch = 0;
    s.tmp[rid] = ch;
    for (let n = 0; n < 80; n++) {
      const slot = s.portalSlot(ch, 1, n);
      if (!slot.type) {
        s.storeRecord(slot, i);
        s.killPart(i);
        p.spwn = 1; // stop new STKM/fighters being created to replace the ones in the portal
        if (slot.type === PT.FIGH) s.fighcount++;
        break;
      }
    }
  }
  if ((rt === PT.BHOL || rt === PT.NBHL) && s.type[i]) {
    if (!s.legacyEnable) s.temp[rid] = restrictTemp(s.temp[rid] + s.temp[i] / 2);
    s.killPart(i);
  }
  if ((rt === PT.VOID || (rt === PT.PVOD && s.life[rid] === 10)) && (!s.ctype[rid] || ((s.ctype[rid] === s.type[i]) !== ((s.tmp[rid] & 1) === 1))) && s.type[i]) s.killPart(i);
}

export function runStickman(s: PowderSim, p: Player, i: number, x: number, y: number): boolean {
  const t = s.type[i], XRES = s.XRES, YRES = s.YRES;
  const dt = 0.9;
  let headV = 0.3, feetV = 0.45;
  const headH = 0.35, feetH = 0.15;
  if (!p.fan && s.ctype[i] && s.ctype[i] < PT_NUM && E[s.ctype[i]].Enabled) setElement(p, s.ctype[i]);
  p.frames++;
  if (s.temp[i] < 243) s.life[i] -= 1;
  if (s.temp[i] < 309.6 && s.temp[i] >= 243) s.temp[i] += 1;
  if (s.life[i] < 1 || (s.pv[s.cell(x, y)] >= 4.5 && !p.fan)) { die(s, p, i); return true; }

  let gvx = 0, gvy = 0;
  switch (s.gravityMode) {
    case GRAV.OFF: break;
    case GRAV.RADIAL: {
      const gravd = 0.01 - Math.hypot(s.x[i] - XRES / 2, s.y[i] - YRES / 2);
      gvx = (s.x[i] - XRES / 2) / gravd; gvy = (s.y[i] - YRES / 2) / gravd;
      break;
    }
    case GRAV.CUSTOM: gvx = s.customGravityX; gvy = s.customGravityY; break;
    default: gvy = 1;
  }
  const gc = s.cell(Math.trunc(s.x[i]), Math.trunc(s.y[i]));
  gvx += s.newton.forceX[gc]; gvy += s.newton.forceY[gc];
  let mvx = gvx, mvy = gvy, lowGrav = false;
  let tmp = Math.abs(mvx) > Math.abs(mvy) ? Math.abs(mvx) : Math.abs(mvy);
  if (tmp < 0.001) {
    lowGrav = true;
    mvx = -s.vx[i]; mvy = -s.vy[i];
    tmp = Math.abs(mvx) > Math.abs(mvy) ? Math.abs(mvx) : Math.abs(mvy);
  }
  if (tmp < 0.001) { mvx = 0; mvy = 1; tmp = 1; } else tmp = 1 / Math.sqrt(mvx * mvx + mvy * mvy);
  mvx *= tmp; mvy *= tmp;
  if (lowGrav) { headV = headH; feetV = feetH; }
  s.vx[i] -= gvx * dt; s.vy[i] -= gvy * dt;

  const L = p.legs, A = p.accs;
  // Verlet integration; legs[2k], legs[2k+1] hold the previous position, gravity applies to the feet only
  const verlet = (a: number, acc: number, g: number) => { const pp = 2 * L[a] - L[a + 2] + (A[acc] + g) * dt * dt; L[a + 2] = L[a]; L[a] = pp; };
  verlet(0, 0, 0); verlet(1, 1, 0); verlet(4, 2, gvx); verlet(5, 3, gvy);
  verlet(8, 4, 0); verlet(9, 5, 0); verlet(12, 6, gvx); verlet(13, 7, gvy);
  A.fill(0);

  const gx = (L[4] + L[12]) / 2 - gvy, gy = (L[5] + L[13]) / 2 + gvx;
  const dl = (gx - L[4]) ** 2 + (gy - L[5]) ** 2, dr = (gx - L[12]) ** 2 + (gy - L[13]) ** 2;
  const fx = (leg: number) => Math.trunc(L[leg * 8 + 4]), fy = (leg: number) => Math.trunc(L[leg * 8 + 5]);

  const rocketPlume = (skipLeg: number, signX: number, vxMul: number, vyMul: number) => {
    for (let leg = 0; leg < 2; leg++) {
      if (leg === skipLeg) continue;
      const np = s.createPart(-1, fx(leg), fy(leg), PT.PLSM);
      if (np >= 0) { s.vx[np] = s.vx[i] + vxMul; s.vy[np] = s.vy[i] + vyMul; s.life[np] += 30; }
    }
    void signX;
  };
  // Go left
  if ((p.comm & 1) === 1) {
    let moved = false;
    if (dl > dr) {
      if (blocked(s, t, fx(0), fy(0))) { A[2] = -3 * mvy - 3 * mvx; A[3] = 3 * mvx - 3 * mvy; A[0] = -mvy; A[1] = mvx; moved = true; }
    } else if (blocked(s, t, Math.trunc(L[12]), Math.trunc(L[13]))) { A[6] = -3 * mvy - 3 * mvx; A[7] = 3 * mvx - 3 * mvy; A[0] = -mvy; A[1] = mvx; moved = true; }
    if (!moved && p.rocketBoots) {
      s.vx[i] -= headH * mvy; s.vy[i] += headH * mvx;
      A[2] -= feetH * mvy; A[6] -= feetH * mvy; A[3] += feetH * mvx; A[7] += feetH * mvx;
      rocketPlume((p.comm & 2) === 2 ? 1 : -1, -1, mvy * 25, -mvx * 25);
    }
  }
  // Go right
  if ((p.comm & 2) === 2) {
    let moved = false;
    if (dl < dr) {
      if (blocked(s, t, fx(0), fy(0))) { A[2] = 3 * mvy - 3 * mvx; A[3] = -3 * mvx - 3 * mvy; A[0] = mvy; A[1] = -mvx; moved = true; }
    } else if (blocked(s, t, Math.trunc(L[12]), Math.trunc(L[13]))) { A[6] = 3 * mvy - 3 * mvx; A[7] = -3 * mvx - 3 * mvy; A[0] = mvy; A[1] = -mvx; moved = true; }
    if (!moved && p.rocketBoots) {
      s.vx[i] += headH * mvy; s.vy[i] -= headH * mvx;
      A[2] += feetH * mvy; A[6] += feetH * mvy; A[3] -= feetH * mvx; A[7] -= feetH * mvx;
      rocketPlume((p.comm & 1) === 1 ? 0 : -1, 1, -mvy * 25, mvx * 25);
    }
  }
  if (p.rocketBoots && (p.comm & 3) === 3) { s.vx[i] *= 0.5; s.vy[i] *= 0.5; A[2] = A[6] = 0; A[3] = A[7] = 0; }
  // Jump
  if ((p.comm & 4) === 4) {
    if (p.rocketBoots) {
      s.vx[i] -= headV * mvx; s.vy[i] -= headV * mvy;
      A[2] -= feetV * mvx; A[6] -= feetV * mvx; A[3] -= feetV * mvy; A[7] -= feetV * mvy;
      for (let leg = 0; leg < 2; leg++) {
        const np = s.createPart(-1, fx(leg), fy(leg) + 1, PT.PLSM);
        if (np >= 0) { s.vx[np] = s.vx[i] + mvx * 30; s.vy[np] = s.vy[i] + mvy * 30; s.life[np] += 10; }
      }
    } else if (blocked(s, t, Math.trunc(L[4]), Math.trunc(L[5])) || blocked(s, t, Math.trunc(L[12]), Math.trunc(L[13]))) {
      s.vx[i] -= 4 * mvx; s.vy[i] -= 4 * mvy;
      A[2] -= mvx; A[6] -= mvx; A[3] -= mvy; A[7] -= mvy;
    }
  }
  // Charge a detector wall if a foot is inside
  const footCell = (xx: number, yy: number) => {
    const cx = Math.trunc(Math.trunc(xx + 0.5) / CELL), cy = Math.trunc(Math.trunc(yy + 0.5) / CELL);
    return cx >= 0 && cy >= 0 && cx < s.XCELLS && cy < s.YCELLS ? cy * s.XCELLS + cx : -1;
  };
  for (const [lx, ly] of [[4, 5], [12, 13]]) {
    const c = footCell(L[lx], L[ly]);
    if (c >= 0 && s.bmap[c] === WL.DETECT) s.setEmap(Math.trunc(L[lx] / CELL), Math.trunc(L[ly] / CELL));
  }
  // Search for particles near the head
  for (let rx = -2; rx < 3; rx++) for (let ry = -2; ry < 3; ry++) {
    if (!(x + rx >= 0 && y + ry > 0 && x + rx < XRES && y + ry < YRES && (rx || ry))) continue;
    const k = (y + ry) * XRES + x + rx;
    let r = s.pmap[k];
    if (!r) r = s.photons[k];
    const bc = s.bmap[s.cell(x + rx, y + ry)];
    if (!r && !bc) continue;
    setElement(p, TYP(r));
    if (TYP(r) === PT.PLNT && s.life[i] < 100) {
      if (s.life[i] <= 95) s.life[i] += 5; else s.life[i] = 100;
      s.killPart(ID(r));
    }
    if (TYP(r) === PT.NEUT) {
      if (s.life[i] <= 100) s.life[i] -= Math.trunc((102 - s.life[i]) / 2); else s.life[i] = Math.trunc(s.life[i] * 0.9);
      s.killPart(ID(r));
    }
    if (bc === WL.FAN) p.fan = true;
    else if (bc === WL.EHOLE) p.rocketBoots = false;
    else if (bc === WL.GRAV) p.rocketBoots = true;
    if (TYP(r) === PT.PRTI) interact(s, p, i, rx, ry);
    if (!s.type[i]) return true;
  }
  // Use the element
  let rx = x + 3 * ((p.pcomm & 2) === 2 ? 1 : 0) - 3 * ((p.pcomm & 1) === 1 ? 1 : 0);
  let ry = y - 3 * (p.pcomm === 0 ? 1 : 0);
  if ((p.comm & 8) === 8) {
    ry -= 2 * s.rng.between(0, 1) + 1;
    const r = s.inBounds(rx, ry) ? s.pmap[ry * XRES + rx] : 0;
    if (E[TYP(r)].Properties & TYPE_SOLID) {
      s.createPart(-1, rx, ry, PT.SPRK);
      p.frames = 0;
    } else {
      let np = -1;
      if (p.fan) {
        for (let j = -4; j < 5; j++) for (let k = -4; k < 5; k++) {
          const airx = rx + 3 * ((p.pcomm & 2) === 2 ? 1 : 0) - 3 * ((p.pcomm & 1) === 1 ? 1 : 0) + j, airy = ry + k;
          if (airx < 0 || airy < 0 || airx >= XRES || airy >= YRES) continue;
          const c = s.cell(airx, airy);
          s.pv[c] += 0.03;
          if (airy + CELL < YRES) s.pv[c + s.XCELLS] += 0.03;
          if (airx + CELL < XRES) { s.pv[c + 1] += 0.03; if (airy + CELL < YRES) s.pv[c + s.XCELLS + 1] += 0.03; }
        }
      } else if (p.elem === PT.LIGH && p.frames < 30) np = -1;
      else np = s.createPart(-1, rx, ry, p.elem);
      if (np >= 0) {
        const dirSign = ((p.pcomm & 2) === 2 ? 1 : 0) - ((p.pcomm & 1) === 1 ? 1 : 0);
        if (p.elem === PT.PHOT) {
          const random = Math.abs(s.rng.between(-1, 1)) * 3;
          if (random === 0) s.killPart(np);
          else {
            s.vy[np] = 0;
            s.vx[np] = p.pcomm & 3 ? dirSign * random : random;
          }
        } else if (p.elem === PT.LIGH) {
          const power = 100;
          let angle = gvx !== 0 || gvy !== 0 ? Math.trunc(Math.atan2(mvx, mvy) * 180 / Math.PI) : s.rng.between(0, 359);
          if (p.pcomm & 1) angle += 180;
          if (angle > 360) angle -= 360;
          if (angle < 0) angle += 360;
          s.tmp[np] = angle;
          s.life[np] = s.rng.between(0, 1 + Math.trunc(power / 15)) + Math.trunc(power / 7);
          s.temp[np] = s.life[np] * power / 2.5;
          s.tmp2[np] = 1;
        } else if (!p.fan) {
          s.vx[np] -= -mvy * 5 * dirSign;
          s.vy[np] -= mvx * 5 * dirSign;
          s.vx[i] -= (E[p.elem].Weight * s.vx[np]) / 1000;
        }
        p.frames = 0;
      }
    }
  }
  // Joints
  let d = 25 / ((L[0] - L[4]) ** 2 + (L[1] - L[5]) ** 2 + 25) - 0.5;
  L[4] -= (L[0] - L[4]) * d; L[5] -= (L[1] - L[5]) * d; L[0] += (L[0] - L[4]) * d; L[1] += (L[1] - L[5]) * d;
  d = 25 / ((L[8] - L[12]) ** 2 + (L[9] - L[13]) ** 2 + 25) - 0.5;
  L[12] -= (L[8] - L[12]) * d; L[13] -= (L[9] - L[13]) * d; L[8] += (L[8] - L[12]) * d; L[9] += (L[9] - L[13]) * d;
  d = 36 / ((L[0] - s.x[i]) ** 2 + (L[1] - s.y[i]) ** 2 + 36) - 0.5;
  s.vx[i] -= (L[0] - s.x[i]) * d; s.vy[i] -= (L[1] - s.y[i]) * d; L[0] += (L[0] - s.x[i]) * d; L[1] += (L[1] - s.y[i]) * d;
  d = 36 / ((L[8] - s.x[i]) ** 2 + (L[9] - s.y[i]) ** 2 + 36) - 0.5;
  s.vx[i] -= (L[8] - s.x[i]) * d; s.vy[i] -= (L[9] - s.y[i]) * d; L[8] += (L[8] - s.x[i]) * d; L[9] += (L[9] - s.y[i]) * d;
  if (blocked(s, t, Math.trunc(L[4]), Math.trunc(L[5]))) { L[4] = L[6]; L[5] = L[7]; }
  if (blocked(s, t, Math.trunc(L[12]), Math.trunc(L[13]))) { L[12] = L[14]; L[13] = L[15]; }
  // "Pop" out of obstacles
  if (blocked(s, t, Math.trunc(L[4]), Math.trunc(L[5]))) { let tt = L[4]; L[4] = L[6]; L[6] = tt; tt = L[5]; L[5] = L[7]; L[7] = tt; }
  if (blocked(s, t, Math.trunc(L[12]), Math.trunc(L[13]))) { let tt = L[12]; L[12] = L[14]; L[14] = tt; tt = L[13]; L[13] = L[15]; L[15] = tt; }
  // Keep the legs apart
  const keepApart = (a: number, b: number, accA: number, accB: number) => {
    if ((L[a] - L[b]) ** 2 + (L[a + 1] - L[b + 1]) ** 2 < 16) {
      const tvx = -gvy, tvy = gvx;
      if (tvx || tvy) {
        const h = Math.hypot(tvx, tvy);
        A[accA] -= 0.2 * tvx / h; A[accA + 1] -= 0.2 * tvy / h; A[accB] += 0.2 * tvx / h; A[accB + 1] += 0.2 * tvy / h;
      }
    }
  };
  keepApart(4, 12, 2, 6);
  keepApart(0, 8, 0, 4);
  // Legs touching something
  interact(s, p, i, Math.trunc(L[4] + 0.5), Math.trunc(L[5] + 0.5));
  interact(s, p, i, Math.trunc(L[12] + 0.5), Math.trunc(L[13] + 0.5));
  interact(s, p, i, Math.trunc(L[4] + 0.5), Math.trunc(L[5]));
  interact(s, p, i, Math.trunc(L[12] + 0.5), Math.trunc(L[13]));
  if (!s.type[i]) return true;
  s.ctype[i] = p.elem;
  return false;
}

const stkm: Hook = (s, i, x, y) => runStickman(s, s.player, i, x, y);
const stkm2: Hook = (s, i, x, y) => runStickman(s, s.player2, i, x, y);

const figh: Hook = (s, i, x, y) => {
  if (s.tmp[i] < 0 || s.tmp[i] >= MAX_FIGHTERS) { s.killPart(i); return true; }
  const f = s.fighters[s.tmp[i] & 0xff];
  let tarx = 0, tary = 0;
  s.tmp2[i] = 0;
  if (s.player2.spwn) {
    if (s.player.spwn && (s.player.legs[2] - x) ** 2 + (s.player.legs[3] - y) ** 2 <= (s.player2.legs[2] - x) ** 2 + (s.player2.legs[3] - y) ** 2) {
      tarx = Math.trunc(s.player.legs[2]); tary = Math.trunc(s.player.legs[3]);
    } else { tarx = Math.trunc(s.player2.legs[2]); tary = Math.trunc(s.player2.legs[3]); }
    s.tmp2[i] = 1;
  } else if (s.player.spwn) { tarx = Math.trunc(s.player.legs[2]); tary = Math.trunc(s.player.legs[3]); s.tmp2[i] = 1; }
  const L = f.legs, em = (xx: number, yy: number) => !!s.evalMove(PT.FIGH, xx, yy);
  if (s.tmp2[i] === 1) {
    if ((tarx - x) ** 2 + (tary - y) ** 2 < 600) {
      const e = E[f.elem];
      if (f.elem === PT.LIGH || f.elem === PT.NEUT || (e.Properties & (PROP_DEADLY | PROP_RADIOACTIVE)) || e.default.temp >= 323 || e.default.temp <= 243) f.comm |= 8;
    } else if (tarx < x) {
      f.comm = f.rocketBoots || !(em(Math.trunc(L[4]) - 10, Math.trunc(L[5]) + 6) && em(Math.trunc(L[4]) - 10, Math.trunc(L[5]) + 3)) ? 1 : 2;
      if (f.rocketBoots) { if (tary < y) f.comm |= 4; }
      else if (!em(Math.trunc(L[4]) - 4, Math.trunc(L[5]) - 1) || !em(Math.trunc(L[12]) - 4, Math.trunc(L[13]) - 1) || em(2 * Math.trunc(L[4]) - Math.trunc(L[6]), Math.trunc(L[5]) + 5)) f.comm |= 4;
    } else {
      f.comm = f.rocketBoots || !(em(Math.trunc(L[12]) + 10, Math.trunc(L[13]) + 6) && em(Math.trunc(L[12]) + 10, Math.trunc(L[13]) + 3)) ? 2 : 1;
      if (f.rocketBoots) { if (tary < y) f.comm |= 4; }
      // the original tests the same point twice here (legs[4]+4 both times); reproduced as written
      else if (!em(Math.trunc(L[4]) + 4, Math.trunc(L[5]) - 1) || !em(Math.trunc(L[4]) + 4, Math.trunc(L[5]) - 1) || em(2 * Math.trunc(L[12]) - Math.trunc(L[14]), Math.trunc(L[13]) + 5)) f.comm |= 4;
    }
  } else f.comm = 0;
  f.pcomm = f.comm;
  return runStickman(s, f, i, x, y);
};

export function fighCanAlloc(s: PowderSim): boolean { return s.fighcount < MAX_FIGHTERS; }
export function fighAlloc(s: PowderSim): number {
  if (s.fighcount >= MAX_FIGHTERS) return -1;
  let i = 0;
  while (i < MAX_FIGHTERS && s.fighters[i].spwn === 1) i++;
  if (i < MAX_FIGHTERS) { s.fighters[i].spwn = 1; s.fighters[i].elem = PT.DUST; s.fighcount++; return i; }
  return -1;
}
export function newFighter(s: PowderSim, id: number, i: number, elem: number): void {
  initLegs(s, s.fighters[id], i);
  if (elem > 0 && elem < PT_NUM) s.fighters[id].elem = elem;
  s.fighters[id].spwn = 1;
}

export const STICKMAN_BEHAVIORS: Record<string, Behavior> = {
  STKM: {
    update: stkm,
    create: (s, _i, x, y) => { const id = s.createPart(-3, x, y, PT.SPAWN); if (id >= 0) s.player.spawnID = id; },
    createAllowed: s => s.elementCount[PT.STKM] <= 0 && !s.player.spwn,
    changeType: (s, i, _x, _y, _from, to) => { if (to === PT.STKM) { initLegs(s, s.player, i); s.player.spwn = 1; } else s.player.spwn = 0; },
  },
  STKM2: {
    update: stkm2,
    create: (s, _i, x, y) => { const id = s.createPart(-3, x, y, PT.SPAWN2); if (id >= 0) s.player2.spawnID = id; },
    createAllowed: s => s.elementCount[PT.STKM2] <= 0 && !s.player2.spwn,
    changeType: (s, i, _x, _y, _from, to) => { if (to === PT.STKM2) { initLegs(s, s.player2, i); s.player2.spwn = 1; } else s.player2.spwn = 0; },
  },
  FIGH: {
    update: figh,
    createAllowed: s => fighCanAlloc(s),
    changeType: (s, i, _x, _y, _from, to) => {
      if (to === PT.FIGH) {
        s.tmp[i] = fighAlloc(s);
        if (s.tmp[i] >= 0) newFighter(s, s.tmp[i], i, PT.DUST);
      } else {
        const f = s.fighters[s.tmp[i] & 0xff];
        if (f.spwn) { f.spwn = 0; s.fighcount--; }
      }
    },
  },
  SPAWN: {
    createAllowed: s => s.player.spawnID === -1,
    changeType: (s, i, _x, _y, _from, to) => { if (to === PT.SPAWN) { if (s.player.spawnID === -1) s.player.spawnID = i; } else if (s.player.spawnID === i) s.player.spawnID = -1; },
  },
  SPAWN2: {
    createAllowed: s => s.player2.spawnID === -1,
    changeType: (s, i, _x, _y, _from, to) => { if (to === PT.SPAWN2) { if (s.player2.spawnID === -1) s.player2.spawnID = i; } else if (s.player2.spawnID === i) s.player2.spawnID = -1; },
  },
};
