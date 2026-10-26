import { World, Vec2, Box, Circle, Polygon, RevoluteJoint, MouseJoint, DistanceJoint, RopeJoint, PrismaticJoint, WheelJoint, WeldJoint, MotorJoint, FrictionJoint, type Body, type Joint, type BodyType } from 'planck';
import { CONFIG, type ItemKind } from './config';
import type { HumanRig, RigSprite } from './assets';
import type { AssetLibrary, Prefab, PrefabRenderer, SourceComponent, SourceNode, PrefabJoint } from './prefabs';
import { colliderShapes } from './geometry';

export interface Part { id?: string; body: Body; width: number; height: number; shape: 'box' | 'circle'; color: string; label: string; sprite?: RigSprite; initialType?: BodyType; metadata?: { components: SourceComponent[]; nodeId: string; active?:boolean } }
export interface Entity { id: number; kind: ItemKind | 'prefab'; catalogId?: string; prefabId?: string; name?: string; parts: Part[]; joints: Joint[]; jointById?: Map<string,Joint>; frozen: boolean; rig?: 'local'; renderers?: PrefabRenderer[]; position?: {x:number;y:number}; angle?: number; metadata?: {nodes:SourceNode[]}; unsupported?: string[]; isEnvironment?:boolean }
export interface SavedEntity { kind: ItemKind | 'prefab'; catalogId?: string; prefabId?: string; frozen: boolean; rig?: 'local'; position?:{x:number;y:number}; angle?:number; activeJointIds?:string[]; systems?:Record<string,unknown>; parts: { id?:string; x: number; y: number; angle: number; vx: number; vy: number; av: number }[] }
export interface SceneData { format: 'open-playground'; version: 1|2; buildId?: string|null; environment?:SavedEntity; entities: SavedEntity[] }
const kinds: ItemKind[] = ['human', 'box', 'ball', 'plank'];

