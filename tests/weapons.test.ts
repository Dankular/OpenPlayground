import { describe, expect, it } from 'vitest';
import { Simulation, type Entity } from '../src/simulation';
import { PhysicalSystem } from '../src/systems/physical-world';
import { WeaponSystem } from '../src/systems/weapons';
import type { BulletHit } from '../src/systems/ballistics';
import type { SourceComponent } from '../src/prefabs';

function configure(entity: Entity, component: SourceComponent) {
  entity.parts[0].metadata = { nodeId: '1', components: [
    { type: 'MonoBehaviour', className: 'PhysicalBehaviour', pathId: 'p', data: {} }, component,
  ] };
}
const gun = (extra = {}): SourceComponent => ({ type: 'MonoBehaviour', className: 'FirearmBehaviour', pathId: 'g',
  data: { barrelPosition: { x: .6, y: 0 }, barrelDirection: { x: 1, y: 0 }, ...extra },
  cartridge: { data: { m_Name: 'test-round', Damage: 20, Recoil: 1, ImpactForce: 1, StartSpeed: 100, PenetrationRandomAngleMultiplier: 0 } },
} as unknown as SourceComponent);

describe('firearm and explosive controllers', () => {
  it('forwards original explosion parameters to the shared native fragmentation engine once',()=>{
    const sim=new Simulation(),physical=new PhysicalSystem(),source=sim.spawn('box',0,5);
    configure(source,{type:'MonoBehaviour',className:'ExplosiveBehaviour',pathId:'explosive',data:{Delay:0,ArmOnUse:1,Range:10,FragmentForce:2,FragmentationRayCount:4,BallisticShrapnelCount:8,BigExplosion:true,ParticleEffectAndSound:true}});
    const forwarded:unknown[]= [];let oldEffects=0,oldFragments=0;
    const weapons=new WeaponSystem(sim,physical,{onFragmentation:p=>forwarded.push(p),onExplosion:()=>oldEffects++,onFragment:()=>oldFragments++});
    weapons.attach(source);weapons.use(source);weapons.beforeStep(.02);
    expect(forwarded).toHaveLength(1);expect(forwarded[0]).toMatchObject({Range:10,FragmentForce:2,FragmentationRayCount:4,BallisticShrapnelCount:8,EffectSize:2,CreateParticlesAndSound:true});
    expect(oldEffects).toBe(0);expect(oldFragments).toBe(0);
  });
  it('fires recovered cartridge data with recoil, heat, and a real ray hit', () => {
    const sim = new Simulation(), physical = new PhysicalSystem();
    const source = sim.spawn('box', 0, 5), target = sim.spawn('box', 3, 5); configure(source, gun());
    physical.attach(source); const hits: BulletHit[] = [];
    const weapons = new WeaponSystem(sim, physical, { onHit: hit => hits.push(hit), random: () => 0 });
    weapons.attach(source); weapons.attach(target);
    expect(weapons.canUse(source)).toBe(true); expect(weapons.use(source)).toBe(true);
    expect(source.parts[0].body.getLinearVelocity().x).toBeLessThan(0);
    expect(physical.get(source.parts[0])!.state.temperature).toBeGreaterThan(18);
    weapons.beforeStep(.02); expect(hits[0].part).toBe(target.parts[0]);
  });
  it('honors delayed activation and automatic-fire intervals', () => {
    const sim = new Simulation(), physical = new PhysicalSystem(), source = sim.spawn('box', 0, 5);
    configure(source, gun({ FireDelay: .1, Automatic: 1, AutomaticFireInterval: .05 }));
    let shots = 0; const weapons = new WeaponSystem(sim, physical, { onShot: () => shots++ }); weapons.attach(source);
    weapons.use(source); expect(shots).toBe(0);
    weapons.beforeStep(.05); expect(shots).toBe(0);
    weapons.beforeStep(.05); expect(shots).toBe(1);
    weapons.setHeld(source, true); weapons.beforeStep(.06); expect(shots).toBe(2);
    weapons.setHeld(source, false); weapons.beforeStep(.1); expect(shots).toBe(2);
  });
  it('arms a timed grenade, fragments nearby objects and removes the detonated source', () => {
    const sim = new Simulation(), physical = new PhysicalSystem(), bomb = sim.spawn('box', 0, 5), target = sim.spawn('box', 3, 5);
    configure(bomb, { type: 'MonoBehaviour', className: 'ExplosiveBehaviour', pathId: 'ex', data: { Delay: .1, ArmOnUse: 1, FragmentationRayCount: 16, Range: 10, FragmentForce: 2, DestroyOnExplode: 1 } });
    let fragments = 0, explosions = 0;
    const weapons = new WeaponSystem(sim, physical, { onFragment: () => fragments++, onExplosion: () => explosions++ });
    weapons.attach(bomb); weapons.attach(target); sim.onRemove.push(entity => weapons.remove(entity));
    weapons.use(bomb); weapons.beforeStep(.05); expect(explosions).toBe(0);
    weapons.beforeStep(.05); expect(explosions).toBe(1); expect(fragments).toBeGreaterThan(0);
    expect(sim.entities.includes(bomb)).toBe(false); expect(target.parts[0].body.getLinearVelocity().x).toBeGreaterThan(0);
  });
  it('triggers explosives from physical temperature and refuses a gun without its cartridge', () => {
    const sim = new Simulation(), physical = new PhysicalSystem(), bomb = sim.spawn('box', 0, 5);
    configure(bomb, { type: 'MonoBehaviour', className: 'ExplosiveBehaviour', pathId: 'ex', data: { TemperatureLimit: 100, FragmentationRayCount: 0 } });
    physical.attach(bomb); let exploded = 0;
    const weapons = new WeaponSystem(sim, physical, { onExplosion: () => exploded++ }); weapons.attach(bomb);
    physical.get(bomb.parts[0])!.state.temperature = 101; weapons.beforeStep(.02); expect(exploded).toBe(1);
    const source = sim.spawn('box', 3, 5), metadata = gun(); delete (metadata as unknown as Record<string, unknown>).cartridge;
    configure(source, metadata); weapons.attach(source); expect(weapons.canUse(source)).toBe(false);
  });
  it('round trips an active fuse and an exploded reusable object through snapshots', () => {
    const sim = new Simulation(), physical = new PhysicalSystem(), bomb = sim.spawn('box', 0, 5);
    configure(bomb, { type: 'MonoBehaviour', className: 'ExplosiveBehaviour', pathId: 'ex', data: { Delay: .05, ArmOnUse: 1, FragmentationRayCount: 0, DestroyOnExplode: 0 } });
    const weapons = new WeaponSystem(sim, physical); weapons.attach(bomb); weapons.use(bomb);
    expect(weapons.restore(bomb, JSON.parse(JSON.stringify(weapons.snapshot(bomb))))).toBe(true);
    weapons.beforeStep(.1);
    const saved = JSON.parse(JSON.stringify(weapons.snapshot(bomb)));
    expect(saved.explosives[0].exploded).toBe(true); expect(saved.explosives[0].remaining).toBe(null);
    expect(weapons.restore(bomb, saved)).toBe(true);
  });
});
