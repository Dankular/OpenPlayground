import {describe,it,expect} from 'vitest';
import {Simulation} from '../src/simulation';
import {PhysicalSystem} from '../src/systems/physical-world';
import {getHeatCapacity} from '../src/systems/physical';
import {WireSystem,type WireEndpoint} from '../src/systems/wires';

describe('frozen native mass across physical adapters',()=>{
  it('keeps runtime mass for thermal capacity and cable strength while Planck mass is zero',()=>{
    const sim=new Simulation(),a=sim.spawn('box',0,5),b=sim.spawn('box',2,5);
    for(const e of [a,b])e.parts[0].metadata={nodeId:'body',components:[{type:'MonoBehaviour',className:'PhysicalBehaviour',pathId:'physical',data:{}},{type:'Rigidbody2D',pathId:'body',data:{m_Mass:80}}]};
    a.parts[0].body.setMassData({mass:160,center:{x:.1,y:0},I:32});
    const physical=new PhysicalSystem();physical.attach(a);physical.attach(b);
    const endpoint=(e:typeof a):WireEndpoint=>({entity:e,part:e.parts[0],anchor:{x:0,y:0}}),wires=new WireSystem(sim.world,physical);
    const originalCapacity=getHeatCapacity(physical.get(a.parts[0])!),strength=wires.connect('copper',endpoint(a),endpoint(b)).breakForce;
    sim.freeze(a);expect(a.parts[0].body.getMass()).toBe(0);physical.beforeStep(.02);
    expect(physical.get(a.parts[0])!.mass).toBe(160);expect(getHeatCapacity(physical.get(a.parts[0])!)).toBe(originalCapacity);
    expect(wires.connect('copper',endpoint(a),endpoint(b)).breakForce).toBe(strength);
    sim.freeze(a);expect(a.parts[0].body.getMass()).toBe(160);
  });
});
