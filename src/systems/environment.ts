import { Vec2, testOverlap, type BodyType, type Fixture, type World } from 'planck';
import type { Entity, Part } from '../simulation';
import type { SourceComponent, SourceNode } from '../prefabs';
import { extinguish, getHeatCapacity, ignite, type PhysicalObject } from './physical';
import type { RagdollSystem } from './ragdoll';

type Data = Record<string, unknown>;
const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const num = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const flag = (value: unknown): boolean => value === true || value === 1;
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const lerp = (a: number, b: number, factor: number) => a + (b - a) * clamp(factor);
const pointer = (value: unknown) => String(record(value).m_PathID ?? '');
const components = (part: Part) => part.metadata?.components ?? [];
const source = (part: Part, name: string) => components(part).find(c => c.className === name);

export interface EnvironmentSettings {
  gravity: number; ambientTemperature: number; floodlights: boolean;
  rain: boolean; snow: boolean; fog: boolean; lightningChance: number;
}
export const DEFAULT_ENVIRONMENT: Readonly<EnvironmentSettings> = {
  gravity: -9.81, ambientTemperature: 18, floodlights: true,
  rain: false, snow: false, fog: false, lightningChance: 0,
};
export type WaterPhase = 'liquid' | 'boiling' | 'frozen' | 'evaporated';
export interface FluidState { underwater: boolean; inLava: boolean; submergedFraction: number; surfaceLevel?: number }
export interface FluidVolume {
  id: string; kind: 'water' | 'lava'; entity: Entity; node: SourceNode;
  component: SourceComponent; fixtures: Fixture[]; phase: WaterPhase;
  ignoredEntities: Set<number>; frozenParts: Set<Part>;
}
export interface EnvironmentOptions {
  getPhysical: (part: Part) => PhysicalObject | undefined;
  ragdolls?: Pick<RagdollSystem, 'limbFor' | 'damage'>;
  random?: () => number;
  onSettings?: (settings: Readonly<EnvironmentSettings>) => void;
  onSplash?: (volume: FluidVolume, part: Part, entering: boolean) => void;
  onSizzle?: (part: Part) => void;
  onVolumeState?: (volume: FluidVolume, phase: WaterPhase) => void;
  /** Cosmetic weather uses the source MapConfig exponential fade. */
  onWeather?: (density: Readonly<{ rain: number; snow: number; fog: number }>) => void;
}

/** WaterBehaviour/LavaBehaviour/MapConfig adaptation, one call per 0.02s step.
 * Baked collider samples and serialized coefficients come from the local game.
 * Planck overlap/force application replaces Unity's native Physics2D calls.
 */
export class EnvironmentSystem {
  settings: EnvironmentSettings = { ...DEFAULT_ENVIRONMENT };
  readonly volumes: FluidVolume[] = [];
  readonly unsupportedVolumes: string[] = [];
  private entities = new Set<Entity>();
  private owners = new Map<Part, Entity>();
  private states = new Map<Part, FluidState>();
  private samples = new Map<Part, { x: number; y: number }[]>();
  private frozen = new Map<Part, { type: BodyType; volumes: Set<string> }>();
  private lastLavaSplash = new Map<string, number>();
  private time = 0;
  private weather = { rain: 0, snow: 0, fog: 0 };
  constructor(readonly world: World, readonly options: EnvironmentOptions) {}

  attach(entity: Entity): void {
    if (this.entities.has(entity)) return;
    this.entities.add(entity);
    for (const part of entity.parts) {
      this.owners.set(part, entity);
      this.states.set(part, { underwater: false, inLava: false, submergedFraction: 0 });
    }
    for (const node of entity.metadata?.nodes ?? []) {
      if (!node.active) continue;
      for (const component of node.components) {
        if (component.className === 'MapConfig') this.applySourceSettings(record(component.data.Settings));
        if (component.className !== 'WaterBehaviour' && component.className !== 'LavaBehaviour') continue;
        if (component.data.m_Enabled !== undefined && !flag(component.data.m_Enabled)) continue;
        const trigger = pointer(component.data.Trigger);
        const owner = entity.parts.find(p => components(p).some(c => c.pathId === trigger))
          ?? entity.parts.find(p => p.metadata?.nodeId === node.id)
          ?? entity.parts.find(p => p.id === (node as SourceNode & { bodyId?: string }).bodyId);
        const fixtures: Fixture[] = [];
        for (let fixture = owner?.body.getFixtureList(); fixture; fixture = fixture.getNext()) fixtures.push(fixture);
        const tagged = fixtures.filter(f => record(f.getUserData()).sourceNodeId === node.id);
        const sensors = fixtures.filter(f => f.isSensor());
        const center = Vec2((entity.position?.x ?? 0) + node.position.x, (entity.position?.y ?? 0) + node.position.y);
        const located = sensors.filter(f => f.testPoint(center));
        const selectedFixtures = tagged.length ? tagged : located.length ? located : sensors.length ? sensors : fixtures;
        const volume: FluidVolume = { id: `${entity.id}:${component.pathId}`, entity, node, component,
          kind: component.className === 'WaterBehaviour' ? 'water' : 'lava', fixtures: selectedFixtures,
          phase: 'liquid', ignoredEntities: new Set(), frozenParts: new Set() };
        if (!selectedFixtures.length) this.unsupportedVolumes.push(`${volume.id}: no source trigger fixtures`);
        this.volumes.push(volume);
        this.updatePhase(volume, true);
      }
    }
  }

