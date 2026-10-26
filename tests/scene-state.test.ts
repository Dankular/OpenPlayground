import {describe,it,expect} from 'vitest';
import {Simulation,type Entity} from '../src/simulation';
import {PhysicalSystem} from '../src/systems/physical-world';
import {DeviceSystem} from '../src/systems/devices';
import {RagdollSystem} from '../src/systems/ragdoll';
import {registerSystemState} from '../src/state';
import type {AssetLibrary,Prefab,SourceComponent} from '../src/prefabs';

describe('scene state transactions',()=>{
  it('attaches restored entities once and restores registered system state',()=>{
    const sim=new Simulation();const values=new Map<Entity,number>();let attaches=0;
    sim.onSpawn.push(e=>{attaches++;values.set(e,0);});sim.onRemove.push(e=>values.delete(e));
    sim.stateAdapters.set('fixture',{capture:e=>values.get(e),restore:(e,v)=>{if(typeof v!=='number'||!Number.isFinite(v))return false;values.set(e,v);return true;}});
    const box=sim.spawn('box',1,2);values.set(box,37);const saved=sim.serialize();sim.import(saved);
    expect(attaches).toBe(2);expect(values.size).toBe(1);expect(values.get(sim.entities[0])).toBe(37);expect(sim.entities[0]).not.toBe(box);
  });
  it('rolls back every staged body and system attachment when one saved state fails',()=>{
    const sim=new Simulation();const attached=new Set<Entity>();sim.onSpawn.push(e=>attached.add(e));sim.onRemove.push(e=>attached.delete(e));
    sim.stateAdapters.set('fixture',{capture:()=>({valid:true}),restore:(_e,v)=>!!v&&typeof v==='object'&&(v as {valid?:unknown}).valid===true});
    const original=sim.spawn('box',0,3);sim.spawn('ball',1,3);const saved=sim.serialize();saved.entities[1].systems={fixture:{valid:false}};
    expect(()=>sim.import(saved)).toThrow('Invalid fixture simulation state');expect(sim.entities[0]).toBe(original);expect(sim.entities).toHaveLength(2);expect(sim.world.getBodyCount()).toBe(3);expect(attached.size).toBe(2);
  });
  it('accepts original version1 primitive scenes',()=>{
    const sim=new Simulation();sim.spawn('plank',0,1);const saved=sim.serialize();saved.version=1;delete saved.buildId;saved.entities.forEach(e=>delete e.systems);
    const restored=new Simulation();restored.import(saved);expect(restored.entities[0].kind).toBe('plank');
  });
  it('preserves legitimate paused fixed-step burn and wetness overshoots',()=>{
    const physicalComponent:SourceComponent={type:'MonoBehaviour',className:'PhysicalBehaviour',pathId:'physics',data:{}};
    const prefab:Prefab={catalogId:'fixture',id:'fixture',name:'Fixture',rootGameObjectId:'node',parts:[{id:'body',nodeId:'node',name:'Body',position:{x:0,y:0},angle:0,scale:{x:1,y:1},mass:1,linearDamping:0,angularDamping:0,colliders:[{type:'box',offset:{x:0,y:0},size:{x:1,y:1}}],metadata:{components:[physicalComponent]}}],joints:[],renderers:[],nodes:[{id:'node',name:'Fixture',parentId:null,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,components:[physicalComponent]}]};
    const assets:AssetLibrary={buildId:'fixture',catalog:{items:[],categories:[]},prefabs:new Map([['fixture',prefab]])};
    const sim=new Simulation(null,assets),physical=new PhysicalSystem(),devices=new DeviceSystem(physical),ragdolls=new RagdollSystem();
    sim.onSpawn.push(e=>physical.attach(e));sim.onRemove.push(e=>physical.remove(e));registerSystemState(sim,physical,devices,ragdolls);
    const entity=sim.spawnPrefab('fixture',0,0),object=physical.get(entity.parts[0])!;object.state.burnProgress=1.02;object.state.wetness=1.1;sim.paused=true;
    sim.import(sim.serialize());const restored=physical.get(sim.entities[0].parts[0])!;expect(restored.state.burnProgress).toBe(1.02);expect(restored.state.wetness).toBe(1.1);
  });
  it('restores global settings and existing system state when staged attachment mutates them',()=>{
    const sim=new Simulation(),states=new Map<Entity,number>();let ambient=20;
    sim.onSpawn.push(e=>{for(const [old,value] of states)states.set(old,value+7);ambient+=10;states.set(e,0);});sim.onRemove.push(e=>states.delete(e));
    sim.importTransactions.set('ambient',{capture:()=>ambient,rollback:v=>{ambient=v as number;}});
    sim.stateAdapters.set('fixture',{capture:e=>states.get(e),restore:(e,value)=>{if(typeof value!=='number')return false;states.set(e,value);return true;}});
    const original=sim.spawn('box',0,0),saved=sim.serialize(),previousAmbient=ambient;states.set(original,37);saved.entities[0].systems={fixture:'invalid'};
    expect(()=>sim.import(saved)).toThrow('Invalid fixture simulation state');expect(ambient).toBe(previousAmbient);expect(states.get(original)).toBe(37);expect(sim.entities[0]).toBe(original);
  });
});
