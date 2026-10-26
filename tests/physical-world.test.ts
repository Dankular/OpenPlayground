import { describe, expect, it } from 'vitest';
import { Simulation, type Entity, type Part } from '../src/simulation';
import { PhysicalSystem } from '../src/systems/physical-world';

function configure(entity: Entity, properties: Record<string, unknown>): Part {
  const part = entity.parts[0];
  part.metadata = { nodeId: 'test', components: [{ type: 'MonoBehaviour', className: 'PhysicalBehaviour', pathId: '1',
    data: { AmbientTemperatureTransfer: 0 }, properties: { data: properties } } as never] };
  return part;
}

describe('physical system integration', () => {
  it('uses extracted materials and transfers heat/charge through real touching Planck fixtures', () => {
    const sim = new Simulation(), system = new PhysicalSystem({ random: () => 0 });
    const a = sim.spawn('box', 0, 0), b = sim.spawn('box', .88, 0);
    const ap = configure(a, { Conducting: 1, HeatTransferSpeedMultiplier: 1 });
    const bp = configure(b, { Conducting: 1, HeatTransferSpeedMultiplier: 1 });
    system.attach(a); system.attach(b);
    const pa = system.get(ap)!, pb = system.get(bp)!;
    pa.state.temperature = 400; pb.state.temperature = 0; pa.state.charge = 100;
    sim.step(); system.afterStep(.02);
    expect(pb.state.temperature).toBeGreaterThan(0); expect(pa.state.temperature).toBeLessThan(400);
    expect(pb.state.charge).toBe(80);
    system.remove(a); expect(system.get(ap)).toBeUndefined(); expect(system.objects.size).toBe(1);
  });
  it('does not confuse frozen rigidbodies with Unity static scene objects', () => {
    const sim = new Simulation(), system = new PhysicalSystem({ random: () => 0 });
    const wood = sim.spawn('box', 0, 0); const part = configure(wood, { Flammability: .4, Burnrate: .02, BurningTemperatureThreshold: 300 });
    system.attach(wood); sim.freeze(wood); system.ignite(wood, true);
    system.beforeStep(.02);
    expect(system.get(part)!.state.onFire).toBe(true); expect(system.get(part)!.state.temperature).toBeGreaterThan(18);
  });
});
