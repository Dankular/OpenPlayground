import { Vec2, RevoluteJoint } from 'planck';
import type { Entity, Part } from '../simulation';
import type { SourceComponent } from '../prefabs';
import type { PhysicalSystem } from './physical-world';
import { getCharge, getHeatCapacity } from './physical';

export const DEVICE_HANDLERS = ['GeneratorBehaviour', 'HeatingElementBehaviour', 'HoverboxBehaviour', 'RotorBehaviour', 'IonThrusterBehaviour'] as const;
type DeviceKind = typeof DEVICE_HANDLERS[number];
export interface DeviceState {
  kind: DeviceKind; component: SourceComponent; part: Part; entity: Entity;
  active: boolean; warmup: number; speed: number; targetTemperature: number;
}
const num = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
const pointer = (value: unknown) => String((value as { m_PathID?: number } | undefined)?.m_PathID ?? '');

/** Reconstructed device controllers. Particle/audio presentation is separate. */
export class DeviceSystem {
  private states = new Map<Entity, DeviceState[]>();
  private elapsed = 0;
  constructor(readonly physical: PhysicalSystem, readonly options: {
    gravity?: { x: number; y: number };
    setRendererEnabled?: (entity: Entity, pathId: string, enabled: boolean) => void;
    isDestroyed?: (part: Part) => boolean;
    isDisabled?: (entity: Entity, component: SourceComponent) => boolean;
  } = {}) {}

  attach(entity: Entity): void {
    if (this.states.has(entity)) return;
    const devices: DeviceState[] = [];
    for (const part of entity.parts) for (const component of part.metadata?.components ?? []) {
      if (entity.metadata?.nodes.find(n => n.id === part.metadata?.nodeId)?.active === false) continue;
      const kind = component.className as DeviceKind;
      if (!DEVICE_HANDLERS.includes(kind) || component.data.m_Enabled === 0 || component.data.m_Enabled === false) continue;
      const data = component.data;
      const state: DeviceState = { kind, component, part, entity, active: !!data.Activated,
        warmup: num(data.WarmupProgress, 0), speed: num(data.Speed, 1), targetTemperature: num(data.TargetTemperature, 1) };
      devices.push(state); this.updateLight(state);
    }
    this.states.set(entity, devices);
  }
  remove(entity: Entity): void { this.states.delete(entity); }
  get(entity: Entity): readonly DeviceState[] { return this.states.get(entity) ?? []; }
  use(entity: Entity, channel = 0): boolean {
    let changed = false;
    for (const device of this.states.get(entity) ?? []) {
      if (this.options.isDestroyed?.(device.part) || this.options.isDisabled?.(entity, device.component)) continue;
      if (device.kind === 'RotorBehaviour' && channel === 1) device.speed = -device.speed;
      else { device.active = !device.active; if (device.kind === 'GeneratorBehaviour') device.warmup = 0; }
      this.updateLight(device); changed = true;
    }
    return changed;
  }
  private updateLight(device: DeviceState): void {
    const data = device.component.data;
    const ref = device.kind === 'RotorBehaviour' ? data.ActiveLight : data.ActivationLight;
    if (ref) this.options.setRendererEnabled?.(device.entity, pointer(ref), device.active);
  }
  frame(dt: number): void {
    for (const devices of this.states.values()) for (const d of devices) {
      if (d.kind !== 'GeneratorBehaviour') continue;
      if (this.options.isDisabled?.(d.entity, d.component)) continue;
      const physical = this.physical.get(d.part); if (!physical) continue;
      const config = d.component.data;
      d.warmup = Math.max(0, Math.min(1, d.warmup));
      if (d.active) {
        const target = num(config.TargetCharge, 100);
        physical.state.charge = Math.max(getCharge(physical), config.InstantChargeChange ? target : target * d.warmup);
        d.warmup += dt * 60 * num(config.TargetEnergyReachSpeed, 1);
      } else if (config.InstantChargeChange) physical.state.charge = 0;
    }
  }
  beforeStep(dt: number): void {
    this.elapsed += dt;
    const gravity = this.options.gravity ?? { x: 0, y: -9.81 };
    for (const devices of this.states.values()) for (const d of devices) {
      const body = d.part.body, physical = this.physical.get(d.part), data = d.component.data;
      const charge = physical ? getCharge(physical) : 0;
      const destroyed = (this.options.isDestroyed?.(d.part) ?? false) || (this.options.isDisabled?.(d.entity, d.component) ?? false);
      if (d.kind === 'RotorBehaviour') {
        const joint = d.entity.jointById?.get(pointer(data.Hinge));
        if (joint instanceof RevoluteJoint) {
          joint.enableMotor(true); joint.setMaxMotorTorque(100 + charge * 4);
          const scaleX = d.entity.metadata?.nodes.find(n => n.id === d.part.metadata?.nodeId)?.scale.x ?? 1;
          // Unity's owner-minus-connected sign is reversed by the Planck adapter.
          joint.setMotorSpeed(d.active && !destroyed ? Math.max(-8000, Math.min(8000, d.speed)) * Math.sign(scaleX || 1) * Math.PI / 180 : 0);
        }
      }
      if (!d.active || destroyed) continue;
      if (d.kind === 'GeneratorBehaviour' && physical) {
        const targetTemperature = num(data.TargetCharge, 100) / 4;
        if (physical.state.temperature < targetTemperature)
          physical.state.temperature = lerp(physical.state.temperature, targetTemperature, .02 / getHeatCapacity(physical));
        if (data.Vibrate) {
          const theta = this.elapsed * num(data.VibrateRotationSpeed, 0), strength = num(data.VibrateForce, 0) * d.warmup;
          body.applyForceToCenter(body.getWorldVector(Vec2(Math.cos(theta) * strength, Math.sin(theta) * strength)), true);
        }
      } else if (d.kind === 'HeatingElementBehaviour' && physical) {
        const cooling = !!data.ActiveCooling;
        if (cooling !== (physical.state.temperature <= d.targetTemperature))
          physical.state.temperature = lerp(physical.state.temperature, d.targetTemperature, num(data.HeatTargetSpeed, .1));
      } else if (d.kind === 'HoverboxBehaviour') {
        body.applyForceToCenter(Vec2(-gravity.x * body.getMass() * body.getGravityScale(), -gravity.y * body.getMass() * body.getGravityScale()), true);
        const damping = Math.pow(.9, Math.max(1, charge));
        body.setLinearVelocity(Vec2.mul(body.getLinearVelocity(), damping)); body.setAngularVelocity(body.getAngularVelocity() * damping);
      } else if (d.kind === 'IonThrusterBehaviour') {
        const direction = data.LocalDirection as { x?: number; y?: number } | undefined;
        const scaleX = d.entity.metadata?.nodes.find(n => n.id === d.part.metadata?.nodeId)?.scale.x ?? 1;
        const force = (num(data.Thrust, 10) + charge * 4) * (scaleX > 0 ? -1 : 1);
        body.applyForceToCenter(body.getWorldVector(Vec2(num(direction?.x, 0) * force, num(direction?.y, 0) * force)), true);
      }
    }
  }
}
