import { describe,expect,it } from 'vitest';
import { Simulation } from '../src/simulation';
import { PhysicalSystem } from '../src/systems/physical-world';
import { MachinerySystem } from '../src/systems/machinery';
import { DeviceSystem } from '../src/systems/devices';

function fixture(extra:Record<string,unknown>={}) {
  const sim=new Simulation(),entity=sim.spawn('box',0,4),part=entity.parts[0];
  const generator={type:'MonoBehaviour',className:'GeneratorBehaviour',pathId:'generator',data:{Activated:1,TargetCharge:100}};
  part.metadata={nodeId:'machine',components:[{type:'MonoBehaviour',pathId:'physical',className:'PhysicalBehaviour',data:{}},generator,{type:'MonoBehaviour',pathId:'machinery',className:'DamagableMachineryBehaviour',data:{Health:10,FirearmDamageMultiplier:.5,ExplosionDamageMultiplier:2,StabDamageMultiplier:3,BreakDamage:4,TemperatureThreshold:200,Waterproof:true,BehavioursToToggle:[{m_PathID:'generator'}],GameObjectsToToggle:[{m_PathID:'light'}],...extra}}]};
  const physical=new PhysicalSystem();physical.attach(entity);
  const machinery=new MachinerySystem(physical,{random:()=>1});machinery.attach(entity);
  const devices=new DeviceSystem(physical,{isDisabled:(e,c)=>machinery.isDisabled(e,c)});devices.attach(entity);
  return{sim,entity,part,generator,physical,machinery,devices,state:machinery.get(entity)[0]};
}
describe('shared machinery failure and repair',()=>{
  it('uses serialized bullet damage and stops only the referenced controller when broken',()=>{
    const {machinery,part,state,entity,generator,devices,physical}=fixture();
    machinery.shot(part,10);expect(state.health).toBe(5);expect(state.destroyed).toBe(false);
    machinery.shot(part,10);expect(state.destroyed).toBe(true);expect(machinery.isDisabled(entity,generator)).toBe(true);
    expect(machinery.nodeDisabled(entity,'light')).toBe(true);expect(machinery.nodeDisabled(entity,'other')).toBe(false);
    devices.frame(1);expect(physical.get(part)!.state.charge).toBe(0);expect(devices.use(entity)).toBe(false);
    machinery.repair(entity);expect(state.health).toBe(10);expect(machinery.isDisabled(entity,generator)).toBe(false);
    devices.frame(1);devices.frame(1);expect(physical.get(part)!.state.charge).toBe(100);
  });
  it('breaks at native thermal and wetness conditions, respecting shields',()=>{
    const {machinery,part,state,physical,entity}=fixture({Waterproof:false});
    const p=physical.get(part)!;p.state.temperature=201;state.heatShielded=true;
    machinery.beforeStep();expect(state.destroyed).toBe(false);
    state.heatShielded=false;machinery.beforeStep();expect(state.destroyed).toBe(true);
    machinery.repair(entity);expect(p.state.temperature).toBe(199);
    p.state.wetness=1;machinery.beforeStep();expect(state.destroyed).toBe(true);
  });
  it('honors indestructibility, source fragment scaling and permanent EMP damage',()=>{
    const {machinery,part,state,entity}=fixture();state.indestructible=true;
    machinery.slice(part);machinery.fragment(part,100);expect(state.health).toBe(10);
    state.indestructible=false;machinery.fragment(part,.01);expect(state.health).toBe(5);
    machinery.emp(part,true);expect(state.destroyed).toBe(true);expect(state.canRepair).toBe(false);
    machinery.repair(entity);expect(state.destroyed).toBe(true);
  });
  it('round trips health and rejects malformed state without changing health',()=>{
    const {machinery,part,state,entity}=fixture();machinery.stab(part);const saved=machinery.snapshot(entity);
    machinery.slice(part);expect(machinery.restore(entity,saved)).toBe(true);expect(state.health).toBe(7);
    expect(machinery.restore(entity,[{id:'machinery',health:-1}])).toBe(false);expect(state.health).toBe(7);
  });
});
