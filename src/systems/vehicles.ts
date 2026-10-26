import { Vec2, WheelJoint, type Body, type Fixture, type Joint } from 'planck';
import type { Entity, Part } from '../simulation';
import type { Prefab, SourceNode } from '../prefabs';
import { evaluatePoseCurve, type SerializedCurve } from './ragdoll';
import { targetsPart } from './targeting';

type Data=Record<string,unknown>;
const n=(d:Data,k:string,f=0)=>typeof d[k]==='number'?d[k] as number:f;
const ref=(v:unknown)=>String((v as {m_PathID?:unknown})?.m_PathID??'0');
const vec=(v:unknown,f={x:0,y:0})=>(v&&typeof v==='object'?v:f) as {x:number;y:number};
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export function generatedVehicleJointIds(prefab:Prefab):ReadonlySet<string>{
  return new Set(prefab.nodes.flatMap(node=>node.components.filter(c=>c.className==='AutomaticWheelJointCreator'&&c.data.m_Enabled!==0).flatMap(c=>(c.data.Wheels as unknown[]??[]).filter(p=>prefab.parts.some(part=>part.id===ref(p))).map(p=>`${c.pathId}:wheel:${ref(p)}`))));
}
export type VehicleKind='CarBehaviour'|'HovercarBehaviour'|'BoatMotorBehaviour'|'TankBarrelBehaviour';
export interface VehicleState {
  id:string;kind:VehicleKind;entity:Entity;part:Part;config:Data;node?:SourceNode;enabled:boolean;
  activated:boolean;brake:boolean;health:number;speed:number;time:number;grounded:boolean;
  wheels:WheelJoint[];points:{local:{x:number;y:number};height:number}[];
  fanSpeed:number;fanDampening:number;engineVolume:number;
}
export interface TankShot {entity:Entity;part:Part;projectile:unknown;position:{x:number;y:number};direction:{x:number;y:number};temperature:300;muzzleFlash:unknown}
export interface VehicleOptions {
  random?:()=>number;
  getPhysical?:(part:Part)=>{state:{charge:number;wetness:number}}|undefined;
  isUnderWater?:(part:Part)=>boolean;
  setJointBreakForce?:(joint:Joint,force:number)=>void;
  fixtureLayer?:(fixture:Fixture)=>number;
  physicalBody?:(body:Body)=>boolean;
  onTankShot?:(shot:TankShot)=>void;
  onPulse?:(point:{x:number;y:number},force:number,range:number)=>void;
  onActivation?:(state:VehicleState)=>void;
  onRepair?:(state:VehicleState)=>void;
  onSourceAction?:(entity:Entity,call:Data)=>void;
  /** AddComponent<WheelJoint2D> native default is outside managed metadata. */
  generatedWheelMotorTorque?:number;
}
export interface VehicleSnapshot {version:1;states:{id:string;activated:boolean;brake:boolean;health:number;speed:number;time:number}[]}

/** Managed vehicle logic adapted to Planck's reversed wheel-motor convention.
 * Update once per fixed step; source Update and FixedUpdate share that clock here. */
