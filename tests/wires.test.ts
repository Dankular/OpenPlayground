import { describe, it, expect } from 'vitest';
import { Simulation, type Entity } from '../src/simulation';
import { PhysicalSystem } from '../src/systems/physical-world';
import { WireSystem, cableBreakForce, transferWireEnergy, wireVertices, type WireEndpoint } from '../src/systems/wires';
import {LiquidReservoir,LiquidSystem,PressureDirection} from '../src/systems/liquids';
import {DistanceJoint,WeldJoint} from 'planck';

function setup(count = 3) {
  const sim = new Simulation(), physical = new PhysicalSystem();
  const entities = Array.from({ length: count }, (_, i) => {
    const entity = sim.spawn('box', i * 2, 4);
    entity.parts[0].metadata = { nodeId: String(i), components: [{ type: 'MonoBehaviour', className: 'PhysicalBehaviour', pathId: String(i), data: { ActivationPropagationDelay: .1, SendUserPropagation: 1 } }] };
    physical.attach(entity); return entity;
  });
  const endpoint = (entity: Entity): WireEndpoint => ({ entity, part: entity.parts[0], anchor: { x: 0, y: 0 } });
  return { sim, physical, entities, endpoint };
}
describe('source wire mechanics and signal propagation', () => {
  it('enforces rigid length and welded relative orientation through real solver steps',()=>{
    for(const kind of ['rigid','fixed'] as const){
      const {sim,physical,entities:[a,b],endpoint}=setup(2);sim.world.setGravity({x:0,y:0});
      const wire=new WireSystem(sim.world,physical).connect(kind,endpoint(a),endpoint(b));
      expect(kind==='fixed'?wire.joint instanceof WeldJoint:wire.joint instanceof DistanceJoint).toBe(true);
      b.parts[0].body.setLinearVelocity({x:10,y:0});b.parts[0].body.setAngularVelocity(4);
      for(let i=0;i<80;i++)sim.world.step(.02);
      const p=a.parts[0].body.getPosition(),q=b.parts[0].body.getPosition();
      expect(Math.hypot(p.x-q.x,p.y-q.y)).toBeCloseTo(2,1);
      if(kind==='fixed')expect(b.parts[0].body.getAngle()-a.parts[0].body.getAngle()).toBeCloseTo(0,3);
    }
  });
  it('restores spring versus strong-spring source frequencies and bandage damping',()=>{
    const {sim,physical,entities:[a,b],endpoint}=setup(2),wires=new WireSystem(sim.world,physical);
    for(const [kind,frequency]of [['spring',2],['strong-spring',8],['bandage',3]] as const){
      const wire=wires.connect(kind,endpoint(a),endpoint(b));expect((wire.joint as DistanceJoint).getFrequency()).toBe(frequency);
      if(kind==='bandage')expect((wire.joint as DistanceJoint).getDampingRatio()).toBe(.2);
    }
    const snapshot=wires.snapshot([a,b]);wires.clear();expect(wires.restore(snapshot,[a,b])).toBe(true);
    expect(wires.snapshot([a,b])).toEqual(snapshot);
  });
  it('moves a blood mixture along pressure gradients before equalizing pressure',()=>{
    const {sim,physical,entities:[a,b],endpoint}=setup(2);
    const from=new LiquidReservoir({capacity:10,allowsOverflow:false}),to=new LiquidReservoir({capacity:10,allowsOverflow:false});
    from.addLiquid('BLOOD',1.4);from.addLiquid('LIFE SERUM',.6);from.measuredPressure=100;
    const wires=new WireSystem(sim.world,physical,{getContainer:p=>p===a.parts[0]?from:to});
    const wire=wires.connect('blood',endpoint(a),endpoint(b));wires.beforeStep(.1);
    expect(to.getAmount('BLOOD')).toBeCloseTo(.14);expect(to.getAmount('LIFE SERUM')).toBeCloseTo(.06);
    expect(from.measuredPressure).toBe(95);expect(to.measuredPressure).toBe(5);expect(wire.flow).toBeCloseTo(.18);
    from.measuredPressure=-100;to.measuredPressure=100;wires.beforeStep(.05);
    expect(to.total).toBeCloseTo(.1);expect(from.total).toBeCloseTo(1.9);
  });
  it('allows a pump to transmit pressure without accepting blood-wire liquid transfer',()=>{
    const {sim,physical,entities:[a,b],endpoint}=setup(2);
    a.parts[0].metadata!.components.push({type:'MonoBehaviour',className:'LiquidPumpBehaviour',pathId:'pump',data:{Mode:2}});
    b.parts[0].metadata!.components.push({type:'MonoBehaviour',className:'LiquidCanisterBehaviour',pathId:'canister',data:{Capacity:70}});
    const liquids=new LiquidSystem();liquids.attach(a);liquids.attach(b);
    expect(liquids.canUse(a)).toBe(true);liquids.use(a);expect(liquids.get(a.parts[0])!.pressureMode).toBe(PressureDirection.Push);
    liquids.frame(1);liquids.get(b.parts[0])!.addLiquid('BLOOD',1);
    const wires=new WireSystem(sim.world,physical,{getContainer:p=>liquids.get(p)});wires.connect('blood',endpoint(a),endpoint(b));wires.beforeStep(.02);
    expect(liquids.get(b.parts[0])!.measuredPressure).toBeGreaterThan(0);expect(liquids.get(a.parts[0])!.total).toBe(0);
    const saved=liquids.snapshot(a);liquids.use(a);expect(liquids.restore(a,saved)).toBe(true);expect(liquids.get(a.parts[0])!.pressureMode).toBe(PressureDirection.Push);
    liquids.use(a,1);expect(liquids.get(a.parts[0])!.pressureMode).toBe(PressureDirection.None);
  });
  it('cleans world-anchor helper bodies after deletion and failed staged restores',()=>{
    const {sim,physical,entities:[a],endpoint}=setup(1),wires=new WireSystem(sim.world,physical);
    const initial=sim.world.getBodyCount();const wire=wires.connect('rope',endpoint(a),{part:null,entity:null,anchor:{x:0,y:5}});
    expect(sim.world.getBodyCount()).toBe(initial+1);wires.disconnect(wire);expect(sim.world.getBodyCount()).toBe(initial);
    wires.connect('rope',endpoint(a),{part:null,entity:null,anchor:{x:0,y:5}});const saved=wires.snapshot([a]);wires.clear();
    expect(wires.restore([...saved,{...saved[0],length:-1}],[a])).toBe(false);expect(sim.world.getBodyCount()).toBe(initial);
  });
  it('transfers charge using source wire resistance and .89 fixed-rate rules without requiring conducting materials', () => {
    const { physical, entities } = setup(2), a = physical.get(entities[0].parts[0])!, b = physical.get(entities[1].parts[0])!;
    a.state.charge = 100; a.settings.EnergyWireResistance = .5;
    transferWireEnergy(a, b); expect(a.state.charge).toBe(100); expect(b.state.charge).toBe(44.5);
    b.settings.EnergyWireResistance = 4; transferWireEnergy(a, b);
    expect(a.state.charge).toBeCloseTo(169.42);
  });
  it('supports actual tether constraints and the source heat-pipe weighted exchange', () => {
    const { sim, physical, entities: [a, b], endpoint } = setup(2), wires = new WireSystem(sim.world, physical);
    const wire = wires.connect('heat', endpoint(a), endpoint(b));
    physical.get(a.parts[0])!.state.temperature = 200; physical.get(b.parts[0])!.state.temperature = 0;
    wires.beforeStep(.02); expect(physical.get(b.parts[0])!.state.temperature).toBeGreaterThan(0);
    expect(wireVertices(wire)).toHaveLength(2); expect(sim.world.getJointCount()).toBe(1);
    wires.remove(a); expect(sim.world.getJointCount()).toBe(0); expect(wires.wires.size).toBe(0);
  });
  it('delays directional activation, rejects cycles, and preserves channel filtering', () => {
    const { sim, physical, entities: [a, b, c], endpoint } = setup(), received: string[] = [];
    const wires = new WireSystem(sim.world, physical, { onUse: (e, channel) => received.push(`${e.id}:${channel}`) });
    wires.connect('activation', endpoint(a), endpoint(b), { channel: 1 });
    wires.connect('activation', endpoint(b), endpoint(c), { channel: 1 });
    wires.connect('activation', endpoint(c), endpoint(a), { channel: 1 });
    wires.connect('activation', endpoint(b), endpoint(a), { channel: 2 });
    wires.activate(a); wires.beforeStep(.05); expect(received).toEqual([]);
    wires.beforeStep(.05); expect(received).toEqual([`${b.id}:1`]);
    wires.beforeStep(.1); expect(received).toEqual([`${b.id}:1`, `${c.id}:1`]);
    for (let i = 0; i < 10; i++) wires.beforeStep(.1);
    expect(received).toHaveLength(2);
  });
  it('respects disabled direct propagation and removes pending signals with deleted connections', () => {
    const { sim, physical, entities: [a, b], endpoint } = setup(2); let received = 0;
    const wires = new WireSystem(sim.world, physical, { onUse: () => received++ });
    const wire = wires.connect('activation', endpoint(a), endpoint(b));
    a.parts[0].metadata!.components[0].data.SendUserPropagation = 0;
    wires.activate(a); wires.beforeStep(1); expect(received).toBe(0);
    a.parts[0].metadata!.components[0].data.SendUserPropagation = 1;
    wires.activate(a); wires.disconnect(wire); wires.beforeStep(1); expect(received).toBe(0);
  });
  it('routes a selected body through its own wire without activating sibling-body connections',()=>{
    const {sim,physical,entities:[a,b,c],endpoint}=setup();
    const child=sim.world.createDynamicBody({position:{x:0,y:6}}),otherPart={...a.parts[0],id:'other-body',body:child,metadata:{nodeId:'other',components:a.parts[0].metadata!.components}};
    a.parts.push(otherPart);
    const received:number[]=[],wires=new WireSystem(sim.world,physical,{onUse:e=>received.push(e.id)});
    wires.connect('activation',endpoint(a),endpoint(b));
    wires.connect('activation',{entity:a,part:otherPart,anchor:{x:0,y:0}},endpoint(c));
    wires.activate(a,0,false,a.parts[0]);wires.beforeStep(.1);
    expect(received).toEqual([b.id]);
  });
  it('uses mass and combustion in copper/rope breaking and keeps slack vertices finite', () => {
    const { sim, physical, entities: [a, b], endpoint } = setup(2), wires = new WireSystem(sim.world, physical);
    expect(cableBreakForce(250, 2, 4)).toBe(625);
    const wire = wires.connect('copper', endpoint(a), endpoint(b), { length: 4 });
    expect(wireVertices(wire).every(v => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
    expect(wireVertices(wire)[6].y).toBeLessThan(a.parts[0].body.getPosition().y);
    physical.get(a.parts[0])!.state.burnProgress = 1;
    wires.afterStep(.02); expect(wires.wires.size).toBe(0); expect(sim.world.getJointCount()).toBe(0);
  });
  it('round trips references and anchors, rolls back invalid restores without losing existing wires', () => {
    const { sim, physical, entities, endpoint } = setup(), wires = new WireSystem(sim.world, physical);
    wires.connect('energy', endpoint(entities[0]), endpoint(entities[1]));
    const saved = JSON.parse(JSON.stringify(wires.snapshot(entities))); wires.clear();
    expect(wires.restore(saved, entities)).toBe(true); expect(wires.snapshot(entities)).toEqual(saved);
    const invalid = [...saved, { ...saved[0], a: { ...saved[0].a, entity: 99 } }];
    expect(wires.restore(invalid, entities)).toBe(false); expect(wires.wires.size).toBe(1);
    expect(sim.world.getJointCount()).toBe(1);
  });
});
