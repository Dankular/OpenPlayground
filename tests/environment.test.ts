import { describe, expect, it } from 'vitest';
import { Box, Vec2, World } from 'planck';
import { existsSync, readFileSync } from 'node:fs';
import type { Entity, Part } from '../src/simulation';
import { Simulation } from '../src/simulation';
import { normalizeMap } from '../src/maps';
import { EnvironmentSystem } from '../src/systems/environment';
import { createPhysicalObject } from '../src/systems/physical';
import type { SourceComponent, SourceNode } from '../src/prefabs';

const component = (className: string, pathId: string, data: Record<string, unknown>): SourceComponent => ({ type: 'MonoBehaviour', className, pathId, data });
function setup(kind: 'WaterBehaviour' | 'LavaBehaviour' = 'WaterBehaviour', overrides: Record<string, unknown> = {}, y = -1) {
  const world = new World(Vec2(0, -9.81));
  const fluidBody = world.createBody({ position: Vec2(0, -1) });
  fluidBody.createFixture(Box(5, 1), { isSensor: true });
  const data = { m_Enabled: 1, Trigger: { m_PathID: 'trigger' }, Buoyancy: kind === 'WaterBehaviour' ? 24 : .05,
    Drag: .05, LocalSurfaceLevel: 1, FreezingPointCelsius: 0, BoilingPointCelsius: 100,
    Dampening: .05, TransferRate: .01, LavaTemperature: 975, ...overrides };
  const volumeComponent = component(kind, 'fluid', data);
  const volumeNode: SourceNode = { id: 'fluid-node', name: 'Fluid', parentId: null, position: { x: 0, y: -1 }, angle: 0, scale: { x: 1, y: 1 }, active: true,
    components: [volumeComponent, { type: 'BoxCollider2D', pathId: 'trigger', data: {} }] };
  const fluidPart: Part = { id: 'static:fluid-node', body: fluidBody, width: 10, height: 2, shape: 'box', color: '#fff', label: 'Fluid', metadata: { nodeId: volumeNode.id, components: volumeNode.components } };
  const map: Entity = { id: 1, kind: 'prefab', parts: [fluidPart], joints: [], frozen: false, isEnvironment: true, metadata: { nodes: [volumeNode] } };
  const body = world.createDynamicBody({ position: Vec2(0, y) });
  body.createFixture(Box(.1, .1), { density: 1 });
  const physicalComponent = { ...component('PhysicalBehaviour', 'physical', { BuoyancyModifier: 1,
    LocalColliderGridPoints: [{ x: -.09, y: -.09 }, { x: .09, y: -.09 }, { x: .09, y: .09 }, { x: -.09, y: .09 }] }),
    properties: { pathId: 'properties', data: { Buoyancy: .5 } } };
  const part: Part = { id: 'body', body, width: .2, height: .2, shape: 'box', color: '#fff', label: 'Object', metadata: { nodeId: 'object', components: [physicalComponent] } };
  const object: Entity = { id: 2, kind: 'prefab', parts: [part], joints: [], frozen: false };
  const physical = createPhysicalObject({ ambientTemperature: 18, mass: body.getMass(), width: .2, height: .2,
    properties: { Flammability: 1, HeatTransferSpeedMultiplier: 1 } });
  const splashes: boolean[] = [];
  const system = new EnvironmentSystem(world, { getPhysical: p => p === part ? physical : undefined, random: () => .5, onSplash: (_v, _p, entering) => splashes.push(entering) });
  system.attach(map); system.attach(object);
  return { world, map, object, part, body, physical, system, splashes, data, physicalComponent };
}

describe('source WaterBehaviour', () => {
  it('sums per-baked-point buoyancy with serialized material buoyancy', () => {
    const { system, world, body, part } = setup();
    system.beforeStep(.02); world.step(.02);
    // mass * .5 * 24 upward, opposed by the shipped -9.81 gravity.
    expect(body.getLinearVelocity().y).toBeCloseTo((12 - 9.81) * .02, 7);
    expect(system.stateFor(part)).toMatchObject({ underwater: true, submergedFraction: 1, surfaceLevel: 0 });
  });
  it('applies only the immersed sample fraction and the original velocity drag', () => {
    const partial = setup('WaterBehaviour', {}, -.05);
    partial.system.beforeStep(.02); partial.world.step(.02);
    expect(partial.system.stateFor(partial.part)?.submergedFraction).toBe(.5);
    expect(partial.body.getLinearVelocity().y).toBeCloseTo((6 - 9.81) * .02, 7);
    const moving = setup(); moving.body.setLinearVelocity(Vec2(1, 0));
    moving.system.beforeStep(.02); moving.world.step(.02);
    expect(moving.body.getLinearVelocity().x).toBeCloseTo(1 - .4 * 4 * .02, 7);
  });
  it('uses per-step thermal interpolation and wetness rather than invented immersion cooling', () => {
    const { system, physical } = setup(); physical.state.temperature = 100;
    system.beforeStep(.02);
    expect(physical.state.temperature).toBeCloseTo(100 + (18 - 100) * .05);
    expect(physical.state.wetness).toBeCloseTo(.1);
    system.beforeStep(.02); expect(physical.state.wetness).toBeCloseTo(.2);
  });
  it('boils at the configured boundary, suppresses buoyancy and scalds', () => {
    const { system, physical, body, world } = setup(); system.applySettings({ ambientTemperature: 100 });
    system.beforeStep(.02); world.step(.02);
    expect(system.volumes[0].phase).toBe('boiling');
    expect(body.getLinearVelocity().y).toBeCloseTo(-9.81 * .02);
    expect(physical.state.burnProgress).toBe(.5);
    expect(physical.state.temperature).toBeCloseTo(18 + (100 - 18) * .05);
  });
  it('freezes after 5% immersion, extinguishes captured bodies, and restores body type on thaw', () => {
    const { system, body, physical } = setup(); physical.state.onFire = true;
    system.applySettings({ ambientTemperature: -5 });
    expect(body.isStatic()).toBe(true); expect(physical.state.temperature).toBe(-5);
    system.beforeStep(.02); expect(physical.state.wetness).toBe(1); expect(physical.state.onFire).toBe(false);
    system.applySettings({ ambientTemperature: 18 }); expect(body.isDynamic()).toBe(true);
  });
  it('evaporates only above boiling+100 and preserves ignored-object behavior', () => {
    const a = setup(); a.system.applySettings({ ambientTemperature: 200 }); expect(a.system.volumes[0].phase).toBe('boiling');
    a.system.applySettings({ ambientTemperature: 200.001 }); a.system.beforeStep(.02);
    expect(a.system.volumes[0].phase).toBe('evaporated'); expect(a.physical.state.wetness).toBe(0);
    const b = setup(); b.system.ignoreObject(b.system.volumes[0].id, b.object); b.system.beforeStep(.02);
    expect(b.system.stateFor(b.part)?.underwater).toBe(false); expect(b.physical.state.wetness).toBe(0);
    b.system.stopIgnoringObject(b.system.volumes[0].id, b.object); b.system.beforeStep(.02); expect(b.physical.state.wetness).toBe(.1);
  });
  it('emits entry/exit splash events only above source vertical-speed threshold', () => {
    const { system, body, splashes } = setup(); body.setLinearVelocity(Vec2(0, -1)); system.beforeStep(.02);
    expect(splashes).toEqual([true]); body.setPosition(Vec2(0, 2)); system.beforeStep(.02); expect(splashes).toEqual([true, false]);
  });
});

