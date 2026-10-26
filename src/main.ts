import './style.css';
import './catalog.css';
import './connections.css';
import { CATALOG, CONFIG, type ItemKind } from './config';
import { Simulation, type Entity, type Part } from './simulation';
import { SandboxRenderer } from './renderer';
import { loadHumanRig } from './assets';
import { loadAssetLibrary } from './prefabs';
import { PhysicalSystem } from './systems/physical-world';
import {getCharge} from './systems/physical';
import { DeviceSystem } from './systems/devices';
import { RagdollSystem } from './systems/ragdoll';
import { WeaponSystem } from './systems/weapons';
import { registerSystemState,registerConnectionState } from './state';
import { GameAudio,loadAudioIndex,resolveAudioReference } from './systems/audio';
import { loadMapLibrary,mapSettings } from './maps';
import { BodyShaderLibrary } from './shaders/body';
import { EnvironmentSystem } from './systems/environment';
import { LiquidSystem,PressureDirection } from './systems/liquids';
import { LiquidEffects } from './systems/liquid-effects';
import { SyringeContactSystem } from './systems/syringe-contact';
import { SyringeBreakSystem } from './systems/syringe-break';
import { DefibrillatorSystem } from './systems/defibrillator';
import { MachinerySystem } from './systems/machinery';
import {WireSystem,type Wire,type WireEndpoint,type WireKind} from './systems/wires';
import {CONNECTION_TOOLS} from './wire-view';
import {MechanismSystem} from './systems/mechanisms';
import {VehicleSystem,generatedVehicleJointIds} from './systems/vehicles';
import {targetsPart,fixtureLayer} from './systems/targeting';
import {LiquidDeviceSystem} from './systems/liquid-devices';
import {ProjectileSystem,registerProjectilePrefabs} from './systems/projectiles';
import {ExplosionSystem} from './systems/explosions';
import {ShrapnelSystem} from './systems/shrapnel';
import {VisualTransforms} from './visual-transforms';
import {ParticleSystemView} from './particles';
import {PowderWorld} from './powder/world';
import {PowderUI} from './powder/powder-ui';

