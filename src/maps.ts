import type { AssetLibrary,Prefab,PrefabPart,SourceNode } from './prefabs';
export interface MapEntry {id:string;name:string;identity:string;description:string;prefabUrl:string;thumbnail?:{url:string};preview?:{url:string};configs?:{component:{className:string;data:Record<string,unknown>}}[]}
export interface MapLibrary {maps:MapEntry[];load:(id:string)=>Promise<Prefab>}

export function normalizeMap(prefab:Prefab):Prefab{
  const synthetic:PrefabPart[]=[];
  for(const node of prefab.nodes as (SourceNode&{staticColliders?:PrefabPart['colliders']})[]){
    if(!node.staticColliders?.length)continue;
    const colliders=node.staticColliders.map(c=>{const dx=c.offset.x-node.position.x,dy=c.offset.y-node.position.y,angle=node.angle;return {...c,offset:{x:dx*Math.cos(angle)+dy*Math.sin(angle),y:-dx*Math.sin(angle)+dy*Math.cos(angle)},angle:(c.angle??0)-angle};});
    synthetic.push({id:`static:${node.id}`,nodeId:node.id,name:node.name,position:node.position,angle:node.angle,scale:node.scale,mass:0,linearDamping:0,angularDamping:0,gravityScale:0,bodyType:'static',colliders,metadata:{components:node.components}});
  }
  return {...prefab,parts:[...prefab.parts,...synthetic]};
}
export async function loadMapLibrary(assets:AssetLibrary|null):Promise<MapLibrary|null>{
  if(!assets)return null;
  try{
    const response=await fetch(`${import.meta.env.BASE_URL}local-assets/maps.json`);if(!response.ok||!response.headers.get('content-type')?.includes('json'))return null;
    const data=await response.json();if(!Array.isArray(data.maps))return null;
    const pending=new Map<string,Promise<Prefab>>();
    return {maps:data.maps,load:async id=>{
      if(assets.prefabs.has(id))return assets.prefabs.get(id)!;
      const entry=data.maps.find((m:MapEntry)=>m.id===id);if(!entry)throw new Error('Unknown environment');
      let promise=pending.get(id);if(!promise){promise=(async()=>{const r=await fetch(`${import.meta.env.BASE_URL}${entry.prefabUrl.replace(/^\//,'')}`);if(!r.ok)throw new Error('Environment has not been extracted');const raw=await r.json() as Prefab;if(raw.catalogId!==id||!Array.isArray(raw.parts))throw new Error('Invalid environment data');const prefab=normalizeMap(raw);assets.prefabs.set(id,prefab);return prefab;})();pending.set(id,promise);}
      try{return await promise;}finally{pending.delete(id);}
    }};
  }catch(error){console.info('Local environments unavailable.',error);return null;}
}
export function mapSettings(prefab:Prefab){
  const config=prefab.nodes.flatMap(n=>n.components).find(c=>c.className==='MapConfig')?.data;
  const settings=config?.Settings as Record<string,unknown>|undefined;
  const bounds=prefab.nodes.flatMap(n=>n.components).find(c=>c.className==='BoundingBoxBehaviour')?.data.BoundingBox as {m_Center?:{x:number;y:number};m_Extent?:{x:number;y:number}}|undefined;
  return {gravity:typeof settings?.Gravity==='number'?settings.Gravity:-9.81,ambientTemperature:typeof settings?.Ambient_temperature==='number'?settings.Ambient_temperature:18,bounds};
}
