import {PrismaticJoint,Vec2,type Body,type Contact} from 'planck';
import type {Entity,Part,Simulation} from '../simulation';
import {sourceComponent} from './physical-world';

interface SharpAxis {Axis:{x:number;y:number};LowerLimit:number;UpperLimit:number;LooseUpperLimit:boolean|number;LooseLowerLimit:boolean|number}
interface Candidate {syringe:Part;victim:Part;owner:Entity;target:Entity;axis:SharpAxis;axisIndex:number;point:{x:number;y:number};needleVelocity:{x:number;y:number};victimVelocity:{x:number;y:number}}
export interface NeedleConnection {syringe:Part;victim:Part;owner:Entity;target:Entity;joint:PrismaticJoint;axis:SharpAxis;axisIndex:number;anchor:{x:number;y:number};duration:number}
interface SavedNeedle {syringeEntity:number;syringePart:string;victimEntity:number;victimPart:string;axisIndex:number;anchor:{x:number;y:number};duration:number}
const number=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const flag=(v:unknown)=>v===true||v===1;
const properties=(part:Part)=>sourceComponent(part,'PhysicalBehaviour')?.properties?.data??{};

/** PhysicalBehaviour's sharp-axis gate and SyringeBehaviour's Lodged/Dislodged
 * boundary. Planck prismatic joints replace Unity SliderJoint2D; the release
 * direction and original limits are retained with a contact-slop allowance.
 */
