/* TRON light-cycle (TRON.cpp; The Powder Toy, GPL-3.0). tmp bits: 1 head, 2 no growth, 4 wait, 8 no die, 16 dying,
 * 0x60 direction, 0xF800 hue, 0x10000 no random. */
import { CELL, ELEMENTS, ID, PROP_LIFE_DEC, PROP_LIFE_KILL, PROP_LIFE_KILL_DEC, PT, TYP } from '../elements';
import type { PowderSim } from '../sim';

const E = ELEMENTS, RX = [-1, 0, 1, 0], RY = [0, -1, 0, 1];
const HEAD = 1, NOGROW = 2, WAIT = 4, NODIE = 8, DEATH = 16, NORANDOM = 0x10000;

function canMove(s: PowderSim, r: number, len: number): boolean {
  if (!r || (TYP(r) === PT.SWCH && s.life[ID(r)] >= 10) || (TYP(r) === PT.INVIS && s.tmp2[ID(r)] === 1)) return true;
  const p = E[TYP(r)].Properties, l = s.life[ID(r)];
  return Boolean((((p & PROP_LIFE_KILL_DEC) && l > 0) || ((p & PROP_LIFE_KILL) && (p & PROP_LIFE_DEC))) && l < len);
}
function tryMoveTron(s: PowderSim, x: number, y: number, dir: number, len: number): number {
  let count = 0, rx = x, ry = y;
  const ok = (px: number, py: number, k: number) => canMove(s, s.pmap[py * s.XRES + px], k) && !s.bmap[s.cell(px, py)] && py >= CELL && px >= CELL && py < s.YRES - CELL && px < s.XRES - CELL;
  for (let k = 1; k <= len; k++) {
    rx += RX[dir]; ry += RY[dir];
    if (!ok(rx, ry, k - 1)) break;
    count++;
    for (let tx = rx - RY[dir], ty = ry - RX[dir], j = 1; Math.abs(tx - rx) < len - k && Math.abs(ty - ry) < len - k; tx -= RY[dir], ty -= RX[dir], j++) {
      if (ok(tx, ty, j + k - 1)) { if (j === len - k) return len + 1; count++; } else break;
    }
    for (let tx = rx + RY[dir], ty = ry + RX[dir], j = 1; Math.abs(tx - rx) < len - k && Math.abs(ty - ry) < len - k; tx += RY[dir], ty += RX[dir], j++) {
      if (ok(tx, ty, j + k - 1)) { if (j === len - k) return len + 1; count++; } else break;
    }
  }
  return count;
}
function newHead(s: PowderSim, x: number, y: number, i: number, dir: number): number {
  const np = s.createPart(-1, x, y, PT.TRON);
  if (np === -1) return -1;
  if (s.life[i] >= 100) { if (!(s.tmp[i] & NOGROW)) s.tmp2[i]++; s.life[i] = 5; }
  s.tmp[np] = 1 | (dir << 5) | (s.tmp[i] & (NOGROW | NODIE | NORANDOM)) | (s.tmp[i] & 0xf800);
  if (np > i) s.tmp[np] |= WAIT;
  s.ctype[np] = s.ctype[i]; s.tmp2[np] = s.tmp2[i]; s.life[np] = s.life[i] + 2;
  return 1;
}

export const tronCreate = (s: PowderSim, i: number) => {
  const hue = s.rng.between(0, 359), dir = s.rng.between(0, 3);
  s.tmp[i] = 1 | (dir << 5) | (hue << 7); s.tmp2[i] = 4; s.life[i] = 5;
};
export const tron = (s: PowderSim, i: number, x: number, y: number): boolean | void => {
  if (s.tmp[i] & WAIT) { s.tmp[i] &= ~WAIT; return false; }
  if (s.tmp[i] & HEAD) {
    let second = 0, secondCheck = 0, last = 0, lastCheck = 0;
    let dir = (s.tmp[i] >> 5) & 3;
    const original = dir, random = s.rng.between(0, 339);
    if ((random === 1 || random === 3) && !(s.tmp[i] & NORANDOM)) dir = (dir + random) % 4;
    const first = tryMoveTron(s, x, y, dir, s.tmp2[i]);
    if (first < s.tmp2[i]) {
      if (s.tmp[i] & NORANDOM) { second = (dir + 1) % 4; last = (dir + 3) % 4; }
      else if (original !== dir) { second = original; last = (dir + 2) % 4; }
      else { second = (dir + s.rng.between(0, 1) * 2 + 1) % 4; last = (second + 2) % 4; }
      secondCheck = tryMoveTron(s, x, y, second, s.tmp2[i]);
      lastCheck = tryMoveTron(s, x, y, last, s.tmp2[i]);
    }
    if (secondCheck > first) dir = second;
    if (lastCheck > secondCheck && lastCheck > first) dir = last;
    if (newHead(s, x + RX[dir], y + RY[dir], i, dir) === -1) s.tmp[i] |= DEATH;
    s.life[i] = s.tmp2[i];
    s.tmp[i] &= s.tmp[i] & 0xf818;
  } else if (s.tmp[i] & NODIE) s.life[i]++;
};
