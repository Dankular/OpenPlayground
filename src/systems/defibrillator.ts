import { AABB, Circle, Transform, Vec2, testOverlap } from 'planck';
import type { Entity, Part } from '../simulation';
import type { SourceComponent } from '../prefabs';
import type { PhysicalSystem } from './physical-world';
import type { RagdollSystem } from './ragdoll';
import {targetsPart} from './targeting';

export interface DefibrillatorState {
  component: SourceComponent; part: Part; pads: Part[];
  phase: 'idle' | 'standby' | 'clear'; remaining: number;
}
const pointer = (value: unknown) => String((value as {m_PathID?: unknown} | undefined)?.m_PathID ?? '');

/** DefibrillatorBehaviour.DefibRoutine/Defibrillate, reconstructed from CIL/decompile.
 * The original restores circulation at each pad; it does not heal brain death.
 */
export class DefibrillatorSystem {
  private states = new Map<Entity, DefibrillatorState[]>();
  constructor(readonly physical: PhysicalSystem, readonly ragdolls: RagdollSystem, readonly options: {
    playClip?: (component: SourceComponent, pointer: unknown, part: Part) => void;
    clipDuration?: (component: SourceComponent, pointer: unknown) => number;
    isDisabled?: (entity: Entity, component: SourceComponent) => boolean;
  } = {}) {}
  attach(entity: Entity): void {
    const states: DefibrillatorState[] = [];
    const components = new Map<string, Part>();
    for (const part of entity.parts) for (const component of part.metadata?.components ?? []) components.set(component.pathId, part);
    for (const part of entity.parts) for (const component of part.metadata?.components ?? []) {
      if (component.className !== 'DefibrillatorBehaviour' || component.data.m_Enabled === 0 || component.data.m_Enabled === false || part.metadata?.active === false) continue;
      const pads = [component.data.Pad1, component.data.Pad2].flatMap(ref => { const pad = components.get(pointer(ref)); return pad ? [pad] : []; });
      states.push({component, part, pads, phase: 'idle', remaining: 0});
    }
    this.states.set(entity, states);
  }
  remove(entity: Entity): void { this.states.delete(entity); }
  get(entity: Entity): readonly DefibrillatorState[] { return this.states.get(entity) ?? []; }
  canUse(entity: Entity): boolean { return this.get(entity).length > 0; }
  use(entity: Entity,targetPart?:Part): boolean {
    let used = false;
    for (const state of this.get(entity)) if (targetsPart(entity,state.part,targetPart)&&state.phase === 'idle' && !this.options.isDisabled?.(entity, state.component)) {
      state.phase = 'standby'; state.remaining = 2; used = true;
      this.options.playClip?.(state.component, state.component.data.StandClearClip, state.part);
    }
    return used;
  }
  beforeStep(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    for (const [entity,states] of this.states) for (const state of states) {
      if (this.options.isDisabled?.(entity, state.component)) {state.phase='idle';state.remaining=0;continue;}
      if (state.phase === 'idle') continue;
      state.remaining -= dt;
      if (state.remaining > 1e-9) continue;
      if (state.phase === 'standby') {
        state.phase = 'clear';
        state.remaining = Math.max(0, this.options.clipDuration?.(state.component, state.component.data.AudioIndicator) ?? 1);
        this.options.playClip?.(state.component, state.component.data.AudioIndicator, state.part);
        for (const pad of state.pads) this.shock(pad);
      } else { state.phase = 'idle'; state.remaining = 0; }
    }
  }
  private shock(pad: Part): void {
    const physical = this.physical.get(pad); if (physical) physical.state.charge += .2;
    const point = pad.body.getWorldPoint(Vec2(-.1, 0)), radius = .1;
    const circle = Circle(radius), transform = new Transform(point, 0);
    let count = 0;
    pad.body.getWorld().queryAABB(new AABB(Vec2(point.x-radius, point.y-radius), Vec2(point.x+radius, point.y+radius)), fixture => {
      if (fixture.isSensor()) return true; // Shipped Physics2DSettings: queriesHitTriggers=false.
      if (!testOverlap(fixture.getShape(), 0, circle, 0, fixture.getBody().getTransform(), transform)) return true;
      const owner = fixture.getBody().getUserData() as Entity | undefined;
      const part = owner?.parts?.find(p => p.body === fixture.getBody());
      const limb = part && this.ragdolls.limbFor(part);
      if (limb) {
        limb.isPump = limb.wasInitiallyPumping; limb.bloodFlow = 1;
        limb.person.adrenaline += 20; limb.person.consciousness = 1;
        if (++count >= 16) return false;
      }
      return true;
    });
  }
  snapshot(entity: Entity): unknown { return this.get(entity).map(s => ({id:s.component.pathId, phase:s.phase, remaining:s.remaining})); }
  restore(entity: Entity, value: unknown): boolean {
    const states = this.get(entity);
    if (!Array.isArray(value) || value.length !== states.length) return false;
    const byId = new Map(states.map(s => [s.component.pathId,s]));
    if (new Set(value.map(v => v?.id)).size !== value.length || value.some(v => !v || !byId.has(v.id) || !['idle','standby','clear'].includes(v.phase) || typeof v.remaining !== 'number' || !Number.isFinite(v.remaining) || v.remaining < 0 || v.remaining > 3600)) return false;
    for (const saved of value) { const state = byId.get(saved.id)!; state.phase = saved.phase; state.remaining = saved.remaining; }
    return true;
  }
}
