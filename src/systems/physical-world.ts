import type { Body } from 'planck';
import type { Entity, Part } from '../simulation';
import type { SourceComponent } from '../prefabs';
import {
  averageTemperature, conductContact, createPhysicalObject, extinguish, heatFromSliding,
  ignite, stepPhysical, updatePhysicalFrame, type PhysicalObject, type PhysicalProperties,
  type PhysicalSettings, type PhysicalState,
} from './physical';

export function sourceComponent(part: Part, name: string): SourceComponent | undefined {
  return part.metadata?.components.find(c => c.className === name || c.type === name);
}

export class PhysicalSystem {
  readonly objects = new Map<Part, PhysicalObject>();
  private byBody = new Map<Body, PhysicalObject>();
  private byEntity = new Map<Entity, Part[]>();
  ambientTemperature: number;
  constructor(readonly options: {
    ambientTemperature?: number;
    random?: () => number;
    resolveProperties?: (component: SourceComponent, entity: Entity) => Partial<PhysicalProperties> | undefined;
  } = {}) { this.ambientTemperature = options.ambientTemperature ?? 18; }

  attach(entity: Entity): void {
    if (this.byEntity.has(entity)) return;
    this.byEntity.set(entity, entity.parts);
    for (const part of entity.parts) {
      if (entity.metadata?.nodes.find(n => n.id === part.metadata?.nodeId)?.active === false) continue;
      const component = sourceComponent(part, 'PhysicalBehaviour');
      if (!component) continue;
      const data = component.data;
      const settings: Partial<PhysicalSettings> = {};
      for (const key of ['SimulateTemperature', 'AmbientTemperatureTransfer', 'ChargeBurns', 'ForceNoCharge', 'ConductOverride'] as const)
        if (typeof data[key] === 'boolean' || data[key] === 0 || data[key] === 1) settings[key] = !!data[key];
      for (const key of ['TemperatureWhenBurningLerpMultiplier', 'BurningProgressionMultiplier', 'EnergyWireResistance'] as const)
        if (typeof data[key] === 'number') settings[key] = data[key];
      const extracted = (component as SourceComponent & { properties?: { data?: Record<string, unknown> } }).properties?.data;
      const properties: Partial<PhysicalProperties> = this.options.resolveProperties?.(component, entity) ?? {};
      if (extracted) {
        for (const key of ['Flammability', 'Burnrate', 'BurningTemperatureThreshold', 'HeatTransferSpeedMultiplier'] as const)
          if (typeof extracted[key] === 'number') properties[key] = extracted[key];
        if (extracted.Conducting !== undefined) properties.Conducting = !!extracted.Conducting;
      }
      // Prefab renderers hold actual visual size; Part defaults can be collider-only.
      const renderer = entity.renderers?.find(r => r.bodyId === part.id);
      const node = entity.metadata?.nodes.find(n => n.id === part.metadata?.nodeId);
      const state = createPhysicalObject({ ambientTemperature: this.ambientTemperature,
        mass: part.body.getMass(), width: renderer?.sprite.width ?? part.width,
        height: renderer?.sprite.height ?? part.height, settings, properties,
        isStatic: Boolean((node as unknown as { isStatic?: boolean })?.isStatic) });
      this.objects.set(part, state); this.byBody.set(part.body, state);
    }
  }

  get(part: Part): PhysicalObject | undefined { return this.objects.get(part); }
  getByBody(body: Body): PhysicalObject | undefined { return this.byBody.get(body); }
  remove(entity: Entity): void {
    for (const part of this.byEntity.get(entity) ?? []) { this.objects.delete(part); this.byBody.delete(part.body); }
    this.byEntity.delete(entity);
  }
  frame(deltaTime: number, timeScale: number): void {
    for (const object of this.objects.values()) updatePhysicalFrame(object, deltaTime, timeScale);
  }
  beforeStep(_dt: number): void {
    for (const [part, object] of this.objects) {
      object.mass = part.body.getMass();
      stepPhysical(object, this.ambientTemperature, this.options.random);
    }
  }
  afterStep(_dt: number): void {
    // Deliberately directional: Unity invokes OnCollisionStayWithoutSleep for each
    // participant, so a contact can perform two temperature averages per step.
    for (const [part, a] of this.objects) {
      if (a.isStatic) continue;
      for (let edge = part.body.getContactList(); edge; edge = edge.next) {
        const contact = edge.contact;
        if (!edge.other || !contact.isTouching() || contact.getFixtureA().isSensor() || contact.getFixtureB().isSensor()) continue;
        const b = this.byBody.get(edge.other);
        if (b) { averageTemperature(a, b); conductContact(a, b); }
        const ownVelocity = part.body.getLinearVelocity(), otherVelocity = edge.other.getLinearVelocity();
        heatFromSliding(a, (ownVelocity.x - otherVelocity.x) ** 2 + (ownVelocity.y - otherVelocity.y) ** 2, contact.getFriction());
      }
    }
  }
  ignite(entity: Entity, ignoreFlammability = false): void {
    for (const part of entity.parts) { const object = this.get(part); if (object) ignite(object, (this.options.random ?? Math.random)(), ignoreFlammability); }
  }
  extinguish(entity: Entity): void {
    for (const part of entity.parts) { const object = this.get(part); if (object) extinguish(object); }
  }
  setTemperature(entity: Entity, temperature: number): void {
    if (!Number.isFinite(temperature)) return;
    for (const part of entity.parts) { const object = this.get(part); if (object) object.state.temperature = Math.max(-273.15, Math.min(1e9, temperature)); }
  }
  setCharge(entity: Entity, charge: number): void {
    if (!Number.isFinite(charge)) return;
    for (const part of entity.parts) { const object = this.get(part); if (object) object.state.charge = Math.max(0, charge); }
  }
  snapshot(entity: Entity): Record<string, PhysicalState> {
    return Object.fromEntries(entity.parts.flatMap((part, i) => {
      const object = this.get(part); return object ? [[part.id ?? String(i), { ...object.state }]] : [];
    }));
  }
}
