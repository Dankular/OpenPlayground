import {describe,expect,it} from 'vitest';
import {Box,Vec2} from 'planck';
import {Simulation} from '../src/simulation';
import type {SourceComponent} from '../src/prefabs';
import {LiquidSystem} from '../src/systems/liquids';
import {RagdollSystem} from '../src/systems/ragdoll';
import {SyringeBreakSystem} from '../src/systems/syringe-break';

const component=(className:string,pathId:string,data:Record<string,unknown>={}):SourceComponent=>({type:'MonoBehaviour',className,pathId,data});
function fixture(species='Human'){
  const sim=new Simulation(),ragdolls=new RagdollSystem();
  const patient=sim.spawn('box',0,5),part=patient.parts[0];
  part.metadata={nodeId:'patient',components:[component('LimbBehaviour','limb',{Health:50,HasBrain:true,SpeciesIdentity:species}),component('CirculationBehaviour','blood',{IsPump:true}),component('ConnectedNodeBehaviour','node',{IsRoot:true})]};
  patient.metadata={nodes:[{id:'patient',name:'Patient',parentId:null,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,components:[component('PersonBehaviour','person',{Poses:[]})]}]};
  ragdolls.attach(patient);
  const syringe=sim.spawn('box',1,5),needle=syringe.parts[0];
  needle.metadata={nodeId:'syringe',components:[component('LifeSyringe','syringe')]};
  const liquids=new LiquidSystem();liquids.attach(patient);liquids.attach(syringe);
  const breaks=new SyringeBreakSystem(sim,liquids,ragdolls);
  sim.onRemove.push(e=>liquids.remove(e),e=>breaks.remove(e));
  return{sim,ragdolls,patient,part,syringe,needle,liquids,breaks};
}
describe('broken syringe liquid splash',()=>{
  it('delays entrance bullet break then spreads liquid to nearby organic circulation',()=>{
    const {sim,syringe,needle,liquids,part,breaks}=fixture();
    breaks.shot(needle);breaks.beforeStep(.04);breaks.afterStep();expect(sim.entities).toContain(syringe);
    breaks.beforeStep(.011);breaks.afterStep();expect(sim.entities).not.toContain(syringe);
    expect(liquids.get(part)!.getAmount('LIFE SERUM')).toBeGreaterThan(0);
  });
  it('breaks on fragments while excluding androids and distant patients',()=>{
    const android=fixture('Android');android.breaks.fragment(android.needle);android.breaks.beforeStep(.02);android.breaks.afterStep();
    expect(android.liquids.get(android.part)!.getAmount('LIFE SERUM')).toBe(0);
    const distant=fixture();distant.part.body.setPosition({x:20,y:5});distant.breaks.fragment(distant.needle);distant.breaks.beforeStep(.02);distant.breaks.afterStep();
    expect(distant.liquids.get(distant.part)!.getAmount('LIFE SERUM')).toBe(0);
  });
  it('keeps an empty syringe intact, as the native liquid-empty guard does',()=>{
    const {sim,syringe,needle,liquids,breaks}=fixture();liquids.get(needle)!.clearLiquid();
    breaks.shot(needle,true);breaks.beforeStep(.02);breaks.afterStep();expect(sim.entities).toContain(syringe);
  });
  it('excludes trigger fixtures from the native overlap denominator',()=>{
    const {sim,needle,liquids,part,breaks}=fixture();
    sim.world.createBody({position:Vec2(0,5)}).createFixture(Box(2,2),{isSensor:true});
    breaks.fragment(needle);breaks.beforeStep(.02);breaks.afterStep();
    expect(liquids.get(part)!.getAmount('LIFE SERUM')).toBeCloseTo(2.1);
  });
});
