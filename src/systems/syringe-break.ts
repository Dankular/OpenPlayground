import { AABB,Circle,Transform,Vec2,testOverlap } from 'planck';
import type { Entity,Part,Simulation } from '../simulation';
import type { LiquidColor,LiquidSystem } from './liquids';
import type { RagdollSystem } from './ragdoll';

/** SyringeBehaviour.BreakSyringe and resource SyringeExplosionBehaviour.
 * Removal is deferred outside Planck's locked contact callbacks.
 */
export class SyringeBreakSystem {
  private pending=new Map<Part,number>();
  private ready=new Set<Part>();
  constructor(readonly sim:Simulation,readonly liquids:LiquidSystem,readonly ragdolls:RagdollSystem,readonly options:{onSplash?:(point:{x:number;y:number},radius:number,color:LiquidColor)=>void}={}){}
  shot(part:Part,exit=false):void {this.schedule(part,exit?0:.05);}
  fragment(part:Part):void {this.schedule(part,0);}
  break(part:Part):void {this.schedule(part,0);}
  private schedule(part:Part,delay:number):void {
    if(!this.liquids.getSyringe(part))return;
    this.pending.set(part,Math.min(this.pending.get(part)??Infinity,delay));
  }
  remove(entity:Entity):void {for(const part of entity.parts){this.pending.delete(part);this.ready.delete(part);}}
  beforeStep(dt:number):void {
    for(const [part,remaining] of this.pending){const next=remaining-dt;if(next<=0){this.ready.add(part);this.pending.delete(part);}else this.pending.set(part,next);}
  }
  afterStep():void {
    for(const part of this.ready){
      const syringe=this.liquids.getSyringe(part),container=syringe?.container;
      if(!container||container.total<=Number.EPSILON||!container.distribution.size)continue;
      const owner=this.sim.entities.find(e=>e.parts.includes(part));if(!owner)continue;
      const point=part.body.getPosition().clone(),radius=3;
      const circle=Circle(radius),transform=new Transform(point,0),hits:Part[]=[];
      // Source divides by every overlapping collider, including non-limbs,
      // then applies to organic limbs only. Its buffer holds at most 64.
      let count=0;
      this.sim.world.queryAABB(new AABB(Vec2(point.x-radius,point.y-radius),Vec2(point.x+radius,point.y+radius)),fixture=>{
        if(fixture.isSensor())return true; // Shipped Physics2DSettings: queriesHitTriggers=false.
        if(!testOverlap(fixture.getShape(),0,circle,0,fixture.getBody().getTransform(),transform))return true;
        count++;
        const entity=fixture.getBody().getUserData() as Entity|undefined;
        const hit=entity?.parts?.find(p=>p.body===fixture.getBody());
        if(hit)hits.push(hit);
        return count<64;
      });
      if(count){
        const amount=container.total/container.distribution.size/count*3;
        for(const hit of hits){const limb=this.ragdolls.limbFor(hit),target=this.liquids.get(hit);if(!limb||limb.config.SpeciesIdentity==='Android'||!target)continue;
          for(const id of container.distribution.keys())target.addLiquid(id,amount);
        }
      }
      this.options.onSplash?.(point,radius,container.computedColor);
      this.sim.remove(owner);
    }
    this.ready.clear();
  }
}
