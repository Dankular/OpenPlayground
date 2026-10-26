import { DistanceJoint, RopeJoint, WeldJoint, Vec2, type Joint, type World } from 'planck';
import type { Entity, Part } from '../simulation';
import { PhysicalSystem, sourceComponent,physicalMass } from './physical-world';
import { averageTemperature, getCharge, type PhysicalObject } from './physical';
import { averagePressure,LIQUIDS, type LiquidReservoir, type LiquidColor } from './liquids';
import type { LimbState } from './ragdoll';
import {targetsPart} from './targeting';

export type WireKind = 'energy' | 'copper' | 'heat' | 'activation' | 'rope' | 'cable' | 'blood' | 'rigid' | 'fixed' | 'spring' | 'strong-spring' | 'chain' | 'bandage';
export interface WireEndpoint { entity: Entity | null; part: Part | null; anchor: { x: number; y: number } }
export interface Wire {
  id: number; kind: WireKind; a: WireEndpoint; b: WireEndpoint; joint: Joint;
  length: number; channel: 0 | 1 | 2; breakForce: number; cableTemperature: number; lastSignalTime: number;
  flow: number; liquidColor: LiquidColor;
  soakAmount:number;
}
interface Signal { remaining: number; wire: Wire; visited: Set<Entity>; traversed: number; channel: 0 | 1 | 2; continuous: boolean }
interface SavedEndpoint { entity: number; part: string; anchor: { x: number; y: number } }
export interface SavedWire { kind: WireKind; a: SavedEndpoint; b: SavedEndpoint; length: number; channel: 0 | 1 | 2; breakForce: number | null; cableTemperature: number;soakAmount?:number }
const kinds: readonly WireKind[] = ['energy', 'copper', 'heat', 'activation', 'rope', 'cable', 'blood','rigid','fixed','spring','strong-spring','chain','bandage'];
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Utils.TransferEnergyFixedRate transfers charge without conserving it. */
export function transferWireEnergy(a: PhysicalObject, b: PhysicalObject, rate = .89): void {
  const ac = getCharge(a) * a.settings.EnergyWireResistance, bc = getCharge(b) * b.settings.EnergyWireResistance;
  if (ac > bc) b.state.charge += (ac - b.state.charge) * clamp01(rate);
  else a.state.charge += (bc - a.state.charge) * clamp01(rate);
}
export function cableBreakForce(base: number, massA: number, massB: number, referenceMass = 1, influence = .5): number {
  return base * (1 + (Math.max(massA, massB) / referenceMass - 1) * clamp01(influence));
}

/** Source wire sag shape; native LineRenderer materials remain separate. */
export function wireVertices(wire: Wire): Vec2[] {
  const a = wire.a.part ? wire.a.part.body.getWorldPoint(wire.a.anchor) : Vec2(wire.a.anchor), b = wire.b.part ? wire.b.part.body.getWorldPoint(wire.b.anchor) : Vec2(wire.b.anchor);
  if (['heat','rigid','fixed','spring','strong-spring','bandage'].includes(wire.kind)) return [a, b];
  const sag = Math.pow(Math.max(0, 1 - Vec2.distanceSquared(a, b) / Math.max(1e-12, wire.length ** 2)), .65) * wire.length / 2;
  const vertices = Array.from({ length: 13 }, (_, i) => {
    const t = i / 12;
    return Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + (Math.cosh(2 * t * 1.316958 - 1.316958) - 2) * sag);
  });
  vertices[0] = a; vertices[12] = b; return vertices;
}

