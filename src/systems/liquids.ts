import type { Entity, Part } from '../simulation';
import type { SourceComponent } from '../prefabs';

type Data = Record<string, unknown>;
const record = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const number = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const flag = (v: unknown, fallback = false) => v === undefined ? fallback : v === true || v === 1;
const clamp = (v: number, low = 0, high = 1) => Math.min(high, Math.max(low, v));
const rows = (part: Part) => part.metadata?.components ?? [];
const idOf = (v: unknown) => String(record(v).m_PathID ?? '');

/** Exact BloodContainer.PressureDirection ordinal values. */
export enum PressureDirection { Push = 0, Pull = 1, None = 2 }
export interface LiquidColor { r: number; g: number; b: number; a: number }
export interface LiquidDefinition { id: string; color: LiquidColor }
const color = (r: number, g: number, b: number, a = 1): LiquidColor => ({ r, g, b, a });
const pink = color(1, .4196079, .7944902);
export const LIQUIDS = new Map<string, LiquidDefinition>();
export function registerLiquid(id: string, value: LiquidColor): void { LIQUIDS.set(id, { id, color: value }); }
for (const [id, value] of Object.entries({
  BLOOD: color(.65, 0, 0), 'GORSE BLOOD': color(.03, .57, 0), OIL: color(0, .04689861, .1803922),
  ACID: color(.49, .44, .52), ADRENALINE: color(.45, .27, .77), 'BONE EATING POISON': color(1, .55, .22),
  'COAGULATION SERUM': color(1, 1, 0), 'INSTANT DEATH POISON': color(1, .65, .63),
  'FREEZE POISON': color(.8, 1, 1), 'KNOCKOUT POISON': color(.68, .62, .541),
  'LIFE SERUM': color(.6745283, 1, .7830077), 'MENDING SERUM': color(0, .67, .5),
  'PAIN KILLER': color(.71, .75, .65, .1), 'ULTRA STRENGTH SERUM': color(.7604228, .7137255, 1),
  'WATER BREATHING SERUM': color(.21, .57, .96), 'REANIMATION AGENT': color(.8835177, 1, .7122642),
})) registerLiquid(id, value);
const pinkIds = ['INERT PINK LIQUID', 'VESTIBULAR POISON', 'MUSCLE POISON', 'NUMBING POISON', 'MIRRORISING AGENT',
  'TRANSPARENCY AGENT', 'MASS AGENT', 'EXPLOSION POISON', 'CRUSHING POISON', 'DURABILITY SERUM', 'REGENERATION SERUM',
  'DISTORTION POISON', 'CIRCULATION POISON', 'COMBUSTION AGENT', 'ENHANCING SERUM', 'TISSUE DECONSTRUCTION AGENT'];
for (const id of pinkIds) registerLiquid(id, pink);
for (const [id, value] of Object.entries({ NITRO: color(245 / 255, 152 / 255, 66 / 255),
  'EXOTIC LIQUID': color(0, 0, 1), TRITIUM: color(.16, 1.24, .56, 2), 'INERT LIQUID': color(1, 1, 1, .1),
  'BEVERAGE M04': color(.91, .25, 0, .5), COOLANT: color(0, .22, .6, .74),
  'OSTEOMORPHOSIS AGENT': color(1, .84, .56), 'IMMORTALITY SERUM': color(.87, 1, 0), 'DEBUG LIQUID 001': color(1, 0, 1),
})) registerLiquid(id, value);

