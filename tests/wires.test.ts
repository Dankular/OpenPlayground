import { describe, it, expect } from 'vitest';
import { Simulation, type Entity } from '../src/simulation';
import { PhysicalSystem } from '../src/systems/physical-world';
import { WireSystem, cableBreakForce, transferWireEnergy, wireVertices, type WireEndpoint } from '../src/systems/wires';

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