  remove(entity: Entity): void {
    for (const volume of this.volumes.filter(v => v.entity === entity)) {
      this.releaseIce(volume);
      this.lastLavaSplash.delete(volume.id);
      this.volumes.splice(this.volumes.indexOf(volume), 1);
    }
    for (const part of entity.parts) {
      this.owners.delete(part); this.states.delete(part); this.samples.delete(part);
      this.frozen.delete(part);
      for (const volume of this.volumes) volume.frozenParts.delete(part);
    }
    this.entities.delete(entity);
  }
  stateFor(part: Part): Readonly<FluidState> | undefined { return this.states.get(part); }
  ignoreObject(volumeId: string, entity: Entity): void { this.volumes.find(v => v.id === volumeId)?.ignoredEntities.add(entity.id); }
  stopIgnoringObject(volumeId: string, entity: Entity): void { this.volumes.find(v => v.id === volumeId)?.ignoredEntities.delete(entity.id); }
  isPointUnderWater(point: { x: number; y: number }): boolean {
    return this.volumes.some(v => v.kind === 'water' && (v.phase === 'liquid' || v.phase === 'boiling') && this.contains(v, point));
  }
  isPointInLava(point: { x: number; y: number }): boolean { return this.volumes.some(v => v.kind === 'lava' && this.contains(v, point)); }

  applySettings(settings: Partial<EnvironmentSettings>): void {
    for (const key of ['gravity', 'ambientTemperature', 'lightningChance'] as const)
      if (typeof settings[key] === 'number' && Number.isFinite(settings[key])) this.settings[key] = settings[key]!;
    for (const key of ['floodlights', 'rain', 'snow', 'fog'] as const)
      if (typeof settings[key] === 'boolean') this.settings[key] = settings[key]!;
    this.world.setGravity(Vec2(0, this.settings.gravity));
    this.options.onSettings?.(this.settings);
    for (const volume of this.volumes) this.updatePhase(volume);
  }
  private applySourceSettings(data: Data): void {
    this.applySettings({ gravity: num(data.Gravity, -9.81), ambientTemperature: num(data.Ambient_temperature, 18),
      floodlights: data.Floodlights === undefined ? true : flag(data.Floodlights), rain: flag(data.Rain), snow: flag(data.Snow),
      fog: flag(data.Fog), lightningChance: num(data.Lightning_chance) });
  }
  snapshot(entity: Entity): { settings: EnvironmentSettings } | undefined {
    return entity.metadata?.nodes.some(n => n.components.some(c => c.className === 'MapConfig')) ? { settings: { ...this.settings } } : undefined;
  }
  restore(entity: Entity, value: unknown): boolean {
    if (!this.entities.has(entity)) return false;
    const settings = record(record(value).settings);
    return this.restoreSettings(settings);
  }
  captureSettings(): EnvironmentSettings { return { ...this.settings }; }
  restoreSettings(value: unknown): boolean {
    const settings = record(value);
    if (['gravity', 'ambientTemperature', 'lightningChance'].some(key => typeof settings[key] !== 'number' || !Number.isFinite(settings[key]))) return false;
    if (['floodlights', 'rain', 'snow', 'fog'].some(key => typeof settings[key] !== 'boolean')) return false;
    this.applySettings(settings as unknown as EnvironmentSettings); return true;
  }
  frame(dt: number): void {
    // Utils.GetLerpFactorDeltaTime(.7, dt) = 1 - Pow(1-.7, dt).
    const factor = 1 - Math.pow(.3, Math.max(0, dt));
    for (const key of ['rain', 'snow', 'fog'] as const) this.weather[key] = lerp(this.weather[key], this.settings[key] ? 1 : 0, factor);
    this.options.onWeather?.(this.weather);
  }

