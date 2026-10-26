import type { Behavior } from '../sim';
import * as chem from './chemistry';
import * as ex from './explosives';
import * as el from './electronics';
import * as nu from './nuclear';
import * as ma from './materials';
import { fireUpdate } from './fire';
import { CREATES } from './creates';

/** Element behaviours keyed by PT_ name. Elements absent here keep only their static properties
 * (movement, state changes, flammability, heat) and the generic engine rules. */
const UPDATES: Record<string, NonNullable<Behavior['update']>> = {
  FIRE: fireUpdate, PLSM: fireUpdate, LAVA: fireUpdate,
  WATR: chem.watr, DSTW: chem.dstw, SLTW: chem.sltw, CBNW: chem.cbnw, FRZW: chem.frzw, FRZZ: chem.frzz,
  ICEI: chem.icei, SNOW: chem.snow, WTRV: chem.wtrv, FOG: chem.fog, RIME: chem.rime, CO2: chem.co2, BOYL: chem.boyl,
  CAUS: chem.caus, ACID: chem.acid, O2: chem.o2, H2: chem.h2, NBLE: chem.nble, COAL: chem.coal, BCOL: chem.coal,
  WOOD: chem.wood, VINE: chem.vine, PLNT: chem.plnt, GOO: chem.goo,
  BANG: ex.bang, BOMB: ex.bomb, DEST: ex.dest, IGNT: ex.ignt, FUSE: ex.fuse, FSEP: ex.fsep, EMBR: ex.embr, THDR: ex.thdr,
  SPRK: el.sprk, NTCT: el.ntct, PTCT: el.ntct, BTRY: el.btry, SWCH: el.swch, IRON: el.iron, GOLD: el.gold, TTAN: el.ttan,
  BMTL: el.bmtl, TUNG: el.tung, WIFI: el.wifi, WIRE: el.wire,
  NEUT: nu.neut, PLUT: nu.plut, URAN: nu.uran, ISOZ: nu.isoz, ISZS: nu.isoz, DEUT: nu.deut, PHOT: nu.phot, ELEC: nu.elec,
  PROT: nu.prot, POLO: nu.polo, AMTR: nu.amtr, ANAR: nu.anar, SING: nu.sing, WARP: nu.warp,
  GLOW: ma.glow, MERC: ma.merc, GEL: ma.gel, SPNG: ma.spng, CLNE: ma.clne, BCLN: ma.bcln,
};

export const BEHAVIORS: Record<string, Behavior> = {};
for (const [k, update] of Object.entries(UPDATES)) BEHAVIORS[k] = { update };
for (const [k, create] of Object.entries(CREATES)) (BEHAVIORS[k] ??= {}).create = create;
