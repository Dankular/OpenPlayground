import {describe,it,expect} from 'vitest';
import {Simulation} from '../src/simulation';
import {VisualTransforms} from '../src/visual-transforms';
import {registerProjectilePrefabs} from '../src/systems/projectiles';
import type {AssetLibrary} from '../src/prefabs';

describe('source visual transform animation',()=>{
  it('unfolds native Javelin fin sprites and offsets from initially zero scale',()=>{
    const library={buildId:'test',catalog:{items:[],categories:[]},prefabs:new Map()} as AssetLibrary;registerProjectilePrefabs(library);
    const sim=new Simulation(null,library),entity=sim.spawnPrefab('resource:sharedassets0.assets:5317',0,3),other=sim.spawnPrefab('resource:sharedassets0.assets:5317',4,3),visuals=new VisualTransforms();
    const fins=entity.renderers!.filter(r=>['17998','17997'].includes(r.id));expect(fins.every(r=>r.sprite.height===0)).toBe(true);
    visuals.setScale(entity,{m_FileID:0,m_PathID:10009},{x:1,y:.5});
    expect(fins[0].sprite.height).toBeCloseTo(2/35);expect(fins[0].position.y).toBeCloseTo(.092);expect(fins[1].position.y).toBeCloseTo(-.092);expect(fins[1].sprite.flipY).toBe(true);
    visuals.setScale(entity,{m_FileID:0,m_PathID:10009},{x:1,y:1});expect(fins[0].sprite.height).toBeCloseTo(4/35);expect(fins[0].position.y).toBeCloseTo(.184);
    expect(other.renderers!.filter(r=>['17998','17997'].includes(r.id)).every(r=>r.sprite.height===0)).toBe(true);expect(library.prefabs.get(entity.catalogId!)!.renderers.find(r=>r.id==='17998')!.sprite.height).toBe(0);
  });
});
