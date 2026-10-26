import type {Entity,Part} from '../simulation';
import type {Fixture} from 'planck';

export function fixtureLayer(fixture:Fixture):number {
  const entity=fixture.getBody().getUserData() as Entity|undefined;
  const nodeId=(fixture.getUserData() as {sourceNodeId?:string}|undefined)?.sourceNodeId??entity?.parts.find(p=>p.body===fixture.getBody())?.metadata?.nodeId;
  return entity?.metadata?.nodes.find(n=>n.id===nodeId)?.layer??0;
}

/** BroadcastMessage targets the selected rigidbody GameObject and descendants,
 * rather than every controller sharing the prefab's transform root. */
export function targetsPart(entity:Entity,candidate:Part,target?:Part):boolean {
  if(!target||candidate===target)return true;
  const targetId=target.metadata?.nodeId;if(!targetId)return false;
  let nodeId=candidate.metadata?.nodeId;const visited=new Set<string>();
  while(nodeId&&!visited.has(nodeId)){
    if(nodeId===targetId)return true;visited.add(nodeId);
    nodeId=entity.metadata?.nodes.find(n=>n.id===nodeId)?.parentId??undefined;
  }
  return false;
}
