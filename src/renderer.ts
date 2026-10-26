import * as THREE from 'three';
import { type Entity, type Part, Simulation } from './simulation';

export class SandboxRenderer {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-10, 10, 7, -7, .1, 100);
  renderer: THREE.WebGLRenderer;
  center = new THREE.Vector2(0, 4);
  viewHeight = 12;
  private visuals = new Map<Part, THREE.Group>();
  private prefabVisuals = new Map<Entity, Map<string,THREE.Group>>();
  private rendererOverrides = new Map<Entity,Map<string,boolean>>();
  private effects: {object:THREE.Line|THREE.Mesh;remaining:number;lifetime:number;explosion?:number}[]=[];
  physicalState?: (part:Part)=>{temperature:number;burnProgress:number;onFire:boolean}|undefined;
  private textureLoader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private resizeObserver: ResizeObserver;
  private selection = new THREE.Box3Helper(new THREE.Box3(), 0x9dda7a);
  private fallbackObjects: THREE.Object3D[]=[];
  constructor(readonly container: HTMLElement, readonly simulation: Simulation) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x20252b);
    container.append(this.renderer.domElement);
    this.camera.position.z = 20;
    const grid = new THREE.GridHelper(200, 200, 0x3a424a, 0x2a3139);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -2;
    this.scene.add(grid);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 100), new THREE.MeshBasicMaterial({ color: 0x363d43 }));
    ground.position.set(0, -50, -1);
    this.scene.add(ground);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1000, .045), new THREE.MeshBasicMaterial({ color: 0x77806e }));
    line.position.set(0, -.022, 0);
    this.scene.add(line);
    this.fallbackObjects.push(grid,ground,line);
    this.selection.visible = false;
    (this.selection.material as THREE.Material).depthTest = false;
    this.selection.renderOrder = 100;
    this.scene.add(this.selection);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w,h);
    const halfW = this.viewHeight * w / Math.max(h, 1) / 2;
    this.camera.left = -halfW; this.camera.right = halfW;
    this.camera.top = this.viewHeight / 2; this.camera.bottom = -this.viewHeight / 2;
    this.camera.position.x = this.center.x; this.camera.position.y = this.center.y;
    this.camera.updateProjectionMatrix();
  }
  toWorld(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector3((clientX-r.left)/r.width*2-1, -(clientY-r.top)/r.height*2+1, 0).unproject(this.camera);
    return { x: p.x, y: p.y };
  }
  pan(dx: number, dy: number) {
    const scale = this.viewHeight / this.container.clientHeight;
    this.center.x -= dx * scale; this.center.y += dy * scale;
    this.resize();
  }
  zoom(factor: number, clientX: number, clientY: number) {
    const before = this.toWorld(clientX, clientY);
    this.viewHeight = THREE.MathUtils.clamp(this.viewHeight * factor, .4, 2000);
    this.resize();
    const after = this.toWorld(clientX, clientY);
    this.center.x += before.x - after.x; this.center.y += before.y-after.y;
    this.resize();
  }
  home() { this.center.set(0,4); this.viewHeight = 12; this.resize(); }
  setRendererEnabled(entity:Entity,id:string,enabled:boolean){let overrides=this.rendererOverrides.get(entity);if(!overrides){overrides=new Map();this.rendererOverrides.set(entity,overrides);}overrides.set(id,enabled);}
  addTracer(trace:{start:{x:number;y:number};end:{x:number;y:number};lifetime:number}){
    const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(trace.start.x,trace.start.y,1),new THREE.Vector3(trace.end.x,trace.end.y,1)]);
    const object=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xffdb8a,transparent:true,depthTest:false}));object.renderOrder=10000;this.scene.add(object);const lifetime=THREE.MathUtils.clamp(trace.lifetime,.02,1);this.effects.push({object,remaining:lifetime,lifetime});this.trimEffects();
  }
  addExplosion(position:{x:number;y:number},range:number){
    const object=new THREE.Mesh(new THREE.RingGeometry(.65,1,40),new THREE.MeshBasicMaterial({color:0xffb65c,transparent:true,opacity:.7,depthTest:false,side:THREE.DoubleSide}));object.position.set(position.x,position.y,1);object.renderOrder=11000;object.scale.setScalar(.1);this.scene.add(object);this.effects.push({object,remaining:.35,lifetime:.35,explosion:Math.max(.2,range)});this.trimEffects();
  }
  private trimEffects(){while(this.effects.length>512){const e=this.effects.shift()!;this.scene.remove(e.object);e.object.geometry.dispose();(e.object.material as THREE.Material).dispose();}}
  clearEffects(){for(const effect of this.effects){this.scene.remove(effect.object);effect.object.geometry.dispose();(effect.object.material as THREE.Material).dispose();}this.effects=[];}
  updateEffects(dt:number){for(const effect of this.effects){effect.remaining-=dt;const material=effect.object.material as THREE.MeshBasicMaterial;material.opacity=Math.max(0,effect.remaining/effect.lifetime);if(effect.explosion)effect.object.scale.setScalar((1-effect.remaining/effect.lifetime)*effect.explosion);}this.effects=this.effects.filter(effect=>{if(effect.remaining>0)return true;this.scene.remove(effect.object);effect.object.geometry.dispose();(effect.object.material as THREE.Material).dispose();return false;});}
  private createVisual(part: Part, kind: string) {
    const g = new THREE.Group();
    if(part.sprite) {
      g.add(this.spriteMesh(part.sprite));
      this.scene.add(g);this.visuals.set(part,g);return g;
    }
    const geometry = part.shape === 'circle' ? new THREE.CircleGeometry(part.width/2,32) : new THREE.PlaneGeometry(part.width, part.height);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: part.color }));
    g.add(mesh);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x11151a, transparent: true, opacity: .8 }));
    outline.position.z = .01; g.add(outline);
    if (kind === 'box') {
      for (const direction of [-1,1]) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(part.width * .94,.055), new THREE.MeshBasicMaterial({color:0x795935}));
        stripe.rotation.z = direction * Math.PI/4; stripe.position.z = .02; g.add(stripe);
      }
      for (const y of [-.34,.34]) {
        const brace = new THREE.Mesh(new THREE.PlaneGeometry(.9,.1),new THREE.MeshBasicMaterial({color:0xcba66f}));
        brace.position.set(0,y,.03);g.add(brace);
      }
    }
    if (kind === 'plank') {
      const grain = new THREE.Mesh(new THREE.PlaneGeometry(part.width-.1,.016),new THREE.MeshBasicMaterial({color:0x977046}));
      grain.position.z=.02;g.add(grain);
    }
    if (kind === 'ball') {
      const shine = new THREE.Mesh(new THREE.CircleGeometry(.065,12),new THREE.MeshBasicMaterial({color:0xd8e3eb}));
      shine.position.set(-.12,.12,.02);g.add(shine);
    }
    if (part.label === 'Head') {
      const eye = new THREE.Mesh(new THREE.PlaneGeometry(.045,.035),new THREE.MeshBasicMaterial({color:0x343138}));
      eye.position.set(.09,.025,.02);g.add(eye);
    }
    this.scene.add(g);
    this.visuals.set(part,g);
    return g;
  }
  private spriteMesh(s:NonNullable<Part['sprite']>) {
    let texture=this.textures.get(s.url);
    if(!texture){texture=this.textureLoader.load(`${import.meta.env.BASE_URL}${s.url.replace(/^\//,'')}`);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.colorSpace=THREE.SRGBColorSpace;this.textures.set(s.url,texture);}
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.01,depthWrite:false,opacity:s.color?.a??1,color:s.color?new THREE.Color(s.color.r,s.color.g,s.color.b):0xffffff});
    material.userData.sourceColor=material.color.clone();
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(s.width,s.height),material);
    mesh.position.set((.5-s.pivot.x)*s.width*(s.flipX?-1:1),(.5-s.pivot.y)*s.height*(s.flipY?-1:1),0);mesh.scale.set(s.flipX?-1:1,s.flipY?-1:1,1);mesh.renderOrder=(s.sortingLayer??0)*1000+(s.sortingOrder??0);return mesh;
  }
  private disposeGroup(g:THREE.Group){this.scene.remove(g);g.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){o.geometry.dispose();const m=o.material;(Array.isArray(m)?m:[m]).forEach(m=>m.dispose());}});}
  render(selected: Entity | null) {
    const entities=this.simulation.renderEntities;
    this.fallbackObjects.forEach(o=>o.visible=!this.simulation.environment);
    const current = new Set(entities.filter(e=>e.kind!=='prefab').flatMap(e=>e.parts));
    for (const [part,g] of this.visuals) if (!current.has(part)) {
      this.disposeGroup(g);
      this.visuals.delete(part);
    }
    const bounds = new THREE.Box3();
    for(const [e,groups] of this.prefabVisuals)if(!entities.includes(e)){for(const g of groups.values())this.disposeGroup(g);this.prefabVisuals.delete(e);this.rendererOverrides.delete(e);}
    entities.filter(e=>e.kind!=='prefab').forEach((e, ei)=>e.parts.forEach((part, pi)=>{
      const g = this.visuals.get(part) ?? this.createVisual(part,e.kind);
      const p = part.body.getPosition();
      g.position.set(p.x,p.y,ei*.002+pi*.003);g.rotation.z=part.body.getAngle();
      if (e===selected) { g.updateMatrixWorld(true);bounds.expandByObject(g); }
    }));
    entities.filter(e=>e.kind==='prefab').forEach(e=>{
      let groups=this.prefabVisuals.get(e);if(!groups){groups=new Map();this.prefabVisuals.set(e,groups);}
      for(const r of e.renderers??[]){if(!r.sprite)continue;let g=groups.get(r.id);const active=e.metadata?.nodes.find(n=>n.id===r.nodeId)?.active!==false;const enabled=this.rendererOverrides.get(e)?.get(r.id)??(r.enabled!==false&&active);if(!enabled){if(g)g.visible=false;continue;}if(!g){g=new THREE.Group();g.add(this.spriteMesh(r.sprite));groups.set(r.id,g);this.scene.add(g);}g.visible=true;
        const part=e.parts.find(p=>p.id===r.bodyId),body=part?.body;
        const state=part?this.physicalState?.(part):undefined;
        if(state)g.traverse(child=>{if(child instanceof THREE.Mesh){const m=child.material as THREE.MeshBasicMaterial;if(m.userData.sourceColor){m.color.copy(m.userData.sourceColor).multiplyScalar(1-.8*THREE.MathUtils.clamp(state.burnProgress,0,1));const glow=THREE.MathUtils.clamp((state.temperature-300)/1200,0,.75);if(glow>0)m.color.lerp(new THREE.Color(0xff6b2c),glow);}}});
        const root=body?.getPosition()??e.position??{x:0,y:0};const a=body?.getAngle()??e.angle??0;
        g.position.set(root.x+r.position.x*Math.cos(a)-r.position.y*Math.sin(a),root.y+r.position.x*Math.sin(a)+r.position.y*Math.cos(a),.05);g.rotation.z=a+r.angle;
        if(e===selected){g.updateMatrixWorld(true);bounds.expandByObject(g);}
      }
    });
    this.selection.visible=!!selected&&!bounds.isEmpty();
    if(this.selection.visible) { bounds.expandByScalar(.07); this.selection.box.copy(bounds); this.selection.updateMatrixWorld(true); }
    this.renderer.render(this.scene,this.camera);
  }
}
