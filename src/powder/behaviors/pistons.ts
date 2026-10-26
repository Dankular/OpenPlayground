/* PSTN pistons (PSTN.cpp; The Powder Toy, GPL-3.0). FRME needs no update of its own: PSTN's MoveStack treats it as a frame.
 * Decoration colour of new arm sections is not tracked, so it is skipped. */
import { ID, PMAP, PT, TYP } from '../elements';
import type { PowderSim } from '../sim';

type Hook = (s: PowderSim, i: number, x: number, y: number, ss: number, nt: number) => boolean | void;
const MAX_FRAME = 0x0f, DEFAULT_LIMIT = 0x1f, DEFAULT_ARM_LIMIT = 0xff;
const EXTEND = 2, RETRACT = 1;
const FLAG_EXT_OBSTACLE = 1, FLAG_EXT_ARMLIMIT = 2, FLAG_RET_OBSTACLE = 4, FLAG_RET_TOOSHORT = 8;

interface StackData { pushed: number; spaces: number }

function canMoveStack(s: PowderSim, temp: Int32Array, stackX: number, stackY: number, dx: number, dy: number, maxSize: number, amount: number, retract: boolean, block: number): StackData {
  let spaces = 0, currentPos = 0;
  if (amount <= 0) return { pushed: 0, spaces: 0 };
  for (let px = stackX, py = stackY; currentPos < maxSize + amount && currentPos < s.XRES - 1; px += dx, py += dy) {
    if (!s.inBounds(px, py)) break;
    const r = s.pmap[py * s.XRES + px];
    if (s.isWallBlocking(px, py, 0) || (block && TYP(r) === block)) return { pushed: currentPos - spaces, spaces };
    if (!r) {
      spaces++;
      temp[currentPos++] = -1;
      if (spaces >= amount) break;
    } else if (currentPos - spaces < maxSize && (!retract || (TYP(r) === PT.FRME && px === stackX && py === stackY))) temp[currentPos++] = ID(r);
    else return { pushed: currentPos - spaces, spaces };
  }
  return { pushed: currentPos - spaces, spaces };
}

function moveStack(s: PowderSim, temp: Int32Array, stackX: number, stackY: number, dx: number, dy: number, maxSize: number, amount: number,
  retract: boolean, block: number, sticky: boolean, callDepth: number, cancelOnObstacle: boolean): number {
  const XRES = s.XRES;
  let r = s.pmap[stackY * XRES + stackX];
  const at = (px: number, py: number) => s.pmap[py * XRES + px];
  if (!callDepth && TYP(r) === PT.FRME) {
    const newY = dx ? 1 : 0, newX = dy ? 1 : 0;
    const rdx = retract ? -dx : dx, rdy = retract ? -dy : dy;
    let maxRight = MAX_FRAME, maxLeft = MAX_FRAME;
    for (let c = retract ? 1 : 0; c < MAX_FRAME; c++) {
      const px = stackX + c * newX, py = stackY + c * newY;
      if (s.inBounds(px, py) && TYP(at(px, py)) === PT.FRME) {
        const spaces = canMoveStack(s, temp, px, py, rdx, rdy, maxSize, amount, retract, block).spaces;
        if (spaces < amount) { if (cancelOnObstacle) return 0; amount = spaces; }
      } else { maxRight = c; break; }
    }
    for (let c = 1; c < MAX_FRAME; c++) {
      const px = stackX - c * newX, py = stackY - c * newY;
      if (s.inBounds(px, py) && TYP(at(px, py)) === PT.FRME) {
        const spaces = canMoveStack(s, temp, px, py, rdx, rdy, maxSize, amount, retract, block).spaces;
        if (spaces < amount) { if (cancelOnObstacle) return 0; amount = spaces; }
      } else { maxLeft = c; break; }
    }
    for (let c = 1; c < maxRight; c++) {
      const px = stackX + c * newX, py = stackY + c * newY;
      moveStack(s, temp, px, py, dx, dy, maxSize, amount, retract, block, !s.tmp[ID(at(px, py))], 1, cancelOnObstacle);
    }
    for (let c = 1; c < maxLeft; c++) {
      const px = stackX - c * newX, py = stackY - c * newY;
      moveStack(s, temp, px, py, dx, dy, maxSize, amount, retract, block, !s.tmp[ID(at(px, py))], 1, cancelOnObstacle);
    }
    if (retract) for (let j = 1; j <= amount; j++) s.killPart(ID(at(stackX + dx * -j, stackY + dy * -j)));
    return moveStack(s, temp, stackX, stackY, dx, dy, maxSize, amount, retract, block, !s.tmp[ID(at(stackX, stackY))], 1, cancelOnObstacle);
  }
  if (retract) {
    let found = false;
    if (!callDepth) for (let j = 1; j <= amount; j++) s.killPart(ID(at(stackX + dx * -j, stackY + dy * -j)));
    let currentPos = 0;
    for (let px = stackX, py = stackY; currentPos < maxSize && currentPos < XRES - 1; px += dx, py += dy) {
      if (!s.inBounds(px, py)) break;
      r = at(px, py);
      if (!r || TYP(r) === block || (!sticky && TYP(r) !== PT.FRME)) break;
      found = true;
      temp[currentPos++] = ID(r);
    }
    if (found) {
      for (let j = 0; j < currentPos; j++) {
        const jp = temp[j], sx = (s.x[jp] + 0.5) | 0, sy = (s.y[jp] + 0.5) | 0, tx = sx - dx * amount, ty = sy - dy * amount;
        s.pmap[sy * XRES + sx] = 0;
        s.x[jp] = tx; s.y[jp] = ty;
        s.pmap[ty * XRES + tx] = PMAP(jp, s.type[jp]);
      }
      return amount;
    }
  } else {
    const sd = canMoveStack(s, temp, stackX, stackY, dx, dy, maxSize, amount, retract, block);
    const currentPos = sd.pushed + sd.spaces;
    if (currentPos) {
      let possible = 0;
      for (let j = currentPos - 1; j >= 0; j--) {
        const jp = temp[j];
        if (jp < 0) { possible++; continue; }
        if (!possible) continue;
        const sx = (s.x[jp] + 0.5) | 0, sy = (s.y[jp] + 0.5) | 0, tx = sx + dx * possible, ty = sy + dy * possible;
        s.pmap[sy * XRES + sx] = 0;
        s.x[jp] = tx; s.y[jp] = ty;
        s.pmap[ty * XRES + tx] = PMAP(jp, s.type[jp]);
      }
      return possible;
    }
  }
  return 0;
}

