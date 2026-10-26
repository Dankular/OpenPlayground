import type {Entity} from './simulation';
import type {SourceNode} from './prefabs';

type Point={x:number;y:number};
type Pose={position:Point;scale:Point;angle:number};
const finite=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
/** Renderer-only local transform animation. Collider/body geometry stays owned
 * by the physics adapters. Local TRS is recovered from original Transform data.
 */
export class VisualTransforms {
  private overrides=new WeakMap<Entity,Map<string,Point>>();
  private originals=new WeakMap<Entity,Map<string,{width:number;height:number;flipX:boolean;flipY:boolean}>>();
  setScale(entity:Entity,pointer:unknown,scale:Point):void {
    if(![scale.x,scale.y].every(Number.isFinite))return;
    const id=String((pointer as {m_PathID?:unknown})?.m_PathID??''),nodes=entity.metadata?.nodes??[];
    const target=nodes.find(n=>n.components.some(c=>c.type==='Transform'&&c.pathId===id));if(!target)return;
    let changes=this.overrides.get(entity);if(!changes){changes=new Map();this.overrides.set(entity,changes);}changes.set(target.id,{...scale});
    let originals=this.originals.get(entity);if(!originals){originals=new Map();this.originals.set(entity,originals);for(const renderer of entity.renderers??[]){const node=nodes.find(n=>n.id===renderer.nodeId);if(!node)continue;const component=node.components.find(c=>c.pathId===renderer.id),size=component?.data.m_Size as Point|undefined;originals.set(renderer.id,{width:node.scale.x?renderer.sprite.width/Math.abs(node.scale.x):finite(size?.x,renderer.sprite.width),height:node.scale.y?renderer.sprite.height/Math.abs(node.scale.y):finite(size?.y,renderer.sprite.height),flipX:!!renderer.sprite.flipX!==(node.scale.x<0),flipY:!!renderer.sprite.flipY!==(node.scale.y<0)});}}
    const poses=new Map<string,Pose>();
    const pose=(node:SourceNode):Pose=>{
      const cached=poses.get(node.id);if(cached)return cached;
      const transform=node.components.find(c=>c.type==='Transform')?.data;
      const localPosition=transform?.m_LocalPosition as Point|undefined,localScale=changes!.get(node.id)??transform?.m_LocalScale as Point|undefined;
      const rotation=transform?.m_LocalRotation as {z?:number;w?:number}|undefined;
      const parent=nodes.find(n=>n.id===node.parentId);let result:Pose;
      if(!parent)result={position:{...node.position},angle:node.angle,scale:changes!.get(node.id)??{...node.scale}};
      else{const p=pose(parent),x=finite(localPosition?.x,0)*p.scale.x,y=finite(localPosition?.y,0)*p.scale.y;result={position:{x:p.position.x+x*Math.cos(p.angle)-y*Math.sin(p.angle),y:p.position.y+x*Math.sin(p.angle)+y*Math.cos(p.angle)},scale:{x:p.scale.x*finite(localScale?.x,1),y:p.scale.y*finite(localScale?.y,1)},angle:p.angle+2*Math.atan2(finite(rotation?.z,0),finite(rotation?.w,1))};}
      poses.set(node.id,result);return result;
    };
    for(const renderer of entity.renderers??[]){
      const node=nodes.find(n=>n.id===renderer.nodeId),original=originals.get(renderer.id);if(!node||!original)continue;
      let ancestor:SourceNode|undefined=node,affected=false;while(ancestor){if(changes.has(ancestor.id)){affected=true;break;}ancestor=nodes.find(n=>n.id===ancestor!.parentId);}if(!affected)continue;
      const next=pose(node),part=entity.parts.find(p=>p.id===renderer.bodyId),bodyNode=nodes.find(n=>n.id===part?.metadata?.nodeId),origin=bodyNode?.position??{x:0,y:0},angle=bodyNode?.angle??0,dx=next.position.x-origin.x,dy=next.position.y-origin.y;
      renderer.position={x:dx*Math.cos(angle)+dy*Math.sin(angle),y:-dx*Math.sin(angle)+dy*Math.cos(angle)};renderer.angle=next.angle-angle;
      renderer.sprite={...renderer.sprite,width:original.width*Math.abs(next.scale.x),height:original.height*Math.abs(next.scale.y),flipX:original.flipX!==(next.scale.x<0),flipY:original.flipY!==(next.scale.y<0)};
      // The renderer cache recreates geometry when these dimensions change.
    }
  }
}
