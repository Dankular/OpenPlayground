import { describe, expect, it } from 'vitest';
import { Box, RevoluteJoint, Vec2, World } from 'planck';
import { existsSync, readFileSync } from 'node:fs';
import { RagdollSystem, evaluateLimbPose, evaluatePoseCurve, type RagdollEntity, type RagdollPart, type RagdollPhysical } from '../src/systems/ragdoll';

function fixture() {
  const world=new World(Vec2(0,-9.81));
  const torso=world.createDynamicBody({position:Vec2(0,1)});torso.createFixture(Box(.15,.3),{density:1});
  const head=world.createDynamicBody({position:Vec2(0,1.6)});head.createFixture(Box(.15,.15),{density:1});
  const joint=world.createJoint(new RevoluteJoint({enableLimit:true,lowerAngle:-1,upperAngle:1},head,torso,Vec2(0,1.4)))!;
  const component=(className:string,pathId:string,data:Record<string,unknown>)=>({className,type:'MonoBehaviour',pathId,data});
  const config=(health:number,brain:boolean)=>({Health:health,BaseStrength:8,FakeUprightForce:.005,HasBrain:brain,RegenerationSpeed:.1,BreakingThreshold:4,BodyTemperature:37,Vitality:brain?7:1,RoughClassification:brain?0:1,ConnectedLimbs:[],VitalParts:[{m_Center:{x:0,y:0},m_Extent:{x:.05,y:.05}}]});
  const parts=[{id:'head-body',label:'Head',body:head,metadata:{nodeId:'head',components:[component('LimbBehaviour','head-limb',{...config(50,true),Joint:{m_PathID:'joint'}}),component('CirculationBehaviour','head-blood',{IsPump:false}),component('ConnectedNodeBehaviour','head-node',{IsRoot:true})]}},{id:'torso-body',label:'Torso',body:torso,metadata:{nodeId:'torso',components:[component('LimbBehaviour','torso-limb',config(50,false)),component('CirculationBehaviour','torso-blood',{IsPump:true}),component('ConnectedNodeBehaviour','torso-node',{IsRoot:false})]}}];
  const rest={Name:'Rest',State:0,Rigidity:4,ForceMultiplier:1,ShouldStandUpright:1,DragInfluence:1,Angles:[{Name:'Head',Limb:{m_PathID:'head-limb'},Angle:0}]};
  const entity:RagdollEntity={id:1,parts,joints:[joint],jointById:new Map([['joint',joint]]),frozen:false,metadata:{nodes:[{id:'root',components:[component('PersonBehaviour','person',{Poses:[rest,{...rest,Name:'Sitting',State:7,ShouldStandUpright:0,Angles:[{Name:'Head',Limb:{m_PathID:'head-limb'},Angle:40}]}],OverridePoseIndex:-1})]}]}};
  const physical=new Map(parts.map(p=>[p,{state:{temperature:37,charge:0,onFire:false,burnProgress:0,burnIntensity:0,wetness:0},properties:{BurningTemperatureThreshold:70,Softness:.728}} satisfies RagdollPhysical]));
  const system=new RagdollSystem({random:()=>.5,getPhysical:p=>physical.get(p as typeof parts[number])});
  const state=system.attach(entity)!;
  return{world,entity,parts,physical,system,state,joint};
}

