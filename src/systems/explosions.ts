import {AABB,Circle,Transform,Vec2,testOverlap,type Fixture} from 'planck';
import type {Entity,Part,Simulation} from '../simulation';
import type {RagdollSystem} from './ragdoll';
import {DamageKind} from './skin';
import {fixtureLayer as sourceFixtureLayer} from './targeting';
import {physicalMass} from './physical-world';

export interface ExplosionParameters {
  Position:{x:number;y:number};FragmentationRayCount:number;Range:number;FragmentForce:number;
  CreateParticlesAndSound?:boolean;EffectSize?:number;DismemberChance?:number;BallisticShrapnelCount?:number;
}
export interface ExplosionOptions {
  random?:()=>number;fixtureLayer?:(fixture:Fixture)=>number;isUnderWater?:(point:{x:number;y:number})=>boolean;
  onFragment?:(part:Part,force:number,point:{x:number;y:number})=>void;
  onSlice?:(part:Part)=>void;onBreak?:(part:Part,velocity:{x:number;y:number})=>void;
  onEffect?:(parameters:ExplosionParameters,underwater:boolean)=>void;
  onShrapnel?:(position:{x:number;y:number},count:number)=>void;
}
/** ExplosionCreator fragmentation and pulse rules, using shipped layer indices
 * Objects9, Debris10, CollidingDebris13. Native start-inside/trigger ray queries
 * are disabled in the shipped Physics2DSettings, matching Planck ray behavior.
 */
export class ExplosionSystem {
  constructor(readonly sim:Simulation,readonly ragdolls:RagdollSystem,readonly options:ExplosionOptions={}){}
  private random(){return Math.max(0,Math.min(1,this.options.random?.()??Math.random()));}
  private part(fixture:Fixture):Part|undefined {const body=fixture.getBody(),entity=body.getUserData() as Entity|undefined;return entity?.parts.find(p=>p.body===body);}
  explode(ex:ExplosionParameters):void {
    if(![ex.Position?.x,ex.Position?.y,ex.Range,ex.FragmentForce,ex.FragmentationRayCount].every(n=>typeof n==='number'&&Number.isFinite(n))||ex.Range<0||ex.FragmentationRayCount<0||ex.FragmentationRayCount>100000)throw new Error('Invalid source explosion');
    const position=Vec2(ex.Position),rays=Math.floor(ex.FragmentationRayCount);
    const underwater=!!this.options.isUnderWater?.(position);
    if(ex.CreateParticlesAndSound||underwater)this.options.onEffect?.(ex,underwater);
    if(ex.Range>0)for(let i=0;i<rays;i++){
      const angle=i/rays*Math.PI*2,end=Vec2(position.x+Math.cos(angle)*ex.Range,position.y+Math.sin(angle)*ex.Range);
      let closest:{fixture:Fixture;point:Vec2}|undefined;
      this.sim.world.rayCast(position,end,(fixture,point,_normal,fraction)=>{
        if(fixture.isSensor()||(this.options.fixtureLayer??sourceFixtureLayer)(fixture)===2)return -1;
        closest={fixture,point:point.clone()};return fraction;
      });
      if(!closest)continue;
      const hit=closest as {fixture:Fixture;point:Vec2},part=this.part(hit.fixture),body=hit.fixture.getBody();
      if(part)this.options.onFragment?.(part,ex.FragmentForce,hit.point);
      const radial=Vec2.sub(body.getPosition(),position);if(radial.lengthSquared()>0)radial.normalize();
      body.applyLinearImpulse(Vec2.mul(radial,ex.FragmentForce),hit.point,true);
      const limb=part&&this.ragdolls.limbFor(part);if(!part||!limb)continue;
      this.ragdolls.addWound(part,this.random()>.5?DamageKind.Bullet:DamageKind.Blunt,hit.point,ex.FragmentForce*(3+Math.min(4,Math.floor(this.random()*5))));
      this.ragdolls.damage(part,ex.FragmentForce*1.5,'fragment');
      if(limb.config.SpeciesIdentity!=='Android'&&this.random()<(ex.DismemberChance??0)){
        if(this.options.onSlice)this.options.onSlice(part);else this.ragdolls.slice(part);
      }
    }
    if((ex.BallisticShrapnelCount??0)>0)this.options.onShrapnel?.(position,ex.BallisticShrapnelCount!);
  }
  pulse(position:{x:number;y:number},force:number,range:number,effects=false,breakObjects=true):void {
    if(![position.x,position.y,force,range].every(Number.isFinite)||range<=0)return;
    if(effects)this.options.onEffect?.({Position:position,Range:range,FragmentForce:force,FragmentationRayCount:0,CreateParticlesAndSound:true},!!this.options.isUnderWater?.(position));
    const circle=Circle(range),transform=new Transform(position,0),fixtures:Fixture[]=[];
    this.sim.world.queryAABB(new AABB(Vec2(position.x-range,position.y-range),Vec2(position.x+range,position.y+range)),fixture=>{
      const layer=(this.options.fixtureLayer??sourceFixtureLayer)(fixture);
      if(fixture.isSensor()||![9,10,13].includes(layer)||!testOverlap(fixture.getShape(),0,circle,0,fixture.getBody().getTransform(),transform))return true;
      fixtures.push(fixture);return fixtures.length<64;
    });
    for(const fixture of fixtures){const body=fixture.getBody(),radial=Vec2.sub(body.getPosition(),position),squared=radial.lengthSquared();if(squared<Number.EPSILON)continue;radial.normalize();
      const magnitude=force/Math.max(1,squared/(range*range))*3,part=this.part(fixture),mass=part?physicalMass(part):body.getMass();
      body.applyLinearImpulse(Vec2.mul(radial,magnitude*Math.min(mass,1)),body.getWorldCenter(),true);
      if(part&&breakObjects&&Math.min(9,Math.floor(this.random()*10))>force)this.options.onBreak?.(part,Vec2.mul(radial,-magnitude));
    }
  }
}
