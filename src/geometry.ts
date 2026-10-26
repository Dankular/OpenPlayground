import earcut from 'earcut';
import { Box, Circle, Edge, Polygon, Vec2, type Shape } from 'planck';
import type { PrefabPart } from './prefabs';

export function polygonPieces(input: {x:number;y:number}[]): {x:number;y:number}[][] {
  const points=input.filter((p,i)=>i===0||Math.hypot(p.x-input[i-1].x,p.y-input[i-1].y)>1e-7);
  if(points.length>2&&Math.hypot(points[0].x-points.at(-1)!.x,points[0].y-points.at(-1)!.y)<1e-7)points.pop();
  if(points.length<3)return [];
  if(points.length>10000)throw new Error('Collider exceeds polygon vertex limit');
  const triangles=earcut(points.flatMap(p=>[p.x,p.y]));
  const result=[];
  for(let i=0;i<triangles.length;i+=3){const t=[points[triangles[i]],points[triangles[i+1]],points[triangles[i+2]]];const area=(t[1].x-t[0].x)*(t[2].y-t[0].y)-(t[1].y-t[0].y)*(t[2].x-t[0].x);if(Math.abs(area)>1e-10)result.push(area>0?t:[t[0],t[2],t[1]]);}
  return result;
}

export function colliderShapes(c: PrefabPart['colliders'][number]): Shape[] {
  const o=c.offset??{x:0,y:0};
  const rotate=(p:{x:number;y:number})=>{const a=c.angle??0;return Vec2(p.x*Math.cos(a)-p.y*Math.sin(a)+o.x,p.x*Math.sin(a)+p.y*Math.cos(a)+o.y);};
  if(c.type==='box'&&c.size&&c.size.x>0&&c.size.y>0){const shape=Box(c.size.x/2,c.size.y/2,Vec2(o.x,o.y),c.angle??0);if(c.edgeRadius&&c.edgeRadius>0)shape.m_radius=c.edgeRadius;return [shape];}
  if(c.type==='circle'&&c.radius&&c.radius>0)return [Circle(Vec2(o.x,o.y),c.radius)];
  if(c.type==='polygon')return (c.paths??(c.points?[c.points]:[])).flatMap(path=>polygonPieces(path).map(triangle=>Polygon(triangle.map(rotate))));
  if(c.type==='edge'){
    const points=c.points??c.paths?.[0]??[];const shapes:Shape[]=[];
    for(let i=1;i<points.length;i++)if(Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y)>1e-7){const edge=Edge(rotate(points[i-1]),rotate(points[i]));if(c.edgeRadius&&c.edgeRadius>0)edge.m_radius=c.edgeRadius;shapes.push(edge);}
    return shapes;
  }
  if(c.type==='capsule'&&c.size){
    // CapsuleDirection2D: Vertical=0, Horizontal=1.
    const horizontal=c.direction===1;const radius=Math.min(c.size.x,c.size.y)/2;const half=Math.max(0,(horizontal?c.size.x:c.size.y)/2-radius);
    if(radius<=0)return [];
    if(half<1e-7)return [Circle(Vec2(o.x,o.y),radius)];
    const caps=[Circle(rotate({x:horizontal?-half:0,y:horizontal?0:-half}),radius),Circle(rotate({x:horizontal?half:0,y:horizontal?0:half}),radius)];
    return [...caps,Box(horizontal?half:radius,horizontal?radius:half,Vec2(o.x,o.y),c.angle??0)];
  }
  return [];
}
