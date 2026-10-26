import { describe, expect, it } from 'vitest';
import { Box, PrismaticJoint, RevoluteJoint, Vec2, World } from 'planck';
import { existsSync, readFileSync } from 'node:fs';
import type { Entity, Part } from '../src/simulation';
import { Simulation } from '../src/simulation';
import { PhysicalSystem } from '../src/systems/physical-world';
import { MechanismSystem, deltaAngle } from '../src/systems/mechanisms';
import type { SourceComponent } from '../src/prefabs';

const component = (className: string, pathId: string, data: Record<string, unknown>): SourceComponent => ({ className, pathId, type: 'MonoBehaviour', data });
function fixture(kind: 'PistonBehaviour' | 'MotorisedHingeBehaviour' = 'PistonBehaviour', scaleX = 1) {
  const world = new World(Vec2());
  const base = world.createBody(), head = world.createDynamicBody({ position: Vec2(scaleX < 0 ? -.06 : .06, 0) }); head.createFixture(Box(.1, .1), { density: 1 });
  const joint = kind === 'PistonBehaviour'
    ? world.createJoint(new PrismaticJoint({ bodyA: base, bodyB: head, localAnchorA: Vec2(), localAnchorB: Vec2(), localAxisA: Vec2(1, 0), enableLimit: true, lowerTranslation: .05, upperTranslation: .82, enableMotor: true, maxMotorForce: 50000 }))!
    : world.createJoint(new RevoluteJoint({ bodyA: base, bodyB: head, localAnchorA: Vec2(), localAnchorB: Vec2(), enableMotor: true, maxMotorTorque: 10000 }))!;
  const controller = component(kind, 'controller', { Activated: 0, PhysicalBehaviour: { m_PathID: 'physical' }, Slider: { m_PathID: 'joint' }, Hinge: { m_PathID: 'joint' },
    MotorSpeedMutliplier: 1, CorrectionSpeedMultiplier: 3, Delta: 90, Speed: 1, Force: 10000, ActiveLight: { m_PathID: 'light' }, IndicatorArm: { m_PathID: 'indicator-transform' } });
  const part: Part = { id: 'base', body: base, width: .2, height: .2, shape: 'box', color: '#fff', label: 'Base', metadata: { nodeId: 'root', components: [component('PhysicalBehaviour', 'physical', {}), controller] } };
  const tip: Part = { id: 'head', body: head, width: .2, height: .2, shape: 'box', color: '#fff', label: 'Head' };
  const entity: Entity = { id: 1, kind: 'prefab', parts: [part, tip], joints: [joint], jointById: new Map([['joint', joint]]), frozen: false,
    metadata: { nodes: [{ id: 'root', name: 'Root', parentId: null, position: { x: 0, y: 0 }, angle: 0, scale: { x: scaleX, y: 1 }, active: true, components: [controller] }] } };
  const physical = new PhysicalSystem(); physical.attach(entity);
  let destroyed = false;
  const light: boolean[] = [], indicator: number[] = [], audio: { playing: boolean; volume: number }[] = [];
  const mechanisms = new MechanismSystem(physical, { isDestroyed: () => destroyed,
    setRendererEnabled: (_e, id, value) => { if (id === 'light') light.push(value); },
    setIndicatorAngle: (_e, id, value) => { if (id === 'indicator-transform') indicator.push(value); },
    onMotorAudio: (_s, playing, volume) => audio.push({ playing, volume }) });
  mechanisms.attach(entity);
  return { world, entity, part, tip, physical, mechanisms, light, indicator, audio, setDestroyed: (v: boolean) => { destroyed = v; },
    slider: () => entity.jointById!.get('joint') as PrismaticJoint, hinge: () => entity.jointById!.get('joint') as RevoluteJoint };
}