export class WireSystem {
  readonly wires = new Map<number, Wire>();
  private signals: Signal[] = [];
  private nextId = 1;
  private time = 0;
  private anchorBody: ReturnType<World['createBody']> | null = null;
  private activationByEntity=new Map<Entity,Set<Wire>>();
  constructor(readonly world: World, readonly physical: PhysicalSystem, readonly options: {
    onUse?: (entity: Entity, channel: 0 | 1 | 2, continuous: boolean, part: Part) => void;
    onBreak?: (wire: Wire) => void;
    getContainer?: (part: Part) => LiquidReservoir | undefined;
    getLimb?: (part: Part) => LimbState | undefined;
  } = {}) {}
  connect(kind: WireKind, a: WireEndpoint, b: WireEndpoint, options: { length?: number; channel?: 0 | 1 | 2; breakForce?: number;breakable?:boolean } = {}): Wire {
    if (!kinds.includes(kind) || !a.part && !b.part || a.part && b.part && a.part.body === b.part.body || a.part && a.part.body.getWorld() !== this.world || b.part && b.part.body.getWorld() !== this.world)
      throw new Error('Wire endpoints must be different bodies in this scene');
    if (kind === 'activation' && (!a.part || !b.part)) throw new Error('Activation wires require two objects');
    for (const end of [a, b]) if (end.part ? !end.entity?.parts.includes(end.part) : end.entity !== null) throw new Error('Wire endpoint does not belong to its object');
    // DistanceWireTool reverses a world-to-body gesture so the joint belongs to
    // the body, with its connectedAnchor in world coordinates.
    if (!a.part) [a, b] = [b, a];
    const coordinates = [a.anchor.x, a.anchor.y, b.anchor.x, b.anchor.y];
    if (coordinates.some(x => !Number.isFinite(x)||Math.abs(x)>1e7)) throw new Error('Invalid wire anchor');
    const point = (end: WireEndpoint) => end.part ? end.part.body.getWorldPoint(end.anchor) : Vec2(end.anchor);
    const length = options.length ?? Vec2.distance(point(a), point(b));
    if (!Number.isFinite(length) || length <= 0||length>1e7) throw new Error('Invalid wire length');
    const channel = options.channel ?? 0;
    if (![0, 1, 2].includes(channel)) throw new Error('Invalid activation channel');
    const massA = physicalMass(a.part!), massB = b.part?physicalMass(b.part):massA;
    const baseBreak = kind === 'copper' ? cableBreakForce(250, massA, massB) : kind === 'rope' ? cableBreakForce(350, massA, massB) : kind==='activation'&&options.breakable?cableBreakForce(850,massA,massB):Infinity;
    const breakForce = options.breakForce ?? baseBreak;
    if (Number.isNaN(breakForce) || breakForce < 0) throw new Error('Invalid wire breaking force');
    if (!b.part && !this.anchorBody) this.anchorBody = this.world.createBody();
    const common = { bodyA: a.part!.body, bodyB: b.part?.body ?? this.anchorBody!, localAnchorA: Vec2(a.anchor), localAnchorB: Vec2(b.anchor), collideConnected: true };
    const spring=kind==='spring'||kind==='strong-spring'||kind==='bandage';
    const joint = this.world.createJoint(kind==='fixed'?new WeldJoint({...common,localAnchorB:common.bodyB.getLocalPoint(point(a)),referenceAngle:common.bodyB.getAngle()-common.bodyA.getAngle(),frequencyHz:0,dampingRatio:0}):kind === 'heat'||kind==='rigid'||spring ? new DistanceJoint({ ...common, length,frequencyHz:spring?(kind==='bandage'?3:kind==='strong-spring'?8:2):0,dampingRatio:kind==='bandage'?.2:0 }) : new RopeJoint({ ...common, maxLength: length }));
    if (!joint) throw new Error('Could not create wire joint');
    const wire: Wire = { id: this.nextId++, kind, a, b, joint, length, channel, breakForce, cableTemperature: 0, lastSignalTime: -Infinity,flow:0,liquidColor:{r:0,g:0,b:0,a:0},soakAmount:0 };
    if(kind==='bandage'){const limb=this.options.getLimb?.(a.part!);if(limb&&limb.config.SpeciesIdentity!=='Android')limb.person.adrenaline+=.25;}
    this.wires.set(wire.id, wire);
    if(kind==='activation'&&a.entity){let outgoing=this.activationByEntity.get(a.entity);if(!outgoing){outgoing=new Set();this.activationByEntity.set(a.entity,outgoing);}outgoing.add(wire);}
    return wire;
  }
  disconnect(wire: Wire, broken = false): void {
    if (!this.wires.delete(wire.id)) return;
    if(wire.a.entity){const outgoing=this.activationByEntity.get(wire.a.entity);outgoing?.delete(wire);if(!outgoing?.size)this.activationByEntity.delete(wire.a.entity);}
    this.world.destroyJoint(wire.joint); this.signals = this.signals.filter(signal => signal.wire !== wire);
    if(this.anchorBody&&![...this.wires.values()].some(w=>!w.b.part)){this.world.destroyBody(this.anchorBody);this.anchorBody=null;}
    if (broken) this.options.onBreak?.(wire);
  }
  remove(entity: Entity): void {
    for (const wire of [...this.wires.values()]) if (wire.a.entity === entity || wire.b.entity === entity) this.disconnect(wire);
  }
  removeParts(parts:readonly Part[]):void {const bodies=new Set(parts);for(const wire of [...this.wires.values()])if(wire.a.part&&bodies.has(wire.a.part)||wire.b.part&&bodies.has(wire.b.part))this.disconnect(wire);}
  clear(): void { for (const wire of [...this.wires.values()]) this.disconnect(wire); }
  slice(wire: Wire): void { wire.breakForce = 0; }
  /** Direct user input selects each wire's own channel, as ValidateSignal does. */
  activate(entity: Entity, channel: 0 | 1 | 2 = 0, continuous = false,sourcePart?:Part): void {
    this.propagate(entity, channel, new Set(), 1, true, continuous,sourcePart);
  }
  private propagate(entity: Entity, channel: 0 | 1 | 2, visited: Set<Entity>, traversed: number, direct: boolean, continuous: boolean,sourcePart?:Part): void {
    for (const wire of this.activationByEntity.get(entity)??[]) {
      if (wire.kind !== 'activation' || !wire.a.part || !wire.b.entity || wire.a.entity !== entity || (!direct && wire.channel !== channel)) continue;
      if(!targetsPart(entity,wire.a.part,sourcePart))continue;
      const config = sourceComponent(wire.a.part, 'PhysicalBehaviour')?.data;
      const delay = typeof config?.ActivationPropagationDelay === 'number' ? config.ActivationPropagationDelay : .1;
      if (delay < 0 || (direct && (config?.SendUserPropagation === 0 || config?.SendUserPropagation === false)) || visited.has(wire.b.entity)) continue;
      if (traversed > 10000 || this.signals.length >= 10000) continue;
      const branch = new Set(visited); branch.add(entity);
      this.signals.push({ remaining: delay, wire, visited: branch, traversed: traversed + 1, channel: direct ? wire.channel : channel, continuous });
    }
  }
  private tickBlood(wire: Wire,dt: number): void {
    const a=wire.a.part&&this.options.getContainer?.(wire.a.part),b=wire.b.part&&this.options.getContainer?.(wire.b.part);
    if(a&&b){
      if(a.enabled&&b.enabled&&a.allowsTransfer&&b.allowsTransfer){
        const from=a.measuredPressure>b.measuredPressure?a:b.measuredPressure>a.measuredPressure?b:undefined;
        const to=from===a?b:a,rate=dt*2;
        if(from&&from.total>from.lower&&to.total<to.upper&&from.transferTo(rate,to)>Number.EPSILON){
          from.deleteEmptyEntries();to.deleteEmptyEntries();
          wire.flow+=((from===a?1:-1)-wire.flow)*clamp01(rate);
          const color=from.computedColor;for(const key of ['r','g','b','a'] as const)wire.liquidColor[key]+=(color[key]-wire.liquidColor[key])*clamp01(rate);
        }
      }
      averagePressure(dt,a,b);
      const limbA=wire.a.part&&this.options.getLimb?.(wire.a.part),limbB=wire.b.part&&this.options.getLimb?.(wire.b.part);
      if(limbA&&limbB&&limbA.config.SpeciesIdentity!=='Android'&&limbB.config.SpeciesIdentity!=='Android'&&a.allowPressureTransfer&&b.allowPressureTransfer){
        const average=(limbA.bloodFlow+limbB.bloodFlow)*.5;
        limbA.bloodFlow+=(average-limbA.bloodFlow)*clamp01(dt);limbB.bloodFlow+=(average-limbB.bloodFlow)*clamp01(dt);
      }
      if(limbA&&a.originalBlood)limbA.blood=a.getAmount(a.originalBlood);
      if(limbB&&b.originalBlood)limbB.blood=b.getAmount(b.originalBlood);
    }
    wire.flow*=.9;for(const key of ['r','g','b','a'] as const)wire.liquidColor[key]*=.9;
  }
  beforeStep(dt: number): void {
    this.time += dt;
    for (const wire of this.wires.values()) {
      if(wire.kind==='blood')this.tickBlood(wire,dt);
      if(wire.kind==='bandage'){
        const limb=this.options.getLimb?.(wire.a.part!);
        if(limb&&limb.config.SpeciesIdentity!=='Android'){
          limb.bleedingRate*=.9;limb.health+=(limb.initialHealth-limb.health)*.001;
          wire.soakAmount=Math.max(wire.soakAmount,clamp01(wire.soakAmount+dt*limb.bleedingRate*.5));
          const c=this.options.getContainer?.(wire.a.part!);const native=c?.originalBlood;
          const color=native?LIQUIDS.get(native)?.color:undefined;
          if(color)for(const key of ['r','g','b','a'] as const)wire.liquidColor[key]=1+(color[key]-1)*wire.soakAmount*.7;
        }
      }
      const a = wire.a.part ? this.physical.get(wire.a.part) : undefined, b = wire.b.part ? this.physical.get(wire.b.part) : undefined;
      if (a && b) {
        if (wire.kind === 'energy' || wire.kind === 'copper') transferWireEnergy(a, b);
        if (wire.kind === 'heat') {
          if (a.settings.SimulateTemperature && b.settings.SimulateTemperature) { averageTemperature(a, b, .2); wire.cableTemperature = (a.state.temperature + b.state.temperature) / 2; }
          wire.cableTemperature += (this.physical.ambientTemperature - wire.cableTemperature) * .2;
        }
      }
    }
    // Only queued signals present at tick start advance this tick. Native
    // coroutines defer freshly branched signals instead of flooding immediately.
    const pending = this.signals; this.signals = [];
    for (const signal of pending) {
      if (!this.wires.has(signal.wire.id)) continue;
      signal.remaining -= dt;
      if (signal.remaining > 1e-10) { this.signals.push(signal); continue; }
      const target = signal.wire.b.entity;
      if (!target || !signal.wire.b.part) continue;
      if (signal.visited.has(target)) continue;
      signal.wire.lastSignalTime = this.time;
      this.options.onUse?.(target, signal.channel, signal.continuous, signal.wire.b.part);
      this.propagate(target, signal.channel, signal.visited, signal.traversed, false, signal.continuous,signal.wire.b.part);
    }
  }
  afterStep(dt: number): void {
    for (const wire of [...this.wires.values()]) {
      const a = wire.a.part ? this.physical.get(wire.a.part) : undefined, b = wire.b.part ? this.physical.get(wire.b.part) : undefined;
      const burn = Math.max(a?.state.burnProgress ?? 0, b?.state.burnProgress ?? 0);
      const threshold = wire.kind === 'copper' || wire.kind === 'rope' || wire.kind === 'activation' && Number.isFinite(wire.breakForce) ? wire.breakForce * (1 - burn) : wire.breakForce;
      if (threshold <= 0) { this.disconnect(wire, true); continue; }
      const bodyA = wire.a.part!.body, bodyB = wire.b.part?.body ?? this.anchorBody!;
      if (!Number.isFinite(threshold) || !bodyA.isActive() || !bodyB.isActive() || !bodyA.isDynamic() && !bodyB.isDynamic()) continue;
      const force = wire.joint.getReactionForce(1 / dt);
      if (Math.hypot(force.x, force.y) > threshold) this.disconnect(wire, true);
    }
  }
  snapshot(entities: readonly Entity[]): SavedWire[] {
    const endpoint = (end: WireEndpoint): SavedEndpoint => end.entity && end.part ? ({ entity: entities.indexOf(end.entity), part: end.part.id ?? `index:${end.entity.parts.indexOf(end.part)}`, anchor: { ...end.anchor } }) : ({ entity: -1, part: 'world', anchor: { ...end.anchor } });
    return [...this.wires.values()].filter(w => (!w.a.entity || entities.includes(w.a.entity)) && (!w.b.entity || entities.includes(w.b.entity))).map(w => ({ kind: w.kind, a: endpoint(w.a), b: endpoint(w.b), length: w.length, channel: w.channel, breakForce: Number.isFinite(w.breakForce) ? w.breakForce : null, cableTemperature: w.cableTemperature,...(w.kind==='bandage'?{soakAmount:w.soakAmount}:{}) }));
  }
  /** Adds staged connections; on failure removes only the newly created wires. */
  restore(value: unknown, entities: readonly Entity[]): boolean {
    if (!Array.isArray(value) || value.length > 10000) return false;
    const endpoint = (end: SavedEndpoint): WireEndpoint => {
      if (!end || !Number.isSafeInteger(end.entity) || typeof end.part !== 'string' || !end.anchor || !Number.isFinite(end.anchor.x) || !Number.isFinite(end.anchor.y)) throw new Error('Invalid wire endpoint');
      if (end.entity === -1 && end.part === 'world') return { entity: null, part: null, anchor: end.anchor };
      if (end.entity < 0) throw new Error('Invalid wire endpoint');
      const entity = entities[end.entity]; if (!entity) throw new Error('Unknown connected object');
      const part = end.part.startsWith('index:') ? entity.parts[Number(end.part.slice(6))] : entity.parts.find(p => p.id === end.part);
      if (!part || !end.anchor || !Number.isFinite(end.anchor.x) || !Number.isFinite(end.anchor.y)) throw new Error('Invalid connected body');
      return { entity, part, anchor: end.anchor };
    };
    const added: Wire[] = [];
    try {
      for (const raw of value as SavedWire[]) {
        if (!raw || !kinds.includes(raw.kind) || !Number.isFinite(raw.cableTemperature) || !Number.isFinite(raw.length) || raw.length <= 0 || ![0, 1, 2].includes(raw.channel) || raw.breakForce !== null && (typeof raw.breakForce !== 'number' || !Number.isFinite(raw.breakForce) || raw.breakForce < 0)) throw new Error('Invalid wire data');
        if(raw.soakAmount!==undefined&&(!Number.isFinite(raw.soakAmount)||raw.soakAmount<0||raw.soakAmount>1))throw new Error('Invalid bandage soak');
        const wire = this.connect(raw.kind, endpoint(raw.a), endpoint(raw.b), { length: raw.length, channel: raw.channel, breakForce: raw.breakForce === null ? Infinity : raw.breakForce });
        wire.cableTemperature = raw.cableTemperature;wire.soakAmount=raw.soakAmount??0; added.push(wire);
      }
      return true;
    } catch { for (const wire of added) this.disconnect(wire); return false; }
  }
}
