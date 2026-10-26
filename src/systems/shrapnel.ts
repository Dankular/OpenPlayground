import type {Entity,Simulation} from '../simulation';
import type {PhysicalSystem} from './physical-world';
import {BallisticsSystem,type BulletHit,type Cartridge} from './ballistics';
import rawConfig from '../generated/shrapnel.json?raw';

const config=JSON.parse(rawConfig) as {data:{LayersToHit:{m_Bits:number};WaterLayer:{m_Bits:number}};cartridge:{data:Cartridge}};
/** GlobalShrapnelEmitter: independent native emitter, delayed until an end of
 * frame followed by fixed update, without firearm tracers or guessed ammo. */
export class ShrapnelSystem {
  readonly ballistics:BallisticsSystem;
  private pending:{position:{x:number;y:number};count:number;ready:boolean}[]=[];
  private owner:Entity={id:-1,kind:'prefab',parts:[],joints:[],frozen:false,name:'Global shrapnel emitter'};
  constructor(readonly sim:Simulation,readonly physical:PhysicalSystem,readonly options:{onHit?:(hit:BulletHit)=>void;random?:()=>number}={}){
    this.ballistics=new BallisticsSystem(sim.world,physical,{onHit:options.onHit,random:options.random,maxBallisticsIterations:16,maxTotalDistance:30,ricochetChanceMultiplier:4,renderTracers:false,layersToHit:config.data.LayersToHit.m_Bits});
  }
  attach(entity:Entity):void {this.ballistics.attach(entity);}
  remove(entity:Entity):void {this.ballistics.remove(entity);}
  emit(position:{x:number;y:number},count:number):void {
    if(![position.x,position.y,count].every(Number.isFinite)||count<=0||count>100000)return;
    this.pending.push({position:{...position},count:Math.floor(count),ready:false});
  }
  afterFrame():void {for(const emission of this.pending)emission.ready=true;}
  beforeStep(dt:number):void {
    const pending=this.pending;this.pending=[];
    for(const emission of pending){if(!emission.ready){this.pending.push(emission);continue;}
      for(let i=0;i<emission.count;i++){
        const angle=(this.options.random?.()??Math.random())*Math.PI*2,radius=Math.sqrt(this.options.random?.()??Math.random());
        this.ballistics.emit(this.owner,emission.position,{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius},config.cartridge.data,0,true);
      }
    }
    this.ballistics.step(dt);
  }
}