describe('source PistonBehaviour', () => {
  it('retracts by default and extends after discrete use with source speed/force', () => {
    const f = fixture(); f.mechanisms.beforeStep(.02); expect(f.slider().getMotorSpeed()).toBe(-1); expect(f.slider().getMaxMotorForce()).toBe(50000);
    expect(f.mechanisms.use(f.entity)).toBe(true); f.mechanisms.beforeStep(.02); expect(f.slider().getMotorSpeed()).toBe(1);
    for (let i = 0; i < 80; i++) { f.mechanisms.beforeStep(.02); f.world.step(.02); }
    expect(f.slider().getJointTranslation()).toBeGreaterThan(.81); expect(f.mechanisms.get(f.entity)[0].alreadyReached).toBe(true);
  });
  it('multiplies speed by absolute local scale and max(1,charge), and scales source limits', () => {
    const f = fixture('PistonBehaviour', 2); f.physical.get(f.part)!.state.charge = 3;
    f.mechanisms.use(f.entity); f.mechanisms.beforeStep(.02);
    expect(f.slider().getLowerLimit()).toBeCloseTo(.1); expect(f.slider().getUpperLimit()).toBeCloseTo(1.64); expect(f.slider().getMotorSpeed()).toBe(6);
    f.physical.get(f.part)!.state.charge = .2; f.mechanisms.beforeStep(.02); expect(f.slider().getMotorSpeed()).toBe(2);
  });
  it('latches reaching the limit and uses squared-error correction if displaced', () => {
    const f = fixture(); f.mechanisms.use(f.entity); f.tip.body.setPosition(Vec2(.83, 0)); f.mechanisms.beforeStep(.02);
    expect(f.mechanisms.get(f.entity)[0].alreadyReached).toBe(true); expect(f.slider().getMotorSpeed()).toBe(0);
    f.tip.body.setPosition(Vec2(.7, 0)); f.mechanisms.beforeStep(.02);
    expect(f.slider().getMotorSpeed()).toBeCloseTo((.7 - .82) ** 2 * 3);
    f.mechanisms.use(f.entity); expect(f.mechanisms.get(f.entity)[0].alreadyReached).toBe(false);
  });
  it('disables the motor and use while destroyed, then resumes after repair', () => {
    const f = fixture(); f.setDestroyed(true); expect(f.mechanisms.use(f.entity)).toBe(false); f.mechanisms.beforeStep(.02); expect(f.slider().isMotorEnabled()).toBe(false);
    f.setDestroyed(false); f.mechanisms.beforeStep(.02); expect(f.slider().isMotorEnabled()).toBe(true);
  });
  it('rebuilds a reflected slider axis with its source identity and motor force intact', () => {
    const f = fixture('PistonBehaviour', -1);
    expect(f.slider().getLocalAxisA().x).toBe(-1); expect(f.entity.joints).toHaveLength(1); expect(f.slider().getMaxMotorForce()).toBe(50000);
    f.mechanisms.use(f.entity); for (let i = 0; i < 30; i++) { f.mechanisms.beforeStep(.02); f.world.step(.02); }
    expect(f.tip.body.getPosition().x).toBeLessThan(-.5); expect(f.slider().getJointTranslation()).toBeGreaterThan(.5);
  });
});

describe('source MotorisedHingeBehaviour', () => {
  it('commands shortest-path owner-minus-connected target and charge-scaled torque', () => {
    const f = fixture('MotorisedHingeBehaviour'); f.mechanisms.use(f.entity); f.physical.get(f.part)!.state.charge = 2;
    f.mechanisms.beforeStep(.02); expect(f.hinge().getMotorSpeed()).toBeCloseTo(-Math.PI / 2); expect(f.hinge().getMaxMotorTorque()).toBe(30000);
    for (let i = 0; i < 250; i++) { f.mechanisms.beforeStep(.02); f.world.step(.02); }
    expect(-f.hinge().getJointAngle() / (Math.PI / 180)).toBeGreaterThan(89);
    expect(f.light.at(-1)).toBe(true);
  });
  it('uses Unity DeltaAngle half-turn boundary and wraps arbitrary targets', () => {
    expect(deltaAngle(0, 180)).toBe(180); expect(deltaAngle(350, 10)).toBe(20); expect(deltaAngle(10, 350)).toBe(-20);
    const f = fixture('MotorisedHingeBehaviour'); f.mechanisms.setServoDelta(f.entity, 810); f.mechanisms.use(f.entity); f.mechanisms.beforeStep(.02);
    expect(f.hinge().getMotorSpeed()).toBeCloseTo(-Math.PI / 2);
  });
  it('mirrors target delta and returns to zero when deactivated', () => {
    const f = fixture('MotorisedHingeBehaviour', -1); f.mechanisms.use(f.entity); f.mechanisms.beforeStep(.02); expect(f.hinge().getMotorSpeed()).toBeCloseTo(Math.PI / 2);
    f.tip.body.setAngle(.3); f.mechanisms.use(f.entity); f.mechanisms.beforeStep(.02); expect(f.hinge().getMotorSpeed()).toBeLessThan(0);
  });
  it('supports source UI delta/speed setters and indicator transform updates', () => {
    const f = fixture('MotorisedHingeBehaviour'); expect(f.indicator).toEqual([90]);
    f.mechanisms.setServoDelta(f.entity, -45); expect(f.indicator.at(-1)).toBe(-45);
    f.mechanisms.setServoSpeed(f.entity, 30); expect(f.mechanisms.get(f.entity)[0].speed).toBe(10);
    f.mechanisms.setServoSpeed(f.entity, -2); expect(f.mechanisms.get(f.entity)[0].speed).toBe(0);
  });
  it('reports native degree-based motor audio thresholds and stops on disable', () => {
    const f = fixture('MotorisedHingeBehaviour'); f.tip.body.setAngularVelocity(10 * Math.PI / 180); f.mechanisms.beforeStep(.02);
    expect(f.audio.at(-1)).toMatchObject({ playing: true, volume: .5 }); f.tip.body.setAngularVelocity(2 * Math.PI / 180); f.mechanisms.beforeStep(.02);
    expect(f.audio.at(-1)).toMatchObject({ playing: false, volume: 0 }); f.setDestroyed(true); f.mechanisms.beforeStep(.02); expect(f.hinge().isMotorEnabled()).toBe(false);
  });
});

