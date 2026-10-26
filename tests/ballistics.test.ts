import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation';
import { PhysicalSystem } from '../src/systems/physical-world';
import { BallisticsSystem, bulletDamageMultiplier, materialHardness, type BulletHit } from '../src/systems/ballistics';
const cartridge = { Damage: 20, Recoil: 1, ImpactForce: 1, StartSpeed: 100, PenetrationRandomAngleMultiplier: 0 };

describe('reconstructed ballistics traversal', () => {
  it('hits the nearest target without hitting the source and reports entry then exit', () => {
    const sim = new Simulation(), physical = new PhysicalSystem(), hits: BulletHit[] = [];
    const gun = sim.spawn('box', 0, 5), target = sim.spawn('box', 3, 5);
    const system = new BallisticsSystem(sim.world, physical, { onHit: hit => hits.push(hit), random: () => 1 });
    system.attach(gun); system.attach(target);
    system.emit(gun, { x: .6, y: 5.45 }, { x: 1, y: 0 }, cartridge);
    for (let i = 0; i < 15; i++) system.step(.02);
    expect(hits[0].part).toBe(target.parts[0]); expect(hits[0].exit).toBeUndefined();
    expect(hits.some(hit => hit.exit)).toBe(true); expect(hits.every(hit => hit.part !== gun.parts[0])).toBe(true);
    expect(hits[0].damage).toBeGreaterThan(0);
  });
  it('advances a tracer through empty space and applies charge to the hit object', () => {
    const sim = new Simulation(), physical = new PhysicalSystem();
    const gun = sim.spawn('box', 0, 5), target = sim.spawn('box', 20, 5);
    target.parts[0].metadata = { nodeId: 'target', components: [{ type: 'MonoBehaviour', className: 'PhysicalBehaviour', pathId: '1', data: { EnergyWireResistance: .5 } }] };
    physical.attach(target); let traces = 0;
    const system = new BallisticsSystem(sim.world, physical, { onTrace: () => traces++, random: () => 1 });
    system.attach(gun); system.attach(target); system.emit(gun, { x: .6, y: 5.45 }, { x: 1, y: 0 }, cartridge, 200);
    expect(system.activeBulletCount).toBe(1);
    for (let i = 0; i < 5; i++) system.step(.02);
    expect(traces).toBeGreaterThan(1); expect(physical.get(target.parts[0])!.state.charge).toBe(100);
    system.remove(gun); expect(system.activeBulletCount).toBe(0);
  });
  it('stops on nonpenetrable materials and keeps distance damage bounded', () => {
    const sim = new Simulation(), physical = new PhysicalSystem();
    const gun = sim.spawn('box', 0, 5), target = sim.spawn('box', 3, 5);
    target.parts[0].metadata = { nodeId: '', components: [{ type: 'MonoBehaviour', className: 'PhysicalBehaviour', pathId: '', data: { BulletPenetration: 0 } }] };
    const system = new BallisticsSystem(sim.world, physical, { random: () => 1 });
    system.attach(gun); system.attach(target); system.emit(gun, { x: .6, y: 5.45 }, { x: 1, y: 0 }, cartridge);
    system.step(.02); expect(system.activeBulletCount).toBe(0);
    expect(bulletDamageMultiplier(0)).toBe(10); expect(bulletDamageMultiplier(1000)).toBe(.5);
    expect(materialHardness(0, 0)).toBeCloseTo(3.15); expect(materialHardness(1, 0, 2)).toBe(2);
  });
});
