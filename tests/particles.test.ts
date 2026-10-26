import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {ParticleSystemView,particleCurve,particleColor,particleGradient,createNativeSpriteMaterial} from '../src/particles';
import type {Entity} from '../src/simulation';
import type {Prefab,SourceNode} from '../src/prefabs';

const source=JSON.parse(readFileSync('src/generated/projectiles.json','utf8')).prefabs['resource:sharedassets0.assets:5720'] as Prefab;
const constant=(scalar:number)=>({minMaxState:0,scalar});
function setup(){
  const entity:Entity={id:1,kind:'prefab',parts:[],joints:[],frozen:false,position:{x:0,y:0},angle:0,metadata:{nodes:structuredClone(source.nodes)}};
  const scene=new THREE.Scene(),view=new ParticleSystemView(scene,{random:()=>.5,loadTexture:()=>new THREE.Texture()});
  return {entity,scene,view};
}
function single(){const x=setup();x.entity.metadata!.nodes=x.entity.metadata!.nodes.filter(n=>n.name==='Flash');const n=x.entity.metadata!.nodes[0];
  const data=n.components.find(c=>c.type==='ParticleSystem')!.data; data.simulationSpeed=1;data.moveWithTransform=1;
  const initial=data.InitialModule as Record<string,unknown>;initial.startLifetime=constant(3);initial.startSpeed=constant(0);initial.startSize=constant(1);
  data.EmissionModule={enabled:true,rateOverTime:constant(10),rateOverDistance:constant(0),m_Bursts:[]};
  return {...x,node:n,data,initial};
}
describe('source Unity particle curves and gradients',()=>{
  it('evaluates constants, random constants and Hermite curves with source multiplier',()=>{
    expect(particleCurve(constant(7),.5)).toBe(7);
    expect(particleCurve({minMaxState:3,minScalar:2,scalar:6},0,.25)).toBe(3);
    const curve={m_Curve:[{time:0,value:0,inSlope:0,outSlope:0},{time:1,value:1,inSlope:0,outSlope:0}]};
    expect(particleCurve({minMaxState:1,scalar:2,maxCurve:curve},.5)).toBe(1);
    expect(particleCurve({minMaxState:2,scalar:2,maxCurve:curve,minCurve:{m_Curve:[{time:0,value:0,inSlope:0,outSlope:0}]}},.5,.5)).toBe(.5);
  });
  it('uses independent serialized color and alpha key times, including endpoints',()=>{
    const g={key0:{r:1,g:0,b:0,a:1},key1:{r:0,g:1,b:0,a:0},ctime0:0,ctime1:65535,atime0:0,atime1:32767,m_NumColorKeys:2,m_NumAlphaKeys:2};
    expect(particleGradient(g,.5).r).toBeCloseTo(.5);expect(particleGradient(g,.5).a).toBe(0);expect(particleGradient({...g,m_Mode:1},1).g).toBe(1);
    expect(particleColor({minMaxState:2,minColor:g.key0,maxColor:g.key1},0,.25)).toEqual({r:.75,g:.25,b:0,a:.75});
  });
});
describe('original particle emitter runtime',()=>{
  it('attaches all three native Ion Bolt emitters using the original HDParticle texture and additive blend',()=>{
    const x=setup();x.view.attach(x.entity);const emitters=x.view.emitters.get(x.entity)!;
    expect(emitters).toHaveLength(3);expect(emitters.map(e=>e.component.pathId)).toEqual(['15063','15472','15168']);
    const mat=emitters[1].mesh.material as THREE.ShaderMaterial;expect(mat.blendSrc).toBe(THREE.SrcAlphaFactor);expect(mat.blendDst).toBe(THREE.OneFactor);
    expect(mat.uniforms.mainTexture.value.colorSpace).toBe(THREE.SRGBColorSpace);expect(emitters[1].materialKey).toBe('globalgamemanagers.assets:7');
    expect([...x.view.unsupported]).toContain('emitter 15063: NoiseModule');
  });
  it('uses native rate-over-distance rather than inventing constant light particles',()=>{
    const x=setup();x.view.attach(x.entity);x.view.update(.01);expect(x.view.emitters.get(x.entity)!.every(e=>e.particles.length===0)).toBe(true);
    x.entity.position!.x=1;x.view.update(.01);const emitters=x.view.emitters.get(x.entity)!;
    expect(emitters.map(e=>e.particles.length)).toEqual([15,5,1]); // Native Flash maxNumParticles=5.
    expect(emitters[2].node.scale.x).toBe(15);
  });
  it('emits configured rate over time, expires particles, and obeys the original cap',()=>{
    const x=single();x.initial.maxNumParticles=2;x.view.attach(x.entity);x.view.update(.1);x.view.update(.1);x.view.update(.1);
    const e=x.view.emitters.get(x.entity)![0];expect(e.particles).toHaveLength(2);expect(e.mesh.count).toBe(2);
    x.view.stop(x.entity);x.view.update(3.1);expect(e.particles).toHaveLength(0);expect(e.mesh.count).toBe(0);
  });
  it('emits native zero-time bursts once per loop and honors probability',()=>{
    const x=single();x.data.lengthInSec=.5;x.data.EmissionModule={enabled:true,rateOverTime:constant(0),rateOverDistance:constant(0),m_Bursts:[{time:0,countCurve:constant(2),cycleCount:1,probability:1}]};
    x.view.attach(x.entity);x.view.update(.01);const e=x.view.emitters.get(x.entity)![0];expect(e.particles).toHaveLength(2);
    x.view.update(.01);expect(e.particles).toHaveLength(2);x.view.update(.5);expect(e.particles).toHaveLength(4);
  });
  it('keeps world-space particles behind while local particles follow the emitter',()=>{
    const world=single();world.view.attach(world.entity);world.view.update(.1);world.view.stop(world.entity);world.entity.position!.x=4;world.view.update(.01);
    const matrix=new THREE.Matrix4();world.view.emitters.get(world.entity)![0].mesh.getMatrixAt(0,matrix);expect(matrix.elements[12]).toBeCloseTo(0);
    const local=single();local.data.moveWithTransform=0;local.view.attach(local.entity);local.view.update(.1);local.view.stop(local.entity);local.entity.position!.x=4;local.view.update(.01);
    local.view.emitters.get(local.entity)![0].mesh.getMatrixAt(0,matrix);expect(matrix.elements[12]).toBeCloseTo(4);
  });
  it('applies the source gravity modifier and does not update inactive nodes',()=>{
    const x=single();x.initial.gravityModifier=constant(2);x.view.attach(x.entity);x.view.update(.1);const e=x.view.emitters.get(x.entity)![0];
    expect(e.particles[0].velocity.y).toBeCloseTo(-1.962);x.node.active=false;const time=e.time;x.view.update(1);expect(e.time).toBe(time);expect(e.mesh.visible).toBe(false);
  });
  it('disabled renderers hide particles while their simulation continues',()=>{
    const x=single();x.node.components.find(c=>c.type==='ParticleSystemRenderer')!.data.m_Enabled=false;x.view.attach(x.entity);x.view.update(.1);
    const e=x.view.emitters.get(x.entity)![0];expect(e.particles).toHaveLength(1);expect(e.mesh.visible).toBe(false);
  });
  it('lifetime size/color modules drive instanced native geometry without changing source data',()=>{
    const x=single(),before=structuredClone(x.entity.metadata!.nodes);x.view.attach(x.entity);x.view.update(.1);
    const e=x.view.emitters.get(x.entity)![0];expect(e.mesh.geometry.getAttribute('particleColor').itemSize).toBe(4);
    expect(x.entity.metadata!.nodes).toEqual(before);
  });
  it('spawns focused original emitter effects and removes source meshes on cleanup',()=>{
    const x=setup(),effect=x.view.spawnEffect({m_PathID:3745,m_FileID:0},'sharedassets0.assets',{x:2,y:3});
    expect(effect).not.toBeNull();expect(x.view.emitters.get(effect!)!.length).toBe(3);x.view.remove(effect!);expect(x.scene.children).toHaveLength(0);
    expect(x.view.spawnEffect({m_PathID:12345},'sharedassets0.assets',{x:0,y:0})).toBeNull();
  });
  it('emitter start delay postpones bursts and nonlooping systems stop emitting',()=>{
    const x=single();x.data.startDelay=constant(.2);x.data.looping=false;x.data.lengthInSec=.1;x.view.attach(x.entity);x.view.update(.1);
    const e=x.view.emitters.get(x.entity)![0];expect(e.particles).toHaveLength(0);x.view.update(.2);expect(e.particles).toHaveLength(1);expect(e.playing).toBe(false);
  });
  it('preserves the original additive sprite shader state instead of stale material blend properties',()=>{
    const mat=createNativeSpriteMaterial('sharedassets0.assets:18729',new THREE.Texture(),{r:1,g:.8,b:.7,a:.5})!;
    expect(mat).not.toBeNull();expect(mat.blendSrc).toBe(THREE.OneFactor);expect(mat.blendDst).toBe(THREE.OneFactor);expect(mat.depthWrite).toBe(false);
    expect(mat.uniforms.spriteColor.value.w).toBe(.5);expect(mat.uniforms.intensity.value).toBe(1);
    expect(createNativeSpriteMaterial('sharedassets0.assets:16691',new THREE.Texture())).toBeNull();
    expect(createNativeSpriteMaterial('sharedassets0.assets:17748',new THREE.Texture())).not.toBeNull();
  });
  it('sets absolute native emission values without mutating source and preserves particles when stopped',()=>{
    const x=single();x.initial.maxNumParticles=100;x.data.playOnAwake=false;const before=structuredClone(x.data);x.view.attach(x.entity);
    const ref={m_PathID:x.node.components.find(c=>c.type==='ParticleSystem')!.pathId},tint={r:.2,g:.4,b:.6,a:.5};
    expect(x.view.setEmitter(x.entity,ref,{playing:true,rate:20,speed:5,color:tint})).toBe(true);x.view.update(.1);
    const e=x.view.emitters.get(x.entity)![0];expect(e.particles).toHaveLength(2);expect(e.particles[0].velocity.length()).toBe(5);expect(e.particles[0].color).toEqual(tint);
    expect(x.view.setEmitter(x.entity,ref,{playing:false})).toBe(true);x.view.update(.1);expect(e.particles).toHaveLength(2);
    expect(x.data).toEqual(before);expect(x.view.setEmitter(x.entity,ref,{rate:NaN})).toBe(false);
  });
});
