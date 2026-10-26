import {describe,expect,it} from 'vitest';
import {Box,Vec2,World} from 'planck';
import {LiquidEffects} from '../src/systems/liquid-effects';
import {LiquidReservoir} from '../src/systems/liquids';
import {RagdollSystem,type RagdollEntity,type RagdollPart,type RagdollPhysical} from '../src/systems/ragdoll';

function setup(species='Human',random=()=>.99){
  const world=new World(Vec2(0,-9.81)),body=world.createDynamicBody();body.createFixture(Box(.2,.2),{density:1});
  const components=[{pathId:'limb',className:'LimbBehaviour',type:'MonoBehaviour',data:{Health:50,HasBrain:true,RoughClassification:0,SpeciesIdentity:species,BaseStrength:8,RegenerationSpeed:.1,ImpactPainMultiplier:1,Vitality:7,BreakingThreshold:5,ShotDamageMultiplier:1,BloodMuscleStrengthRatio:1,BodyTemperature:37,IsAndroid:species==='Android'}},{pathId:'blood',className:'CirculationBehaviour',type:'MonoBehaviour',data:{IsPump:true}},{pathId:'node',className:'ConnectedNodeBehaviour',type:'MonoBehaviour',data:{IsRoot:true}}];
  const part:RagdollPart={id:'body',body,label:'Head',metadata:{nodeId:'head',components}},entity:RagdollEntity={id:1,parts:[part],joints:[],frozen:false,metadata:{nodes:[{id:'head',bodyId:'body',components},{id:'root',components:[{pathId:'person',className:'PersonBehaviour',type:'MonoBehaviour',data:{Poses:[],OverridePoseIndex:-1}}]}]}};
  const physical:RagdollPhysical={state:{temperature:37,charge:0,onFire:false,burnProgress:0,burnIntensity:0,wetness:0},properties:{BurningTemperatureThreshold:70}},ragdolls=new RagdollSystem({getPhysical:()=>physical,random:()=>.5});
  const person=ragdolls.attach(entity)!,limb=person.limbs[0],effects=new LiquidEffects(ragdolls,{getPhysical:()=>physical,random});
  const originalBlood=species==='Android'?'OIL':species==='Gorse'?'GORSE BLOOD':'BLOOD';
  const reservoir=new LiquidReservoir({kind:'circulation',originalBlood,enter:id=>effects.enter(part,id,reservoir),exit:id=>effects.exit(part,id,reservoir)});reservoir.addLiquid(originalBlood,1);
  return{world,part,body,entity,physical,ragdolls,person,limb,effects,reservoir,dose:(id:string,amount=.01)=>reservoir.addLiquid(id,amount)};
}

