import {describe,it,expect} from 'vitest';
import {Simulation} from '../src/simulation';
import {WireSystem} from '../src/systems/wires';
import {PhysicalSystem} from '../src/systems/physical-world';
import {registerConnectionState} from '../src/state';

function setup(){const sim=new Simulation(),physical=new PhysicalSystem(),wires=new WireSystem(sim.world,physical);sim.onSpawn.push(e=>physical.attach(e));sim.onRemove.push(e=>{wires.remove(e);physical.remove(e);});registerConnectionState(sim,wires);return{sim,wires};}
describe('scene connection transactions',()=>{
  it('round trips directed channels and world anchors against staged bodies',()=>{
    const{sim,wires}=setup(),a=sim.spawn('box',0,3),b=sim.spawn('ball',2,3);
    wires.connect('activation',{entity:a,part:a.parts[0],anchor:{x:.1,y:0}},{entity:b,part:b.parts[0],anchor:{x:0,y:.1}},{channel:2,breakable:true});
    wires.connect('rope',{entity:b,part:b.parts[0],anchor:{x:0,y:0}},{entity:null,part:null,anchor:{x:2,y:5}});
    const saved=JSON.parse(JSON.stringify(sim.serialize()));sim.import(saved);
    expect(wires.wires.size).toBe(2);const activation=[...wires.wires.values()].find(w=>w.kind==='activation')!;expect(activation.channel).toBe(2);expect(activation.a.entity).toBe(sim.entities[0]);expect(activation.b.entity).toBe(sim.entities[1]);expect(activation.breakForce).toBeGreaterThan(0);expect([...wires.wires.values()].find(w=>w.kind==='rope')!.b.anchor).toEqual({x:2,y:5});
  });
  it('rolls back newly staged joints if a later global adapter rejects the scene',()=>{
    const{sim,wires}=setup(),a=sim.spawn('box',0,3),b=sim.spawn('ball',2,3),old=wires.connect('rigid',{entity:a,part:a.parts[0],anchor:{x:0,y:0}},{entity:b,part:b.parts[0],anchor:{x:0,y:0}});
    sim.sceneAdapters.set('reject',{capture:()=>({}),restore:()=>false});const saved=sim.serialize(),jointCount=sim.world.getJointCount();
    expect(()=>sim.import(saved)).toThrow();expect(sim.entities).toEqual([a,b]);expect(wires.wires.size).toBe(1);expect(wires.wires.get(old.id)).toBe(old);expect(sim.world.getJointCount()).toBe(jointCount);
  });
});