export const SYRINGE_LIQUID: Readonly<Record<string, string | null>> = {
  AcidSyringe: 'ACID', AdrenalineSyringe: 'ADRENALINE', BoneEatingPoisonSyringe: 'BONE EATING POISON',
  CoagulationSyringe: 'COAGULATION SERUM', DeathSyringe: 'INSTANT DEATH POISON', EmptySyringe: null,
  FreezeSyringe: 'FREEZE POISON', KnockoutSyringe: 'KNOCKOUT POISON', LifeSyringe: 'LIFE SERUM',
  MendingSyringe: 'MENDING SERUM', PainKillerSyringe: 'PAIN KILLER', PinkSyringe: null,
  UltraStrengthSyringe: 'ULTRA STRENGTH SERUM', WaterBreathingSyringe: 'WATER BREATHING SERUM', ZombieSyringe: 'REANIMATION AGENT',
};
export interface LiquidEffects {
  enter(part: Part, id: string, container: LiquidReservoir): void;
  exit?(part: Part, id: string, container: LiquidReservoir): void;
  tick(part: Part, id: string, container: LiquidReservoir): void;
  resume?(part: Part, id: string, container: LiquidReservoir): void;
  frame?(dt: number): void;
}
export interface LiquidAmount { amount: number; previous: number }
export interface ReservoirOptions {
  part?: Part; kind?: 'circulation' | 'syringe' | 'flask' | 'tank' | 'container'; originalBlood?: string | null;
  lower?: number; capacity?: number; allowsOverflow?: boolean; allowPressureTransfer?: boolean;
  pressureMode?: PressureDirection; enabled?: boolean;
  enter?: (id: string) => void; exit?: (id: string) => void;
}

