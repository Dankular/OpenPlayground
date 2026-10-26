import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {Simulation,type Part} from '../src/simulation';
import type {Prefab} from '../src/prefabs';
import {PhysicalSystem} from '../src/systems/physical-world';
import {RagdollSystem} from '../src/systems/ragdoll';
import {LiquidEffects} from '../src/systems/liquid-effects';
import {LiquidSystem} from '../src/systems/liquids';
import {SyringeContactSystem} from '../src/systems/syringe-contact';

describe.skipIf(!existsSync('public/local-assets/prefabs/20244.json'))('extracted syringe end-to-end simulation',()=>{
  it('revives an injured native Human through an actual needle collision and reservoir transfer',()=>{
    const sim=new Simulation();sim.world.setGravity({x:0,y:0});
    const physical=new PhysicalSystem(),ragdolls=new RagdollSystem({random:()=>.9,getPhysical:p=>physical.get(p as Part)});
    const effects=new LiquidEffects(ragdolls,{random:()=>.9,getPhysical:p=>physical.get(p as Part)});
    const liquids=new LiquidSystem({effects,getBlood:p=>ragdolls.limbFor(p)?.blood,setBlood:(p,n)=>{const limb=ragdolls.limbFor(p);if(limb)limb.blood=n;}});
    ragdolls.externalLiquidTransport=true;ragdolls.getTotalLiquid=p=>liquids.get(p as Part)?.total;
    const contacts=new SyringeContactSystem(sim,{isSyringe:p=>!!liquids.getSyringe(p),onLodged:(p,t)=>{liquids.lodged(p,t);},onDislodged:(p,t)=>liquids.dislodged(p,t)});
    sim.onSpawn.push(e=>physical.attach(e),e=>ragdolls.attach(e),e=>liquids.attach(e),e=>contacts.attach(e));
    sim.beforeStep.push(dt=>contacts.beforeStep(dt),dt=>ragdolls.update(dt),dt=>liquids.beforeStep(dt));
    sim.afterStep.push(dt=>contacts.afterStep(dt),dt=>ragdolls.afterStep(dt));
    const load=(id:string)=>JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8')) as Prefab;
    const human=sim.spawnPrefab('20217',0,5,load('20217'));sim.freeze(human);
    const head=human.parts.find(p=>p.label==='Head')!,limb=ragdolls.limbFor(head)!;
    ragdolls.damage(head,limb.health+1);expect(limb.person.brainDead).toBe(true);
    const at=head.body.getPosition(),syringe=sim.spawnPrefab('20244',at.x-.7,at.y,load('20244'));
    syringe.parts[0].body.setLinearVelocity({x:8,y:0});
    for(let i=0;i<25&&liquids.get(head)!.getAmount('LIFE SERUM')===0;i++)sim.step();
    expect(contacts.get(syringe.parts[0])?.victim).toBe(head);
    expect(liquids.get(head)!.getAmount('LIFE SERUM')).toBeGreaterThan(0);
    expect(limb.health).toBe(limb.initialHealth);expect(limb.person.brainDead).toBe(false);
  });
});