export class VehicleSystem {
  readonly states=new Map<Entity,VehicleState[]>();
  constructor(readonly options:VehicleOptions={}){}
  get(entity:Entity):VehicleState[]{return this.states.get(entity)??[];}
  canUse(entity:Entity,targetPart?:Part):boolean{return this.get(entity).some(s=>s.enabled&&targetsPart(entity,s.part,targetPart));}
  attach(entity:Entity):void {
    if(this.states.has(entity))return;
    const states:VehicleState[]=[],nodes=entity.metadata?.nodes??[];
    const entries=nodes.flatMap(node=>node.components.map(component=>({component,node,part:undefined as Part|undefined})));
    for(const part of entity.parts)for(const component of part.metadata?.components??[])if(!entries.some(x=>x.component.pathId===component.pathId))entries.push({component,node:nodes.find(x=>x.id===part.metadata?.nodeId)!,part});
    for(const entry of entries){
      const {component}=entry;
      const kind=component.className as VehicleKind;
      if(!['CarBehaviour','HovercarBehaviour','BoatMotorBehaviour','TankBarrelBehaviour'].includes(kind))continue;
      const d=component.data,node=entry.node;
      const physId=ref(d.Phys??d.PhysicalBehaviour),bodyId=ref(d.myRigidBody);
      const part=entity.parts.find(p=>p.id===bodyId||p.metadata?.components.some(c=>c.pathId===physId))??entity.parts.find(p=>p.metadata?.nodeId===node?.id)??('part'in entry?entry.part:undefined);
      if(!part)continue;
      const s:VehicleState={id:component.pathId,kind,entity,part,config:d,node,enabled:d.m_Enabled!==0&&d.m_Enabled!==false&&node?.active!==false,activated:!!d.Activated,brake:true,health:n(d,'Health',1),speed:n(d,kind==='CarBehaviour'?'MotorSpeed':kind==='HovercarBehaviour'?'BaseSpeed':'Force',1),time:0,grounded:false,wheels:[],points:[],fanSpeed:0,fanDampening:.6,engineVolume:0};
      if(kind==='CarBehaviour'){
        // Old Tank has no serialized wheel joints: AutomaticWheelJointCreator.Awake adds nine.
        const creator=part.metadata?.components.find(c=>c.className==='AutomaticWheelJointCreator');
        if(creator&&creator.data.m_Enabled!==0)for(const pointer of creator.data.Wheels as unknown[]??[]){
          const wheelPart=entity.parts.find(p=>p.id===ref(pointer));if(!wheelPart)continue;
          const jointId=`${creator.pathId}:wheel:${wheelPart.id}`;let joint=entity.jointById?.get(jointId);
          if(!joint){
            const wheelNode=nodes.find(x=>x.id===wheelPart.metadata?.nodeId),transform=wheelNode?.components.find(c=>c.type==='Transform');
            const anchor=vec(transform?.data.m_LocalPosition);
            joint=part.body.getWorld().createJoint(new WheelJoint({bodyA:part.body,bodyB:wheelPart.body,localAnchorA:Vec2(anchor.x,anchor.y),localAnchorB:Vec2(),localAxisA:Vec2(0,1),enableMotor:true,maxMotorTorque:this.options.generatedWheelMotorTorque??10000,frequencyHz:n(creator.data,'Frequency',8),dampingRatio:n(creator.data,'Dampening',1)}))!;
            entity.joints.push(joint);entity.jointById??=new Map();entity.jointById.set(jointId,joint);
          }
          if(joint instanceof WheelJoint)s.wheels.push(joint);
        }
        const descendants=new Set([node?.id]);let changed=true;
        while(changed){changed=false;for(const child of nodes)if(child.parentId&&descendants.has(child.parentId)&&!descendants.has(child.id)){descendants.add(child.id);changed=true;}}
        const ids=nodes.filter(x=>descendants.has(x.id)).flatMap(x=>x.components.filter(c=>c.type==='WheelJoint2D').map(c=>c.pathId));
        if(!d.CollideWithChildren)for(const childPart of entity.parts)for(let fixture=childPart.body.getFixtureList();fixture;fixture=fixture.getNext()){
          const sourceNode=(fixture.getUserData() as {sourceNodeId?:string})?.sourceNodeId??childPart.metadata?.nodeId;
          if(sourceNode!==undefined&&descendants.has(sourceNode))fixture.setFilterGroupIndex(-entity.id);
        }
        s.wheels.push(...[...entity.jointById??[]].filter(([id,j])=>ids.includes(id)&&j instanceof WheelJoint).map(([,j])=>j as WheelJoint));
        for(const joint of s.wheels)this.options.setJointBreakForce?.(joint,15000*n(d,'WheelJointStrengthMultiplier',1));
      }
      if(kind==='HovercarBehaviour')for(const pointer of d.HoverPoints as unknown[]??[]){
        const point=nodes.find(x=>x.components.some(c=>c.pathId===ref(pointer)));if(!point||!node)continue;
        const transform=point.components.find(c=>c.type==='Transform');
        const dx=point.position.x-node.position.x,dy=point.position.y-node.position.y,a=-node.angle;
        s.points.push({local:{x:dx*Math.cos(a)-dy*Math.sin(a),y:dx*Math.sin(a)+dy*Math.cos(a)},height:n(d,'HoverHeight',1.189)+vec(transform?.data.m_LocalPosition).y});
      }
      states.push(s);
    }
    this.states.set(entity,states);
  }
  remove(entity:Entity):void{this.states.delete(entity);}
  use(entity:Entity,channel=0,continuous=false,targetPart?:Part):boolean {
    if(continuous)return false;
    let used=false;
    for(const s of this.get(entity)){
      if(!s.enabled||!targetsPart(entity,s.part,targetPart))continue;
      if(s.kind==='TankBarrelBehaviour'){this.fire(s);used=true;continue;}
      if(s.kind==='CarBehaviour'&&s.health<0)continue;
      if(channel===1)s.speed=-s.speed;
      else{s.time=0;s.activated=!s.activated;this.options.onActivation?.(s);}
      used=true;
    }
    return used;
  }
  setBrake(entity:Entity,value:boolean):void{for(const s of this.get(entity))if(s.kind==='CarBehaviour')s.brake=value;}
  setHealth(entity:Entity,value:number,part?:Part):void{if(!Number.isFinite(value))return;for(const s of this.get(entity))if(s.kind==='CarBehaviour'&&(!part||part===s.part)){s.health=value;if(value<0&&s.activated){s.activated=false;this.options.onActivation?.(s);}}}
  repair(entity:Entity):void{for(const s of this.get(entity))if(s.kind==='CarBehaviour'){this.setHealth(entity,1,s.part);this.options.onRepair?.(s);}}
  emp(part:Part):void{for(const states of this.states.values())for(const s of states)if(s.part===part&&s.kind==='CarBehaviour')this.setHealth(s.entity,s.health<0?1:-1,part);}
  /** Only serialized ActOnShot actions targeting a controller in this entity change engine health. */
  shot(part:Part,damage:number,cartridgeDamage?:number):boolean {
    const entry=[...this.states].find(([entity])=>entity.parts.includes(part));if(!entry)return false;
    const [entity,states]=entry;let handled=false;
    for(const c of part.metadata?.components??[]){if(c.className!=='ActOnShot')continue;const d=c.data;
      if(damage<n(d,'ShotDamageThreshold')||(cartridgeDamage!==undefined&&cartridgeDamage<n(d,'CartridgeDamageThreshold'))||(this.options.random?.()??Math.random())>n(d,'Chance',1))continue;
      const calls=((d.Actions as Data)?.m_PersistentCalls as {m_Calls?:Data[]})?.m_Calls??[];
      for(const call of calls){if(call.m_CallState===0)continue;const target=states.find(s=>s.id===ref(call.m_Target));
        if(target&&call.m_MethodName==='SetHealth'){this.setHealth(entity,n(call.m_Arguments as Data,'m_FloatArgument'),target.part);handled=true;}
        else this.options.onSourceAction?.(entity,call);
      }
    }
    return handled;
  }
  update(dt:number):void {
    if(!(dt>0))return;
    for(const states of this.states.values())for(const s of states){
      const body=s.part.body,d=s.config,physical=this.options.getPhysical?.(s.part)?.state,charge=physical?.charge??0;
      if(!s.enabled){for(const wheel of s.wheels)wheel.enableMotor(false);continue;}
      s.time+=dt;
      if(s.kind==='CarBehaviour'){
        if((physical?.wetness??0)>0&&!d.WaterProof)this.setHealth(s.entity,s.health-dt*.5,s.part);
        let sum=0;
        for(const wheel of s.wheels){if(!s.entity.joints.includes(wheel))continue;wheel.enableMotor(s.brake||s.activated);
          const sourceSpeed=(s.activated?(s.speed+charge*(s.speed<0?-50:50))*(d.AccelerationCurve?evaluatePoseCurve(d.AccelerationCurve as SerializedCurve,s.time*.25):1):0)*(s.node?.scale.x??1);
          if(s.brake||s.activated)wheel.setMotorSpeed(-sourceSpeed*Math.PI/180);sum+=sourceSpeed;
        }
        s.engineVolume=Math.max(Math.abs(sum)/Math.max(1,s.wheels.length)/Math.max(Number.EPSILON,Math.abs(s.speed)),.2);
      }else if(s.kind==='HovercarBehaviour'){
        s.fanSpeed=-1500-charge*150;if(body.isDynamic())this.hover(s,charge);
      }else if(s.kind==='BoatMotorBehaviour'){
        const wet=this.options.isUnderWater?.(s.part)??false;s.fanDampening=wet?.3:.6;s.fanSpeed=(s.speed<0?-1:1)*Math.abs(n(d,'VisualRotationSpeed',7000));
        if(wet&&s.activated){const direction=vec(d.LocalDirection),length=Math.hypot(direction.x,direction.y)||1,scale=(s.node?.scale.x??1)<0?-1:1;
          body.applyForceToCenter(body.getWorldVector(Vec2(direction.x/length*(s.speed+charge)*scale,direction.y/length*(s.speed+charge))),true);}
      }else s.engineVolume=Math.abs(n(d,'foleyVolume',1)*body.getAngularVelocity()*180/Math.PI);
    }
  }
  afterStep(_dt:number):void{/* Native joint removal is owned by Simulation's break-force adapter. */}
  private hover(s:VehicleState,charge:number):void {
    const body=s.part.body,d=s.config,up=body.getWorldVector(Vec2(0,1)),direction=body.getWorldVector(Vec2(1,0)),drive=Vec2.mul(direction,((s.node?.scale.x??1)<0?-1:1)*(s.speed+charge));s.grounded=false;
    const mask=n((d.Layers??{}) as Data,'m_Bits',-1);
    for(const point of s.points){if(point.height<=0)continue;const start=body.getWorldPoint(point.local),end=Vec2.sub(start,Vec2.mul(up,point.height*2));
      let hit:{fixture:Fixture;point:Vec2;normal:Vec2;fraction:number}|undefined;
      body.getWorld().rayCast(start,end,(fixture,p,normal,fraction)=>{if(fixture.isSensor()||s.entity.parts.some(x=>x.body===fixture.getBody()))return -1;const layer=this.options.fixtureLayer?.(fixture)??0;if((mask&(1<<layer))===0)return -1;hit={fixture,point:p.clone(),normal:normal.clone(),fraction};return fraction;});
      if(!hit)continue;const factor=clamp(1-hit.fraction*2)*Vec2.dot(hit.normal,up);if(factor<=0)continue;s.grounded=true;
      const force=Vec2.mul(up,n(d,'ForceMultiplier',1)*Math.pow(factor,n(d,'FactorPower',2)));body.applyForce(force,start,true);
      const retention=n(d,'VelocityRetention',.99);body.setLinearVelocity(Vec2.mul(body.getLinearVelocity(),retention));body.setAngularVelocity(body.getAngularVelocity()*retention);
      const other=hit.fixture.getBody();if(this.options.physicalBody?.(other)??!!other.getUserData()){
        other.applyForce(Vec2.neg(force),hit.point,true);
        if(s.activated)other.applyForce(Vec2.mul(drive,-.25),hit.point,true);
        else{const relative=Vec2.sub(other.isDynamic()?other.getLinearVelocityFromWorldPoint(hit.point):Vec2(),body.getLinearVelocityFromWorldPoint(hit.point));body.applyForce(Vec2.mul(relative,n(d,'ParkForceMultiplier',1)),start,true);}
      }
    }
    if(s.activated&&s.grounded)body.applyForceToCenter(drive,true);
  }
  private fire(s:VehicleState):void {
    const d=s.config,body=s.part.body,scale=s.node?.scale??{x:1,y:1},p=vec(d.barrelPosition),v=vec(d.barrelDirection,{x:1,y:0});
    const position=body.getWorldPoint(Vec2(p.x*scale.x,p.y*scale.y)),direction=body.getWorldVector(Vec2(v.x*scale.x,v.y*scale.x));
    this.options.onTankShot?.({entity:s.entity,part:s.part,projectile:d.Projectile,position,direction,temperature:300,muzzleFlash:d.muzzleFlash});
    this.options.onPulse?.(position,3,10);body.applyLinearImpulse(body.getWorldVector(Vec2(-n(d,'RecoilIntensity',15)*scale.x,0)),body.getWorldCenter(),true);
  }
  snapshot(entity:Entity):VehicleSnapshot{return {version:1,states:this.get(entity).map(({id,activated,brake,health,speed,time})=>({id,activated,brake,health,speed,time}))};}
  restore(entity:Entity,value:unknown):boolean {
    const saved=value as VehicleSnapshot;if(saved?.version!==1||!Array.isArray(saved.states)||saved.states.length!==this.get(entity).length||new Set(saved.states.map(x=>x?.id)).size!==saved.states.length)return false;
    if(saved.states.some(x=>!x||!this.get(entity).some(s=>s.id===x.id)||![x.health,x.speed,x.time].every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12)||x.time<0||typeof x.activated!=='boolean'||typeof x.brake!=='boolean'))return false;
    for(const x of saved.states){const s=this.get(entity).find(s=>s.id===x.id)!;Object.assign(s,{activated:x.activated,brake:x.brake,health:x.health,speed:x.speed,time:x.time});}
    return true;
  }
}
