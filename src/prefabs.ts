import type { RigCollider, RigPart, RigSprite } from './assets';

export interface SourceComponent { type: string; pathId: string; className?: string; file?:string; data: Record<string, unknown>; status?: string; properties?: {pathId:string;data:Record<string,unknown>} }
export interface SourceNode { id: string; name: string; parentId: string | null; position: { x: number; y: number }; angle: number; scale: { x: number; y: number }; active: boolean; layer?:number; bodyId?:string|null; components: SourceComponent[] }
export interface PrefabPart extends Omit<RigPart,'colliders'> {
  nodeId?: string; bodyType?: number | 'dynamic' | 'kinematic' | 'static'; fixedRotation?: boolean; bullet?: boolean;
  simulated?: boolean; constraints?:number; material?: {friction?:number;restitution?:number}; metadata?:{components:SourceComponent[]};
  colliders: (Omit<RigCollider,'type'> & { type: string; nodeId?:string; enabled?:boolean; density?:number; direction?: number; edgeRadius?: number; material?: { friction?: number; bounciness?: number; restitution?: number } | null; angle?: number })[];
  components?: SourceComponent[];
}
export interface PrefabJoint {
  id?: string; type?: string; bodyA: string; bodyB: string | null; anchorA: { x: number; y: number }; anchorB: { x: number; y: number };
  lowerAngle?: number; upperAngle?: number; enableLimit?: boolean; enableMotor?: boolean; motorSpeed?: number; maxMotorTorque?: number; maxMotorForce?: number; collideConnected?: boolean;
  distance?: number; maxDistanceOnly?: boolean; frequency?: number; dampingRatio?: number; axis?: { x: number; y: number }; angle?: number; lowerTranslation?: number; upperTranslation?: number;
  breakForce?: number | string; breakTorque?: number | string;
  enabled?:boolean;
  data?:Record<string,unknown>;
}
export interface PrefabRenderer { id: string; nodeId?:string; bodyId: string | null; position: { x: number; y: number }; angle: number; sprite: RigSprite; enabled?: boolean }
export interface Prefab {
  id?: string; catalogId: string; name: string; rootGameObjectId: string; parts: PrefabPart[]; joints: PrefabJoint[]; renderers: PrefabRenderer[]; nodes: SourceNode[]; unsupported?: string[]; status?: string;
}
export interface LocalCatalogItem { id: string; name: string; description: string; categoryId: string; visible: boolean; locked: boolean; order: string; sprite: RigSprite | null; behaviorPorted: boolean }
export interface AssetLibrary { buildId: string; catalog: { categories: { id: string; name: string }[]; items: LocalCatalogItem[] }; prefabs: Map<string, Prefab>; loadPrefab?: (id:string)=>Promise<Prefab> }
export async function loadAssetLibrary(): Promise<AssetLibrary | null> {
  const base=import.meta.env.BASE_URL;
  try {
    const responses=await Promise.all(['catalog.json','manifest.json'].map(file=>fetch(`${base}local-assets/${file}`)));
    if(responses.some(r=>!r.ok||!r.headers.get('content-type')?.includes('json')))return null;
    const [catalog,manifest]=await Promise.all(responses.map(r=>r.json()));
    if(!Array.isArray(catalog.items))throw new Error('Unsupported local asset library');
    const buildId=manifest.sources?.filter((s:{path:string})=>['Managed/Assembly-CSharp.dll','sharedassets0.assets'].includes(s.path)).map((s:{sha256:string})=>s.sha256).join(':')??manifest.buildId??'unknown';
    const prefabs=new Map<string,Prefab>(),pending=new Map<string,Promise<Prefab>>();
    const loadPrefab=async(id:string):Promise<Prefab>=>{
      if(prefabs.has(id))return prefabs.get(id)!;
      if(!catalog.items.some((i:LocalCatalogItem)=>i.id===id))throw new Error('Unknown catalogue item');
      let request=pending.get(id);if(!request){request=(async()=>{const response=await fetch(`${base}local-assets/prefabs/${encodeURIComponent(id)}.json`);if(!response.ok)throw new Error('This prefab has not been extracted');const prefab=await response.json() as Prefab;if(prefab.catalogId!==id||!Array.isArray(prefab.parts)||!Array.isArray(prefab.renderers))throw new Error('Unsupported prefab data');prefabs.set(id,prefab);return prefab;})();pending.set(id,request);}
      try{return await request;}finally{pending.delete(id);}
    };
    return {buildId,catalog,prefabs,loadPrefab};
  }catch(error){console.info('Local prefab library unavailable.',error);return null;}
}
