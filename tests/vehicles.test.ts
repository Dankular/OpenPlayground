import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {Box,Vec2,World} from 'planck';
import {Simulation,type Entity,type Part} from '../src/simulation';
import type {AssetLibrary,Prefab} from '../src/prefabs';
import {VehicleSystem,generatedVehicleJointIds} from '../src/systems/vehicles';

function load(id:string){
  const prefab=JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8')) as Prefab;
  const assets={buildId:'vehicles-fixture',catalog:{items:[],categories:[]},prefabs:new Map([[id,prefab]])} as AssetLibrary;
  const sim=new Simulation(null,assets),entity=sim.spawnPrefab(id,0,8);return{sim,entity,prefab};
}
describe.skipIf(!existsSync('public/local-assets/prefabs/20141.json'))('shipped vehicle prefab controllers',()=>{
  it('binds all six native cars to their actual wheel joints and source break strength',()=>{
    for(const id of ['20138','20141','20269','20275','20341','20352']){
      const{sim,entity}=load(id),calls:number[]=[];
      const system=new VehicleSystem({setJointBreakForce:(joint,force)=>{calls.push(force);sim.setJointBreakForce(joint,force);}});system.attach(entity);
      const car=system.get(entity).find(s=>s.kind==='CarBehaviour')!;
      expect(car).toBeDefined();expect(car.wheels.length).toBeGreaterThan(0);expect(car.brake).toBe(true);
      expect(calls.every(force=>force===15000*Number(car.config.WheelJointStrengthMultiplier))).toBe(true);
      system.update(.02);for(const wheel of car.wheels){expect(wheel.isMotorEnabled()).toBe(true);expect(wheel.getMotorSpeed()).toBeCloseTo(0);}
    }
  });
  it('runs source Hermite acceleration, charge boost, reverse and freewheel controls',()=>{
    const{entity}=load('20141'),system=new VehicleSystem({getPhysical:()=>({state:{charge:2,wetness:0}})});system.attach(entity);
    const car=system.get(entity)[0];system.use(entity,0,false,car.part);system.update(2);
    // Actual Car curve at .5 is .25; original -4200 minus charge*50, degrees/sec.
    expect(car.wheels[0].getMotorSpeed()).toBeCloseTo(4300*.25*Math.PI/180);
    system.use(entity,1,false,car.part);system.update(.02);expect(car.wheels[0].getMotorSpeed()).toBeLessThan(0);
    system.use(entity,0,false,car.part);system.setBrake(entity,false);system.update(.02);expect(car.wheels.every(w=>!w.isMotorEnabled())).toBe(true);
    expect(system.use(entity,0,true)).toBe(false);
  });
  it('uses wetness health loss, strict negative death and waterproof wheel distinction',()=>{
    for(const id of ['20141','20269']){
      const{entity}=load(id),system=new VehicleSystem({getPhysical:()=>({state:{charge:0,wetness:.01}})});system.attach(entity);const car=system.get(entity)[0];
      system.use(entity);system.update(2);
      if(id==='20141'){expect(car.health).toBe(0);expect(car.activated).toBe(true);system.update(.02);expect(car.activated).toBe(false);expect(system.use(entity)).toBe(false);system.repair(entity);expect(system.use(entity)).toBe(true);}
      else{expect(car.health).toBe(1);expect(car.activated).toBe(true);}
    }
  });
  it('honors actual Engine ActOnShot threshold and event target, and EMP toggles health',()=>{
    const{entity}=load('20141'),system=new VehicleSystem({random:()=>0});system.attach(entity);system.use(entity);
    const engine=entity.parts.find(p=>p.metadata?.components.some(c=>c.className==='ActOnShot'))!;
    expect(system.shot(engine,19)).toBe(false);expect(system.get(entity)[0].health).toBe(1);
    expect(system.shot(engine,20)).toBe(true);expect(system.get(entity)[0].health).toBe(-1);expect(system.get(entity)[0].activated).toBe(false);
    system.emp(system.get(entity)[0].part);expect(system.get(entity)[0].health).toBe(1);
  });
  it('resumes direction, acceleration time, health and brake without replaying activation',()=>{
    const{entity}=load('20141'),system=new VehicleSystem();system.attach(entity);system.use(entity);system.use(entity,1);system.update(1);system.setBrake(entity,false);
    const saved=system.snapshot(entity);system.use(entity);system.setHealth(entity,-1);expect(system.restore(entity,saved)).toBe(true);expect(system.snapshot(entity)).toEqual(saved);
    const bad=structuredClone(saved);bad.states[0].speed=NaN;expect(system.restore(entity,bad)).toBe(false);expect(system.snapshot(entity)).toEqual(saved);
  });
  it('calibrates five native hover transforms with source local offsets',()=>{
    const{entity}=load('20216'),system=new VehicleSystem();system.attach(entity);const hover=system.get(entity)[0];
    expect(hover.points).toHaveLength(5);expect(hover.points[0].height).toBeCloseTo(1.3-.799);expect(hover.speed).toBe(900);
  });
  it('constructs Old Tank nine runtime suspension joints from the creator script and remains finite',()=>{
    const{sim,entity,prefab}=load('20275'),system=new VehicleSystem({setJointBreakForce:(j,f)=>{sim.setJointBreakForce(j,f);}});
    system.attach(entity);const car=system.get(entity).find(s=>s.kind==='CarBehaviour')!;
    expect(car.wheels).toHaveLength(9);expect(generatedVehicleJointIds(prefab).size).toBe(9);
    expect([...generatedVehicleJointIds(prefab)].every(id=>entity.jointById?.has(id))).toBe(true);
    expect(car.wheels.every(w=>w.getSpringFrequencyHz()===4&&w.getSpringDampingRatio()===1)).toBe(true);
    sim.beforeStep.push(dt=>system.update(dt));system.use(entity,0,false,car.part);
    for(let i=0;i<100;i++)sim.step();
    expect(entity.parts.every(p=>[p.body.getPosition().x,p.body.getPosition().y,p.body.getAngle()].every(Number.isFinite))).toBe(true);
    const count=entity.joints.length;system.attach(entity);expect(entity.joints).toHaveLength(count);
  });
  it('respects controller child collision opt-out while leaving Bus collision setting intact',()=>{
    for(const id of ['20138','20352']){const{entity}=load(id),system=new VehicleSystem();system.attach(entity);
      const filters=entity.parts.flatMap(p=>{const result:number[]=[];for(let f=p.body.getFixtureList();f;f=f.getNext())result.push(f.getFilterGroupIndex());return result;});
      expect(filters.every(value=>value===(id==='20352'?-entity.id:0))).toBe(true);
    }
  });
  it('applies native Boat Motor thrust only underwater, including charge and reverse',()=>{
    const{sim,entity}=load('20128');sim.world.setGravity(Vec2());let underwater=false;
    const system=new VehicleSystem({isUnderWater:()=>underwater,getPhysical:()=>({state:{charge:5,wetness:1}})});system.attach(entity);const boat=system.get(entity)[0];system.use(entity);
    system.update(.02);sim.world.step(.02);expect(boat.part.body.getLinearVelocity().x).toBeCloseTo(0);underwater=true;
    system.update(.02);sim.world.step(.02);expect(boat.part.body.getLinearVelocity().x).toBeGreaterThan(0);expect(boat.fanDampening).toBe(.3);
    system.use(entity,1);boat.part.body.setLinearVelocity(Vec2());system.update(.02);sim.world.step(.02);expect(boat.part.body.getLinearVelocity().x).toBeLessThan(0);
  });
  it('emits original Tank projectile identity, heat, muzzle and pulse plus recoil',()=>{
    for(const id of ['20275','20341']){const{entity}=load(id),shots:unknown[]=[],pulses:unknown[]=[];
      const system=new VehicleSystem({onTankShot:shot=>shots.push(shot),onPulse:(...args)=>pulses.push(args)});system.attach(entity);const barrel=system.get(entity).find(s=>s.kind==='TankBarrelBehaviour')!;
      system.use(entity,0,false,barrel.part);expect(shots).toHaveLength(1);expect(shots[0]).toMatchObject({projectile:{m_PathID:3281},temperature:300});expect(pulses[0]).toMatchObject([{},3,10]);expect(barrel.part.body.getLinearVelocity().x).toBeLessThan(0);
    }
  });
});