describe('mechanism lifecycle and source prefab binding', () => {
  it('does not repeatedly toggle IUse-only controllers from a continuous activation channel', () => {
    const f = fixture(); expect(f.mechanisms.use(f.entity, 0, true)).toBe(false); expect(f.mechanisms.get(f.entity)[0].active).toBe(false);
    expect(f.mechanisms.use(f.entity, 2, false, f.tip)).toBe(false); expect(f.mechanisms.use(f.entity, 2, false, f.part)).toBe(true);
  });
  it('restores controller state and rejects invalid snapshots without partial mutation', () => {
    const f = fixture('MotorisedHingeBehaviour'); f.mechanisms.use(f.entity); f.mechanisms.setServoDelta(f.entity, 135); f.mechanisms.setServoSpeed(f.entity, 4);
    const saved = f.mechanisms.snapshot(f.entity)!; f.mechanisms.setServoDelta(f.entity, 30); expect(f.mechanisms.restore(f.entity, saved)).toBe(true);
    expect(f.mechanisms.get(f.entity)[0]).toMatchObject({ active: true, delta: 135, speed: 4 });
    const before = f.mechanisms.snapshot(f.entity); saved.states[0].speed = NaN;
    expect(f.mechanisms.restore(f.entity, saved)).toBe(false); expect(f.mechanisms.snapshot(f.entity)).toEqual(before);
  });
  it.skipIf(!existsSync('public/local-assets/prefabs/20282.json'))('binds the original regular/industrial piston and servo joint IDs and values', () => {
    const sim = new Simulation(), physical = new PhysicalSystem(), mechanisms = new MechanismSystem(physical);
    for (const id of ['20282', '20223', '20312']) {
      const prefab = JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`, 'utf8'));
      const entity = sim.spawnPrefab(id, 0, 5, prefab); physical.attach(entity); mechanisms.attach(entity);
      const state = mechanisms.get(entity)[0]; expect(state.joint).toBeDefined(); expect(entity.jointById?.get(state.jointId)).toBe(state.joint);
      if (id === '20282') { expect(state.motorSpeedMultiplier).toBe(1); expect(state.upper).toBeCloseTo(.82); }
      if (id === '20223') { expect(state.motorSpeedMultiplier).toBeCloseTo(.8); expect(state.upper).toBeCloseTo(2.66); }
      if (id === '20312') expect(state).toMatchObject({ delta: 90, speed: 1, force: 10000 });
    }
    expect(mechanisms.unsupported.size).toBe(0);
  });
  it.skipIf(!existsSync('public/local-assets/prefabs/20197.json'))('preserves the obsolete GearBehaviour registration without inventing motor coupling', () => {
    const sim = new Simulation(), physical = new PhysicalSystem(), mechanisms = new MechanismSystem(physical);
    const prefab = JSON.parse(readFileSync('public/local-assets/prefabs/20197.json', 'utf8'));
    const entity = sim.spawnPrefab(prefab.catalogId, 0, 5, prefab); physical.attach(entity); mechanisms.attach(entity);
    expect(mechanisms.get(entity)[0].toothCount).toBe(64); expect(mechanisms.canUse(entity)).toBe(false);
    entity.parts[0].body.setAngularVelocity(2); mechanisms.beforeStep(.02); expect(entity.parts[0].body.getAngularVelocity()).toBe(2); expect(entity.joints).toHaveLength(0);
  });
});