describe('reconstructed ragdoll behavior',()=>{
  it('applies native StunImpact charge/pain before delayed organic numbness and blackout',()=>{
    const{system,parts,state,physical}=fixture();system.stunImpact(parts[0]);
    expect(physical.get(parts[0])!.state.charge).toBe(1);expect(state.pain).toBe(150);expect(state.consciousness).toBe(1);
    system.update(.2);expect(system.limbFor(parts[0])!.numbness).toBeLessThan(1);system.update(.21);expect(system.limbFor(parts[0])!.numbness).toBe(1);expect(state.consciousness).toBe(0);
  });
  it('gives Android stun charge10 without organic knockout or delay',()=>{
    const{system,parts,state,physical}=fixture();system.limbFor(parts[0])!.config.IsAndroid=true;system.stunImpact(parts[0]);
    expect(physical.get(parts[0])!.state.charge).toBe(10);expect(state.pain).toBe(0);expect(system.snapshot(state.entity)?.stuns).toEqual([]);
  });
  it('restores remaining stun delay without replaying charge or pain',()=>{
    const{system,parts,state,entity,physical}=fixture();system.stunImpact(parts[0]);system.update(.1);const saved=system.snapshot(entity)!;
    expect(saved.stuns?.[0].delays[0]).toBeCloseTo(.3);system.update(.4);expect(system.restore(entity,saved)).toBe(true);system.update(.2);expect(system.limbFor(parts[0])!.numbness).toBeLessThan(1);system.update(.11);expect(state.consciousness).toBe(0);
    expect(physical.get(parts[0])!.state.charge).toBe(1);
  });
  it('drives a displaced hinge toward its serialized rest pose',()=>{
    const {parts,system,state,joint}=fixture();
    parts[0].body.setAngle(.5);system.update(.02);
    expect(state.limbs).toHaveLength(2);expect(joint.isMotorEnabled()).toBe(true);
    expect(joint.getMaxMotorTorque()).toBeGreaterThan(0);
    // Planck bodyB-minus-bodyA means a positive motor speed corrects this pose.
    expect(joint.getMotorSpeed()).toBeGreaterThan(0);
    const initial=Math.abs(joint.getJointAngle());
    for(let i=0;i<50;i++){system.update(.02);parts[0].body.getWorld().step(.02);system.afterStep(.02);}
    expect(Math.abs(joint.getJointAngle())).toBeLessThan(initial);
  });
  it('stops muscle control after brain death and excludes dead health from regeneration',()=>{
    const {system,parts,state,joint}=fixture();
    system.damage(parts[0],55);system.update(.02);
    expect(state.brainDead).toBe(true);expect(state.dead).toBe(true);expect(state.consciousness).toBe(0);
    expect(system.limbFor(parts[0])!.health).toBe(0);expect(state.limbs[0].motorStrength).toBe(0);
    expect(joint.getMaxMotorTorque()).toBeLessThan(.001); // Source rot can produce passive corpse stiffness.
  });
  it('weakens muscles from blood loss, broken bones and unconsciousness',()=>{
    const {system,parts,state}=fixture(),limb=system.limbFor(parts[0])!;
    const healthy=system.motorStrength(limb);limb.blood=.5;
    expect(system.motorStrength(limb)).toBeCloseTo(healthy*.125,8);
    limb.blood=1;system.breakBone(parts[0]);expect(system.motorStrength(limb)).toBe(0);
    system.healBone(parts[0]);state.consciousness=.2;expect(system.motorStrength(limb)).toBe(0);
  });
  it('loses circulation on detached limbs and stops the pump if the brain disconnects',()=>{
    const {system,parts,state,entity}=fixture();system.slice(parts[0]);
    const torso=system.limbFor(parts[1])!;expect(torso.connected).toBe(false);expect(entity.joints).toHaveLength(0);
    const before=torso.health;system.update(1);
    expect(torso.health).toBeLessThan(before);expect(system.limbFor(parts[0])!.bleedingRate).toBeGreaterThan(0);
    expect(state.limbs.every(l=>Number.isFinite(l.bloodFlow))).toBe(true);
  });
  it('updates drowning, hypoxia, bleeding and healing at the recovered rates',()=>{
    const {system,parts,state,physical}=fixture();
    physical.get(parts[0])!.state.wetness=1;state.oxygen=.8;state.limbs[0].bleedingRate=2;
    const blood=state.limbs[0].blood;system.update(1);
    expect(state.oxygen).toBeLessThan(.8);expect(state.limbs[0].blood).toBeLessThan(blood);
    system.damage(parts[1],5);const health=state.limbs[1].health;system.update(1);
    expect(state.limbs[1].health).toBeCloseTo(health+.1,8);
  });
  it('applies vital bullet wounds and caps non-vital direct damage at half initial health',()=>{
    const {system,parts,state}=fixture();
    system.shot(parts[1],{damage:100,point:{x:100,y:100},normal:{x:1,y:0}});
    expect(state.limbs[1].health).toBe(30); // non-vital factor .1 × damage × 2.
    expect(state.limbs[1].bleedingRate).toBeGreaterThan(0);expect(state.limbs[1].internalBleeding).toBe(10);
    system.shot(parts[0],{damage:10,point:parts[0].body.getPosition(),normal:{x:1,y:0}});
    expect(state.limbs[0].health).toBe(0);expect(state.brainDead).toBe(true);
  });
  it('selects explicit poses while frozen rigidbodies still undergo physiology',()=>{
    const {system,state,entity,joint,parts}=fixture();system.setPose(entity,1);system.update(.02);
    expect(state.activePose!.Name).toBe('Sitting');expect(joint.getMotorSpeed()).toBeLessThan(0);
    entity.frozen=true;parts.forEach(p=>p.body.setType('static'));const y=parts[0].body.getPosition().y;state.pain=.5;system.update(1);parts[0].body.getWorld().step(.02);
    expect(parts[0].body.getPosition().y).toBe(y);expect(state.pain).toBeCloseTo(.3);
  });
  it('interpolates the actual unweighted pose curve and cyclic angle sequence',()=>{
    const curve={m_Curve:[{time:0,value:0,inSlope:0,outSlope:0},{time:1,value:1,inSlope:0,outSlope:0}],m_PreInfinity:0,m_PostInfinity:0};
    expect(evaluatePoseCurve(curve,.5)).toBeCloseTo(.5);expect(evaluatePoseCurve(curve,1.5)).toBeCloseTo(.5);
    expect(evaluateLimbPose({Animated:true,StartAngle:-45,EndAngle:45,AnimationDuration:2,AnimationCurve:curve},1)).toBeCloseTo(0);
  });
  it('round trips injuries and disconnected topology while rejecting invalid snapshots atomically',()=>{
    const {system,state,entity,parts}=fixture();system.damage(parts[1],4);system.breakBone(parts[0]);system.slice(parts[0]);state.oxygen=.4;state.pain=.7;
    const snapshot=system.snapshot(entity)!;
    const restored=fixture();expect(restored.system.restore(restored.entity,JSON.parse(JSON.stringify(snapshot)))).toBe(true);
    expect(restored.state.oxygen).toBe(.4);expect(restored.system.snapshot(restored.entity)).toEqual(snapshot);expect(restored.entity.joints).toHaveLength(0);
    const broken=JSON.parse(JSON.stringify(snapshot));broken.limbs[0].blood=NaN;
    expect(restored.system.restore(restored.entity,broken)).toBe(false);expect(restored.system.snapshot(restored.entity)).toEqual(snapshot);
  });
  it('uses sustained per-step velocity changes for human G-force injury',()=>{
    const {system,parts,state}=fixture();parts[0].body.setLinearVelocity(Vec2(80,0));system.afterStep(.02);system.update(.02);
    expect(state.consciousness).toBeLessThan(.6);expect(state.limbs[0].health).toBeLessThan(50);
    expect(state.limbs[0].sustainedAcceleration.x).toBe(40); // Source does not divide by dt.
  });
  it('breaks a biologically fragile joint under reaction force and records bleeding',()=>{
    const {system,parts,state,world,entity}=fixture();state.limbs[0].config.BreakingThreshold=.000001;
    parts[0].body.applyForceToCenter(Vec2(1000,0));world.step(.02);system.afterStep(.02);
    expect(entity.joints).toHaveLength(0);expect(state.limbs[0].dismembered).toBe(true);expect(state.limbs[0].bleedingRate).toBe(10);
  });
});

