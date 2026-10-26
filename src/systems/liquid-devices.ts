import { AABB, Distance, DistanceInput, DistanceOutput, SimplexCache, Vec2 } from 'planck';
import type { Entity, Part } from '../simulation';
import type { SourceComponent } from '../prefabs';
import type { PhysicalSystem } from './physical-world';
import { getCharge } from './physical';
import { LiquidSystem, PressureDirection, type LiquidColor, type LiquidReservoir } from './liquids';
import { evaluatePoseCurve, type SerializedCurve } from './ragdoll';
import { deltaAngle } from './mechanisms';
import { targetsPart } from './targeting';

type Data = Record<string, unknown>;
type Point = { x: number; y: number };
const record = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const num = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const flag = (v: unknown) => v === true || v === 1;
const id = (v: unknown) => String(record(v).m_PathID ?? '');
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const approximately = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1e-44);
const point = (v: unknown): Point => ({ x: num(record(v).x), y: num(record(v).y) });
export const LIQUID_DEVICE_HANDLERS = ['ValveBehaviour', 'LiquidPressureValveBehaviour', 'LiquidDuplicatorBehaviour', 'LiquidOutletBehaviour',
  'LiquidentifierBehaviour', 'LiquidFilterBehaviour', 'LiquidContainerLeakingBehaviour', 'LiquidContainerHoleBehaviour', 'PointLiquidTransferBehaviour'] as const;
type DeviceKind = typeof LIQUID_DEVICE_HANDLERS[number];
export interface LiquidHole { localPos: Point; localDir: Point; intensity: number }
export interface ValveJob { open: boolean; time: number }
export type BusyPhase = 'idle' | 'flush' | 'initialising' | 'scanning';
export interface LiquidDeviceState {
  entity: Entity; part: Part; component: SourceComponent; kind: DeviceKind; container: LiquidReservoir;
  active: boolean; valvePosition: number; lastTarget: boolean; valveJobs: ValveJob[];
  phase: BusyPhase; elapsed: number; startAmount: number; flushDuration: number;
  remaining: number; blinkCount: number; display: string; holes: LiquidHole[]; periodicElapsed: number;
}
export interface LiquidEmission { kind: 'outlet' | 'hole'; part: Part; point: Point; direction: Point; amount: number; color: LiquidColor; pressureSpeed: number }
export interface LiquidDeviceOptions {
  isDestroyed?: (part: Part) => boolean;
  isDisabled?: (entity: Entity, component: SourceComponent) => boolean;
  setRendererEnabled?: (entity: Entity, rendererId: string, enabled: boolean) => void;
  setTransformAngle?: (entity: Entity, transformId: string, degrees: number) => void;
  onSound?: (state: LiquidDeviceState, clipId: string, volume: number) => void;
  onDisplay?: (state: LiquidDeviceState, text: string, liters: number) => void;
  onValvePosition?: (state: LiquidDeviceState, position: number) => void;
  onEmission?: (emission: LiquidEmission) => void;
  audioDuration?: (entity: Entity, clipId: string) => number | undefined;
  queryPoint?: (position: Point, layerMask: number) => Part | undefined;
  isBeingUsedContinuously?: (part: Part) => boolean;
  random?: () => number;
}
interface SavedState {
  id: string; kind: DeviceKind; active: boolean; valvePosition: number; lastTarget: boolean; valveJobs: ValveJob[];
  phase: BusyPhase; elapsed: number; startAmount: number; flushDuration: number; remaining: number; blinkCount: number;
  display: string; holes: LiquidHole[]; periodicElapsed: number;
}
export interface LiquidDeviceSnapshot { version: 1; states: SavedState[] }

/** Source liquid-device control. BloodContainer pressure/mixtures remain owned
 * by LiquidSystem; native particle emission is represented by explicit hooks.
 */