  private phase(volume: FluidVolume): WaterPhase {
    if (volume.kind === 'lava') return 'liquid';
    const c = volume.component.data, ambient = this.settings.ambientTemperature;
    const boiling = num(c.BoilingPointCelsius, 100);
    if (ambient < num(c.FreezingPointCelsius)) return 'frozen';
    if (ambient > boiling + 100) return 'evaporated';
    return ambient >= boiling ? 'boiling' : 'liquid';
  }
  private updatePhase(volume: FluidVolume, initial = false): void {
    const phase = this.phase(volume);
    if (!initial && phase === volume.phase) return;
    if (phase !== 'frozen') this.releaseIce(volume);
    volume.phase = phase;
    if (phase === 'frozen') {
      for (const [part, owner] of this.owners) if (!owner.frozen && part.body.isDynamic() && !volume.ignoredEntities.has(owner.id)) {
        const points = this.worldSamples(part);
        if (points.length && points.filter(p => this.contains(volume, p)).length / points.length >= .05) this.freezeInIce(volume, part);
      }
    }
    this.setWaterVisuals(volume);
    this.options.onVolumeState?.(volume, phase);
  }
  private setWaterVisuals(volume: FluidVolume): void {
    if (volume.kind !== 'water') return;
    const visible = volume.phase === 'liquid' || volume.phase === 'boiling';
    for (const renderer of volume.entity.renderers ?? []) if (renderer.nodeId === volume.node.id) renderer.enabled = volume.phase !== 'evaporated';
    const config = volume.component.data;
    const waterIds = Array.isArray(config.ObjectsToBeActiveIfWater) ? config.ObjectsToBeActiveIfWater.map(pointer) : [];
    for (const nodeId of waterIds) this.setNodeActive(volume.entity, nodeId, visible);
    const iceId = pointer(config.Ice), boilingId = pointer(config.BoilingWaterSound);
    const iceNode = volume.entity.metadata?.nodes.find(n => n.components.some(c => c.pathId === iceId));
    if (iceNode) this.setNodeActive(volume.entity, iceNode.id, volume.phase === 'frozen');
    if (boilingId) this.setNodeActive(volume.entity, boilingId, volume.phase === 'boiling');
  }
  private setNodeActive(entity: Entity, id: string, active: boolean): void {
    const ids = new Set([id]);
    for (const node of entity.metadata?.nodes ?? []) if (node.parentId && ids.has(node.parentId)) ids.add(node.id);
    for (const node of entity.metadata?.nodes ?? []) if (ids.has(node.id)) node.active = active;
    for (const part of entity.parts) if (ids.has(part.metadata?.nodeId ?? '')) part.body.setActive(active);
    for (const renderer of entity.renderers ?? []) if (ids.has(renderer.nodeId ?? '')) renderer.enabled = active;
  }
  private freezeInIce(volume: FluidVolume, part: Part): void {
    let state = this.frozen.get(part);
    if (!state) { state = { type: part.body.getType(), volumes: new Set() }; this.frozen.set(part, state); }
    state.volumes.add(volume.id); volume.frozenParts.add(part);
    part.body.setLinearVelocity(Vec2()); part.body.setAngularVelocity(0); part.body.setType('static');
    const physical = this.options.getPhysical(part);
    if (physical) physical.state.temperature = Math.min(physical.state.temperature, this.settings.ambientTemperature);
  }
  private releasePart(volume: FluidVolume, part: Part): void {
    volume.frozenParts.delete(part);
    const state = this.frozen.get(part);
    if (!state) return;
    state.volumes.delete(volume.id);
    if (!state.volumes.size) {
      if (!this.owners.get(part)?.frozen) part.body.setType(state.type);
      this.frozen.delete(part);
    }
  }
  private releaseIce(volume: FluidVolume): void { for (const part of [...volume.frozenParts]) this.releasePart(volume, part); }
  private contains(volume: FluidVolume, point: { x: number; y: number }): boolean {
    return volume.fixtures.some(f => f.getBody().isActive() && f.testPoint(point));
  }
  private worldSamples(part: Part): { x: number; y: number }[] {
    let points = this.samples.get(part);
    if (!points) {
      const physical = source(part, 'PhysicalBehaviour')?.data;
      const baked = physical?.LocalColliderGridPoints;
      const owner = this.owners.get(part), node = owner?.metadata?.nodes.find(n => n.id === part.metadata?.nodeId);
      const scale = node?.scale ?? { x: 1, y: 1 };
      points = Array.isArray(baked) && baked.length ? baked.map(record).map(p => ({ x: num(p.x) * scale.x, y: num(p.y) * scale.y }))
        : [{ x: -part.width / 2, y: -part.height / 2 }, { x: part.width / 2, y: -part.height / 2 },
          { x: part.width / 2, y: part.height / 2 }, { x: -part.width / 2, y: part.height / 2 }, { x: 0, y: 0 }];
      this.samples.set(part, points);
    }
    return points.map(p => part.body.getWorldPoint(p));
  }
  private overlaps(volume: FluidVolume, part: Part): boolean {
    const filter = record(volume.component.data.ContactFilter);
    if (flag(filter.useLayerMask)) {
      const owner = this.owners.get(part), node = owner?.metadata?.nodes.find(n => n.id === part.metadata?.nodeId);
      const layer = num((node as SourceNode & { layer?: number } | undefined)?.layer, 9);
      if (!(num(record(filter.layerMask).m_Bits, -1) & (1 << layer))) return false;
    }
    for (let f = part.body.getFixtureList(); f; f = f.getNext()) {
      if (f.isSensor()) continue;
      for (const trigger of volume.fixtures) {
        if (!trigger.getBody().isActive()) continue;
        const a = f.getShape(), b = trigger.getShape();
        for (let ai = 0; ai < a.getChildCount(); ai++) for (let bi = 0; bi < b.getChildCount(); bi++)
          if (testOverlap(a, ai, b, bi, part.body.getTransform(), trigger.getBody().getTransform())) return true;
      }
    }
    return false;
  }