describe.skipIf(!existsSync('public/local-assets/prefabs/20217.json'))('shipped human configuration',()=>{
  it('resolves every original limb pointer and all eleven animation poses',async()=>{
    const {Simulation}=await import('../src/simulation');
    const prefab=JSON.parse(readFileSync('public/local-assets/prefabs/20217.json','utf8'));
    const sim=new Simulation(null,{buildId:'test',catalog:{categories:[],items:[]},prefabs:new Map([['20217',prefab]])});
    const entity=sim.spawnPrefab('20217',0,1.2),system=new RagdollSystem({random:()=>.5});
    const person=system.attach(entity)!;
    expect(person.limbs).toHaveLength(14);expect(person.poses).toHaveLength(11);expect(person.head!.part.label).toBe('Head');
    expect(person.limbs.filter(l=>l.joint)).toHaveLength(13);
    expect(person.limbs.every(l=>l.connected)).toBe(true);
    expect(person.poses.every(p=>p.Angles.every(a=>person.limbs.some(l=>String((a.Limb as {m_PathID:number}).m_PathID)===l.id)))).toBe(true);
    sim.beforeStep.push(dt=>system.update(dt));sim.afterStep.push(dt=>system.afterStep(dt));
    for(let i=0;i<250;i++)sim.step();
    expect(person.limbs.every(l=>Number.isFinite(l.part.body.getAngle())&&Number.isFinite(l.health)&&Number.isFinite(l.motorStrength))).toBe(true);
    expect(person.limbs.every(l=>l.health>0)).toBe(true);
    expect(person.touchingFloor).toBe(true);
    expect(person.head!.part.body.getPosition().y).toBeGreaterThan(1.2);
  });
});

