import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation';
import type { SourceComponent } from '../src/prefabs';
import { PhysicalSystem } from '../src/systems/physical-world';
import { RagdollSystem } from '../src/systems/ragdoll';
import { DefibrillatorSystem } from '../src/systems/defibrillator';

const component = (className:string,pathId:string,data:Record<string,unknown>={}):SourceComponent => ({type:'MonoBehaviour',className,pathId,data});
function fixture() {
  const sim = new Simulation(), physical = new PhysicalSystem(), ragdolls = new RagdollSystem();
  const patient = sim.spawn('box', 0, 5), part = patient.parts[0];
  part.metadata = {nodeId:'patient',components:[component('LimbBehaviour','limb',{Health:50,HasBrain:true}),component('CirculationBehaviour','blood',{IsPump:true}),component('ConnectedNodeBehaviour','node',{IsRoot:true})]};
  patient.metadata = {nodes:[{id:'patient',name:'Patient',parentId:null,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,components:[component('PersonBehaviour','person',{Poses:[]})]}]};
  const person = ragdolls.attach(patient)!, limb = person.limbs[0];
  const device = sim.spawn('box', 5, 5), pad = sim.spawn('box', .1, 5).parts[0];
  // The native pointers reference PhysicalBehaviour components, not rigidbodies.
  pad.metadata = {nodeId:'pad',components:[component('PhysicalBehaviour','pad-physical')]};
  device.parts.push(pad);
  device.parts[0].metadata = {nodeId:'unit',components:[component('DefibrillatorBehaviour','defib',{Pad1:{m_PathID:'pad-physical'},Pad2:{m_PathID:0}})]};
  physical.attach(device);
  const clips:unknown[] = [], defib = new DefibrillatorSystem(physical,ragdolls,{playClip:(_c,p)=>clips.push(p),clipDuration:()=>.5});
  defib.attach(device);
  return {sim,physical,ragdolls,person,limb,device,pad,clips,defib};
}
describe('source defibrillator routine',()=>{
  it('waits two simulation seconds and restores circulation only at the pad',()=>{
    const {defib,device,limb,person,physical,pad}=fixture();
    limb.isPump=false;limb.bloodFlow=0;person.consciousness=0;person.brainDead=true;limb.health=0;
    expect(defib.use(device)).toBe(true);expect(defib.use(device)).toBe(false);
    defib.beforeStep(1.99);expect(limb.isPump).toBe(false);
    defib.beforeStep(.01);
    expect(limb.isPump).toBe(true);expect(limb.bloodFlow).toBe(1);expect(person.consciousness).toBe(1);expect(person.adrenaline).toBe(20);
    expect(person.brainDead).toBe(true);expect(limb.health).toBe(0);
    expect(physical.get(pad)!.state.charge).toBeCloseTo(.2);
    expect(defib.get(device)[0].phase).toBe('clear');defib.beforeStep(.5);expect(defib.get(device)[0].phase).toBe('idle');
  });
  it('does not affect a patient away from either transformed pad',()=>{
    const {defib,device,person,pad}=fixture();
    pad.body.setPosition({x:9,y:5});person.consciousness=0;
    defib.use(device);defib.beforeStep(2);expect(person.consciousness).toBe(0);
  });
  it('preserves a pending activation and rejects invalid timer state atomically',()=>{
    const {defib,device}=fixture();defib.use(device);defib.beforeStep(1);
    const saved=defib.snapshot(device);defib.beforeStep(1);
    expect(defib.restore(device,saved)).toBe(true);expect(defib.get(device)[0].phase).toBe('standby');
    expect(defib.restore(device,[{id:'defib',phase:'standby',remaining:NaN}])).toBe(false);
    expect(defib.get(device)[0].remaining).toBe(1);
  });
});
