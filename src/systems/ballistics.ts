import { AABB, Vec2, type Body, type Fixture, type World } from 'planck';
import type { Entity, Part } from '../simulation';
import type { PhysicalSystem } from './physical-world';
import { sourceComponent } from './physical-world';

export interface Cartridge { Damage: number; Recoil: number; ImpactForce: number; StartSpeed: number; PenetrationRandomAngleMultiplier: number }
export interface BulletHit { part: Part; point: { x: number; y: number }; normal: { x: number; y: number }; damage: number; exit?: boolean }
export interface BulletTrace { start: { x: number; y: number }; end: { x: number; y: number }; lifetime: number }
interface Bullet {
  owner: Entity; cartridge: Cartridge; origin: Vec2; direction: Vec2; speed: number;
  distance: number; iterations: number; previous: Fixture | null; wait: number;
  charge: number; traversal: boolean; maxRange: number;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const norm = (value: { x: number; y: number }) => { const length = Math.hypot(value.x, value.y) || 1; return Vec2(value.x / length, value.y / length); };

export function bulletDamageMultiplier(distance: number): number {
  return clamp(1.5 / Math.max(Number.EPSILON, distance) + .7 / (distance * .008 + .8 * .992), .5, 10);
}
export function materialHardness(softness: number, brittleness: number, absorption = 0): number {
  return 2 * .35 * (4.5 * (1 - clamp(softness + brittleness, 0, 1))) + absorption;
}

/** BallisticsEmitter's stepping/penetration model, backed by Planck queries. */
export class BallisticsSystem {
  private bullets: Bullet[] = [];
  private byBody = new Map<Body, { part: Part; entity: Entity }>();
  constructor(readonly world: World, readonly physical: PhysicalSystem, readonly options: {
    onHit?: (hit: BulletHit) => void; onTrace?: (trace: BulletTrace) => void;
    random?: () => number;
  } = {}) {}
  attach(entity: Entity): void { for (const part of entity.parts) this.byBody.set(part.body, { part, entity }); }
  remove(entity: Entity): void {
    for (const part of entity.parts) this.byBody.delete(part.body);
    this.bullets = this.bullets.filter(b => b.owner !== entity);
  }
  get activeBulletCount(): number { return this.bullets.length; }
  emit(owner: Entity, origin: { x: number; y: number }, direction: { x: number; y: number }, cartridge: Cartridge, charge = 0, traversal = true): void {
    if (!(cartridge.StartSpeed > 0) || !['Damage', 'Recoil', 'ImpactForce', 'StartSpeed', 'PenetrationRandomAngleMultiplier'].every(key => Number.isFinite(cartridge[key as keyof Cartridge]))) return;
    this.bullets.push({ owner, cartridge, origin: Vec2(origin), direction: norm(direction), speed: cartridge.StartSpeed,
      distance: 0, iterations: 0, previous: null, wait: 0, charge, traversal,
      maxRange: traversal ? clamp(cartridge.StartSpeed / 4, 4, 8) : 1000 });
  }
  rayCast(owner: Entity, start: { x: number; y: number }, end: { x: number; y: number }): { fixture: Fixture; point: Vec2; normal: Vec2; fraction: number } | null {
    let closest: { fixture: Fixture; point: Vec2; normal: Vec2; fraction: number } | null = null;
    this.world.rayCast(start, end, (fixture, point, normal, fraction) => {
      if (fixture.isSensor() || this.byBody.get(fixture.getBody())?.entity === owner) return -1;
      closest = { fixture, point: Vec2(point), normal: Vec2(normal), fraction }; return fraction;
    });
    return closest;
  }
  private pointFixture(bullet: Bullet): Fixture | null {
    let selected: Fixture | null = null;
    const p = bullet.origin;
    this.world.queryAABB(new AABB(Vec2(p.x - .001, p.y - .001), Vec2(p.x + .001, p.y + .001)), fixture => {
      if (!fixture.isSensor() && this.byBody.get(fixture.getBody())?.entity !== bullet.owner && fixture.testPoint(p)) { selected = fixture; return false; }
      return true;
    });
    return selected;
  }
  private material(part: Part): Record<string, unknown> {
    return sourceComponent(part, 'PhysicalBehaviour')?.properties?.data ?? {};
  }
  private hardness(part: Part): number {
    const p = this.material(part);
    return materialHardness(Number(p.Softness ?? 0), Number(p.Brittleness ?? 0), Number(p.BulletSpeedAbsorptionPower ?? 0));
  }
  private noise(multiplier: number): Vec2 {
    const random = this.options.random ?? Math.random;
    const radius = Math.sqrt(random()) * multiplier, angle = random() * Math.PI * 2;
    return Vec2(radius * Math.cos(angle), radius * Math.sin(angle));
  }
  step(dt: number): void {
    this.bullets = this.bullets.filter(bullet => {
      if (bullet.wait > 0) { bullet.wait -= dt; if (bullet.wait > 0) return true; }
      while (bullet.iterations < 128 && bullet.distance < 1000) {
        const ratio = clamp(bullet.speed / bullet.cartridge.StartSpeed, .05, 1) / Math.max(.1, Math.sqrt(bullet.distance * .2));
        if (ratio <= .1) return false;
        const inside = this.pointFixture(bullet);
        const insideTarget = inside && this.byBody.get(inside.getBody());
        if (inside && insideTarget) {
          if (inside !== bullet.previous) this.options.onHit?.({ part: insideTarget.part, point: Vec2(bullet.origin), normal: Vec2.neg(bullet.direction), damage: bullet.cartridge.Damage * bulletDamageMultiplier(.08 + bullet.distance) * clamp(ratio, 0, 1) });
          const hardness = this.hardness(insideTarget.part);
          inside.getBody().applyForce(Vec2.mul(bullet.direction, bullet.cartridge.ImpactForce * hardness * .08 * 18 * 4), bullet.origin, true);
          bullet.origin.add(Vec2.mul(bullet.direction, .08)); bullet.direction = norm(Vec2.add(bullet.direction, this.noise(bullet.cartridge.PenetrationRandomAngleMultiplier)));
          bullet.speed -= hardness; bullet.iterations++; bullet.distance += .08; bullet.previous = inside;
          continue;
        }
        if (bullet.previous) {
          const previous = this.byBody.get(bullet.previous.getBody());
          if (previous) this.options.onHit?.({ part: previous.part, point: Vec2.sub(bullet.origin, Vec2.mul(bullet.direction, .08)), normal: Vec2(bullet.direction), damage: bullet.cartridge.Damage * bulletDamageMultiplier(.08 + bullet.distance) * clamp(ratio, 0, 1), exit: true });
          bullet.previous = null;
        }
        const hit = this.rayCast(bullet.owner, bullet.origin, Vec2.add(bullet.origin, Vec2.mul(bullet.direction, bullet.maxRange)));
        const target = hit && this.byBody.get(hit.fixture.getBody());
        if (!hit || !target) {
          if (!bullet.traversal) return false;
          const travel = Math.min(bullet.maxRange, dt * 60 * bullet.maxRange * Math.sqrt(ratio));
          const end = Vec2.add(bullet.origin, Vec2.mul(bullet.direction, travel));
          this.options.onTrace?.({ start: Vec2(bullet.origin), end, lifetime: .06 });
          const drop = (1 - Math.pow(.999, dt * 60)) * .25 * .7;
          bullet.direction = norm(Vec2(bullet.direction.x * (1 - drop), bullet.direction.y * (1 - drop) - drop));
          bullet.origin.add(Vec2.mul(bullet.direction, travel)); bullet.distance += travel * .1;
          return true;
        }
        const distance = bullet.maxRange * hit.fraction;
        const hardness = this.hardness(target.part);
        const force = 18 * clamp(Math.max(bullet.cartridge.ImpactForce * hardness, bullet.cartridge.ImpactForce), 0, 1.5) * 1.5;
        hit.fixture.getBody().applyForce(Vec2.mul(bullet.direction, force), bullet.origin, true);
        this.options.onHit?.({ part: target.part, point: hit.point, normal: hit.normal,
          damage: bullet.cartridge.Damage * bulletDamageMultiplier(bullet.distance + distance) * clamp(ratio, 0, 1) });
        const physical = this.physical.get(target.part);
        if (physical) physical.state.charge = Math.max(bullet.charge * physical.settings.EnergyWireResistance, physical.state.charge);
        this.options.onTrace?.({ start: Vec2(bullet.origin), end: hit.point, lifetime: .06 });
        const properties = this.material(target.part), soft = clamp(Number(properties.Softness ?? 0) + Number(properties.Brittleness ?? 0), 0, 1);
        const chance = 1 - (soft * 150 + Math.abs(Vec2.dot(hit.normal, bullet.direction)));
        bullet.distance += distance; bullet.iterations++;
        if (chance > .05 && chance > (this.options.random ?? Math.random)()) {
          const reflected = Vec2.sub(bullet.direction, Vec2.mul(hit.normal, 2 * Vec2.dot(bullet.direction, hit.normal)));
          bullet.direction = norm(Vec2.add(reflected, this.noise(bullet.cartridge.PenetrationRandomAngleMultiplier * .1)));
          bullet.origin = Vec2.sub(hit.point, Vec2.mul(hit.normal, .02));
        } else {
          if (sourceComponent(target.part, 'PhysicalBehaviour')?.data.BulletPenetration === 0) return false;
          bullet.origin = Vec2.add(hit.point, Vec2.mul(bullet.direction, .08)); bullet.speed -= hardness;
        }
        bullet.previous = hit.fixture; bullet.wait = .01;
        return true;
      }
      return false;
    });
  }
}