describe('source syringe liquid physiology',()=>{
  it('revives organic brain tissue immediately, restores native blood and heals bone/wounds over time',()=>{
    const x=setup();x.limb.health=0;x.person.brainDead=true;x.person.brainDamaged=true;x.person.consciousness=0;x.limb.broken=true;x.limb.bleedingRate=5;x.limb.internalBleeding=3;x.limb.blood=.2;x.reservoir.removeLiquid('BLOOD',.8);x.physical.state.burnProgress=1;x.physical.state.temperature=300;x.limb.acidProgress=.8;x.limb.rottenProgress=.5;x.limb.skinVisual.wounds=[{x:0,y:0,intensity:10,time:0,type:1}];
    x.dose('LIFE SERUM');
    expect(x.limb.health).toBe(50);expect(x.person.brainDead).toBe(false);expect(x.person.brainDamaged).toBe(false);expect(x.person.consciousness).toBe(1);expect(x.limb.broken).toBe(false);expect(x.limb.bleedingRate).toBe(0);expect(x.limb.internalBleeding).toBe(0);expect(x.reservoir.getAmount('BLOOD')).toBeCloseTo(1);expect(x.physical.state.temperature).toBe(37);
    for(let i=0;i<60;i++)x.effects.frame(1/60);
    expect(x.physical.state.burnProgress).toBeCloseTo(1-.16*(61/60));expect(x.limb.acidProgress).toBe(0);expect(x.limb.rottenProgress).toBe(0);expect(x.limb.skinVisual.wounds[0].intensity).toBeCloseTo(10*Math.pow(.5,61/60));
  });
  it('does not apply life serum to Androids',()=>{const x=setup('Android');x.limb.health=0;x.person.brainDead=true;x.dose('LIFE SERUM');expect(x.limb.health).toBe(0);expect(x.person.brainDead).toBe(true);});
  it('kills on the source one-second update callback rather than entry, including Androids',()=>{for(const species of ['Human','Android']){const x=setup(species);x.dose('INSTANT DEATH POISON');expect(x.limb.health).toBe(50);x.effects.tick(x.part,'INSTANT DEATH POISON',x.reservoir);expect(x.limb.health).toBe(0);expect(x.limb.isPump).toBe(false);}});
  it('uses post-removal concentration for knockout and the native squared temporary-removal chance',()=>{
    const removed=setup('Human',()=>.5);removed.person.consciousness=.6;removed.dose('KNOCKOUT POISON');removed.effects.tick(removed.part,'KNOCKOUT POISON',removed.reservoir);expect(removed.reservoir.getAmount('KNOCKOUT POISON')).toBe(0);expect(removed.person.consciousness).toBe(.6);
    const retained=setup();retained.dose('KNOCKOUT POISON');retained.effects.tick(retained.part,'KNOCKOUT POISON',retained.reservoir);expect(retained.person.consciousness).toBe(0);expect(retained.limb.numbness).toBe(1);
    const mending=setup('Human',()=>.5);mending.dose('MENDING SERUM');mending.effects.tick(mending.part,'MENDING SERUM',mending.reservoir);expect(mending.reservoir.getAmount('MENDING SERUM')).toBeGreaterThan(0);
  });
  it('retains the source double adrenaline and painkiller callbacks on retained update ticks',()=>{
    const adrenaline=setup();adrenaline.person.consciousness=.2;adrenaline.person.pain=.8;adrenaline.dose('ADRENALINE');expect(adrenaline.person.adrenaline).toBe(1);expect(adrenaline.person.consciousness).toBe(1);expect(adrenaline.person.pain).toBe(0);adrenaline.effects.tick(adrenaline.part,'ADRENALINE',adrenaline.reservoir);expect(adrenaline.person.adrenaline).toBe(3);
    const pain=setup();pain.person.pain=1;pain.person.shock=1;pain.dose('PAIN KILLER',.6);expect(pain.limb.health).toBeCloseTo(24.9);pain.effects.tick(pain.part,'PAIN KILLER',pain.reservoir);expect(pain.limb.health).toBeCloseTo(6.075);expect(pain.person.pain).toBeCloseTo(.001);expect(pain.limb.acidProgress).toBeCloseTo(.15);
  });
  it('uses joint lock rather than changing temperature for freeze poison',()=>{const x=setup();x.dose('FREEZE POISON');expect(x.limb.frozen).toBe(false);x.effects.tick(x.part,'FREEZE POISON',x.reservoir);expect(x.limb.frozen).toBe(true);expect(x.physical.state.temperature).toBe(37);});
  it('coagulates internal/external bleeding and breaks bones only at update time',()=>{
    const x=setup();x.limb.bleedingRate=4;x.limb.internalBleeding=3;x.dose('COAGULATION SERUM');expect(x.limb.bleedingRate).toBe(4);x.effects.tick(x.part,'COAGULATION SERUM',x.reservoir);expect(x.limb.bleedingRate).toBe(0);expect(x.limb.internalBleeding).toBe(0);
    x.dose('BONE EATING POISON');expect(x.limb.broken).toBe(false);x.effects.tick(x.part,'BONE EATING POISON',x.reservoir);expect(x.limb.broken).toBe(true);
  });
  it('mends tissue without the life-serum blood refill or guaranteed brain-damage reset',()=>{const x=setup('Human',()=>.9);x.person.brainDead=true;x.person.brainDamaged=true;x.limb.health=3;x.limb.bleedingRate=5;x.limb.blood=.3;x.reservoir.removeLiquid('BLOOD',.7);x.dose('MENDING SERUM');expect(x.limb.health).toBe(50);expect(x.limb.bleedingRate).toBe(4);expect(x.person.brainDead).toBe(false);expect(x.person.brainDamaged).toBe(true);expect(x.reservoir.getAmount('BLOOD')).toBeCloseTo(.3);});
  it('reanimates as zombie tissue without clearing acid or permanently unlocking a frozen joint',()=>{const x=setup();x.person.brainDead=true;x.limb.health=0;x.limb.acidProgress=.8;x.limb.frozen=true;x.dose('REANIMATION AGENT');expect(x.limb.config.IsZombie).toBe(true);expect(x.limb.health).toBe(50);expect(x.person.brainDead).toBe(false);expect(x.limb.acidProgress).toBe(.8);expect(x.limb.frozen).toBe(true);});
  it('restores oxygen with persistent water-breathing serum and preserves Android immunity',()=>{for(const species of ['Human','Android']){const x=setup(species);x.person.oxygen=.2;x.dose('WATER BREATHING SERUM');x.effects.tick(x.part,'WATER BREATHING SERUM',x.reservoir);expect(x.person.oxygen).toBe(species==='Human'?1:.2);expect(x.reservoir.getAmount('WATER BREATHING SERUM')).toBeCloseTo(.01);}});
  it('strengthens only the injected instance and persists permanent serum modifiers on save',()=>{
    const x=setup(),otherBody=x.world.createDynamicBody();otherBody.createFixture(Box(.2,.2),{density:1});const otherPart={...x.part,body:otherBody},otherEntity={...x.entity,id:2,parts:[otherPart]};const other=x.ragdolls.attach(otherEntity)!.limbs[0];
    x.dose('ULTRA STRENGTH SERUM');expect(x.limb.initialHealth).toBe(400);expect(x.limb.config.BaseStrength).toBe(13);expect(other.initialHealth).toBe(50);expect(other.config.BaseStrength).toBe(8);
    x.effects.tick(x.part,'ULTRA STRENGTH SERUM',x.reservoir);expect(x.limb.initialHealth).toBe(750);expect(x.limb.config.BaseStrength).toBe(15);x.dose('REANIMATION AGENT');const saved=x.ragdolls.snapshot(x.entity)!;
    const restored=setup();expect(restored.ragdolls.restore(restored.entity,JSON.parse(JSON.stringify(saved)))).toBe(true);expect(restored.limb.initialHealth).toBe(750);expect(restored.limb.config.BaseStrength).toBe(15);expect(restored.limb.config.ShotDamageMultiplier).toBeCloseTo(.01);expect(restored.limb.config.IsZombie).toBe(true);
  });
  it('corrodes Human/Android tissue at different source rates while Gorse resists its own acid',()=>{for(const species of ['Human','Android','Gorse']){const x=setup(species);x.dose('ACID');x.effects.frame(.03);expect(x.limb.acidProgress).toBeCloseTo(species==='Human'?.004:species==='Android'?.0004:0);}});
  it('resumes healing/corrosion work after restore without replaying one-shot healing or strengthening',()=>{
    const x=setup();x.reservoir.distribution.set('LIFE SERUM',{amount:.01,previous:.01});x.limb.health=20;x.physical.state.burnProgress=.8;x.effects.resume(x.part,'LIFE SERUM',x.reservoir);x.effects.resume(x.part,'LIFE SERUM',x.reservoir);x.effects.frame(.5);expect(x.limb.health).toBe(20);expect(x.physical.state.burnProgress).toBeCloseTo(.72);
    x.reservoir.distribution.set('ACID',{amount:.01,previous:.01});x.effects.resume(x.part,'ACID',x.reservoir);x.effects.frame(.03);expect(x.limb.acidProgress).toBe(.002);
  });
  it('does not repeatedly apply the permanent pink-serum entry mutation during update',()=>{const x=setup();x.dose('REGENERATION SERUM');expect(x.limb.config.RegenerationSpeed).toBeCloseTo(1.1);x.effects.tick(x.part,'REGENERATION SERUM',x.reservoir);expect(x.limb.config.RegenerationSpeed).toBeCloseTo(1.1);});
  it('records unsupported native Rigidbody validation instead of inventing mass-agent behavior',()=>{const x=setup();const mass=x.body.getMass();x.dose('MASS AGENT');expect(x.body.getMass()).toBe(mass);expect([...x.effects.unsupported].some(value=>value.includes('MASS AGENT'))).toBe(true);});
  it('releases active healing jobs when their entity is removed',()=>{const x=setup();x.physical.state.burnProgress=.8;x.dose('LIFE SERUM');const before=x.physical.state.burnProgress;x.effects.remove(x.entity);x.effects.frame(1);expect(x.physical.state.burnProgress).toBe(before);});
});
