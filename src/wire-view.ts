import * as THREE from 'three';
import {wireVertices,type Wire,type WireKind} from './systems/wires';

/** Tool widths are the shipped DistanceWireTool defaults (.05) and HeatPipeTool
 * override (.1). Flat line colors/pulse markers adapt native line materials;
 * the original animated line shaders are not reconstructed here.
 */
export const CONNECTION_TOOLS:{kind:WireKind;name:string;description:string;color:number;width:number}[]=[
  {kind:'energy',name:'Energy wire',description:'Transfers electrical charge between objects.',color:0x10132f,width:.05},
  {kind:'copper',name:'Copper wire',description:'Conducts charge; can break under force or burn.',color:0xb97b4b,width:.05},
  {kind:'heat',name:'Heat pipe',description:'Exchanges temperature and holds a fixed distance.',color:0x889ca7,width:.1},
  {kind:'activation',name:'Activation wire',description:'Sends use signals from the first object to the second.',color:0x91ed60,width:.05},
  {kind:'blood',name:'Liquid conduit',description:'Transfers mixtures between liquid containers.',color:0x952e40,width:.05},
  {kind:'rope',name:'Rope',description:'A flexible tether that can snap or burn.',color:0xb39a75,width:.05},
  {kind:'cable',name:'Cable',description:'A strong flexible tether.',color:0x545a62,width:.05},
  {kind:'rigid',name:'Rigid wire',description:'Holds the two anchors at a fixed distance.',color:0x8a979e,width:.08},
  {kind:'fixed',name:'Fixed cable',description:'Keeps connected objects in the same relative pose.',color:0x53626b,width:.06},
  {kind:'spring',name:'Spring',description:'An elastic connection with native 2 Hz spring behavior.',color:0x919f94,width:.2},
  {kind:'strong-spring',name:'Strong spring',description:'A firmer elastic connection with native 8 Hz behavior.',color:0x6c858f,width:.2},
  {kind:'chain',name:'Chain',description:'A flexible mechanical chain.',color:0x89949d,width:.1},
  {kind:'bandage',name:'Bandage',description:'Wrap a limb to reduce bleeding and support healing.',color:0xd3cbb7,width:.07},
];
export interface ConnectionPreview {a:{x:number;y:number};b:{x:number;y:number};kind:WireKind;channel:0|1|2}
interface Visual {mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;arrow:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;anchors:THREE.Group}
export function distanceToPolyline(point:{x:number;y:number},points:readonly{x:number;y:number}[]):number{
  let closest=Infinity;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?THREE.MathUtils.clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/length,0,1):0;closest=Math.min(closest,Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy));}
  return closest;
}
export class ConnectionRenderer {
  wires:()=>Iterable<Wire>=()=>[];
  preview:ConnectionPreview|null=null;
  selectedId:number|null=null;
  private visuals=new Map<number,Visual>();
  private previewMesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  constructor(readonly scene:THREE.Scene){this.previewMesh=this.line();this.previewMesh.material.transparent=true;this.previewMesh.material.opacity=.65;this.previewMesh.visible=false;scene.add(this.previewMesh);}
  private line(){const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:0xcccccc,side:THREE.DoubleSide,depthTest:false,depthWrite:false,transparent:true}));mesh.renderOrder=12000;return mesh;}
  private ribbon(mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>,points:readonly{x:number;y:number}[],width:number){
    const previousPosition=mesh.geometry.getAttribute('position'),previousUv=mesh.geometry.getAttribute('uv');
    const positions=previousPosition?.array.length===Math.max(0,points.length-1)*18?previousPosition.array as Float32Array:new Float32Array(Math.max(0,points.length-1)*18),uvs=previousUv?.array.length===Math.max(0,points.length-1)*12?previousUv.array as Float32Array:new Float32Array(Math.max(0,points.length-1)*12);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy)||1,nx=-dy/distance*width/2,ny=dx/distance*width/2;
      const quad=[[a.x+nx,a.y+ny],[a.x-nx,a.y-ny],[b.x+nx,b.y+ny],[b.x+nx,b.y+ny],[a.x-nx,a.y-ny],[b.x-nx,b.y-ny]];
      for(let j=0;j<6;j++){const at=(i-1)*18+j*3;positions[at]=quad[j][0];positions[at+1]=quad[j][1];positions[at+2]=.15;}
      uvs.set([0,1,0,0,1,1,1,1,0,0,1,0],(i-1)*12);
    }
    if(previousPosition?.array===positions)previousPosition.needsUpdate=true;else mesh.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));if(previousUv?.array===uvs)previousUv.needsUpdate=true;else mesh.geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));mesh.geometry.computeBoundingSphere();
  }
  private visual():Visual{
    const mesh=this.line(),arrow=this.line(),anchors=new THREE.Group();arrow.renderOrder=12002;
    for(let i=0;i<2;i++){const dot=new THREE.Mesh(new THREE.CircleGeometry(.04,12),new THREE.MeshBasicMaterial({color:0xd9efc2,depthTest:false,depthWrite:false,transparent:true}));dot.renderOrder=12003;anchors.add(dot);}
    this.scene.add(mesh,arrow,anchors);return {mesh,arrow,anchors};
  }
  private dispose(visual:Visual){this.scene.remove(visual.mesh,visual.arrow,visual.anchors);visual.mesh.geometry.dispose();visual.mesh.material.dispose();visual.arrow.geometry.dispose();visual.arrow.material.dispose();visual.anchors.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.dispose();}});}
  pick(point:{x:number;y:number},tolerance:number):Wire|null{
    let selected:Wire|null=null,closest=tolerance;
    for(const wire of this.wires()){const distance=distanceToPolyline(point,wireVertices(wire));if(distance<closest){closest=distance;selected=wire;}}
    return selected;
  }
  render(time:number,pixelSize:number){
    const active=new Set<number>();
    for(const wire of this.wires()){
      active.add(wire.id);let visual=this.visuals.get(wire.id);if(!visual){visual=this.visual();this.visuals.set(wire.id,visual);}
      const style=CONNECTION_TOOLS.find(t=>t.kind===wire.kind)!,points=wireVertices(wire),selected=wire.id===this.selectedId;
      this.ribbon(visual.mesh,points,selected?Math.max(style.width*1.6,pixelSize*3):style.width);
      const color=wire.kind==='activation'?[0x81ed5a,0xf16f58,0x77acff][wire.channel]:style.color;
      visual.mesh.material.color.setHex(selected?0xd8eac5:color);
      if(wire.kind==='blood'&&!selected){const c=wire.liquidColor;visual.mesh.material.color.setRGB(THREE.MathUtils.clamp(c.r,0,1),THREE.MathUtils.clamp(c.g,0,1),THREE.MathUtils.clamp(c.b,0,1));if(c.a<.01)visual.mesh.material.color.setHex(0x693648);}
      if(wire.kind==='bandage'&&!selected&&wire.soakAmount>0){const c=wire.liquidColor;visual.mesh.material.color.setRGB(THREE.MathUtils.clamp(c.r,0,1),THREE.MathUtils.clamp(c.g,0,1),THREE.MathUtils.clamp(c.b,0,1));}
      if(wire.kind==='heat'&&!selected){const heat=THREE.MathUtils.clamp((wire.cableTemperature-100)/1000,0,1);visual.mesh.material.color.lerp(new THREE.Color(0xff7c3f),heat);}
      if(wire.kind==='activation'&&time-wire.lastSignalTime<.2)visual.mesh.material.color.lerp(new THREE.Color(0xffffff),.7);
      const forward=wire.kind==='activation'||wire.kind==='blood'&&Math.abs(wire.flow)>.001;visual.arrow.visible=forward;
      if(forward){
        const fraction=wire.kind==='activation'?.7:.15+(((time*Math.sign(wire.flow)*.6)%1+1)%1)*.7,index=Math.min(points.length-2,Math.floor(fraction*(points.length-1))),a=points[index],b=points[index+1];
        const direction=wire.kind==='blood'&&wire.flow<0?-1:1,angle=Math.atan2(b.y-a.y,b.x-a.x)+(direction<0?Math.PI:0),size=Math.max(.13,pixelSize*7),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
        const geometry=new Float32Array([size,0,.17,-size*.5,size*.55,.17,-size*.5,-size*.55,.17]);
        for(let i=0;i<3;i++){const x=geometry[i*3],y=geometry[i*3+1];geometry[i*3]=cx+x*Math.cos(angle)-y*Math.sin(angle);geometry[i*3+1]=cy+x*Math.sin(angle)+y*Math.cos(angle);}
        visual.arrow.geometry.setAttribute('position',new THREE.BufferAttribute(geometry,3));visual.arrow.geometry.computeBoundingSphere();visual.arrow.material.color.copy(visual.mesh.material.color).lerp(new THREE.Color(0xffffff),.25);
      }
      visual.anchors.visible=selected;visual.anchors.children.forEach((dot,i)=>{const p=points[i?points.length-1:0];dot.position.set(p.x,p.y,.18);dot.scale.setScalar(Math.max(1,pixelSize*4/.04));});
    }
    for(const [id,visual]of this.visuals)if(!active.has(id)){this.dispose(visual);this.visuals.delete(id);}
    this.previewMesh.visible=!!this.preview;if(this.preview){this.ribbon(this.previewMesh,[this.preview.a,this.preview.b],.04);this.previewMesh.material.color.setHex(this.preview.kind==='activation'?[0x81ed5a,0xf16f58,0x77acff][this.preview.channel]:0xb6d88a);}
  }
}
