import { type LimbState, type RagdollEntity, type RagdollPart, type RagdollPhysical, RagdollSystem } from './ragdoll';

/** Structural adapter to the shared BloodContainer reservoir, avoiding a circular import. */
export interface LiquidEffectContainer {
  originalBlood:string|null;
  readonly total?:number;
  getAmount(id:string):number;
  addLiquid(id:string,amount:number):number;
  removeLiquid(id:string,amount:number):number;
}
export interface LiquidEffectsOptions {
  getPhysical?:(part:RagdollPart)=>RagdollPhysical|undefined;
  random?:()=>number;
  onPhysicalFlag?:(part:RagdollPart,name:'ReflectsLasers'|'AbsorbsLasers',value:boolean)=>void;
  onExplosion?:(part:RagdollPart,parameters:{fragments:number;range:number;force:number;big:boolean;chance:number})=>void;
  onCrush?:(part:RagdollPart)=>void;
  onResize?:(part:RagdollPart,scale:{x:number;y:number})=>void;
  onGlow?:(part:RagdollPart,enabled:boolean)=>void;
  onColor?:(part:RagdollPart,color:{r:number;g:number;b:number;a:number})=>void;
}
const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
const num=(d:Record<string,unknown>,key:string,fallback=0)=>typeof d[key]==='number'?d[key] as number:fallback;
const flag=(d:Record<string,unknown>,key:string)=>d[key]===true||d[key]===1;
const temporary=new Set(['LIFE SERUM','ADRENALINE','INSTANT DEATH POISON','KNOCKOUT POISON','PAIN KILLER','MENDING SERUM','FREEZE POISON','COAGULATION SERUM','ULTRA STRENGTH SERUM','BONE EATING POISON','INERT PINK LIQUID','VESTIBULAR POISON','MUSCLE POISON','NUMBING POISON','MIRRORISING AGENT','TRANSPARENCY AGENT','CRUSHING POISON','MASS AGENT','EXPLOSION POISON','DURABILITY SERUM','REGENERATION SERUM','DISTORTION POISON','CIRCULATION POISON','TISSUE DECONSTRUCTION AGENT','ENHANCING SERUM','DEBUG LIQUID 001']);
const enterOnce=new Set(['VESTIBULAR POISON','MUSCLE POISON','NUMBING POISON','MIRRORISING AGENT','TRANSPARENCY AGENT','CRUSHING POISON','MASS AGENT','EXPLOSION POISON','DURABILITY SERUM','REGENERATION SERUM','DISTORTION POISON','CIRCULATION POISON','TISSUE DECONSTRUCTION AGENT','ENHANCING SERUM']);
export const SUPPORTED_LIQUID_EFFECTS=new Set([...temporary,'BLOOD','GORSE BLOOD','ACID','OIL','WATER BREATHING SERUM','REANIMATION AGENT','COMBUSTION AGENT','BEVERAGE M04','COOLANT','TRITIUM','EXOTIC LIQUID','INERT LIQUID']);
interface LifeJob {kind:'life';limb:LimbState;container:LiquidEffectContainer;factor:number;active:{burn:boolean;acid:boolean;rot:boolean;wounds:boolean}}
interface AcidJob {kind:'acid';limb:LimbState;container:LiquidEffectContainer;liquid:string;timer:number;concentration:number}
type Job=LifeJob|AcidJob;

/** Source liquid lifecycle effects. BloodContainer owns dosing, transport and the
 * strict >1-second OnUpdate timer; TemporaryBodyLiquid removal belongs here. */
