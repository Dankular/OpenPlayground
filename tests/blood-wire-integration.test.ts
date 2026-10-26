import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {Simulation,type Part} from '../src/simulation';
import type {Prefab} from '../src/prefabs';
import {PhysicalSystem} from '../src/systems/physical-world';
import {RagdollSystem} from '../src/systems/ragdoll';
import {LiquidSystem} from '../src/systems/liquids';
import {WireSystem} from '../src/systems/wires';

describe.skipIf(!existsSync('public/local-assets/prefabs/20217.json'))('blood-wire physiology integration',()=>{
  it('bandages an extracted organic limb with source healing, bleeding and soaking rules',()=>{
    const sim=new Simulation(),physical=new PhysicalSystem(),ragdolls=new RagdollSystem();
    const liquids=new LiquidSystem(),prefab=JSON.parse(readFileSync('public/local-assets/prefabs/20217.json','utf8')) as Prefab;
    const human=sim.spawnPrefab('20217',0,5,prefab);physical.attach(human);ragdolls.attach(human);liquids.attach(human);
    const head=human.parts.find(p=>p.label==='Head')!,limb=ragdolls.limbFor(head)!;limb.health=10;limb.bleedingRate=2;
    const adrenaline=limb.person.adrenaline,wires=new WireSystem(sim.world,physical,{getContainer:p=>liquids.get(p),getLimb:p=>ragdolls.limbFor(p)});
    const wire=wires.connect('bandage',{entity:human,part:head,anchor:{x:0,y:0}},{entity:null,part:null,anchor:{x:1,y:6}});
    expect(limb.person.adrenaline).toBeCloseTo(adrenaline+.25);wires.beforeStep(.02);
    expect(limb.bleedingRate).toBeCloseTo(1.8);expect(limb.health).toBeCloseTo(10+(limb.initialHealth-10)*.001);expect(wire.soakAmount).toBeCloseTo(.018);
    wires.disconnect(wire);limb.config.SpeciesIdentity='Android';limb.health=10;limb.bleedingRate=2;
    wires.connect('bandage',{entity:human,part:head,anchor:{x:0,y:0}},{entity:null,part:null,anchor:{x:1,y:6}});wires.beforeStep(.02);
    expect(limb.health).toBe(10);expect(limb.bleedingRate).toBe(2);
  });
  it('keeps wire-transferred blood in the live limbs when the liquid system synchronizes',()=>{
    const sim=new Simulation(),physical=new PhysicalSystem(),ragdolls=new RagdollSystem({random:()=>.5});
    const liquids=new LiquidSystem({getBlood:p=>ragdolls.limbFor(p)?.blood,setBlood:(p,n)=>{const limb=ragdolls.limbFor(p);if(limb)limb.blood=n;}});
    ragdolls.externalLiquidTransport=true;ragdolls.getTotalLiquid=p=>liquids.get(p as Part)?.total;
    const prefab=JSON.parse(readFileSync('public/local-assets/prefabs/20217.json','utf8')) as Prefab;
    const a=sim.spawnPrefab('20217',0,5,prefab),b=sim.spawnPrefab('20217',4,5,prefab);
    for(const entity of [a,b]){physical.attach(entity);ragdolls.attach(entity);liquids.attach(entity);}
    const headA=a.parts.find(p=>p.label==='Head')!,headB=b.parts.find(p=>p.label==='Head')!;
    const limbA=ragdolls.limbFor(headA)!,limbB=ragdolls.limbFor(headB)!;
    limbB.blood=.5;liquids.beforeStep(.02);
    // Isolate the two heads from native internal diffusion so the test measures
    // only the external blood wire and the synchronization boundary.
    for(const entity of [a,b])for(const joint of entity.joints)sim.world.destroyJoint(joint);
    const from=liquids.get(headA)!,to=liquids.get(headB)!;from.measuredPressure=100;to.measuredPressure=0;
    const beforeA=from.getAmount('BLOOD'),beforeB=to.getAmount('BLOOD');
    const wires=new WireSystem(sim.world,physical,{getContainer:p=>liquids.get(p),getLimb:p=>ragdolls.limbFor(p)});
    wires.connect('blood',{entity:a,part:headA,anchor:{x:0,y:0}},{entity:b,part:headB,anchor:{x:0,y:0}});
    limbA.bloodFlow=1;limbB.bloodFlow=0;wires.beforeStep(.02);
    expect(limbA.blood).toBeCloseTo(beforeA-.04);expect(limbB.blood).toBeCloseTo(beforeB+.04);
    expect(limbA.bloodFlow).toBeCloseTo(.99);expect(limbB.bloodFlow).toBeCloseTo(.01);
    liquids.beforeStep(.02);
    expect(to.getAmount('BLOOD')).toBeCloseTo(beforeB+.04);expect(from.getAmount('BLOOD')).toBeCloseTo(beforeA-.04);
  });
});