export class LiquidDeviceSystem {
  private states = new Map<Entity, LiquidDeviceState[]>();
  private continuous = new Map<Part, { value: number; previous: number }>();
  private continuousClock = 0;
  private oscillation = 0;
  private lastDelta = 1 / 60;
  readonly unsupported = new Set<string>();
  constructor(readonly liquids: LiquidSystem, readonly physical: Pick<PhysicalSystem, 'get'>, readonly options: LiquidDeviceOptions = {}) {}
  get(entity: Entity): readonly LiquidDeviceState[] { return this.states.get(entity) ?? []; }
  attach(entity: Entity): void {
    if (this.states.has(entity)) return;
    const states: LiquidDeviceState[] = [];
    for (const part of entity.parts) for (const component of part.metadata?.components ?? []) {
      if (component.className === 'LiquidLevelGateBehaviour') { this.unsupported.add(`${entity.id}:${component.pathId}: native FixedUpdate throws NotImplementedException`); continue; }
      const kind = component.className as DeviceKind; if (!LIQUID_DEVICE_HANDLERS.includes(kind)) continue;
      const sourceId = id(component.data.Source);
      const sourcePart = sourceId ? entity.parts.find(p => p.metadata?.components.some(c => c.pathId === sourceId)) ?? part : part;
      const container = this.liquids.get(sourcePart);
      if (!container) { this.unsupported.add(`${entity.id}:${component.pathId}: no source BloodContainer`); continue; }
      const data = component.data;
      const holes = flag(data.HasHoles) && Array.isArray(data.SerialisableHoles) ? data.SerialisableHoles.map(record).map(h => ({ localPos: point(h.LocalPos), localDir: point(h.LocalDir), intensity: num(h.Intensity) })).filter(h => h.intensity >= .1) : [];
      const state: LiquidDeviceState = { entity, part, component, kind, container, active: flag(data.Activated), valvePosition: num(data.ValvePosition), lastTarget: flag(data.LastTarget), valveJobs: [],
        phase: 'idle', elapsed: 0, startAmount: 0, flushDuration: 0, remaining: 0, blinkCount: 0, display: '', holes, periodicElapsed: 0 };
      states.push(state); this.synchronize(state); if (this.isValve(state)) this.updateValveVisual(state);
    }
    this.states.set(entity, states);
  }
  remove(entity: Entity): void { for (const state of this.get(entity)) this.continuous.delete(state.part); this.states.delete(entity); }
  private isValve(state: LiquidDeviceState) { return state.kind === 'ValveBehaviour' || state.kind === 'LiquidPressureValveBehaviour'; }
  private enabled(state: LiquidDeviceState): boolean {
    return state.part.body.isActive() && state.component.data.m_Enabled !== 0 && state.component.data.m_Enabled !== false &&
      !(this.options.isDisabled?.(state.entity, state.component) ?? false);
  }
  private destroyed(state: LiquidDeviceState): boolean {
    const pointer = id(state.component.data.DamagableMachinery);
    const part = pointer ? state.entity.parts.find(p => p.metadata?.components.some(c => c.pathId === pointer)) ?? state.part : state.part;
    return this.options.isDestroyed?.(part) ?? part.metadata?.components.some(c => c.className === 'DamagableMachineryBehaviour' && (!pointer || c.pathId === pointer) && flag(c.data.Destroyed)) ?? false;
  }
  private synchronize(state: LiquidDeviceState): void {
    // Leaks and bottle outlets are separate MonoBehaviours; disabling one
    // must not disable its independent BloodContainer reservoir.
    if (!['LiquidContainerLeakingBehaviour', 'LiquidContainerHoleBehaviour', 'PointLiquidTransferBehaviour'].includes(state.kind)) state.container.enabled = this.enabled(state);
    if (this.isValve(state)) {
      state.container.allowPressureTransfer = state.valvePosition > .5;
      state.container.allowsTransfer = state.kind === 'ValveBehaviour' && state.valvePosition > .5;
    }
    if (state.kind === 'LiquidDuplicatorBehaviour') state.container.pressureMode = state.active && !this.destroyed(state) ? PressureDirection.Push : PressureDirection.None;
  }
  canUse(entity: Entity, targetPart?: Part): boolean {
    return this.get(entity).some(s => targetsPart(entity, s.part, targetPart) && this.enabled(s) &&
      (this.isValve(s) || s.kind === 'LiquidentifierBehaviour' || s.kind === 'PointLiquidTransferBehaviour' || s.kind === 'LiquidDuplicatorBehaviour' && !this.destroyed(s)));
  }
  use(entity: Entity, channel = 0, continuous = false, targetPart?: Part): boolean {
    let handled = false;
    for (const state of this.get(entity)) {
      if (!targetsPart(entity, state.part, targetPart) || !this.enabled(state)) continue;
      if (state.kind === 'PointLiquidTransferBehaviour' && continuous) { this.markContinuous(state.part); handled = true; continue; }
      if (continuous) continue;
      if (this.isValve(state)) { this.turn(state, channel === 1 ? true : channel === 2 ? false : !state.lastTarget, false); handled = true; }
      if (state.kind === 'LiquidDuplicatorBehaviour' && !this.destroyed(state)) { if (channel === 1) this.startFlush(state); else state.active = !state.active; this.synchronize(state); handled = true; }
      if (state.kind === 'LiquidentifierBehaviour') { if (channel === 1) this.startFlush(state); else this.startScan(state); handled = true; }
    }
    return handled;
  }
  setValve(entity: Entity, open: boolean, targetPart?: Part): void { for (const state of this.get(entity)) if (this.isValve(state) && targetsPart(entity, state.part, targetPart)) this.turn(state, open, true); }
  flush(entity: Entity, targetPart?: Part): boolean {
    let started = false; for (const state of this.get(entity)) if (targetsPart(entity, state.part, targetPart) && (state.kind === 'LiquidentifierBehaviour' || state.kind === 'LiquidDuplicatorBehaviour')) started = this.startFlush(state) || started;
    return started;
  }
  repair(entity: Entity, targetPart?: Part): void { for (const state of this.get(entity)) if (targetsPart(entity, state.part, targetPart) && state.kind === 'LiquidContainerLeakingBehaviour') state.holes = []; }
  private markContinuous(part: Part): void { const value = this.continuous.get(part) ?? { value: 0, previous: 0 }; value.value++; this.continuous.set(part, value); }
  private turn(state: LiquidDeviceState, open: boolean, cancelPrevious: boolean): void {
    state.lastTarget = open; if (cancelPrevious) state.valveJobs = [];
    this.sound(state, id(state.component.data.TurnSound));
    const job = { open, time: open ? state.valvePosition : 1 - state.valvePosition };
    if (!approximately(state.valvePosition, open ? 1 : 0)) { this.advanceValve(state, job); state.valveJobs.push(job); }
    else state.valvePosition = open ? 1 : 0;
    this.synchronize(state); this.updateValveVisual(state);
  }
  private advanceValve(state: LiquidDeviceState, job: ValveJob): void {
    const curve = state.component.data.ValveTurnCurve as SerializedCurve | undefined;
    const t = job.open ? job.time : 1 - job.time;
    state.valvePosition = curve?.m_Curve?.length ? evaluatePoseCurve(curve, t) : clamp01(t);
  }
  private updateValveVisual(state: LiquidDeviceState): void {
    const data = state.component.data, angle = num(data.MinAngle) + deltaAngle(num(data.MinAngle), num(data.MaxAngle, 90)) * clamp01(state.valvePosition);
    this.options.setTransformAngle?.(state.entity, id(data.ValveTransform), angle);
    this.options.onValvePosition?.(state, state.valvePosition);
  }
  private sound(state: LiquidDeviceState, clip: string, volume = 1): void { if (clip && clip !== '0') this.options.onSound?.(state, clip, volume); }
  private light(state: LiquidDeviceState, rendererId: string, active: boolean): void {
    if (this.options.setRendererEnabled) this.options.setRendererEnabled(state.entity, rendererId, active);
    else for (const renderer of state.entity.renderers ?? []) if (renderer.id === rendererId) renderer.enabled = active;
  }
  private setDisplay(state: LiquidDeviceState, value: string): void { state.display = value; this.options.onDisplay?.(state, value, Math.ceil(state.container.total * 5 / 14 * 10) * .1); }
  private startFlush(state: LiquidDeviceState): boolean {
    if (state.phase !== 'idle' || !this.enabled(state)) return false;
    state.phase = 'flush'; state.elapsed = 0; state.startAmount = state.container.total;
    state.flushDuration = this.options.audioDuration?.(state.entity, id(state.component.data.FlushSound)) ?? 3.807281494140625;
    this.sound(state, id(state.component.data.FlushSound)); if (state.kind === 'LiquidentifierBehaviour') this.setDisplay(state, 'FLUSHING...');
    this.stepFlush(state, this.lastDelta); return true;
  }
  private stepFlush(state: LiquidDeviceState, dt: number): void {
    if ((state.container.total > Number.EPSILON || state.elapsed <= state.flushDuration) && state.elapsed < 5) {
      state.container.drain(state.startAmount * dt / 1.521); state.elapsed += dt;
    } else {
      state.container.deleteEmptyEntries(); state.phase = 'idle';
      if (state.kind === 'LiquidentifierBehaviour') this.setDisplay(state, 'Flushed :)');
    }
  }
  private startScan(state: LiquidDeviceState): void {
    if (state.phase !== 'idle') return;
    state.phase = 'initialising'; state.remaining = 1.123; state.blinkCount = 0;
    const clips = Array.isArray(state.component.data.Clips) ? state.component.data.Clips : [];
    if (clips.length) this.sound(state, id(clips[Math.min(clips.length - 1, Math.floor((this.options.random ?? Math.random)() * clips.length))]));
    this.scanLights(state, true); this.setDisplay(state, 'INITIALISING...');
  }
  private scanLights(state: LiquidDeviceState, active?: boolean): void {
    for (const value of Array.isArray(state.component.data.Lights) ? state.component.data.Lights : []) this.light(state, id(value), active ?? (this.options.random ?? Math.random)() > .5);
  }
  private scanStep(state: LiquidDeviceState, dt: number): void {
    state.remaining -= dt; if (state.remaining > 0) return;
    if (state.phase === 'initialising') { state.phase = 'scanning'; this.setDisplay(state, 'SCANNING...'); }
    if (state.blinkCount < 30) { this.scanLights(state); state.blinkCount++; state.remaining = .0682; }
    else {
      state.container.deleteEmptyEntries();
      const total = state.container.total, distribution = [...state.container.distribution].sort((a, b) => b[1].amount - a[1].amount);
      let sum = 0, shown = 0; const lines: string[] = [];
      for (const [liquid, value] of distribution) {
        const percent = shown === distribution.length - 1 ? 100 - sum : roundEven(value.amount / total * 100);
        if (percent > 0) { lines.push(`${percent}% ${liquidDisplayName(liquid)}`); sum += percent; shown++; }
      }
      this.setDisplay(state, total > Number.EPSILON ? `LIQUID CONTENTS\n\n${lines.join('\n')}` : '(EMPTY)');
      state.phase = 'idle'; this.scanLights(state, false);
    }
  }
  frame(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.lastDelta = dt; this.continuousClock += dt;
    for (let cycles = 0; this.continuousClock >= .025 && cycles < 4; cycles++) {
      this.continuousClock -= .025;
      if (this.oscillation++ % 2 === 0) for (const value of this.continuous.values()) { if (value.previous === value.value) value.value = 0; value.previous = value.value; }
    }
    for (const states of this.states.values()) for (const state of states) {
      this.synchronize(state);
      if (!this.enabled(state)) {
        if (state.kind === 'LiquidentifierBehaviour' && state.phase !== 'idle') { state.phase = 'idle'; this.scanLights(state, false); this.setDisplay(state, 'ABRUPT SHUTDOWN RECOVERY'); }
        continue;
      }
      if (this.isValve(state)) {
        const jobs: ValveJob[] = [];
        for (const job of state.valveJobs) {
          if (approximately(state.valvePosition, job.open ? 1 : 0)) { state.valvePosition = job.open ? 1 : 0; continue; }
          job.time += dt / Math.max(Number.EPSILON, num(state.component.data.TurnDuration, .25)); this.advanceValve(state, job); jobs.push(job);
        }
        state.valveJobs = jobs; this.synchronize(state); this.updateValveVisual(state);
      }
      if (state.kind === 'LiquidDuplicatorBehaviour') {
        if (state.active && !this.destroyed(state) && state.container.total < state.container.capacity) {
          const charge = this.physical.get(state.part), rate = num(state.component.data.RateMultiplier, 1) * (1 + (charge ? getCharge(charge) : 0) * .1) * dt * 60;
          for (const [liquid, value] of state.container.distribution) state.container.addLiquid(liquid, value.amount / state.container.capacity * rate);
          state.periodicElapsed += dt;
          for (let i = 0; state.periodicElapsed >= 4.5 && i < 320; i++) { state.periodicElapsed -= 4.5; this.sound(state, id(state.component.data.PeriodicNoise), .1); }
        }
        this.light(state, id(state.component.data.EnabledLight), state.active);
      }
      if (state.phase === 'flush') this.stepFlush(state, dt);
      else if (state.phase === 'initialising' || state.phase === 'scanning') this.scanStep(state, dt);
      if (state.kind === 'LiquidentifierBehaviour') this.options.onDisplay?.(state, state.display, Math.ceil(state.container.total * 5 / 14 * 10) * .1);
    }
  }
  beforeStep(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    for (const states of this.states.values()) for (const state of states) {
      this.synchronize(state); if (!this.enabled(state)) continue;
      if (state.kind === 'LiquidOutletBehaviour' && state.container.total > .1) { this.emit(state, { localPos: { x: 0, y: 0 }, localDir: { x: 0, y: -1 }, intensity: 1 }, .1, 'outlet'); state.container.drain(.1); }
      if (state.kind === 'LiquidContainerLeakingBehaviour') for (const hole of state.holes) this.drainHole(state, hole, hole.intensity * .05 * num(state.component.data.DrainIntensityMultiplier, .1));
      if (state.kind === 'LiquidContainerHoleBehaviour') this.drainHole(state, { localPos: { x: 0, y: 0 }, localDir: { x: 0, y: -1 }, intensity: 1 }, num(state.component.data.DrainRate, .1));
      if (state.kind === 'PointLiquidTransferBehaviour' && (this.options.isBeingUsedContinuously?.(state.part) ?? (this.continuous.get(state.part)?.value ?? 0) > 0)) {
        const config = state.component.data, local = point(config.Point), scale = this.scale(state);
        const position = num(config.Space, 1) === 0 ? local : state.part.body.getWorldPoint(Vec2(local.x * scale.x, local.y * scale.y));
        const targetPart = this.options.queryPoint ? this.options.queryPoint(position, num(record(config.Layers).m_Bits, -1)) : this.queryPoint(state, position, num(record(config.Layers).m_Bits, -1));
        const target = targetPart ? this.liquids.get(targetPart) : undefined;
        if (target && target !== state.container && (target.allowsOverflow || target.scaledAmount < .999)) {
          state.container.transferTo(num(config.UnitsPerSecond, .56) * dt, target);
          if (targetPart) this.liquids.syncPart(targetPart);
        }
      }
      if (state.container.part) this.liquids.syncPart(state.container.part);
    }
  }
  private scale(state: LiquidDeviceState): Point { return state.entity.metadata?.nodes.find(n => n.id === state.part.metadata?.nodeId)?.scale ?? { x: 1, y: 1 }; }
  private drainHole(state: LiquidDeviceState, hole: LiquidHole, rate: number): void { if (state.container.total > rate) { this.emit(state, hole, rate, 'hole'); state.container.drain(rate); } }
  private emit(state: LiquidDeviceState, hole: LiquidHole, amount: number, kind: LiquidEmission['kind']): void {
    const scale = this.scale(state), length = Math.hypot(hole.localDir.x, hole.localDir.y) || 1;
    const position = state.part.body.getWorldPoint(Vec2((hole.localPos.x + hole.localDir.x / length * .03) * scale.x, (hole.localPos.y + hole.localDir.y / length * .03) * scale.y));
    const physical = this.physical.get(state.part);
    this.options.onEmission?.({ kind, part: state.part, point: position, direction: state.part.body.getWorldVector(hole.localDir), amount, color: state.container.computedColor,
      pressureSpeed: kind === 'outlet' ? (physical ? getCharge(physical) : 0) * .4 + 2 : state.container.measuredPressure *
        (state.kind === 'LiquidContainerHoleBehaviour' ? num(state.component.data.ForceMultiplier, .001) : .001 * num(state.component.data.VisualPressureMultiplier, 1)) + .5 });
  }
  /** Particle callbacks can copy the current source mixture without removing it
   * again: its fixed-step outlet/hole drain has already occurred. */
  particleCollide(sourcePart: Part, targetPart: Part, holeIndex?: number): void {
    for (const states of this.states.values()) for (const state of states) if (state.part === sourcePart) {
      const target = this.liquids.get(targetPart); if (!target) continue;
      if (state.kind === 'LiquidOutletBehaviour') state.container.copyTo(.1, target);
      if (state.kind === 'LiquidContainerHoleBehaviour' && target !== state.container) state.container.copyTo(num(state.component.data.DrainRate, .1), target);
      if (state.kind === 'LiquidContainerLeakingBehaviour' && target !== state.container) {
        const hole = state.holes[holeIndex ?? 0]; if (hole) state.container.copyTo(hole.intensity * .05 * num(state.component.data.DrainIntensityMultiplier, .1), target);
      }
      this.liquids.syncPart(targetPart);
    }
  }
  private queryPoint(state: LiquidDeviceState, position: Point, layerMask: number): Part | undefined {
    let result: Part | undefined;
    state.part.body.getWorld().queryAABB(new AABB(Vec2(position.x - .001, position.y - .001), Vec2(position.x + .001, position.y + .001)), fixture => {
      if (fixture.isSensor() || !fixture.testPoint(position)) return true;
      const part = [...this.liquids.containers.keys()].find(p => p.body === fixture.getBody()); if (!part) return false;
      const owner = [...this.states.keys()].find(e => e.parts.includes(part));
      const node = owner?.metadata?.nodes.find(n => n.id === part.metadata?.nodeId) as { layer?: number } | undefined;
      if (!(layerMask & (1 << (node?.layer ?? 9)))) return true;
      result = part; return false;
    });
    return result;
  }
  shot(part: Part, shot: { point: Point; normal: Point; damage: number }): void {
    if (![shot.damage, shot.point.x, shot.point.y, shot.normal.x, shot.normal.y].every(Number.isFinite)) return;
    for (const states of this.states.values()) for (const state of states) if (state.part === part && state.kind === 'LiquidContainerLeakingBehaviour')
      this.createHole(state, shot.point, shot.normal, Math.min(5, Math.max(.2, shot.damage)));
  }
  exitShot(part: Part, shot: { point: Point; normal: Point; damage: number }): void { this.shot(part, shot); }
  unstabbed(part: Part, position: Point, normal: Point, causesWound: boolean): void {
    if (!causesWound || ![position.x, position.y, normal.x, normal.y].every(Number.isFinite)) return;
    for (const states of this.states.values()) for (const state of states) if (state.part === part && state.kind === 'LiquidContainerLeakingBehaviour') this.createHole(state, position, normal, 5);
  }
  private createHole(state: LiquidDeviceState, position: Point, normal: Point, intensity: number): void {
    const target = Vec2(position.x + normal.x * .1, position.y + normal.y * .1), body = state.part.body;
    let closest = target, distance = Infinity;
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      if (fixture.isSensor()) continue;
      if (fixture.testPoint(target)) { closest = target; break; }
      const shape = fixture.getShape();
      for (let child = 0; child < shape.getChildCount(); child++) {
        const input = new DistanceInput(), output = new DistanceOutput(), cache = new SimplexCache(); cache.count = 0;
        input.proxyA.set(shape, child); input.proxyB.setVertices([target], 1, 0); input.transformA.set(body.getTransform()); input.transformB.setIdentity(); input.useRadii = true;
        Distance(output, cache, input); if (output.distance < distance) { distance = output.distance; closest = Vec2(output.pointA); }
      }
    }
    const scale = this.scale(state), local = body.getLocalPoint(closest);
    state.holes.push({ localPos: { x: local.x / (scale.x || 1), y: local.y / (scale.y || 1) }, localDir: body.getLocalVector(normal), intensity });
  }
  snapshot(entity: Entity): LiquidDeviceSnapshot | undefined {
    const states = this.get(entity); if (!states.length) return undefined;
    return { version: 1, states: states.map(s => ({ id: s.component.pathId, kind: s.kind, active: s.active, valvePosition: s.valvePosition, lastTarget: s.lastTarget,
      valveJobs: s.valveJobs.map(j => ({ ...j })), phase: s.phase, elapsed: s.elapsed, startAmount: s.startAmount, flushDuration: s.flushDuration,
      remaining: s.remaining, blinkCount: s.blinkCount, display: s.display, holes: s.holes.map(h => ({ localPos: { ...h.localPos }, localDir: { ...h.localDir }, intensity: h.intensity })), periodicElapsed: s.periodicElapsed })) };
  }
  restore(entity: Entity, value: unknown): boolean {
    const data = record(value), states = this.get(entity), byId = new Map(states.map(s => [s.component.pathId, s]));
    if (data.version !== 1 || !Array.isArray(data.states) || data.states.length !== states.length) return false;
    const used = new Set<string>();
    for (const raw of data.states) {
      const s = record(raw), state = byId.get(String(s.id));
      if (!state || used.has(String(s.id)) || s.kind !== state.kind || typeof s.active !== 'boolean' || typeof s.lastTarget !== 'boolean' || typeof s.display !== 'string' || s.display.length > 100000) return false;
      used.add(String(s.id));
      if (['valvePosition', 'elapsed', 'startAmount', 'flushDuration', 'remaining', 'blinkCount', 'periodicElapsed'].some(k => typeof s[k] !== 'number' || !Number.isFinite(s[k]) || Math.abs(s[k] as number) > 1e12)) return false;
      if (num(s.elapsed) < 0 || num(s.startAmount) < 0 || num(s.flushDuration) < 0 || !Number.isInteger(s.blinkCount) || num(s.blinkCount) < 0 || num(s.blinkCount) > 30 || !['idle', 'flush', 'initialising', 'scanning'].includes(String(s.phase))) return false;
      if (!Array.isArray(s.valveJobs) || s.valveJobs.some(j => typeof record(j).open !== 'boolean' || !Number.isFinite(record(j).time))) return false;
      if (!Array.isArray(s.holes) || s.holes.some(h => !['x', 'y'].every(a => Number.isFinite(record(record(h).localPos)[a]) && Number.isFinite(record(record(h).localDir)[a])) || num(record(h).intensity, -1) < .1)) return false;
    }
    for (const raw of data.states) {
      const saved = raw as SavedState, state = byId.get(saved.id)!;
      Object.assign(state, { active: saved.active, valvePosition: saved.valvePosition, lastTarget: saved.lastTarget, valveJobs: saved.valveJobs.map(j => ({ ...j })), phase: saved.phase,
        elapsed: saved.elapsed, startAmount: saved.startAmount, flushDuration: saved.flushDuration, remaining: saved.remaining, blinkCount: saved.blinkCount, display: saved.display,
        holes: saved.holes.map(h => ({ ...h, localPos: { ...h.localPos }, localDir: { ...h.localDir } })), periodicElapsed: saved.periodicElapsed });
      this.synchronize(state); if (this.isValve(state)) this.updateValveVisual(state);
      this.options.onDisplay?.(state, state.display, Math.ceil(state.container.total * 5 / 14 * 10) * .1);
    }
    return true;
  }
}

function roundEven(value: number): number { const floor = Math.floor(value); return Math.abs(value - floor - .5) < 1e-12 ? floor % 2 === 0 ? floor : floor + 1 : Math.round(value); }
function liquidDisplayName(value: string): string {
  const names: Record<string, string> = { BLOOD: 'Human blood', 'GORSE BLOOD': 'Gorse blood', NITRO: 'Nitroglycerine', 'FREEZE POISON': 'Joint lock poison', 'PAIN KILLER': 'Painkiller', 'BEVERAGE M04': 'Beverage M04' };
  return names[value] ?? value.charAt(0) + value.slice(1).toLowerCase();
}
