import { PrismaticJoint, RevoluteJoint, Vec2, type Joint } from 'planck';
import type { Entity, Part } from '../simulation';
import type { SourceComponent } from '../prefabs';
import type { PhysicalSystem } from './physical-world';
import { getCharge } from './physical';
import {targetsPart} from './targeting';

const DEG = Math.PI / 180;
const number = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const flag = (v: unknown) => v === true || v === 1;
const pointer = (v: unknown) => String((v as { m_PathID?: unknown } | undefined)?.m_PathID ?? '');
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Mathf.DeltaAngle returns +180 at the exact half-turn boundary. */
export function deltaAngle(current: number, target: number): number {
  const repeated = ((target - current) % 360 + 360) % 360;
  return repeated > 180 ? repeated - 360 : repeated;
}
export const MECHANISM_HANDLERS = ['PistonBehaviour', 'MotorisedHingeBehaviour', 'GearBehaviour'] as const;
export type MechanismKind = typeof MECHANISM_HANDLERS[number];
export interface MechanismState {
  kind: MechanismKind; entity: Entity; part: Part; component: SourceComponent;
  active: boolean; alreadyReached: boolean; delta: number; speed: number; force: number;
  motorSpeedMultiplier: number; correctionSpeedMultiplier: number; lower: number; upper: number;
  toothCount: number; jointId: string; joint?: PrismaticJoint | RevoluteJoint;
}
export interface MechanismOptions {
  isDestroyed?: (part: Part) => boolean;
  isDisabled?: (entity: Entity, component: SourceComponent) => boolean;
  getLocalScaleX?: (entity: Entity, part: Part, component: SourceComponent) => number;
  setRendererEnabled?: (entity: Entity, rendererPathId: string, enabled: boolean) => void;
  setIndicatorAngle?: (entity: Entity, transformPathId: string, degrees: number) => void;
  onMotorAudio?: (state: MechanismState, playing: boolean, volume: number) => void;
  onPistonUse?: (state: MechanismState) => void;
  /** Preserve host bookkeeping when a reflected slider needs a new axis. */
  onJointReplaced?: (state: MechanismState, previous: Joint, replacement: Joint) => void;
}
export interface MechanismSnapshot {
  version: 1;
  states: { id: string; kind: MechanismKind; active: boolean; alreadyReached: boolean;
    delta: number; speed: number; force: number; motorSpeedMultiplier: number; correctionSpeedMultiplier: number;
    lower: number; upper: number }[];
}

/** Native piston and servo controllers. Gears are registered without inventing
 * a motor/coupling rule: the inspected obsolete GearBehaviour methods are empty.
 */
