import type { Behavior } from '../sim';
import * as chem from './chemistry';
import * as ex from './explosives';
import * as el from './electronics';
import * as nu from './nuclear';
import * as ma from './materials';
import * as so from './solids';
import * as xo from './exotic';
import * as dv from './devices';
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
  YEST: so.yest, BRMT: so.brmt, GLAS: so.glas, CLST: so.clst, QRTZ: so.qrtz, PQRT: so.qrtz, BREC: so.brec, SLCN: so.slcn, LITH: so.lith,
  BASE: so.base, RFRG: so.rfrg, RFGL: so.rfrg, HEAC: so.heac, PTNM: so.ptnm, CRMC: so.crmc,
  VIRS: xo.virs, VRSS: xo.virs, VRSG: xo.virs, EXOT: xo.exot, VIBR: xo.vibr, BVBR: xo.vibr, GRAV: xo.grav, INVIS: xo.invis, LIGH: xo.ligh,
  FIRW: xo.firw, FWRK: xo.fwrk, C5: xo.c5, SHLD1: xo.shld1, SHLD2: xo.shld2, SHLD3: xo.shld3, SHLD4: xo.shld4,
  ACEL: dv.acel, DCEL: dv.dcel, RPEL: dv.rpel, DMG: dv.dmg, CONV: dv.conv, MORT: dv.mort, PVOD: dv.pvod, LCRY: dv.lcry, HSWC: dv.hswc, DLAY: dv.dlay,
  PUMP: dv.pump, GPMP: dv.gpmp, TSNS: dv.tsns, PSNS: dv.psns, DTEC: dv.dtec, FRAY: dv.fray,
  PCLN: dv.pcln, PBCN: dv.pbcn, STOR: dv.stor, ARAY: dv.aray,
  RSST: so.rsst, RSSS: so.rsss,
  GLOW: ma.glow, MERC: ma.merc, GEL: ma.gel, SPNG: ma.spng, CLNE: ma.clne, BCLN: ma.bcln,
};

export const BEHAVIORS: Record<string, Behavior> = {};
for (const [k, update] of Object.entries(UPDATES)) BEHAVIORS[k] = { update };
CREATES.SLCN = (s, i) => so.initSparkles(s, i);
for (const [k, create] of Object.entries(CREATES)) (BEHAVIORS[k] ??= {}).create = create;

/** Elements whose ported update omits a documented branch. Keys are PT_ names; values say what is missing. */
export const PARTIAL_PORTS: Record<string, string> = {
  PLNT: 'tree-growth branch (ctype bit 0) needs SEED, which is not ported',
  GPMP: 'on/off propagation only; the Newtonian gravity source it drives is not simulated',
  O2: 'extreme-gravity BRMT/NEUT/PHOT/GRVT branch needs Newtonian gravity',
  DEUT: 'gravity compression term fixed at its zero-gravity value',
  NEUT: 'SEED gene-flip case omitted',
  PROT: 'SEED mutation case omitted',
  LIGH: 'STKM damage omitted',
  HSWC: 'FILT temperature deserialisation omitted',
  SPRK: 'EMP and PPIP receivers are accepted but their trigger effects are not ported',
  FIRW: 'burst colour is random RGB instead of Renderer::firwTable',
  FWRK: 'burst colour is random RGB (as in the original)',
  CLNE: 'LIFE cloning creates a LIFE particle, but the Game of Life rule engine is not ported',
  BCLN: 'LIFE cloning creates a LIFE particle, but the Game of Life rule engine is not ported',
  PCLN: 'LIFE cloning creates a LIFE particle, but the Game of Life rule engine is not ported',
  PBCN: 'LIFE cloning creates a LIFE particle, but the Game of Life rule engine is not ported',
  WIFI: 'channel flags are cleared every frame (equivalent to the original ISWIRE countdown)',
};
/** Elements whose behaviour lives outside their element file in the original and is not ported. */
export const ENGINE_SIDE_UNPORTED: Record<string, string> = {
  LIFE: 'Game of Life rules run in Simulation::SimulateGoL',
  LOVE: 'pattern growth runs in Simulation::BeforeSim',
  LOLZ: 'pattern growth runs in Simulation::BeforeSim',
  EMP: 'effect runs in Simulation::AfterSim (Element_EMP_Trigger)',
  SPAWN: 'stickman spawn point; STKM is not ported', SPAWN2: 'stickman spawn point; STKM2 is not ported',
  FRME: 'frame for PSTN pistons; PSTN is not ported',
  BIZR: 'update only blends decoration colour (not tracked)', BIZRG: 'update only blends decoration colour (not tracked)', BIZRS: 'update only blends decoration colour (not tracked)',
};
