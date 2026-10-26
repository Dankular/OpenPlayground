import { describe, expect, it } from 'vitest';
import { averageTemperature, conductContact, createPhysicalObject, extinguish, getCharge, getHeatCapacity, heatFromSliding, ignite, stepPhysical, updatePhysicalFrame } from '../src/systems/physical';

const metal = (mass = 1, temp = 20) => createPhysicalObject({ ambientTemperature: temp, mass, width: 1, height: 1, properties: { Conducting: true } });

describe('recovered thermal and electrical behavior', () => {
  it('conserves thermal energy between different heat capacities without overshoot', () => {
    const hot = metal(80, 500), cold = metal(20, 0);
    const energy = () => hot.state.temperature * getHeatCapacity(hot) + cold.state.temperature * getHeatCapacity(cold);
    const before = energy();
    for (let i = 0; i < 400; i++) averageTemperature(hot, cold);
    expect(energy()).toBeCloseTo(before, 8);
    expect(hot.state.temperature).toBeGreaterThan(cold.state.temperature);
    expect(cold.state.temperature).toBeGreaterThan(0);
    expect(hot.state.temperature).toBeLessThan(500);
  });
  it('discharges at the recovered .95 factor per fixed step and conducts only allowed materials', () => {
    const a = metal(), b = metal(); a.state.charge = 100;
    stepPhysical(a, 20, () => 0); expect(getCharge(a)).toBe(95);
    conductContact(a, b); expect(getCharge(b)).toBe(76);
    b.properties.Conducting = false; b.state.charge = 0;
    conductContact(a, b); expect(getCharge(b)).toBe(0);
    a.settings.ForceNoCharge = true; expect(getCharge(a)).toBe(0);
  });
  it('ignites combustible material, grows burning heat, and extinguishes when wet', () => {
    const wood = createPhysicalObject({ ambientTemperature: 20, mass: 1, width: 1, height: 1,
      properties: { Flammability: 1, Burnrate: .7, BurningTemperatureThreshold: 200 } });
    expect(ignite(wood, 0)).toBe(true);
    for (let i = 0; i < 50; i++) { stepPhysical(wood, 20, () => 0); updatePhysicalFrame(wood, .02, 1); }
    expect(wood.state.temperature).toBeGreaterThan(200);
    expect(wood.state.burnProgress).toBeGreaterThan(0);
    expect(wood.state.burnIntensity).toBeCloseTo(.1);
    wood.state.wetness = 1; updatePhysicalFrame(wood, .02, 1);
    expect(wood.state.onFire).toBe(false); expect(wood.state.burnIntensity).toBe(0);
    expect(wood.state.temperature).toBeLessThanOrEqual(200);
  });
  it('respects incombustible and static objects and disabled temperature simulation', () => {
    const a = metal(); expect(ignite(a, 0, true)).toBe(false);
    a.properties.Flammability = 1; a.isStatic = true;
    expect(ignite(a, 0, true)).toBe(false); a.state.charge = 100;
    stepPhysical(a, 0); expect(a.state.charge).toBe(100);
    a.isStatic = false; a.settings.SimulateTemperature = false;
    stepPhysical(a, 0); expect(a.state.temperature).toBe(20); expect(a.state.charge).toBe(95);
    expect(getHeatCapacity(a)).toBe(1);
  });
  it('separates frame-dependent charring from fixed-step heat and charge decay', () => {
    const a = metal(); a.properties.Burnrate = .1; a.state.charge = 10;
    updatePhysicalFrame(a, .01, .2); expect(a.state.burnProgress).toBeCloseTo(.002);
    const before = a.state.temperature; heatFromSliding(a, 100, .5);
    expect(a.state.temperature - before).toBeCloseTo(.01);
    a.state.temperature = 10000; extinguish(a);
    expect(a.state.temperature).toBe(5000);
  });
});
