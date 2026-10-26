import { Vec2, type Body } from 'planck';
import type { Entity, Part, Simulation } from '../simulation';
import type { SourceComponent } from '../prefabs';
import { BallisticsSystem, type BulletHit, type BulletTrace, type Cartridge } from './ballistics';
import { PhysicalSystem, sourceComponent } from './physical-world';
import { getCharge, getHeatCapacity, ignite } from './physical';

interface GunState { entity: Entity; part: Part; component: SourceComponent; cartridge: Cartridge | null; timer: number; shotIndex: number; pending: number[]; held: boolean }
interface ExplosiveState { entity: Entity; part: Part; component: SourceComponent; armed: boolean; remaining: number; exploded: boolean }
const num = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const vector = (v: unknown, fallback: { x: number; y: number }) => {
  const data = v as { x?: number; y?: number } | undefined; return Vec2(num(data?.x, fallback.x), num(data?.y, fallback.y));
};

export class WeaponSystem {
  readonly ballistics: BallisticsSystem;
  private guns = new Map<Entity, GunState[]>();
  private explosives = new Map<Entity, ExplosiveState[]>();
  private byBody = new Map<Body, { entity: Entity; part: Part }>();
  constructor(readonly simulation: Simulation, readonly physical: PhysicalSystem, readonly options: {
    onHit?: (hit: BulletHit) => void;
    onFragment?: (part: Part, force: number, position: { x: number; y: number }) => void;
    onSlice?: (part: Part) => void;
    onTrace?: (trace: BulletTrace) => void;
    onExplosion?: (position: { x: number; y: number }, range: number, source: Entity) => void;
    onShot?: (entity: Entity, component: SourceComponent, firstShot: boolean) => void;
    resolveCartridge?: (component: SourceComponent, entity: Entity) => Cartridge | null;
    random?: () => number;
    isDisabled?: (entity: Entity, component: SourceComponent) => boolean;
  } = {}) {
    this.ballistics = new BallisticsSystem(simulation.world, physical, {
      onTrace: options.onTrace, random: options.random,
      onHit: hit => { options.onHit?.(hit); if (!hit.exit) this.shotTarget(hit.part); },
    });
    simulation.world.on('post-solve', (contact, impulse) => {
      if (!impulse.normalImpulses.length) return;
      const normalImpulse = impulse.normalImpulses[0];
      for (const body of [contact.getFixtureA().getBody(), contact.getFixtureB().getBody()]) {
        const entry = this.byBody.get(body); if (!entry) continue;
        for (const ex of this.explosives.get(entry.entity) ?? []) {
          if (ex.part !== entry.part) continue;
          const threshold = num(ex.component.data.ImpactForceThreshold, -1);
          if (threshold >= 0 && normalImpulse > threshold) this.arm(ex, .05);
        }
      }
    });
  }
  attach(entity: Entity): void {
    if (this.guns.has(entity)) return;
    this.ballistics.attach(entity);
    const guns: GunState[] = [], explosives: ExplosiveState[] = [];
    for (const part of entity.parts) {
      this.byBody.set(part.body, { entity, part });
      if (entity.metadata?.nodes.find(n => n.id === part.metadata?.nodeId)?.active === false) continue;
      for (const component of part.metadata?.components ?? []) {
        if (component.data.m_Enabled === 0 || component.data.m_Enabled === false) continue;
        if (component.className === 'FirearmBehaviour') {
          const raw = (component as SourceComponent & { cartridge?: { data: Cartridge } }).cartridge?.data;
          const cartridge = this.options.resolveCartridge?.(component, entity) ?? raw ?? null;
          guns.push({ entity, part, component, cartridge, timer: 0, shotIndex: 0, pending: [], held: false });
        } else if (component.className === 'ExplosiveBehaviour') {
          const ex = { entity, part, component, armed: false, remaining: Infinity, exploded: false };
          explosives.push(ex); if (component.data.ArmOnAwake) this.arm(ex);
        }
      }
    }
    this.guns.set(entity, guns); this.explosives.set(entity, explosives);
  }
  remove(entity: Entity): void {
    this.guns.delete(entity); this.explosives.delete(entity); this.ballistics.remove(entity);
    for (const part of entity.parts) this.byBody.delete(part.body);
  }
  canUse(entity: Entity): boolean {
    return (this.guns.get(entity) ?? []).some(g => !!g.cartridge && !g.component.data.IgnoreUse) ||
      (this.explosives.get(entity) ?? []).some(e => e.component.data.ArmOnUse !== 0 && !e.exploded);
  }
  use(entity: Entity): boolean {
    let used = false;
    for (const gun of this.guns.get(entity) ?? []) {
      if (gun.component.data.IgnoreUse || !gun.cartridge || this.options.isDisabled?.(entity, gun.component)) continue;
      gun.shotIndex = 0; const delay = num(gun.component.data.FireDelay, 0);
      if (delay > 0) gun.pending.push(delay); else this.fire(gun);
      used = true;
    }
    for (const explosive of this.explosives.get(entity) ?? []) {
      if (this.options.isDisabled?.(entity, explosive.component)) continue;
      if (explosive.component.data.ArmOnUse === 0 || explosive.component.data.ArmOnUse === false) continue;
      this.arm(explosive); used = true;
    }
    return used;
  }
  setHeld(entity: Entity, held: boolean): void { for (const gun of this.guns.get(entity) ?? []) gun.held = held; }
  snapshot(entity: Entity): unknown {
    return {
      guns: (this.guns.get(entity) ?? []).map(g => ({ id: g.component.pathId, timer: g.timer, shotIndex: g.shotIndex, pending: [...g.pending] })),
      explosives: (this.explosives.get(entity) ?? []).map(e => ({ id: e.component.pathId, armed: e.armed, remaining: Number.isFinite(e.remaining) ? e.remaining : null, exploded: e.exploded })),
    };
  }
  restore(entity: Entity, value: unknown): boolean {
    const saved = value as { guns?: { id: string; timer: number; shotIndex: number; pending: number[] }[]; explosives?: { id: string; armed: boolean; remaining: number | null; exploded: boolean }[] } | null;
    if (!saved || !Array.isArray(saved.guns) || !Array.isArray(saved.explosives)) return false;
    const guns = this.guns.get(entity) ?? [], explosives = this.explosives.get(entity) ?? [];
    if (saved.guns.length !== guns.length || saved.explosives.length !== explosives.length) return false;
    if (new Set(saved.guns.map(g => g?.id)).size !== saved.guns.length || new Set(saved.explosives.map(e => e?.id)).size !== saved.explosives.length) return false;
    for (const g of saved.guns)
      if (!g || !guns.some(item => item.component.pathId === g.id) || !Number.isFinite(g.timer) || g.timer < 0 || !Number.isSafeInteger(g.shotIndex) || g.shotIndex < 0 || !Array.isArray(g.pending) || g.pending.length > 1000 || g.pending.some(delay => !Number.isFinite(delay) || delay < 0)) return false;
    for (const e of saved.explosives)
      if (!e || !explosives.some(item => item.component.pathId === e.id) || typeof e.armed !== 'boolean' || typeof e.exploded !== 'boolean' || (e.remaining !== null && (!Number.isFinite(e.remaining) || e.remaining < 0)) || (e.armed && e.remaining === null)) return false;
    saved.guns.forEach(g => { const target = guns.find(item => item.component.pathId === g.id)!; target.timer = g.timer; target.shotIndex = g.shotIndex; target.pending = [...g.pending]; target.held = false; });
    saved.explosives.forEach(e => { const target = explosives.find(item => item.component.pathId === e.id)!; target.armed = e.armed; target.remaining = e.remaining ?? Infinity; target.exploded = e.exploded; });
    return true;
  }
  private arm(ex: ExplosiveState, delay = num(ex.component.data.Delay, 2)): void {
    if (ex.exploded && !ex.component.data.CanExplodeMultipleTimes) return;
    if (!ex.armed || delay < ex.remaining) { ex.armed = true; ex.remaining = Math.max(0, delay); }
  }
  private shotTarget(part: Part): void {
    const owner = this.byBody.get(part.body)?.entity; if (!owner) return;
    for (const ex of this.explosives.get(owner) ?? [])
      if (ex.part === part && this.random() < num(ex.component.data.ShotExplodeChance, 1)) this.arm(ex, this.random() * .2);
  }
  beforeStep(dt: number): void {
    for (const guns of this.guns.values()) for (const gun of guns) {
      if (this.options.isDisabled?.(gun.entity, gun.component)) {gun.pending=[];gun.held=false;continue;}
      gun.timer += dt;
      gun.pending = gun.pending.filter(delay => { if (delay <= dt) { this.fire(gun); return false; } return true; }).map(delay => delay - dt);
      if (gun.held && gun.component.data.Automatic && gun.shotIndex !== 0 && gun.timer > num(gun.component.data.AutomaticFireInterval, .05)) this.fire(gun);
    }
    const explodeNow: ExplosiveState[] = [];
    for (const explosives of this.explosives.values()) for (const ex of explosives) {
      if (this.options.isDisabled?.(ex.entity, ex.component)) continue;
      const p = this.physical.get(ex.part), c = ex.component.data;
      if (p && (p.state.temperature >= num(c.TemperatureLimit, 500) ||
          (num(c.ExplodeBurnProgressThreshold, 2) < 1 && p.state.burnProgress > num(c.ExplodeBurnProgressThreshold, 2)) ||
          getCharge(p) > num(c.MinChargeToExplode, Infinity))) this.arm(ex, 0);
      if (ex.armed) { ex.remaining -= dt; if (ex.remaining <= 0) explodeNow.push(ex); }
    }
    for (const ex of explodeNow) this.explode(ex);
    this.ballistics.step(dt);
  }
  private random(): number { return (this.options.random ?? Math.random)(); }
  private fire(gun: GunState): void {
    if (!gun.cartridge || this.options.isDisabled?.(gun.entity, gun.component)) return;
    const c = gun.cartridge, config = gun.component.data, p = this.physical.get(gun.part), body = gun.part.body;
    const node = gun.entity.metadata?.nodes.find(n => n.id === gun.part.metadata?.nodeId);
    const scale = node?.scale ?? { x: 1, y: 1 };
    const localPosition = vector(config.barrelPosition, { x: .5, y: 0 });
    const barrel = body.getWorldPoint(Vec2(localPosition.x * scale.x, localPosition.y * scale.y));
    const localDirection = vector(config.barrelDirection, { x: 1, y: 0 });
    const direction = body.getWorldVector(Vec2(localDirection.x * scale.x, localDirection.y * scale.y));
    const first = gun.shotIndex === 0;
    if (p) p.state.temperature += c.Recoil / getHeatCapacity(p) * .05 * num(config.ShotHeatMultiplier, 1);
    gun.shotIndex++; gun.timer = 0;
    const count = Math.max(1, Math.floor(num(config.BulletsPerShot, 1)));
    for (let i = 0; i < count; i++) {
      body.applyLinearImpulse(body.getWorldVector(Vec2(-.5 * c.Recoil * scale.x, 0)), barrel, true);
      const spread = Math.max(.0025, num(config.InitialInaccuracy, .001));
      const angle = this.random() * Math.PI * 2, radius = Math.sqrt(this.random()) * spread;
      this.ballistics.emit(gun.entity, barrel, Vec2(direction.x + Math.cos(angle) * radius, direction.y + Math.sin(angle) * radius), c, config.ApplyCharge && p ? getCharge(p) : 0);
    }
    this.options.onShot?.(gun.entity, gun.component, first);
  }
  private explode(ex: ExplosiveState): void {
    if (ex.exploded && !ex.component.data.CanExplodeMultipleTimes) return;
    ex.armed = false; ex.remaining = Infinity; ex.exploded = true;
    const c = ex.component.data, position = Vec2(ex.part.body.getPosition());
    const range = Math.max(0, num(c.Range, 27)), force = num(c.FragmentForce, 2);
    const rays = Math.max(0, Math.floor(num(c.FragmentationRayCount, 32)));
    for (let i = 0; i < rays; i++) {
      const angle = i / rays * Math.PI * 2, direction = Vec2(Math.cos(angle), Math.sin(angle));
      const hit = this.ballistics.rayCast(ex.entity, position, Vec2.add(position, Vec2.mul(direction, range)));
      if (!hit) continue;
      const target = this.byBody.get(hit.fixture.getBody());
      hit.fixture.getBody().applyLinearImpulse(Vec2.mul(direction, force), hit.point, true);
      if (!target) continue;
      this.options.onFragment?.(target.part, force, hit.point);
      if (this.random() < num(c.DismemberChance, 0)) this.options.onSlice?.(target.part);
      for (const other of this.explosives.get(target.entity) ?? [])
        if (other.part === target.part && other.component.data.ExplodesOnFragmentHit && !other.armed) this.arm(other, .05);
    }
    const burn = num(c.BurnPower, 0), lift = num(c.ShockwaveLiftForce, 0), targetTemperature = num(c.AffectVictimTemperature, 0);
    if (burn > .001 || lift > .01 || Math.abs(targetTemperature) > 1) for (const [body, target] of this.byBody) {
      if (target.entity === ex.entity || Vec2.distanceSquared(body.getPosition(), position) > range * range) continue;
      const p = this.physical.get(target.part); if (!p) continue;
      // Nearest blocking geometry must be the candidate itself.
      const block = this.ballistics.rayCast(ex.entity, position, body.getPosition());
      if (block && block.fixture.getBody() !== body) continue;
      body.applyForceToCenter(Vec2(0, body.getMass() * lift), true);
      p.state.burnProgress = Math.max(p.state.burnProgress, burn / 8 * this.random());
      if (this.random() < burn) ignite(p, 0, true);
      if ((targetTemperature > 0 && p.state.temperature < targetTemperature) || (targetTemperature < 0 && p.state.temperature > targetTemperature))
        p.state.temperature += (targetTemperature - p.state.temperature) * Math.min(1, .035 / getHeatCapacity(p));
    }
    this.options.onExplosion?.(position, range, ex.entity);
    if (c.DestroyOnExplode || c.DisintegrateOnExplode) this.simulation.remove(ex.entity);
  }
}
