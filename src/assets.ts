export interface RigSprite {
  url: string; width: number; height: number; pivot: { x: number; y: number }; pixelsPerUnit: number; sortingOrder: number; sortingLayer?: number; flipX: boolean; flipY: boolean; color?: {r:number;g:number;b:number;a:number};
}
export interface RigCollider {
  type: 'box' | 'circle' | 'polygon'; offset: { x: number; y: number }; isTrigger?: boolean; size?: { x: number; y: number }; radius?: number; points?: { x: number; y: number }[]; paths?: { x: number; y: number }[][];
}
export interface RigPart {
  id: string; name: string; position: { x: number; y: number }; angle: number; scale: { x: number; y: number }; mass: number; linearDamping: number; angularDamping: number; gravityScale?: number; colliders: RigCollider[]; sprite?: RigSprite;
}
export interface HumanRig {
  parts: RigPart[];
  joints: { bodyA: string; bodyB: string; anchorA: { x: number; y: number }; anchorB: { x: number; y: number }; lowerAngle: number; upperAngle: number; enableLimit: boolean; enableMotor: boolean; motorSpeed: number; maxMotorTorque: number; collideConnected: boolean }[];
}
export async function loadHumanRig(): Promise<HumanRig | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}local-assets/human-rig.json`);
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null;
    const value = await response.json() as HumanRig;
    if (!Array.isArray(value.parts) || !Array.isArray(value.joints) || value.parts.length !== 14) throw new Error('Unsupported local human rig');
    return value;
  } catch (error) { console.info('Local human rig unavailable; using primitive mannequin.',error); return null; }
}
