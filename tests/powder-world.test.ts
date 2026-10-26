import { describe, expect, it } from 'vitest';
import { Box, Vec2, World } from 'planck';
import * as THREE from 'three';
import { PowderWorld } from '../src/powder/world';
import { PowderLayer } from '../src/powder/layer';
import { PT } from '../src/powder/elements';
import { createPhysicalObject, type PhysicalObject } from '../src/systems/physical';

const make = () => {
  const world = new World(Vec2(0, -9.81));
  const ground = world.createBody();
  ground.createFixture(Box(50, .5, Vec2(0, -.5 - 0.0)), { friction: .8 });
  const pw = new PowderWorld({ cellsX: 40, cellsY: 30, seed: 3, origin: { x: -3.2, y: -0.16 } });
  return { world, pw };
};
const count = (pw: PowderWorld, t: number) => { let n = 0; for (let i = 0; i < pw.sim.active; i++) if (pw.sim.type[i] === t) n++; return n; };
const frames = (pw: PowderWorld, world: World, n: number, phys: (b: any) => PhysicalObject | undefined = () => undefined) => {
  for (let i = 0; i < n; i++) { pw.couple(world, { physicalFor: phys, random: () => 0.01 }); world.step(1 / 50); pw.advance(1 / 60); }
};

describe('powder world coupling', () => {
  it('maps world and pixel coordinates consistently', () => {
    const { pw } = make();
    const p = pw.worldToPixel(0, 1);
    const w = pw.pixelToWorld(p.x, p.y);
    expect(Math.abs(w.x - 0)).toBeLessThan(pw.pixel);
    expect(Math.abs(w.y - 1)).toBeLessThan(pw.pixel);
    expect(pw.contains(0, 1)).toBe(true);
    expect(pw.contains(100, 1)).toBe(false);
  });

  it('sand rests on the static ground body and does not fall through it', () => {
    const { world, pw } = make();
    pw.paint(0, 1, PT.SAND, 3);
    const n0 = count(pw, PT.SAND);
    expect(n0).toBeGreaterThan(10);
    frames(pw, world, 200);
    let lowest = Infinity;
    for (let i = 0; i < pw.sim.active; i++) if (pw.sim.type[i] === PT.SAND) lowest = Math.min(lowest, pw.pixelToWorld(0, Math.round(pw.sim.y[i])).y);
    expect(count(pw, PT.SAND)).toBe(n0);
    expect(lowest).toBeGreaterThan(-0.05); // ground top is y = 0
  });

  it('a dynamic body blocks falling powder', () => {
    const { world, pw } = make();
    const box = world.createDynamicBody({ position: Vec2(0, 0.6) });
    box.createFixture(Box(0.4, 0.05), { density: 100 });
    box.setGravityScale(0); box.setAwake(true);
    pw.paint(0, 1.6, PT.SAND, 2);
    frames(pw, world, 150);
    for (let i = 0; i < pw.sim.active; i++) if (pw.sim.type[i] === PT.SAND) {
      const w = pw.pixelToWorld(Math.round(pw.sim.x[i]), Math.round(pw.sim.y[i]));
      expect(w.y).toBeGreaterThan(box.getPosition().y); // none passed through to the plate's underside
    }
  });

  it('flames heat and ignite a flammable body, which then emits fire', () => {
    const { world, pw } = make();
    const body = world.createDynamicBody({ position: Vec2(0, 0.3) });
    body.createFixture(Box(0.3, 0.3), { density: 1 });
    const object = createPhysicalObject({ ambientTemperature: 18, mass: body.getMass(), width: .6, height: .6,
      properties: { Flammability: 1, Burnrate: 1, BurningTemperatureThreshold: 150, HeatTransferSpeedMultiplier: 1 } });
    for (const x of [-0.34, 0.34]) { pw.paint(x, 0.3, PT.FIRE, 3); }
    frames(pw, world, 60, b => (b === body ? object : undefined));
    expect(object.state.temperature).toBeGreaterThan(18);
    expect(object.state.onFire).toBe(true);
    frames(pw, world, 60, b => (b === body ? object : undefined));
    expect(count(pw, PT.FIRE) + count(pw, PT.SMKE)).toBeGreaterThan(0);
  });

  it('water contact wets a body', () => {
    const { world, pw } = make();
    const body = world.createDynamicBody({ position: Vec2(0, 0.3) });
    body.createFixture(Box(0.3, 0.3), { density: 1 });
    const object = createPhysicalObject({ ambientTemperature: 18, mass: body.getMass(), width: .6, height: .6 });
    pw.paint(-0.34, 0.3, PT.WATR, 3);
    frames(pw, world, 20, b => (b === body ? object : undefined));
    expect(object.state.wetness).toBeGreaterThan(0);
  });

  it('a pressure pulse pushes a body away from the source', () => {
    const { world, pw } = make();
    const body = world.createDynamicBody({ position: Vec2(0.8, 1) });
    body.createFixture(Box(0.15, 0.15), { density: 1 });
    body.setGravityScale(0);
    pw.injectPressure(0.2, 1, 0.5, 120);
    frames(pw, world, 15);
    expect(body.getLinearVelocity().x).toBeGreaterThan(0.05);
  });

  it('round-trips through serialize/deserialize and rejects bad payloads', () => {
    const { pw } = make();
    pw.paint(0, 1, PT.WATR, 2);
    pw.paint(0.5, 1, PT.LAVA, 1);
    const data = JSON.parse(JSON.stringify(pw.serialize()));
    const other = new PowderWorld({ cellsX: 40, cellsY: 30, seed: 9 });
    expect(other.deserialize(data)).toBe(true);
    expect(count(other, PT.WATR)).toBe(count(pw, PT.WATR));
    expect(count(other, PT.LAVA)).toBe(count(pw, PT.LAVA));
    expect(other.deserialize({ ...data, particles: [[9999, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] })).toBe(false);
    expect(other.deserialize({ ...data, cellsX: 7 })).toBe(false);
    expect(count(other, PT.WATR)).toBe(count(pw, PT.WATR)); // untouched after rejection
  });

  it('lightning painted with the brush gets default power and survives', () => {
    const { pw } = make();
    pw.paint(0, 1.5, PT.LIGH, 1);
    pw.advance(1 / 60);
    let life = 0;
    for (let i = 0; i < pw.sim.active; i++) if (pw.sim.type[i] === PT.LIGH) life = Math.max(life, pw.sim.life[i]);
    expect(life).toBeGreaterThan(10);
  });

  it('follows the rigid-body gravity vector, including inverted gravity', () => {
    const down = make().pw, up = make().pw;
    for (const [pw, g] of [[down, -9.81], [up, 9.81]] as const) { pw.setGravity(0, g); pw.paint(0, 2, PT.DUST, 1); }
    const y0 = down.worldToPixel(0, 2).y;
    for (let f = 0; f < 30; f++) { down.advance(1 / 60); up.advance(1 / 60); }
    const mean = (pw: PowderWorld) => { let sum = 0, n = 0; for (let i = 0; i < pw.sim.active; i++) if (pw.sim.type[i]) { sum += pw.sim.y[i]; n++; } return sum / n; };
    expect(mean(down)).toBeGreaterThan(y0);
    expect(mean(up)).toBeLessThan(y0);
  });

  it('the layer redraws only when the grid changed', () => {
    const { pw } = make();
    const layer = new PowderLayer(pw, new THREE.Scene());
    layer.update();
    const v = layer.texture.version;
    layer.update();
    expect(layer.texture.version).toBe(v);
    pw.paint(0, 1, PT.SAND, 2);
    layer.update();
    expect(layer.texture.version).toBeGreaterThan(v);
    const v2 = layer.texture.version;
    pw.advance(1 / 60);
    layer.update();
    expect(layer.texture.version).toBeGreaterThan(v2);
    layer.dispose();
  });
});
