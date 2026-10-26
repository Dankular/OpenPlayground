/** SkinMaterialHandler's source damage buffer and shader input rules.
 * This module reconstructs state/uniforms; it does not claim pixel-shader parity. */
export enum DamageKind {Blunt=0,Bullet=1,Stab=2,Dismemberment=3,Burn=4,None=5}
export interface SkinWound {x:number;y:number;intensity:number;type:DamageKind;time:number}
export interface SkinState {wounds:SkinWound[];accumulator:number;rottenProgress:number;acidProgress:number}
export interface SkinInputs {temperature:number;charge:number;burnProgress:number}
export interface SkinUniforms extends SkinInputs {
  temperatureValue:number;electrocutionIntensity:number;rottenProgress:number;acidProgress:number;
  skinVisible:boolean;fleshVisible:boolean;wounds:readonly SkinWound[];
}
const clamp=(value:number,low=0,high=1)=>Math.min(high,Math.max(low,value));
const number=(config:Record<string,unknown>,key:string,fallback:number)=>typeof config[key]==='number'&&Number.isFinite(config[key])?config[key] as number:fallback;
const enabled=(config:Record<string,unknown>,key:string,fallback=true)=>config[key]===undefined?fallback:config[key]===true||config[key]===1;

export function createSkinState(config:Record<string,unknown>,time=0):SkinState {
  const points=Array.isArray(config.damagePoints)?config.damagePoints:[],timestamps=Array.isArray(config.damagePointTimeStamps)?config.damagePointTimeStamps:[];
  const count=Math.min(128,Math.max(0,number(config,'currentDamagePointCount',0)));
  const wounds:SkinWound[]=[];
  for(let i=0;i<count;i++){
    const point=points[i] as Record<string,unknown>|undefined;if(!point)continue;
    const type=number(point,'w',DamageKind.None);if(!Number.isInteger(type)||type<0||type>5)continue;
    wounds.push({x:number(point,'x',0),y:number(point,'y',0),intensity:number(point,'z',0),type,time:typeof timestamps[i]==='number'?timestamps[i]:time});
  }
  return{wounds,accumulator:0,rottenProgress:clamp(number(config,'rottenProgress',0)),acidProgress:clamp(number(config,'acidProgress',0))};
}

/** Input intensity is the outer source caller's intensity, before its 0.1 scale. */
export function addSkinWound(state:SkinState,type:DamageKind,local:{x:number;y:number},intensity:number,time:number):boolean {
  if(state.wounds.length>=128||!Number.isFinite(intensity)||intensity<=0||!Number.isFinite(local.x)||!Number.isFinite(local.y))return false;
  const scaled=clamp(intensity,0,100)*.1;
  const radius=type===DamageKind.Blunt?.1*scaled:type===DamageKind.Bullet?.01*Math.min(scaled,5):type===DamageKind.Stab?.02*scaled:type===DamageKind.Dismemberment?.05:type===DamageKind.Burn?.015:0;
  const near=state.wounds.find(point=>(point.type===type||point.intensity<=.01)&&(local.x-point.x)**2+(local.y-point.y)**2<=radius**2);
  if(near){near.type=type;near.intensity=Math.max(near.intensity,scaled);}
  else state.wounds.push({x:local.x,y:local.y,intensity:scaled,type,time});
  return true;
}

export function regenerateSkin(state:SkinState,config:Record<string,unknown>,dt:number,health:number,initialHealth:number,bleedingRate:number,alive:boolean,zombie:boolean):void {
  if(!Number.isFinite(dt)||dt<=0)return;
  state.accumulator+=dt;
  const interval=1/16;
  while(state.accumulator>=interval){
    state.accumulator-=interval;
    if(!alive||zombie)continue;
    for(const wound of state.wounds){
      if(wound.intensity<=.001)continue;
      if(wound.type===DamageKind.Blunt&&enabled(config,'BluntDamageRegen'))wound.intensity*=Math.pow(.95,interval);
      else if((wound.type===DamageKind.Bullet||wound.type===DamageKind.Stab)&&enabled(config,'GunshotDamageRegen')&&bleedingRate<1&&health>initialHealth/2)wound.intensity*=Math.pow(.995,interval);
      else if(wound.type===DamageKind.Burn&&enabled(config,'BurnWoundRegen'))wound.intensity*=Math.pow(.97,interval);
    }
  }
}

export function skinUniforms(state:SkinState,config:Record<string,unknown>,physical:SkinInputs):SkinUniforms {
  let temperatureValue=0;
  if(physical.temperature>0){if(enabled(config,'ShouldGlowWhenHot',false))temperatureValue=clamp(physical.temperature/Math.max(.00001,number(config,'MaxGlowTemperature',1000)))**2;}
  else if(enabled(config,'ShouldRecolourWhenCold',false)){const minimum=number(config,'MinFreezeTemperature',-30);temperatureValue=minimum===0?0:clamp(-physical.temperature/minimum,-1,0);}
  return{...physical,temperatureValue,electrocutionIntensity:physical.charge/25,rottenProgress:clamp(state.rottenProgress),acidProgress:clamp(state.acidProgress),skinVisible:state.acidProgress<.62&&physical.burnProgress<.45,fleshVisible:state.acidProgress<.85&&physical.burnProgress<.78,wounds:state.wounds};
}

export function rotSkin(state:SkinState,config:Record<string,unknown>,dt:number,health:number,species:string,temperature:number,zombie:boolean):void {
  if(species==='Android'||!enabled(config,'ShouldRot')||temperature<-50)return;
  state.rottenProgress=clamp(state.rottenProgress+(health<.05?dt*.002:0)+(zombie?dt*.02:0));
}
