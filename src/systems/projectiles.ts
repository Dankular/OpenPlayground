import {AABB,Circle,Transform,Vec2,testOverlap,type Body,type Fixture} from 'planck';
import type {Entity,Part,Simulation} from '../simulation';
import type {AssetLibrary,Prefab,SourceComponent,SourceNode} from '../prefabs';
import type {TankShot} from './vehicles';
import type {ExplosionParameters} from './explosions';
import {evaluatePoseCurve,type SerializedCurve} from './ragdoll';
import {targetsPart,fixtureLayer as sourceFixtureLayer} from './targeting';
import rawBundle from '../generated/projectiles.json?raw';

type Data=Record<string,unknown>;type Point={x:number;y:number};
const bundle=JSON.parse(rawBundle) as {prefabs:Record<string,Prefab>;launchers:{catalogId:string;componentId:string;projectileKey:string;field:string}[]};
const number=(v:unknown,f=0)=>typeof v==='number'&&Number.isFinite(v)?v:f;
const ref=(v:unknown)=>String((v as {m_PathID?:unknown})?.m_PathID??'0');
const vector=(v:unknown,f:Point={x:0,y:0})=>{const p=v as Point|undefined;return Vec2(number(p?.x,f.x),number(p?.y,f.y));};
const mask=(v:unknown,f=2560)=>number((v as {m_Bits?:number})?.m_Bits,f);
const enabled=(c:SourceComponent)=>c.data.m_Enabled!==0&&c.data.m_Enabled!==false;
export function registerProjectilePrefabs(assets:AssetLibrary):Map<string,Prefab>{const result=new Map(Object.entries(bundle.prefabs));for(const [key,prefab]of result)assets.prefabs.set(key,prefab);return result;}
export interface ProjectileLaunch {key:string;position:Point;direction:Point;temperature?:number}
export interface ProjectileOptions {
  spawnResource:(prefab:Prefab,position:Point,angle:number)=>Entity;
  getPhysical?:(part:Part)=>{state:{temperature:number;burnProgress:number};settings?:{SimulateTemperature?:boolean}}|undefined;
  fixtureLayer?:(fixture:Fixture)=>number;
  isUnderWater?:(point:Point)=>boolean;
  random?:()=>number;
  noise?:(x:number,y:number)=>number;
  onExplosion?:(parameters:ExplosionParameters,source:Entity)=>void;
  onPulse?:(point:Point,force:number,range:number)=>void;
  onMessage?:(part:Part,message:'Shot'|'ExitShot'|'Break'|'StunImpact',value:unknown)=>void;
  onEffect?:(pointer:unknown,position:Point,kind:string)=>void;
  onSourceEvent?:(entity:Entity,event:unknown)=>void;
  ignoreCollision?:(a:Fixture,b:Fixture)=>void;
  onTransformScale?:(entity:Entity,transform:unknown,scale:Point)=>void;
}
interface LinkedEntity {index:number;catalogId:string}
interface Controller {entity:Entity;component:SourceComponent;node:SourceNode;part?:Part;time:number;started:boolean;multiplier:number;seed:number;life:number;held:boolean;pending:number;linked:Set<Entity>;pendingLinked?:LinkedEntity[];pendingOwnerIndex?:number;stage:number;takenOff:boolean;broken:boolean;startY:number;targetPoint:Point;target?:Part}
export interface ProjectileSnapshot {version:1;ownerIndex?:number;controllers:{id:string;time:number;started:boolean;multiplier:number;seed:number;life:number|null;pending:number;linked?:LinkedEntity[];stage?:number;takenOff?:boolean;broken?:boolean;startY?:number;targetPoint?:Point}[]}
const supported=new Set(['ProjectileBehaviour','LaunchedRocketBehaviour','MachineGunProjectileBehaviour','DeleteAfterTime','PointToVelocityBehaviour','RocketLauncherBehaviour','ProjectileLauncherBehaviour','StunnerBehaviour','IonBoltBehaviour','JavelinMissileBehaviour']);

