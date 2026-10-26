import { describe, expect, it } from 'vitest';
import { Box, World, Vec2 } from 'planck';
import { existsSync, readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import type { Entity, Part } from '../src/simulation';
import { LiquidSystem, PressureDirection } from '../src/systems/liquids';
import { LiquidDeviceSystem, type LiquidDeviceOptions } from '../src/systems/liquid-devices';

function setup(kind: string, data: Record<string, unknown> = {}, options: LiquidDeviceOptions = {}, extra: string[] = []) {
  const world = new World(Vec2()), body = world.createDynamicBody(); body.createFixture(Box(.2, .2), 1);
  const components = [kind, ...extra].map((className, i) => ({ type: 'MonoBehaviour', className, pathId: String(i + 1), data: { m_Enabled: 1, ...data } }));
  const part: Part = { id: 'body', body, width: .4, height: .4, shape: 'box', label: kind, color: '#fff', metadata: { nodeId: 'node', components } };
  const entity: Entity = { id: 1, kind: 'prefab', parts: [part], joints: [], frozen: false };
  const liquids = new LiquidSystem(), devices = new LiquidDeviceSystem(liquids, { get: () => undefined }, options);
  liquids.attach(entity); devices.attach(entity);
  return { entity, part, liquids, devices, container: liquids.get(part)!, state: devices.get(entity)[0] };
}

describe('native liquid device reservoirs and controls', () => {
  it.each([
    ['ValveBehaviour', .5, false], ['LiquidPressureValveBehaviour', .5, false],
    ['LiquidDuplicatorBehaviour', 1.7857144, true], ['LiquidOutletBehaviour', 2.8, true],
    ['LiquidFilterBehaviour', 28, false], ['LiquidentifierBehaviour', 7, false],
  ])('%s retains its native capacity and overflow distinction', (kind, capacity, overflow) => {
    const x = setup(kind as string); expect(x.container.capacity).toBe(capacity); expect(x.container.allowsOverflow).toBe(overflow);
  });
  it('valves gate pressure and liquid strictly above the halfway point', () => {
    const x = setup('ValveBehaviour', { TurnDuration: .25 });
    expect(x.container.allowsTransfer).toBe(false); x.devices.use(x.entity, 1); x.devices.frame(.125);
    expect(x.state.valvePosition).toBe(.5); expect(x.container.allowPressureTransfer).toBe(false);
    x.devices.frame(.001); expect(x.container.allowsTransfer).toBe(true);
    x.devices.use(x.entity, 2); expect(x.state.lastTarget).toBe(false);
    expect(x.state.valveJobs).toHaveLength(2); // Use does not cancel prior source coroutines.
    x.devices.setValve(x.entity, true); expect(x.state.valveJobs).toHaveLength(1);
  });
  it('a pressure valve never transfers liquid even when completely open', () => {
    const x = setup('LiquidPressureValveBehaviour', { ValvePosition: 1 });
    expect(x.container.allowPressureTransfer).toBe(true); expect(x.container.allowsTransfer).toBe(false);
  });
  it('duplicates existing types proportionally, honors prefab capacity, and allows an overshoot', () => {
    const x = setup('LiquidDuplicatorBehaviour', { Activated: true, Capacity: 10 });
    x.container.addLiquid('BLOOD', 6); x.container.addLiquid('OIL', 3); x.devices.frame(1 / 60);
    expect(x.container.getAmount('BLOOD')).toBeCloseTo(6.6); expect(x.container.getAmount('OIL')).toBeCloseTo(3.3);
    x.devices.frame(1 / 60); expect(x.container.total).toBeCloseTo(10.89);
    x.devices.frame(1); expect(x.container.total).toBeCloseTo(10.89);
    expect(x.container.pressureMode).toBe(PressureDirection.Push);
    x.devices.use(x.entity); expect(x.container.pressureMode).toBe(PressureDirection.None);
  });
  it('does not create liquid from an empty duplicator or replicate when destroyed', () => {
    const x = setup('LiquidDuplicatorBehaviour', { Activated: true }, { isDestroyed: () => true });
    x.devices.frame(1); expect(x.container.total).toBe(0); x.container.addLiquid('BLOOD', 1);
    x.devices.frame(1); expect(x.container.total).toBe(1); expect(x.devices.use(x.entity)).toBe(false);
  });
  it('flush drains the initial amount over 1.521 seconds and waits for its sound', () => {
    const x = setup('LiquidentifierBehaviour', {}, { audioDuration: () => 2 }); x.container.addLiquid('BLOOD', 2);
    expect(x.devices.flush(x.entity)).toBe(true); expect(x.devices.flush(x.entity)).toBe(false);
    for (let i = 0; i < 100; i++) x.devices.frame(.02);
    expect(x.container.total).toBe(0); expect(x.state.phase).toBe('flush');
    x.devices.frame(.02); expect(x.state.phase).toBe('idle'); expect(x.state.display).toBe('Flushed :)');
  });
  it('identifier waits for initialization and thirty scan blinks before reporting contents', () => {
    const x = setup('LiquidentifierBehaviour'); x.container.addLiquid('BLOOD', 2); x.container.addLiquid('OIL', 1);
    x.devices.use(x.entity); expect(x.state.display).toBe('INITIALISING...');
    x.devices.frame(1.123); expect(x.state.display).toBe('SCANNING...');
    for (let i = 0; i < 29; i++) x.devices.frame(.0682);
    expect(x.state.phase).toBe('scanning'); x.devices.frame(.0682);
    expect(x.state.display).toContain('67% Human blood'); expect(x.state.display).toContain('33% Oil');
    expect(x.state.phase).toBe('idle');
  });
  it('identifier cancels its job when disabled', () => {
    const x = setup('LiquidentifierBehaviour'); x.devices.use(x.entity); x.part.body.setActive(false); x.devices.frame(.02);
    expect(x.state.phase).toBe('idle'); expect(x.state.display).toBe('ABRUPT SHUTDOWN RECOVERY');
  });
  it('outlet drains .1 per fixed step, leaves the residual, and copies particles without a second drain', () => {
    const x = setup('LiquidOutletBehaviour'); x.container.addLiquid('BLOOD', .25);
    x.devices.beforeStep(.001); x.devices.beforeStep(1); expect(x.container.total).toBeCloseTo(.05);
    x.devices.beforeStep(.02); expect(x.container.total).toBeCloseTo(.05);
    const other = setup('LiquidFilterBehaviour'); x.liquids.containers.set(other.part, other.container);
    x.devices.particleCollide(x.part, other.part); expect(other.container.total).toBeCloseTo(.1); expect(x.container.total).toBeCloseTo(.05);
  });
  it('shots create clamped hole rates, repair removes them, and a disabled leak leaves its reservoir enabled', () => {
    const x = setup('LiquidCanisterBehaviour', { DrainIntensityMultiplier: .05 }, {}, ['LiquidContainerLeakingBehaviour']);
    const leak = x.devices.get(x.entity)[0]; x.container.addLiquid('BLOOD', 1);
    x.devices.shot(x.part, { point: { x: .2, y: 0 }, normal: { x: 1, y: 0 }, damage: 99 });
    expect(leak.holes[0].intensity).toBe(5); x.devices.beforeStep(.02); expect(x.container.total).toBeCloseTo(1 - 5 * .05 * .05);
    x.devices.repair(x.entity); expect(leak.holes).toHaveLength(0);
    leak.component.data.m_Enabled = 0; x.devices.frame(.02); expect(x.container.enabled).toBe(true);
  });
  it('publishes external original-blood loss before the next physiology import', () => {
    const x = setup('CirculationBehaviour', { DrainIntensityMultiplier: .05 }, {}, ['LiquidContainerLeakingBehaviour']);
    let blood = x.container.getAmount('BLOOD');
    x.liquids.options.getBlood = () => blood; x.liquids.options.setBlood = (_part, value) => { blood = value; };
    x.devices.shot(x.part, { point: { x: .2, y: 0 }, normal: { x: 1, y: 0 }, damage: 5 });
    x.devices.beforeStep(.02); expect(blood).toBeCloseTo(.9875);
    x.liquids.beforeStep(.02); expect(x.container.getAmount('BLOOD')).toBeCloseTo(.9875);
  });
  it('bottle point transfer requires continuous use and honors transformed query and rate', () => {
    let using = false; const receiver = setup('LiquidFilterBehaviour');
    const x = setup('FlaskBehaviour', { Point: { x: 0, y: .25 }, UnitsPerSecond: .9333333, OnlyWhileUse: false }, {
      isBeingUsedContinuously: () => using,
      queryPoint: (p) => { expect(p.y).toBe(.25); return receiver.part; },
    }, ['PointLiquidTransferBehaviour']);
    x.liquids.containers.set(receiver.part, receiver.container); x.container.addLiquid('BLOOD', 1);
    x.devices.beforeStep(.02); expect(receiver.container.total).toBe(0);
    using = true; x.devices.beforeStep(.02); expect(receiver.container.total).toBeCloseTo(.9333333 * .02);
  });
  it('restores ongoing animation without replaying use and rejects malformed snapshots transactionally', () => {
    const x = setup('ValveBehaviour'); x.devices.use(x.entity, 1); x.devices.frame(.1);
    const saved = x.devices.snapshot(x.entity)!; x.devices.frame(.1); expect(x.devices.restore(x.entity, saved)).toBe(true);
    expect(x.state.valvePosition).toBeCloseTo(.4); const before = x.devices.snapshot(x.entity);
    expect(x.devices.restore(x.entity, { ...saved, states: [{ ...saved.states[0], elapsed: NaN }] })).toBe(false);
    expect(x.devices.snapshot(x.entity)).toEqual(before); x.devices.frame(.05); expect(x.state.valvePosition).toBeCloseTo(.6);
  });
  it('dispatches syringe activation only to the selected part', () => {
    const a = setup('EmptySyringe', { PressureMode: 1 }), b = setup('EmptySyringe', { PressureMode: 1 });
    b.part.metadata!.nodeId = 'other-node';
    a.entity.parts.push(b.part); a.liquids.remove(a.entity); a.liquids.attach(a.entity);
    a.liquids.use(a.entity, 1, b.part);
    expect(a.liquids.get(a.part)!.pressureMode).toBe(PressureDirection.Pull);
    expect(a.liquids.get(b.part)!.pressureMode).toBe(PressureDirection.Push);
  });
  it.skipIf(!existsSync('public/local-assets/prefabs/20248.json'))('attaches recovered native devices and retains actual duplicator capacity', () => {
    const sim = new Simulation(), liquids = new LiquidSystem(), devices = new LiquidDeviceSystem(liquids, { get: () => undefined });
    for (const id of ['20247', '20248', '20250', '20252', '20253', '20289']) {
      const prefab = JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`, 'utf8'));
      const entity = sim.spawnPrefab(prefab.catalogId, 0, 0, prefab); liquids.attach(entity); devices.attach(entity);
      expect(devices.get(entity).length).toBeGreaterThan(0);
      if (id === '20248') expect(devices.get(entity)[0].container.capacity).toBeCloseTo(53.57141876220703);
      const snapshot = devices.snapshot(entity); expect(devices.restore(entity, snapshot)).toBe(true);
    }
    expect([...devices.unsupported]).toEqual([]);
  });
});
