import { RevoluteJoint, Vec2, type Body, type Joint } from 'planck';
import { addSkinWound, createSkinState, DamageKind, regenerateSkin, rotSkin, skinUniforms, type SkinState, type SkinWound } from './skin';

/** Shipped CIL/serialized-prefab adaptation. See research/RAGDOLL.md for boundaries. */
type Data = Record<string, unknown>;
export interface RagdollPart { id?: string; body: Body; label: string; metadata?: unknown }
export interface RagdollEntity { id: number; parts: RagdollPart[]; joints: Joint[]; frozen: boolean; metadata?: unknown; jointById?: Map<string, Joint> }
export interface RagdollPhysical {
  state: { temperature: number; charge: number; onFire: boolean; burnProgress: number; burnIntensity: number; wetness: number };
  properties?: { BurningTemperatureThreshold?: number; Softness?: number };
}
export interface RagdollOptions {
  getPhysical?: (part: RagdollPart) => RagdollPhysical | undefined;
  random?: () => number;
  /** Unity's native Perlin implementation is not in the managed artifact. */
  noise?: (seed: number, time: number) => number;
  onDamage?: (limb: LimbState, amount: number, kind: string) => void;
  onDeath?: (person: PersonState) => void;
  onCrush?: (limb: LimbState) => void;
}
export interface ShotInput {damage:number;point:{x:number;y:number};normal:{x:number;y:number};canCrush?:boolean;exit?:boolean}
export interface RagdollSnapshot {
  version:1;
  stuns?:{limbId:string;delays:number[]}[];
  person:{consciousness:number;oxygen:number;shock:number;pain:number;adrenaline:number;brainDead:boolean;brainDamaged:boolean;brainDamagedTime:number;seizureTime:number;desiredWalkingDirection:number;overridePoseIndex:number;time:number};
  limbs:{id:string;health:number;initialHealth?:number;numbness:number;broken:boolean;frozen:boolean;internalTemperature:number;blood:number;bloodFlow:number;bleedingRate:number;internalBleeding:number;isPump:boolean;wasInitiallyPumping?:boolean;lungsPunctured:boolean;dismembered:boolean;jointStress:number;acidProgress:number;rottenProgress:number;wounds?:SkinWound[];modifiers?:Record<string,number|boolean>;skinIntensityMultiplier?:number;bloodLossRateMultiplier?:number}[];
}
export interface CurveKey { time: number; value: number; inSlope?: number; outSlope?: number; weightedMode?: number; inWeight?: number; outWeight?: number }
export interface SerializedCurve { m_Curve?: CurveKey[]; m_PreInfinity?: number; m_PostInfinity?: number }
export interface LimbPose {
  Name?: string; Limb?: unknown; Animated?: number | boolean; PoseRigidityModifier?: number;
  Angle?: number; StartAngle?: number; EndAngle?: number; AnimationDuration?: number;
  RandomInfluence?: number; RandomSpeed?: number; TimeOffset?: number; AnimationCurve?: SerializedCurve;
}
export interface RagdollPose {
  Name: string; State: number; Rigidity?: number; ForceMultiplier?: number;
  ShouldStandUpright?: number | boolean; DragInfluence?: number; UprightForceMultiplier?: number;
  ShouldStumble?: number | boolean; AnimationSpeedMultiplier?: number; Angles: LimbPose[];
}
export interface LimbState {
  id: string; part: RagdollPart; config: Data; circulation: Data; node: Data; skin: Data;
  health: number; initialHealth: number; numbness: number; broken: boolean; frozen: boolean;
  connected: boolean; isOnFloor: boolean; internalTemperature: number; blood: number; bloodFlow: number;
  bleedingRate: number; internalBleeding: number; isPump: boolean; wasInitiallyPumping: boolean;
  lungsPunctured: boolean; dismembered: boolean; jointStress: number; acidProgress: number; rottenProgress: number;
  joint?: RevoluteJoint; originalLimits?: [number, number]; initialMass: number;
  connectedLimbs: LimbState[]; pushesTo: LimbState[]; nearestToBrain?: LimbState; stumbleTime: number;
  randomOffset: number; bruises: number; motorStrength: number; person: PersonState;
  diffuseOscillator: boolean;
  shotHeat: number;
  velocity: {x:number;y:number}; sustainedAcceleration: {x:number;y:number};
  skinVisual: SkinState; skinId: string;
  localScale: {x:number;y:number};
}
export interface PersonState {
  entity: RagdollEntity; config: Data; limbs: LimbState[]; head?: LimbState; poses: RagdollPose[];
  activePose?: RagdollPose; overridePoseIndex: number; consciousness: number; oxygen: number; shock: number;
  pain: number; adrenaline: number; brainDead: boolean; brainDamaged: boolean; brainDamagedTime: number;
  seizureTime: number; desiredWalkingDirection: number; balanceOffset: number; averageSpeed: number;
  averageWetness: number; averageHealth: number; touchingFloor: boolean; dead: boolean; heartbeat: number;
  angleOffset: number; time: number;
  linkedPoses: Map<number,RagdollPose>;
}
const DEG = Math.PI / 180;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t);
const record = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const num = (data: Data, key: string, fallback = 0) => typeof data[key] === 'number' && Number.isFinite(data[key]) ? data[key] as number : fallback;
const flag = (data: Data, key: string) => data[key] === true || data[key] === 1;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const id = (value: unknown) => { const data = record(value); return String(data.m_PathID ?? value ?? ''); };
const deltaDegrees = (from: number, to: number) => ((to - from) % 360 + 540) % 360 - 180;
const modifierNumbers=['Vitality','RegenerationSpeed','ImpactPainMultiplier','BreakingThreshold','BaseStrength','ShotDamageMultiplier','BloodMuscleStrengthRatio','BalanceMuscleMovement'];
const modifierFlags=['IsZombie','HasLungs','DoBalanceJerk','DoStumble'];

/** Cubic Hermite interpolation for the unweighted keys found in shipped poses.
 * Serialized infinity 0 is adapted as ping-pong for the game's cyclic pose data;
 * native enum translation and weighted tangents remain a fidelity boundary. */
export function evaluatePoseCurve(curve: SerializedCurve | undefined, time: number): number {
  const keys = curve?.m_Curve;
  if (!keys?.length) return 0;
  if (keys.length === 1) return keys[0].value;
  const first = keys[0], last = keys[keys.length - 1], duration = last.time - first.time;
  if (duration <= 0) return first.value;
  if (time < first.time || time > last.time) {
    const mode = time < first.time ? curve?.m_PreInfinity : curve?.m_PostInfinity;
    if (mode === 0 || mode === 4) {
      const phase = ((time - first.time) % (2 * duration) + 2 * duration) % (2 * duration);
      time = first.time + (phase <= duration ? phase : 2 * duration - phase);
    } else if (mode === 1) time = first.time + ((time - first.time) % duration + duration) % duration;
    else return time < first.time ? first.value : last.value;
  }
  let a = first, b = last;
  for (let i = 1; i < keys.length; i++) if (time <= keys[i].time) { a = keys[i - 1]; b = keys[i]; break; }
  const span = b.time - a.time;
  if (span <= 0) return a.value;
  const t = clamp((time - a.time) / span), t2 = t * t, t3 = t2 * t;
  const out = a.outSlope ?? 0, incoming = b.inSlope ?? 0;
  if (!Number.isFinite(out) || !Number.isFinite(incoming)) return a.value;
  return (2*t3-3*t2+1)*a.value + (t3-2*t2+t)*span*out + (-2*t3+3*t2)*b.value + (t3-t2)*span*incoming;
}

