import {describe,it,expect} from 'vitest';
import {Simulation,type Entity} from '../src/simulation';
import {PhysicalSystem} from '../src/systems/physical-world';
import {ShrapnelSystem} from '../src/systems/shrapnel';

function layer(entity:Entity,index:number){entity.parts[0].metadata={nodeId:'body',components:[{type:'MonoBehaviour',className:'PhysicalBehaviour',pathId:'physical',data:{BulletPenetration:0}}]};entity.metadata={nodes:[{id:'body',name:'body',parentId:null,position:{x:0,y:0},angle:0,scale:{x:1,y:1},layer:index,active:true,components:[]}]};}
describe('recovered global shrapnel emitter',()=>{
  it('delays native cartridge emission until end of frame then fixed update and obeys source layers',()=>{
    const sim=new Simulation(),physical=new PhysicalSystem(),ignored=sim.spawn('box',-1,5),target=sim.spawn('box',-3,5);layer(ignored,0);layer(target,9);physical.attach(ignored);physical.attach(target);
    const hits:Entity[]=[],system=new ShrapnelSystem(sim,physical,{random:()=>.5,onHit:hit=>{if(!hit.exit)hits.push(hit.part.body.getUserData() as Entity);}});system.attach(ignored);system.attach(target);
    system.emit({x:0,y:5.45},2);system.beforeStep(.02);expect(hits).toHaveLength(0);
    system.afterFrame();system.beforeStep(.02);expect(hits).toEqual([target,target]);
    expect(system.ballistics.options).toMatchObject({maxBallisticsIterations:16,maxTotalDistance:30,ricochetChanceMultiplier:4,renderTracers:false,layersToHit:10752});
  });
  it('does not lose globally emitted fragments when the exploding source entity is removed',()=>{
    const sim=new Simulation(),physical=new PhysicalSystem(),source=sim.spawn('box',0,5),target=sim.spawn('box',-3,5);layer(target,9);physical.attach(target);let hits=0;
    const system=new ShrapnelSystem(sim,physical,{random:()=>.5,onHit:()=>hits++});system.attach(source);system.attach(target);
    system.emit({x:0,y:5.45},1);system.remove(source);sim.remove(source);system.afterFrame();system.beforeStep(.02);
    expect(hits).toBeGreaterThan(0);
  });
});
