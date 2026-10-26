import { describe,expect,it } from 'vitest';
import { existsSync,readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import { colliderShapes,polygonPieces } from '../src/geometry';
import type { AssetLibrary,Prefab } from '../src/prefabs';
import { Transform,Vec2 } from 'planck';

describe('collider geometry',()=>{
  it('triangulates a concave outline without filling its notch',()=>{
    const path=[{x:0,y:0},{x:3,y:0},{x:3,y:1},{x:1,y:1},{x:1,y:3},{x:0,y:3}];
    const pieces=polygonPieces(path);const area=pieces.reduce((sum,[a,b,c])=>sum+Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2,0);expect(area).toBeCloseTo(5);
    const shapes=colliderShapes({type:'polygon',offset:{x:0,y:0},paths:[path]});
    expect(shapes.some(s=>s.testPoint(new Transform(),Vec2(2,2)))).toBe(false);expect(shapes.some(s=>s.testPoint(new Transform(),Vec2(.5,2)))).toBe(true);
  });
  it('adapts the serialized vertical capsule direction and rounded box skin',()=>{
    const capsule=colliderShapes({type:'capsule',direction:0,size:{x:.2,y:1},offset:{x:0,y:0}});
    expect(capsule.some(s=>s.testPoint(new Transform(),Vec2(0,.49)))).toBe(true);expect(capsule.some(s=>s.testPoint(new Transform(),Vec2(.2,0)))).toBe(false);
    expect(colliderShapes({type:'box',size:{x:.2,y:.2},edgeRadius:.1,offset:{x:0,y:0}})[0].getRadius()).toBe(.1);
  });
});

describe.skipIf(!existsSync('public/local-assets/prefabs.json'))('complete extracted catalogue',()=>{
  const load=()=>{
    const prefabs=(JSON.parse(readFileSync('public/local-assets/prefabs.json','utf8')) as {prefabs:Prefab[]}).prefabs;
    return {buildId:'fixture-build',catalog:JSON.parse(readFileSync('public/local-assets/catalog.json','utf8')),prefabs:new Map(prefabs.map(p=>[p.catalogId,p]))} as AssetLibrary;
  };
  it('spawns every original prefab with source body/renderer/joint identities and finite physics',()=>{
    const assets=load();expect(assets.prefabs.size).toBe(284);
    for(const prefab of assets.prefabs.values()){
      const sim=new Simulation(null,assets);const e=sim.spawnPrefab(prefab.catalogId,0,8);
      expect(e.parts.length,prefab.name).toBe(prefab.parts.length);expect(e.renderers?.length,prefab.name).toBe(prefab.renderers.length);
      expect(e.parts.map(p=>p.id),prefab.name).toEqual(prefab.parts.map(p=>p.id));
      expect(e.joints.length,prefab.name).toBe(prefab.joints.filter(j=>j.enabled!==false).length);
      expect(e.parts.every((p,i)=>p.metadata?.nodeId===prefab.parts[i].nodeId),prefab.name).toBe(true);
      expect(e.unsupported?.filter(s=>s.startsWith('Collider')||s.startsWith('Joint')),prefab.name).toEqual([]);
      for(let i=0;i<15;i++)sim.step();
      expect(e.parts.every(p=>Number.isFinite(p.body.getPosition().x)&&Number.isFinite(p.body.getPosition().y)&&Number.isFinite(p.body.getAngle())),prefab.name).toBe(true);
      sim.clear();expect(sim.world.getJointCount(),prefab.name).toBe(0);
    }
  },30000);
  it('round trips source prefab identities and refuses wrong builds without mutating existing scenes',()=>{
    const assets=load();const human=assets.catalog.items.find(i=>i.name==='Human')!;
    const sim=new Simulation(null,assets);sim.spawnPrefab(human.id,2,3);for(let i=0;i<5;i++)sim.step();
    const scene=sim.serialize();const restored=new Simulation(null,assets);restored.import(scene);
    expect(restored.entities[0].catalogId).toBe(human.id);expect(restored.entities[0].parts.map(p=>p.id)).toEqual(sim.entities[0].parts.map(p=>p.id));
    scene.buildId='wrong-build';expect(()=>sim.import(scene)).toThrow('game build');expect(sim.entities).toHaveLength(1);
    scene.buildId=assets.buildId;scene.entities[0].parts[0].id='incorrect';expect(()=>sim.import(scene)).toThrow('body identifiers');expect(sim.entities).toHaveLength(1);
  });
});
