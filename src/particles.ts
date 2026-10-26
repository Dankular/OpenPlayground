import * as THREE from 'three';
import type { Entity } from './simulation';
import type { SourceComponent, SourceNode } from './prefabs';
import { evaluatePoseCurve, type SerializedCurve } from './systems/ragdoll';
import rawManifest from './generated/particle-materials.json?raw';

type Data = Record<string, unknown>;
type RGBA = {r:number;g:number;b:number;a:number};
const rec = (v:unknown):Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const num = (v:unknown,f=0) => typeof v === 'number' && Number.isFinite(v) ? v : f;
const on = (v:unknown) => v === true || v === 1;
const clamp = (v:number) => Math.min(1,Math.max(0,v));
const mix = (a:number,b:number,t:number) => a+(b-a)*t;
const color = (v:unknown):RGBA => {const d=rec(v);return {r:num(d.r,1),g:num(d.g,1),b:num(d.b,1),a:num(d.a,1)};};
const linear = (v:number) => v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const vec = (v:unknown,f=0) => {const d=rec(v);return new THREE.Vector3(num(d.x,f),num(d.y,f),num(d.z,f));};
const pointer = (v:unknown) => String(rec(v).m_PathID??'0');

/** Unity 2020 MinMaxCurve: constant, curve, two curves, two constants. */
export function particleCurve(value:unknown,time:number,random=.5):number {
  const d=rec(value),scalar=num(d.scalar),mode=num(d.minMaxState);
  if(mode===0)return scalar;
  if(mode===3)return mix(num(d.minScalar),scalar,random);
  const evaluate=(v:unknown)=>{const c=v as SerializedCurve;return c?.m_Curve?.length?evaluatePoseCurve(c,time):0;};
  return scalar*(mode===2?mix(evaluate(d.minCurve),evaluate(d.maxCurve),random):evaluate(d.maxCurve));
}
export function particleGradient(value:unknown,time:number):RGBA {
  const d=rec(value),sample=(alpha:boolean)=>{
    const count=num(d[alpha?'m_NumAlphaKeys':'m_NumColorKeys']);
    if(!count)return alpha?1:{r:1,g:1,b:1};
    const keys=Array.from({length:count},(_,i)=>({t:num(d[`${alpha?'atime':'ctime'}${i}`])/65535,c:color(d[`key${i}`])})).sort((a,b)=>a.t-b.t);
    if(time>=keys[count-1].t)return alpha?keys[count-1].c.a:keys[count-1].c;
    let left=keys[0],right=keys[count-1];
    for(let i=1;i<count;i++)if(time<=keys[i].t){left=keys[i-1];right=keys[i];break;}
    const t=num(d.m_Mode)===1?0:clamp((time-left.t)/(right.t-left.t||1));
    return alpha?mix(left.c.a,right.c.a,t):{r:mix(left.c.r,right.c.r,t),g:mix(left.c.g,right.c.g,t),b:mix(left.c.b,right.c.b,t)};
  };
  return {...sample(false) as {r:number;g:number;b:number},a:sample(true) as number};
}
export function particleColor(value:unknown,time:number,random=.5):RGBA {
  const d=rec(value),mode=num(d.minMaxState);
  if(mode===0)return color(d.maxColor);
  if(mode===1||mode===4)return particleGradient(d.maxGradient,mode===4?random:time);
  const a=mode===2?color(d.minColor):particleGradient(d.minGradient,time),b=mode===2?color(d.maxColor):particleGradient(d.maxGradient,time);
  return {r:mix(a.r,b.r,random),g:mix(a.g,b.g,random),b:mix(a.b,b.b,random),a:mix(a.a,b.a,random)};
}

interface TextureSource {url?:string;colorSpace:number;settings:Data;scale:{x:number;y:number};offset:{x:number;y:number}}
interface MaterialSource {file:string;pathId:string;name:string;shader:{name:string;blend?:Data;zWrite?:Data};textures:Record<string,TextureSource>;colors:Record<string,RGBA>;floats:Record<string,number>;keywords:string}
interface EffectSource {name:string;rootGameObjectId:string;nodes:SourceNode[];unsupported:string[];timers?:{nodeId:string;life:number}[]}
interface Manifest {materials:Record<string,MaterialSource>;renderers:Record<string,(string|null)[]>;effects:Record<string,EffectSource>;references:Record<string,string>}
const manifest=JSON.parse(rawManifest) as Manifest;

