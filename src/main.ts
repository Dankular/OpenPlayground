import './style.css';
import './catalog.css';
import { CATALOG, CONFIG, type ItemKind } from './config';
import { Simulation, type Entity, type Part } from './simulation';
import { SandboxRenderer } from './renderer';
import { loadHumanRig } from './assets';
import { loadAssetLibrary } from './prefabs';
import { PhysicalSystem } from './systems/physical-world';
import { DeviceSystem } from './systems/devices';
import { RagdollSystem } from './systems/ragdoll';
import { WeaponSystem } from './systems/weapons';
import { registerSystemState } from './state';
import { GameAudio,loadAudioIndex } from './systems/audio';
import { loadMapLibrary,mapSettings } from './maps';
import { BodyShaderLibrary } from './shaders/body';
import { EnvironmentSystem } from './systems/environment';

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
const audio=new GameAudio(audioIndex);let audioUnlocked=false;
const unlockAudio=()=>{audioUnlocked=true;audio.unlock();};
document.addEventListener('pointerdown',unlockAudio,{capture:true});document.addEventListener('keydown',unlockAudio,{capture:true});
const muteButton=document.createElement('button');muteButton.id='mute';muteButton.title='Mute sound';muteButton.setAttribute('aria-label','Mute sound');muteButton.textContent='♫';muteButton.onclick=()=>{audio.volume=audio.volume?0:1;if(!audio.volume)audio.stop();muteButton.textContent=audio.volume?'♫':'♩';muteButton.title=audio.volume?'Mute sound':'Unmute sound';muteButton.setAttribute('aria-label',muteButton.title);};$('.header-actions').prepend(muteButton);
const sim = new Simulation(rig,library);
const physical=new PhysicalSystem();
sim.onSpawn.push(e=>physical.attach(e));sim.onRemove.push(e=>physical.remove(e));sim.beforeStep.push(dt=>physical.beforeStep(dt));sim.afterStep.push(dt=>physical.afterStep(dt));
const devices=new DeviceSystem(physical,{setRendererEnabled:(entity,id,enabled)=>view.setRendererEnabled(entity,id,enabled)});
sim.onSpawn.push(e=>devices.attach(e));sim.onRemove.push(e=>devices.remove(e));sim.beforeStep.push(dt=>devices.beforeStep(dt));
const ragdolls=new RagdollSystem({getPhysical:part=>physical.get(part as Part)});
const environment=new EnvironmentSystem(sim.world,{getPhysical:part=>physical.get(part),ragdolls,onSettings:settings=>{physical.ambientTemperature=settings.ambientTemperature;}});
sim.onSpawn.push(e=>environment.attach(e),e=>ragdolls.attach(e));sim.onRemove.push(e=>environment.remove(e),e=>ragdolls.remove(e));sim.beforeStep.push(dt=>environment.beforeStep(dt),dt=>ragdolls.update(dt));sim.afterStep.push(dt=>ragdolls.afterStep(dt));
const weapons=new WeaponSystem(sim,physical,{onHit:hit=>ragdolls.shot(hit.part,{damage:hit.damage,point:hit.point,normal:hit.normal,exit:hit.exit}),onFragment:(part,force)=>ragdolls.damage(part,force*1.5,'fragment'),onSlice:part=>ragdolls.slice(part),onTrace:trace=>view.addTracer(trace),onExplosion:(position,range)=>view.addExplosion(position,range),onShot:(e,c,first)=>{if(audioUnlocked)audio.firearm(e,c,first);}});
sim.onSpawn.push(e=>weapons.attach(e));sim.onRemove.push(e=>weapons.remove(e));sim.beforeStep.push(dt=>weapons.beforeStep(dt));
registerSystemState(sim,physical,devices,ragdolls);sim.stateAdapters.set('weapons',{capture:e=>weapons.snapshot(e),restore:(e,value)=>weapons.restore(e,value)});
sim.stateAdapters.set('environment',{capture:e=>environment.snapshot(e),restore:(e,value)=>environment.restore(e,value)});
sim.importTransactions.set('environment',{capture:()=>({...environment.settings}),rollback:value=>environment.applySettings(value as typeof environment.settings)});
const enteringContacts=new Set<import('planck').Contact>();
sim.world.on('begin-contact',contact=>enteringContacts.add(contact));sim.world.on('end-contact',contact=>enteringContacts.delete(contact));
sim.world.on('post-solve',(contact,impulse)=>{if(!enteringContacts.delete(contact))return;const amount=impulse.normalImpulses[0]??0;for(const body of [contact.getFixtureA().getBody(),contact.getFixtureB().getBody()]){const entity=body.getUserData() as Entity|undefined;const part=entity?.parts?.find(p=>p.body===body);if(part){ragdolls.impact(part,amount);if(audioUnlocked)audio.impact(part,amount);}}});
const view = new SandboxRenderer($('#viewport'),sim,bodyShaders);
view.physicalState=part=>physical.get(part)?.state;
view.skinFor=part=>ragdolls.skinFor(part);view.skinTime=()=>ragdolls.time;
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
let category='All';
let showAll=false;
if(library){const filter=document.createElement('label');filter.className='show-all';filter.innerHTML='<input type="checkbox" id="show-all-objects"> Show all objects';$('.categories').after(filter);$('#show-all-objects').onchange=()=>{showAll=$<HTMLInputElement>('#show-all-objects').checked;const chosen=items.find(i=>i.id===selectedKind);if(!showAll&&chosen&&(!chosen.visible||chosen.locked))choose(null);else renderCatalog();};}
let pointerMode: 'pan' | 'drag' | null = null;
let lastPointer = {x:0,y:0};
let toastTimer: ReturnType<typeof setTimeout>;
let sceneGeneration=0;
function toast(message: string) { $('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000); }
function renderCatalog() {
  const query=$<HTMLInputElement>('#search').value.toLowerCase();
  const visible=items.filter(c=>(showAll||c.visible)&&(category==='All'||c.category===category) && `${c.name} ${c.description}`.toLowerCase().includes(query)).sort((a,b)=>a.sortName.localeCompare(b.sortName));
  $('.count').textContent=String(items.filter(i=>showAll||i.visible).length)+'/'+items.length;
  $('#catalog').innerHTML=`<button class="hand-tool ${selectedKind===null?'active':''}" id="hand-tool"><span>↖</span><div>Interact<small>Grab, move & select</small></div><kbd>V</kbd></button><div class="catalog-divider">${category==='All'?'AVAILABLE OBJECTS':escape(category.toUpperCase())} · ${visible.length}</div>${visible.map(c=>`<button class="object-card ${selectedKind===c.id?'selected':''}" data-kind="${escape(c.id)}" ${c.locked&&!showAll?'disabled':''} title="${escape(c.locked&&!showAll?'Locked object':c.description)}"><div class="object-preview" style="color:${c.color}">${c.sprite?`<img src="${escape(`${import.meta.env.BASE_URL}${c.sprite.url.replace(/^\//,'')}`)}" alt="" loading="lazy">`:c.kind?svg(c.kind):''}${c.shortcut?`<kbd>${c.shortcut}</kbd>`:''}</div><div class="object-info"><strong>${escape(c.name)}</strong><span>${c.locked&&!showAll?'Locked':escape(c.category)}</span></div></button>`).join('')}${!visible.length?'<p class="no-results">No objects found.</p>':''}`;
  $('#hand-tool').onclick=()=>choose(null);
  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(b=>b.onclick=()=>choose(b.dataset.kind!));
}
function choose(kind: string|null) {
  const item=items.find(i=>i.id===kind);if(item&&!showAll&&(!item.visible||item.locked))return;
  selectedKind=kind;renderCatalog();
  $('#viewport').classList.toggle('placing',!!kind);
  $('#placement-hint').textContent=kind?`Click to place ${items.find(c=>c.id===kind)!.name.toLowerCase()} · Esc for hand tool`:sim.entities.length?'Drag an object to move it':'Select an object to start your experiment ←';
  if(kind&&library?.loadPrefab)library.loadPrefab(kind).catch(error=>toast(error instanceof Error?error.message:'Could not load object'));
}
function select(entity: Entity|null) {if(selected&&selected!==entity)weapons.setHeld(selected,false);selected=entity;renderSelection(); }
const selectEntity=select;
function renderSelection() {
  const panel=$('#selection');panel.hidden=!selected;
  if (!selected) return;
  const states=selected.parts.map(p=>physical.get(p)).filter(p=>p!==undefined);
  panel.innerHTML=`<span class="eyebrow">SELECTED OBJECT</span><strong>${escape(itemName(selected))}</strong><span class="selection-state">${selected.frozen?'Frozen':'Dynamic'} · ${selected.parts.length} ${selected.parts.length===1?'body':'bodies'}</span><div><button id="freeze">${selected.frozen?'Unfreeze':'Freeze'} <kbd>F</kbd></button><button id="rotate">Rotate <kbd>E</kbd></button><button id="delete" class="danger">Delete <kbd>Del</kbd></button></div>${states.length?`<section class="physical-controls"><span id="physical-readout"></span><label>Temperature °C<input id="set-temperature" type="number" min="-273.15" max="1000000000" value="${Math.round(states.reduce((a,s)=>a+s.state.temperature,0)/states.length)}"></label><label>Charge<input id="set-charge" type="number" min="0" value="${Math.round(states.reduce((a,s)=>a+s.state.charge,0)/states.length)}"></label><div><button id="ignite">Ignite</button><button id="extinguish">Extinguish</button></div></section>`:''}`;
  $('#freeze').onclick=()=>{sim.freeze(selected!);renderSelection();};
  $('#rotate').onclick=()=>sim.rotate(selected!,Math.PI/12);
  $('#delete').onclick=()=>{sim.remove(selected!);select(null);};
  if(states.length){$('#set-temperature').onchange=()=>physical.setTemperature(selected!,Number($<HTMLInputElement>('#set-temperature').value));$('#set-charge').onchange=()=>physical.setCharge(selected!,Number($<HTMLInputElement>('#set-charge').value));$('#ignite').onclick=()=>physical.ignite(selected!,true);$('#extinguish').onclick=()=>physical.extinguish(selected!);}
  if(devices.get(selected).length||weapons.canUse(selected)){const button=document.createElement('button');button.id='activate';button.className='use-button';button.textContent='Use / activate (T)';button.onclick=()=>{devices.use(selected!);weapons.use(selected!);};panel.querySelector('div')!.prepend(button);}
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
$('#clear').onclick=()=>{sceneGeneration++;sim.clear();view.clearEffects();audio.stop();select(null);choose(selectedKind);toast('Chamber cleared');};
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
    sim.import(data);view.clearEffects();audio.stop();applyMapSettings();resetCameraForMap();select(null);choose(null);toast('Scene opened');
  }catch(error){toast(error instanceof Error?error.message:'Could not open scene');}input.value='';
};
const canvas=view.renderer.domElement;
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointerdown=async e=>{
  if(e.button!==0&&e.button!==1&&e.button!==2)return;
  canvas.setPointerCapture(e.pointerId);$('#viewport').focus({preventScroll:true});lastPointer={x:e.clientX,y:e.clientY};
  if(e.button===1||e.button===2){pointerMode='pan';canvas.style.cursor='grabbing';return;}
  const p=view.toWorld(e.clientX,e.clientY);
  if(selectedKind){const id=selectedKind,generation=sceneGeneration;try{if(library){await library.loadPrefab!(id);if(generation===sceneGeneration)select(sim.spawnPrefab(id,p.x,p.y));}else select(sim.spawn(id as ItemKind,p.x,Math.max(p.y,.05)));}catch(err){toast((err as Error).message);}return;}
  const part=sim.pick(p.x,p.y);select(part?(part.body.getUserData() as Entity):sim.pickEntity(p.x,p.y));
  if(part){sim.beginDrag(part,p.x,p.y);pointerMode='drag';}
};
canvas.onpointermove=e=>{
  if(pointerMode==='pan')view.pan(e.clientX-lastPointer.x,e.clientY-lastPointer.y);
  if(pointerMode==='drag'){const p=view.toWorld(e.clientX,e.clientY);if(sim.paused&&selected){const target=sim.drag?.getTarget();if(target){const dx=p.x-target.x,dy=p.y-target.y;selected.parts.forEach(part=>{const pos=part.body.getPosition();part.body.setTransform({x:pos.x+dx,y:pos.y+dy},part.body.getAngle());});}}sim.moveDrag(p.x,p.y);}
  lastPointer={x:e.clientX,y:e.clientY};
};
function endPointer(){sim.endDrag();pointerMode=null;canvas.style.cursor='';}
canvas.onpointerup=endPointer;canvas.onpointercancel=endPointer;canvas.onlostpointercapture=endPointer;
canvas.addEventListener('wheel',e=>{e.preventDefault();view.zoom(Math.exp(e.deltaY*.001),e.clientX,e.clientY);},{passive:false});
window.addEventListener('blur',()=>{endPointer();if(selected)weapons.setHeld(selected,false);});
window.addEventListener('keyup',e=>{if(e.key.toLowerCase()==='t'&&selected)weapons.setHeld(selected,false);});
window.addEventListener('keydown',e=>{
  if($<HTMLDialogElement>('#help-dialog').open)return;
  if(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)return;
  if(e.key===' '){e.preventDefault();if(!e.repeat)togglePause();}
  if(e.key==='Escape'||e.key.toLowerCase()==='v')choose(null);
  if(['1','2','3','4'].includes(e.key)){const target=library?['Human','Crate','Bowling Ball','Wooden Pole'][Number(e.key)-1]:CATALOG[Number(e.key)-1].name;const item=items.find(i=>i.name===target);if(item)choose(item.id);}
  if(e.key==='Delete'&&selected){sim.remove(selected);select(null);}
  if(e.key.toLowerCase()==='f'&&selected&&!e.repeat){sim.freeze(selected);renderSelection();}
  if(e.key.toLowerCase()==='t'&&selected&&!e.repeat){devices.use(selected,e.shiftKey?1:0);weapons.use(selected);weapons.setHeld(selected,true);}
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
  if(!sim.paused){physical.frame(scaled,sim.speed);devices.frame(scaled);environment.frame(scaled);}
  sim.update(dt);view.updateEffects(scaled);
  if(selected&&!sim.entities.includes(selected))select(null);
  view.render(selected);
  $('#object-count').textContent=`${sim.entities.length} OBJECT${sim.entities.length===1?'':'S'}`;
  if(++frames>=30){
    $('#fps').textContent=`${Math.round(frames*1000/(now-fpsStart))} FPS`;frames=0;fpsStart=now;
    const readout=document.querySelector('#physical-readout');
    if(readout&&selected){const states=selected.parts.map(p=>physical.get(p)).filter(p=>p!==undefined);readout.textContent=`${(states.reduce((a,s)=>a+s.state.temperature,0)/states.length).toFixed(1)} °C · ${(states.reduce((a,s)=>a+s.state.charge,0)/states.length).toFixed(1)} charge${states.some(s=>s.state.onFire)?' · Burning':''}`;}
    const personReadout=document.querySelector('#person-readout');
    if(personReadout&&selected){const person=ragdolls.stateFor(selected);if(person)personReadout.textContent=`Consciousness ${Math.round(person.consciousness*100)}% · Oxygen ${Math.round(person.oxygen*100)}%`;}
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