/** Native resource projectile/launcher logic; physical ExplosiveBehaviour belongs to WeaponSystem. */
export class ProjectileSystem {
  readonly controllers=new Map<Entity,Controller[]>();
  readonly unsupported=new Set<string>();
  private byBody=new Map<Body,Part>();
  private detonations=new Set<Controller>();
  private explodedMissiles=new WeakSet<Controller>();
  private ignoredPairs=new Map<Fixture,Set<Fixture>>();
  time=0;
  constructor(readonly simulation:Simulation,readonly options:ProjectileOptions){
    simulation.onNodeDestroy.push((entity,nodeIds)=>{const list=this.controllers.get(entity);if(list)this.controllers.set(entity,list.filter(c=>{if(!nodeIds.has(c.node.id))return true;this.detonations.delete(c);return false;}));});
    simulation.world.on('pre-solve',contact=>{if(this.ignoredPairs.get(contact.getFixtureA())?.has(contact.getFixtureB()))contact.setEnabled(false);});
    simulation.world.on('begin-contact',contact=>{
      const a=contact.getFixtureA().getBody(),b=contact.getFixtureB().getBody(),point=contact.getWorldManifold(null)?.points[0]??a.getPosition();
      const relative=Vec2.sub(a.getLinearVelocityFromWorldPoint(point),b.getLinearVelocityFromWorldPoint(point));
      if(relative.lengthSquared()<600)return;
      for(const body of [a,b]){const entity=body.getUserData() as Entity;for(const c of this.controllers.get(entity)??[])if(c.part?.body===body&&c.component.className==='JavelinMissileBehaviour'&&c.takenOff)this.detonations.add(c);}
    });
  }
  attach(entity:Entity):void {
    if(this.controllers.has(entity))return;const controllers:Controller[]=[];
    for(const part of entity.parts)this.byBody.set(part.body,part);
    for(const node of entity.metadata?.nodes??[]){if(!node.active)continue;
      for(const component of node.components){if(!enabled(component))continue;const name=component.className??component.type;
        if(!supported.has(name)){if(['JavelinMissileBehaviour','GenericScifiProjectileBehaviour','GorseProjectileBehaviour'].includes(name))this.unsupported.add(name);continue;}
        const part=entity.parts.find(p=>p.id===ref(component.data.Rigidbody))??entity.parts.find(p=>p.metadata?.nodeId===node.id);
        controllers.push({entity,node,component,part,time:0,started:false,multiplier:1,seed:(this.options.random?.()??Math.random())*1000,life:number(component.data.Life,Infinity),held:false,pending:0,linked:new Set(),stage:0,takenOff:false,broken:false,startY:0,targetPoint:vector(component.data.StaticTargetPoint)});
      }
    }
    this.controllers.set(entity,controllers);
  }
  private resolveLinks():void {for(const list of this.controllers.values())for(const c of list)if(c.pendingLinked){
    // Import temporarily contains both the old and staged scene. Do not bind to old actors.
    if(c.pendingOwnerIndex!==undefined&&this.simulation.entities.indexOf(c.entity)!==c.pendingOwnerIndex)continue;
    for(const saved of c.pendingLinked){const entity=this.simulation.entities[saved.index];if(entity&&entity!==c.entity&&entity.catalogId===saved.catalogId)c.linked.add(entity);}c.pendingLinked=undefined;
  }}
  remove(entity:Entity):void{this.resolveLinks();const list=this.controllers.get(entity);this.controllers.delete(entity);for(const part of entity.parts){this.byBody.delete(part.body);for(let f=part.body.getFixtureList();f;f=f.getNext()){for(const other of this.ignoredPairs.get(f)??[])this.ignoredPairs.get(other)?.delete(f);this.ignoredPairs.delete(f);}}for(const c of list??[]){this.detonations.delete(c);if(c.component.data.RemoveLaunchedObjectsWithMe)for(const linked of c.linked)if(this.simulation.entities.includes(linked))this.simulation.remove(linked);}}
  private resolve(entity:Entity,component:SourceComponent):string|null {
    const entries=bundle.launchers.filter(x=>x.catalogId===entity.catalogId&&x.componentId===component.pathId);
    const found=entries.find(x=>x.field==='projectileAsset')??entries[0];return found?`resource:${found.projectileKey}`:null;
  }
  launch(input:TankShot|ProjectileLaunch):Entity|null {
    let key:string|null;
    if('key'in input)key=input.key.startsWith('resource:')?input.key:`resource:${input.key}`;
    else{const component=input.part.metadata?.components.find(c=>c.className==='TankBarrelBehaviour');key=component?this.resolve(input.entity,component):null;}
    const prefab=key?bundle.prefabs[key]:undefined;if(!prefab){this.unsupported.add(`Unresolved projectile ${key??'source reference'}`);return null;}
    let entity:Entity;try{entity=this.options.spawnResource(prefab,input.position,Math.atan2(input.direction.y,input.direction.x));}catch(error){this.unsupported.add(`Projectile spawn: ${error instanceof Error?error.message:String(error)}`);return null;}
    if(!this.controllers.has(entity))this.attach(entity);
    if(input.temperature!==undefined)for(const part of entity.parts){const p=this.options.getPhysical?.(part);if(p)p.state.temperature=input.temperature;}
    return entity;
  }
  private launchers(entity:Entity,targetPart?:Part):Controller[]{return(this.controllers.get(entity)??[]).filter(c=>['RocketLauncherBehaviour','ProjectileLauncherBehaviour'].includes(c.component.className??'')&&c.part&&targetsPart(entity,c.part,targetPart));}
  canUse(entity:Entity,targetPart?:Part):boolean{return this.launchers(entity,targetPart).length>0;}
  use(entity:Entity,_channel=0,continuous=false,targetPart?:Part):boolean {
    const list=this.launchers(entity,targetPart);if(continuous){for(const c of list)c.held=true;return list.some(c=>!!c.component.data.IsAutomatic);}
    for(const c of list){c.time=0;if(c.component.className==='RocketLauncherBehaviour')this.fire(c);else c.pending++;}return list.length>0;
  }
  setHeld(entity:Entity,held:boolean,targetPart?:Part):void{for(const c of this.launchers(entity,targetPart))c.held=held;}
  private fire(c:Controller):void {
    const part=c.part;if(!part)return;const d=c.component.data,key=this.resolve(c.entity,c.component);if(!key){this.unsupported.add(`Launcher ${c.component.pathId}`);return;}
    const scale=c.node.scale,p=vector(d.barrelPosition),v=vector(d.barrelDirection,{x:1,y:0});
    const position=part.body.getWorldPoint(Vec2(p.x*scale.x,p.y*scale.y)),direction=part.body.getWorldVector(Vec2(v.x*scale.x,v.y*scale.x));
    const projectile=this.launch({key,position,direction});if(!projectile)return;
    if(c.component.className==='ProjectileLauncherBehaviour'){
      const launched=projectile.parts[0],strength=number(d.projectileLaunchStrength);
      if(launched){const phys=this.options.getPhysical?.(launched),source=this.options.getPhysical?.(part);if(phys&&source&&phys.settings?.SimulateTemperature!==false&&source.settings?.SimulateTemperature!==false)phys.state.temperature=source.state.temperature;
        launched.body.applyLinearImpulse(Vec2.mul(direction,strength),launched.body.getWorldCenter(),true);
        for(const sourcePart of c.entity.parts)if(targetsPart(c.entity,sourcePart,part))for(let a=sourcePart.body.getFixtureList();a;a=a.getNext())for(let b=launched.body.getFixtureList();b;b=b.getNext()){
          const aSet=this.ignoredPairs.get(a)??new Set<Fixture>(),bSet=this.ignoredPairs.get(b)??new Set<Fixture>();aSet.add(b);bSet.add(a);this.ignoredPairs.set(a,aSet);this.ignoredPairs.set(b,bSet);this.options.ignoreCollision?.(a,b);
        }
      }
      const angle=projectile.angle??0;part.body.applyLinearImpulse(Vec2(-Math.cos(angle)*strength*number(d.recoilMultiplier,1),-Math.sin(angle)*strength*number(d.recoilMultiplier,1)),part.body.getWorldCenter(),true);
      if(d.RemoveLaunchedObjectsWithMe)c.linked.add(projectile);
      if(d.ShouldPutProjectileInOtherLayer){const root=projectile.metadata?.nodes.find(n=>n.id===bundle.prefabs[key].rootGameObjectId);if(root)(root as SourceNode&{layer:number}).layer=number(d.LayerToPutProjectileOn,-1);}
      this.options.onSourceEvent?.(c.entity,d.OnLaunchEvent);this.options.onEffect?.(d.muzzleFlashPrefab,position,'muzzle');
    }
    const clips=(c.component.className==='RocketLauncherBehaviour'?d.LaunchingSounds:d.LaunchClips) as unknown[]|undefined;
    const pick=()=>clips?.length?clips[Math.min(clips.length-1,Math.floor((this.options.random?.()??Math.random())*clips.length))]:undefined;
    const audioSource=c.entity.metadata?.nodes.flatMap(n=>n.components).find(source=>source.pathId===ref(d.AudioSource));
    const sound=c.component.className==='RocketLauncherBehaviour'?(pick()??audioSource?.data.m_audioClip):(ref(d.launchSound)!=='0'?d.launchSound:pick());
    if(ref(sound)!=='0')this.options.onEffect?.(sound,position,'launch');
  }
  update(dt:number):void {
    if(!(dt>0))return;this.resolveLinks();this.time+=dt;
    // Snapshot collections: callbacks may spawn/remove projectiles during this iteration.
    for(const [entity,list]of [...this.controllers])for(const c of [...list]){
      if(!this.controllers.has(entity))break;const d=c.component.data,name=c.component.className??c.component.type;
      if(!c.node.active||!enabled(c.component))continue;
      if(!c.started){c.started=true;
        if(name==='ProjectileBehaviour'&&c.part){const impulse=c.part.body.getWorldVector(vector(d.LocalDirection,{x:1,y:0}));c.part.body.applyLinearImpulse(Vec2.mul(impulse,number(d.Force,5)),c.part.body.getWorldCenter(),true);}
        if(name==='IonBoltBehaviour')this.options.onEffect?.(d.ImpactEffect,this.position(c),'ion-start');
      }
      if(name==='DeleteAfterTime'){
        c.time+=dt;if(c.time>c.life){this.options.onSourceEvent?.(entity,d.OnEndOfLife);for(const ion of list.filter(x=>x.component.className==='IonBoltBehaviour'&&ref(x.component.data.DeleteAfterTime)===c.component.pathId))this.options.onEffect?.(ion.component.data.EndOfLifeEffect,this.position(ion),'ion-end');this.expire(c);}continue;
      }
      if(name==='ProjectileLauncherBehaviour'){
        const pending=c.pending;c.pending=0;for(let i=0;i<pending;i++)this.fire(c);
        if(c.held&&d.IsAutomatic)c.time+=dt;
        if(d.IsAutomatic&&c.time>number(d.AutomaticInterval)){c.time=0;this.fire(c);}continue;
      }
      if(['LaunchedRocketBehaviour','MachineGunProjectileBehaviour','StunnerBehaviour','IonBoltBehaviour'].includes(name)){this.move(c,dt);continue;}
      if(name==='JavelinMissileBehaviour'){this.missile(c,dt);continue;}
      if(name==='PointToVelocityBehaviour'&&c.part?.body.isDynamic()){
        const body=c.part.body,v=body.getLinearVelocity(),dir=vector(d.direction,{x:1,y:0}),world=body.getWorldVector(Vec2(dir.x*c.node.scale.x,dir.y*c.node.scale.y));
        const delta=((Math.atan2(v.y,v.x)-Math.atan2(world.y,world.x))*180/Math.PI%360+540)%360-180;
        if(Math.abs(delta)<25)body.setAngularVelocity(body.getAngularVelocity()*Math.max(.95,Math.min(1,delta/25)));
        body.applyTorque(delta*number(d.intensity,1)*v.length(),true);
      }
    }
  }
  afterStep(_dt:number):void{for(const c of this.detonations)if(this.controllers.has(c.entity))this.explodeMissile(c);this.detonations.clear();}
  private expire(c:Controller):void {
    if(c.node.parentId===null){this.simulation.remove(c.entity);return;}
    const nodes=c.entity.metadata?.nodes??[],destroyed=new Set([c.node.id]);let changed=true;
    while(changed){changed=false;for(const node of nodes)if(node.parentId&&destroyed.has(node.parentId)&&!destroyed.has(node.id)){destroyed.add(node.id);changed=true;}}
    this.simulation.destroyNode(c.entity,c.node.id);
    this.controllers.set(c.entity,(this.controllers.get(c.entity)??[]).filter(controller=>{if(!destroyed.has(controller.node.id))return true;this.detonations.delete(controller);return false;}));
  }
  setTarget(entity:Entity,target:Part|Point):void{for(const c of this.controllers.get(entity)??[])if(c.component.className==='JavelinMissileBehaviour'){if('body'in target)c.target=target;else{c.target=undefined;c.targetPoint={...target};}}}
  shot(part:Part,damage:number):void{if(damage<=40)return;for(const list of this.controllers.values())for(const c of list)if(c.part===part&&c.component.className==='JavelinMissileBehaviour')this.explodeMissile(c);}
  emp(part:Part):void{for(const list of this.controllers.values())for(const c of list)if(c.part===part&&c.component.className==='JavelinMissileBehaviour'){if(!c.broken)this.options.onEffect?.(c.component.data.SparkPrefab,this.position(c),'missile-emp');c.broken=true;part.body.setGravityScale(1);}}
  private missile(c:Controller,dt:number):void{
    const body=c.part?.body;if(!body)return;const d=c.component.data;c.time+=dt;
    this.options.onTransformScale?.(c.entity,d.Fins,{x:1,y:evaluatePoseCurve(d.FinExtendCurve as SerializedCurve,c.time)});
    if(c.broken)return;
    if(!c.takenOff&&c.time>=number(d.TakeOffDelay,1)){c.takenOff=true;c.startY=body.getPosition().y;body.setGravityScale(0);this.options.onEffect?.(d.TakeOffSound,this.position(c),'missile-takeoff');}
    if(!c.takenOff)return;if(body.getPosition().y>c.startY+number(d.ArcHeight,20))c.stage=1;
    let targetAngle=90,strength=number(d.VerticalLiftoffRotationStrength,.5);
    if(c.stage===1){const position=body.getPosition(),target=c.target?.body.getPosition()??c.targetPoint;let predicted=Vec2(target);
      if(c.target){const speed=body.getLinearVelocity().length();if(speed>Number.EPSILON)predicted.add(Vec2.mul(c.target.body.getLinearVelocity(),Vec2.distance(target,position)/speed));}
      predicted.sub(position);targetAngle=Math.atan2(predicted.y,predicted.x)*180/Math.PI;strength=number(d.AimingStrength,1);
    }
    const delta=((targetAngle-body.getAngle()*180/Math.PI)%360+540)%360-180;body.applyTorque(strength*delta,true);body.setAngularVelocity(body.getAngularVelocity()*.92);
    body.applyForceToCenter(body.getWorldVector(Vec2.mul(vector(d.LocalDirection,{x:1,y:0}),number(d.ForceIntensity,1))),true);
    const up=body.getWorldVector(Vec2(0,1)),velocity=body.getLinearVelocity(),speed=velocity.length(),normal=speed===0?Vec2(1,0):Vec2.mul(velocity,1/speed);
    body.applyForceToCenter(Vec2.mul(up,Vec2.dot(up,normal)*-3*Math.abs(c.node.scale.x)*speed),true);
  }
  private explodeMissile(c:Controller):void{if(!c.takenOff||!this.controllers.has(c.entity)||this.explodedMissiles.has(c))return;this.explodedMissiles.add(c);const position=this.position(c);
    this.options.onExplosion?.({Position:position,FragmentationRayCount:64,Range:40,FragmentForce:90,CreateParticlesAndSound:false},c.entity);this.options.onPulse?.(position,2,40);
    if(!this.options.isUnderWater?.(position))this.options.onEffect?.(c.component.data.ExplosionEffect,position,'missile-explosion');this.simulation.remove(c.entity);
  }
  private position(c:Controller):Vec2{return c.part?c.part.body.getPosition().clone():Vec2(c.entity.position??{x:0,y:0});}
  private layer(f:Fixture):number{return(this.options.fixtureLayer??sourceFixtureLayer)(f);}
  private ray(c:Controller,from:Vec2,to:Vec2,layers:number):{fixture:Fixture;point:Vec2;normal:Vec2}|undefined {
    let hit:{fixture:Fixture;point:Vec2;normal:Vec2}|undefined;
    this.simulation.world.rayCast(from,to,(fixture,p,normal,fraction)=>{if(fixture.isSensor()||fixture.getBody().getUserData()===c.entity||(layers&(1<<this.layer(fixture)))===0)return -1;hit={fixture,point:p.clone(),normal:normal.clone()};return fraction;});return hit;
  }
  private move(c:Controller,dt:number):void {
    const d=c.component.data,name=c.component.className,origin=this.position(c),angle=c.part?.body.getAngle()??c.entity.angle??0;let direction=Vec2(Math.cos(angle),Math.sin(angle)),distance=0;
    if(name==='LaunchedRocketBehaviour'){
      const fieldMask=mask(d.ImmobiltyFieldLayer,0);let inside=false;
      this.simulation.world.queryAABB(new AABB(Vec2(origin.x-.001,origin.y-.001),Vec2(origin.x+.001,origin.y+.001)),f=>{if((fieldMask&(1<<this.layer(f)))&&f.testPoint(origin))inside=true;return true;});
      c.multiplier=inside?c.multiplier*number(d.ImmobilityFieldSlowdown,.8):1;
      if(number(d.WobbleIntensity,1)>Number.EPSILON){const noise=this.options.noise??((x:number,y:number)=>(Math.sin(x*1.97+y*2.11)+1)*.5);if(!this.options.noise)this.unsupported.add('Native Unity PerlinNoise: smooth surrogate');const wobble=number(d.WobbleIntensity,1)*.25;direction.add(Vec2((noise(0,2*this.time+c.seed)*2-1)*wobble,(noise(2*this.time-c.seed,5)*2-1)*wobble));direction.normalize();}
      const multiplier=(this.options.isUnderWater?.(origin)?number(d.WaterSlowdown,.8):1)*c.multiplier;
      distance=Math.min(number(d.MaxSpeed,80),(number(d.UnitsPerSecond,1)+number(d.AccelerationPerSecond,.5)*c.time)*multiplier)*dt;
    }else{if(name==='MachineGunProjectileBehaviour'||name==='StunnerBehaviour'){direction.y-=c.time;direction.normalize();}distance=number(d.Speed,number(d.UnitsPerSecond,1))*dt;}
    const layers=name==='StunnerBehaviour'?mask(d.mask):name==='IonBoltBehaviour'?mask(d.Layers):2560;
    const hit=this.ray(c,origin,Vec2.add(origin,Vec2.mul(direction,distance)),layers);
    if(hit){
      const target=this.byBody.get(hit.fixture.getBody());
      if(name==='IonBoltBehaviour')this.ionHit(c,hit,layers,direction);
      else{
        if(name==='StunnerBehaviour'){if(target)this.options.onMessage?.(target,'StunImpact',{damage:0,point:hit.point,normal:hit.normal});this.options.onEffect?.(d.ImpactEffect,origin,'stun-impact');}
        else{const position=Vec2.add(hit.point,Vec2.mul(hit.normal,.05));const parameters=name==='LaunchedRocketBehaviour'?{...(d.Explosion as Data),Position:position}:{FragmentationRayCount:8,Position:position,Range:2,FragmentForce:4,CreateParticlesAndSound:true,EffectSize:0,DismemberChance:0,BallisticShrapnelCount:0};
          if(this.options.onExplosion)this.options.onExplosion(parameters as ExplosionParameters,c.entity);else this.unsupported.add('Missing native explosion callback');
          if(target){const shot={damage:35,point:hit.point,normal:hit.normal};this.options.onMessage?.(target,'Shot',shot);this.options.onMessage?.(target,'ExitShot',shot);this.options.onMessage?.(target,'Break',Vec2.mul(direction,distance));}
        }
        this.simulation.remove(c.entity);
      }
    }else{const p=Vec2.add(origin,Vec2.mul(direction,distance));if(c.part)c.part.body.setPosition(p);else c.entity.position=p;}
    c.time+=dt*(name==='MachineGunProjectileBehaviour'?.1:name==='StunnerBehaviour'?.1*number(d.Gravity,1):1);
  }
  private ionHit(c:Controller,hit:{fixture:Fixture;point:Vec2;normal:Vec2},layers:number,direction:Vec2):void {
    const d=c.component.data,strength=number(d.ImpactStrength),radius=number(d.AoERadius,1);this.options.onEffect?.(d.ImpactEffect,hit.point,'ion-impact');this.options.onPulse?.(hit.point,strength,1);
    let count=0;this.simulation.world.queryAABB(new AABB(Vec2(hit.point.x-radius,hit.point.y-radius),Vec2(hit.point.x+radius,hit.point.y+radius)),fixture=>{
      if(count>=16)return false;if((layers&(1<<this.layer(fixture)))===0)return true;
      if(!testOverlap(Circle(radius),0,fixture.getShape(),0,new Transform(hit.point),fixture.getBody().getTransform()))return true;count++;
      const target=this.byBody.get(fixture.getBody());if(!target)return true;const force=Vec2.mul(hit.normal,-strength);
      if((this.options.random?.()??Math.random())>.5)this.options.onMessage?.(target,'Break',force);target.body.applyLinearImpulse(force,hit.point,true);const physical=this.options.getPhysical?.(target);if(physical)physical.state.burnProgress+=.5*(this.options.random?.()??Math.random());return true;
    });
    const reflected=Vec2.sub(direction,Vec2.mul(hit.normal,2*Vec2.dot(direction,hit.normal)));c.entity.angle=Math.atan2(reflected.y,reflected.x);c.entity.position=hit.point;
    const lifetime=(this.controllers.get(c.entity)??[]).find(x=>x.component.className==='DeleteAfterTime');if(lifetime)lifetime.life*=.9;
    this.options.onEffect?.(d.ImpactDecal,hit.point,'ion-decal');
  }
  snapshot(entity:Entity):ProjectileSnapshot{this.resolveLinks();return{version:1,ownerIndex:this.simulation.entities.indexOf(entity),controllers:(this.controllers.get(entity)??[]).map(c=>({id:c.component.pathId,time:c.time,started:c.started,multiplier:c.multiplier,seed:c.seed,life:Number.isFinite(c.life)?c.life:null,pending:c.pending,linked:[...c.linked].filter(e=>this.simulation.entities.includes(e)&&!!e.catalogId).map(e=>({index:this.simulation.entities.indexOf(e),catalogId:e.catalogId!})),stage:c.stage,takenOff:c.takenOff,broken:c.broken,startY:c.startY,targetPoint:c.target?{...c.target.body.getPosition()}:{...c.targetPoint}}))};}
  restore(entity:Entity,input:unknown):boolean {const value=input as ProjectileSnapshot,list=this.controllers.get(entity)??[];
    if(value?.version!==1||!Array.isArray(value.controllers)||value.controllers.length!==list.length||new Set(value.controllers.map(s=>s.id)).size!==list.length||value.controllers.some(s=>!list.some(c=>c.component.pathId===s.id)||![s.time,s.multiplier,s.seed,s.pending].every(Number.isFinite)||s.time<0||s.pending<0||!Number.isInteger(s.pending)||typeof s.started!=='boolean'||(s.life!==null&&!Number.isFinite(s.life))))return false;
    if(value.controllers.some(s=>s.linked!==undefined&&(!Array.isArray(s.linked)||s.linked.some(link=>!Number.isInteger(link.index)||link.index<0||!bundle.prefabs[link.catalogId]))))return false;
    if(value.ownerIndex!==undefined&&(!Number.isInteger(value.ownerIndex)||value.ownerIndex< -1))return false;
    if(value.controllers.some(s=>s.targetPoint&&![s.targetPoint.x,s.targetPoint.y].every(Number.isFinite)||s.startY!==undefined&&!Number.isFinite(s.startY)||s.stage!==undefined&&![0,1].includes(s.stage)||s.takenOff!==undefined&&typeof s.takenOff!=='boolean'||s.broken!==undefined&&typeof s.broken!=='boolean'))return false;
    for(const s of value.controllers){const c=list.find(c=>c.component.pathId===s.id)!;Object.assign(c,{time:s.time,started:s.started,multiplier:s.multiplier,seed:s.seed,life:s.life??Infinity,pending:s.pending,linked:new Set<Entity>(),pendingLinked:s.linked?.map(link=>({...link})),pendingOwnerIndex:value.ownerIndex,stage:s.stage??0,takenOff:s.takenOff??false,broken:s.broken??false,startY:s.startY??0,targetPoint:s.targetPoint??c.targetPoint,target:undefined});}return true;
  }
}
