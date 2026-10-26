import {describe,it,expect} from 'vitest';
import {Simulation,type Entity} from '../src/simulation';
import {RagdollSystem} from '../src/systems/ragdoll';
import {ExplosionSystem} from '../src/systems/explosions';
import {DamageKind} from '../src/systems/skin';

function layer(entity:Entity,index=9){entity.parts[0].metadata={nodeId:'body',components:[]};entity.metadata={nodes:[{id:'body',name:'body',parentId:null,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,layer:index,components:[]}]};}
describe('native ExplosionCreator rules',()=>{
  it('uses the first blocking fixture and body-center radial impulse for each fragment ray',()=>{
    const sim=new Simulation(),ragdolls=new RagdollSystem(),a=sim.spawn('box',2,5),b=sim.spawn('box',6,5),hits:number[]=[];
    a.parts[0].body.setPosition({x:2,y:5.6});
    const system=new ExplosionSystem(sim,ragdolls,{onFragment:p=>hits.push(p.body.getUserData()===a?a.id:b.id)});
    system.explode({Position:{x:0,y:5.45},Range:10,FragmentationRayCount:1,FragmentForce:4});
    expect(hits).toEqual([a.id]);expect(a.parts[0].body.getLinearVelocity().y).toBeGreaterThan(0);expect(b.parts[0].body.getLinearVelocity().length()).toBe(0);
  });
  it('applies source limb wounds and damage once, separately from generic fragment messages',()=>{
    const sim=new Simulation(),human=sim.spawn('box',2,5);layer(human);
    const component=(className:string,pathId:string,data:Record<string,unknown>)=>({type:'MonoBehaviour',className,pathId,data});
    human.parts[0].metadata!.components=[component('LimbBehaviour','limb',{Health:50,HasBrain:true,SpeciesIdentity:'Human'}),component('CirculationBehaviour','blood',{IsPump:true}),component('ConnectedNodeBehaviour','node',{IsRoot:true})];
    human.metadata!.nodes[0].components=[component('PersonBehaviour','person',{Poses:[]})];
    const ragdolls=new RagdollSystem(),person=ragdolls.attach(human)!;let fragments=0;
    new ExplosionSystem(sim,ragdolls,{random:()=>.5,onFragment:()=>fragments++}).explode({Position:{x:0,y:5.45},Range:10,FragmentationRayCount:1,FragmentForce:4});
    expect(fragments).toBe(1);expect(person.limbs[0].health).toBe(44);expect(person.limbs[0].skinVisual.wounds).toHaveLength(1);expect(person.limbs[0].skinVisual.wounds[0]).toMatchObject({type:DamageKind.Blunt,intensity:2}); // SkinMaterialHandler normalizes damage intensity by 0.1.
  });
  it('preserves pulse force inside range, mass clamp, and source layer/trigger exclusions',()=>{
    const sim=new Simulation(),ragdolls=new RagdollSystem(),a=sim.spawn('box',2,5),b=sim.spawn('box',6,5),ignored=sim.spawn('box',3,7),trigger=sim.spawn('box',3,3);
    layer(a);layer(b);layer(ignored,0);layer(trigger);trigger.parts[0].body.getFixtureList()!.setSensor(true);
    new ExplosionSystem(sim,ragdolls).pulse({x:0,y:5.45},3,10);
    expect(a.parts[0].body.getLinearVelocity().x*a.parts[0].body.getMass()).toBeCloseTo(9);expect(b.parts[0].body.getLinearVelocity().x*b.parts[0].body.getMass()).toBeCloseTo(9);
    expect(ignored.parts[0].body.getLinearVelocity().length()).toBe(0);expect(trigger.parts[0].body.getLinearVelocity().length()).toBe(0);
  });
  it('forwards underwater effects and original ballistic shrapnel parameters',()=>{
    const sim=new Simulation(),effects:boolean[]=[],shrapnel:number[]=[];
    new ExplosionSystem(sim,new RagdollSystem(),{isUnderWater:()=>true,onEffect:(_p,wet)=>effects.push(wet),onShrapnel:(_p,n)=>shrapnel.push(n)}).explode({Position:{x:0,y:5},Range:0,FragmentationRayCount:0,FragmentForce:4,CreateParticlesAndSound:false,BallisticShrapnelCount:8});
    expect(effects).toEqual([true]);expect(shrapnel).toEqual([8]);
  });
});
