import{describe,it,expect}from'vitest';
import{Box,Vec2}from'planck';
import{existsSync,readFileSync}from'node:fs';
import{Simulation,type Entity,type Part}from'../src/simulation';
import type{AssetLibrary,Prefab}from'../src/prefabs';
import{PhysicalSystem}from'../src/systems/physical-world';
import{ProjectileSystem,registerProjectilePrefabs,type ProjectileOptions}from'../src/systems/projectiles';
import{WeaponSystem}from'../src/systems/weapons';

function setup(options:Partial<ProjectileOptions>={}){
  const assets:AssetLibrary={buildId:'projectile-fixture',prefabs:new Map(),catalog:{items:[],categories:[]}};registerProjectilePrefabs(assets);
  const sim=new Simulation(null,assets);sim.world.setGravity(Vec2());const physical=new PhysicalSystem();
  const system=new ProjectileSystem(sim,{spawnResource:(...args)=>sim.spawnResourcePrefab(...args),getPhysical:p=>physical.get(p),random:()=>.5,noise:()=>.5,...options});
  sim.onSpawn.push(e=>{physical.attach(e);system.attach(e);});sim.onRemove.push(e=>{system.remove(e);physical.remove(e);});
  sim.stateAdapters.set('projectiles',{capture:e=>system.snapshot(e),restore:(e,v)=>system.restore(e,v)});
  return{sim,assets,physical,system};
}
function target(sim:Simulation,x:number,y=0):Part{
  const body=sim.world.createBody(Vec2(x,y));body.createFixture(Box(.1,2));const part:Part={id:'target',body,width:.2,height:4,shape:'box',color:'#fff',label:'target',metadata:{nodeId:'target',components:[]}};
  const entity:Entity={id:999,kind:'box',parts:[part],joints:[],frozen:false,metadata:{nodes:[{id:'target',name:'target',parentId:null,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,layer:9,components:[]}]}};body.setUserData(entity);sim.entities.push(entity);sim.onSpawn.forEach(fn=>fn(entity));return part;
}
describe('native resource projectiles',()=>{
  it('preloads all eleven exact normalized resource prefabs and keeps source identities',()=>{
    const{assets}=setup();expect(assets.prefabs.size).toBe(11);const shell=assets.prefabs.get('resource:sharedassets0.assets:3281')!;
    expect(shell.name).toBe('TankShell');expect(shell.parts[0].id).toBe('11194');expect(shell.parts[0].mass).toBe(.5);expect(shell.parts[0].bullet).toBe(true);
    const explosive=shell.nodes.flatMap(n=>n.components).find(c=>c.className==='ExplosiveBehaviour')!;expect(explosive.data).toMatchObject({Range:27,FragmentationRayCount:32,ImpactForceThreshold:50,DestroyOnExplode:1});
  });
  it('starts original TankShell impulse once after pose rotation and transfers300degrees heat',()=>{
    const{system,physical}=setup();const shell=system.launch({key:'sharedassets0.assets:3281',position:{x:0,y:8},direction:{x:0,y:1},temperature:300})!;
    expect(shell.parts[0].body.getLinearVelocity().length()).toBe(0);system.update(.02);
    expect(shell.parts[0].body.getLinearVelocity().x).toBeCloseTo(0);expect(shell.parts[0].body.getLinearVelocity().y).toBeCloseTo(350/.5);expect(physical.get(shell.parts[0])?.state.temperature).toBe(300);
    system.update(.02);expect(shell.parts[0].body.getLinearVelocity().y).toBeCloseTo(700);
  });
  it('uses strict DeleteAfterTime >10 and releases controller references',()=>{
    const{sim,system}=setup(),shell=system.launch({key:'sharedassets0.assets:3281',position:{x:0,y:8},direction:{x:1,y:0}})!;
    system.update(10);expect(sim.entities).toContain(shell);system.update(.001);expect(sim.entities).not.toContain(shell);expect(system.controllers.has(shell)).toBe(false);
  });
  it('moves source rocket with acceleration, nativewater slowdown and no artificial rigid body',()=>{
    const{system}=setup({isUnderWater:()=>true});const rocket=system.launch({key:'sharedassets0.assets:3084',position:{x:0,y:8},direction:{x:1,y:0}})!;
    expect(rocket.parts).toHaveLength(0);system.update(.1);expect(rocket.position?.x).toBeCloseTo(45*.3*.1);system.update(.1);expect(rocket.position?.x).toBeCloseTo((45+49.5)*.3*.1);
  });
  it('compounds source immobility slowdown while inside field and resets outside',()=>{
    const{sim,system}=setup();const field=sim.world.createBody(Vec2(0,8));field.createFixture(Box(5,1),{isSensor:true});
    const rocket=system.launch({key:'sharedassets0.assets:3084',position:{x:0,y:8},direction:{x:1,y:0}})!;
    system.options.fixtureLayer=f=>f.getBody()===field?19:9;
    system.update(.01);system.update(.01);expect(system.snapshot(rocket).controllers[0].multiplier).toBe(.25);
    rocket.position={x:10,y:8};system.update(.01);expect(system.snapshot(rocket).controllers[0].multiplier).toBe(1);
  });
  it('emits rocket exact explosion and Shot/ExitShot35/Break on the ray hit',()=>{
    const explosions:unknown[]=[],messages:unknown[]=[];const{sim,system}=setup({onExplosion:p=>explosions.push(p),onMessage:(_p,name,value)=>messages.push({name,value})});target(sim,1,8);
    const rocket=system.launch({key:'sharedassets0.assets:5701',position:{x:0,y:8},direction:{x:1,y:0}})!;system.update(.01);
    expect(explosions[0]).toMatchObject({FragmentationRayCount:24,Range:8,FragmentForce:4,DismemberChance:expect.closeTo(.3),BallisticShrapnelCount:8});
    expect(messages.map(x=>(x as {name:string}).name)).toEqual(['Shot','ExitShot','Break']);expect(messages[0]).toMatchObject({value:{damage:35}});expect(sim.entities).not.toContain(rocket);
  });
  it('sends source StunImpact instead of ballistic damage for Stunbolt',()=>{
    const messages:string[]=[];const{sim,system}=setup({onMessage:(_p,name)=>messages.push(name)});target(sim,.8,8);
    const bolt=system.launch({key:'sharedassets0.assets:3574',position:{x:0,y:8},direction:{x:1,y:0}})!;system.update(.02);expect(messages).toEqual(['StunImpact']);expect(sim.entities).not.toContain(bolt);
  });
  it('reflects IonBolt, impulses/heats its AoE and reduces total lifetime by.9',()=>{
    const pulses:unknown[]=[];const{sim,system,physical}=setup({onPulse:(...args)=>pulses.push(args),random:()=>.75});const wall=target(sim,.8,8);
    // Physical state is needed for the source BurnProgress mutation.
    wall.metadata!.components.push({type:'MonoBehaviour',className:'PhysicalBehaviour',pathId:'phys',data:{}});physical.remove(sim.entities.at(-1)!);physical.attach(sim.entities.at(-1)!);
    const bolt=system.launch({key:'sharedassets0.assets:5720',position:{x:0,y:8},direction:{x:1,y:0}})!;system.update(.02);
    expect(Math.abs(bolt.angle!)).toBeCloseTo(Math.PI);expect(pulses[0]).toMatchObject([{},expect.closeTo(.8),1]);expect(physical.get(wall)?.state.burnProgress).toBeCloseTo(.375);
    const lifetime=system.snapshot(bolt).controllers.find(c=>c.id==='21454')!;expect(lifetime.life).toBeCloseTo(3.6);
  });
  it('restores midflight velocity/lifetime without applying launch impulse again',()=>{
    const first=setup(),shell=first.system.launch({key:'sharedassets0.assets:3281',position:{x:0,y:8},direction:{x:1,y:0}})!;first.system.update(1);
    const scene=first.sim.serialize(),second=setup();second.sim.import(scene);const restored=second.sim.entities[0];expect(second.system.snapshot(restored)).toEqual(first.system.snapshot(shell));second.system.update(.02);expect(restored.parts[0].body.getLinearVelocity().x).toBeCloseTo(700);
    const saved=second.system.snapshot(restored),invalid=structuredClone(saved);invalid.controllers[0].time=NaN;expect(second.system.restore(restored,invalid)).toBe(false);expect(second.system.snapshot(restored)).toEqual(saved);
  });
  it('handles scene-cap spawn errors without throwing into animation callbacks',()=>{
    const{system}=setup({spawnResource:()=>{throw new Error('Scene limit');}});expect(system.launch({key:'sharedassets0.assets:3281',position:{x:0,y:0},direction:{x:1,y:0}})).toBeNull();expect([...system.unsupported]).toContain('Projectile spawn: Scene limit');
  });
  it('rejects partial/duplicate controllers and fractional pending without mutating state',()=>{
    const{system}=setup(),shell=system.launch({key:'sharedassets0.assets:3281',position:{x:0,y:8},direction:{x:1,y:0}})!,saved=system.snapshot(shell);
    const partial=structuredClone(saved);partial.controllers.pop();expect(system.restore(shell,partial)).toBe(false);
    const duplicate=structuredClone(saved);duplicate.controllers[1]=structuredClone(duplicate.controllers[0]);expect(system.restore(shell,duplicate)).toBe(false);
    const fractional=structuredClone(saved);fractional.controllers[0].pending=.5;expect(system.restore(shell,fractional)).toBe(false);expect(system.snapshot(shell)).toEqual(saved);
  });
  it('runs native Javelin delay, takeoff, EMP and airborne-shot explosion gates',()=>{
    const explosions:unknown[]=[],{system}=setup({onExplosion:p=>explosions.push(p)});const missile=system.launch({key:'sharedassets0.assets:5317',position:{x:0,y:8},direction:{x:1,y:0}})!;
    system.shot(missile.parts[0],100);expect(explosions).toHaveLength(0);system.update(.31);expect(missile.parts[0].body.getGravityScale()).toBe(0);
    system.emp(missile.parts[0]);expect(missile.parts[0].body.getGravityScale()).toBe(1);expect(system.snapshot(missile).controllers[0].broken).toBe(true);
    system.shot(missile.parts[0],41);expect(explosions[0]).toMatchObject({FragmentationRayCount:64,Range:40,FragmentForce:90});
  });
  it('guards Javelin explosion reentrancy before dispatching fragment callbacks',()=>{
    let count=0;const{system}=setup({onExplosion:()=>{count++;system.shot(missile.parts[0],100);}});const missile=system.launch({key:'sharedassets0.assets:5317',position:{x:0,y:8},direction:{x:1,y:0}})!;
    system.update(.31);system.shot(missile.parts[0],100);expect(count).toBe(1);
  });
});

