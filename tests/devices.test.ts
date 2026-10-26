import { describe, expect, it } from 'vitest';
import { Simulation, type Entity } from '../src/simulation';
import { PhysicalSystem } from '../src/systems/physical-world';
import { DeviceSystem } from '../src/systems/devices';

function setup(kind: string, data: Record<string, unknown>) {
  const sim = new Simulation(); const entity: Entity = sim.spawn('box', 0, 5);
  entity.parts[0].metadata = { nodeId: 'test', components: [
    { type: 'MonoBehaviour', className: 'PhysicalBehaviour', pathId: '1', data: {} },
    { type: 'MonoBehaviour', className: kind, pathId: '2', data },
  ] };
  const physical = new PhysicalSystem(); physical.attach(entity);
  const devices = new DeviceSystem(physical); devices.attach(entity);
  sim.beforeStep.push(dt => devices.beforeStep(dt));
  return { sim, entity, physical, devices };
}
describe('reconstructed machinery controllers', () => {
  it('uses and warms a generator with its serialized charging rate', () => {
    const { entity, physical, devices } = setup('GeneratorBehaviour', { TargetCharge: 100, TargetEnergyReachSpeed: .1 });
    expect(devices.use(entity)).toBe(true);
    devices.frame(.1); devices.frame(.1);
    expect(physical.get(entity.parts[0])!.state.charge).toBeCloseTo(60);
    devices.frame(.1); expect(physical.get(entity.parts[0])!.state.charge).toBe(100);
    devices.beforeStep(.02); expect(physical.get(entity.parts[0])!.state.temperature).toBeGreaterThan(18);
    devices.use(entity); expect(devices.get(entity)[0].active).toBe(false);
  });
  it('heats or cools toward a target without crossing it', () => {
    const { entity, physical, devices } = setup('HeatingElementBehaviour', { Activated: 1, TargetTemperature: 400, HeatTargetSpeed: .1 });
    for (let i = 0; i < 100; i++) devices.beforeStep(.02);
    const temperature = physical.get(entity.parts[0])!.state.temperature;
    expect(temperature).toBeGreaterThan(399); expect(temperature).toBeLessThan(400);
    devices.use(entity); devices.beforeStep(.02); expect(physical.get(entity.parts[0])!.state.temperature).toBe(temperature);
  });
  it('cancels gravity on an activated hoverbox without changing mass or gravity settings', () => {
    const { sim, entity } = setup('HoverboxBehaviour', { Activated: 1 });
    const body = entity.parts[0].body, initial = body.getPosition().y;
    for (let i = 0; i < 100; i++) sim.step();
    expect(body.getPosition().y).toBeCloseTo(initial, 7); expect(body.getGravityScale()).toBe(1);
  });
  it('applies recovered ion-thruster force along the transformed direction', () => {
    const { sim, entity } = setup('IonThrusterBehaviour', { Activated: 1, Thrust: 10, LocalDirection: { x: -1, y: 0 } });
    sim.step(); expect(entity.parts[0].body.getLinearVelocity().x).toBeGreaterThan(0);
  });
});
