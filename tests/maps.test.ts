import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {normalizeMap,mapSettings} from '../src/maps';
import {Simulation} from '../src/simulation';
import type {AssetLibrary,Prefab} from '../src/prefabs';

describe.skipIf(!existsSync('public/local-assets/maps.json'))('original environment geometry',()=>{
  const load=()=>{
    const index=JSON.parse(readFileSync('public/local-assets/maps.json','utf8')) as {maps:{id:string;name:string;staticColliders:number}[]};
    const prefabs=new Map(index.maps.map(m=>[m.id,normalizeMap(JSON.parse(readFileSync(`public/local-assets/maps/${m.id}.json`,'utf8')) as Prefab)]));
    return {index,assets:{buildId:'map-fixture',catalog:{items:[],categories:[]},prefabs} as AssetLibrary};
  };
  it('instantiates all15 maps and their original static trigger geometry without a fallback floor',()=>{
    const {index,assets}=load();expect(index.maps).toHaveLength(15);
    for(const entry of index.maps){
      const prefab=assets.prefabs.get(entry.id)!,sim=new Simulation(null,assets),environment=sim.setEnvironment(prefab);
      expect(environment.isEnvironment,entry.name).toBe(true);expect(sim.entities,entry.name).toHaveLength(0);expect(sim.renderEntities,entry.name).toHaveLength(1);
      expect(environment.parts.length,entry.name).toBe(prefab.parts.length);expect(new Set(environment.parts.map(p=>p.id)).size,entry.name).toBe(prefab.parts.length);
      expect(sim.ground.getFixtureList()!.isSensor(),entry.name).toBe(true);
      const triggerParts=environment.parts.filter(p=>p.id?.startsWith('static:'));const expectedNodes=(prefab.nodes as (typeof prefab.nodes[number]&{staticColliders?:unknown[]})[]).filter(n=>n.staticColliders?.length);
      expect(triggerParts.length,entry.name).toBe(expectedNodes.length);expect(environment.unsupported?.filter(s=>s.startsWith('Collider')||s.startsWith('Joint')),entry.name).toEqual([]);
      for(let i=0;i<4;i++)sim.step();expect(environment.parts.every(p=>Number.isFinite(p.body.getPosition().x)&&Number.isFinite(p.body.getPosition().y)),entry.name).toBe(true);
      sim.remove(environment);expect(sim.world.getBodyCount(),entry.name).toBe(1);expect(sim.world.getJointCount(),entry.name).toBe(0);
    }
  },30000);
  it('uses the Default floor and lets objects fall in the original Void',()=>{
    const {assets}=load(),sim=new Simulation(null,assets);sim.setEnvironment(assets.prefabs.get('20047')!);
    const crate=sim.spawn('box',10,4);for(let i=0;i<250;i++)sim.step();expect(crate.parts[0].body.getPosition().y).toBeGreaterThan(.4);expect(crate.parts[0].body.getPosition().y).toBeLessThan(.6);
    sim.clear();expect(sim.environment).not.toBeNull();sim.setEnvironment(assets.prefabs.get('20059')!);
    const falling=sim.spawn('box',10,4);for(let i=0;i<120;i++)sim.step();expect(falling.parts[0].body.getPosition().y).toBeLessThan(-10);
  });
  it('round trips the source map and large Humongous coordinates with scene state',()=>{
    const {assets}=load(),sim=new Simulation(null,assets);sim.setEnvironment(assets.prefabs.get('20048')!);sim.spawn('ball',0,2);
    const data=sim.serialize(),restored=new Simulation(null,assets);restored.import(data);
    expect(restored.environment?.catalogId).toBe('20048');expect(restored.entities).toHaveLength(1);expect(restored.environment?.parts.map(p=>p.id)).toEqual(sim.environment?.parts.map(p=>p.id));
    expect(mapSettings(assets.prefabs.get('20047')!)).toMatchObject({gravity:-9.8100004196167,ambientTemperature:20});
  });
});