export class MechanismSystem {
  private states = new Map<Entity, MechanismState[]>();
  readonly unsupported = new Set<string>();
  constructor(readonly physical: Pick<PhysicalSystem, 'get'>, readonly options: MechanismOptions = {}) {}
  get(entity: Entity): readonly MechanismState[] { return this.states.get(entity) ?? []; }
  attach(entity: Entity): void {
    if (this.states.has(entity)) return;
    const states: MechanismState[] = [];
    for (const part of entity.parts) for (const component of part.metadata?.components ?? []) {
      const kind = component.className as MechanismKind;
      if (!MECHANISM_HANDLERS.includes(kind)) continue;
      const data = component.data, jointId = pointer(kind === 'PistonBehaviour' ? data.Slider : data.Hinge);
      const joint = entity.jointById?.get(jointId);
      const rawJoint = entity.metadata?.nodes.flatMap(n => n.components).find(c => c.pathId === jointId)?.data;
      const limits = rawJoint?.m_TranslationLimits as { m_LowerTranslation?: number; m_UpperTranslation?: number } | undefined;
      const state: MechanismState = { kind, entity, part, component, active: flag(data.Activated), alreadyReached: false,
        delta: number(data.Delta, 90), speed: number(data.Speed, 1), force: number(data.Force, 1),
        motorSpeedMultiplier: number(data.MotorSpeedMutliplier, 5), correctionSpeedMultiplier: number(data.CorrectionSpeedMultiplier, 3),
        lower: number(limits?.m_LowerTranslation, joint instanceof PrismaticJoint ? joint.getLowerLimit() : 0),
        upper: number(limits?.m_UpperTranslation, joint instanceof PrismaticJoint ? joint.getUpperLimit() : 0),
        toothCount: number(data.ToothCount, 64), jointId,
        joint: joint instanceof PrismaticJoint || joint instanceof RevoluteJoint ? joint : undefined };
      if (kind !== 'GearBehaviour' && !state.joint) this.unsupported.add(`${entity.id}:${component.pathId}: missing source joint ${jointId}`);
      states.push(state);
      if (kind === 'PistonBehaviour' && state.joint instanceof PrismaticJoint) {
        this.mirrorSlider(state); this.updateLimits(state);
      }
      if (kind === 'MotorisedHingeBehaviour') { this.updateIndicator(state); this.updateLight(state); }
    }
    this.states.set(entity, states);
  }
  remove(entity: Entity): void {
    for (const state of this.get(entity)) if (state.kind === 'MotorisedHingeBehaviour') this.options.onMotorAudio?.(state, false, 0);
    this.states.delete(entity);
  }
  private scaleX(state: MechanismState): number {
    const external = this.options.getLocalScaleX?.(state.entity, state.part, state.component);
    if (external !== undefined && Number.isFinite(external)) return external;
    const transform = state.part.metadata?.components.find(c => c.type === 'Transform' || c.type === 'RectTransform')?.data;
    const scale = transform?.m_LocalScale as { x?: unknown } | undefined;
    return number(scale?.x, state.entity.metadata?.nodes.find(n => n.id === state.part.metadata?.nodeId)?.scale.x ?? 1);
  }
  private destroyed(state: MechanismState): boolean {
    const reference = pointer(state.component.data.DamagableMachinery);
    const part = reference ? state.entity.parts.find(p => p.metadata?.components.some(c => c.pathId === reference)) ?? state.part : state.part;
    const native = part.metadata?.components.find(c => c.className === 'DamagableMachineryBehaviour' && (!reference || c.pathId === reference));
    return this.options.isDestroyed?.(part) ?? flag(native?.data.Destroyed);
  }
  private enabled(state: MechanismState): boolean {
    return state.part.body.isActive() && state.component.data.m_Enabled !== false && state.component.data.m_Enabled !== 0 &&
      state.entity.metadata?.nodes.find(n => n.id === state.part.metadata?.nodeId)?.active !== false &&
      !(this.options.isDisabled?.(state.entity, state.component) ?? false);
  }
  canUse(entity: Entity, targetPart?: Part): boolean {
    return this.get(entity).some(s => s.kind !== 'GearBehaviour' && targetsPart(entity,s.part,targetPart) && this.enabled(s) && !this.destroyed(s));
  }
  use(entity: Entity, _channel = 0, continuous = false, targetPart?: Part): boolean {
    if (continuous) return false; // These source controllers implement IUse only.
    let changed = false;
    for (const state of this.get(entity)) {
      if (state.kind === 'GearBehaviour' || !targetsPart(entity,state.part,targetPart) || !this.enabled(state) || this.destroyed(state)) continue;
      state.active = !state.active; state.alreadyReached = false;
      if (state.kind === 'PistonBehaviour') this.options.onPistonUse?.(state);
      else this.updateLight(state);
      changed = true;
    }
    return changed;
  }
  setServoDelta(entity: Entity, degrees: number, targetPart?: Part): void {
    if (!Number.isFinite(degrees)) return;
    for (const state of this.get(entity)) if (state.kind === 'MotorisedHingeBehaviour' && (!targetPart || state.part === targetPart)) { state.delta = degrees; this.updateIndicator(state); }
  }
  setServoSpeed(entity: Entity, speed: number, targetPart?: Part): void {
    if (!Number.isFinite(speed)) return;
    for (const state of this.get(entity)) if (state.kind === 'MotorisedHingeBehaviour' && (!targetPart || state.part === targetPart)) state.speed = Math.max(0, Math.min(10, speed));
  }
  private updateLight(state: MechanismState): void {
    const id = pointer(state.component.data.ActiveLight); if (!id) return;
    if (this.options.setRendererEnabled) this.options.setRendererEnabled(state.entity, id, state.active);
    else for (const renderer of state.entity.renderers ?? []) if (renderer.id === id) renderer.enabled = state.active;
  }
  private updateIndicator(state: MechanismState): void {
    const id = pointer(state.component.data.IndicatorArm); if (!id) return;
    if (this.options.setIndicatorAngle) this.options.setIndicatorAngle(state.entity, id, state.delta);
    else {
      const node = state.entity.metadata?.nodes.find(n => n.components.some(c => c.type === 'Transform' && c.pathId === id));
      for (const renderer of state.entity.renderers ?? []) if (renderer.nodeId === node?.id) renderer.angle = state.delta * DEG;
    }
  }
  private mirrorSlider(state: MechanismState): void {
    const joint = state.joint; if (!(joint instanceof PrismaticJoint) || this.scaleX(state) >= 0 || joint.getLocalAxisA().x < 0) return;
    // Unity SliderJoint2D.angle is writable. Planck has no public axis setter;
    // rebuild only the mirrored controller's joint with its public definition.
    const world = joint.getBodyA().getWorld();
    const replacement = world.createJoint(new PrismaticJoint({ bodyA: joint.getBodyA(), bodyB: joint.getBodyB(),
      localAnchorA: joint.getLocalAnchorA(), localAnchorB: joint.getLocalAnchorB(), localAxisA: Vec2(-1, 0),
      referenceAngle: joint.getReferenceAngle(), collideConnected: joint.getCollideConnected(), enableLimit: joint.isLimitEnabled(),
      lowerTranslation: joint.getLowerLimit(), upperTranslation: joint.getUpperLimit(), enableMotor: joint.isMotorEnabled(),
      motorSpeed: joint.getMotorSpeed(), maxMotorForce: joint.getMaxMotorForce() }));
    if (!replacement) return;
    state.entity.joints = state.entity.joints.map(j => j === joint ? replacement : j);
    state.entity.jointById?.set(state.jointId, replacement); state.joint = replacement;
    this.options.onJointReplaced?.(state, joint, replacement);
    world.destroyJoint(joint);
  }
  private updateLimits(state: MechanismState): void {
    if (state.joint instanceof PrismaticJoint) state.joint.setLimits(state.lower * Math.abs(this.scaleX(state)), state.upper * Math.abs(this.scaleX(state)));
  }
  beforeStep(_dt: number): void {
    for (const states of this.states.values()) for (const state of states) {
      if (state.kind === 'GearBehaviour') continue;
      const joint = state.joint;
      if (!joint || !state.entity.joints.includes(joint)) continue;
      const enabled = this.enabled(state) && !this.destroyed(state);
      if (!enabled) { joint.enableMotor(false); if (state.kind === 'MotorisedHingeBehaviour') this.options.onMotorAudio?.(state, false, 0); continue; }
      const physical = this.physical.get(state.part), charge = physical ? getCharge(physical) : 0;
      joint.enableMotor(true);
      if (state.kind === 'PistonBehaviour' && joint instanceof PrismaticJoint) {
        this.updateLimits(state);
        const direction = state.active ? 1 : -1, position = joint.getJointTranslation();
        const target = direction > 0 ? joint.getUpperLimit() : joint.getLowerLimit();
        const reached = joint.isLimitEnabled() && (direction > 0 ? position >= target - 1e-7 : position <= target + 1e-7);
        let factor = 1;
        if (reached) { state.alreadyReached = true; factor = 0; }
        else if (state.alreadyReached) factor = clamp01((position - target) ** 2 * state.correctionSpeedMultiplier);
        joint.setMotorSpeed(direction * Math.abs(this.scaleX(state)) * factor * state.motorSpeedMultiplier * Math.max(1, charge));
      } else if (state.kind === 'MotorisedHingeBehaviour' && joint instanceof RevoluteJoint) {
        const target = state.active ? state.delta * (this.scaleX(state) > 0 ? 1 : -1) : 0;
        const nativeAngle = -joint.getJointAngle() / DEG;
        joint.setMotorSpeed(-deltaAngle(nativeAngle, target) * state.speed * DEG);
        joint.setMaxMotorTorque(Math.max(0, state.force * (1 + charge)));
        const level = Math.abs(joint.getJointSpeed() / DEG) * .1;
        this.options.onMotorAudio?.(state, level > .5, level > .5 ? clamp01(level * level * number(state.component.data.VolumeMultiplier, .5)) : 0);
      }
    }
  }
  snapshot(entity: Entity): MechanismSnapshot | undefined {
    const states = this.get(entity); if (!states.length) return undefined;
    return { version: 1, states: states.map(s => ({ id: s.component.pathId, kind: s.kind, active: s.active, alreadyReached: s.alreadyReached,
      delta: s.delta, speed: s.speed, force: s.force, motorSpeedMultiplier: s.motorSpeedMultiplier, correctionSpeedMultiplier: s.correctionSpeedMultiplier, lower: s.lower, upper: s.upper })) };
  }
  restore(entity: Entity, value: unknown): boolean {
    const data = value as MechanismSnapshot;
    const states = this.get(entity), byId = new Map(states.map(s => [s.component.pathId, s]));
    if (!data || data.version !== 1 || !Array.isArray(data.states) || data.states.length !== states.length || new Set(data.states.map(s => s?.id)).size !== states.length) return false;
    for (const saved of data.states) {
      const state = byId.get(saved?.id); if (!state || saved.kind !== state.kind || typeof saved.active !== 'boolean' || typeof saved.alreadyReached !== 'boolean') return false;
      if (['delta', 'speed', 'force', 'motorSpeedMultiplier', 'correctionSpeedMultiplier', 'lower', 'upper'].some(k => typeof saved[k as keyof typeof saved] !== 'number' || !Number.isFinite(saved[k as keyof typeof saved]) || Math.abs(saved[k as keyof typeof saved] as number) > 1e12)) return false;
      if (saved.speed < 0 || saved.speed > 10 || saved.force < 0 || saved.lower > saved.upper) return false;
    }
    for (const saved of data.states) {
      const state = byId.get(saved.id)!; Object.assign(state, { active: saved.active, alreadyReached: saved.alreadyReached, delta: saved.delta, speed: saved.speed,
        force: saved.force, motorSpeedMultiplier: saved.motorSpeedMultiplier, correctionSpeedMultiplier: saved.correctionSpeedMultiplier, lower: saved.lower, upper: saved.upper });
      if (state.kind === 'MotorisedHingeBehaviour') { this.updateIndicator(state); this.updateLight(state); }
      if (state.kind === 'PistonBehaviour') this.updateLimits(state);
    }
    return true;
  }
}