export class LiquidEffects {
  readonly unsupported=new Set<string>();
  private jobs:Job[]=[];
  private lastFrameDelta=1/60;
  constructor(readonly ragdolls:RagdollSystem,readonly options:LiquidEffectsOptions={}){}
  remove(entity:RagdollEntity):void {const parts=new Set(entity.parts);this.jobs=this.jobs.filter(job=>!parts.has(job.limb.part));}
  private random(){return clamp(this.options.random?.()??Math.random());}
  private intRange(min:number,max:number){return min+Math.min(max-min-1,Math.floor(this.random()*(max-min)));}
  private physical(limb:LimbState){return this.options.getPhysical?.(limb.part);}
  private android(limb:LimbState){return limb.config.SpeciesIdentity==='Android';}
  private organicHead(limb:LimbState){return !this.android(limb)&&num(limb.config,'RoughClassification')===0;}
  private healBleeding(limb:LimbState){this.ragdolls.healBleeding(limb.part);}
  private setAcid(limb:LimbState,value:number){limb.acidProgress=clamp(value);limb.skinVisual.acidProgress=limb.acidProgress;}
  private setRot(limb:LimbState,value:number){limb.rottenProgress=clamp(value);limb.skinVisual.rottenProgress=limb.rottenProgress;}
  private blood(limb:LimbState,container:LiquidEffectContainer,minimum=1){const original=container.originalBlood??String(limb.config.BloodLiquidType??'BLOOD');container.addLiquid(original,Math.max(0,minimum-container.getAmount(original)));limb.blood=container.getAmount(original);}
  enter(part:RagdollPart,id:string,container:LiquidEffectContainer):void {
    if(!SUPPORTED_LIQUID_EFFECTS.has(id)){this.unsupported.add(id);return;}
    if(id==='TRITIUM')this.options.onGlow?.(part,true);
    const limb=this.ragdolls.limbFor(part);if(!limb)return;
    this.onEnterLimb(limb,id,container);
  }
  exit(part:RagdollPart,id:string,_container:LiquidEffectContainer):void {if(id==='TRITIUM')this.options.onGlow?.(part,false);}
  /** Restore coroutine-only work without replaying one-shot or permanent serum effects. */
  resume(part:RagdollPart,id:string,container:LiquidEffectContainer):void {
    const limb=this.ragdolls.limbFor(part);if(!limb||container.getAmount(id)<=0)return;
    if(this.jobs.some(job=>job.limb===limb&&job.container===container&&(job.kind==='life'?id==='LIFE SERUM':job.liquid===id)))return;
    if(id==='LIFE SERUM'&&!this.android(limb)){
      const physical=this.physical(limb),active={burn:(physical?.state.burnProgress??0)>0,acid:limb.acidProgress>0,rot:limb.rottenProgress>0,wounds:limb.skinVisual.wounds.some(w=>w.intensity>0)};
      if(Object.values(active).some(Boolean))this.jobs.push({kind:'life',limb,container,factor:Math.pow(.5,this.lastFrameDelta),active});
    }else if((id==='ACID'||id==='GORSE BLOOD')&&limb.config.SpeciesIdentity!=='Gorse'&&limb.acidProgress<.99)this.jobs.push({kind:'acid',limb,container,liquid:id,timer:.03,concentration:clamp(container.getAmount(id)*500)*(this.android(limb)?.1:1)});
    if(id==='TRITIUM')this.options.onGlow?.(part,true);
  }
  private onEnterLimb(limb:LimbState,id:string,container:LiquidEffectContainer):void {
    const c=limb.config,p=limb.person,android=this.android(limb);
    switch(id){
      case 'LIFE SERUM':if(!android){
        if(flag(c,'HasBrain')){p.brainDead=false;p.brainDamaged=false;p.brainDamagedTime=0;p.seizureTime=0;}
        this.ragdolls.healBone(limb.part);limb.health=limb.initialHealth;limb.numbness=0;this.healBleeding(limb);limb.isPump=limb.wasInitiallyPumping;limb.bloodFlow=1;this.blood(limb,container);limb.bruises=0;limb.lungsPunctured=false;
        if(this.organicHead(limb)){p.consciousness=1;p.shock=0;p.pain=0;p.oxygen=1;p.adrenaline=1;}
        const physical=this.physical(limb);if(physical)physical.state.temperature=num(c,'BodyTemperature',37);
        const job:LifeJob={kind:'life',limb,container,factor:Math.pow(.5,this.lastFrameDelta),active:{burn:true,acid:true,rot:true,wounds:true}};
        this.lifeStep(job,this.lastFrameDelta);if(Object.values(job.active).some(Boolean))this.jobs.push(job);
      }break;
      case 'MENDING SERUM':if(!android){if(flag(c,'HasBrain')){p.brainDead=false;if(this.random()>.995)p.brainDamaged=false;}limb.health=limb.initialHealth;limb.bleedingRate*=.8;limb.internalBleeding*=.8;this.setRot(limb,limb.rottenProgress*.8);limb.lungsPunctured=false;this.ragdolls.healBone(limb.part);}break;
      case 'ADRENALINE':this.adrenaline(limb,container);break;
      case 'PAIN KILLER':this.painkiller(limb,container);break;
      case 'ULTRA STRENGTH SERUM':if(!android){c.Vitality=num(c,'Vitality')*.1;c.RegenerationSpeed=num(c,'RegenerationSpeed')+8;c.ImpactPainMultiplier=num(c,'ImpactPainMultiplier')*.1;limb.initialHealth+=350;limb.health=limb.initialHealth;c.BreakingThreshold=num(c,'BreakingThreshold')+20;c.BaseStrength=Math.min(15,num(c,'BaseStrength',5)+5);c.ShotDamageMultiplier=num(c,'ShotDamageMultiplier',1)*.1;this.healBleeding(limb);this.ragdolls.winceLimb(limb.part,10);}break;
      case 'REANIMATION AGENT':if(!android){c.IsZombie=true;limb.health=limb.initialHealth;limb.numbness=0;if(limb.blood<.1)this.blood(limb,container);limb.bloodFlow=1;this.healBleeding(limb);limb.isPump=limb.wasInitiallyPumping;if(this.organicHead(limb)){p.brainDead=false;p.brainDamaged=false;p.consciousness=1;p.shock=0;p.pain=0;p.oxygen=1;p.adrenaline=1;}}break;
      case 'GORSE BLOOD':case 'ACID':if(c.SpeciesIdentity!=='Gorse'){const job:AcidJob={kind:'acid',limb,container,liquid:id,timer:.03,concentration:0};this.acidStep(job);if(limb.acidProgress<.99)this.jobs.push(job);}break;
      case 'OIL':if(!android){limb.numbness+=.5;limb.isPump=false;}break;
      case 'TRITIUM':if(flag(c,'HasBrain')){if(p.brainDead){limb.health+=.1;p.brainDead=false;}p.brainDamaged=false;}break;
      case 'VESTIBULAR POISON':if(!android){c.BalanceMuscleMovement=num(c,'BalanceMuscleMovement',1)+this.intRange(-1,1);if(this.intRange(-1,1)>.7)c.DoBalanceJerk=!flag(c,'DoBalanceJerk');if(this.intRange(-1,1)>.7)c.DoStumble=!flag(c,'DoStumble');if(flag(c,'HasBrain'))limb.internalBleeding+=this.random();}break;
      case 'MUSCLE POISON':if(!android)c.BloodMuscleStrengthRatio=num(c,'BloodMuscleStrengthRatio',1)+this.intRange(-1,1);break;
      case 'NUMBING POISON':if(!android)limb.numbness+=this.intRange(-1,1);break;
      case 'MIRRORISING AGENT':case 'TRANSPARENCY AGENT':if(!android){if(this.options.onPhysicalFlag)this.options.onPhysicalFlag(limb.part,id==='MIRRORISING AGENT'?'ReflectsLasers':'AbsorbsLasers',id==='MIRRORISING AGENT');else this.unsupported.add(id+': physical laser flag');}break;
      case 'CRUSHING POISON':if(!android&&this.random()>.5){if(this.options.onCrush)this.options.onCrush(limb.part);else this.unsupported.add(id+': fragmentation');}break;
      case 'MASS AGENT':if(!android)this.unsupported.add(id+': native nonpositive Rigidbody2D.mass validation');break;
      case 'EXPLOSION POISON':if(!android){if(this.options.onExplosion)this.options.onExplosion(limb.part,{fragments:32,range:9,force:25,big:this.random()>.9,chance:this.random()});else this.unsupported.add(id+': explosion bridge');}break;
      case 'DURABILITY SERUM':if(!android){limb.initialHealth+=this.random()*5;limb.health+=limb.initialHealth;}break;
      case 'REGENERATION SERUM':if(!android)c.RegenerationSpeed=num(c,'RegenerationSpeed')+1;break;
      case 'DISTORTION POISON':if(!android){if(this.options.onResize)this.options.onResize(limb.part,{x:.952381+this.random()*(1.05-.952381),y:.952381+this.random()*(1.05-.952381)});else this.unsupported.add(id+': collider/sprite scale bridge');}break;
      case 'CIRCULATION POISON':if(!android){limb.bleedingRate*=Math.abs(this.intRange(-1,1));limb.circulation.BloodLossRateMultiplier=num(limb.circulation,'BloodLossRateMultiplier',1)+this.intRange(-1,1)*.2;if(this.intRange(-1,1)>.9)limb.isPump=!limb.isPump;if(this.intRange(-1,1)>.7)limb.wasInitiallyPumping=!limb.wasInitiallyPumping;limb.internalBleeding*=this.intRange(0,8);c.Vitality=num(c,'Vitality')*this.intRange(-1,1)*8;c.ImpactPainMultiplier=num(c,'ImpactPainMultiplier')*this.intRange(-1,1)*8;this.setAcid(limb,limb.acidProgress+this.intRange(-1,1)*.05);limb.skin.intensityMultiplier=num(limb.skin,'intensityMultiplier',1)+this.intRange(-1,1)*.5;this.setRot(limb,limb.rottenProgress+this.intRange(-1,1)*.05);if(this.random()>.5)c.HasLungs=!flag(c,'HasLungs');if(this.random()>.5)limb.lungsPunctured=!limb.lungsPunctured;}break;
      case 'COMBUSTION AGENT':if(!android&&this.random()>.95){const physical=this.physical(limb);if(physical){physical.state.onFire=true;physical.state.burnIntensity=Math.max(.5,physical.state.burnIntensity);}}break;
      case 'TISSUE DECONSTRUCTION AGENT':if(!android&&this.random()>.8)this.ragdolls.slice(limb.part);break;
      case 'ENHANCING SERUM':if(!android){c.BreakingThreshold=num(c,'BreakingThreshold')+this.random();c.BaseStrength=num(c,'BaseStrength',5)+this.intRange(0,8);c.RegenerationSpeed=num(c,'RegenerationSpeed')+this.random()*.5;}break;
      case 'DEBUG LIQUID 001':if(this.options.onColor)this.options.onColor(limb.part,{r:1,g:0,b:1,a:1});else this.unsupported.add(id+': sprite color bridge');break;
      case 'EXOTIC LIQUID':if(this.random()>.9&&limb.connected)p.pain+=this.random()*50;if(this.random()>.9&&num(c,'RoughClassification')===0)p.consciousness*=this.random();break;
    }
  }
  private adrenaline(limb:LimbState,container:LiquidEffectContainer){if(this.android(limb))return;const dose=clamp(container.getAmount('ADRENALINE')*450);limb.numbness=0;if(this.organicHead(limb)){const p=limb.person;p.adrenaline+=dose;p.consciousness=Math.max(dose,p.consciousness);p.pain=Math.max(0,p.pain-dose);p.shock=Math.max(0,p.shock-dose);}}
  private painkiller(limb:LimbState,container:LiquidEffectContainer){if(this.android(limb))return;limb.numbness+=.1;if(!limb.connected)return;const p=limb.person;p.pain*=.1;p.shock*=.1;p.seizureTime*=.5;const dose=container.getAmount('PAIN KILLER');if(dose>.4){this.ragdolls.influenceMotorSpeed(limb.part,0);this.ragdolls.wincePerson(limb.part,this.random()*300);if(dose>.5){this.setAcid(limb,limb.acidProgress+.05);this.ragdolls.damage(limb.part,limb.health*.5+.1,'painkiller overdose');}}}
  tick(part:RagdollPart,id:string,container:LiquidEffectContainer):void {
    const limb=this.ragdolls.limbFor(part);if(!limb)return;
    if(temporary.has(id)){
      const removal=id==='MENDING SERUM'?.8*.8:.8;
      if(this.random()<removal*removal)container.removeLiquid(id,container.getAmount(id));
      if(!enterOnce.has(id))this.onEnterLimb(limb,id,container);
    }
    const c=limb.config,p=limb.person,physical=this.physical(limb),android=this.android(limb);
    switch(id){
      case 'ADRENALINE':this.adrenaline(limb,container);break;
      case 'PAIN KILLER':this.painkiller(limb,container);break;
      case 'INSTANT DEATH POISON':limb.health=0;limb.isPump=false;break;
      case 'KNOCKOUT POISON':if(!android){const dose=clamp(container.getAmount(id)*350);limb.numbness=Math.max(dose,limb.numbness);if(this.organicHead(limb))p.consciousness=Math.min(1-dose,p.consciousness);}break;
      case 'FREEZE POISON':if(!android&&this.random()<clamp(container.getAmount(id)*750))limb.frozen=true;break;
      case 'BONE EATING POISON':if(!android&&this.random()<clamp(container.getAmount(id)*250))this.ragdolls.breakBone(limb.part);break;
      case 'COAGULATION SERUM':if(!android)this.healBleeding(limb);break;
      case 'WATER BREATHING SERUM':if(this.organicHead(limb))p.oxygen=1;break;
      case 'OIL':this.onEnterLimb(limb,id,container);break;
      case 'BLOOD':case 'GORSE BLOOD':case 'ACID':if(android&&this.random()>.995&&physical)physical.state.charge+=5;break;
      case 'COMBUSTION AGENT':if(!android&&physical)physical.state.temperature+=10;break;
      case 'BEVERAGE M04':if(c.SpeciesIdentity==='Human'&&limb.connected)p.adrenaline+=.1;else if(c.SpeciesIdentity==='Gorse'){this.setAcid(limb,limb.acidProgress+.05);if(limb.connected)p.consciousness*=.8;}else if(android&&physical)physical.state.charge+=this.random();break;
      case 'COOLANT':if(android)limb.internalTemperature+=(num(c,'BodyTemperature',37)-limb.internalTemperature)*.5;else{if(physical&&physical.state.temperature<40)physical.state.temperature+=this.random();if(this.random()>.9)limb.internalTemperature+=200;if(num(c,'RoughClassification')===0){p.angleOffset+=this.random()*4-2;if(this.random()>.98)p.brainDamaged=true;}}break;
      case 'TRITIUM':if(android)c.BaseStrength=num(c,'BaseStrength',5)+(18-num(c,'BaseStrength',5))*.5;else{if(physical&&physical.state.temperature<40)physical.state.temperature+=this.random();if(num(c,'RoughClassification')===0){if(this.random()>.995)this.ragdolls.damage(limb.part,limb.health+1,'tritium');if(this.random()>.9)p.pain+=this.random()*60;p.consciousness*=.99;}}break;
      case 'EXOTIC LIQUID':if(physical&&this.random()>.8/clamp(container.getAmount(id),.5,2)){if(this.random()>.8)physical.state.charge+=.5;physical.state.temperature-=this.random()*5;this.unsupported.add(id+': delayed flash/force');}break;
    }
  }
  private lifeStep(job:LifeJob,dt:number){
    const limb=job.limb,physical=this.physical(limb);
    if(job.active.burn){if(physical&&physical.state.burnProgress>.1)physical.state.burnProgress-=dt*.16;else{if(physical)physical.state.burnProgress=0;job.active.burn=false;}}
    if(job.active.acid){if(limb.acidProgress>.1)this.setAcid(limb,limb.acidProgress-dt*.8);else{this.setAcid(limb,0);job.active.acid=false;}}
    if(job.active.rot){if(limb.rottenProgress>.1)this.setRot(limb,limb.rottenProgress-dt*.8);else{this.setRot(limb,0);job.active.rot=false;}}
    if(job.active.wounds){if(limb.skinVisual.wounds.some(w=>w.intensity>0))for(const wound of limb.skinVisual.wounds)wound.intensity*=job.factor;else job.active.wounds=false;}
  }
  private acidStep(job:AcidJob){const limb=job.limb;let concentration=clamp(job.container.getAmount(job.liquid)*500);if(this.android(limb))concentration*=.1;job.concentration=concentration;this.setAcid(limb,limb.acidProgress+.002*concentration);this.ragdolls.winceLimb(limb.part,150*concentration*limb.acidProgress);if(limb.acidProgress>.5){if(limb.connected)limb.person.pain+=.1*concentration*limb.acidProgress;limb.internalBleeding+=.005*concentration;if(limb.acidProgress>.9)this.ragdolls.breakBone(limb.part);}if(limb.acidProgress>=.99){limb.health=0;limb.isPump=false;limb.config.BreakingThreshold=0;}}
  frame(dt:number):void {
    if(!Number.isFinite(dt)||dt<=0)return;this.lastFrameDelta=dt;
    this.jobs=this.jobs.filter(job=>{
      if(this.ragdolls.limbFor(job.limb.part)!==job.limb)return false;
      if(job.kind==='life'){if(job.container.getAmount('LIFE SERUM')<=0)return false;this.lifeStep(job,dt);return Object.values(job.active).some(Boolean);}
      job.timer-=dt;
      while(job.timer<=0){if(job.concentration<=0||job.limb.acidProgress>=.99)return false;this.acidStep(job);job.timer+=.03;}
      return true;
    });
  }
}