export function evaluateLimbPose(pose: LimbPose, time: number, speed = 1, noise = .5): number {
  if (!pose.Animated) return pose.Angle ?? 0;
  const duration = pose.AnimationDuration || 1;
  let phase = (pose.TimeOffset ?? 0) + time * speed / duration;
  if ((pose.RandomInfluence ?? 0) > .01) phase = lerp(phase, noise, pose.RandomInfluence!);
  return lerp(pose.StartAngle ?? 0, pose.EndAngle ?? 0, evaluatePoseCurve(pose.AnimationCurve, phase));
}

function components(value: unknown): Data[] { return array(record(value).components).map(record); }
function dataFor(list: Data[], className: string, field: string): { component: Data; data: Data } | undefined {
  for (const component of list) {
    const data = record(component.data);
    if (component.className === className || component.type === className || Object.hasOwn(data, field)) return { component, data };
  }
  return undefined;
}

export class RagdollSystem {
  readonly people = new Map<number, PersonState>();
  time = 0;
  /** Mixed-liquid reservoirs own transport when attached; physiology still owns wounds/regeneration. */
  externalLiquidTransport = false;
  getTotalLiquid?: (part:RagdollPart)=>number|undefined;
  private limbByPart = new WeakMap<RagdollPart, LimbState>();
  private stunDelays = new WeakMap<LimbState,number[]>();
  private options: RagdollOptions;
  constructor(options: RagdollOptions = {}) { this.options = options; }
  private random() { return clamp(this.options.random?.() ?? Math.random()); }
  private physical(limb: LimbState) { return this.options.getPhysical?.(limb.part); }
  private noise(seed: number, time: number) {
    if (this.options.noise) return clamp(this.options.noise(seed, time));
    // Smooth deterministic surrogate; injection allows a future exact Unity noise oracle.
    return .5 + .25 * Math.sin(time * 1.17 + seed) + .25 * Math.sin(time * .71 + seed * .37);
  }
  attach(entity: RagdollEntity): PersonState | undefined {
    this.remove(entity);
    const metadata = record(entity.metadata), prefab = record(metadata.prefab);
    const nodes = array(metadata.nodes ?? prefab.nodes).map(record);
    const allComponents = [...nodes.flatMap(components), ...array(metadata.rootComponents).map(record)];
    const personComponent = dataFor(allComponents, 'PersonBehaviour', 'Poses');
    if (!personComponent) return undefined;
    const config = {...personComponent.data};
    const poses = array(config.Poses).filter(x => typeof record(x).Name === 'string' && Array.isArray(record(x).Angles)) as unknown as RagdollPose[];
    const person: PersonState = {
      entity, config, limbs: [], poses, overridePoseIndex: num(config, 'OverridePoseIndex', -1),
      consciousness: 1, oxygen: 1, shock: num(config,'ShockLevel'), pain:num(config,'PainLevel'), adrenaline:num(config,'AdrenalineLevel'),
      brainDead: flag(config,'Braindead'), brainDamaged:flag(config,'BrainDamaged'), brainDamagedTime:0,
      seizureTime:num(config,'SeizureTime'), desiredWalkingDirection:num(config,'DesiredWalkingDirection'),
      balanceOffset:0, averageSpeed:0, averageWetness:0, averageHealth:1, touchingFloor:false, dead:false, heartbeat:0,
      angleOffset:1, time:this.time,linkedPoses:new Map(),
    };
    const limbById = new Map<string, LimbState>(), circulationById = new Map<string, LimbState>();
    for (const part of entity.parts) {
      const meta = record(part.metadata);
      const nodeId = String(meta.nodeId ?? '');
      const node = nodes.find(n => String(n.id ?? n.gameObjectId ?? '') === nodeId || String(n.bodyId ?? '') === part.id);
      const list = [...components(meta), ...components(node)];
      const entry = dataFor(list,'LimbBehaviour','BaseStrength');
      if (!entry) continue;
      // Runtime serum modifiers must not mutate the shared extracted prefab.
      const d = {...entry.data}, c = dataFor(list,'CirculationBehaviour','BloodRegenerationPerSecond'), connected = dataFor(list,'ConnectedNodeBehaviour','IsRoot'), skin = dataFor(list,'SkinMaterialHandler','rottenProgress');
      const health = num(d,'Health',50), bodyTemp=num(d,'BodyTemperature',37);
      const jointId = id(d.Joint);
      let joint = entity.jointById?.get(jointId);
      if (!(joint instanceof RevoluteJoint)) joint = entity.joints.find(j => j instanceof RevoluteJoint && j.getBodyA() === part.body);
      const limb: LimbState = {
        id:String(entry.component.pathId ?? part.id ?? person.limbs.length), part, config:d, circulation:{...c?.data}, node:connected?.data??{}, skin:{...skin?.data},
        health, initialHealth:health, numbness:num(d,'Numbness'),broken:flag(d,'Broken'),frozen:flag(d,'Frozen'),connected:true,isOnFloor:false,
        internalTemperature:bodyTemp,blood:1,bloodFlow:1,bleedingRate:num(c?.data??{},'BleedingRate'), internalBleeding:num(c?.data??{},'InternalBleedingIntensity'),
        isPump:flag(c?.data??{},'IsPump'),wasInitiallyPumping:flag(c?.data??{},'IsPump'),lungsPunctured:flag(d,'LungsPunctured'),dismembered:flag(d,'IsDismembered'),
        jointStress:0,acidProgress:num(skin?.data??{},'acidProgress'),rottenProgress:num(skin?.data??{},'rottenProgress'),
        joint:joint instanceof RevoluteJoint?joint:undefined,initialMass:part.body.getMass(),connectedLimbs:[],pushesTo:[],stumbleTime:0,
        randomOffset:this.random()*20000-10000,bruises:num(d,'BruiseCount'),motorStrength:0,person,diffuseOscillator:false,shotHeat:0,
        velocity:{x:0,y:0},sustainedAcceleration:{x:0,y:0},skinVisual:createSkinState(skin?.data??{},this.time),skinId:String(skin?.component.pathId??''),
        localScale:{x:num(record(node?.scale),'x',1),y:num(record(node?.scale),'y',1)},
      };
      if(limb.joint) {
        limb.originalLimits=[limb.joint.getLowerLimit(),limb.joint.getUpperLimit()];
        limb.joint.enableMotor(true);limb.joint.setMotorSpeed(0);
      }
      if(flag(d,'HasBrain'))person.head=limb;
      this.limbByPart.set(part,limb);limbById.set(limb.id,limb);if(c)circulationById.set(String(c.component.pathId),limb);
      person.limbs.push(limb);
      const physical=this.physical(limb);if(physical)physical.state.temperature=bodyTemp;
    }
    if(!person.limbs.length)return undefined;
    for(const state of new Set(poses.map(p=>p.State))){const choices=poses.filter(p=>p.State===state);person.linkedPoses.set(state,choices[Math.min(choices.length-1,Math.floor(this.random()*choices.length))]);}
    for(const limb of person.limbs) {
      limb.connectedLimbs=array(limb.config.ConnectedLimbs).map(p=>limbById.get(id(p))).filter((x):x is LimbState=>!!x);
      limb.pushesTo=array(limb.circulation.PushesTo).map(p=>circulationById.get(id(p))).filter((x):x is LimbState=>!!x);
      limb.nearestToBrain=limbById.get(id(limb.config.NearestLimbToBrain));
      if(!limb.nearestToBrain)limb.nearestToBrain=limb.connectedLimbs.filter(x=>num(x.config,'DistanceToBrain')<num(limb.config,'DistanceToBrain')).sort((a,b)=>num(a.config,'DistanceToBrain')-num(b.config,'DistanceToBrain'))[0];
      if(limb.broken){limb.broken=false;this.breakBone(limb.part);}
    }
    person.activePose=poses[0];this.people.set(entity.id,person);this.refreshConnections(person);return person;
  }
  remove(entity: RagdollEntity) { const state=this.people.get(entity.id);if(state)for(const limb of state.limbs)this.limbByPart.delete(limb.part);this.people.delete(entity.id); }
  stateFor(entity: RagdollEntity) { return this.people.get(entity.id); }
  limbFor(part: RagdollPart) { return this.limbByPart.get(part); }
  skinFor(part:RagdollPart) {const limb=this.limbByPart.get(part);if(!limb)return undefined;const physical=this.physical(limb)?.state;return skinUniforms(limb.skinVisual,limb.skin,{temperature:physical?.temperature??limb.internalTemperature,charge:physical?.charge??0,burnProgress:physical?.burnProgress??0});}
  private wound(limb:LimbState,type:DamageKind,worldPoint:{x:number;y:number},intensity:number) {
    if(limb.skinVisual.wounds.length>=128)return;
    const strength=intensity*num(limb.skin,'intensityMultiplier',1);
    addSkinWound(limb.skinVisual,type,this.nativePoint(limb,worldPoint),strength,this.time);
    for(const targetId of array(limb.skin.adjacentLimbs).map(id)){const target=limb.person.limbs.find(l=>l.skinId===targetId);if(target)addSkinWound(target.skinVisual,type,this.nativePoint(target,worldPoint),strength,this.time);}
  }
  addWound(part:RagdollPart,type:DamageKind,point:{x:number;y:number},intensity:number):void {const limb=this.limbFor(part);if(limb&&Number.isFinite(intensity)&&intensity>=0)this.wound(limb,type,point,intensity);}
  private nativePoint(limb:LimbState,worldPoint:{x:number;y:number}){const local=limb.part.body.getLocalPoint(worldPoint);return{x:local.x/(limb.localScale.x||1),y:local.y/(limb.localScale.y||1)};}
  snapshot(entity:RagdollEntity):RagdollSnapshot|undefined {
    const p=this.stateFor(entity);if(!p)return undefined;
    return{version:1,stuns:p.limbs.filter(l=>(this.stunDelays.get(l)?.length??0)>0).map(l=>({limbId:l.id,delays:[...this.stunDelays.get(l)!]})),person:{consciousness:p.consciousness,oxygen:p.oxygen,shock:p.shock,pain:p.pain,adrenaline:p.adrenaline,brainDead:p.brainDead,brainDamaged:p.brainDamaged,brainDamagedTime:p.brainDamagedTime,seizureTime:p.seizureTime,desiredWalkingDirection:p.desiredWalkingDirection,overridePoseIndex:p.overridePoseIndex,time:p.time},limbs:p.limbs.map(l=>({id:l.id,health:l.health,initialHealth:l.initialHealth,numbness:l.numbness,broken:l.broken,frozen:l.frozen,internalTemperature:l.internalTemperature,blood:l.blood,bloodFlow:l.bloodFlow,bleedingRate:l.bleedingRate,internalBleeding:l.internalBleeding,isPump:l.isPump,wasInitiallyPumping:l.wasInitiallyPumping,lungsPunctured:l.lungsPunctured,dismembered:l.dismembered,jointStress:l.jointStress,acidProgress:l.acidProgress,rottenProgress:l.rottenProgress,wounds:l.skinVisual.wounds.map(w=>({...w})),modifiers:Object.fromEntries([...modifierNumbers.filter(k=>typeof l.config[k]==='number').map(k=>[k,l.config[k] as number]),...modifierFlags.map(k=>[k,flag(l.config,k)])]),skinIntensityMultiplier:num(l.skin,'intensityMultiplier',1),bloodLossRateMultiplier:num(l.circulation,'BloodLossRateMultiplier',1)}))};
  }
  restore(entity:RagdollEntity,value:unknown):boolean {
    const p=this.stateFor(entity),data=record(value),person=record(data.person),limbs=array(data.limbs).map(record);
    if(!p||data.version!==1||limbs.length!==p.limbs.length)return false;
    if(data.stuns!==undefined&&(!Array.isArray(data.stuns)||array(data.stuns).some(value=>{const stun=record(value);return!p.limbs.some(l=>l.id===stun.limbId)||!Array.isArray(stun.delays)||array(stun.delays).some(t=>typeof t!=='number'||!Number.isFinite(t)||t<0||t>.8);})))return false;
    const personNumbers=['consciousness','oxygen','shock','pain','adrenaline','brainDamagedTime','seizureTime','desiredWalkingDirection','overridePoseIndex','time'];
    const limbNumbers=['health','numbness','internalTemperature','blood','bloodFlow','bleedingRate','internalBleeding','jointStress','acidProgress','rottenProgress'];
    const personFlags=['brainDead','brainDamaged'],limbFlags=['broken','frozen','isPump','lungsPunctured','dismembered'];
    const finite=(d:Data,keys:string[])=>keys.every(k=>typeof d[k]==='number'&&Number.isFinite(d[k]));
    const boolean=(d:Data,keys:string[])=>keys.every(k=>typeof d[k]==='boolean');
    const ids=new Set(limbs.map(l=>l.id));
    if(ids.size!==p.limbs.length||!finite(person,personNumbers)||!boolean(person,personFlags)||limbs.some(l=>!p.limbs.some(x=>x.id===l.id)||!finite(l,limbNumbers)||!boolean(l,limbFlags)))return false;
    for(const l of limbs)if(num(l,'blood')<0||num(l,'bloodFlow')<0||num(l,'bloodFlow')>1||num(l,'health')<0)return false;
    for(const l of limbs){
      if(l.initialHealth!==undefined&&(typeof l.initialHealth!=='number'||!Number.isFinite(l.initialHealth)||l.initialHealth<=0))return false;
      if(l.wasInitiallyPumping!==undefined&&typeof l.wasInitiallyPumping!=='boolean')return false;
      if(['skinIntensityMultiplier','bloodLossRateMultiplier'].some(k=>l[k]!==undefined&&(typeof l[k]!=='number'||!Number.isFinite(l[k]))))return false;
      if(l.modifiers!==undefined&&Object.entries(record(l.modifiers)).some(([k,v])=>modifierNumbers.includes(k)?typeof v!=='number'||!Number.isFinite(v):modifierFlags.includes(k)?typeof v!=='boolean':true))return false;
    }
    for(const l of limbs)if(l.wounds!==undefined&&(!Array.isArray(l.wounds)||l.wounds.length>128||array(l.wounds).some(value=>{const w=record(value);return!finite(w,['x','y','intensity','type','time'])||!Number.isInteger(w.type)||num(w,'type')<0||num(w,'type')>5||num(w,'intensity')<0;})))return false;
    for(const limb of p.limbs){
      const saved=limbs.find(l=>l.id===limb.id)!;
      this.stunDelays.set(limb,array(record(array(data.stuns).find(value=>record(value).limbId===limb.id)).delays) as number[]);
      if(saved.dismembered&&!limb.dismembered)this.slice(limb.part);
      if(saved.broken&&!limb.broken)this.breakBone(limb.part);else if(!saved.broken&&limb.broken)this.healBone(limb.part);
      for(const key of [...limbNumbers,...limbFlags])Object.assign(limb,{[key]:saved[key]});
      if(saved.initialHealth!==undefined)limb.initialHealth=saved.initialHealth as number;
      if(saved.wasInitiallyPumping!==undefined)limb.wasInitiallyPumping=saved.wasInitiallyPumping as boolean;
      for(const[k,v]of Object.entries(record(saved.modifiers)))limb.config[k]=v;
      if(saved.skinIntensityMultiplier!==undefined)limb.skin.intensityMultiplier=saved.skinIntensityMultiplier;
      if(saved.bloodLossRateMultiplier!==undefined)limb.circulation.BloodLossRateMultiplier=saved.bloodLossRateMultiplier;
      limb.skinVisual.rottenProgress=limb.rottenProgress;limb.skinVisual.acidProgress=limb.acidProgress;
      limb.skinVisual.wounds=array(saved.wounds).map(value=>{const w=record(value);return{x:num(w,'x'),y:num(w,'y'),intensity:num(w,'intensity'),type:num(w,'type'),time:num(w,'time')};});
    }
    for(const key of [...personNumbers,...personFlags])Object.assign(p,{[key]:person[key]});
    this.time=Math.max(this.time,p.time);this.refreshConnections(p);this.choosePose(p);return true;
  }
  setPose(entity: RagdollEntity, index: number) { const person=this.stateFor(entity);if(person)person.overridePoseIndex=index<0?-1:Math.floor(index)%Math.max(1,person.poses.length); }
  damage(part: RagdollPart, amount: number, kind='damage') {
    const limb=this.limbByPart.get(part);if(!limb||!Number.isFinite(amount)||amount<=0||flag(limb.config,'ImmuneToDamage'))return;
    limb.health=Math.max(0,limb.health-amount);if(limb.health<=0){limb.isPump=false;if(flag(limb.config,'HasBrain'))limb.person.brainDead=true;}
    this.options.onDamage?.(limb,amount,kind);
  }
  heal(part: RagdollPart, amount: number) {const limb=this.limbByPart.get(part);if(limb&&Number.isFinite(amount)&&amount>0)limb.health=Math.min(limb.initialHealth,limb.health+amount);}
  healBleeding(part:RagdollPart){const limb=this.limbByPart.get(part);if(limb){limb.bleedingRate=0;limb.internalBleeding=0;}}
  influenceMotorSpeed(part:RagdollPart,speedDegrees:number,influence=.5){const limb=this.limbByPart.get(part);if(limb)this.influence(limb,speedDegrees,influence);}
  winceLimb(part:RagdollPart,intensity=1){const limb=this.limbByPart.get(part);if(limb?.joint&&limb.connected&&limb.health>=.1)this.influence(limb,clamp(60*intensity*(this.noise(limb.randomOffset,limb.person.time*8)*2-1),-450,450));}
  wincePerson(part:RagdollPart,intensity=150){const limb=this.limbByPart.get(part);if(limb)this.wince(limb.person,intensity);}
  private inBounds(limb:LimbState,point:{x:number;y:number},bounds:unknown) {
    const local=this.nativePoint(limb,point),distance=4/35;
    return array(bounds).some(value=>{const b=record(value),center=record(b.m_Center),extent=record(b.m_Extent);return Math.max(0,Math.abs(local.x-num(center,'x'))-num(extent,'x'))**2+Math.max(0,Math.abs(local.y-num(center,'y'))-num(extent,'y'))**2<=distance**2;});
  }
  shot(part:RagdollPart,input:ShotInput) {
    const limb=this.limbByPart.get(part);if(!limb||flag(limb.config,'ImmuneToDamage')||!Number.isFinite(input.damage)||input.damage<=0)return;
    const c=limb.config,p=limb.person,android=flag(c,'IsAndroid'),zombie=flag(c,'IsZombie');
    const damage=input.damage/this.massRatio(limb),multiplier=num(c,'ShotDamageMultiplier',1),artery=this.inBounds(limb,input.point,limb.circulation.LocalArteryRects),vital=this.inBounds(limb,input.point,c.VitalParts);
    // Circulation receives the same event separately from LimbBehaviour.
    if(!flag(limb.circulation,'ImmuneToDamage')) {
      if(input.exit){if(!zombie&&!android){limb.bleedingRate+=Math.max(.5,multiplier/10)*(artery?4:1);if(this.random()>.2&&vital)limb.isPump=false;}}
      else if(!android||input.damage>=50){
        const sourceComponents=components(record(part.metadata));
        const sourcePhysical=dataFor(sourceComponents,'PhysicalBehaviour','Temperature');
        const softness=this.physical(limb)?.properties?.Softness??num(record(record(sourcePhysical?.component.properties).data),'Softness',.728);
        if(!zombie&&this.random()<softness+.001)limb.bleedingRate+=Math.max(.5,input.damage*multiplier/3.5)*(artery?2:1);
        if(!android&&!zombie&&this.random()>.2&&vital)limb.isPump=false;
      }
    }
    if(input.exit){if(flag(c,'HasLungs')&&!android&&this.random()>.9)limb.lungsPunctured=true;this.wound(limb,DamageKind.Bullet,input.point,Math.max(60,damage*.4));this.options.onDamage?.(limb,0,'bullet exit');return;}
    if(android&&damage<40)return;
    const scaledDamage=android?damage*.2:damage;if(!android)limb.shotHeat++;
    if(flag(c,'HasLungs')&&!android&&this.random()>.9)limb.lungsPunctured=true;
    const vitalHit=vital&&this.random()>.05,severity=(vitalHit?7:.1)*scaledDamage;
    for(const neighbor of limb.connectedLimbs)neighbor.numbness+=.5;
    if(limb.connected){
      p.adrenaline+=this.random();p.consciousness-=.02+this.random()*.08;
      if(!android&&!zombie){p.shock+=severity*this.random()*.0025;this.wince(p,300);limb.numbness=1;if(this.random()*num(c,'Vitality')>.5&&this.random()>.6&&!this.paralysed(limb))p.pain+=this.random()*2;
        if(severity>2*this.random())p.desiredWalkingDirection+=(input.normal.x>0)===(p.angleOffset>0)?-this.random()*3:this.random()*3;
        this.wince(p,165);
      }
      if(flag(c,'HasBrain')&&!android){if(zombie&&this.random()>.2)return;const threshold=vitalHit?.1:.8;if(this.random()>threshold)this.damage(part,limb.health+1,'brain shot');if(this.random()>threshold)p.consciousness=0;}
    }
    if(input.canCrush&&scaledDamage>149&&clamp((scaledDamage-149)*.005,.3,.8)>this.random()){this.damage(part,limb.health+1,'crush');this.options.onCrush?.(limb);}
    else if(limb.shotHeat>5&&this.random()>.35){if(limb.joint&&this.random()>.8)this.slice(part);else if(input.canCrush){this.damage(part,limb.health+1,'crush');this.options.onCrush?.(limb);}}
    if(zombie||this.random()<.01)this.damage(part,severity*multiplier*.01,'bullet');
    else {if(!android)limb.internalBleeding+=severity+(vitalHit?5:0);this.damage(part,Math.min(limb.initialHealth/2,severity*multiplier*2),'bullet');}
    this.wound(limb,DamageKind.Bullet,input.point,Math.max(50,scaledDamage*.1));
  }
  breakBone(part: RagdollPart) {
    const limb=this.limbByPart.get(part);if(!limb||limb.broken)return;limb.broken=true;
    if(limb.joint){if(flag(limb.config,'IsLethalToBreak'))this.damage(part,limb.health+1,'bone');
      if(limb.connected){limb.person.shock+=this.random()*5;this.wince(limb.person,this.random()*150);}
      if(this.random()>.9)limb.internalBleeding+=this.random();
      if(limb.joint.isLimitEnabled())limb.joint.setLimits(lerp(limb.joint.getLowerLimit(),-Math.PI,.5),lerp(limb.joint.getUpperLimit(),Math.PI,.5));
    }
  }
  healBone(part:RagdollPart) { const limb=this.limbByPart.get(part);if(!limb)return;limb.broken=false;limb.jointStress=0;if(limb.joint&&limb.originalLimits)limb.joint.setLimits(...limb.originalLimits); }
  slice(part:RagdollPart) {
    const limb=this.limbByPart.get(part);if(!limb||flag(limb.config,'ImmuneToDamage'))return;
    limb.person.adrenaline++;
    if(limb.joint){this.damage(part,limb.health+1,'slice');this.detachJoint(limb);}
    this.refreshConnections(limb.person);
  }
  emp(part:RagdollPart){const limb=this.limbByPart.get(part);if(limb&&flag(limb.config,'IsAndroid'))this.damage(part,limb.health+1,'EMP');}
  /** LimbBehaviour.StunImpact: charge immediately; organic numbness/blackout after a random delay. */
  stunImpact(part:RagdollPart,stopAnimationOnDamage=false):void {
    const limb=this.limbFor(part);if(!limb)return;const physical=this.physical(limb);
    if(physical)physical.state.charge+=flag(limb.config,'IsAndroid')?10:1;
    if(flag(limb.config,'IsAndroid'))return;
    if(limb.connected&&!this.paralysed(limb)){limb.person.pain+=150;if(stopAnimationOnDamage)limb.person.overridePoseIndex=-1;}
    this.stunDelays.set(limb,[...this.stunDelays.get(limb)??[],this.random()*.8]);
  }
  private detachJoint(limb:LimbState,alreadyDestroyed=false) {
    const joint=limb.joint;if(!joint)return;
    const p=limb.person,source=p.limbs.find(l=>l.pushesTo.includes(limb));
    this.wound(limb,DamageKind.Dismemberment,limb.part.body.getWorldPoint(joint.getLocalAnchorA()),25);
    limb.bleedingRate+=10;if(source&&source.connected&&limb.connected)source.bleedingRate+=10;
    if(flag(limb.config,'IsLethalToBreak'))this.damage(limb.part,limb.health+1,'dismemberment');
    if(limb.connected&&!this.paralysed(limb))p.pain+=15;
    if(!alreadyDestroyed)limb.part.body.getWorld().destroyJoint(joint);
    p.entity.joints=p.entity.joints.filter(j=>j!==joint);for(const[id,value]of p.entity.jointById??[])if(value===joint)p.entity.jointById!.delete(id);
    limb.joint=undefined;limb.dismembered=true;
  }
  /** Post-solve impulse is adapted from OnCollisionEnter2D's average contact impulse. */
  impact(part:RagdollPart,normalImpulse:number) {
    const limb=this.limbByPart.get(part);if(!limb||flag(limb.config,'ImmuneToDamage')||!Number.isFinite(normalImpulse))return;
    let impulse=Math.abs(normalImpulse)/this.massRatio(limb)*.8;if(flag(limb.config,'IsAndroid'))impulse*=.1;
    if(flag(limb.config,'HasBrain')&&impulse>.6&&this.random()>.8)limb.internalBleeding+=impulse;
    if(impulse<2)return;
    this.wound(limb,DamageKind.Blunt,part.body.getPosition(),impulse*4);
    limb.bruises++;const threshold=num(limb.config,'BreakingThreshold',4)*this.massRatio(limb)/Math.max(.0001,num(limb.config,'ImpactDamageMultiplier',1));
    if(impulse>threshold&&this.random()>.2)this.breakBone(part);
    const vitality=Math.max(1,num(limb.config,'Vitality'));
    if(impulse>threshold*.5/vitality&&this.random()>.8/vitality)limb.internalBleeding+=clamp(impulse*vitality);
    if(!flag(limb.config,'IsAndroid')){
      if(flag(limb.config,'HasBrain')&&this.random()>.991&&impulse>4)limb.person.brainDamaged=true;
      else this.damage(part,impulse**3*2.8*num(limb.config,'ImpactDamageMultiplier',1),'impact');
    }
    const severity=impulse*(num(limb.config,'Vitality')+1)*.25;
    if(!limb.person.brainDamaged&&flag(limb.config,'HasBrain')&&severity>1&&!flag(limb.config,'IsAndroid')&&this.random()>.5)limb.person.consciousness*=this.random()*.8;
    if(limb.connected&&severity>.2&&!flag(limb.config,'IsZombie'))limb.person.shock+=severity*.04;
  }
  private massRatio(limb:LimbState) { return Math.max(.00001,limb.part.body.getMass()/Math.max(.00001,limb.initialMass)); }
  private alive(limb:LimbState) {return limb.connected&&limb.bloodFlow>.25&&limb.health>.01;}
  private paralysed(limb:LimbState,seen=new Set<LimbState>()):boolean {
    if(flag(limb.config,'IsAndroid')||flag(limb.config,'IsZombie')||!limb.nearestToBrain||seen.has(limb))return false;
    seen.add(limb);const nearest=limb.nearestToBrain;
    return nearest.connected&&((nearest.broken&&num(nearest.config,'RoughClassification')===1)||this.paralysed(nearest,seen));
  }
  private capable(limb:LimbState) {
    const p=limb.person,temperature=this.physical(limb)?.state.temperature??limb.internalTemperature;
    return !limb.frozen&&temperature>num(limb.config,'FreezingTemperature',-25)&&limb.connected&&limb.health>1&&p.consciousness>.8&&p.shock<.5&&p.pain<.5&&limb.numbness<.9&&limb.internalBleeding<.5&&limb.blood>.01&&limb.bloodFlow>.25&&!limb.broken;
  }
  motorStrength(limb:LimbState,pose=limb.person.activePose) {
    const p=limb.person,adrenaline=clamp(p.adrenaline),physical=this.physical(limb)?.state;
    if(p.consciousness<Math.max(.3,.8-adrenaline))return 0;
    limb.health=Math.max(0,limb.health);limb.numbness=clamp(limb.numbness+Math.min(limb.internalBleeding*.25,.1));
    if((limb.broken||this.paralysed(limb))&&(physical?.charge??0)<.05)return 0;
    const exponent=3*num(limb.config,'BloodMuscleStrengthRatio',1);
    const strength=(limb.health/Math.max(.00001,limb.initialHealth)+adrenaline)*Math.pow(clamp(limb.blood),exponent)*Math.pow(clamp(limb.bloodFlow),exponent)*clamp(p.consciousness+adrenaline)*clamp(1-(physical?.burnProgress??0))*clamp(1-limb.acidProgress)*clamp(1-(limb.numbness-adrenaline));
    const active=pose?.Angles.some(a=>id(a.Limb)===limb.id);
    return num(limb.config,'BaseStrength',5)*(active?(pose?.ForceMultiplier??1):1)*.9*clamp(Math.max(strength,(physical?.charge??0)*.5))*this.massRatio(limb);
  }
  private influence(limb:LimbState,speedDegrees:number,influence=.5) {
    if(!limb.joint)return;
    if(limb.person.brainDamaged&&this.random()>.95)speedDegrees*=this.random()<.5?-1:0;
    limb.joint.setMotorSpeed(lerp(limb.joint.getMotorSpeed(),-speedDegrees*DEG,influence));
  }
  private wince(person:PersonState,intensity:number) {for(const limb of person.limbs)if(limb.joint&&limb.connected&&limb.health>=.1)this.influence(limb,clamp((this.random()*2-1)*intensity,-450,450));}
  private refreshConnections(person:PersonState) {
    const byBody=new Map(person.limbs.map(l=>[l.part.body,l])),adjacency=new Map(person.limbs.map(l=>[l,new Set<LimbState>()]));
    const world=person.limbs[0]?.part.body.getWorld();if(!world)return;
    for(let joint=world.getJointList();joint;joint=joint.getNext()){
      const a=byBody.get(joint.getBodyA()),b=byBody.get(joint.getBodyB());if(a&&b){adjacency.get(a)!.add(b);adjacency.get(b)!.add(a);}
    }
    const roots=person.limbs.filter(l=>flag(l.node,'IsRoot'));
    const queue=roots.length?roots:person.head?[person.head]:[];const connected=new Set(queue);
    for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i])!)if(!connected.has(next)){connected.add(next);queue.push(next);}
    for(const limb of person.limbs){if(limb.joint&&!limb.person.entity.joints.includes(limb.joint))this.detachJoint(limb,true);limb.connected=connected.has(limb);}
  }
  private choosePose(person:PersonState) {
    let state=0;
    if(person.dead)state=0;
    else if(person.overridePoseIndex!==-1&&person.seizureTime<=0&&!person.brainDamaged){person.desiredWalkingDirection=1;person.activePose=person.poses[person.overridePoseIndex%person.poses.length];return;}
    else if(person.seizureTime>0||person.brainDamaged){person.consciousness=Math.max(person.consciousness,.8);state=9;}
    else if(Math.abs(person.desiredWalkingDirection)>.5&&person.touchingFloor&&person.pain<.5)state=6;
    else if(person.pain>.8&&!flag(person.head?.config??{},'IsZombie'))state=5;
    else if(person.touchingFloor){if(person.averageSpeed>25||person.shock>.5)state=1;else if(person.averageSpeed<15||person.shock<.2)state=0;else return;}
    else if(person.averageSpeed<10&&person.shock<=.5)state=person.averageWetness<.2?0:4;
    else if(person.averageSpeed<80||person.shock>.5)state=1;
    else if(person.averageWetness<.2)state=2;else return;
    person.activePose=person.linkedPoses.get(state)??person.poses[0];
  }
  private updateCirculation(person:PersonState,dt:number) {
    for(const limb of person.limbs){
      const physical=this.physical(limb)?.state;
      if((limb.internalTemperature<=num(limb.config,'BodyTemperature',37)-9||person.seizureTime>0)&&this.random()>.999)limb.isPump=false;
      const charge=physical?.charge??0;
      if(limb.isPump&&charge>.5&&this.random()>.995-charge/500)limb.isPump=false;
      else if(!limb.isPump&&limb.wasInitiallyPumping&&this.random()>.999&&charge>.001&&limb.bloodFlow<.1)limb.isPump=true;
      const total=Math.max(0,this.getTotalLiquid?.(limb.part)??limb.blood);
      limb.bloodFlow=clamp(limb.isPump&&limb.connected&&!person.brainDead?total:limb.bloodFlow-dt/20,0,Math.min(1,total));
      if(limb.bleedingRate>.05&&(physical?.temperature??37)>0){if(limb.bleedingRate<1)limb.bleedingRate=Math.max(0,limb.bleedingRate-dt*.05);limb.blood=Math.max(0,limb.blood-dt/lerp(60,20,limb.bloodFlow)*limb.bleedingRate*.15);}
      limb.internalBleeding=Math.max(0,limb.internalBleeding-dt*.01);
      if(!limb.dismembered&&limb.bleedingRate<1&&limb.health>.1&&limb.blood<1)limb.blood=clamp(limb.blood+num(limb.circulation,'BloodRegenerationPerSecond',.0025)*dt);
      for(const target of limb.pushesTo)if(target.connected&&limb.connected&&!target.dismembered&&target.bloodFlow<limb.bloodFlow)target.bloodFlow=lerp(target.bloodFlow,limb.bloodFlow,.5);
      // Preserve the shipped transfer sequence, including target AddLiquid clamping.
      const neighbors=limb.diffuseOscillator?limb.connectedLimbs:[...limb.connectedLimbs].reverse();
      if(!this.externalLiquidTransport)for(const target of neighbors)if(target.connected&&limb.connected&&target.blood<=limb.blood){const amount=Math.min(dt*1.5,limb.blood);limb.blood-=amount;target.blood=clamp(target.blood+amount);}
      limb.diffuseOscillator=!limb.diffuseOscillator;
    }
  }
  private updatePerson(person:PersonState,dt:number) {
    const head=person.head;
    const alive=!!head&&this.alive(head);
    if(head&&(head.health<.01||!head.connected))for(const limb of person.limbs)limb.isPump=false;
    person.brainDamagedTime=person.brainDamaged?person.brainDamagedTime+dt:0;
    person.seizureTime=Math.max(0,person.seizureTime-dt);
    if(alive){person.consciousness+=dt/120;if(((head?this.physical(head)?.state.wetness:0)??0)<.5)person.oxygen+=Math.pow(Math.sin(person.time*3),16)*.5/40*(dt*60);}
    else{person.consciousness-=dt/60;person.oxygen-=dt/40;}
    person.consciousness=clamp(person.consciousness);person.oxygen=clamp(person.oxygen);person.shock=clamp(person.shock-dt/25);person.pain=clamp(person.pain-dt/5);person.adrenaline=clamp(person.adrenaline-dt,0,20);
    person.desiredWalkingDirection=clamp(person.desiredWalkingDirection+(person.desiredWalkingDirection>0?-dt:dt),-4,4);
    person.averageHealth=person.limbs.reduce((sum,l)=>sum+l.health/l.initialHealth,0); // The shipped AllLimbLoopChecks does not increment its divisor.
    const attached=person.limbs.filter(l=>l.connected);
    person.averageSpeed=attached.reduce((sum,l)=>sum+l.part.body.getLinearVelocity().lengthSquared(),0)/Math.max(1,attached.length);
    person.averageWetness=attached.reduce((sum,l)=>sum+(this.physical(l)?.state.wetness??0),0)/Math.max(1,attached.length);
    person.touchingFloor=attached.some(l=>l.isOnFloor);
    person.balanceOffset=head?-Math.sin(head.part.body.getAngle()):0;
    person.heartbeat=0;
    for(const limb of attached)if(limb.isPump&&this.alive(limb)){const oxygen=clamp(person.oxygen),consciousness=clamp(person.consciousness),stress=clamp(person.adrenaline)+clamp(person.shock)+clamp(person.pain);person.heartbeat=Math.max(person.heartbeat,((70-(1-consciousness)*22)*limb.blood+lerp(0,95,stress)+this.noise(limb.randomOffset,person.time/7)*10)*lerp(.5,1,oxygen)*clamp(limb.bloodFlow));}
    if(!alive&&!person.dead){person.dead=true;this.options.onDeath?.(person);}else if(alive&&person.dead)person.dead=false;
    this.choosePose(person);
  }
  private updateLimb(limb:LimbState,dt:number) {
    const p=limb.person,c=limb.config,physical=this.physical(limb),state=physical?.state;
    limb.shotHeat=0;
    if(flag(c,'HasBrain')){if(p.brainDead){p.consciousness=0;p.shock=0;p.pain=0;limb.health=0;}else if(limb.health<=0)p.brainDead=true;}
    if(limb.health>0&&limb.health<limb.initialHealth)limb.health=Math.min(limb.initialHealth,limb.health+num(c,'RegenerationSpeed')*dt);
    limb.numbness=Math.max(0,limb.numbness-dt/20);
    if(!limb.connected&&limb.health>0)limb.health=Math.max(0,limb.health-dt/20*limb.initialHealth);
    if(limb.connected&&!flag(c,'IsAndroid')){
      if(p.oxygen<.05)this.damage(limb.part,dt*4,'hypoxia');
      if(flag(c,'HasBrain')&&(state?.wetness??0)>=.5){p.oxygen-=dt/40;if(p.oxygen<.9){p.consciousness-=dt/80;p.pain+=dt*.9;}}
    }
    if(flag(c,'HasLungs')&&limb.lungsPunctured&&limb.connected){if(!flag(c,'IsZombie'))p.pain+=2;p.oxygen-=dt*.5;}
    if(state){
      const external=state.temperature,internal=limb.internalTemperature;
      state.temperature=lerp(external,internal,num(c,'InternalToExternalTempTransferRate',.002));
      limb.internalTemperature=lerp(internal,external,num(c,'ExternalToInternalTempTransferRate',.005)*(external>internal?.3:1));
      const bodyTemperature=num(c,'BodyTemperature',37);
      if(Math.abs(limb.internalTemperature-bodyTemperature)>=3){limb.numbness+=.001*this.random();this.damage(limb.part,.005*this.random(),'temperature');}
      if(limb.internalTemperature>=num(c,'DiscomfortingHeatTemperature',40)||limb.internalTemperature<=bodyTemperature-3){if(limb.internalTemperature>=100)limb.bleedingRate=0;if(flag(c,'HasBrain')&&!this.paralysed(limb)){if(limb.internalTemperature>bodyTemperature){p.consciousness*=.9995;p.pain+=20;}else p.consciousness*=.999;}this.damage(limb.part,.0015,'temperature');}
      if(state.charge>0&&!flag(c,'IsZombie'))this.damage(limb.part,state.charge*.01,'electricity');
      if(state.wetness>.25&&flag(c,'IsAndroid'))state.charge+=.5;
      if(state.temperature>(physical?.properties?.BurningTemperatureThreshold??100))this.damage(limb.part,.0015+(state.temperature-(physical?.properties?.BurningTemperatureThreshold??100))/1000,'burn');
      else if(state.temperature<num(c,'FreezingTemperature',-25)){limb.acidProgress=Math.min(.5,limb.acidProgress+.0005);this.damage(limb.part,.05,'freeze');}
      if(limb.bloodFlow>.01&&limb.blood>.01){let factor=limb.internalTemperature<=bodyTemperature?.05:.025;if(state.temperature<num(c,'FreezingTemperature',-25))factor*=.03;limb.internalTemperature=lerp(limb.internalTemperature,bodyTemperature,factor*num(c,'BodyHeatProductionFactor',1));}
      if(this.alive(limb)&&state.onFire){limb.acidProgress+=dt*.01;state.burnProgress+=dt*.01;this.damage(limb.part,dt*.5*(flag(c,'IsZombie')?.01:1),'fire');if(!flag(c,'IsZombie')&&limb.connected&&!this.paralysed(limb))p.pain+=state.burnIntensity*dt;}
      if(this.alive(limb))state.burnProgress=Math.max(0,state.burnProgress-dt*num(c,'RegenerateBurnProgressSpeed',1)*.001);
    }
    if(flag(c,'HasBrain')&&limb.bloodFlow<.25)p.oxygen-=dt;
    regenerateSkin(limb.skinVisual,limb.skin,dt,limb.health,limb.initialHealth,limb.bleedingRate,this.alive(limb),flag(c,'IsZombie'));
    rotSkin(limb.skinVisual,limb.skin,dt,limb.health,String(c.SpeciesIdentity??'Human'),state?.temperature??37,flag(c,'IsZombie'));
    limb.skinVisual.acidProgress=clamp(limb.acidProgress);limb.rottenProgress=limb.skinVisual.rottenProgress;
    if(!flag(c,'ImmuneToDamage')&&limb.part.body.isDynamic()&&(c.SpeciesIdentity??'Human')==='Human'&&num(c,'GForcePassoutThreshold',10)>0){
      const acceleration=limb.sustainedAcceleration.x**2+limb.sustainedAcceleration.y**2;
      if(acceleration>num(c,'GForcePassoutThreshold',10)**2){if(flag(c,'HasBrain'))p.consciousness*=.5;if(acceleration>num(c,'GForceDamageThreshold',10)**2)this.damage(limb.part,acceleration/250,'G-force');}
    }
    if(!flag(c,'IsZombie')&&!flag(c,'IsAndroid')&&limb.internalBleeding>.2){const intensity=limb.internalBleeding,kind=num(c,'RoughClassification');if(kind===0){this.damage(limb.part,(this.random()>5/intensity?20:.0004)*intensity,'internal bleeding');p.oxygen-=.0001*intensity;p.consciousness-=.0001*intensity;}else if(kind===1)this.damage(limb.part,.0015*intensity,'internal bleeding');else{limb.numbness+=.2*intensity;this.damage(limb.part,.001*intensity,'internal bleeding');}}
    const pose=p.activePose;if(!pose)return;
    const strength=this.motorStrength(limb,pose);limb.motorStrength=strength;
    if(limb.bloodFlow>Math.max(.25,.9-clamp(p.adrenaline))&&p.touchingFloor&&pose.ShouldStandUpright&&this.capable(limb)){
      const body=limb.part.body;
      if(num(c,'FakeUprightForce')>.001&&body.isDynamic()&&Math.cos(body.getAngle())>=0){let torque=deltaDegrees(body.getAngle()/DEG,0)*num(c,'FakeUprightForce')*strength*lerp(this.massRatio(limb),1,.6);if(flag(c,'IsAndroid'))torque*=3.2;if(Number.isFinite(torque))body.applyTorque(torque*1.8*(pose.UprightForceMultiplier??1),true);}
      if(body.isDynamic()){body.setAngularVelocity(body.getAngularVelocity()*lerp(1,.92,pose.DragInfluence??1));body.setLinearVelocity(Vec2.mul(body.getLinearVelocity(),lerp(1,.94,pose.DragInfluence??1)));}
    }
    if(!limb.joint)return;
    const joint=limb.joint,angle=-joint.getJointAngle()/DEG,poseAngle=pose.Angles.find(a=>id(a.Limb)===limb.id),freezing=limb.frozen||(state?.temperature??37)<=num(c,'FreezingTemperature',-25);
    if(freezing){joint.setMaxMotorTorque(10);this.influence(limb,0,1);return;}
    const rigidity=poseAngle?.PoseRigidityModifier??0;
    let maxTorque=Math.max(strength,limb.rottenProgress*.8);for(const multiplier of array(c.StrengthMultipliers))if(typeof multiplier==='number')maxTorque*=multiplier;
    joint.enableMotor(true);joint.setMaxMotorTorque(Math.max(0,maxTorque*(flag(c,'IsAndroid')?6:1)*(poseAngle?clamp(1+rigidity):1)));
    let overridden=false;
    if(this.capable(limb)&&p.touchingFloor&&pose.ShouldStumble){const amount=Math.abs(p.balanceOffset*1.5),balanceStrength=clamp(strength,0,amount*2);if(flag(c,'DoBalanceJerk'))this.influence(limb,deltaDegrees(angle,deltaDegrees(0,limb.part.body.getAngle()/DEG))*num(c,'BalanceMuscleMovement',1),.5*balanceStrength);if(poseAngle&&p.shock<.5&&flag(c,'DoStumble')&&amount>.3&&amount<1){limb.stumbleTime+=clamp(p.balanceOffset*-.1,-1.7,1.7);const stumble=p.poses.find(x=>x.State===3),entry=stumble?.Angles.find(a=>id(a.Limb)===limb.id);if(stumble&&entry){const target=evaluateLimbPose(entry,limb.stumbleTime)*p.angleOffset;this.influence(limb,deltaDegrees(angle,target)*Math.pow(amount,1.5)*1.3*balanceStrength*num(p.config,'GlobalRigidityMultiplier',1)*(stumble.Rigidity??5)*(1+(entry.PoseRigidityModifier??0)));overridden=true;}}}
    if(!overridden&&poseAngle&&this.alive(limb)){let speed=((state?.temperature??37)<=num(c,'FreezingTemperature',-25)+10||(state?.temperature??37)>=num(c,'DiscomfortingHeatTemperature',40))?.5:1;if(pose.State===6)speed*=p.desiredWalkingDirection>=0?1:-1;speed/=lerp(this.massRatio(limb),1,.9);const target=evaluateLimbPose(poseAngle,p.time,(pose.AnimationSpeedMultiplier??1)*speed,this.noise(limb.randomOffset,p.time*speed))*p.angleOffset;this.influence(limb,deltaDegrees(angle,target)*num(p.config,'GlobalRigidityMultiplier',1)*(pose.Rigidity??5)*(1+rigidity));}
    if(this.alive(limb)&&(state?.charge??0)>0)this.influence(limb,-50*p.angleOffset,(state?.charge??0)*.5);
    if(!flag(c,'IsZombie')||!this.alive(limb))this.influence(limb,0,limb.rottenProgress);
    if(limb.originalLimits&&!limb.broken&&joint.isLimitEnabled()){if(joint.getJointAngle()-5*DEG>limb.originalLimits[1]||joint.getJointAngle()+5*DEG<limb.originalLimits[0])limb.jointStress+=flag(c,'IsAndroid')?.1:.25;if(limb.jointStress>num(c,'BreakingThreshold',4)*this.massRatio(limb))this.breakBone(limb.part);limb.jointStress*=.982;}
  }
  update(dt:number) {
    if(!Number.isFinite(dt)||dt<=0)return;
    this.time+=dt;
    for(const person of this.people.values()){
      person.time=this.time;this.refreshConnections(person);this.updateCirculation(person,dt);this.updatePerson(person,dt);
      for(const limb of person.limbs){this.updateLimb(limb,dt);
        const delays=this.stunDelays.get(limb);if(delays?.length){const remaining:number[]=[];for(const delay of delays){if(delay<=dt){limb.numbness=1;if(limb.connected)person.consciousness=0;}else remaining.push(delay-dt);}this.stunDelays.set(limb,remaining);}
      }
    }
  }
  afterStep(_dt:number) {
    for(const person of this.people.values())for(const limb of person.limbs){
      const current=limb.part.body.getLinearVelocity();
      limb.sustainedAcceleration={x:lerp(limb.sustainedAcceleration.x,current.x-limb.velocity.x,.5),y:lerp(limb.sustainedAcceleration.y,current.y-limb.velocity.y,.5)};
      limb.velocity={x:current.x,y:current.y};
      if(limb.joint&&person.entity.joints.includes(limb.joint)&&_dt>0){
        const c=limb.config,temperature=this.physical(limb)?.state.temperature??37,android=flag(c,'IsAndroid');
        let strength=num(c,'BreakingThreshold',4)*120*clamp(1-limb.rottenProgress,.1,1)*this.massRatio(limb);
        if(!android)strength*=clamp(.1+(temperature+100)/100*.9,.1,1);
        const reaction=limb.joint.getReactionForce(1/_dt),torque=Math.abs(limb.joint.getReactionTorque(1/_dt));
        if(Math.hypot(reaction.x,reaction.y)>strength*(android?80:2.5)||torque>strength*5000)this.detachJoint(limb);
      }
      limb.isOnFloor=false;
      for(let edge=limb.part.body.getContactList();edge;edge=edge.next){const contact=edge.contact;if(contact.isTouching()&&!contact.getFixtureA().isSensor()&&!contact.getFixtureB().isSensor()){limb.isOnFloor=true;break;}}
    }
    for(const person of this.people.values())this.refreshConnections(person);
  }
}
