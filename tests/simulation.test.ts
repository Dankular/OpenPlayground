import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/simulation';
import { existsSync, readFileSync } from 'node:fs';
import type { HumanRig } from '../src/assets';

describe('sandbox physics', () => {
  it('drops a box onto the floor without falling through', () => {
    const sim = new Simulation();
    const box = sim.spawn('box', 0, 4);
    for (let i=0;i<300;i++) sim.step();
    expect(box.parts[0].body.getPosition().y).toBeGreaterThan(.43);
    expect(box.parts[0].body.getPosition().y).toBeLessThan(.5);
  });
  it('creates an articulated human with bounded joints and finite physics', () => {
    const sim = new Simulation();
    const human=sim.spawn('human',0,3);
    expect(human.parts).toHaveLength(11);
    expect(human.joints).toHaveLength(10);
    for(let i=0;i<500;i++)sim.step();
    expect(human.parts.every(p=>Number.isFinite(p.body.getPosition().x)&&p.body.getPosition().y>-.4)).toBe(true);
  });
  it('pauses elapsed simulation and allows explicit stepping', () => {
    const sim=new Simulation();const box=sim.spawn('box',0,4);sim.paused=true;
    const y=box.parts[0].body.getPosition().y;sim.update(1);
    expect(box.parts[0].body.getPosition().y).toBe(y);
    sim.step();expect(box.parts[0].body.getPosition().y).toBeLessThan(y);
  });
  it('round trips jointed poses, velocity and frozen entities', () => {
    const sim=new Simulation();const human=sim.spawn('human',2,3);sim.rotate(human,.7);sim.spawn('ball',-2,3);const plank=sim.spawn('plank',4,5);sim.freeze(plank);
    for(let i=0;i<20;i++)sim.step();
    const data=sim.serialize();const restored=new Simulation();restored.import(JSON.parse(JSON.stringify(data)));
    const loaded=restored.serialize();
    data.entities.forEach((e,i)=>{expect(loaded.entities[i].kind).toBe(e.kind);expect(loaded.entities[i].frozen).toBe(e.frozen);e.parts.forEach((p,j)=>{for(const key of ['x','y','angle','vx','vy','av'] as const)expect(loaded.entities[i].parts[j][key]).toBeCloseTo(p[key],10);});});
    expect(restored.entities[0].joints).toHaveLength(10);
    for(let i=0;i<100;i++)restored.step();
    expect(restored.entities[2].parts[0].body.getPosition().y).toBe(data.entities[2].parts[0].y);
  });
  it('rejects malformed scenes without losing the existing scene', () => {
    const sim=new Simulation();sim.spawn('box',0,0);
    const data=sim.serialize();data.entities[0].parts[0].x=NaN;
    expect(()=>sim.import(data)).toThrow('Invalid scene coordinates');expect(sim.entities).toHaveLength(1);
    expect(()=>sim.import({format:'open-playground',version:1,entities:[{kind:'human',frozen:false,parts:[]}]})).toThrow('Invalid scene object');
  });
  it('destroys connected joints and active grab when an entity is removed', () => {
    const sim=new Simulation();const human=sim.spawn('human',0,0);sim.beginDrag(human.parts[0],0,1);expect(sim.drag).not.toBeNull();sim.remove(human);
    expect(sim.entities).toHaveLength(0);expect(sim.drag).toBeNull();expect(sim.world.getJointCount()).toBe(0);
  });
});

describe.skipIf(!existsSync('public/local-assets/human-rig.json'))('locally extracted rig',()=>{
  it('adapts the recovered14part human and13joints without losing finite poses',()=>{
    const rig=JSON.parse(readFileSync('public/local-assets/human-rig.json','utf8')) as HumanRig;
    const sim=new Simulation(rig);const human=sim.spawn('human',0,2);
    expect(human.parts).toHaveLength(14);expect(human.joints).toHaveLength(13);
    expect(human.parts.every(p=>p.sprite&&p.body.getMass()>0)).toBe(true);
    human.parts.forEach((part,i)=>{
      const source=rig.parts[i];expect(part.body.getPosition().x).toBeCloseTo(source.position.x,10);expect(part.body.getPosition().y).toBeCloseTo(source.position.y+2,10);
      expect(part.body.getMass()).toBeCloseTo(source.mass,10);expect(part.body.getLinearDamping()).toBe(source.linearDamping);expect(part.body.getGravityScale()).toBe(source.gravityScale);
      expect(part.sprite?.url).toBe(source.sprite?.url);
      const box=source.colliders[0];if(box.type==='box'&&box.size){expect(part.body.getFixtureList()!.testPoint(part.body.getWorldPoint({x:box.offset.x+box.size.x*.49,y:box.offset.y}))).toBe(true);expect(part.body.getFixtureList()!.testPoint(part.body.getWorldPoint({x:box.offset.x+box.size.x*.6,y:box.offset.y}))).toBe(false);}
    });
    for(let i=0;i<300;i++)sim.step();
    expect(human.parts.every(p=>Number.isFinite(p.body.getPosition().x)&&p.body.getPosition().y>-.4&&Math.abs(p.body.getPosition().x)<10)).toBe(true);
    const data=sim.serialize();const restored=new Simulation(rig);restored.import(data);
    expect(restored.entities[0].parts).toHaveLength(14);expect(restored.entities[0].joints).toHaveLength(13);
    expect(()=>new Simulation().import(data)).toThrow('needs local game assets');
  });
  it('uses already-scaled collider coordinates and preserves gravity scale and trigger state',()=>{
    const rig=JSON.parse(readFileSync('public/local-assets/human-rig.json','utf8')) as HumanRig;
    rig.parts[0].scale={x:2,y:3};rig.parts[0].gravityScale=0;rig.parts[0].colliders[0].isTrigger=true;
    const sim=new Simulation(rig);const head=sim.spawn('human',0,4).parts[0];
    const box=rig.parts[0].colliders[0];const fixture=head.body.getFixtureList()!;
    expect(fixture.isSensor()).toBe(true);expect(head.body.getGravityScale()).toBe(0);
    expect(fixture.testPoint(head.body.getWorldPoint({x:box.offset.x+box.size!.x*.6,y:box.offset.y}))).toBe(false);
  });
});