describe('source LavaBehaviour', () => {
  it('retains the integer-divided immersion heat factor for a partially submerged body', () => {
    const full = setup('LavaBehaviour'), partial = setup('LavaBehaviour', {}, -.05);
    full.system.beforeStep(.02); partial.system.beforeStep(.02);
    expect(full.physical.state.temperature).toBeGreaterThan(18);
    expect(partial.physical.state.temperature).toBeCloseTo(full.physical.state.temperature);
    expect(full.physical.state.onFire).toBe(true); expect(partial.system.stateFor(partial.part)?.submergedFraction).toBe(.5);
  });
  it('applies the source mass damping at every immersed sample, then full-immersion damping', () => {
    const { system, body } = setup('LavaBehaviour'); body.setLinearVelocity(Vec2(1, 0)); body.setAngularVelocity(2);
    const mass = body.getMass(), factor = .995 * Math.max(.8, Math.min(1, mass ** .1));
    system.beforeStep(.02);
    expect(body.getLinearVelocity().x).toBeCloseTo(factor ** 4 * .95);
    expect(body.getAngularVelocity()).toBeCloseTo(2 * factor ** 4 * .95);
  });
  it('respects the serialized lava contact layer mask and simulation-temperature flag', () => {
    const filtered = setup('LavaBehaviour', { ContactFilter: { useLayerMask: 1, layerMask: { m_Bits: 1 } } });
    filtered.system.beforeStep(.02); expect(filtered.system.stateFor(filtered.part)?.inLava).toBe(false);
    const disabled = setup('LavaBehaviour'); disabled.physical.settings.SimulateTemperature = false;
    disabled.system.beforeStep(.02); expect(disabled.physical.state.temperature).toBe(18); expect(disabled.physical.state.onFire).toBe(false);
  });
});

describe('source MapConfig', () => {
  it('applies world gravity and ambient settings while rain remains cosmetic', () => {
    const { system, world, physical } = setup();
    system.applySettings({ gravity: -3, ambientTemperature: 25, rain: true });
    expect(world.getGravity().y).toBe(-3); expect(system.settings.ambientTemperature).toBe(25);
    system.frame(1); expect(physical.state.wetness).toBe(0);
  });
  it('rejects incomplete/nonfinite settings before mutation and restores a captured global state', () => {
    const { system, world, map } = setup(); const previous = system.captureSettings();
    expect(system.restore(map, { settings: { gravity: 'bad' } })).toBe(false);
    expect(system.restoreSettings({ ...previous, ambientTemperature: NaN })).toBe(false);
    expect(system.settings).toEqual(previous); expect(world.getGravity().y).toBe(-9.81);
    system.applySettings({ gravity: 2, ambientTemperature: -20 }); expect(world.getGravity().y).toBe(2);
    expect(system.restoreSettings(previous)).toBe(true); expect(world.getGravity().y).toBe(-9.81); expect(system.settings).toEqual(previous);
  });
  it.skipIf(!existsSync('public/local-assets/maps/20052.json'))('binds the original Sea trigger, surface and map settings', () => {
    const prefab = normalizeMap(JSON.parse(readFileSync('public/local-assets/maps/20052.json', 'utf8')));
    const sim = new Simulation(); const map = sim.setEnvironment(prefab);
    const settings: number[] = [];
    const environment = new EnvironmentSystem(sim.world, { getPhysical: () => undefined, onSettings: s => settings.push(s.ambientTemperature) });
    environment.attach(map);
    expect(settings.at(-1)).toBe(14); expect(environment.volumes.filter(v => v.kind === 'water')).toHaveLength(1);
    expect(environment.unsupportedVolumes).toEqual([]);
    const trigger = environment.volumes[0].fixtures[0], bounds = trigger.getAABB(0);
    expect(environment.isPointUnderWater(Vec2((bounds.lowerBound.x + bounds.upperBound.x) / 2, (bounds.lowerBound.y + bounds.upperBound.y) / 2))).toBe(true);
  });
});