/** BloodContainer amount and mixture operations. Units are 5/14 litre. */
export class LiquidReservoir {
  readonly distribution = new Map<string, LiquidAmount>();
  readonly part?: Part;
  readonly kind: NonNullable<ReservoirOptions['kind']>;
  readonly originalBlood: string | null;
  lower: number; capacity: number; allowsOverflow: boolean; allowPressureTransfer: boolean;
  pressureMode: PressureDirection; measuredPressure = 0; enabled: boolean; timer = 0;
  private cleanupRequested = false;
  private cachedColor: LiquidColor = color(0, 0, 0, 0);
  constructor(readonly options: ReservoirOptions = {}) {
    this.part = options.part; this.kind = options.kind ?? 'container'; this.originalBlood = options.originalBlood ?? null;
    this.lower = options.lower ?? 0; this.capacity = options.capacity ?? 1; this.allowsOverflow = options.allowsOverflow ?? true;
    this.allowPressureTransfer = options.allowPressureTransfer ?? true; this.pressureMode = options.pressureMode ?? PressureDirection.None;
    this.enabled = options.enabled ?? true;
  }
  get total(): number { return [...this.distribution.values()].reduce((sum, value) => sum + value.amount, 0); }
  get upper(): number { return this.allowsOverflow ? Number.MAX_VALUE : this.capacity; }
  get scaledAmount(): number { return (this.total - this.lower) / (this.capacity - this.lower); }
  getAmount(id: string): number { return this.distribution.get(id)?.amount ?? 0; }
  addLiquid(id: string, amount: number): number {
    if (!LIQUIDS.has(id) || !Number.isFinite(amount) || amount <= 0) return 0;
    const accepted = clamp(this.total + amount, this.lower, this.upper) - this.total;
    if (!(accepted > 0)) return 0;
    const item = this.distribution.get(id);
    if (item) item.amount += accepted;
    else { this.distribution.set(id, { amount: accepted, previous: 0 }); this.options.enter?.(id); }
    return accepted;
  }
  /** Return the negative removed quantity, matching BloodContainer.RemoveLiquid. */
  removeLiquid(id: string, amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const item = this.distribution.get(id); if (!item) return 0;
    const removed = Math.min(item.amount, this.total - this.lower, amount);
    item.amount -= Math.max(0, removed); this.cleanupRequested = true;
    return -Math.max(0, removed);
  }
  drain(amount: number): void {
    if (!this.distribution.size || !(amount > 0)) return;
    const perLiquid = amount / this.distribution.size;
    for (const id of this.distribution.keys()) this.removeLiquid(id, perLiquid);
  }
  forceSetAllLiquid(amount: number): void {
    const total = this.total; if (total <= Number.EPSILON) return;
    const scale = clamp(amount, this.lower, this.upper) / total;
    for (const value of this.distribution.values()) value.amount *= scale;
    this.cleanupRequested = true;
  }
  clearLiquid(): void {
    for (const id of this.distribution.keys()) this.options.exit?.(id);
    this.distribution.clear(); this.cleanupRequested = false;
  }
  transferTo(amount: number, target: LiquidReservoir, proportional = true): number {
    if (!this.enabled || !target.enabled || !(amount > 0) || target === this) return 0;
    const total = this.total; if (!(total > 0)) return 0;
    let removed = 0;
    for (const [id, value] of this.distribution) {
      const quantity = Math.abs(this.removeLiquid(id, proportional ? amount * value.amount / total : amount));
      target.addLiquid(id, quantity); removed += quantity;
    }
    return removed;
  }
  copyTo(amount: number, target: LiquidReservoir, proportional = true): void {
    if (!this.enabled || !target.enabled || !(amount > 0) || !this.total) return;
    const total = this.total;
    for (const [id, value] of this.distribution) target.addLiquid(id, amount * (proportional ? value.amount / total : 1));
  }
  deleteEmptyEntries(): void {
    this.cleanupRequested = false;
    for (const [id, value] of this.distribution) {
      const delta = value.amount - value.previous;
      if (value.amount <= .02 && (value.amount <= Number.EPSILON || -delta > .0001 || Math.abs(delta) <= .0001)) {
        this.options.exit?.(id); this.distribution.delete(id);
      }
      value.previous = value.amount;
    }
  }
  get computedColor(): LiquidColor {
    if (!this.total) return { ...this.cachedColor };
    const result = color(0, 0, 0, 0), total = this.total;
    for (const [id, value] of this.distribution) {
      const tint = LIQUIDS.get(id)?.color ?? color(1, 0, 1);
      for (const key of ['r', 'g', 'b', 'a'] as const) result[key] += tint[key] * value.amount / total;
    }
    result.r = clamp(result.r, 0, 10); result.g = clamp(result.g, 0, 10); result.b = clamp(result.b, 0, 10); result.a = clamp(result.a, .1, 1);
    this.cachedColor = result; return { ...result };
  }
  frame(dt: number, tick: (id: string) => void): void {
    if (!this.enabled || !(dt > 0)) return;
    this.timer += dt;
    if (this.allowPressureTransfer) {
      this.measuredPressure += (this.scaledAmount - this.measuredPressure) * (1 - Math.pow(.4, dt));
      if (this.pressureMode !== PressureDirection.None)
        this.measuredPressure += ((this.pressureMode === PressureDirection.Push ? 4096 : -4096) - this.measuredPressure) * (1 - Math.pow(.05, dt));
    } else this.measuredPressure = this.pressureMode === PressureDirection.Push ? 4096 : this.pressureMode === PressureDirection.Pull ? -4096 : this.scaledAmount;
    if (this.timer > 1) {
      this.timer = 0; this.deleteEmptyEntries();
      for (const id of [...this.distribution.keys()]) tick(id);
      this.mix();
    }
    if (this.cleanupRequested) this.deleteEmptyEntries();
  }
  private mix(): void {
    const recipes = [
      { from: ['TRITIUM', 'MENDING SERUM'], to: 'IMMORTALITY SERUM', rate: .01, nonBody: true },
      { from: ['ACID', 'MENDING SERUM'], to: 'OSTEOMORPHOSIS AGENT', rate: .05, nonBody: true },
      { from: ['WATER BREATHING SERUM', 'TRITIUM'], to: 'EXOTIC LIQUID', rate: .05 },
      { from: ['ADRENALINE', 'MENDING SERUM', 'INERT LIQUID'], to: 'BEVERAGE M04', rate: .05 },
    ];
    for (const recipe of recipes) {
      if ((recipe.nonBody && this.kind === 'circulation') || recipe.from.some(id => this.getAmount(id) < recipe.rate)) continue;
      for (const id of recipe.from) this.removeLiquid(id, recipe.rate);
      this.addLiquid(recipe.to, recipe.rate * recipe.from.length);
    }
  }
}

export function averagePressure(rate: number, a: LiquidReservoir, b: LiquidReservoir): void {
  if (rate < 0) throw new Error('Pressure averaging rate cannot be negative');
  if (!a.allowPressureTransfer || !b.allowPressureTransfer) return;
  const average = .5 * (a.measuredPressure + b.measuredPressure);
  a.measuredPressure += (average - a.measuredPressure) * clamp(rate);
  b.measuredPressure += (average - b.measuredPressure) * clamp(rate);
}