const icons: Record<string, string> = {
 human: '<circle cx="24" cy="9" r="5"/><path d="M19 17h10l2 15h-6v14h-4V32h-6z"/><path d="m17 19-5 15m19-15 5 15"/>',
 box: '<path d="M7 8h34v34H7zM7 8l34 34M41 8 7 42M7 15h34M7 35h34"/>',
 ball: '<circle cx="24" cy="25" r="17"/><path d="M14 18c2-4 4-5 8-6"/>',
 plank: '<path d="m4 22 38-8 3 11-38 8zM10 27l28-6"/>',
};
const svg = (name: string) => `<svg viewBox="0 0 48 50" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header class="topbar"><a class="brand" href="./"><span class="brand-mark">o<span>p</span></span><span>OPEN PLAYGROUND<small>PHYSICS SANDBOX · BROWSER EDITION</small></span></a><span class="project-label"><i></i> Untitled experiment</span><div class="header-actions"><button id="import" title="Import scene">↥ <span>Open</span></button><button id="export" title="Export scene">↧ <span>Save scene</span></button><button id="help" aria-label="Keyboard shortcuts">?</button></div></header>
<main><aside class="sidebar"><div class="library-heading"><span>OBJECT LIBRARY</span><span class="count">04</span></div><div class="search-wrap"><span>⌕</span><input id="search" placeholder="Find an object…" aria-label="Search object library"><kbd>/</kbd></div><div class="categories"><button class="active" data-category="All">All objects</button><button data-category="Living">Living</button><button data-category="Objects">Objects</button></div><div id="catalog"></div><div class="library-note"><span class="note-icon">↖</span><p>Pick an object.<br><strong>Click anywhere to place it.</strong></p></div><div class="sidebar-bottom"><span class="green-dot"></span> LOCAL EXPERIMENT<span>v0.1</span></div></aside>
<section class="workspace"><div class="workspace-top"><div><span class="map-label">ENVIRONMENT</span><strong>The chamber <span>↗</span></strong></div><div class="engine-label"><span class="green-dot"></span> THREE.JS + 2D PHYSICS</div></div><div id="viewport" tabindex="0" aria-label="Physics sandbox. Select an object in the library, then click to place it."><div class="scene-watermark">OPEN<br>PLAYGROUND<span>MAKE SOMETHING HAPPEN.</span></div><div class="view-badge">SIDE VIEW <span>01</span></div><div class="scene-tools"><button id="home" title="Reset camera (Home)">⌖</button><button id="zoom-in" title="Zoom in">+</button><button id="zoom-out" title="Zoom out">−</button></div><div class="empty-hint" id="placement-hint">Select an object to start your experiment <span>←</span></div><div id="selection" class="selection-panel" hidden></div><div class="viewport-status"><span><i></i> <span id="state-label">SIMULATION RUNNING</span></span><span id="object-count">0 OBJECTS</span><span id="fps">60 FPS</span></div></div><div class="transport"><div class="transport-left"><button id="pause" class="play-button" title="Pause / resume (Space)">Ⅱ</button><button id="step" title="Advance one frame (.)">▸│</button><span class="divider"></span><label for="speed">TIME SCALE</label><select id="speed" aria-label="Time scale"><option value="0.2">0.2×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div><div class="transport-center"><span class="keycap">LMB</span> interact <span class="keycap">RMB</span> pan <span class="keycap">SCROLL</span> zoom</div><button id="clear" class="clear-button" title="Clear scene">⌫ <span>Clear scene</span></button></div></section></main>
<div id="toast" role="status"></div><input id="scene-file" type="file" accept=".json,application/json" hidden>
<dialog id="help-dialog"><button id="close-help" aria-label="Close shortcuts">×</button><span class="eyebrow">A LITTLE GUIDANCE</span><h2>Your experiment. Your rules.</h2><p>Choose an object, then click the chamber to place it. Choose the hand tool to grab and throw objects.</p><dl><dt>1–4</dt><dd>Select an object</dd><dt>Escape / V</dt><dd>Hand tool</dd><dt>Space</dt><dd>Pause / resume</dd><dt>.</dt><dd>Step one frame</dd><dt>F</dt><dd>Freeze / unfreeze selection</dd><dt>Q / E</dt><dd>Rotate selection</dd><dt>Delete</dt><dd>Delete selected object</dd><dt>Right / middle drag</dt><dd>Pan camera</dd><dt>Home</dt><dd>Reset camera</dd></dl><p class="help-footnote">Scenes are saved as OpenPlayground JSON.</p></dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const [rig,library,audioIndex,bodyShaders] = await Promise.all([loadHumanRig(),loadAssetLibrary(),loadAudioIndex(),BodyShaderLibrary.load()]);
if(library)registerProjectilePrefabs(library);
const audio=new GameAudio(audioIndex);let audioUnlocked=false;
const unlockAudio=()=>{audioUnlocked=true;audio.unlock();};
document.addEventListener('pointerdown',unlockAudio,{capture:true});document.addEventListener('keydown',unlockAudio,{capture:true});
const muteButton=document.createElement('button');muteButton.id='mute';muteButton.title='Mute sound';muteButton.setAttribute('aria-label','Mute sound');muteButton.textContent='♫';muteButton.onclick=()=>{audio.volume=audio.volume?0:1;if(!audio.volume)audio.stop();muteButton.textContent=audio.volume?'♫':'♩';muteButton.title=audio.volume?'Mute sound':'Unmute sound';muteButton.setAttribute('aria-label',muteButton.title);};$('.header-actions').prepend(muteButton);
const sim = new Simulation(rig,library);
const visualTransforms=new VisualTransforms();
function audioPointer(component:import('./prefabs').SourceComponent,clip:string){return Object.values(component.data).find(value=>{const ref=value as {m_FileID?:unknown;m_PathID?:unknown}|null;return ref&&ref.m_FileID===0&&Number.isSafeInteger(ref.m_PathID)&&String(ref.m_PathID)===clip;});}
const physical=new PhysicalSystem();
sim.onSpawn.push(e=>physical.attach(e));sim.onRemove.push(e=>physical.remove(e));sim.beforeStep.push(dt=>physical.beforeStep(dt));sim.afterStep.push(dt=>physical.afterStep(dt));
const machinery=new MachinerySystem(physical);sim.onSpawn.push(e=>machinery.attach(e));sim.onRemove.push(e=>machinery.remove(e));sim.beforeStep.push(()=>machinery.beforeStep());
const disabled=(entity:Entity,component:import('./prefabs').SourceComponent)=>machinery.isDisabled(entity,component);
const devices=new DeviceSystem(physical,{setRendererEnabled:(entity,id,enabled)=>view.setRendererEnabled(entity,id,enabled),isDisabled:disabled});
sim.onSpawn.push(e=>devices.attach(e));sim.onRemove.push(e=>devices.remove(e));sim.beforeStep.push(dt=>devices.beforeStep(dt));
const ragdolls=new RagdollSystem({getPhysical:part=>physical.get(part as Part)});
const liquidEffects=new LiquidEffects(ragdolls,{getPhysical:part=>physical.get(part as Part),onExplosion:(part,parameters)=>explosions.explode({Position:part.body.getPosition(),FragmentationRayCount:parameters.fragments,Range:parameters.range,FragmentForce:parameters.force,CreateParticlesAndSound:true,EffectSize:parameters.big?2:0,DismemberChance:parameters.chance})});
const liquids=new LiquidSystem({effects:liquidEffects,getBlood:part=>ragdolls.limbFor(part)?.blood,setBlood:(part,amount)=>{const limb=ragdolls.limbFor(part);if(limb)limb.blood=amount;}});
ragdolls.externalLiquidTransport=true;ragdolls.getTotalLiquid=part=>liquids.get(part as Part)?.total;
const mechanisms=new MechanismSystem(physical,{isDisabled:disabled,isDestroyed:part=>{const entity=part.body.getUserData() as Entity;return machinery.get(entity).some(s=>s.part===part&&s.destroyed);},setRendererEnabled:(entity,id,enabled)=>view.setRendererEnabled(entity,id,enabled),onJointReplaced:(_state,previous,replacement)=>sim.replaceJointReference(previous,replacement)});
sim.onSpawn.push(e=>mechanisms.attach(e));sim.onRemove.push(e=>mechanisms.remove(e));sim.beforeStep.push(dt=>mechanisms.beforeStep(dt));
const environment=new EnvironmentSystem(sim.world,{getPhysical:part=>physical.get(part),ragdolls,onSettings:settings=>{physical.ambientTemperature=settings.ambientTemperature;}});
const vehicles=new VehicleSystem({getPhysical:part=>physical.get(part),isUnderWater:part=>environment.stateFor(part)?.underwater??false,setJointBreakForce:(joint,force)=>{sim.setJointBreakForce(joint,force);},fixtureLayer,physicalBody:body=>{const entity=body.getUserData() as Entity|undefined,part=entity?.parts.find(p=>p.body===body);return !!part&&!!physical.get(part);},onTankShot:shot=>{projectiles.launch(shot);},onPulse:(point,force,range)=>explosions.pulse(point,force,range,false)});
sim.generatedJointIds=generatedVehicleJointIds;sim.onSpawn.push(e=>vehicles.attach(e));sim.onRemove.push(e=>vehicles.remove(e));sim.beforeStep.push(dt=>vehicles.update(dt));sim.afterStep.push(dt=>vehicles.afterStep(dt));
sim.onSpawn.push(e=>environment.attach(e),e=>ragdolls.attach(e),e=>liquids.attach(e));sim.onRemove.push(e=>environment.remove(e),e=>liquidEffects.remove(e),e=>liquids.remove(e),e=>ragdolls.remove(e));sim.beforeStep.push(dt=>environment.beforeStep(dt),dt=>liquids.beforeStep(dt),dt=>ragdolls.update(dt));sim.afterStep.push(dt=>ragdolls.afterStep(dt));
const needles=new SyringeContactSystem(sim,{isSyringe:part=>!!liquids.getSyringe(part),onLodged:(syringe,victim)=>{liquids.lodged(syringe,victim);},onDislodged:(syringe,victim)=>liquids.dislodged(syringe,victim)});
sim.onSpawn.push(e=>needles.attach(e));sim.onRemove.unshift(e=>needles.remove(e));sim.beforeStep.push(dt=>needles.beforeStep(dt));sim.afterStep.push(dt=>needles.afterStep(dt));
const syringeBreaks=new SyringeBreakSystem(sim,liquids,ragdolls);
sim.onRemove.push(e=>syringeBreaks.remove(e));sim.beforeStep.push(dt=>syringeBreaks.beforeStep(dt));sim.afterStep.push(()=>syringeBreaks.afterStep());
const defibrillators=new DefibrillatorSystem(physical,ragdolls,{isDisabled:disabled,playClip:(component,pointer,part)=>{if(audioUnlocked)audio.play(pointer,component.file??'sharedassets0.assets',{position:part.body.getPosition()});},clipDuration:(component,pointer)=>audio.index?resolveAudioReference(audio.index,component.file??'sharedassets0.assets',pointer)?.duration??1:1});
sim.onSpawn.push(e=>defibrillators.attach(e));sim.onRemove.push(e=>defibrillators.remove(e));sim.beforeStep.push(dt=>defibrillators.beforeStep(dt));
const liquidDevices=new LiquidDeviceSystem(liquids,physical,{isDisabled:disabled,isDestroyed:part=>machinery.get(part.body.getUserData() as Entity).some(s=>s.part===part&&s.destroyed),setRendererEnabled:(e,id,enabled)=>view.setRendererEnabled(e,id,enabled),isBeingUsedContinuously:part=>(heldReceivers.get(part)?.until??-1)>=continuousTime,onSound:(state,clip,volume)=>{if(audioUnlocked)audio.play(audioPointer(state.component,clip),state.component.file??'sharedassets0.assets',{position:state.part.body.getPosition(),volume});},audioDuration:(entity,clip)=>{const component=entity.metadata?.nodes.flatMap(n=>n.components).find(c=>audioPointer(c,clip));return audio.index&&component?resolveAudioReference(audio.index,component.file??'sharedassets0.assets',audioPointer(component,clip))?.duration:undefined;}});
sim.onSpawn.push(e=>liquidDevices.attach(e));sim.onRemove.unshift(e=>liquidDevices.remove(e));sim.beforeStep.push(dt=>{updateLiquidParticles();liquidDevices.beforeStep(dt);});
const powder=new PowderWorld({seed:Date.now()&0xffff});
const explosions=new ExplosionSystem(sim,ragdolls,{fixtureLayer,isUnderWater:point=>environment.isPointUnderWater(point),onFragment:(part,force)=>{machinery.fragment(part,force);syringeBreaks.fragment(part);weapons.fragmentHit(part);},onSlice:part=>{ragdolls.slice(part);machinery.slice(part);},onBreak:part=>{machinery.break(part);syringeBreaks.break(part);},onEffect:parameters=>{view.addExplosion(parameters.Position,parameters.Range);powder.injectPressure(parameters.Position.x,parameters.Position.y,parameters.Range*.6,Math.min(80,parameters.Range*14));},onShrapnel:(point,count)=>shrapnel.emit(point,count)});
const weapons=new WeaponSystem(sim,physical,{isDisabled:disabled,onHit:hit=>{ragdolls.shot(hit.part,{damage:hit.damage,point:hit.point,normal:hit.normal,exit:hit.exit});if(!hit.exit){machinery.shot(hit.part,hit.damage);vehicles.shot(hit.part,hit.damage);}liquidDevices.shot(hit.part,hit);projectiles.shot(hit.part,hit.damage);syringeBreaks.shot(hit.part,hit.exit);},onFragment:(part,force)=>{machinery.fragment(part,force);syringeBreaks.fragment(part);},onFragmentation:parameters=>explosions.explode(parameters),onSlice:part=>{ragdolls.slice(part);machinery.slice(part);},onTrace:trace=>view.addTracer(trace),onExplosion:(position,range)=>view.addExplosion(position,range),onShot:(e,c,first)=>{if(audioUnlocked)audio.firearm(e,c,first);}});
sim.onSpawn.push(e=>weapons.attach(e));sim.onRemove.push(e=>weapons.remove(e));sim.beforeStep.push(dt=>weapons.beforeStep(dt));
const shrapnel=new ShrapnelSystem(sim,physical,{onHit:hit=>{ragdolls.shot(hit.part,{damage:hit.damage,point:hit.point,normal:hit.normal,exit:hit.exit});weapons.receiveShot(hit.part,hit.exit);if(!hit.exit){machinery.shot(hit.part,hit.damage);vehicles.shot(hit.part,hit.damage);}liquidDevices.shot(hit.part,hit);projectiles.shot(hit.part,hit.damage);syringeBreaks.shot(hit.part,hit.exit);}});
sim.onSpawn.push(e=>shrapnel.attach(e));sim.onRemove.push(e=>shrapnel.remove(e));sim.beforeStep.push(dt=>shrapnel.beforeStep(dt));
const projectiles=new ProjectileSystem(sim,{spawnResource:(prefab,position,angle)=>sim.spawnResourcePrefab(prefab,position,angle),getPhysical:part=>physical.get(part),fixtureLayer,isUnderWater:point=>environment.isPointUnderWater(point),onExplosion:parameters=>explosions.explode(parameters),onPulse:(point,force,range)=>explosions.pulse(point,force,range),onTransformScale:(entity,pointer,scale)=>visualTransforms.setScale(entity,pointer,scale),onEffect:(pointer,position,kind)=>{if(kind==='launch'||kind==='missile-takeoff'){if(audioUnlocked)audio.play(pointer,'sharedassets0.assets',{position});}else particles.spawnEffect(pointer,'sharedassets0.assets',position);},onMessage:(part,message,value)=>{if(message==='Break'){machinery.break(part);syringeBreaks.break(part);return;}if(message==='StunImpact'){ragdolls.stunImpact(part);return;}const shot=value as {damage:number;point:{x:number;y:number};normal:{x:number;y:number}};ragdolls.shot(part,{...shot,exit:message==='ExitShot'});weapons.receiveShot(part,message==='ExitShot');syringeBreaks.shot(part,message==='ExitShot');liquidDevices.shot(part,shot);if(message==='Shot'){machinery.shot(part,shot.damage);vehicles.shot(part,shot.damage);}}});
sim.onSpawn.push(e=>projectiles.attach(e));sim.onRemove.unshift(e=>projectiles.remove(e));sim.beforeStep.push(dt=>projectiles.update(dt));sim.afterStep.push(dt=>projectiles.afterStep(dt));
const wires=new WireSystem(sim.world,physical,{getContainer:part=>liquids.get(part),getLimb:part=>ragdolls.limbFor(part),onUse:(entity,channel,continuous,part)=>dispatchUse(entity,channel,continuous,part),onBreak:wire=>{if(selectedWire?.id===wire.id)select(null);}});
let continuousTime=0;
const heldReceivers=new Map<Part,{entity:Entity;until:number}>();
let inputHeld:{entity:Entity;part:Part|undefined;channel:0|1|2}|null=null;
let continuousAccumulator=0;
sim.beforeStep.unshift(dt=>{continuousTime+=dt;for(const [part,held]of heldReceivers)if(held.until<continuousTime){weapons.setHeld(held.entity,false,part);projectiles.setHeld(held.entity,false,part);heldReceivers.delete(part);}wires.beforeStep(dt);});
sim.afterStep.push(dt=>wires.afterStep(dt));sim.onRemove.unshift(entity=>{wires.remove(entity);for(const part of entity.parts)heldReceivers.delete(part);if(inputHeld?.entity===entity)inputHeld=null;if(firstAnchor?.entity===entity)cancelConnection();});
sim.onNodeDestroy.push((_entity,_ids,parts)=>{wires.removeParts(parts);needles.removeParts(parts);for(const part of parts)heldReceivers.delete(part);if(firstAnchor?.part&&parts.includes(firstAnchor.part))cancelConnection();if(selectedPart&&parts.includes(selectedPart))select(null);});
registerSystemState(sim,physical,devices,ragdolls);sim.stateAdapters.set('weapons',{capture:e=>weapons.snapshot(e),restore:(e,value)=>weapons.restore(e,value)});
sim.stateAdapters.set('environment',{capture:e=>environment.snapshot(e),restore:(e,value)=>environment.restore(e,value)});
sim.stateAdapters.set('liquids',{capture:e=>liquids.snapshot(e),restore:(e,value)=>liquids.restore(e,value)});
sim.stateAdapters.set('defibrillator',{capture:e=>defibrillators.snapshot(e),restore:(e,value)=>defibrillators.restore(e,value)});
sim.stateAdapters.set('machinery',{capture:e=>machinery.snapshot(e),restore:(e,value)=>machinery.restore(e,value)});
sim.stateAdapters.set('mechanisms',{capture:e=>mechanisms.snapshot(e),restore:(e,value)=>mechanisms.restore(e,value)});
sim.stateAdapters.set('vehicles',{capture:e=>vehicles.snapshot(e),restore:(e,value)=>vehicles.restore(e,value)});
sim.stateAdapters.set('liquidDevices',{capture:e=>liquidDevices.snapshot(e),restore:(e,value)=>liquidDevices.restore(e,value)});
sim.stateAdapters.set('projectiles',{capture:e=>projectiles.snapshot(e),restore:(e,value)=>projectiles.restore(e,value)});
sim.sceneAdapters.set('syringeNeedles',{capture:entities=>needles.snapshot(entities),restore:(entities,value)=>needles.restore(entities,value)});
registerConnectionState(sim,wires);
sim.importTransactions.set('environment',{capture:()=>({...environment.settings}),rollback:value=>environment.applySettings(value as typeof environment.settings)});
const enteringContacts=new Set<import('planck').Contact>();
sim.world.on('begin-contact',contact=>enteringContacts.add(contact));sim.world.on('end-contact',contact=>enteringContacts.delete(contact));
sim.world.on('post-solve',(contact,impulse)=>{if(!enteringContacts.delete(contact))return;const amount=impulse.normalImpulses[0]??0;for(const body of [contact.getFixtureA().getBody(),contact.getFixtureB().getBody()]){const entity=body.getUserData() as Entity|undefined;const part=entity?.parts?.find(p=>p.body===body);if(part){ragdolls.impact(part,amount);if(audioUnlocked)audio.impact(part,amount);}}});
const view = new SandboxRenderer($('#viewport'),sim,bodyShaders);
const particles=new ParticleSystemView(view.scene,{gravity:()=>sim.world.getGravity()});sim.onSpawn.push(e=>particles.attach(e));sim.onRemove.unshift(e=>particles.remove(e));
// Powder-grid simulation (ported from The Powder Toy); disabled until the powder tool is first opened.
powder.enabled=false;
sim.beforeStep.push(dt=>{if(!powder.enabled)return;const gravity=sim.world.getGravity();powder.setGravity(gravity.x,gravity.y);powder.setAmbientCelsius(physical.ambientTemperature);powder.couple(sim.world,{physicalFor:body=>physical.getByBody(body)});powder.advance(dt);});
sim.sceneAdapters.set('powder',{capture:()=>powder.sim.numParts>0||powder.sim.bmap.some(w=>w)?powder.serialize():null,restore:(_entities,value)=>{const previous=powder.serialize(),wasEnabled=powder.enabled,undo=()=>{powder.deserialize(previous);powder.enabled=wasEnabled;};if(value===null){powder.clear();return undo;}if(!powder.deserialize(value))return false;powderUI.adopt();return undo;}});
function updateLiquidParticles(){
  for(const entity of sim.renderEntities)for(const state of liquidDevices.get(entity)){
    if(!['LiquidOutletBehaviour','LiquidContainerHoleBehaviour'].includes(state.kind))continue;
    const data=state.component.data,pointer=data.WaterPuffParticles,id=String((pointer as {m_PathID?:unknown}|undefined)?.m_PathID??'');
    const node=entity.metadata?.nodes.find(n=>n.components.some(c=>c.pathId===id)),part=entity.parts.find(p=>p.id===node?.bodyId)??state.part,sourceNode=entity.metadata?.nodes.find(n=>n.id===part.metadata?.nodeId),angle=part.body.getAngle()-(sourceNode?.angle??0),dx=(node?.position.x??sourceNode?.position.x??0)-(sourceNode?.position.x??0),dy=(node?.position.y??sourceNode?.position.y??0)-(sourceNode?.position.y??0),origin=part.body.getPosition();
    const physicalPart=physical.get(part),underwater=environment.isPointUnderWater({x:origin.x+dx*Math.cos(angle)-dy*Math.sin(angle),y:origin.y+dx*Math.sin(angle)+dy*Math.cos(angle)}),outlet=state.kind==='LiquidOutletBehaviour',drain=outlet?.1:Number(data.DrainRate??.1),flow=state.container.total>drain&&part.body.isActive(),color=state.container.computedColor,speed=outlet?(physicalPart?getCharge(physicalPart):0)*.4+2:state.container.measuredPressure*Number(data.ForceMultiplier??.001)+.5;
    particles.setEmitter(entity,data.LiquidParticles,{playing:!underwater,rate:flow?(outlet?120:16):0,speed,color});
    particles.setEmitter(entity,pointer,{playing:underwater,rate:flow?1:0,distanceRate:flow?3:0,color});
  }
}
view.physicalState=part=>physical.get(part)?.state;
view.skinFor=part=>ragdolls.skinFor(part);view.skinTime=()=>ragdolls.time;
view.syringeFor=part=>{const syringe=liquids.getSyringe(part);return syringe?{color:syringe.container.computedColor,scaledAmount:syringe.container.scaledAmount,pressureMode:syringe.container.pressureMode}:undefined;};
view.connections.wires=()=>wires.wires.values();
view.rendererDisabled=(entity,renderer)=>{const component=entity.metadata?.nodes.find(n=>n.id===renderer.nodeId)?.components.find(c=>c.pathId===renderer.id);return !!renderer.nodeId&&machinery.nodeDisabled(entity,renderer.nodeId)||!!component&&machinery.isDisabled(entity,component);};
const maps=await loadMapLibrary(library);
let currentMapId:string|null=null;
function resetCameraForMap(){
  const prefab=currentMapId?library?.prefabs.get(currentMapId):undefined;
  const bounds=prefab?mapSettings(prefab).bounds:undefined,ext=bounds?.m_Extent;
  if(ext&&bounds?.m_Center&&Math.max(ext.x,ext.y)<100){view.center.set(bounds.m_Center.x,bounds.m_Center.y);view.viewHeight=Math.max(ext.y*2.2,ext.x*2.2*$('#viewport').clientHeight/Math.max(1,$('#viewport').clientWidth));view.resize();}else view.home();
}
function applyMapSettings(){
  const prefab=sim.environment?.catalogId?library?.prefabs.get(sim.environment.catalogId):undefined;
  if(prefab){currentMapId=prefab.catalogId;}else{currentMapId=null;environment.applySettings({ambientTemperature:18,gravity:CONFIG.gravity});}
  const select=document.querySelector<HTMLSelectElement>('#map-select');if(select)select.value=currentMapId??'';
}
if(maps){
  const select=document.createElement('select');select.id='map-select';select.setAttribute('aria-label','Environment');const legacy=document.createElement('option');legacy.value='';legacy.textContent='The chamber';legacy.hidden=true;select.append(legacy);
  for(const entry of maps.maps){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;select.append(option);}
  $('.workspace-top strong').replaceWith(select);
  select.onchange=async()=>{const id=select.value;select.disabled=true;const generation=++sceneGeneration;try{const prefab=await maps.load(id);if(generation!==sceneGeneration)return;sim.setEnvironment(prefab);sim.clear();view.clearEffects();audio.stop();applyMapSettings();resetCameraForMap();selectEntity(null);toast(`${prefab.name} loaded`);}catch(error){select.value=currentMapId??'';toast(error instanceof Error?error.message:'Could not load environment');}finally{select.disabled=false;}};
}
const items=library?library.catalog.items.map(item=>({id:item.id,name:item.name,sortName:item.order||item.name,description:item.description,category:library.catalog.categories.find(c=>c.id===item.categoryId)?.name??'Other',color:'#c4ceb9',shortcut:'',sprite:item.sprite,visible:item.visible,locked:item.locked,kind:null as ItemKind|null})):CATALOG.map(item=>({...item,id:item.kind,sortName:item.name,sprite:null,visible:true,locked:false,kind:item.kind as ItemKind|null}));
const itemName=(e:Entity)=>e.name??CATALOG.find(c=>c.kind===e.kind)?.name??'Object';
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
$('.count').textContent=String(items.filter(i=>i.visible).length)+'/'+items.length;
$('.categories').innerHTML=['All',...(library?library.catalog.categories.map(c=>c.name):new Set(items.map(i=>i.category)))].map(name=>`<button class="${name==='All'?'active':''}" data-category="${escape(name)}">${name==='All'?'All objects':escape(name)}</button>`).join('');
let selectedKind: string | null = null;
let selected: Entity | null = null;
let selectedPart:Part|null=null;
let selectedWire:Wire|null=null;
let interactionTool:'interact'|'connect'|'remove-wire'='interact';
let connectionKind:WireKind='activation',connectionChannel:0|1|2=0;
let firstAnchor:WireEndpoint|null=null,wireDragging=false,wireDown={x:0,y:0},wirePointer={x:0,y:0};
let category='All';
let showAll=false;
if(library){const filter=document.createElement('label');filter.className='show-all';filter.innerHTML='<input type="checkbox" id="show-all-objects"> Show all objects';$('.categories').after(filter);$('#show-all-objects').onchange=()=>{showAll=$<HTMLInputElement>('#show-all-objects').checked;const chosen=items.find(i=>i.id===selectedKind);if(!showAll&&chosen&&(!chosen.visible||chosen.locked))choose(null);else renderCatalog();};}
let pointerMode: 'pan' | 'drag' | 'wire' | 'powder' | null = null;
let lastPointer = {x:0,y:0};
let toastTimer: ReturnType<typeof setTimeout>;
let sceneGeneration=0;
const connectionBar=document.createElement('div');connectionBar.className='workspace-tools';connectionBar.innerHTML='<button id="interact-tool" data-icon="↖" class="active" title="Interact (V)">↖ Interact</button><button id="connect-tool" data-icon="⌁" title="Connect objects (W)">⌁ Connect</button><button id="remove-wire-tool" data-icon="×" title="Remove connections (X)">× Links</button>';
$('.workspace-top').insertBefore(connectionBar,$('.engine-label'));
const powderUI=new PowderUI({viewport:$('#viewport'),toolbar:connectionBar,world:powder,scene:view.scene,cameraCenter:()=>({x:view.center.x,y:view.center.y}),toast:message=>toast(message),onActivate:()=>choose(null)});
const connectionPanel=document.createElement('aside');connectionPanel.id='connection-panel';connectionPanel.className='connection-panel';connectionPanel.hidden=true;
connectionPanel.innerHTML=`<span class="eyebrow">CONNECTION TOOL</span><label for="connection-kind">Connection</label><select id="connection-kind">${CONNECTION_TOOLS.map(tool=>`<option value="${tool.kind}">${tool.name}</option>`).join('')}</select><label for="connection-channel" id="connection-channel-label">Activation channel</label><select id="connection-channel"><option value="0">0 · Green</option><option value="1">1 · Red</option><option value="2">2 · Blue</option></select><p id="connection-description"></p><span id="connection-status">Choose the source object.</span><button id="cancel-connection" disabled>Cancel first anchor <kbd>Esc</kbd></button><small>Click two points or drag between them.</small>`;
$('#viewport').append(connectionPanel);$<HTMLSelectElement>('#connection-kind').value=connectionKind;
const breakableLabel=document.createElement('label');breakableLabel.id='connection-breakable-label';breakableLabel.className='connection-breakable';breakableLabel.innerHTML='<input type="checkbox" id="connection-breakable"> Breakable activation wire';$('#connection-channel').after(breakableLabel);
$('#interact-tool').onclick=()=>choose(null);$('#connect-tool').onclick=()=>setInteractionTool('connect');$('#remove-wire-tool').onclick=()=>setInteractionTool('remove-wire');
$('#connection-kind').onchange=()=>{connectionKind=$<HTMLSelectElement>('#connection-kind').value as WireKind;cancelConnection();updateConnectionTools();};
$('#connection-channel').onchange=()=>{connectionChannel=Number($<HTMLSelectElement>('#connection-channel').value) as 0|1|2;};
$('#cancel-connection').onclick=()=>cancelConnection();
const connectionCount=document.createElement('span');connectionCount.id='connection-count';$('#fps').before(connectionCount);
function toast(message: string) { $('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000); }
function endpointPoint(endpoint:WireEndpoint){return endpoint.part?endpoint.part.body.getWorldPoint(endpoint.anchor):endpoint.anchor;}
function endpointAt(point:{x:number;y:number}):WireEndpoint{const picked=sim.pick(point.x,point.y),part=picked&&fixtureLayer(picked.body.getFixtureList()!)!==11?picked:null;return part?{part,entity:part.body.getUserData() as Entity,anchor:part.body.getLocalPoint(point)}:{part:null,entity:null,anchor:{...point}};}
function endpointName(endpoint:WireEndpoint){return endpoint.entity?`${itemName(endpoint.entity)} / ${endpoint.part!.label}`:'World anchor';}
function cancelConnection(){firstAnchor=null;wireDragging=false;view.connections.preview=null;updateConnectionTools();}
function updateConnectionTools(){
  const panel=document.querySelector<HTMLElement>('#connection-panel');if(!panel)return;
  panel.hidden=interactionTool!=='connect';$('#interact-tool').classList.toggle('active',interactionTool==='interact');$('#connect-tool').classList.toggle('active',interactionTool==='connect');$('#remove-wire-tool').classList.toggle('active',interactionTool==='remove-wire');
  const activation=connectionKind==='activation';$('#connection-channel-label').hidden=!activation;$('#connection-channel').hidden=!activation;
  $('#connection-breakable-label').hidden=!activation;
  $('#connection-description').textContent=CONNECTION_TOOLS.find(tool=>tool.kind===connectionKind)!.description;
  $('#connection-status').textContent=firstAnchor?`${endpointName(firstAnchor)} → choose ${activation?'receiver':'second anchor'}.`:activation?'Choose the source object.':connectionKind==='blood'?'Choose the first liquid container.':'Choose the first anchor.';
  $<HTMLButtonElement>('#cancel-connection').disabled=!firstAnchor;
  $('#viewport').classList.toggle('connecting',interactionTool==='connect');$('#viewport').classList.toggle('removing-links',interactionTool==='remove-wire');
  if(interactionTool!=='interact')$('#placement-hint').textContent=interactionTool==='remove-wire'?'Click a connection to remove it.':'Connect two points · Esc cancels · V returns to interact';
}
function setInteractionTool(tool:'interact'|'connect'|'remove-wire'){
  powderUI.setActive(false);sim.endDrag();pointerMode=null;selectedKind=null;interactionTool=tool;select(null);cancelConnection();renderCatalog();$('#viewport').classList.remove('placing');updateConnectionTools();
}
function finishConnection(point:{x:number;y:number}){
  if(!firstAnchor)return;const start=firstAnchor,end=endpointAt(point);
  try{const wire=wires.connect(connectionKind,start,end,{channel:connectionChannel,breakable:connectionKind==='activation'&&$<HTMLInputElement>('#connection-breakable').checked});cancelConnection();selectConnection(wire);toast(`${CONNECTION_TOOLS.find(tool=>tool.kind===wire.kind)!.name} connected`);}catch(error){cancelConnection();toast(error instanceof Error?error.message:'Could not connect these points');}
}
function selectConnection(wire:Wire){
  select(null);selectedWire=wire;view.connections.selectedId=wire.id;const panel=$('#selection');panel.hidden=false;
  panel.innerHTML=`<span class="eyebrow">SELECTED CONNECTION</span><strong>${CONNECTION_TOOLS.find(tool=>tool.kind===wire.kind)!.name}</strong><span class="selection-state">${wire.length.toFixed(2)} m · ${Number.isFinite(wire.breakForce)?`${Math.round(wire.breakForce)} N`:'Unbreakable'}</span><p class="wire-endpoints">${escape(endpointName(wire.a))}<span>${wire.kind==='activation'?'→':'↔'}</span>${escape(endpointName(wire.b))}</p>${wire.kind==='activation'?`<label class="wire-channel-label" for="selected-connection-channel">Activation channel</label><select id="selected-connection-channel"><option value="0">0 · Green</option><option value="1">1 · Red</option><option value="2">2 · Blue</option></select><button id="reverse-connection">Reverse direction</button>`:''}<button id="delete-connection" class="danger">Remove connection <kbd>Del</kbd></button>`;
  if(wire.kind==='activation'){$<HTMLSelectElement>('#selected-connection-channel').value=String(wire.channel);$('#selected-connection-channel').onchange=()=>wire.channel=Number($<HTMLSelectElement>('#selected-connection-channel').value) as 0|1|2;$('#reverse-connection').onclick=()=>{const reversed=wires.connect(wire.kind,wire.b,wire.a,{length:wire.length,channel:wire.channel,breakForce:wire.breakForce});wires.disconnect(wire);selectConnection(reversed);};}
  $('#delete-connection').onclick=()=>{wires.disconnect(wire);select(null);};
}
function renderCatalog() {
  const query=$<HTMLInputElement>('#search').value.toLowerCase();
  const visible=items.filter(c=>(showAll||c.visible)&&(category==='All'||c.category===category) && `${c.name} ${c.description}`.toLowerCase().includes(query)).sort((a,b)=>a.sortName.localeCompare(b.sortName));
  $('.count').textContent=String(items.filter(i=>showAll||i.visible).length)+'/'+items.length;
  $('#catalog').innerHTML=`<button class="hand-tool ${selectedKind===null?'active':''}" id="hand-tool"><span>↖</span><div>Interact<small>Grab, move & select</small></div><kbd>V</kbd></button><div class="catalog-divider">${category==='All'?'AVAILABLE OBJECTS':escape(category.toUpperCase())} · ${visible.length}</div>${visible.map(c=>`<button class="object-card ${selectedKind===c.id?'selected':''}" data-kind="${escape(c.id)}" ${c.locked&&!showAll?'disabled':''} title="${escape(c.locked&&!showAll?'Locked object':c.description)}"><div class="object-preview" style="color:${c.color}">${c.sprite?`<img src="${escape(`${import.meta.env.BASE_URL}${c.sprite.url.replace(/^\//,'')}`)}" alt="" loading="lazy">`:c.kind?svg(c.kind):''}${c.shortcut?`<kbd>${c.shortcut}</kbd>`:''}</div><div class="object-info"><strong>${escape(c.name)}</strong><span>${c.locked&&!showAll?'Locked':escape(c.category)}</span></div></button>`).join('')}${!visible.length?'<p class="no-results">No objects found.</p>':''}`;
  $('#hand-tool').classList.toggle('active',selectedKind===null&&interactionTool==='interact');$('#hand-tool').onclick=()=>choose(null);
  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.onclick=()=>choose(b.dataset.kind!));
}
function choose(kind: string|null) {
  const item=items.find(i=>i.id===kind);if(item&&!showAll&&(!item.visible||item.locked))return;
  powderUI.setActive(false);
  selectedKind=kind;renderCatalog();
  interactionTool='interact';cancelConnection();updateConnectionTools();
  $('#viewport').classList.toggle('placing',!!kind);
  $('#placement-hint').textContent=kind?`Click to place ${items.find(c=>c.id===kind)!.name.toLowerCase()} · Esc for hand tool`:sim.entities.length?'Drag an object to move it':'Select an object to start your experiment ←';
  if(kind&&library?.loadPrefab)library.loadPrefab(kind).catch(error=>toast(error instanceof Error?error.message:'Could not load object'));
}
function select(entity: Entity|null,part?:Part) {const nextPart=part??entity?.parts[0]??null;if(selected&&(selected!==entity||selectedPart!==nextPart)){weapons.setHeld(selected,false,selectedPart??undefined);projectiles.setHeld(selected,false,selectedPart??undefined);inputHeld=null;}selected=entity;selectedPart=nextPart;selectedWire=null;view.connections.selectedId=null;renderSelection(); }
const selectEntity=select;
function dispatchUse(entity:Entity,channel:0|1|2=0,continuous=false,part?:Part){
  if(continuous){if(part){heldReceivers.set(part,{entity,until:continuousTime+.06});weapons.setHeld(entity,true,part);projectiles.setHeld(entity,true,part);}mechanisms.use(entity,channel,true,part);vehicles.use(entity,channel,true,part);liquidDevices.use(entity,channel,true,part);projectiles.use(entity,channel,true,part);return;}
  devices.use(entity,channel,part);weapons.use(entity,part);defibrillators.use(entity,part);liquids.use(entity,channel,part);mechanisms.use(entity,channel,false,part);vehicles.use(entity,channel,false,part);liquidDevices.use(entity,channel,false,part);projectiles.use(entity,channel,false,part);
}
function useEntity(entity:Entity,channel:0|1|2=0,continuous=false,part:Part|undefined=selected===entity?selectedPart??undefined:undefined){dispatchUse(entity,channel,continuous,part);wires.activate(entity,channel,continuous,part);if(selected===entity&&!continuous)renderSelection();}
function liquidReadout(entity:Entity){
  const mixture=new Map<string,number>();for(const part of entity.parts)for(const [id,value]of liquids.get(part)?.distribution??[])mixture.set(id,(mixture.get(id)??0)+value.amount);
  return [...mixture].filter(([,amount])=>amount>1e-6).map(([id,amount])=>`${id.toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase())}: ${(amount*500/1.4).toFixed(1)} mL`).join(' · ')||'Empty';
}
function renderSelection() {
  const panel=$('#selection');panel.hidden=!selected;
  if (!selected) return;
  const states=selected.parts.map(p=>physical.get(p)).filter(p=>p!==undefined);
  panel.innerHTML=`<span class="eyebrow">SELECTED OBJECT</span><strong>${escape(itemName(selected))}</strong><span class="selection-state">${selected.frozen?'Frozen':'Dynamic'} · ${selected.parts.length} ${selected.parts.length===1?'body':'bodies'}</span><div><button id="freeze">${selected.frozen?'Unfreeze':'Freeze'} <kbd>F</kbd></button><button id="rotate">Rotate <kbd>E</kbd></button><button id="delete" class="danger">Delete <kbd>Del</kbd></button></div>${states.length?`<section class="physical-controls"><span id="physical-readout"></span><label>Temperature °C<input id="set-temperature" type="number" min="-273.15" max="1000000000" value="${Math.round(states.reduce((a,s)=>a+s.state.temperature,0)/states.length)}"></label><label>Charge<input id="set-charge" type="number" min="0" value="${Math.round(states.reduce((a,s)=>a+s.state.charge,0)/states.length)}"></label><div><button id="ignite">Ignite</button><button id="extinguish">Extinguish</button></div></section>`:''}`;
  $('#freeze').onclick=()=>{sim.freeze(selected!);renderSelection();};
  $('#rotate').onclick=()=>sim.rotate(selected!,Math.PI/12);
  $('#delete').onclick=()=>{sim.remove(selected!);select(null);};
  if(selectedPart&&selected.parts.length>1)panel.querySelector('.selection-state')!.textContent+=' · '+selectedPart.label;
  if(states.length){$('#set-temperature').onchange=()=>physical.setTemperature(selected!,Number($<HTMLInputElement>('#set-temperature').value));$('#set-charge').onchange=()=>physical.setCharge(selected!,Number($<HTMLInputElement>('#set-charge').value));$('#ignite').onclick=()=>physical.ignite(selected!,true);$('#extinguish').onclick=()=>physical.extinguish(selected!);}
  const connectedUse=[...wires.wires.values()].some(w=>w.kind==='activation'&&w.a.entity===selected&&w.a.part&&targetsPart(selected!,w.a.part,selectedPart??undefined));
  if(devices.get(selected).some(s=>targetsPart(selected!,s.part,selectedPart??undefined))||weapons.canUse(selected)||defibrillators.get(selected).some(s=>targetsPart(selected!,s.part,selectedPart??undefined))||liquids.canUse(selected,selectedPart??undefined)||mechanisms.canUse(selected,selectedPart??undefined)||vehicles.canUse(selected,selectedPart??undefined)||liquidDevices.canUse(selected,selectedPart??undefined)||projectiles.canUse(selected,selectedPart??undefined)||connectedUse){const button=document.createElement('button');button.id='activate';button.className='use-button';button.textContent='Use / activate (T)';button.onclick=()=>useEntity(selected!);panel.querySelector('div')!.prepend(button);}
  const syringes=liquids.syringesFor(selected);
  if(syringes.length){
    const syringe=syringes[0],controls=document.createElement('section');controls.className='syringe-controls';
    controls.innerHTML=`<label for="syringe-mode">Syringe mode</label><select id="syringe-mode" ${syringe.finite?'':'disabled'}><option value="0">Inject</option><option value="1">Extract</option><option value="2">Idle</option></select><label class="source-toggle"><input id="syringe-infinite" type="checkbox" ${syringe.finite?'':'checked'} ${syringe.canToggleInfinite?'':'disabled'}> Infinite source</label><span id="syringe-readout"></span><span id="needle-readout"></span><p>${syringe.finite?'Quickly insert the needle tip into a limb. Pull it back to remove.':'Infinite sources keep injecting. Disable infinite source to extract fluid.'}</p>`;
    panel.querySelector('.selection-state')!.after(controls);$<HTMLSelectElement>('#syringe-mode').value=String(syringe.container.pressureMode);
    $('#syringe-mode').onchange=()=>liquids.setMode(selected!,Number($<HTMLSelectElement>('#syringe-mode').value) as PressureDirection);
    $('#syringe-infinite').onchange=()=>{liquids.setFinite(selected!,$<HTMLInputElement>('#syringe-infinite').checked===false);renderSelection();};
  }
  if(selected.parts.some(p=>liquids.get(p))){const readout=document.createElement('section');readout.className='liquid-readout';readout.id='liquid-readout';readout.textContent=liquidReadout(selected);panel.append(readout);}
  if(defibrillators.canUse(selected)){const status=document.createElement('span');status.className='selection-state';status.id='defibrillator-readout';panel.append(status);}
  if(machinery.get(selected).some(m=>m.canRepair)){const button=document.createElement('button');button.id='repair';button.textContent='Repair machinery';button.onclick=()=>{machinery.repair(selected!);renderSelection();};panel.append(button);}
  const mechanismStates=mechanisms.get(selected).filter(s=>s.kind!=='GearBehaviour');
  if(mechanismStates.length){
    const controls=document.createElement('section');controls.className='mechanism-controls';const readout=document.createElement('span');readout.className='controller-status';readout.id='mechanism-readout';controls.append(readout);
    for(const state of mechanismStates){
      const button=document.createElement('button');button.textContent=state.kind==='PistonBehaviour'?'Toggle piston':'Toggle servo';button.onclick=()=>useEntity(state.entity,0,false,state.part);controls.append(button);
      if(state.kind==='MotorisedHingeBehaviour'){
        for(const [name,label,value,step]of [['angle','Servo target (degrees)',state.delta,15],['speed','Servo speed',state.speed,.1]] as const){
          const field=document.createElement('label'),input=document.createElement('input');field.textContent=label;input.type='number';input.value=String(value);input.step=String(step);input.id=name==='angle'?'servo-angle':'servo-speed';if(name==='speed'){input.min='0';input.max='10';}
          input.onchange=()=>name==='angle'?mechanisms.setServoDelta(state.entity,Number(input.value),state.part):mechanisms.setServoSpeed(state.entity,Number(input.value),state.part);field.append(input);controls.append(field);
        }
      }
    }panel.append(controls);
  }
  const vehicleStates=vehicles.get(selected);
  if(vehicleStates.length){
    const controls=document.createElement('section');controls.className='vehicle-controls';const readout=document.createElement('span');readout.className='controller-status';readout.id='vehicle-readout';controls.append(readout);
    for(const state of vehicleStates){const button=document.createElement('button');button.textContent=state.kind==='TankBarrelBehaviour'?'Fire barrel':'Toggle engine';button.onclick=()=>useEntity(state.entity,0,false,state.part);controls.append(button);if(state.kind!=='TankBarrelBehaviour'){const reverse=document.createElement('button');reverse.textContent='Reverse direction';reverse.onclick=()=>useEntity(state.entity,1,false,state.part);controls.append(reverse);}}
    const car=vehicleStates.find(s=>s.kind==='CarBehaviour');if(car){const label=document.createElement('label'),brake=document.createElement('input');brake.type='checkbox';brake.id='vehicle-brake';brake.checked=car.brake;brake.onchange=()=>vehicles.setBrake(car.entity,brake.checked);label.append(brake,'Parking brake');controls.append(label);const repair=document.createElement('button');repair.textContent='Repair engine';repair.onclick=()=>vehicles.repair(car.entity);controls.append(repair);}
    panel.append(controls);
  }
  const liquidDeviceStates=liquidDevices.get(selected).filter(s=>targetsPart(selected!,s.part,selectedPart??undefined));
  if(liquidDeviceStates.length){const controls=document.createElement('section');controls.className='pump-controls';const readout=document.createElement('span');readout.className='controller-status';readout.id='liquid-device-readout';controls.append(readout);for(const state of liquidDeviceStates){if(state.kind==='ValveBehaviour'||state.kind==='LiquidPressureValveBehaviour'){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=state.lastTarget;input.onchange=()=>liquidDevices.setValve(state.entity,input.checked,state.part);label.append(input,' Open valve');controls.append(label);}if(state.kind==='LiquidDuplicatorBehaviour'){const flush=document.createElement('button');flush.textContent='Flush container';flush.onclick=()=>liquidDevices.flush(state.entity,state.part);controls.append(flush);}if(state.kind==='LiquidContainerHoleBehaviour'){const repair=document.createElement('button');repair.textContent='Repair leaks';repair.onclick=()=>liquidDevices.repair(state.entity,state.part);controls.append(repair);}}panel.append(controls);}
  const person=ragdolls.stateFor(selected);
  if(person){const controls=document.createElement('section');controls.className='pose-controls';controls.innerHTML=`<label for="pose">Pose</label><select id="pose"><option value="-1">Automatic</option>${person.poses.map((p,i)=>`<option value="${i}">${escape(p.Name)}</option>`).join('')}</select><span class="selection-state" id="person-readout"></span><div class="body-mode-buttons"><button id="heal-person">Heal</button><button id="damage-person">Injure</button></div>`;panel.append(controls);$<HTMLSelectElement>('#pose').value=String(person.overridePoseIndex);$('#pose').onchange=()=>ragdolls.setPose(selected!,Number($<HTMLSelectElement>('#pose').value));$('#heal-person').onclick=()=>person.limbs.forEach(l=>ragdolls.heal(l.part,l.initialHealth));$('#damage-person').onclick=()=>{if(person.head)ragdolls.damage(person.head.part,10);};}
}
function togglePause() { sim.paused=!sim.paused;$('#pause').textContent=sim.paused?'▶':'Ⅱ';$('#pause').title=sim.paused?'Resume (Space)':'Pause (Space)';$('#state-label').textContent=sim.paused?'SIMULATION PAUSED':'SIMULATION RUNNING';$('#viewport').classList.toggle('paused',sim.paused); }
$('#search').oninput=renderCatalog;
document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(b=>b.onclick=()=>{category=b.dataset.category!;document.querySelectorAll('[data-category]').forEach(el=>el.classList.toggle('active',el===b));renderCatalog();});
$('#pause').onclick=togglePause;
$('#step').onclick=()=>{if(!sim.paused)togglePause();sim.step();};
$('#speed').onchange=()=>sim.speed=Number($<HTMLSelectElement>('#speed').value);
$('#home').onclick=resetCameraForMap;
const zoom=(factor:number)=>{const r=$('#viewport').getBoundingClientRect();view.zoom(factor,r.left+r.width/2,r.top+r.height/2);};
$('#zoom-in').onclick=()=>zoom(.8);$('#zoom-out').onclick=()=>zoom(1.25);
$('#clear').onclick=()=>{sceneGeneration++;wires.clear();sim.clear();powder.clear();cancelConnection();view.clearEffects();audio.stop();select(null);choose(selectedKind);toast('Chamber cleared');};
$('#help').onclick=()=>$<HTMLDialogElement>('#help-dialog').showModal();
$('#close-help').onclick=()=>$<HTMLDialogElement>('#help-dialog').close();
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(sim.serialize(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='open-playground-scene.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Scene saved');};
$('#import').onclick=()=>$<HTMLInputElement>('#scene-file').click();
$('#scene-file').onchange=async()=>{
  const input=$<HTMLInputElement>('#scene-file'),file=input.files?.[0];if(!file)return;
  const generation=++sceneGeneration;
  try{
    if(file.size>CONFIG.maxImportBytes)throw new Error('Scene file is too large');const data=JSON.parse(await file.text());if(!data||data.format!=='open-playground'||!Array.isArray(data.entities))throw new Error('Unsupported scene file');
    if(data.environment?.catalogId){if(!maps)throw new Error('This scene requires local environment assets');await maps.load(data.environment.catalogId);}
    if(library?.loadPrefab&&Array.isArray(data?.entities)){
      const ids=[...new Set(data.entities.filter((e:unknown)=>e&&typeof e==='object'&&(e as {kind?:unknown}).kind==='prefab').map((e:{catalogId?:unknown})=>e.catalogId).filter((id:unknown)=>typeof id==='string'))] as string[];
      if(ids.length>CONFIG.maxEntities)throw new Error('Scene has too many objects');await Promise.all(ids.map(id=>library.loadPrefab!(id)));
    }
    if(generation!==sceneGeneration)throw new Error('Scene load cancelled');
    sim.import(data);if(!data.systems?.powder)powder.clear();cancelConnection();view.clearEffects();audio.stop();applyMapSettings();resetCameraForMap();select(null);choose(null);toast('Scene opened');
  }catch(error){toast(error instanceof Error?error.message:'Could not open scene');}input.value='';
};
const canvas=view.renderer.domElement;
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointerdown=async e=>{
  if(e.button!==0&&e.button!==1&&e.button!==2)return;
  canvas.setPointerCapture(e.pointerId);$('#viewport').focus({preventScroll:true});lastPointer={x:e.clientX,y:e.clientY};
  if(e.button===1||e.button===2){pointerMode='pan';canvas.style.cursor='grabbing';return;}
  const p=view.toWorld(e.clientX,e.clientY);
  wirePointer=p;
  if(powderUI.active){pointerMode='powder';powderUI.pointerDown(p);return;}
  if(interactionTool==='remove-wire'){const wire=view.connections.pick(p,view.viewHeight/Math.max(1,$('#viewport').clientHeight)*7);if(wire){wires.disconnect(wire);if(selectedWire?.id===wire.id)select(null);}return;}
  if(interactionTool==='connect'){
    if(firstAnchor){finishConnection(p);return;}
    const anchor=endpointAt(p);if((connectionKind==='activation'||connectionKind==='blood')&&!anchor.part){toast('This connection requires two objects');return;}
    select(null);firstAnchor=anchor;wireDown={x:e.clientX,y:e.clientY};wireDragging=false;pointerMode='wire';updateConnectionTools();return;
  }
  if(selectedKind){const id=selectedKind,generation=sceneGeneration;try{if(library){await library.loadPrefab!(id);if(generation===sceneGeneration)select(sim.spawnPrefab(id,p.x,p.y));}else select(sim.spawn(id as ItemKind,p.x,Math.max(p.y,.05)));}catch(err){toast((err as Error).message);}return;}
  const part=sim.pick(p.x,p.y);const wire=!part?view.connections.pick(p,view.viewHeight/Math.max(1,$('#viewport').clientHeight)*6):null;if(wire){selectConnection(wire);return;}select(part?(part.body.getUserData() as Entity):sim.pickEntity(p.x,p.y),part??undefined);
  if(part){sim.beginDrag(part,p.x,p.y);pointerMode='drag';}
};
canvas.onpointermove=e=>{
  wirePointer=view.toWorld(e.clientX,e.clientY);if(pointerMode==='wire'&&Math.hypot(e.clientX-wireDown.x,e.clientY-wireDown.y)>6)wireDragging=true;
  if(pointerMode==='powder')powderUI.pointerMove(wirePointer,true);else if(powderUI.active)powderUI.pointerMove(wirePointer,false);
  if(pointerMode==='pan')view.pan(e.clientX-lastPointer.x,e.clientY-lastPointer.y);
  if(pointerMode==='drag'){const p=view.toWorld(e.clientX,e.clientY);if(sim.paused&&selected){const target=sim.drag?.getTarget();if(target){const dx=p.x-target.x,dy=p.y-target.y;selected.parts.forEach(part=>{const pos=part.body.getPosition();part.body.setTransform({x:pos.x+dx,y:pos.y+dy},part.body.getAngle());});}}sim.moveDrag(p.x,p.y);}
  lastPointer={x:e.clientX,y:e.clientY};
};
function endPointer(){powderUI.pointerUp();sim.endDrag();pointerMode=null;canvas.style.cursor='';}
canvas.onpointerup=e=>{if(pointerMode==='wire'&&wireDragging)finishConnection(view.toWorld(e.clientX,e.clientY));endPointer();};canvas.onpointercancel=()=>{cancelConnection();endPointer();};canvas.onlostpointercapture=endPointer;
canvas.addEventListener('wheel',e=>{e.preventDefault();view.zoom(Math.exp(e.deltaY*.001),e.clientX,e.clientY);},{passive:false});
function releaseInput(){if(inputHeld){weapons.setHeld(inputHeld.entity,false,inputHeld.part);projectiles.setHeld(inputHeld.entity,false,inputHeld.part);}inputHeld=null;continuousAccumulator=0;}
window.addEventListener('blur',()=>{cancelConnection();endPointer();releaseInput();});
window.addEventListener('keyup',e=>{if(e.key.toLowerCase()==='t')releaseInput();});
window.addEventListener('keydown',e=>{
  if($<HTMLDialogElement>('#help-dialog').open)return;
  if(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)return;
  if(e.key===' '){e.preventDefault();if(!e.repeat)togglePause();}
  if(e.key==='Escape'&&firstAnchor){cancelConnection();return;}
  if(e.key==='Escape'||e.key.toLowerCase()==='v')choose(null);
  if(e.key.toLowerCase()==='w')setInteractionTool('connect');if(e.key.toLowerCase()==='x')setInteractionTool('remove-wire');
  if(['1','2','3','4'].includes(e.key)){const target=library?['Human','Crate','Bowling Ball','Wooden Pole'][Number(e.key)-1]:CATALOG[Number(e.key)-1].name;const item=items.find(i=>i.name===target);if(item)choose(item.id);}
  if(e.key==='Delete'){if(selectedWire){wires.disconnect(selectedWire);select(null);}else if(selected){sim.remove(selected);select(null);}}
  if(e.key.toLowerCase()==='f'&&selected&&!e.repeat){sim.freeze(selected);renderSelection();}
  if(e.key.toLowerCase()==='t'&&selected&&!e.repeat){const channel=e.shiftKey?1:e.altKey?2:0;useEntity(selected,channel);inputHeld={entity:selected,part:selectedPart??undefined,channel};continuousAccumulator=0;weapons.setHeld(selected,true,selectedPart??undefined);projectiles.setHeld(selected,true,selectedPart??undefined);}
  if(['q','e'].includes(e.key.toLowerCase())&&selected)sim.rotate(selected,(e.key.toLowerCase()==='q'?-1:1)*Math.PI/12);
  if(e.key==='.'){if(!sim.paused)togglePause();sim.step();}
  if(e.key==='Home')resetCameraForMap();
  if(e.key==='/'){e.preventDefault();$('#search').focus();}
});
renderCatalog();
// Start with a small, editable scene so physics is immediately visible.
if(maps)try{const prefab=await maps.load('20047');sim.setEnvironment(prefab);applyMapSettings();resetCameraForMap();}catch(error){console.warn('Default environment unavailable.',error);}
if(library){const samples=[['Human',-2,1.3],['Crate',1.4,.5],['Wooden Pole',3.5,1.5],['Bowling Ball',4.5,2.6]] as const;await Promise.all(samples.map(async([name,x,y])=>{const item=items.find(i=>i.name===name);if(item)try{await library.loadPrefab!(item.id);sim.spawnPrefab(item.id,x,y);}catch(error){console.warn(`Could not initialize ${name}`,error);}}));}else{sim.spawn('human',-2,.1);sim.spawn('box',1.4,.02);sim.spawn('box',1.4,.94);sim.spawn('plank',3.5,.05);sim.spawn('ball',4.5,2.6);}
choose(null);
let last=performance.now(),frames=0,fpsStart=last;
function animate(now:number){
  const dt=(now-last)/1000;last=now;
  audio.camera={x:view.center.x,y:view.center.y,width:view.viewHeight*$('#viewport').clientWidth/Math.max(1,$('#viewport').clientHeight)};
  audio.setTimeScale(sim.paused?0:sim.speed);
  const scaled=sim.paused?0:Math.min(dt,.1)*sim.speed;
  if(inputHeld&&!sim.paused){continuousAccumulator+=scaled;for(let emitted=0;continuousAccumulator>=.025&&emitted<4;emitted++){continuousAccumulator-=.025;if(sim.entities.includes(inputHeld.entity))useEntity(inputHeld.entity,inputHeld.channel,true,inputHeld.part);}}
  if(!sim.paused){physical.frame(scaled,sim.speed);devices.frame(scaled);environment.frame(scaled);liquidDevices.frame(scaled);liquids.frame(scaled);}
  sim.update(dt);shrapnel.afterFrame();particles.update(scaled);view.updateEffects(scaled);powderUI.frame();
  if(selected&&!sim.entities.includes(selected))select(null);
  if(selectedWire&&!wires.wires.has(selectedWire.id))select(null);
  view.connections.preview=firstAnchor?{a:endpointPoint(firstAnchor),b:wirePointer,kind:connectionKind,channel:connectionChannel}:null;
  view.render(selected);
  $('#object-count').textContent=`${sim.entities.length} OBJECT${sim.entities.length===1?'':'S'}`;
  $('#connection-count').textContent=`${wires.wires.size} LINK${wires.wires.size===1?'':'S'}`;
  if(++frames>=30){
    $('#fps').textContent=`${Math.round(frames*1000/(now-fpsStart))} FPS`;frames=0;fpsStart=now;
    const readout=document.querySelector('#physical-readout');
    if(readout&&selected){const states=selected.parts.map(p=>physical.get(p)).filter(p=>p!==undefined);readout.textContent=`${(states.reduce((a,s)=>a+s.state.temperature,0)/states.length).toFixed(1)} °C · ${(states.reduce((a,s)=>a+s.state.charge,0)/states.length).toFixed(1)} charge${states.some(s=>s.state.onFire)?' · Burning':''}`;}
    const personReadout=document.querySelector('#person-readout');
    if(personReadout&&selected){const person=ragdolls.stateFor(selected);if(person)personReadout.textContent=`Consciousness ${Math.round(person.consciousness*100)}% · Oxygen ${Math.round(person.oxygen*100)}%`;}
    const fluidReadout=document.querySelector('#liquid-readout');if(fluidReadout&&selected)fluidReadout.textContent=liquidReadout(selected);
    const syringeReadout=document.querySelector('#syringe-readout');if(syringeReadout&&selected){const syringe=liquids.syringesFor(selected)[0];if(syringe)syringeReadout.textContent=`${Math.round(syringe.container.scaledAmount*100)}% full · ${(syringe.container.total*500/1.4).toFixed(1)} mL`;}
    const needleReadout=document.querySelector('#needle-readout');if(needleReadout&&selected){const connection=selected.parts.map(p=>needles.get(p)).find(c=>!!c);needleReadout.textContent=connection?`Needle inserted in ${connection.victim.label}`:'Needle not inserted';}
    const defibReadout=document.querySelector('#defibrillator-readout');if(defibReadout&&selected){const state=defibrillators.get(selected)[0];defibReadout.textContent=state?.phase==='standby'?`Stand clear… ${state.remaining.toFixed(1)} s`:state?.phase==='clear'?'Discharging':'Defibrillator ready';}
  }
  const mechanismReadout=document.querySelector('#mechanism-readout');if(mechanismReadout&&selected)mechanismReadout.textContent=mechanisms.get(selected).filter(s=>s.kind!=='GearBehaviour').map(s=>`${s.kind==='PistonBehaviour'?'Piston':'Servo'} ${s.active?'active':'off'}`).join(' · ');
  const vehicleReadout=document.querySelector('#vehicle-readout');if(vehicleReadout&&selected)vehicleReadout.textContent=vehicles.get(selected).map(s=>s.kind==='TankBarrelBehaviour'?'Barrel ready':`${s.kind==='CarBehaviour'?'Engine':s.kind==='HovercarBehaviour'?'Hover drive':'Boat motor'} ${s.activated?'on':'off'} · ${s.speed<0?'reverse':'forward'}${s.kind==='CarBehaviour'?` · health ${Math.round(s.health*100)}%`:''}`).join(' / ');
  const liquidDeviceReadout=document.querySelector('#liquid-device-readout');if(liquidDeviceReadout&&selected)liquidDeviceReadout.textContent=liquidDevices.get(selected).filter(s=>targetsPart(selected!,s.part,selectedPart??undefined)).map(s=>s.display||((s.kind==='ValveBehaviour'||s.kind==='LiquidPressureValveBehaviour')?`Valve ${Math.round(s.valvePosition*100)}% open`:s.kind==='LiquidDuplicatorBehaviour'?`Duplicator ${s.active?'on':'off'}${s.phase==='flush'?' · Flushing':''}`:s.kind==='LiquidentifierBehaviour'?s.phase.replace('initialising','Starting scanner'):s.holes.length?`${s.holes.length} leak${s.holes.length===1?'':'s'}`:'')).filter(Boolean).join(' · ');
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
