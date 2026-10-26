import type { Simulation,Entity } from './simulation';
import type { PhysicalSystem } from './systems/physical-world';
import type { DeviceSystem } from './systems/devices';
import type { RagdollSystem } from './systems/ragdoll';
import type { PhysicalState } from './systems/physical';

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e12;
export function registerSystemState(sim:Simulation,physical:PhysicalSystem,devices:DeviceSystem,ragdolls:RagdollSystem){
  sim.stateAdapters.set('physical',{capture:e=>physical.snapshot(e),restore:(e,value)=>{
    if(!record(value))return false;
    const entries=Object.entries(value);const byId=new Map(e.parts.map((p,i)=>[p.id??String(i),p]));
    const fields=['temperature','charge','burnProgress','burnIntensity','wetness'] as const;
    if(entries.some(([id,state])=>!byId.has(id)||!physical.get(byId.get(id)!)||!record(state)||typeof state.onFire!=='boolean'||fields.some(key=>!finite(state[key]))))return false;
    if(entries.some(([,s])=>{const state=s as unknown as PhysicalState;return state.temperature< -273.15||state.charge<0||state.burnProgress<0||state.burnIntensity<0||state.burnIntensity>1||state.wetness<0||state.wetness>1;}))return false;
    for(const [id,state] of entries)physical.get(byId.get(id)!)!.state={...(state as unknown as PhysicalState)};return true;
  }});
  sim.stateAdapters.set('devices',{capture:e=>devices.get(e).map(d=>({id:d.component.pathId,active:d.active,warmup:d.warmup,speed:d.speed,targetTemperature:d.targetTemperature})),restore:(e,value)=>{
    if(!Array.isArray(value))return false;const current=devices.get(e);const byId=new Map(current.map(d=>[d.component.pathId,d]));
    if(value.length!==current.length||new Set(value.map(s=>s?.id)).size!==value.length||value.some(s=>!record(s)||typeof s.id!=='string'||!byId.has(s.id)||typeof s.active!=='boolean'||!['warmup','speed','targetTemperature'].every(key=>finite(s[key]))))return false;
    for(const saved of value){const d=byId.get(saved.id)!;d.active=saved.active;d.warmup=saved.warmup;d.speed=saved.speed;d.targetTemperature=saved.targetTemperature;const pointer=d.kind==='RotorBehaviour'?d.component.data.ActiveLight:d.component.data.ActivationLight;const id=(pointer as {m_PathID?:number}|undefined)?.m_PathID;if(id)devices.options.setRendererEnabled?.(e,String(id),d.active);}return true;
  }});
  sim.stateAdapters.set('ragdoll',{capture:e=>ragdolls.snapshot(e),restore:(e,value)=>ragdolls.restore(e,value)});
}
