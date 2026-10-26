import * as THREE from 'three';
import type { RigSprite } from '../assets';
import type { SkinUniforms } from '../systems/skin';

export interface BodyTexture {url:string;width?:number;height?:number;file?:string;pathId?:string}
export interface BodySprite extends RigSprite {
  sourceTexture?:BodyTexture;
  uvRect?:{x:number;y:number;width:number;height:number};
  packingRotation?:number;
}
export interface BodyMaterialSource {
  key:string;file?:string;pathId?:string;name:string;shader?:{url?:string;pathId?:string;file?:string};
  textures:Record<string,BodyTexture|null>;colors:Record<string,{r:number;g:number;b:number;a:number}>;floats:Record<string,number>;
}
export interface BodyShaderOptions {
  materialKey:string;sprite:BodySprite;nativeScale?:{x:number;y:number};
  /** Renderer-local origin in its attached body's coordinates. */
  bodyOffset?:{x:number;y:number};
}

/** Extracts the actually shipped GLCore fragment and removes desktop-only header
 * declarations. Its arithmetic/control flow is retained, not reimplemented. */
export function adaptBodyFragment(shaderLab:string):string {
  const text=shaderLab.replace(/\r\n/g,'\n'),glcore=text.indexOf('SubProgram "glcore ');
  if(glcore<0)throw new Error('Body shader has no shipped GLCore subprogram');
  const blockStart=text.indexOf('"#ifdef VERTEX',glcore),blockEnd=text.indexOf('\n"\n}',blockStart);
  if(blockStart<0||blockEnd<0)throw new Error('Body GLCore source block is incomplete');
  const block=text.slice(blockStart+1,blockEnd),fragmentStart=block.indexOf('#ifdef FRAGMENT');
  const firstUniform=block.slice(fragmentStart).match(/^uniform[ \t]+vec4[ \t]+_Time\s*;/m);
  const uniformStart=firstUniform?.index===undefined?-1:fragmentStart+firstUniform.index,stageEnd=block.lastIndexOf('#endif');
  if(fragmentStart<0||uniformStart<fragmentStart||stageEnd<uniformStart)throw new Error('Body fragment stage is incomplete');
  let fragment=block.slice(uniformStart,stageEnd);
  fragment=fragment.replace(/UNITY_LOCATION\(\d+\)\s*/g,'').replace(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*/g,'');
  if(!fragment.includes('_DamagePoints[128]')||!fragment.includes('void main()')||!fragment.includes('SV_Target0'))throw new Error('Unexpected body shader interface');
  return 'precision highp float;\nprecision highp int;\n'+fragment;
}

