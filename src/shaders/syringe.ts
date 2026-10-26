import * as THREE from 'three';
import shaderLab from './source/syringe.shader?raw';
import materialJson from './source/syringe-material.json?raw';
import type {BodySprite} from './body';
import {bodyColorChannelToLinear} from './body';

export interface SyringeVisualState {color:{r:number;g:number;b:number;a:number};scaledAmount:number;pressureMode:number}
const sourceMaterial=JSON.parse(materialJson) as {m_SavedProperties:{m_Floats:[string,number][]}};
const floats=Object.fromEntries(sourceMaterial.m_SavedProperties.m_Floats);

/** Shipped shader865 GLCore fragment, retaining its fill mask and flow math.
 * Only desktop declarations and the browser framebuffer transfer are adapted.
 */
export function adaptSyringeFragment(source:string,linearProject=true):string {
  const text=source.replace(/\r\n/g,'\n'),start=text.indexOf('SubProgram "glcore '),open=text.indexOf('"#ifdef VERTEX',start),end=text.indexOf('\n"\n}',open);
  if(start<0||open<0||end<0)throw new Error('Syringe shader GLCore block is missing');
  const block=text.slice(open+1,end),fragment=block.indexOf('#ifdef FRAGMENT'),match=block.slice(fragment).match(/^uniform[ \t]+vec4[ \t]+_Time\s*;/m);
  if(fragment<0||match?.index===undefined)throw new Error('Syringe fragment uniforms are missing');
  let result=block.slice(fragment+match.index,block.lastIndexOf('#endif')).replace(/UNITY_LOCATION\(\d+\)\s*/g,'').replace(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*/g,'');
  if(!result.includes('_LiquidColour')||!result.includes('_Direction')||!result.includes('SV_Target0'))throw new Error('Unexpected syringe fragment');
  if(linearProject)result=result.replace(/\n\s*return;\s*\n}/,'\n    SV_Target0.rgb = mix(SV_Target0.rgb * 12.92, 1.055 * pow(max(SV_Target0.rgb, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), SV_Target0.rgb));\n    return;\n}');
  return 'precision highp float;\nprecision highp int;\n'+result;
}
const vertex=`precision highp float;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform vec4 _SpriteUvRect;
in vec3 position;
in vec2 uv;
out vec2 vs_TEXCOORD0;
void main(){vs_TEXCOORD0=_SpriteUvRect.xy+uv*_SpriteUvRect.zw;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
export class SyringeShaderLibrary {
  private loader=new THREE.TextureLoader();private textures=new Map<string,THREE.Texture>();
  constructor(readonly linearProject=true){}
  create(sprite:BodySprite):THREE.RawShaderMaterial|null {
    const source=sprite.sourceTexture,rect=sprite.uvRect;if(!source||!rect||(sprite.packingRotation??0)!==0)return null;
    let texture=this.textures.get(source.url);
    if(!texture){texture=this.loader.load(`${import.meta.env.BASE_URL}${source.url.replace(/^\//,'')}`);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.colorSpace=this.linearProject?THREE.SRGBColorSpace:THREE.NoColorSpace;this.textures.set(source.url,texture);}
    const material=new THREE.RawShaderMaterial({vertexShader:vertex,fragmentShader:adaptSyringeFragment(shaderLab,this.linearProject),glslVersion:THREE.GLSL3,transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,uniforms:{_MainTex:{value:texture},_SpriteUvRect:{value:new THREE.Vector4(rect.x,rect.y,rect.width,rect.height)},_Time:{value:new THREE.Vector4()},_LiquidColour:{value:new THREE.Vector4(0,0,0,0)},_Direction:{value:0},_CutoffA:{value:floats._CutoffA},_CutoffB:{value:floats._CutoffB}}});
    material.name='Native syringe liquid mask';material.userData.nativeSyringeShader=true;material.userData.linearProject=this.linearProject;return material;
  }
}
export function updateSyringeMaterial(material:THREE.Material,state:SyringeVisualState|undefined,time:number){
  if(!(material instanceof THREE.RawShaderMaterial)||!material.userData.nativeSyringeShader||!state)return;
  const convert=material.userData.linearProject?bodyColorChannelToLinear:(n:number)=>n;
  (material.uniforms._LiquidColour.value as THREE.Vector4).set(convert(state.color.r),convert(state.color.g),convert(state.color.b),THREE.MathUtils.clamp(state.scaledAmount,0,1));
  material.uniforms._Direction.value=state.pressureMode===0?1:state.pressureMode===1?-1:0;
  (material.uniforms._Time.value as THREE.Vector4).set(time/20,time,time*2,time*3);
}