export interface SyringeState {
  part: Part; container: LiquidReservoir; source: SourceComponent; finite: boolean;
  canToggleInfinite: boolean; transferRate: number; spawnLiquid: string | null;
  pushTargets: Set<LiquidReservoir>; fingerprint?: number[]; pinkMixture?: { id: string; amount: number }[];
}
export interface LiquidSystemOptions {
  effects?: LiquidEffects; random?: () => number;
  getBlood?: (part: Part) => number | undefined; setBlood?: (part: Part, amount: number) => void;
  onChanged?: (part: Part, container: LiquidReservoir) => void;
}
export interface LiquidSnapshot { version: 1; containers: { partId: string; measuredPressure: number; timer: number;
  distribution: { id: string; amount: number; previous: number }[];
  syringe?: { finite: boolean; pressureMode: PressureDirection; fingerprint?: number[] }; tankMode?: number }[] }

export class LiquidSystem {
  readonly containers = new Map<Part, LiquidReservoir>();
  readonly syringes = new Map<Part, SyringeState>();
  private entities = new Map<Entity, Part[]>();
  private owner = new Map<Part, Entity>();
  private oscillator = new Map<Part, boolean>();
  private sources = new Map<Part, string>();
  private tanks = new Map<Part, { mode: number; drainRate: number }>();
  constructor(readonly options: LiquidSystemOptions = {}) {}
  get(part: Part): LiquidReservoir | undefined { return this.containers.get(part); }
  getSyringe(part: Part): SyringeState | undefined { return this.syringes.get(part); }
  syringesFor(entity: Entity): SyringeState[] { return entity.parts.flatMap(p => this.syringes.get(p) ?? []); }