describe.skipIf(!existsSync('public/local-assets/prefabs/20100.json')||!existsSync('public/local-assets/prefabs/20203.json'))('original Android and Gorse configurations',()=>{
  async function original(catalogId:string) {
    const {Simulation}=await import('../src/simulation');const prefab=JSON.parse(readFileSync(`public/local-assets/prefabs/${catalogId}.json`,'utf8'));
    const sim=new Simulation(null,{buildId:'test',catalog:{categories:[],items:[]},prefabs:new Map([[catalogId,prefab]])});
    const entity=sim.spawnPrefab(catalogId,0,1.2),states=new Map<RagdollPart,RagdollPhysical>(entity.parts.map(part=>[part,{state:{temperature:18,charge:0,onFire:false,burnProgress:0,burnIntensity:0,wetness:0},properties:{BurningTemperatureThreshold:70,Softness:.7}}]));
    const system=new RagdollSystem({random:()=>.5,getPhysical:part=>states.get(part as typeof entity.parts[number])}),person=system.attach(entity)!;
    sim.beforeStep.push(dt=>system.update(dt));sim.afterStep.push(dt=>system.afterStep(dt));
    return{sim,entity,system,person,states,prefab};
  }
  it('runs the original Android with300health,13hinges and its own10poses',async()=>{
    const {sim,system,person}=await original('20100');
    expect(person.limbs).toHaveLength(14);expect(person.poses).toHaveLength(10);expect(person.limbs.filter(l=>l.joint)).toHaveLength(13);
    expect(person.limbs.every(l=>l.initialHealth===300&&l.config.IsAndroid===1)).toBe(true);
    for(let i=0;i<150;i++)sim.step();
    expect(person.head!.part.body.getPosition().y).toBeGreaterThan(1.2);expect(person.limbs.every(l=>l.health>0&&l.connected)).toBe(true);
    system.setPose(person.entity,7);sim.step();expect(person.activePose!.Name).toBe(person.poses[7].Name);
  });
  it('runs the original9limb Gorse and preserves its species/pose data',async()=>{
    const {sim,system,person}=await original('20203');
    expect(person.limbs).toHaveLength(9);expect(person.poses).toHaveLength(10);expect(person.limbs.filter(l=>l.joint)).toHaveLength(8);
    expect(person.head!.initialHealth).toBe(200);expect(person.limbs.every(l=>l.config.SpeciesIdentity==='Gorse')).toBe(true);
    expect(person.limbs.filter(l=>l!==person.head).every(l=>l.initialHealth===100)).toBe(true);
    for(let i=0;i<150;i++)sim.step();
    expect(person.head!.part.body.getPosition().y).toBeGreaterThan(.35);expect(person.limbs.every(l=>Number.isFinite(l.motorStrength)&&l.health>0&&l.connected)).toBe(true);
    system.setPose(person.entity,7);sim.step();expect(person.activePose!.Name).toBe(person.poses[7].Name);
  });
  it('applies Android-specific projectile immunity, wet short circuits and EMP',async()=>{
    const {system,person,states}=await original('20100');const arm=person.limbs.find(l=>l.part.label==='LowerArm')!;
    system.shot(arm.part,{damage:39,point:arm.part.body.getPosition(),normal:{x:1,y:0}});expect(arm.health).toBe(300);expect(arm.bleedingRate).toBe(0);
    states.get(arm.part as typeof person.entity.parts[number])!.state.wetness=1;system.update(.02);expect(states.get(arm.part as typeof person.entity.parts[number])!.state.charge).toBe(.5);
    system.emp(person.head!.part);system.update(.02);expect(person.dead).toBe(true);expect(person.head!.health).toBe(0);
  });
  it('distinguishes Gorse freezing from Android and detaches a non-vital Gorse leg',async()=>{
    const android=await original('20100'),gorse=await original('20203');const androidLeg=android.person.limbs.find(l=>l.part.label==='LowerLeg')!,gorseLeg=gorse.person.limbs.find(l=>l.part.label==='right bottom leg')!;
    android.states.get(androidLeg.part as typeof android.entity.parts[number])!.state.temperature=-10;gorse.states.get(gorseLeg.part as typeof gorse.entity.parts[number])!.state.temperature=-10;
    android.system.update(.02);gorse.system.update(.02);
    expect(androidLeg.health).toBe(300);expect(gorseLeg.health).toBeLessThan(100);
    const gorseHead=gorse.person.head!;gorse.system.slice(gorseLeg.part);gorse.system.update(.02);
    expect(gorseLeg.dismembered).toBe(true);expect(gorseLeg.connected).toBe(false);expect(gorseLeg.health).toBe(0);expect(gorseHead.health).toBe(200);expect(gorse.person.dead).toBe(false);
  });
  it('stores bullet wound coordinates in native sprite space for all three species',async()=>{
    for(const id of ['20217','20100','20203']){
      const {system,person}=await original(id),limb=person.head!,native={x:.05,y:.03};
      const world=limb.part.body.getWorldPoint(Vec2(native.x*limb.localScale.x,native.y*limb.localScale.y));
      system.shot(limb.part,{damage:100,point:world,normal:{x:1,y:0}});
      const wound=system.skinFor(limb.part)!.wounds.find(w=>w.type===1)!;
      expect(wound).toBeDefined();expect(wound.x).toBeCloseTo(native.x,8);expect(wound.y).toBeCloseTo(native.y,8);
      expect([wound.x,wound.y,wound.intensity,wound.time].every(Number.isFinite)).toBe(true);
    }
  });
});