describe('hover force adaptation',()=>{
  it('broadcasts use to descendant controllers while excluding sibling subtrees',()=>{
    const world=new World(Vec2());
    const part=(id:string,components:NonNullable<Part['metadata']>['components']=[]):Part=>({id,body:world.createDynamicBody(),width:1,height:1,shape:'box',color:'#fff',label:id,metadata:{nodeId:id,components}});
    const parent=part('parent'),child=part('child',[{type:'MonoBehaviour',className:'BoatMotorBehaviour',pathId:'motor',data:{Force:25}}]),sibling=part('sibling');
    const nodes=[{id:'parent',parentId:null},{id:'child',parentId:'parent'},{id:'sibling',parentId:null}].map(node=>({...node,name:node.id,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,components:node.id==='child'?child.metadata!.components:[]}));
    const entity:Entity={id:1,kind:'prefab',parts:[parent,child,sibling],joints:[],frozen:false,metadata:{nodes}},system=new VehicleSystem();system.attach(entity);
    expect(system.canUse(entity,parent)).toBe(true);expect(system.use(entity,0,false,parent)).toBe(true);expect(system.get(entity)[0].activated).toBe(true);
    expect(system.canUse(entity,sibling)).toBe(false);expect(system.use(entity,0,false,sibling)).toBe(false);expect(system.get(entity)[0].activated).toBe(true);
  });
  it('supports, drives and reacts on a physical ground body with source layer masking',()=>{
    const world=new World(Vec2()),body=world.createDynamicBody(Vec2(0,.5));body.createFixture(Box(.1,.1),1);
    const floor=world.createBody(Vec2(0,-.1));floor.createFixture(Box(5,.1));
    const transform={type:'Transform',pathId:'pointTransform',data:{m_LocalPosition:{x:0,y:0}}};
    const part:Part={id:'body',body,width:.2,height:.2,shape:'box',color:'#fff',label:'hover',metadata:{nodeId:'hover',components:[{type:'MonoBehaviour',className:'HovercarBehaviour',pathId:'control',data:{HoverHeight:1,HoverPoints:[{m_PathID:'pointTransform'}],Layers:{m_Bits:16},ForceMultiplier:100,FactorPower:2,BaseSpeed:10,VelocityRetention:.99}}]}};
    const entity:Entity={id:1,kind:'prefab',parts:[part],joints:[],frozen:false,metadata:{nodes:[{id:'hover',name:'hover',parentId:null,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,components:[]},{id:'point',name:'point',parentId:'hover',position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,components:[transform]}]}};
    const system=new VehicleSystem({fixtureLayer:()=>4,physicalBody:()=>true});system.attach(entity);system.use(entity);system.update(.02);world.step(.02);
    expect(system.get(entity)[0].grounded).toBe(true);expect(body.getLinearVelocity().y).toBeGreaterThan(0);expect(body.getLinearVelocity().x).toBeGreaterThan(0);
    const masked=new VehicleSystem({fixtureLayer:()=>0});masked.attach(entity);masked.update(.02);expect(masked.get(entity)[0].grounded).toBe(false);
  });
});