export const pstn: Hook = (s, i, x, y) => {
  if (s.life[i]) return;
  const XRES = s.XRES, temp = s.pstnTemp;
  const maxSize = s.tmp[i] ? s.tmp[i] : DEFAULT_LIMIT, armLimit = s.tmp2[i] ? s.tmp2[i] : DEFAULT_ARM_LIMIT;
  let state = 0;
  for (let rx = -2; rx <= 2; rx++) for (let ry = -2; ry <= 2; ry++) {
    if (!((rx || ry) && (!rx || !ry))) continue;
    const r = s.pmap[(y + ry) * XRES + x + rx];
    if (r && TYP(r) === PT.SPRK && s.life[ID(r)] === 3) state = s.ctype[ID(r)] === PT.PSCN ? EXTEND : RETRACT;
  }
  if (state !== EXTEND && state !== RETRACT) return;
  for (let rx = -1; rx <= 1; rx++) for (let ry = -1; ry <= 1; ry++) {
    if (!((rx || ry) && (!rx || !ry))) continue;
    let r = s.pmap[(y + ry) * XRES + x + rx];
    if (!r || TYP(r) !== PT.PSTN || s.life[ID(r)]) continue;
    let moved = false, found = false, endX = 0, endY = 0, pistonCount = -1, armCount = 0;
    const dx = rx, dy = ry;
    for (let nxx = 0, nyy = 0; ; nyy += dy, nxx += dx) {
      if (!(x + nxx < XRES && y + nyy < s.YRES && x + nxx >= 0 && y + nyy >= 0)) break;
      r = s.pmap[(y + nyy) * XRES + x + nxx];
      if (TYP(r) === PT.PSTN) {
        if (s.life[ID(r)]) armCount++;
        else if (armCount) { endX = x + nxx; endY = y + nyy; found = true; break; }
        else pistonCount += Math.floor((s.temp[ID(r)] - 268.15) / 10);
      } else if (nxx === 0 && nyy === 0) {
        pistonCount += Math.floor((s.temp[i] - 268.15) / 10);
        continue;
      } else { endX = x + nxx; endY = y + nyy; found = true; break; }
    }
    if (!found) continue;
    if (state === EXTEND) {
      if (armCount + pistonCount > armLimit) {
        if (s.tmp3[i] & FLAG_EXT_ARMLIMIT) continue;
        pistonCount = armLimit - armCount;
      }
      if (pistonCount > 0) {
        const newSpace = moveStack(s, temp, endX, endY, dx, dy, maxSize, pistonCount, false, s.ctype[i], true, 0, !!(s.tmp3[i] & FLAG_EXT_OBSTACLE));
        if (newSpace) {
          for (let j = 0; j < newSpace; j++) {
            const nr = s.createPart(-3, endX + dx * j, endY + dy * j, PT.PSTN);
            if (nr > -1) s.life[nr] = 1;
          }
          moved = true;
        }
      }
    } else {
      if (pistonCount > armCount) {
        if (s.tmp3[i] & FLAG_RET_TOOSHORT) continue;
        pistonCount = armCount;
      }
      if (armCount && pistonCount > 0) {
        moveStack(s, temp, endX, endY, dx, dy, maxSize, pistonCount, true, s.ctype[i], true, 0, !!(s.tmp3[i] & FLAG_RET_OBSTACLE));
        moved = true;
      }
    }
    if (moved) return;
  }
};
