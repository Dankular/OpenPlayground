import {describe,it,expect} from 'vitest';
import {Simulation,type Entity} from '../src/simulation';

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
});