/** Adapt the shipped Unlit/AdditiveGlowSprite program (shader 885).
 * Uses shader pass ONE/ONE state rather than unrelated serialized _DstBlend.
 */
export function createNativeSpriteMaterial(rendererKey:string,texture:THREE.Texture,spriteColor:RGBA={r:1,g:1,b:1,a:1},projectLinear=true):THREE.ShaderMaterial|null {
  const key=manifest.renderers[rendererKey]?.[0],source=key?manifest.materials[key]:undefined;
  if(source?.shader.name!=='Unlit/AdditiveGlowSprite')return null;
  const convert=projectLinear?linear:(v:number)=>v,toUniform=(c:RGBA)=>new THREE.Vector4(convert(c.r),convert(c.g),convert(c.b),c.a);
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
    blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
    uniforms:{mainTexture:{value:texture},tint:{value:toUniform(color(source.colors._Color))},glow:{value:toUniform(color(source.colors._GlowColour))},
      intensity:{value:source.floats._GlowIntensity??1},spriteColor:{value:new THREE.Vector4(spriteColor.r,spriteColor.g,spriteColor.b,spriteColor.a)}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`uniform sampler2D mainTexture;uniform vec4 tint;uniform vec4 glow;uniform vec4 spriteColor;uniform float intensity;varying vec2 vUv;
void main(){gl_FragColor=texture2D(mainTexture,vUv)*tint*spriteColor*glow*intensity*spriteColor.a;
#include <colorspace_fragment>
}`});
  material.name=`Native ${source.shader.name}: ${source.name}`;material.userData.sourceMaterial=key;return material;
}
export interface ParticlePose {position:THREE.Vector3;angle:number;scale:{x:number;y:number}}
export interface NativeParticle {position:THREE.Vector3;velocity:THREE.Vector3;age:number;life:number;size:THREE.Vector2;rotation:number;color:RGBA;seed:number;gravity:number}
export interface ParticleEmitter {
  entity:Entity;node:SourceNode;component:SourceComponent;renderer:SourceComponent;mesh:THREE.InstancedMesh;particles:NativeParticle[];
  time:number;carry:number;previous:ParticlePose;playing:boolean;delay:number;bursts:Set<string>;max:number;materialKey:string;overrides:EmitterOverrides;
}
export interface EmitterOverrides {playing?:boolean;rate?:number;distanceRate?:number;speed?:number;color?:RGBA}
export interface ParticleViewOptions {
  random?:()=>number;gravity?:()=>{x:number;y:number};loadTexture?:(source:TextureSource)=>THREE.Texture;
  projectLinear?:boolean;maxParticlesPerEmitter?:number;
}

const VERTEX=`attribute vec4 particleColor;varying vec4 vColor;varying vec2 vUv;
void main(){vColor=particleColor;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`;
const FRAGMENT=`uniform sampler2D mainTexture;uniform vec4 tint;uniform vec4 uvTransform;uniform float cutoff;uniform float legacyMode;
varying vec4 vColor;varying vec2 vUv;
void main(){vec4 tex=texture2D(mainTexture,vUv*uvTransform.xy+uvTransform.zw);gl_FragColor=tex*tint*vColor;
if(legacyMode==1.0){gl_FragColor*=2.0;gl_FragColor.a=clamp(gl_FragColor.a,0.0,1.0);}
if(legacyMode==2.0){gl_FragColor=tex*vColor*vColor.a;}
if(gl_FragColor.a<cutoff)discard;
#include <colorspace_fragment>
}`;