// Equivalent source varyings with Three's matrix interface and the original atlas
// rectangle. vs_TEXCOORD1 retains the Unity sprite's native local-space position.
export const BODY_VERTEX_SHADER=`precision highp float;
precision highp int;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform vec4 _SpriteUvRect;
uniform vec4 _SpriteColor;
uniform vec2 _NativeOffset;
uniform vec2 _NativeScale;
uniform vec2 _Flip;
in vec3 position;
in vec2 uv;
out vec2 vs_TEXCOORD0;
out vec2 vs_TEXCOORD1;
out vec4 vs_COLOR0;
void main(){
  vs_TEXCOORD0=_SpriteUvRect.xy+uv*_SpriteUvRect.zw;
  vs_TEXCOORD1=(position.xy*_Flip+_NativeOffset)/_NativeScale;
  vs_COLOR0=_SpriteColor;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

const path=(url:string)=>`${import.meta.env.BASE_URL}${url.replace(/^\//,'')}`;
const COLOR_NAMES=['_BruiseColor','_SecondBruiseColor','_ThirdBruiseColor','_Zombie','_GlowColour','_FreezeColour','_ElectroBoneColour','_BloodColor'];
const TEXTURE_NAMES=['_MainTex','_FleshTex','_BoneTex','_DamageTex'];
export class BodyShaderLibrary {
  private textureLoader=new THREE.TextureLoader();
  private textures=new Map<string,THREE.Texture>();
  private constructor(readonly materials:Map<string,BodyMaterialSource>,readonly fragmentShader:string,readonly sourceUrl:string){}
  static async load():Promise<BodyShaderLibrary|null>{
    try{
      const response=await fetch(path('/local-assets/body-materials.json'));
      if(!response.ok||!response.headers.get('content-type')?.includes('json'))return null;
      const value=await response.json() as {materials?:BodyMaterialSource[];byId?:Record<string,BodyMaterialSource>;shader?:{url:string}};
      const sources=value.materials??(value.byId?Object.entries(value.byId).map(([key,source])=>({...source,key})):[]);if(!Array.isArray(sources)||!sources.length)return null;
      const shaderUrl=value.shader?.url??sources.find(x=>x.shader?.url)?.shader?.url;
      if(!shaderUrl)throw new Error('Extracted body-material manifest omits GLCore shader URL');
      const shader=await fetch(path(shaderUrl));if(!shader.ok)throw new Error('Extracted body shader is missing');
      return new BodyShaderLibrary(new Map(sources.map(m=>[m.key,m])),adaptBodyFragment(await shader.text()),shaderUrl);
    }catch(error){console.info('Native body shader unavailable.',error);return null;}
  }
  private texture(source:BodyTexture) {
    let texture=this.textures.get(source.url);
    if(!texture){texture=this.textureLoader.load(path(source.url));texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.colorSpace=THREE.NoColorSpace;this.textures.set(source.url,texture);}
    return texture;
  }
  create(options:BodyShaderOptions):THREE.RawShaderMaterial|null {
    const source=this.materials.get(options.materialKey),sprite=options.sprite;
    if(!source||!sprite.sourceTexture||!sprite.uvRect||(sprite.packingRotation??0)!==0)return null;
    const textures:Record<string,BodyTexture|null>={...source.textures,_MainTex:sprite.sourceTexture};
    if(TEXTURE_NAMES.some(name=>!textures[name]?.url))return null;
    const uniforms:Record<string,THREE.IUniform>={};
    for(const name of TEXTURE_NAMES)uniforms[name]={value:this.texture(textures[name]!)};
    for(const name of COLOR_NAMES){const color=source.colors[name];if(!color)return null;uniforms[name]={value:new THREE.Vector4(color.r,color.g,color.b,color.a)};}
    for(const[name,value]of Object.entries(source.floats))uniforms[name]={value};
    const rect=sprite.uvRect,color=(sprite as unknown as {color?:{r:number;g:number;b:number;a:number}}).color;
    const scale=options.nativeScale??{x:1,y:1},offset=options.bodyOffset??{x:0,y:0};
    Object.assign(uniforms,{
      _Time:{value:new THREE.Vector4()},_DamagePoints:{value:Array.from({length:128},()=>new THREE.Vector4(0,0,0,5))},_DamagePointTimeStamp:{value:new Float32Array(128)},_DamagePointCount:{value:0},
      _BurnProgress:{value:0},_AcidProgress:{value:0},_Temperature:{value:0},_BurnProgressInfluence:{value:source.floats._BurnProgressInfluence??1},_ElectrocutionIntensity:{value:0},_RottenProgress:{value:0},
      _SpriteUvRect:{value:new THREE.Vector4(rect.x,rect.y,rect.width,rect.height)},_SpriteColor:{value:new THREE.Vector4(color?.r??1,color?.g??1,color?.b??1,color?.a??1)},
      _NativeOffset:{value:new THREE.Vector2(offset.x+(.5-sprite.pivot.x)*sprite.width,offset.y+(.5-sprite.pivot.y)*sprite.height)},
      _NativeScale:{value:new THREE.Vector2(scale.x||1,scale.y||1)},_Flip:{value:new THREE.Vector2(sprite.flipX?-1:1,sprite.flipY?-1:1)},
    });
    const material=new THREE.RawShaderMaterial({vertexShader:BODY_VERTEX_SHADER,fragmentShader:this.fragmentShader,uniforms,glslVersion:THREE.GLSL3,side:THREE.DoubleSide,transparent:true,depthWrite:false,toneMapped:false});
    material.name=`Native body: ${source.name}`;material.userData.nativeBodyShader=true;material.userData.sourceMaterial=source.key;material.userData.sourceShader=this.sourceUrl;
    return material;
  }
}

export function updateBodyMaterial(material:THREE.Material,skin:SkinUniforms|undefined,time:number):void {
  if(!(material instanceof THREE.RawShaderMaterial)||!material.userData.nativeBodyShader||!skin)return;
  const uniforms=material.uniforms;
  (uniforms._Time.value as THREE.Vector4).set(time/20,time,time*2,time*3);
  uniforms._BurnProgress.value=skin.burnProgress;uniforms._AcidProgress.value=skin.acidProgress;uniforms._Temperature.value=skin.temperatureValue;
  uniforms._ElectrocutionIntensity.value=skin.electrocutionIntensity;uniforms._RottenProgress.value=skin.rottenProgress;
  const points=uniforms._DamagePoints.value as THREE.Vector4[],timestamps=uniforms._DamagePointTimeStamp.value as Float32Array;
  const count=Math.min(128,skin.wounds.length);uniforms._DamagePointCount.value=count;
  for(let i=0;i<count;i++){const point=skin.wounds[i];points[i].set(point.x,point.y,point.intensity,point.type);timestamps[i]=point.time;}
}