export class Simulation {
  world = new World(Vec2(0, CONFIG.gravity));
  entities: Entity[] = [];
  environment: Entity|null=null;
  get renderEntities(){return this.environment?[this.environment,...this.entities]:this.entities;}
  ground: Body;
  drag: MouseJoint | null = null;
  paused = false;
  speed = 1;
  beforeStep: ((dt:number)=>void)[]=[];
  afterStep: ((dt:number)=>void)[]=[];
  onSpawn: ((entity:Entity)=>void)[]=[];
  onRemove: ((entity:Entity)=>void)[]=[];
  stateAdapters = new Map<string,{capture:(entity:Entity)=>unknown;restore:(entity:Entity,value:unknown)=>boolean|void}>();
  private suppressHooks=false;
  private breakableJoints=new Map<Joint,{entity:Entity;force:number;torque:number}>();
  private accumulator = 0;
  private nextId = 1;
  constructor(readonly humanRig: HumanRig | null = null, readonly assets: AssetLibrary | null = null) {
    this.ground = this.world.createBody();
    this.ground.createFixture(Box(500, .5, Vec2(0, -.5)), { friction: .8 });
  }
  spawn(kind: ItemKind, x: number, y: number, useLocal = !!this.humanRig): Entity {
    if (this.entities.length >= CONFIG.maxEntities) throw new Error(`Scene limit: ${CONFIG.maxEntities} objects`);
    const entity: Entity = { id: this.nextId++, kind, parts: [], joints: [], frozen: false };
    const group = kind === 'human' ? -entity.id : 0;
    const part = (label: string, dx: number, dy: number, w: number, h: number, color: string, circle = false, density = 1) => {
      const body = this.world.createDynamicBody({ position: Vec2(x + dx, y + dy), linearDamping: .08, angularDamping: .15 });
      body.createFixture(circle ? Circle(w / 2) : Box(w / 2, h / 2), { density, friction: .65, restitution: kind === 'ball' ? .4 : .05, filterGroupIndex: group });
      entity.parts.push({ body, width: w, height: h, shape: circle ? 'circle' : 'box', color, label });
      body.setUserData(entity);
      return body;
    };
    if (kind === 'human' && useLocal && this.humanRig) {
      entity.rig = 'local';
      const bodies = new Map<string, Body>();
      for (const p of this.humanRig.parts) {
        const body = this.world.createDynamicBody({ position: Vec2(x+p.position.x,y+p.position.y), angle: p.angle, linearDamping: p.linearDamping, angularDamping: p.angularDamping, gravityScale:p.gravityScale??1 });
        for (const c of p.colliders) {
          // The extraction manifest already applies world scale to local collider data.
          const offset=Vec2(c.offset.x,c.offset.y);
          const shape=c.type==='box' && c.size ? Box(c.size.x/2,c.size.y/2,offset) : c.type==='circle' && c.radius ? Circle(offset,c.radius) : c.points ? Polygon(c.points.map(pt=>Vec2(pt.x+offset.x,pt.y+offset.y))) : null;
          if (shape) body.createFixture(shape,{density:1,friction:.65,restitution:.05,filterGroupIndex:group,isSensor:c.isTrigger??false});
          if(c.type==='polygon'&&c.paths)for(const path of c.paths)body.createFixture(Polygon(path.map(pt=>Vec2(pt.x+offset.x,pt.y+offset.y))),{density:1,friction:.65,restitution:.05,filterGroupIndex:group,isSensor:c.isTrigger??false});
        }
        const mass=body.getMass(); if (mass>0) {const md={mass:0,center:Vec2(),I:0};body.getMassData(md);body.setMassData({mass:p.mass,center:md.center,I:md.I*p.mass/mass});}
        entity.parts.push({body,width:p.sprite?.width??.2,height:p.sprite?.height??.3,shape:'box',color:'#dfbfa9',label:p.name,sprite:p.sprite});body.setUserData(entity);bodies.set(p.id,body);
      }
      for (const j of this.humanRig.joints) {
        const bodyA=bodies.get(j.bodyA),bodyB=bodies.get(j.bodyB);if(!bodyA||!bodyB)continue;
        // Unity reports owner-minus-connected rotation; Planck measures bodyB-minus-bodyA.
        entity.joints.push(this.world.createJoint(new RevoluteJoint({ bodyA,bodyB,localAnchorA:Vec2(j.anchorA.x,j.anchorA.y),localAnchorB:Vec2(j.anchorB.x,j.anchorB.y),referenceAngle:bodyB.getAngle()-bodyA.getAngle(),enableLimit:j.enableLimit,lowerAngle:-j.upperAngle,upperAngle:-j.lowerAngle,enableMotor:j.enableMotor,motorSpeed:-j.motorSpeed,maxMotorTorque:j.maxMotorTorque,collideConnected:j.collideConnected }))!);
      }
    } else if (kind === 'human') {
      const pelvis = part('Pelvis', 0, .98, .34, .28, '#777c86', false, 2);
      const chest = part('Torso', 0, 1.37, .4, .52, '#b2b7bf', false, 2);
      const head = part('Head', 0, 1.88, .34, .38, '#dfbfa9');
      const join = (a: Body, b: Body, dx: number, dy: number, lower: number, upper: number) => {
        entity.joints.push(this.world.createJoint(new RevoluteJoint({ enableLimit: true, lowerAngle: lower, upperAngle: upper, collideConnected: false }, a, b, Vec2(x + dx, y + dy)))!);
      };
      join(pelvis, chest, 0, 1.12, -.25, .25);
      join(chest, head, 0, 1.66, -.45, .45);
      for (const side of [-1, 1]) {
        const upperArm = part('Upper arm', side * .31, 1.32, .16, .44, side < 0 ? '#9c7f74' : '#d6b39c');
        const lowerArm = part('Lower arm', side * .34, .9, .14, .4, side < 0 ? '#9c7f74' : '#d6b39c');
        const thigh = part('Upper leg', side * .105, .62, .18, .48, side < 0 ? '#505967' : '#687383', false, 1.8);
        const calf = part('Lower leg', side * .105, .18, .16, .4, side < 0 ? '#505967' : '#687383', false, 1.8);
        join(chest, upperArm, side * .22, 1.53, -2.8, 2.8);
        join(upperArm, lowerArm, side * .33, 1.1, -2.4, .1);
        join(pelvis, thigh, side * .105, .85, -1.4, 1.4);
        join(thigh, calf, side * .105, .39, -.1, 2.3);
      }
    } else if (kind === 'box') part('Crate', 0, .45, .9, .9, '#b88b57', false, 1.3);
    else if (kind === 'ball') part('Steel ball', 0, .35, .7, .7, '#9baab9', true, 5);
    else part('Plank', 0, .1, 2.5, .2, '#c29b67', false, .8);
    this.entities.push(entity);
    if(!this.suppressHooks)this.onSpawn.forEach(fn=>fn(entity));
    return entity;
  }
  spawnPrefab(catalogId:string,x:number,y:number,prefabOverride?:Prefab,asEnvironment=false):Entity {
    if(this.entities.length>=CONFIG.maxEntities)throw new Error(`Scene limit: ${CONFIG.maxEntities} objects`);
    const prefab=prefabOverride??this.assets?.prefabs.get(catalogId);if(!prefab)throw new Error('This object has no extracted prefab');
    if(!Array.isArray(prefab.parts)||!Array.isArray(prefab.joints)||!Array.isArray(prefab.renderers))throw new Error('Prefab has no normalized simulation data');
    const e:Entity={id:this.nextId++,kind:'prefab',catalogId,prefabId:prefab.id??prefab.rootGameObjectId,name:prefab.name,parts:[],joints:[],jointById:new Map(),frozen:false,renderers:prefab.renderers,position:{x,y},angle:0,metadata:{nodes:prefab.nodes},unsupported:[...(prefab.unsupported??[])],isEnvironment:asEnvironment};
    const noSelfCollision=prefab.nodes.some(n=>n.components.some(c=>c.className==='PersonBehaviour'||c.className==='LimbBehaviour'));
    const bodies=new Map<string,Body>();
    try {
      for(const p of prefab.parts){
        const type:BodyType=typeof p.bodyType==='string'?p.bodyType:p.bodyType===1?'kinematic':p.bodyType===2?'static':'dynamic';
        const body=this.world.createBody({type,position:Vec2(x+p.position.x,y+p.position.y),angle:p.angle,linearDamping:p.linearDamping,angularDamping:p.angularDamping,gravityScale:p.gravityScale??1,fixedRotation:p.fixedRotation??false,bullet:p.bullet??false});
        const components=p.metadata?.components??p.components??prefab.nodes.find(n=>n.id===p.nodeId)?.components??[];
        const active=prefab.nodes.find(n=>n.id===p.nodeId)?.active!==false;
        const part:Part={id:p.id,body,width:p.sprite?.width??.2,height:p.sprite?.height??.2,shape:'box',color:'#cccccc',label:p.name,initialType:type,metadata:{components,nodeId:p.nodeId??'',active}};
        e.parts.push(part);bodies.set(p.id,body);body.setUserData(e);
        if(p.simulated===false||!active)body.setActive(false);
        for(const c of p.colliders){
          if(c.enabled===false)continue;
          const shapes=colliderShapes(c);
          if(!shapes.length){e.unsupported!.push(`Collider ${c.type} on ${p.name} has no supported geometry`);continue;}
          for(const shape of shapes)body.createFixture(shape,{density:c.density??1,friction:c.material?.friction??p.material?.friction??.4,restitution:c.material?.bounciness??c.material?.restitution??p.material?.restitution??0,isSensor:c.isTrigger??false,filterGroupIndex:noSelfCollision?-e.id:0});
        }
        if(type==='dynamic'&&p.mass>0){const md={mass:0,center:Vec2(),I:0};body.getMassData(md);const factor=p.mass/(md.mass||1);body.setMassData({mass:p.mass,center:md.center,I:md.I*factor});}
      }
      for(const source of prefab.joints){
        if(source.enabled===false)continue;
        const bodyA=bodies.get(source.bodyA),bodyB=source.bodyB?bodies.get(source.bodyB):this.ground;
        if(!bodyA||!bodyB){e.unsupported!.push(`Joint ${source.id??source.type} has an external body`);continue;}
        const joint=this.createPrefabJoint(source,bodyA,bodyB,x,y);
        if(!joint){e.unsupported!.push(`Joint ${source.type} is not implemented`);continue;}
        e.joints.push(joint);if(source.id)e.jointById!.set(source.id,joint);
        const force=typeof source.breakForce==='number'?source.breakForce:typeof source.data?.m_BreakForce==='number'?source.data.m_BreakForce:Infinity,torque=typeof source.breakTorque==='number'?source.breakTorque:typeof source.data?.m_BreakTorque==='number'?source.data.m_BreakTorque:Infinity;
        if(Number.isFinite(force)||Number.isFinite(torque))this.breakableJoints.set(joint,{entity:e,force,torque});
      }
      this.entities.push(e);if(!this.suppressHooks)this.onSpawn.forEach(fn=>fn(e));return e;
    }catch(error){for(const p of e.parts)this.world.destroyBody(p.body);for(const j of e.joints)this.breakableJoints.delete(j);throw error;}
  }
  setEnvironment(prefab:Prefab){
    const next=this.spawnPrefab(prefab.catalogId,0,0,prefab,true);
    if(this.environment)this.remove(this.environment);
    this.environment=next;this.entities=this.entities.filter(e=>e!==next);this.ground.getFixtureList()?.setSensor(true);return next;
  }
  private createPrefabJoint(s:PrefabJoint,bodyA:Body,bodyB:Body,x:number,y:number):Joint|null {
    const raw=s.data??{},suspension=(raw.m_Suspension??{}) as Record<string,unknown>,motor=(raw.m_Motor??{}) as Record<string,unknown>,limits=(raw.m_TranslationLimits??{}) as Record<string,unknown>;
    const n=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
    s={...s,frequency:s.frequency??n(suspension.m_Frequency,n(raw.m_Frequency,0)),dampingRatio:s.dampingRatio??n(suspension.m_DampingRatio,n(raw.m_DampingRatio,0)),angle:s.angle??n(suspension.m_Angle,n(raw.m_Angle,0))*Math.PI/180,lowerTranslation:s.lowerTranslation??n(limits.m_LowerTranslation,0),upperTranslation:s.upperTranslation??n(limits.m_UpperTranslation,0),maxMotorForce:s.maxMotorForce??n(motor.m_MaximumMotorForce,0),maxDistanceOnly:s.maxDistanceOnly??!!raw.m_MaxDistanceOnly};
    const localAnchorB=s.bodyB?s.anchorB:{x:s.anchorB.x+x,y:s.anchorB.y+y};
    const common={bodyA,bodyB,localAnchorA:s.anchorA,localAnchorB,collideConnected:s.collideConnected??false};
    const type=(s.type??'hinge').replace('Joint2D','').toLowerCase();
    if(s.distance===undefined){const current=Vec2.distance(bodyA.getWorldPoint(s.anchorA),bodyB.getWorldPoint(localAnchorB));s.distance=raw.m_AutoConfigureDistance?current:n(raw.m_Distance,current);}
    let joint:Joint;
    if(type==='hinge'||type==='revolute')joint=new RevoluteJoint({...common,referenceAngle:bodyB.getAngle()-bodyA.getAngle(),enableLimit:s.enableLimit??false,lowerAngle:-(s.upperAngle??0),upperAngle:-(s.lowerAngle??0),enableMotor:s.enableMotor??false,motorSpeed:-(s.motorSpeed??0),maxMotorTorque:s.maxMotorTorque??0});
    else if(type==='fixed'||type==='weld')joint=new WeldJoint({...common,referenceAngle:bodyB.getAngle()-bodyA.getAngle(),frequencyHz:s.frequency??0,dampingRatio:s.dampingRatio??0});
    else if(type==='distance'&&s.maxDistanceOnly)joint=new RopeJoint({...common,maxLength:s.distance??Vec2.distance(bodyA.getWorldPoint(s.anchorA),bodyB.getWorldPoint(localAnchorB))});
    else if(type==='distance'||type==='spring')joint=new DistanceJoint({...common,length:Math.max(.005,s.distance??Vec2.distance(bodyA.getWorldPoint(s.anchorA),bodyB.getWorldPoint(localAnchorB))),frequencyHz:s.frequency??0,dampingRatio:s.dampingRatio??0});
    else if(type==='slider'||type==='prismatic')joint=new PrismaticJoint({...common,referenceAngle:bodyB.getAngle()-bodyA.getAngle(),localAxisA:s.axis??{x:Math.cos(s.angle??0),y:Math.sin(s.angle??0)},enableLimit:s.enableLimit??false,lowerTranslation:s.lowerTranslation??0,upperTranslation:s.upperTranslation??0,enableMotor:s.enableMotor??false,motorSpeed:s.motorSpeed??0,maxMotorForce:s.maxMotorForce??0});
    else if(type==='wheel')joint=new WheelJoint({...common,localAxisA:s.axis??{x:Math.cos(s.angle??Math.PI/2),y:Math.sin(s.angle??Math.PI/2)},enableMotor:s.enableMotor??false,motorSpeed:-(s.motorSpeed??0),maxMotorTorque:s.maxMotorTorque??0,frequencyHz:s.frequency??0,dampingRatio:s.dampingRatio??0});
    else if(type==='relative'){const offset=raw.m_LinearOffset as {x:number;y:number}|undefined;joint=new MotorJoint({bodyA,bodyB,collideConnected:s.collideConnected??false,linearOffset:raw.m_AutoConfigureOffset?bodyA.getLocalPoint(bodyB.getPosition()):offset??{x:0,y:0},angularOffset:raw.m_AutoConfigureOffset?bodyB.getAngle()-bodyA.getAngle():-n(raw.m_AngularOffset,0)*Math.PI/180,maxForce:n(raw.m_MaxForce,0),maxTorque:n(raw.m_MaxTorque,0),correctionFactor:n(raw.m_CorrectionScale,.3)});}
    else if(type==='friction')joint=new FrictionJoint({...common,maxForce:n(raw.m_MaxForce,0),maxTorque:n(raw.m_MaxTorque,0)});
    else return null;
    return this.world.createJoint(joint);
  }
  update(dt: number) {
    if (this.paused) return;
    this.accumulator += Math.min(dt, .1) * this.speed;
    while (this.accumulator >= CONFIG.timestep) { this.step(); this.accumulator -= CONFIG.timestep; }
  }
  step() {
    const dt=CONFIG.timestep;this.beforeStep.forEach(fn=>fn(dt));this.world.step(dt,CONFIG.velocityIterations,CONFIG.positionIterations);
    for(const [joint,limit] of this.breakableJoints){if(!limit.entity.joints.includes(joint)){this.breakableJoints.delete(joint);continue;}const f=joint.getReactionForce(1/dt);if(Math.hypot(f.x,f.y)>limit.force||Math.abs(joint.getReactionTorque(1/dt))>limit.torque){this.world.destroyJoint(joint);this.breakableJoints.delete(joint);limit.entity.joints=limit.entity.joints.filter(j=>j!==joint);for(const [id,j] of limit.entity.jointById??[])if(j===joint)limit.entity.jointById!.delete(id);}}
    this.afterStep.forEach(fn=>fn(dt));
  }
  pick(x: number, y: number): Part | null {
    const p = Vec2(x, y);
    for (const e of [...this.entities].reverse()) for (const part of [...e.parts].reverse()) {
      if(!part.body.isActive())continue;
      for(let fixture=part.body.getFixtureList();fixture;fixture=fixture.getNext())if(fixture.testPoint(p))return part;
    }
    return null;
  }
  pickEntity(x:number,y:number):Entity|null {
    const part=this.pick(x,y);if(part)return part.body.getUserData() as Entity;
    for(const e of [...this.entities].reverse())for(const r of e.renderers??[]){
      if(r.enabled===false||e.metadata?.nodes.find(n=>n.id===r.nodeId)?.active===false)continue;const body=e.parts.find(p=>p.id===r.bodyId)?.body;const origin=body?.getPosition()??e.position??{x:0,y:0};const a=body?.getAngle()??e.angle??0;
      const cx=origin.x+r.position.x*Math.cos(a)-r.position.y*Math.sin(a),cy=origin.y+r.position.x*Math.sin(a)+r.position.y*Math.cos(a),total=a+r.angle;
      const dx=x-cx,dy=y-cy,lx=dx*Math.cos(total)+dy*Math.sin(total),ly=-dx*Math.sin(total)+dy*Math.cos(total),s=r.sprite;
      const sx=s.flipX?-1:1,sy=s.flipY?-1:1;
      if(Math.abs(lx-(.5-s.pivot.x)*s.width*sx)<s.width/2&&Math.abs(ly-(.5-s.pivot.y)*s.height*sy)<s.height/2)return e;
    }
    return null;
  }
  beginDrag(part: Part, x: number, y: number) {
    this.endDrag();
    if (!part.body.isDynamic()) return;
    this.drag = this.world.createJoint(new MouseJoint({ maxForce: Math.max(200, part.body.getMass() * 2000), frequencyHz: 8, dampingRatio: .8 }, this.ground, part.body, Vec2(x, y)))!;
    part.body.setAwake(true);
  }
  moveDrag(x: number, y: number) { this.drag?.setTarget(Vec2(x, y)); }
  endDrag() { if (this.drag) this.world.destroyJoint(this.drag); this.drag = null; }
  remove(entity: Entity) {
    this.endDrag();
    this.onRemove.forEach(fn=>fn(entity));
    for(const j of entity.joints)this.breakableJoints.delete(j);
    for (const part of entity.parts) this.world.destroyBody(part.body);
    this.entities = this.entities.filter(e => e !== entity);
    if(this.environment===entity){this.environment=null;this.ground.getFixtureList()?.setSensor(false);}
  }
  clear() { this.endDrag(); for (const e of [...this.entities]) this.remove(e); this.accumulator = 0; }
  freeze(entity: Entity) {
    this.endDrag();
    entity.frozen = !entity.frozen;
    for (const part of entity.parts) { part.body.setType(entity.frozen ? 'static' : part.initialType??'dynamic'); part.body.setAwake(true); }
  }
  rotate(entity: Entity, angle: number) {
    if(!entity.parts.length){entity.angle=(entity.angle??0)+angle;return;}
    const c = entity.parts.reduce((p, a) => Vec2.add(p, a.body.getPosition()), Vec2()).mul(1 / entity.parts.length);
    for (const part of entity.parts) {
      const p = Vec2.sub(part.body.getPosition(), c);
      part.body.setTransform(Vec2(c.x + p.x * Math.cos(angle) - p.y * Math.sin(angle), c.y + p.x * Math.sin(angle) + p.y * Math.cos(angle)), part.body.getAngle() + angle);
      part.body.setAwake(true);
    }
  }
  serialize(): SceneData {
    const save=(e:Entity):SavedEntity=>({kind:e.kind,frozen:e.frozen,...(e.rig?{rig:e.rig}:{}),...(e.catalogId?{catalogId:e.catalogId,prefabId:e.prefabId,position:e.position,angle:e.angle,activeJointIds:[...(e.jointById??new Map()).keys()]}:{}),systems:Object.fromEntries([...this.stateAdapters].map(([name,a])=>[name,a.capture(e)]).filter(([,value])=>value!==undefined)),parts:e.parts.map(p=>({...(p.id?{id:p.id}:{}),x:p.body.getPosition().x,y:p.body.getPosition().y,angle:p.body.getAngle(),vx:p.body.getLinearVelocity().x,vy:p.body.getLinearVelocity().y,av:p.body.getAngularVelocity()}))});
    return {format:'open-playground',version:2,buildId:this.assets?.buildId??null,...(this.environment?{environment:save(this.environment)}:{}),entities:this.entities.map(save)};
  }
  import(value: unknown) {
    const data = value as SceneData;
    if (!data || data.format !== 'open-playground' || ![1,2].includes(data.version) || !Array.isArray(data.entities) || data.entities.length > CONFIG.maxEntities) throw new Error('Unsupported scene file');
    if(data.environment&&data.environment.kind!=='prefab')throw new Error('Invalid scene environment');
    const savedEntities=[...(data.environment?[data.environment]:[]),...data.entities];
    const needsAssets=savedEntities.some(e=>e?.kind==='prefab');
    if(needsAssets&&(!this.assets||data.buildId!==this.assets.buildId))throw new Error('Scene game build does not match the extracted local assets');
    const expected = { human: 11, box: 1, ball: 1, plank: 1 };
    for (const e of savedEntities) {
      if(!e||!Array.isArray(e.parts)||e.parts.length>1000||typeof e.frozen!=='boolean')throw new Error('Invalid scene object');
      if(e.systems!==undefined&&(!e.systems||typeof e.systems!=='object'||Array.isArray(e.systems)||Object.keys(e.systems).some(name=>!this.stateAdapters.has(name))))throw new Error('Scene requires an unavailable simulation system');
      if(e.kind==='prefab'){
        const prefab=this.assets?.prefabs.get(e.catalogId??'');
        if(!prefab||e.prefabId!==(prefab.id??prefab.rootGameObjectId)||e.parts.length!==prefab.parts.length)throw new Error('Invalid scene prefab');
        if(e.parts.some((p,i)=>p.id!==prefab.parts[i].id))throw new Error('Scene body identifiers do not match the prefab');
        if(e.activeJointIds!==undefined&&(!Array.isArray(e.activeJointIds)||new Set(e.activeJointIds).size!==e.activeJointIds.length||e.activeJointIds.some(id=>!prefab.joints.some(j=>j.id===id&&j.enabled!==false))))throw new Error('Invalid scene joint identifiers');
        if(!e.position||![e.position.x,e.position.y,e.angle].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e7))throw new Error('Invalid scene coordinates');
      }else if(!kinds.includes(e.kind)||(e.rig!==undefined&&e.rig!=='local')||e.parts.length!==(e.kind==='human'&&e.rig==='local'?14:expected[e.kind]))throw new Error('Invalid scene object');
      if(e.rig==='local'&&!this.humanRig)throw new Error('This scene needs local game assets. Run the extraction script first.');
      for (const p of e.parts) if (!p || (['x','y','angle','vx','vy','av'] as const).some(k => typeof p[k] !== 'number' || !Number.isFinite(p[k]) || Math.abs(p[k]) > 1e7)) throw new Error('Invalid scene coordinates');
    }
    const original=[...this.entities],originalEnvironment=this.environment,staged:Entity[]=[];let stagedEnvironment:Entity|undefined;this.suppressHooks=true;
    try{
      // Stage the complete scene first; a failed adapter leaves the current scene intact.
      this.entities=[];
      for(const saved of savedEntities){
        const e=saved.kind==='prefab'?this.spawnPrefab(saved.catalogId!,saved.position!.x,saved.position!.y):this.spawn(saved.kind,0,0,saved.rig==='local');staged.push(e);e.angle=saved.angle??0;
        if(saved===data.environment){e.isEnvironment=true;stagedEnvironment=e;this.entities=this.entities.filter(other=>other!==e);}
        saved.parts.forEach((p,i)=>{e.parts[i].body.setTransform(Vec2(p.x,p.y),p.angle);e.parts[i].body.setLinearVelocity(Vec2(p.vx,p.vy));e.parts[i].body.setAngularVelocity(p.av);});if(saved.frozen)this.freeze(e);
        this.onSpawn.forEach(fn=>fn(e));
        for(const [name,state] of Object.entries(saved.systems??{}))if(this.stateAdapters.get(name)!.restore(e,state)===false)throw new Error(`Invalid ${name} simulation state`);
        if(saved.activeJointIds&&e.jointById)for(const [id,joint] of e.jointById)if(!saved.activeJointIds.includes(id)){this.world.destroyJoint(joint);this.breakableJoints.delete(joint);e.joints=e.joints.filter(j=>j!==joint);e.jointById.delete(id);}
      }
    }catch(error){for(const e of staged){this.onRemove.forEach(fn=>fn(e));for(const p of e.parts)this.world.destroyBody(p.body);for(const j of e.joints)this.breakableJoints.delete(j);}this.entities=original;throw error;}
    finally{this.suppressHooks=false;}
    this.entities=[...original,...staged];for(const e of original)this.remove(e);if(originalEnvironment)this.remove(originalEnvironment);
    this.environment=stagedEnvironment??null;this.entities=staged.filter(e=>e!==stagedEnvironment);this.ground.getFixtureList()?.setSensor(!!this.environment);this.accumulator=0;
  }
}
