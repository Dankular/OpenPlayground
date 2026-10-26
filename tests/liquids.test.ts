import { describe, expect, it } from 'vitest';
import { Box, Vec2, World, RevoluteJoint } from 'planck';
import { existsSync, readFileSync } from 'node:fs';
import { LiquidReservoir, LiquidSystem, PressureDirection, averagePressure, type LiquidEffects } from '../src/systems/liquids';
import type { Entity, Part } from '../src/simulation';
import { Simulation } from '../src/simulation';
import type { SourceComponent } from '../src/prefabs';
import { RagdollSystem } from '../src/systems/ragdoll';
import { PhysicalSystem } from '../src/systems/physical-world';
import { LiquidEffects as NativeLiquidEffects } from '../src/systems/liquid-effects';

const world = () => new World(Vec2());
function makeEntity(w: World, id: number, className: string, data: Record<string, unknown> = {}, extra: SourceComponent[] = []) {
  const body = w.createDynamicBody(); body.createFixture(Box(.1, .1), { density: 1 });
  const components = [{ className, type: 'MonoBehaviour', pathId: `${id}:component`, data: { m_Enabled: 1, NewlySpawned: 1, ...data } }, ...extra] as NonNullable<Part['metadata']>['components'];
  const part: Part = { id: String(id), body, width: .2, height: .2, shape: 'box', color: '#fff', label: className, metadata: { nodeId: String(id), components } };
  const entity: Entity = { id, kind: 'prefab', parts: [part], joints: [], frozen: false };
  return { entity, part };
}

describe('native BloodContainer mixture semantics', () => {
  it('keeps circulation overflow and finite syringe capacity distinct', () => {
    const limb = new LiquidReservoir({ kind: 'circulation', capacity: 1, allowsOverflow: true });
    limb.addLiquid('BLOOD', 1); limb.addLiquid('LIFE SERUM', .5); expect(limb.total).toBe(1.5);
    const syringe = new LiquidReservoir({ kind: 'syringe', capacity: 1.4, allowsOverflow: false });
    expect(syringe.addLiquid('BLOOD', 10)).toBe(1.4); expect(syringe.addLiquid('ACID', 1)).toBe(0);
  });
  it('transfers each liquid proportionally and reports negative removals', () => {
    const a = new LiquidReservoir(), b = new LiquidReservoir(); a.addLiquid('BLOOD', .75); a.addLiquid('OIL', .25);
    expect(a.transferTo(.2, b)).toBeCloseTo(.2); expect(b.getAmount('BLOOD')).toBeCloseTo(.15); expect(b.getAmount('OIL')).toBeCloseTo(.05);
    expect(a.removeLiquid('OIL', .05)).toBeCloseTo(-.05); expect(a.total + b.total).toBeCloseTo(.95);
  });
  it('preserves the original bounded-target transfer loss instead of returning unaccepted liquid', () => {
    const a = new LiquidReservoir(), b = new LiquidReservoir({ capacity: 1, allowsOverflow: false });
    a.addLiquid('BLOOD', 1); b.addLiquid('OIL', .99); expect(a.transferTo(.1, b)).toBeCloseTo(.1);
    expect(a.total).toBeCloseTo(.9); expect(b.getAmount('BLOOD')).toBeCloseTo(.01);
  });
  it('uses equal-type drain shares, not proportional drain', () => {
    const c = new LiquidReservoir(); c.addLiquid('BLOOD', .9); c.addLiquid('OIL', .1); c.drain(.1);
    expect(c.getAmount('BLOOD')).toBeCloseTo(.85); expect(c.getAmount('OIL')).toBeCloseTo(.05);
  });
  it('fires entry only once until the source .02 cleanup removes an unchanged trace', () => {
    const entered: string[] = [], exited: string[] = [];
    const c = new LiquidReservoir({ enter: id => entered.push(id), exit: id => exited.push(id) });
    c.addLiquid('LIFE SERUM', .01); c.addLiquid('LIFE SERUM', .005); expect(entered).toEqual(['LIFE SERUM']);
    c.deleteEmptyEntries(); expect(c.getAmount('LIFE SERUM')).toBe(.015); c.deleteEmptyEntries(); expect(c.total).toBe(0); expect(exited).toEqual(['LIFE SERUM']);
    c.addLiquid('LIFE SERUM', .01); expect(entered).toEqual(['LIFE SERUM', 'LIFE SERUM']);
  });
  it('ticks liquids strictly after one second and resets the timer instead of catching up', () => {
    const c = new LiquidReservoir(); c.addLiquid('ACID', 1); const ticks: string[] = [];
    c.frame(1, id => ticks.push(id)); expect(ticks).toEqual([]);
    c.frame(.001, id => ticks.push(id)); expect(ticks).toEqual(['ACID']); expect(c.timer).toBe(0);
    c.frame(3, id => ticks.push(id)); expect(ticks).toEqual(['ACID', 'ACID']); expect(c.timer).toBe(0);
  });
  it('runs native chemical recipes only in allowed containers and conserves reaction amounts', () => {
    const c = new LiquidReservoir(); c.addLiquid('ACID', .5); c.addLiquid('MENDING SERUM', .5); c.frame(1.01, () => {});
    expect(c.getAmount('OSTEOMORPHOSIS AGENT')).toBeCloseTo(.1); expect(c.total).toBeCloseTo(1);
    const limb = new LiquidReservoir({ kind: 'circulation' }); limb.addLiquid('ACID', .5); limb.addLiquid('MENDING SERUM', .5); limb.frame(1.01, () => {});
    expect(limb.getAmount('OSTEOMORPHOSIS AGENT')).toBe(0);
  });
  it('interpolates source push/pull pressure and weighted mixture color', () => {
    const a = new LiquidReservoir({ pressureMode: PressureDirection.Push }), b = new LiquidReservoir();
    a.addLiquid('BLOOD', .5); a.addLiquid('COAGULATION SERUM', .5); a.frame(1, () => {});
    expect(a.measuredPressure).toBeCloseTo(.6 + (4096 - .6) * .95);
    const before = a.measuredPressure; averagePressure(.02, a, b); expect(a.measuredPressure).toBeCloseTo(before * .99); expect(b.measuredPressure).toBeCloseTo(before * .01);
    expect(a.computedColor).toMatchObject({ r: .825, g: .5, b: 0, a: 1 });
  });
});