describe.skipIf(!existsSync('public/local-assets/prefabs/20110.json'))('shipped launcher integration',()=>{
  it('keeps Machine Gun alive when an explicitly enabled source child flash expires',()=>{
    const{sim,assets,system}=setup(),id='20255',prefab=JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8'))as Prefab;
    const flash=prefab.nodes.find(n=>n.id==='3489')!,timer=flash.components.find(c=>c.className==='DeleteAfterTime')!;expect(timer.data.m_Enabled).toBe(0);
    // Native template disables this timer. Enable a cloned fixture to exercise its lifetime path.
    timer.data.m_Enabled=1;assets.prefabs.set(id,prefab);const gun=sim.spawnPrefab(id,0,8);system.update(6);expect(sim.entities).toContain(gun);
    system.update(.01);expect(sim.entities).toContain(gun);expect(gun.metadata?.nodes.find(n=>n.id==='3489')?.active).toBe(false);
    expect(gun.metadata?.nodes.find(n=>n.id==='3269')?.active).toBe(true);expect(system.snapshot(gun).controllers.some(c=>c.id===timer.pathId)).toBe(false);
    expect(gun.metadata?.nodes.filter(n=>['3489','3490','3488','5743','5395','3731','4094'].includes(n.id)).every(n=>!n.active)).toBe(true);
    const scene=sim.serialize();expect(()=>sim.import(scene)).not.toThrow();expect(sim.entities[0].metadata?.nodes.find(n=>n.id==='3489')?.active).toBe(false);
  });
  it('preserves the default disabled Machine Gun child timer without starting it',()=>{
    const{sim,assets,system}=setup(),id='20255';assets.prefabs.set(id,JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8'))as Prefab);const gun=sim.spawnPrefab(id,0,8);
    system.update(10);expect(sim.entities).toContain(gun);expect(gun.metadata?.nodes.find(n=>n.id==='3489')?.active).toBe(true);
  });
  it('launches native bazooka resource and delays genericCrossbow launch until fixed update',()=>{
    for(const id of ['20110','20155']){
      const{sim,assets,system}=setup();const prefab=JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8'))as Prefab;assets.prefabs.set(id,prefab);const launcher=sim.spawnPrefab(id,0,8);
      expect(system.canUse(launcher)).toBe(true);system.use(launcher);if(id==='20155'){expect(sim.entities).toHaveLength(1);system.update(.02);}
      expect(sim.entities).toHaveLength(2);expect(sim.entities[1].catalogId).toBe(id==='20110'?'resource:sharedassets0.assets:5701':'resource:sharedassets0.assets:3440');
    }
  });
  it('delegates native tank collision explosive config to WeaponSystem',()=>{
    const{sim,system,physical}=setup(),explosions:number[]=[];const weapons=new WeaponSystem(sim,physical,{onExplosion:(_p,range)=>explosions.push(range)});
    sim.onSpawn.push(e=>weapons.attach(e));sim.onRemove.push(e=>weapons.remove(e));sim.beforeStep.push(dt=>{system.update(dt);weapons.beforeStep(dt);});target(sim,2.2,8);
    system.launch({key:'sharedassets0.assets:3281',position:{x:0,y:8},direction:{x:1,y:0},temperature:300});
    for(let i=0;i<20;i++)sim.step();expect(explosions).toContain(27);
  });
  it('preserves Spike Gun automatic strict interval and stops accumulating on release',()=>{
    const{sim,assets,system}=setup(),id='20327';assets.prefabs.set(id,JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8'))as Prefab);const launcher=sim.spawnPrefab(id,0,8);
    system.setHeld(launcher,true);system.update(.1);expect(sim.entities).toHaveLength(1);system.update(.0001);expect(sim.entities).toHaveLength(2);
    system.setHeld(launcher,false);system.update(1);expect(sim.entities).toHaveLength(2);
  });
  it('selects native Spike Rifle LaunchClips when launchSound is a Unity null pointer',()=>{
    const clips:unknown[]=[],{sim,assets,system}=setup({random:()=>0,onEffect:(pointer,_p,kind)=>{if(kind==='launch')clips.push(pointer);}}),id='20327';
    assets.prefabs.set(id,JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8'))as Prefab);const launcher=sim.spawnPrefab(id,0,8);system.use(launcher);system.update(.02);expect(clips[0]).toMatchObject({m_PathID:1068});
  });
  it('retains Normal Sized Gun linked Kogel ownership across scene reload and immediate deletion',()=>{
    const{sim,assets,system}=setup(),id='20272';assets.prefabs.set(id,JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8'))as Prefab);const launcher=sim.spawnPrefab(id,0,8);system.use(launcher);system.update(.02);
    expect(sim.entities).toHaveLength(2);const scene=sim.serialize();sim.import(scene);const restoredGun=sim.entities[0];sim.remove(restoredGun);expect(sim.entities).toHaveLength(0);
  });
});