  attach(entity: Entity): void {
    if (this.entities.has(entity)) return;
    this.entities.set(entity, entity.parts);
    for (const part of entity.parts) {
      const node = entity.metadata?.nodes.find(n => n.id === part.metadata?.nodeId); if (node?.active === false) continue;
      const syringeSource = rows(part).find(c => c.className && Object.hasOwn(SYRINGE_LIQUID, c.className));
      const circulation = rows(part).find(c => c.className === 'CirculationBehaviour');
      const flask = rows(part).find(c => c.className === 'FlaskBehaviour');
      const canister = rows(part).find(c => c.className === 'LiquidCanisterBehaviour');
      const tank = rows(part).find(c => c.className === 'BloodTankBehaviour');
      const source = syringeSource ?? circulation ?? flask ?? canister ?? tank;
      if (!source) continue;
      const kind = syringeSource ? 'syringe' : circulation ? 'circulation' : flask ? 'flask' : tank ? 'tank' : 'container';
      const limb = rows(part).find(c => c.className === 'LimbBehaviour')?.data;
      const originalBlood = circulation ? typeof limb?.BloodLiquidType === 'string' ? limb.BloodLiquidType : limb?.SpeciesIdentity === 'Android' ? 'OIL' : limb?.SpeciesIdentity === 'Gorse' ? 'GORSE BLOOD' : 'BLOOD' : null;
      const container = new LiquidReservoir({ part, kind, originalBlood, capacity: syringeSource ? 1.4 : flask ? number(flask.data.Capacity, 2.8) : canister ? number(canister.data.Capacity, 70) : tank ? 14 : 1,
        allowsOverflow: !!circulation, pressureMode: syringeSource ? number(source.data.PressureMode, PressureDirection.Push) : PressureDirection.None,
        enabled: flag(source.data.m_Enabled, true),
        enter: id => { this.options.effects?.enter(part, id, container); this.syncToRagdoll(part); this.options.onChanged?.(part, container); },
        exit: id => { this.options.effects?.exit?.(part, id, container); this.options.onChanged?.(part, container); },
      });
      container.measuredPressure = number(source.data.MeasuredPressure);
      this.containers.set(part, container); this.owner.set(part, entity);
      const saved = source.data.SerialisableDistributions;
      if (!flag(source.data.NewlySpawned, true) && Array.isArray(saved)) {
        for (const row of saved.map(record)) if (typeof row.LiquidID === 'string' && LIQUIDS.has(row.LiquidID)) container.distribution.set(row.LiquidID, { amount: number(row.Amount), previous: 0 });
      } else if (circulation && originalBlood) container.addLiquid(originalBlood, this.options.getBlood?.(part) ?? 1);
      else if (flask) {
        const start = record(flask.data.StartLiquid);
        if (typeof start.LiquidID === 'string') container.addLiquid(start.LiquidID, number(start.Amount));
      }
      if (syringeSource) {
        const syringe: SyringeState = { part, source: syringeSource, container, finite: flag(source.data.Finite), canToggleInfinite: flag(source.data.CanToggleInfinite, true),
          transferRate: number(source.data.TransferRate, .01), spawnLiquid: SYRINGE_LIQUID[syringeSource.className!], pushTargets: new Set() };
        this.syringes.set(part, syringe);
        if (syringeSource.className === 'PinkSyringe') this.initializePink(syringe, source.data.Fingerprint, flag(source.data.NewlySpawned, true));
        else if (syringe.spawnLiquid && flag(source.data.NewlySpawned, true)) container.addLiquid(syringe.spawnLiquid, 1.4);
      }
      if (tank) { const state = { mode: number(tank.data.Mode, 2), drainRate: number(tank.data.DrainRate, 1) }; this.tanks.set(part, state); this.updateTankPressure(container, state.mode); }
      const infinite = rows(part).find(c => c.className === 'InfiniteLiquidSourceBehaviour');
      if (typeof infinite?.data.LiquidID === 'string' && LIQUIDS.has(infinite.data.LiquidID)) this.sources.set(part, infinite.data.LiquidID);
    }
  }
  remove(entity: Entity): void {
    for (const part of this.entities.get(entity) ?? []) {
      const container = this.containers.get(part);
      if (container) for (const syringe of this.syringes.values()) syringe.pushTargets.delete(container);
      this.containers.delete(part); this.syringes.delete(part); this.owner.delete(part); this.oscillator.delete(part); this.sources.delete(part); this.tanks.delete(part);
    }
    this.entities.delete(entity);
  }
  lodged(syringe: Part, victim: Part): boolean {
    const state = this.syringes.get(syringe), target = this.containers.get(victim);
    if (!state || !target || syringe === victim) return false;
    state.pushTargets.add(target); return true;
  }
  dislodged(syringe: Part, victim: Part): void { const target = this.containers.get(victim); if (target) this.syringes.get(syringe)?.pushTargets.delete(target); }
  setMode(entity: Entity, mode: PressureDirection): void {
    if (![0, 1, 2].includes(mode)) return;
    for (const syringe of this.syringesFor(entity)) syringe.container.pressureMode = mode;
  }
  setFinite(entity: Entity, finite: boolean): void { for (const s of this.syringesFor(entity)) if (s.canToggleInfinite) { s.finite = finite; s.container.pressureMode = PressureDirection.Push; } }
  toggleInfinite(entity: Entity): void { for (const s of this.syringesFor(entity)) if (s.canToggleInfinite) { s.finite = !s.finite; s.container.pressureMode = PressureDirection.Push; } }
  use(entity: Entity, channel = 0): boolean {
    let handled = false;
    for (const syringe of this.syringesFor(entity)) {
      handled = true;
      if (channel === 1) syringe.container.pressureMode = PressureDirection.Push;
      else if (channel === 2) { if (syringe.finite) syringe.container.pressureMode = PressureDirection.Pull; }
      else syringe.container.pressureMode = syringe.container.pressureMode === PressureDirection.Push ? PressureDirection.Pull : PressureDirection.Push;
    }
    for (const part of entity.parts) {
      const tank = this.tanks.get(part); if (!tank) continue;
      handled = true; tank.mode = (tank.mode + (channel === 1 ? 3 : 1)) % 4; this.updateTankPressure(this.containers.get(part)!, tank.mode);
    }
    return handled;
  }
  private updateTankPressure(container: LiquidReservoir, mode: number) { container.pressureMode = mode === 0 ? PressureDirection.Push : mode === 1 || mode === 3 ? PressureDirection.Pull : PressureDirection.None; }
  private syncFromRagdoll(part: Part): void {
    const container = this.containers.get(part), amount = this.options.getBlood?.(part);
    if (!container?.originalBlood || amount === undefined || !Number.isFinite(amount) || amount < 0) return;
    const current = container.getAmount(container.originalBlood);
    if (amount > current) container.addLiquid(container.originalBlood, amount - current);
    else if (amount < current) container.removeLiquid(container.originalBlood, current - amount);
  }
  private syncToRagdoll(part: Part): void {
    const container = this.containers.get(part);
    if (container?.originalBlood) this.options.setBlood?.(part, container.getAmount(container.originalBlood));
  }
  beforeStep(dt: number): void {
    for (const part of this.containers.keys()) this.syncFromRagdoll(part);
    for (const syringe of this.syringes.values()) {
      const c = syringe.container; if (!c.enabled || !syringe.part.body.isActive()) continue;
      if (!syringe.finite) {
        if (syringe.spawnLiquid) c.addLiquid(syringe.spawnLiquid, 1.4 - c.getAmount(syringe.spawnLiquid));
        if (syringe.pinkMixture) {
          const increment = syringe.transferRate * (c.upper - c.total);
          for (const row of syringe.pinkMixture) c.addLiquid(row.id, row.amount * increment);
        }
      }
      for (const target of syringe.pushTargets) {
        if (!target.enabled || target.part && !target.part.body.isActive()) continue;
        averagePressure(dt, c, target);
        if (!syringe.finite || c.measuredPressure > target.measuredPressure) {
          if (c.total > c.lower && target.total < target.upper && (!syringe.spawnLiquid || target.kind !== 'circulation' || target.getAmount(syringe.spawnLiquid) < .5)) c.transferTo(syringe.transferRate, target);
        } else if (target.total > target.lower && c.total < c.upper) target.transferTo(syringe.transferRate, c);
      }
    }
    this.diffuse(dt);
    for (const part of this.containers.keys()) this.syncToRagdoll(part);
  }
  private diffuse(dt: number): void {
    for (const [part, container] of this.containers) {
      if (container.kind !== 'circulation' || !part.body.isActive()) continue;
      const owner = this.owner.get(part), limb = rows(part).find(c => c.className === 'LimbBehaviour');
      const references = Array.isArray(limb?.data.ConnectedLimbs) ? limb.data.ConnectedLimbs.map(idOf) : [];
      const targets = references.flatMap(id => owner?.parts.filter(p => rows(p).some(c => c.pathId === id)) ?? []);
      if (!this.oscillator.get(part)) targets.reverse(); this.oscillator.set(part, !this.oscillator.get(part));
      for (const target of targets) {
        const other = this.containers.get(target); if (!other || !other.enabled || other.total > container.total) continue;
        let connected = false; for (let edge = part.body.getJointList(); edge; edge = edge.next) if (edge.other === target.body) connected = true;
        if (connected) container.transferTo(dt * 1.5, other);
      }
    }
  }
  frame(dt: number): void {
    for (const [part, container] of this.containers) {
      if (!part.body.isActive()) continue;
      this.syncFromRagdoll(part);
      container.frame(dt, id => this.options.effects?.tick(part, id, container));
      const tank = this.tanks.get(part); if (tank?.mode === 3) container.drain(dt * tank.drainRate);
      const infinite = this.sources.get(part); if (infinite) container.addLiquid(infinite, dt * 10);
      this.syncToRagdoll(part); this.options.onChanged?.(part, container);
    }
    this.options.effects?.frame?.(dt);
  }
  private initializePink(s: SyringeState, raw: unknown, newlySpawned: boolean): void {
    s.fingerprint = Array.isArray(raw) && raw.length && raw.every(x => typeof x === 'number' && Number.isFinite(x)) ? [...raw] as number[] : Array.from({ length: 64 }, () => (this.options.random ?? Math.random)() * 2 - 1);
    let cursor = 0; const read = () => s.fingerprint![cursor++ % s.fingerprint!.length];
    const amount = .05 + (read() + 1) * .5 * .35;
    const thresholds: [string, number][] = [['INERT PINK LIQUID', .05], ['VESTIBULAR POISON', .6], ['MUSCLE POISON', .6], ['NUMBING POISON', .6],
      ['MIRRORISING AGENT', .85], ['TRANSPARENCY AGENT', .85], ['MASS AGENT', .95], ['EXPLOSION POISON', .995], ['CRUSHING POISON', .995],
      ['BONE EATING POISON', .9], ['LIFE SERUM', .9], ['ULTRA STRENGTH SERUM', .6], ['DURABILITY SERUM', .6], ['REGENERATION SERUM', .8],
      ['DISTORTION POISON', .9], ['FREEZE POISON', .95], ['INSTANT DEATH POISON', .99], ['CIRCULATION POISON', .4], ['ENHANCING SERUM', .4],
      ['COMBUSTION AGENT', .95], ['TISSUE DECONSTRUCTION AGENT', .95]];
    s.pinkMixture = []; let total = 0;
    for (let count = 0; total < s.container.upper - Number.EPSILON && count < 5000; count++) {
      for (const [id, threshold] of thresholds) if (read() > threshold) {
        s.pinkMixture.push({ id, amount }); total += amount;
        if (newlySpawned) s.container.addLiquid(id, amount);
      }
    }
  }
  snapshot(entity: Entity): LiquidSnapshot | undefined {
    const parts = entity.parts.filter(p => this.containers.has(p)); if (!parts.length) return undefined;
    return { version: 1, containers: parts.map(part => {
      const c = this.containers.get(part)!, s = this.syringes.get(part);
      return { partId: part.id ?? String(entity.parts.indexOf(part)), measuredPressure: c.measuredPressure, timer: c.timer,
        distribution: [...c.distribution].map(([id, value]) => ({ id, ...value })),
        ...(s ? { syringe: { finite: s.finite, pressureMode: c.pressureMode, ...(s.fingerprint ? { fingerprint: [...s.fingerprint] } : {}) } } : {}),
        ...(this.tanks.has(part) ? { tankMode: this.tanks.get(part)!.mode } : {}) };
    }) };
  }
  restore(entity: Entity, value: unknown): boolean {
    const data = record(value), expected = entity.parts.filter(p => this.containers.has(p));
    if (data.version !== 1 || !Array.isArray(data.containers) || data.containers.length !== expected.length) return false;
    const staged: { part: Part; data: Data; distribution: { id: string; amount: number; previous: number }[] }[] = [];
    const used = new Set<Part>();
    for (const raw of data.containers) {
      const saved = record(raw), part = expected.find(p => (p.id ?? String(entity.parts.indexOf(p))) === saved.partId);
      if (!part || used.has(part) || !Array.isArray(saved.distribution) || saved.distribution.length > 256 || !Number.isFinite(saved.measuredPressure) || !Number.isFinite(saved.timer) || number(saved.timer, -1) < 0 || number(saved.timer) > 1) return false;
      used.add(part); const distribution = saved.distribution.map(record), ids = new Set<string>(); let total = 0;
      for (const row of distribution) {
        if (typeof row.id !== 'string' || !LIQUIDS.has(row.id) || ids.has(row.id) || !Number.isFinite(row.amount) || number(row.amount, -1) < 0 || number(row.amount) > 1e6 || !Number.isFinite(row.previous) || number(row.previous, -1) < 0) return false;
        ids.add(row.id); total += number(row.amount);
      }
      if (total > this.containers.get(part)!.upper + 1e-6) return false;
      if (this.syringes.has(part)) {
        const s = record(saved.syringe);
        if (typeof s.finite !== 'boolean' || ![0, 1, 2].includes(number(s.pressureMode, -1))) return false;
        if (s.fingerprint !== undefined && (!Array.isArray(s.fingerprint) || !s.fingerprint.length || s.fingerprint.length > 64 || s.fingerprint.some(x => typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1))) return false;
      }
      if (this.tanks.has(part) && ![0, 1, 2, 3].includes(number(saved.tankMode, -1))) return false;
      staged.push({ part, data: saved, distribution: distribution as unknown as { id: string; amount: number; previous: number }[] });
    }
    for (const { part, data: saved, distribution } of staged) {
      const c = this.containers.get(part)!; c.distribution.clear();
      for (const row of distribution) c.distribution.set(row.id, { amount: row.amount, previous: row.previous });
      c.measuredPressure = number(saved.measuredPressure); c.timer = number(saved.timer);
      const syringe = this.syringes.get(part);
      if (syringe) {
        const s = record(saved.syringe); syringe.finite = s.finite as boolean; c.pressureMode = s.pressureMode as PressureDirection;
        if (s.fingerprint) this.initializePink(syringe, s.fingerprint, false);
      }
      const tank = this.tanks.get(part); if (tank) { tank.mode = number(saved.tankMode); this.updateTankPressure(c, tank.mode); }
      this.syncToRagdoll(part);
    }
    for (const { part } of staged) {
      const container = this.containers.get(part)!;
      for (const id of container.distribution.keys()) this.options.effects?.resume?.(part, id, container);
    }
    return true;
  }
}
