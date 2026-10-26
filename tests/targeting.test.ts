import {describe,it,expect} from 'vitest';
import {Simulation,type Part} from '../src/simulation';
import {PhysicalSystem} from '../src/systems/physical-world';
import {DeviceSystem} from '../src/systems/devices';

describe('native rigidbody broadcast targeting',()=>{
  it('activates descendants of the connected body while leaving siblings alone',()=>{
    const sim=new Simulation(),entity=sim.spawn('box',0,5);
    const component=(id:string)=>({pathId:id,type:'MonoBehaviour',className:'GeneratorBehaviour',data:{}});
    const make=(id:string):Part=>({body:sim.world.createDynamicBody(),id,width:.2,height:.2,shape:'box',color:'white',label:id,metadata:{nodeId:id,components:[component(id)]}});
    const root=entity.parts[0];root.metadata={nodeId:'root',components:[]};
    const a=make('a'),child=make('child'),b=make('b');entity.parts.push(a,child,b);
    entity.metadata={nodes:[['root',null],['a','root'],['child','a'],['b','root']].map(([id,parentId])=>({id:id!,parentId,name:id!,position:{x:0,y:0},angle:0,scale:{x:1,y:1},active:true,components:[]}))};
    const physical=new PhysicalSystem(),devices=new DeviceSystem(physical);devices.attach(entity);
    devices.use(entity,0,a);
    expect(devices.get(entity).map(s=>s.active)).toEqual([true,true,false]);
    devices.use(entity,0,root);
    expect(devices.get(entity).map(s=>s.active)).toEqual([false,false,true]);
  });
});