export class SyringeContactSystem {
  private owners=new Map<Body,{part:Part;entity:Entity}>();
  private connections=new Map<Part,NeedleConnection>();
  private entering=new Set<Contact>();
  private pending=new Map<Part,Candidate>();
  constructor(readonly sim:Simulation,readonly options:{isSyringe:(part:Part)=>boolean;onLodged?:(syringe:Part,victim:Part)=>void;onDislodged?:(syringe:Part,victim:Part)=>void}={isSyringe:()=>false}){
    sim.world.on('begin-contact',contact=>this.entering.add(contact));
    sim.world.on('end-contact',contact=>this.entering.delete(contact));
    sim.world.on('pre-solve',contact=>this.preSolve(contact));
  }
  attach(entity:Entity){for(const part of entity.parts)this.owners.set(part.body,{part,entity});}
  remove(entity:Entity){for(const connection of [...this.connections.values()])if(connection.owner===entity||connection.target===entity)this.dislodge(connection.syringe);for(const p of entity.parts){this.pending.delete(p);this.owners.delete(p.body);}}
  removeParts(parts:readonly Part[]){for(const connection of [...this.connections.values()])if(parts.includes(connection.syringe)||parts.includes(connection.victim))this.dislodge(connection.syringe);for(const part of parts){this.pending.delete(part);this.owners.delete(part.body);}}
  get(part:Part):NeedleConnection|undefined{return this.connections.get(part);}
  all():readonly NeedleConnection[]{return [...this.connections.values()];}
  private axes(part:Part):SharpAxis[]{const value=properties(part).SharpAxes;return Array.isArray(value)?value.filter(a=>a&&typeof a==='object'&&a.Axis&&Number.isFinite(a.Axis.x)&&Number.isFinite(a.Axis.y)&&Math.hypot(a.Axis.x,a.Axis.y)>1e-6&&Number.isFinite(a.LowerLimit)&&Number.isFinite(a.UpperLimit)) as SharpAxis[]:[];}
  private scale(part:Part,entity:Entity){return entity.metadata?.nodes.find(n=>n.id===part.metadata?.nodeId)?.scale??{x:1,y:1};}
  private preSolve(contact:Contact){
    const a=this.owners.get(contact.getFixtureA().getBody()),b=this.owners.get(contact.getFixtureB().getBody());if(!a||!b)return;
    const connectedA=this.connections.get(a.part),connectedB=this.connections.get(b.part);
    if(connectedA?.target===b.entity||connectedB?.target===a.entity){contact.setEnabled(false);return;}
    if(!this.entering.has(contact)||contact.getFixtureA().isSensor()||contact.getFixtureB().isSensor())return;
    const manifold=contact.getWorldManifold(null);if(!manifold||contact.getManifold().pointCount===0)return;
    const point=manifold.points[0];
    this.consider(a,b,point,{x:-manifold.normal.x,y:-manifold.normal.y});
    this.consider(b,a,point,manifold.normal);
  }
  private consider(needle:{part:Part;entity:Entity},other:{part:Part;entity:Entity},point:{x:number;y:number},normal:{x:number;y:number}){
    const part=needle.part,target=other.part;
    if(needle.entity===other.entity||!this.options.isSyringe(part)||this.connections.has(part)||this.pending.has(part)||!sourceComponent(target,'PhysicalBehaviour'))return;
    const p=properties(part),victimProperties=properties(target),ignore=flag(p.IgnoreStabResistance),softness=number(victimProperties.Softness,0);
    if(!flag(p.Sharp)||(softness<=.01&&!ignore)||(flag(victimProperties.IgnoreStabResistance)&&ignore))return;
    const ownV=part.body.getLinearVelocity(),otherV=target.body.getLinearVelocity(),relative=Vec2.sub(otherV,ownV),speed=relative.length();
    const multiplier=number(p.SharpForceThresholdMultiplier,1);
    const threshold=20+((ignore?1:Math.sqrt(Math.max(0,softness)))-.01)/.99*(1.25-20);
    if(multiplier<=0||speed/multiplier<threshold||speed<1e-6)return;
    relative.mul(1/speed);if(Vec2.dot(normal,relative)<-.98)return;
    const scale=this.scale(part,needle.entity),axes=this.axes(part),looseEnd=number(sourceComponent(part,'PhysicalBehaviour')?.data.LooseEndSize,.49);
    for(let i=0;i<axes.length;i++){
      const axis=axes[i],vector=part.body.getWorldVector({x:axis.Axis.x*scale.x,y:axis.Axis.y*scale.y});
      const limit=flag(axis.LooseLowerLimit)?axis.LowerLimit:flag(axis.LooseUpperLimit)?axis.UpperLimit:null;if(limit===null)continue;
      const origin=part.body.getPosition(),end={x:origin.x+vector.x*limit,y:origin.y+vector.y*limit};
      if(Math.hypot(end.x-point.x,end.y-point.y)>=looseEnd||Vec2.dot(relative,vector)>=-.92||Vec2.dot(normal,vector)>=-.3)continue;
      this.pending.set(part,{syringe:part,victim:target,owner:needle.entity,target:other.entity,axis,axisIndex:i,point:{...point},needleVelocity:{...ownV},victimVelocity:{...otherV}});return;
    }
  }
  beforeStep(dt:number){
    for(const connection of [...this.connections.values()]){
      connection.duration+=dt;
      const speed=connection.joint.getJointSpeed(),translation=connection.joint.getJointTranslation();
      const modifier=number(sourceComponent(connection.syringe,'PhysicalBehaviour')?.data.StabReleaseSpeedModifier,1),scaledSpeed=speed/1000*modifier;
      const effective=translation*modifier*1.05+Math.pow(scaledSpeed,8)*100*Math.sign(scaledSpeed)*dt;
      // Planck creates the slider after the contact solve; allow its initial
      // restored incoming velocity two fixed steps to establish penetration.
      if(connection.duration>.04&&((flag(connection.axis.LooseUpperLimit)&&effective>connection.axis.UpperLimit)||(flag(connection.axis.LooseLowerLimit)&&effective<connection.axis.LowerLimit)))this.dislodge(connection.syringe);
    }
  }
  afterStep(_dt:number){
    for(const candidate of this.pending.values()){
      if(!this.owners.has(candidate.syringe.body)||!this.owners.has(candidate.victim.body)||this.connections.has(candidate.syringe))continue;
      candidate.syringe.body.setLinearVelocity(candidate.needleVelocity);if(candidate.victim.body.isDynamic())candidate.victim.body.setLinearVelocity(candidate.victimVelocity);
      this.connect(candidate.syringe,candidate.victim,candidate.owner,candidate.target,candidate.axisIndex,candidate.victim.body.getLocalPoint(candidate.point),0);
    }
    this.pending.clear();this.entering.clear();
  }
  private connect(syringe:Part,victim:Part,owner:Entity,target:Entity,axisIndex:number,anchor:{x:number;y:number},duration:number){
    const axis=this.axes(syringe)[axisIndex];if(!axis)return false;
    const p=properties(syringe),softness=number(properties(victim).Softness,0),scale=this.scale(syringe,owner),localAxis=Vec2(axis.Axis.x*scale.x,axis.Axis.y*scale.y);localAxis.normalize();
    const joint=this.sim.world.createJoint(new PrismaticJoint({bodyA:syringe.body,bodyB:victim.body,localAnchorA:Vec2(),localAnchorB:anchor,localAxisA:localAxis,referenceAngle:victim.body.getAngle()-syringe.body.getAngle(),collideConnected:false,enableMotor:true,motorSpeed:0,maxMotorForce:number(p.SharpForceThresholdMultiplier,1)*((1-softness)*5+5)*number(p.LodgeStrengthMultiplier,1),enableLimit:true,lowerTranslation:axis.LowerLimit,upperTranslation:axis.UpperLimit}))!;
    this.connections.set(syringe,{syringe,victim,owner,target,joint,axis,axisIndex,anchor:{...anchor},duration});this.options.onLodged?.(syringe,victim);return true;
  }
  dislodge(syringe:Part){const connection=this.connections.get(syringe);if(!connection)return;this.connections.delete(syringe);this.sim.world.destroyJoint(connection.joint);this.options.onDislodged?.(syringe,connection.victim);}
  snapshot(entities:Entity[]):SavedNeedle[]{return [...this.connections.values()].flatMap(c=>{const syringeEntity=entities.indexOf(c.owner),victimEntity=entities.indexOf(c.target);return syringeEntity<0||victimEntity<0?[]:[{syringeEntity,syringePart:c.syringe.id??String(c.owner.parts.indexOf(c.syringe)),victimEntity,victimPart:c.victim.id??String(c.target.parts.indexOf(c.victim)),axisIndex:c.axisIndex,anchor:{...c.anchor},duration:c.duration}];});}
  restore(entities:Entity[],value:unknown):boolean|(()=>void){
    if(!Array.isArray(value)||value.length>200)return false;
    const resolve=(entity:Entity|undefined,id:unknown)=>typeof id==='string'?entity?.parts.find((p,i)=>(p.id??String(i))===id):undefined;
    const parsed=[];const used=new Set<Part>();
    for(const saved of value as SavedNeedle[]){
      if(!saved||!Number.isInteger(saved.syringeEntity)||!Number.isInteger(saved.victimEntity)||!Number.isInteger(saved.axisIndex)||!saved.anchor||![saved.anchor.x,saved.anchor.y,saved.duration].every(n=>Number.isFinite(n)&&Math.abs(n)<1e7)||saved.duration<0)return false;
      const owner=entities[saved.syringeEntity],target=entities[saved.victimEntity],syringe=resolve(owner,saved.syringePart),victim=resolve(target,saved.victimPart);
      if(!syringe||!victim||owner===target||!this.options.isSyringe(syringe)||!this.axes(syringe)[saved.axisIndex]||used.has(syringe)||this.connections.has(syringe))return false;
      used.add(syringe);parsed.push({saved,owner,target,syringe,victim});
    }
    const created:Part[]=[];
    const undo=()=>{for(const p of created)this.dislodge(p);};
    try{for(const {saved,owner,target,syringe,victim}of parsed){if(!this.connect(syringe,victim,owner,target,saved.axisIndex,saved.anchor,saved.duration)){undo();return false;}created.push(syringe);}}catch{undo();return false;}
    return undo;
  }
}
