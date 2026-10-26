import type { Entity, Part } from '../simulation';
import type { SourceComponent } from '../prefabs';
import type { PhysicalSystem } from './physical-world';

export interface MachineryState {
  part: Part; component: SourceComponent; initialHealth: number; health: number;
  destroyed: boolean; indestructible: boolean; heatShielded: boolean; canRepair: boolean;
}
const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const truth = (value: unknown) => value === true || value === 1;
const pointers = (value: unknown): string[] => Array.isArray(value) ? value.map(v=>String(v?.m_PathID ?? '')) : [];

/** DamagableMachineryBehaviour health, failure gates and repair. Broken-machine
 * shader, sparks, serialized UnityEvents and secondary explosions remain separate.
 */
export class MachinerySystem {
  private states = new Map<Entity, MachineryState[]>();
  private byPart = new Map<Part, MachineryState[]>();
  constructor(readonly physical: PhysicalSystem, readonly options: {
    random?: () => number;
    onChanged?: (entity: Entity, state: MachineryState) => void;
    onBroken?: (entity: Entity, state: MachineryState) => void;
  } = {}) {}
  attach(entity: Entity): void {
    this.remove(entity);
    const states: MachineryState[] = [];
    for (const part of entity.parts) for (const component of part.metadata?.components ?? []) {
      if (component.className !== 'DamagableMachineryBehaviour' || component.data.m_Enabled === 0 || component.data.m_Enabled === false || part.metadata?.active === false) continue;
      const d = component.data, initialHealth = number(d.Health, 10);
      const state: MachineryState = {part,component,initialHealth,health:initialHealth,destroyed:truth(d.Destroyed),indestructible:truth(d.Indestructible),heatShielded:truth(d.HeatShielded),canRepair:d.CanRepair === undefined || truth(d.CanRepair)};
      if (state.destroyed) state.health = 0;
      states.push(state);this.byPart.set(part,[...(this.byPart.get(part) ?? []),state]);
    }
    this.states.set(entity,states);
  }
  get(entity: Entity): readonly MachineryState[] { return this.states.get(entity) ?? []; }
  remove(entity: Entity): void { for (const s of this.states.get(entity) ?? []) this.byPart.delete(s.part);this.states.delete(entity); }
  isDisabled(entity: Entity, component: SourceComponent): boolean {
    const nodeId=String((component.data.m_GameObject as {m_PathID?:unknown}|undefined)?.m_PathID??'');
    return this.nodeDisabled(entity,nodeId)||this.get(entity).some(s=>s.destroyed && pointers(s.component.data.BehavioursToToggle).includes(component.pathId));
  }
  nodeDisabled(entity: Entity, nodeId: string): boolean {
    const broken=this.get(entity).filter(s=>s.destroyed);
    if(!broken.length)return false;
    const ancestors=new Set<string>();let current:string|null=nodeId;
    while(current&&!ancestors.has(current)){ancestors.add(current);current=entity.metadata?.nodes.find(n=>n.id===current)?.parentId??null;}
    return broken.some(s=>pointers(s.component.data.GameObjectsToToggle).some(id=>ancestors.has(id)));
  }
  private damage(part: Part, amount: (s: MachineryState)=>number, allowDestroyed=false): void {
    for (const state of this.byPart.get(part) ?? []) {
      if (state.indestructible || (state.destroyed && !allowDestroyed)) continue;
      state.health -= Math.max(0,amount(state));
      if (state.health <= 0 && !state.destroyed) this.breakState(state);
    }
  }
  private owner(state: MachineryState): Entity | undefined { return [...this.states].find(([,states])=>states.includes(state))?.[0]; }
  private breakState(state: MachineryState): void {
    state.destroyed=true;state.health=0;const entity=this.owner(state);
    if (entity) {this.options.onChanged?.(entity,state);this.options.onBroken?.(entity,state);}
  }
  shot(part: Part, damage: number): void { if (Number.isFinite(damage)) this.damage(part,s=>damage*number(s.component.data.FirearmDamageMultiplier,0)); }
  fragment(part: Part, force: number): void { if (Number.isFinite(force)) this.damage(part,s=>force*number(s.component.data.ExplosionDamageMultiplier,0)*250,true); }
  stab(part: Part, causesWound=true): void { if (causesWound) this.damage(part,s=>number(s.component.data.StabDamageMultiplier,0)); }
  break(part: Part): void { this.damage(part,s=>number(s.component.data.BreakDamage,0)); }
  slice(part: Part): void { this.damage(part,s=>s.health); }
  emp(part: Part, permanent=false): void {
    for (const state of this.byPart.get(part) ?? []) if (!state.indestructible && !state.destroyed) { this.breakState(state);if(permanent)state.canRepair=false; }
  }
  beforeStep(): void {
    for (const states of this.states.values()) for (const s of states) {
      if (s.destroyed || s.indestructible) continue;
      const p=this.physical.get(s.part);if(!p)continue;
      const d=s.component.data;
      if ((!s.heatShielded && (p.state.burnProgress>number(d.FireDamageThreshold,1) || p.state.temperature>number(d.TemperatureThreshold,Infinity))) ||
          (d.Waterproof !== undefined && !truth(d.Waterproof) && p.state.wetness>.95 && (this.options.random ?? Math.random)()>.9)) this.breakState(s);
    }
  }
  repair(entity: Entity, full=true): void {
    for (const s of this.get(entity)) if (s.canRepair) {
      s.health=full?s.initialHealth:Math.min(s.initialHealth,s.health+s.initialHealth/4);
      if(s.health<=.001)continue;
      const p=this.physical.get(s.part);if(p){p.state.temperature=Math.min(p.state.temperature,number(s.component.data.TemperatureThreshold,Infinity)-1);p.state.burnProgress=0;}
      s.destroyed=false;this.options.onChanged?.(entity,s);
    }
  }
  snapshot(entity: Entity): unknown { return this.get(entity).map(s=>({id:s.component.pathId,health:s.health,destroyed:s.destroyed,indestructible:s.indestructible,heatShielded:s.heatShielded,canRepair:s.canRepair})); }
  restore(entity: Entity,value: unknown): boolean {
    const states=this.get(entity),byId=new Map(states.map(s=>[s.component.pathId,s]));
    if(!Array.isArray(value)||value.length!==states.length||new Set(value.map(v=>v?.id)).size!==value.length||value.some(v=>!v||!byId.has(v.id)||typeof v.health!=='number'||!Number.isFinite(v.health)||Math.abs(v.health)>1e12||(!v.destroyed&&v.health<0)||['destroyed','indestructible','heatShielded','canRepair'].some(k=>typeof v[k]!=='boolean')))return false;
    for(const v of value){const s=byId.get(v.id)!;Object.assign(s,{health:v.health,destroyed:v.destroyed,indestructible:v.indestructible,heatShielded:v.heatShielded,canRepair:v.canRepair});this.options.onChanged?.(entity,s);}
    return true;
  }
}