describe('native SyringeBehaviour transport', () => {
  it('starts typed syringes full and infinite, injects only while lodged, and caps target serum at .5', () => {
    const w = world(), system = new LiquidSystem(), needle = makeEntity(w, 1, 'LifeSyringe'), limb = makeEntity(w, 2, 'CirculationBehaviour');
    system.attach(needle.entity); system.attach(limb.entity); expect(system.get(needle.part)?.total).toBe(1.4);
    system.beforeStep(.02); expect(system.get(limb.part)?.getAmount('LIFE SERUM')).toBe(0);
    expect(system.lodged(needle.part, limb.part)).toBe(true);
    for (let i = 0; i < 100; i++) system.beforeStep(.02);
    expect(system.get(limb.part)?.getAmount('LIFE SERUM')).toBeCloseTo(.5, 6);
    expect(system.get(limb.part)?.total).toBeGreaterThan(1); expect(system.get(needle.part)?.total).toBeGreaterThan(1.38);
    system.dislodged(needle.part, limb.part); system.get(limb.part)!.removeLiquid('LIFE SERUM', .1); system.beforeStep(.02);
    expect(system.get(limb.part)?.getAmount('LIFE SERUM')).toBeCloseTo(.4);
  });
  it('finite pull syringes extract the complete mixture and infinite source still pushes in pull mode', () => {
    const w = world(), system = new LiquidSystem(), empty = makeEntity(w, 1, 'EmptySyringe', { Finite: 1, PressureMode: 1 }), limb = makeEntity(w, 2, 'CirculationBehaviour');
    system.attach(empty.entity); system.attach(limb.entity); system.lodged(empty.part, limb.part); system.frame(.1); system.beforeStep(.02);
    expect(system.get(empty.part)?.getAmount('BLOOD')).toBeCloseTo(.01); expect(system.get(limb.part)?.getAmount('BLOOD')).toBeCloseTo(.99);
    const life = makeEntity(w, 3, 'LifeSyringe', { Finite: 0, PressureMode: 1 }); system.attach(life.entity); system.lodged(life.part, limb.part); system.frame(.1); system.beforeStep(.02);
    expect(system.get(limb.part)?.getAmount('LIFE SERUM')).toBeCloseTo(.01);
  });
  it('uses exact activation channels and finite/infinite toggle behavior', () => {
    const w = world(), system = new LiquidSystem(), needle = makeEntity(w, 1, 'LifeSyringe'); system.attach(needle.entity);
    const state = system.getSyringe(needle.part)!; expect(state.container.pressureMode).toBe(0);
    system.use(needle.entity); expect(state.container.pressureMode).toBe(1);
    system.use(needle.entity, 1); expect(state.container.pressureMode).toBe(0);
    system.use(needle.entity, 2); expect(state.container.pressureMode).toBe(0);
    system.toggleInfinite(needle.entity); expect(state.finite).toBe(true); expect(state.container.pressureMode).toBe(0);
    system.use(needle.entity, 2); expect(state.container.pressureMode).toBe(1);
  });
  it('routes immediate entry separately from the one-second liquid update', () => {
    const entered: string[] = [], ticks: string[] = [];
    const effects: LiquidEffects = { enter: (p, id, c) => { if (c.kind === 'circulation') entered.push(id); }, tick: (p, id, c) => { if (c.kind === 'circulation') ticks.push(id); } };
    const w = world(), system = new LiquidSystem({ effects }), needle = makeEntity(w, 1, 'DeathSyringe'), limb = makeEntity(w, 2, 'CirculationBehaviour');
    system.attach(needle.entity); system.attach(limb.entity); system.lodged(needle.part, limb.part);
    system.beforeStep(.02); expect(entered).toContain('INSTANT DEATH POISON'); expect(ticks).toEqual([]);
    for (let i = 0; i < 10; i++) system.beforeStep(.02); system.frame(1); expect(ticks).toEqual([]);
    system.frame(.01); expect(ticks).toContain('INSTANT DEATH POISON');
  });
  it('diffuses serum to connected limbs and stops when their source hinge is removed', () => {
    const w = world(), a = makeEntity(w, 1, 'CirculationBehaviour', {}, [{ className: 'LimbBehaviour', type: 'MonoBehaviour', pathId: 'limb-a', data: { ConnectedLimbs: [{ m_PathID: 'limb-b' }] } }]);
    const b = makeEntity(w, 2, 'CirculationBehaviour', {}, [{ className: 'LimbBehaviour', type: 'MonoBehaviour', pathId: 'limb-b', data: { ConnectedLimbs: [{ m_PathID: 'limb-a' }] } }]);
    const hinge = w.createJoint(new RevoluteJoint({}, a.part.body, b.part.body, Vec2()))!;
    const entity: Entity = { ...a.entity, parts: [a.part, b.part], joints: [hinge] }, system = new LiquidSystem(); system.attach(entity);
    system.get(a.part)!.addLiquid('LIFE SERUM', .2); system.beforeStep(.02);
    expect(system.get(b.part)!.getAmount('LIFE SERUM')).toBeGreaterThan(0);
    w.destroyJoint(hinge); const before = system.get(b.part)!.getAmount('LIFE SERUM'); system.beforeStep(.02); expect(system.get(b.part)!.getAmount('LIFE SERUM')).toBe(before);
  });
  it('supports source flask/canister/tank capacities and frame-based infinite sources', () => {
    const w = world(), system = new LiquidSystem(), flask = makeEntity(w, 1, 'FlaskBehaviour', { Capacity: 2.8, StartLiquid: { LiquidID: 'OIL', Amount: 2.8 } });
    const canister = makeEntity(w, 2, 'LiquidCanisterBehaviour', { Capacity: 70 }, [{ className: 'InfiniteLiquidSourceBehaviour', type: 'MonoBehaviour', pathId: 'source', data: { LiquidID: 'BLOOD' } }]);
    const tank = makeEntity(w, 3, 'BloodTankBehaviour', { Mode: 3, DrainRate: 1 });
    system.attach(flask.entity); system.attach(canister.entity); system.attach(tank.entity);
    expect(system.get(flask.part)?.total).toBe(2.8); expect(system.get(canister.part)?.capacity).toBe(70);
    system.get(tank.part)!.addLiquid('BLOOD', 5); system.frame(.1);
    expect(system.get(canister.part)?.total).toBe(1); expect(system.get(tank.part)?.total).toBeCloseTo(4.9);
  });
  it('preserves native Pink fingerprint mixture through snapshot restore without replaying entry effects', () => {
    const w = world(), entered: string[] = [], system = new LiquidSystem({ effects: { enter: (_p, id) => entered.push(id), tick: () => {} } });
    const pink = makeEntity(w, 1, 'PinkSyringe', { Fingerprint: [1] }); system.attach(pink.entity);
    expect(system.get(pink.part)?.total).toBeCloseTo(1.4); expect(system.getSyringe(pink.part)?.pinkMixture?.length).toBeGreaterThan(5);
    const snapshot = system.snapshot(pink.entity)!, count = entered.length; system.get(pink.part)!.removeLiquid('INERT PINK LIQUID', .1);
    expect(system.restore(pink.entity, snapshot)).toBe(true); expect(system.get(pink.part)?.total).toBeCloseTo(1.4); expect(entered).toHaveLength(count);
    const before = system.snapshot(pink.entity)!; snapshot.containers[0].distribution[0].amount = NaN;
    expect(system.restore(pink.entity, snapshot)).toBe(false); expect(system.snapshot(pink.entity)).toEqual(before);
  });
  it.skipIf(!existsSync('public/local-assets/prefabs/20244.json'))('reads original Life/Empty syringe defaults and exact serialized transfer rate', () => {
    const life = JSON.parse(readFileSync('public/local-assets/prefabs/20244.json', 'utf8')), empty = JSON.parse(readFileSync('public/local-assets/prefabs/20174.json', 'utf8'));
    const sim = new Simulation(), system = new LiquidSystem(); const a = sim.spawnPrefab(life.catalogId, 0, 0, life), b = sim.spawnPrefab(empty.catalogId, 1, 0, empty);
    system.attach(a); system.attach(b); const full = system.syringesFor(a)[0], blank = system.syringesFor(b)[0];
    expect(full.finite).toBe(false); expect(full.container.total).toBeCloseTo(1.4); expect(full.transferRate).toBeCloseTo(.01);
    expect(blank.finite).toBe(true); expect(blank.container.total).toBe(0); expect(blank.container.pressureMode).toBe(1);
  });
  it.skipIf(!existsSync('public/local-assets/prefabs/20217.json'))('delivers native immediate Life and delayed Death effects to an extracted Human head', () => {
    const sim = new Simulation(), physical = new PhysicalSystem({ random: () => .9 });
    const ragdolls = new RagdollSystem({ random: () => .9, getPhysical: part => physical.get(part as Part) });
    const effects = new NativeLiquidEffects(ragdolls, { random: () => .9, getPhysical: part => physical.get(part as Part) });
    const liquids = new LiquidSystem({ effects, getBlood: p => ragdolls.limbFor(p)?.blood, setBlood: (p, amount) => { const limb = ragdolls.limbFor(p); if (limb) limb.blood = amount; } });
    ragdolls.externalLiquidTransport = true; ragdolls.getTotalLiquid = p => liquids.get(p as Part)?.total;
    const prefab = JSON.parse(readFileSync('public/local-assets/prefabs/20217.json', 'utf8'));
    const human = sim.spawnPrefab(prefab.catalogId, 0, 0, prefab); physical.attach(human); ragdolls.attach(human); liquids.attach(human);
    const head = human.parts.find(p => p.label === 'Head')!, limb = ragdolls.limbFor(head)!;
    ragdolls.damage(head, limb.health + 1); expect(limb.person.brainDead).toBe(true);
    const life = makeEntity(sim.world, 100, 'LifeSyringe'); liquids.attach(life.entity); liquids.lodged(life.part, head); liquids.beforeStep(.02);
    expect(limb.health).toBe(limb.initialHealth); expect(limb.person.brainDead).toBe(false); expect(liquids.get(head)!.getAmount('LIFE SERUM')).toBeGreaterThan(0);
    liquids.dislodged(life.part, head);
    const death = makeEntity(sim.world, 101, 'DeathSyringe'); liquids.attach(death.entity); liquids.lodged(death.part, head);
    for (let i = 0; i < 5; i++) liquids.beforeStep(.02);
    expect(limb.health).toBeGreaterThan(0); liquids.frame(1.01); expect(limb.health).toBe(0);
  });
});