/** Original serialized Shuriken emitters in the XY scene. No substitute textures. */
export class ParticleSystemView {
  readonly emitters=new Map<Entity,ParticleEmitter[]>();
  readonly unsupported=new Set<string>();
  private textures=new Map<string,THREE.Texture>();
  private detached=new Set<Entity>();
  private effectAges=new Map<Entity,number>();
  private effectTimers=new Map<Entity,{nodeId:string;life:number}[]>();
  private matrix=new THREE.Matrix4();private quaternion=new THREE.Quaternion();
  private nextEffect=-1;
  constructor(readonly scene:THREE.Scene,readonly options:ParticleViewOptions={}){}
  private random(){return (this.options.random??Math.random)();}
  private texture(source:TextureSource):THREE.Texture|null {
    if(!source.url)return null;
    let texture=this.textures.get(source.url);if(texture)return texture;
    texture=this.options.loadTexture?.(source)??new THREE.TextureLoader().load(source.url);
    texture.colorSpace=source.colorSpace===1?THREE.SRGBColorSpace:THREE.NoColorSpace;
    const wrap=(v:unknown)=>num(v)===1?THREE.ClampToEdgeWrapping:num(v)===2?THREE.MirroredRepeatWrapping:THREE.RepeatWrapping;
    texture.wrapS=wrap(source.settings.m_WrapU);texture.wrapT=wrap(source.settings.m_WrapV);
    texture.magFilter=num(source.settings.m_FilterMode)===0?THREE.NearestFilter:THREE.LinearFilter;
    texture.minFilter=num(source.settings.m_FilterMode)===0?THREE.NearestFilter:num(source.settings.m_FilterMode)===2?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;
    this.textures.set(source.url,texture);return texture;
  }
  attach(entity:Entity):void {
    if(this.emitters.has(entity))return;
    const result:ParticleEmitter[]=[];
    for(const node of entity.metadata?.nodes??[])for(const component of node.components){
      if(component.type!=='ParticleSystem')continue;
      const renderer=node.components.find(c=>c.type==='ParticleSystemRenderer');if(!renderer)continue;
      const key=manifest.renderers[`${renderer.file??component.file??'sharedassets0.assets'}:${renderer.pathId}`]?.[0],source=key?manifest.materials[key]:undefined;
      if(!source){this.unsupported.add(`renderer ${renderer.pathId}: unresolved original material`);continue;}
      const allowed=['Particles/Standard Unlit','Legacy Shaders/Particles/Additive','Legacy Shaders/Particles/Alpha Blended Premultiply','Sprites/Default'];
      if(!allowed.includes(source.shader.name)){this.unsupported.add(`material ${key}: unsupported source shader ${source.shader.name}`);continue;}
      const main=source.textures._MainTex,texture=main?this.texture(main):null;
      if(!texture){this.unsupported.add(`material ${key}: missing original texture`);continue;}
      const rd=renderer.data,d=component.data,initial=rec(d.InitialModule),renderMode=num(rd.m_RenderMode);
      if(renderMode===4||renderMode===2||renderMode===3){this.unsupported.add(`renderer ${renderer.pathId}: unsupported render mode ${renderMode}`);continue;}
      const tint=color(source.colors._Color??source.colors._TintColor),convert=this.options.projectLinear!==false?linear:(x:number)=>x;
      const stateValue=(value:unknown,fallback:number)=>{const d=rec(value);return typeof d.name==='string'&&d.name in source.floats?source.floats[d.name]:num(d.val,fallback);};
      const material=new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,transparent:true,side:THREE.DoubleSide,depthWrite:on(stateValue(source.shader.zWrite,0)),toneMapped:false,
        uniforms:{mainTexture:{value:texture},tint:{value:new THREE.Vector4(convert(tint.r),convert(tint.g),convert(tint.b),tint.a)},
          uvTransform:{value:new THREE.Vector4(main.scale.x,main.scale.y,main.offset.x,main.offset.y)},cutoff:{value:source.keywords.includes('_ALPHATEST_ON')?source.floats._Cutoff??.5:0},
          legacyMode:{value:source.shader.name==='Legacy Shaders/Particles/Additive'?1:source.shader.name==='Legacy Shaders/Particles/Alpha Blended Premultiply'?2:0}}});
      material.blending=THREE.CustomBlending;
      const blend:THREE.BlendingSrcFactor[]=[THREE.ZeroFactor,THREE.OneFactor,THREE.DstColorFactor,THREE.SrcColorFactor,THREE.OneMinusDstColorFactor,THREE.SrcAlphaFactor,THREE.OneMinusSrcColorFactor,THREE.DstAlphaFactor,THREE.OneMinusDstAlphaFactor,THREE.SrcAlphaSaturateFactor,THREE.OneMinusSrcAlphaFactor];
      material.blendSrc=blend[stateValue(source.shader.blend?.srcBlend,5)]??THREE.SrcAlphaFactor;
      material.blendDst=(blend[stateValue(source.shader.blend?.destBlend,10)]??THREE.OneMinusSrcAlphaFactor) as THREE.BlendingDstFactor;
      material.blendEquation=[THREE.AddEquation,THREE.SubtractEquation,THREE.ReverseSubtractEquation,THREE.MinEquation,THREE.MaxEquation][stateValue(source.shader.blend?.blendOp,0)]??THREE.AddEquation;
      const nativeMax=Math.max(1,Math.floor(num(initial.maxNumParticles,1000))),max=Math.min(nativeMax,this.options.maxParticlesPerEmitter??nativeMax);
      if(max<nativeMax)this.unsupported.add(`emitter ${component.pathId}: explicit particle budget ${max}/${nativeMax}`);
      const geometry=new THREE.PlaneGeometry(1,1);geometry.setAttribute('particleColor',new THREE.InstancedBufferAttribute(new Float32Array(max*4),4));
      const mesh=new THREE.InstancedMesh(geometry,material,max);mesh.count=0;mesh.frustumCulled=false;mesh.name=`Native particles ${node.name}:${component.pathId}`;mesh.renderOrder=num(rd.m_SortingOrder);this.scene.add(mesh);
      const emitter:ParticleEmitter={entity,node,component,renderer,mesh,particles:[],time:0,carry:0,previous:this.pose(entity,node),playing:on(d.playOnAwake),delay:particleCurve(d.startDelay,0,this.random()),bursts:new Set(),max,materialKey:key!,overrides:{}};
      result.push(emitter);this.reportModules(emitter);
    }
    this.emitters.set(entity,result);
    for(const emitter of result)if(on(emitter.component.data.prewarm)&&on(emitter.component.data.looping)){
      const duration=num(emitter.component.data.lengthInSec,1),steps=Math.min(600,Math.ceil(duration*60));
      for(let i=0;i<steps;i++)this.advance(emitter,duration/steps);
      this.unsupported.add(`emitter ${emitter.component.pathId}: prewarm sampled at bounded 60Hz`);
    }
  }
  private reportModules(e:ParticleEmitter):void {
    const d=e.component.data,supported=new Set(['InitialModule','EmissionModule','ShapeModule','SizeModule','ColorModule','RotationModule','VelocityModule','ForceModule','InheritVelocityModule','SizeBySpeedModule','UVModule']);
    for(const [key,module]of Object.entries(d))if(key.endsWith('Module')&&on(rec(module).enabled)&&!supported.has(key))this.unsupported.add(`emitter ${e.component.pathId}: ${key}`);
    if(num(d.moveWithTransform)===2)this.unsupported.add(`emitter ${e.component.pathId}: custom simulation space`);
    if(on(rec(d.InitialModule).rotation3D))this.unsupported.add(`emitter ${e.component.pathId}: 3D start rotation`);
    const shape=rec(d.ShapeModule);if(on(shape.enabled)&&![0,1,2,3,4,5,7,8,9,10,11,12,15,16,18].includes(num(shape.type)))this.unsupported.add(`emitter ${e.component.pathId}: shape ${shape.type}`);
    if(on(shape.enabled)&&[15,16].includes(num(shape.type)))this.unsupported.add(`emitter ${e.component.pathId}: box shell/edge distribution`);
    if(on(rec(d.InheritVelocityModule).enabled)&&num(rec(d.InheritVelocityModule).m_Mode)===1)this.unsupported.add(`emitter ${e.component.pathId}: current-mode inherited velocity`);
    if(on(rec(d.RotationModule).enabled))this.unsupported.add(`emitter ${e.component.pathId}: nonconstant angular-velocity integration`);
    if(sourceShaderHasExtraModes(e.materialKey))this.unsupported.add(`material ${e.materialKey}: additional source color/fading/distortion modes`);
    if(on(rec(d.UVModule).enabled))this.unsupported.add(`emitter ${e.component.pathId}: texture-sheet animation`);
    if(num(e.renderer.data.m_RenderMode)===1)this.unsupported.add(`renderer ${e.renderer.pathId}: camera velocity stretching`);
    if(num(d.scalingMode)!==0)this.unsupported.add(`emitter ${e.component.pathId}: scaling mode ${d.scalingMode}`);
  }
  private pose(entity:Entity,node:SourceNode):ParticlePose {
    const body=entity.parts.find(p=>p.id===node.bodyId),bodyNode=body?entity.metadata?.nodes.find(n=>n.id===body.metadata?.nodeId):undefined;
    const angle=body?body.body.getAngle()-(bodyNode?.angle??0):entity.angle??0;
    const origin=body?body.body.getPosition():entity.position??{x:0,y:0};
    const offset={x:node.position.x-(bodyNode?.position.x??0),y:node.position.y-(bodyNode?.position.y??0)};
    return {position:new THREE.Vector3(origin.x+Math.cos(angle)*offset.x-Math.sin(angle)*offset.y,origin.y+Math.sin(angle)*offset.x+Math.cos(angle)*offset.y,0),angle:angle+node.angle,scale:{...node.scale}};
  }
  remove(entity:Entity):void {
    for(const e of this.emitters.get(entity)??[]){this.scene.remove(e.mesh);e.mesh.geometry.dispose();(e.mesh.material as THREE.Material).dispose();}
    this.emitters.delete(entity);this.detached.delete(entity);this.effectAges.delete(entity);this.effectTimers.delete(entity);
  }
  play(entity:Entity,nodeId?:string):void {for(const e of this.emitters.get(entity)??[])if(!nodeId||e.node.id===nodeId){e.playing=true;e.time=0;e.carry=0;e.bursts.clear();}}
  stop(entity:Entity,nodeId?:string,clear=false):void {for(const e of this.emitters.get(entity)??[])if(!nodeId||e.node.id===nodeId){e.playing=false;if(clear){e.particles=[];e.mesh.count=0;}}}
  /** Runtime Main/Emission module changes, expressed as absolute source values.
   * Stopping preserves live particles; start color/speed affect new births only. */
  setEmitter(entity:Entity,reference:unknown,overrides:EmitterOverrides):boolean {
    if([overrides.rate,overrides.distanceRate,overrides.speed].some(v=>v!==undefined&&!Number.isFinite(v))||overrides.color&&![overrides.color.r,overrides.color.g,overrides.color.b,overrides.color.a].every(Number.isFinite))return false;
    const id=pointer(reference);let found=false;
    for(const e of this.emitters.get(entity)??[])if(e.component.pathId===id){
      found=true;
      if(overrides.playing!==undefined&&overrides.playing!==e.playing){
        e.playing=overrides.playing;if(e.playing){e.time=0;e.carry=0;e.bursts.clear();e.previous=this.pose(entity,e.node);}
      }
      e.overrides={...e.overrides,...overrides,color:overrides.color?{...overrides.color}:e.overrides.color};
    }
    return found;
  }
  spawnEffect(reference:unknown,sourceFile:string,position:{x:number;y:number},angle=0):Entity|null {
    const key=manifest.references[`${sourceFile}:${num(rec(reference).m_FileID)}:${pointer(reference)}`]??`${sourceFile}:${pointer(reference)}`,effect=manifest.effects[key];
    if(!effect){this.unsupported.add(`effect ${key}: not in focused source manifest`);return null;}
    const entity:Entity={id:this.nextEffect--,kind:'prefab',name:effect.name,parts:[],joints:[],frozen:false,position:{...position},angle,metadata:{nodes:effect.nodes.map(n=>({...n,scale:{...n.scale}}))}};
    this.attach(entity);this.detached.add(entity);this.effectAges.set(entity,0);this.effectTimers.set(entity,effect.timers??[]);return entity;
  }
  update(dt:number):void {
    if(!(dt>0)||!Number.isFinite(dt))return;
    for(const [entity,emitters]of [...this.emitters]){
      if(this.detached.has(entity)){
        const age=(this.effectAges.get(entity)??0)+dt;this.effectAges.set(entity,age);
        for(const timer of this.effectTimers.get(entity)??[])if(age>timer.life){
          const destroyed=new Set([timer.nodeId]);let changed=true;while(changed){changed=false;for(const node of entity.metadata?.nodes??[])if(node.parentId&&destroyed.has(node.parentId)&&!destroyed.has(node.id)){destroyed.add(node.id);changed=true;}}
          for(const e of emitters)if(destroyed.has(e.node.id)){e.node.active=false;e.playing=false;e.particles=[];e.mesh.count=0;}
        }
      }
      for(const e of emitters)this.advance(e,dt);
      if(this.detached.has(entity)&&emitters.every(e=>!e.playing&&!e.particles.length))this.remove(entity);
    }
  }
  private advance(e:ParticleEmitter,dt:number):void {
    const d=e.component.data,pose=this.pose(e.entity,e.node),speed=num(d.simulationSpeed,1),step=dt*speed;
    const active=e.node.active;
    e.mesh.visible=active&&e.renderer.data.m_Enabled!==false&&e.renderer.data.m_Enabled!==0&&num(e.renderer.data.m_RenderMode)!==5;if(!active)return;
    const duration=Math.max(.00001,num(d.lengthInSec,1)),before=e.time;e.time+=step;
    const emission=rec(d.EmissionModule),local=num(d.moveWithTransform)===0;
    if(e.playing&&on(emission.enabled)&&e.time>=e.delay){
      const start=Math.max(0,before-e.delay),end=e.time-e.delay;
      const allowedEnd=on(d.looping)?end:Math.min(duration,end),allowedStart=Math.min(allowedEnd,start),phase=(allowedEnd%duration)/duration;
      e.carry+=Math.max(0,e.overrides.rate??particleCurve(emission.rateOverTime,phase,this.random()))*(allowedEnd-allowedStart);
      if(start<duration||on(d.looping))e.carry+=Math.max(0,e.overrides.distanceRate??particleCurve(emission.rateOverDistance,phase,this.random()))*pose.position.distanceTo(e.previous.position);
      let count=Math.floor(e.carry);e.carry-=count;
      for(let cycle=Math.floor(start/duration);cycle<=Math.floor(allowedEnd/duration);cycle++){
        if(!on(d.looping)&&cycle>0)break;
        for(const [index,b]of (Array.isArray(emission.m_Bursts)?emission.m_Bursts:[]).entries()){
          const burst=rec(b),repeats=num(burst.cycleCount,1),interval=num(burst.repeatInterval,.01);
          const maxRepeats=repeats===0?Math.floor(duration/Math.max(.00001,interval))+1:repeats;
          for(let repeat=0;repeat<maxRepeats;repeat++){
            const time=cycle*duration+num(burst.time)+repeat*interval,key=`${cycle}:${index}:${repeat}`;
            if(time>=start&&time<=allowedEnd&&!e.bursts.has(key)){e.bursts.add(key);if(this.random()<=num(burst.probability,1))count+=Math.max(0,Math.round(particleCurve(burst.countCurve,phase,this.random())));}
          }
        }
      }
      const available=Math.min(count,e.max-e.particles.length);
      for(let i=0;i<available;i++){
        const spawnPose={...pose,position:e.previous.position.clone().lerp(pose.position,(i+1)/Math.max(1,available))};
        this.emit(e,spawnPose,phase,local,pose.position.clone().sub(e.previous.position).multiplyScalar(1/dt));
      }
      if(!on(d.looping)&&end>=duration)e.playing=false;
    }
    e.previous=pose;
    const gravity=this.options.gravity?.()??{x:0,y:-9.81};
    const gravityVector=new THREE.Vector3(gravity.x,gravity.y,0);if(local)gravityVector.applyAxisAngle(new THREE.Vector3(0,0,1),-pose.angle);
    for(const p of e.particles){
      p.age+=step;p.velocity.addScaledVector(gravityVector,p.gravity*step);
      const age=clamp(p.age/p.life),force=rec(d.ForceModule),velocity=rec(d.VelocityModule);
      if(on(force.enabled)){const f=new THREE.Vector3(particleCurve(force.x,age,p.seed),particleCurve(force.y,age,p.seed),particleCurve(force.z,age,p.seed));f.applyAxisAngle(new THREE.Vector3(0,0,1),local?(on(force.inWorldSpace)?-pose.angle:0):(on(force.inWorldSpace)?0:pose.angle));p.velocity.addScaledVector(f,step);}
      const v=p.velocity.clone();if(on(velocity.enabled))v.add(new THREE.Vector3(particleCurve(velocity.x,age,p.seed),particleCurve(velocity.y,age,p.seed),particleCurve(velocity.z,age,p.seed)).applyAxisAngle(new THREE.Vector3(0,0,1),local?(on(velocity.inWorldSpace)?-pose.angle:0):(on(velocity.inWorldSpace)?0:pose.angle)));
      p.position.addScaledVector(v,step);
    }
    e.particles=e.particles.filter(p=>p.age<p.life);this.draw(e,pose,local);
  }
  private emit(e:ParticleEmitter,pose:ParticlePose,phase:number,local:boolean,emitterVelocity:THREE.Vector3):void {
    const d=e.component.data,initial=rec(d.InitialModule),seed=this.random(),shape=rec(d.ShapeModule);
    const position=new THREE.Vector3(),direction=new THREE.Vector3(0,0,1);
    if(on(shape.enabled)){
      const type=num(shape.type),radius=num(rec(shape.radius).value,1),theta=this.random()*num(rec(shape.arc).value,360)*Math.PI/180;
      const thickness=num(shape.radiusThickness,1),r=radius*Math.sqrt(mix((1-thickness)**2,1,this.random()));
      if([10,11].includes(type)){position.set(Math.cos(theta)*r,Math.sin(theta)*r,0);direction.set(Math.cos(theta),Math.sin(theta),0);}
      else if([0,1,2,3].includes(type)){const z=type<2?this.random()*2-1:this.random(),a=this.random()*Math.PI*2;direction.set(Math.sqrt(1-z*z)*Math.cos(a),Math.sqrt(1-z*z)*Math.sin(a),z);position.copy(direction).multiplyScalar(radius*Math.cbrt(mix((1-thickness)**3,1,this.random())));}
      else if([5,15,16,18].includes(type)){position.set(this.random()-.5,this.random()-.5,type===18?0:this.random()-.5);}
      else if([4,7,8,9].includes(type)){position.set(Math.cos(theta)*r,Math.sin(theta)*r,0);const angle=num(shape.angle,25)*Math.PI/180;direction.set(Math.cos(theta)*Math.sin(angle),Math.sin(theta)*Math.sin(angle),Math.cos(angle));if(type===8||type===9)position.addScaledVector(direction,this.random()*num(shape.length,5));}
      else if(type===12)position.x=(this.random()*2-1)*radius;
      const rotation=vec(shape.m_Rotation).multiplyScalar(Math.PI/180),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x,rotation.y,rotation.z));
      position.multiply(vec(shape.m_Scale,1)).applyQuaternion(q).add(vec(shape.m_Position));direction.applyQuaternion(q);
      const randomDirection=num(shape.randomDirectionAmount);if(randomDirection>0)direction.lerp(new THREE.Vector3(this.random()*2-1,this.random()*2-1,this.random()*2-1).normalize(),randomDirection).normalize();
    }
    position.x*=pose.scale.x;position.y*=pose.scale.y;
    const velocity=direction.multiplyScalar(e.overrides.speed??particleCurve(initial.startSpeed,phase,this.random()));
    if(!local){position.applyAxisAngle(new THREE.Vector3(0,0,1),pose.angle).add(pose.position);velocity.applyAxisAngle(new THREE.Vector3(0,0,1),pose.angle);}
    const inherit=rec(d.InheritVelocityModule);if(!local&&on(inherit.enabled))velocity.addScaledVector(emitterVelocity,particleCurve(inherit.m_Curve,0,this.random()));
    const size=particleCurve(initial.startSize,phase,this.random());
    e.particles.push({position,velocity,age:0,life:Math.max(0,particleCurve(initial.startLifetime,phase,this.random())),
      size:new THREE.Vector2(size,on(initial.size3D)?particleCurve(initial.startSizeY,phase,this.random()):size),rotation:particleCurve(initial.startRotation,phase,this.random()),
      color:e.overrides.color?{...e.overrides.color}:particleColor(initial.startColor,phase,this.random()),seed,gravity:particleCurve(initial.gravityModifier,phase,this.random())});
  }
  private draw(e:ParticleEmitter,pose:ParticlePose,local:boolean):void {
    const colors=e.mesh.geometry.getAttribute('particleColor') as THREE.InstancedBufferAttribute,d=e.component.data;
    const size=rec(d.SizeModule),colorModule=rec(d.ColorModule),rotation=rec(d.RotationModule),sizeSpeed=rec(d.SizeBySpeedModule),rd=e.renderer.data;
    for(const [i,p]of e.particles.entries()){
      const age=clamp(p.age/p.life),pos=p.position.clone();if(local)pos.applyAxisAngle(new THREE.Vector3(0,0,1),pose.angle).add(pose.position);
      let sx=p.size.x*Math.abs(pose.scale.x),sy=p.size.y*Math.abs(pose.scale.y),angle=-p.rotation;
      if(on(size.enabled)){sx*=particleCurve(size.curve,age,p.seed);sy*=particleCurve(on(size.separateAxes)?size.y:size.curve,age,p.seed);}
      if(on(sizeSpeed.enabled)){const range=rec(sizeSpeed.range),t=clamp((p.velocity.length()-num(range.x))/(num(range.y,1)-num(range.x)||1));sx*=particleCurve(sizeSpeed.curve,t,p.seed);sy*=particleCurve(on(sizeSpeed.separateAxes)?sizeSpeed.y:sizeSpeed.curve,t,p.seed);}
      if(on(rotation.enabled))angle-=particleCurve(rotation.curve??rotation.z,age,p.seed)*p.age;
      if(num(rd.m_RenderAlignment)===2)angle+=pose.angle;
      if(num(rd.m_RenderMode)===1){sy=Math.max(sy,sy*num(rd.m_LengthScale,2)+p.velocity.length()*num(rd.m_VelocityScale));angle=Math.atan2(p.velocity.y,p.velocity.x)-Math.PI/2;}
      const pivot=rec(rd.m_Pivot);pos.x-=num(pivot.x)*sx;pos.y-=num(pivot.y)*sy;
      this.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),angle);this.matrix.compose(pos,this.quaternion,new THREE.Vector3(sx,sy,1));e.mesh.setMatrixAt(i,this.matrix);
      const c=on(colorModule.enabled)?particleColor(colorModule.gradient,age,p.seed):{r:1,g:1,b:1,a:1};
      const convert=this.options.projectLinear!==false&&on(rd.m_ApplyActiveColorSpace)?linear:(x:number)=>x;
      colors.setXYZW(i,convert(p.color.r*c.r),convert(p.color.g*c.g),convert(p.color.b*c.b),p.color.a*c.a);
    }
    e.mesh.count=e.particles.length;e.mesh.instanceMatrix.needsUpdate=true;colors.needsUpdate=true;
  }
  dispose():void {for(const entity of [...this.emitters.keys()])this.remove(entity);for(const texture of this.textures.values())texture.dispose();this.textures.clear();}
}

function sourceShaderHasExtraModes(key:string):boolean {
  const source=manifest.materials[key];return source.keywords.includes('_COLOR')||source.keywords.includes('_FADING_ON')||source.keywords.includes('_ALPHAPREMULTIPLY_ON')||source.keywords.includes('_ALPHAMODULATE_ON')||num(source.floats._DistortionEnabled)>0||num(source.floats._LightingEnabled)>0;
}
