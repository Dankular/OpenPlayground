import {describe,it,expect} from 'vitest';
import {Simulation,type Entity} from '../src/simulation';
import {SyringeContactSystem} from '../src/systems/syringe-contact';
import type {AssetLibrary,Prefab,SourceComponent} from '../src/prefabs';

function setup(speed=8,angle=0,softness=1){
  const physical=(needle:boolean):SourceComponent=>({pathId:needle?'needle-physical':'victim-physical',type:'MonoBehaviour',className:'PhysicalBehaviour',data:{LooseEndSize:.49,StabReleaseSpeedModifier:1},properties:{pathId:needle?'sharp':'soft',data:needle?{Sharp:1,SharpForceThresholdMultiplier:1,LodgeStrengthMultiplier:1,Softness:0,SharpAxes:[{Axis:{x:1,y:0},LowerLimit:.08,UpperLimit:.25,LooseUpperLimit:1,LooseLowerLimit:0}]}:{Softness:softness}}});
  const prefab=(id:string,needle:boolean):Prefab=>{
    const component=physical(needle),nodeId=id+'-node';return {id,catalogId:id,name:id,rootGameObjectId:nodeId,parts:[{id:id+'-body',nodeId,name:id,position:{x:0,y:0},angle:0,scale:{x:1,y:1},mass:1,linearDamping:0,angularDamping:0,gravityScale:0,bodyType:needle?'dynamic':'static',colliders:[{type:'box',offset:{x:0,y:0},size:{x:needle?.514:.2,y:needle?.143:1}}],metadata:{components:[component]}}],joints:[],renderers:[],nodes:[{id:nodeId,name:id,parentId:null,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,components:[component]}]};
  };
  const assets:AssetLibrary={buildId:'syringe-contact-fixture',catalog:{items:[],categories:[]},prefabs:new Map([['victim',prefab('victim',false)],['needle',prefab('needle',true)]])};
  const sim=new Simulation(null,assets);sim.world.setGravity({x:0,y:0});let lodged=0,dislodged=0;
  const contacts=new SyringeContactSystem(sim,{isSyringe:p=>p.label==='needle',onLodged:()=>lodged++,onDislodged:()=>dislodged++});
  sim.onSpawn.push(e=>contacts.attach(e));sim.onRemove.push(e=>contacts.remove(e));sim.beforeStep.push(dt=>contacts.beforeStep(dt));sim.afterStep.push(dt=>contacts.afterStep(dt));
  sim.sceneAdapters.set('needles',{capture:entities=>contacts.snapshot(entities),restore:(entities,value)=>contacts.restore(entities,value)});
  const victim=sim.spawnPrefab('victim',0,2),needle=sim.spawnPrefab('needle',-.7,2);needle.parts[0].body.setAngle(angle);needle.parts[0].body.setLinearVelocity({x:speed,y:0});
  return {sim,contacts,victim,needle,counts:()=>({lodged,dislodged})};
}
describe('source syringe needle mechanics',()=>{
  it('lodges a sufficiently fast needle tip in a soft body and keeps it attached',()=>{
    const {sim,contacts,needle,victim,counts}=setup();for(let i=0;i<30;i++)sim.step();
    expect(contacts.get(needle.parts[0])?.victim).toBe(victim.parts[0]);expect(counts().lodged).toBe(1);expect(sim.world.getJointCount()).toBe(1);
    expect(contacts.get(needle.parts[0])!.joint.getJointTranslation()).toBeGreaterThanOrEqual(.07);
  });
  it('does not inject on slow contact, a sideways shaft or a hard surface',()=>{
    for(const args of [[.5,0,1],[8,Math.PI/2,1],[8,0,0]] as const){const {sim,contacts,counts}=setup(...args);for(let i=0;i<100;i++)sim.step();expect(contacts.all()).toHaveLength(0);expect(counts().lodged).toBe(0);}
  });
  it('withdraws at the loose upper end and removes the liquid target',()=>{
    const {sim,contacts,needle,counts}=setup();for(let i=0;i<30;i++)sim.step();expect(contacts.all()).toHaveLength(1);
    for(let i=0;i<20;i++){needle.parts[0].body.setLinearVelocity({x:-8,y:0});sim.step();}
    expect(contacts.all()).toHaveLength(0);expect(counts().dislodged).toBe(1);expect(sim.world.getJointCount()).toBe(0);
  });
  it('round trips cross-entity penetrations and rejects malformed anchors without destroying the current joint',()=>{
    const {sim,contacts}=setup();for(let i=0;i<30;i++)sim.step();const data=sim.serialize();sim.import(data);expect(contacts.all()).toHaveLength(1);expect(sim.world.getJointCount()).toBe(1);
    const invalid=sim.serialize();(invalid.systems!.needles as {anchor:{x:number;y:number}}[])[0].anchor.x=Infinity;
    expect(()=>sim.import(invalid)).toThrow('Invalid needles scene state');expect(contacts.all()).toHaveLength(1);expect(sim.world.getJointCount()).toBe(1);expect(sim.world.getBodyCount()).toBe(3);
  });
  it('cleans a lodged needle when either participating entity is deleted',()=>{
    const {sim,contacts,victim}=setup();for(let i=0;i<30;i++)sim.step();sim.remove(victim);expect(contacts.all()).toHaveLength(0);expect(sim.world.getJointCount()).toBe(0);
  });
});