  beforeStep(dt: number): void {
    this.time += Math.max(0, dt);
    const previous = new Map([...this.states].map(([p, s]) => [p, { ...s }]));
    for (const state of this.states.values()) { state.underwater = false; state.inLava = false; state.submergedFraction = 0; }
    for (const volume of this.volumes) {
      this.updatePhase(volume);
      if (volume.kind === 'water' && volume.phase === 'frozen') {
        const iceId = pointer(volume.component.data.Ice);
        const icePart = volume.entity.parts.find(p => components(p).some(c => c.pathId === iceId));
        const ice = icePart ? this.options.getPhysical(icePart) : undefined;
        if (ice) ice.state.temperature = this.settings.ambientTemperature;
        for (const part of [...volume.frozenParts]) {
          if (!this.worldSamples(part).some(p => this.contains(volume, p))) { this.releasePart(volume, part); continue; }
          const physical = this.options.getPhysical(part);
          if (physical) { if (physical.state.onFire) extinguish(physical); physical.state.wetness = 1; }
        }
        continue;
      }
      if (volume.phase === 'evaporated') continue;
      for (const [part, owner] of this.owners) {
        if (!part.body.isActive() || volume.ignoredEntities.has(owner.id) || volume.fixtures.some(f => f.getBody() === part.body)) continue;
        const physical = this.options.getPhysical(part);
        if (!physical) continue;
        const points = this.worldSamples(part);
        const submerged = points.filter(p => this.contains(volume, p));
        if (volume.kind === 'water') {
          if (submerged.length) this.water(volume, part, physical, submerged, points.length, previous.get(part));
        } else if (part.body.isDynamic() && this.overlaps(volume, part)) this.lava(volume, part, physical, submerged, points.length, previous.get(part));
      }
    }
    for (const [part, state] of this.states) {
      const prior = previous.get(part);
      if (prior?.underwater && !state.underwater) {
        const water = this.volumes.find(v => v.kind === 'water' && (v.phase === 'liquid' || v.phase === 'boiling'));
        if (water && Math.abs(part.body.getLinearVelocity().y) >= .75) this.options.onSplash?.(water, part, false);
      }
      if (prior?.inLava && !state.inLava) {
        const lava = this.volumes.find(v => v.kind === 'lava');
        if (lava && (this.time - (this.lastLavaSplash.get(lava.id) ?? -Infinity) > .25 || (this.options.random ?? Math.random)() > .9)) {
          this.lastLavaSplash.set(lava.id, this.time); this.options.onSplash?.(lava, part, false);
        }
      }
    }
  }
  private water(volume: FluidVolume, part: Part, physical: PhysicalObject, submerged: { x: number; y: number }[], total: number, previous?: FluidState): void {
    const data = volume.component.data;
    const physicalComponent = source(part, 'PhysicalBehaviour');
    const properties = record((physicalComponent as SourceComponent & { properties?: { data: Data } } | undefined)?.properties?.data);
    const body = part.body, mass = body.getMass();
    const surfacePart = volume.entity.parts.find(p => p.metadata?.nodeId === volume.node.id);
    const entityAngle = volume.entity.angle ?? 0;
    const surface = surfacePart ? surfacePart.body.getWorldPoint(Vec2(0, num(data.LocalSurfaceLevel) * volume.node.scale.y)).y
      : (volume.entity.position?.y ?? 0) + Math.sin(entityAngle) * volume.node.position.x + Math.cos(entityAngle) * volume.node.position.y
        + Math.cos(entityAngle + volume.node.angle) * num(data.LocalSurfaceLevel) * volume.node.scale.y;
    const depth = clamp(Math.abs(body.getPosition().y - surface) ** .25, 1, 8);
    const dragDepth = clamp((depth - 1) / 7) + 1;
    const buoyancy = mass / total * depth * num(properties.Buoyancy, 0) * num(physicalComponent?.data.BuoyancyModifier, 1) * num(data.Buoyancy);
    for (const point of submerged) {
      if (volume.phase !== 'boiling') body.applyForce(Vec2(0, buoyancy), point, true);
      const velocity = body.getLinearVelocityFromWorldPoint(point);
      const dragPower = velocity.lengthSquared() * .2;
      const drag = clamp(Math.pow(dragPower + 1, dragPower * num(data.Drag)), .6, 1);
      body.applyForce(Vec2(-velocity.x * .4 * dragDepth * drag * mass, -velocity.y * .4 * dragDepth * drag * mass), point, true);
    }
    const state = this.states.get(part)!;
    state.underwater = true; state.surfaceLevel = surface; state.submergedFraction = Math.max(state.submergedFraction, submerged.length / total);
    if (volume.phase === 'boiling') {
      physical.state.burnProgress = Math.max(physical.state.burnProgress, .5);
      const limb = this.options.ragdolls?.limbFor(part);
      if (limb) limb.person.pain += 15;
    }
    const temperature = Math.min(this.settings.ambientTemperature, num(data.BoilingPointCelsius, 100));
    physical.state.temperature = lerp(physical.state.temperature, temperature, .05 * physical.properties.HeatTransferSpeedMultiplier);
    if (!previous?.underwater && physical.state.temperature >= 100 && physical.state.temperature > temperature * 2) this.options.onSizzle?.(part);
    physical.state.wetness += .1;
    const speed = body.getLinearVelocity().length();
    const limb = this.options.ragdolls?.limbFor(part);
    if (limb && speed > 30 && !flag(limb.config.ImmuneToDamage)) {
      this.options.ragdolls?.damage(part, speed * .09, 'water impact');
      if (!flag(limb.config.IsAndroid)) limb.acidProgress = Math.min(limb.acidProgress + speed * .05, .6);
    }
    if (!previous?.underwater && Math.abs(body.getLinearVelocity().y) >= .75) this.options.onSplash?.(volume, part, true);
  }
  private lava(volume: FluidVolume, part: Part, physical: PhysicalObject, submerged: { x: number; y: number }[], total: number, previous?: FluidState): void {
    const body = part.body, config = volume.component.data, mass = body.getMass();
    for (const point of submerged) {
      const velocity = body.getLinearVelocityFromWorldPoint(point), damping = num(config.Dampening, .05) * clamp(mass);
      body.applyForce(Vec2(-velocity.x * damping, -velocity.y * damping), point, true);
      const factor = .995 * clamp(mass ** .1, .8, 1);
      body.setLinearVelocity(body.getLinearVelocity().clone().mul(factor)); body.setAngularVelocity(body.getAngularVelocity() * factor);
      const buoyancy = num(config.Buoyancy, .05);
      if (buoyancy > Number.EPSILON) body.applyForce(Vec2.mul(this.world.getGravity(), -buoyancy * mass / total), point, true);
    }
    if (submerged.length === total) { body.setLinearVelocity(body.getLinearVelocity().clone().mul(.95)); body.setAngularVelocity(body.getAngularVelocity() * .95); }
    const state = this.states.get(part)!;
    state.inLava = true; state.submergedFraction = Math.max(state.submergedFraction, submerged.length / total);
    if (!previous?.inLava && (this.time - (this.lastLavaSplash.get(volume.id) ?? -Infinity) > .25 || (this.options.random ?? Math.random)() > .9)) {
      this.lastLavaSplash.set(volume.id, this.time); this.options.onSplash?.(volume, part, true);
    }
    if (physical.settings.SimulateTemperature) {
      ignite(physical, (this.options.random ?? Math.random)());
      // Original CIL divides two Int32 counts before converting to float: any
      // sampled immersion yields 1, including partial immersion.
      const heatFraction = 1 - Math.trunc((total - submerged.length) / total);
      physical.state.temperature = lerp(physical.state.temperature, num(config.LavaTemperature, 975), num(config.TransferRate, .01) / getHeatCapacity(physical) * heatFraction);
    }
  }
}
