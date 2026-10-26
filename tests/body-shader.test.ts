import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import * as THREE from 'three';
import {adaptBodyFragment,BodyShaderLibrary,updateBodyMaterial} from '../src/shaders/body';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('native body shader loading boundary',()=>{
  it('rejects shader packages without the shipped fragment stage',()=>{
    expect(()=>adaptBodyFragment('Program "vp" {SubProgram "d3d11 " {}}')).toThrow('GLCore');
    expect(()=>adaptBodyFragment('SubProgram "glcore " {"#ifdef VERTEX\nvoid main(){}\n#endif\n"\n}')).toThrow('fragment');
  });
});

describe.skipIf(!existsSync('public/local-assets/body-materials.json'))('actual extracted body shader',()=>{
  async function library(){
    const manifest=JSON.parse(readFileSync('public/local-assets/body-materials.json','utf8'));
    vi.stubGlobal('fetch',vi.fn(async(input:string)=>input.endsWith('body-materials.json')?new Response(JSON.stringify(manifest),{headers:{'content-type':'application/json'}}):new Response(readFileSync(`public/${input.replace(/^\//,'')}`,'utf8'))));
    vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(()=>new THREE.Texture());
    return(await BodyShaderLibrary.load())!;
  }
  it('retains the real compiled fragment arithmetic while removing desktop-only bindings',async()=>{
    const native=await library();expect(native.fragmentShader).toContain('for(int u_xlati_loop_1 = 0');expect(native.fragmentShader).toContain('floatBitsToUint');expect(native.fragmentShader).toContain('_DamagePoints[128]');
    expect(native.fragmentShader).not.toContain('#version 150');expect(native.fragmentShader).not.toContain('UNITY_LOCATION');expect(native.fragmentShader).not.toContain('GL_ARB');
    expect(native.fragmentShader).toContain('SV_Target0 = u_xlat0 * vs_COLOR0');
  });
  it('loads original species colors and separate skin/flesh/bone/noise maps',async()=>{
    const native=await library();for(const [id,key]of[['20217','20'],['20100','9'],['20203','40']]){
      const prefab=JSON.parse(readFileSync(`public/local-assets/prefabs/${id}.json`,'utf8')),sprite=prefab.renderers[0].sprite;
      const material=native.create({materialKey:`sharedassets0.assets:${key}`,sprite,nativeScale:prefab.parts[0].scale})!;
      expect(material).toBeInstanceOf(THREE.RawShaderMaterial);expect(material.glslVersion).toBe(THREE.GLSL3);expect(material.userData.nativeBodyShader).toBe(true);
      expect(material.uniforms._SpriteUvRect.value.toArray()).toEqual([sprite.uvRect.x,sprite.uvRect.y,sprite.uvRect.width,sprite.uvRect.height]);
      expect(material.uniforms._MainTex.value).not.toBe(material.uniforms._FleshTex.value);
      expect(material.uniforms._DamagePoints.value).toHaveLength(128);
      const color=material.uniforms._BloodColor.value as THREE.Vector4;if(id==='20203')expect(color.y).toBeGreaterThan(color.x);if(id==='20217')expect(color.x).toBeGreaterThan(color.y);
      material.dispose();
    }
  });
  it('updates native wound and heat/electric/rot uniforms without changing source material colors',async()=>{
    const native=await library(),sprite=JSON.parse(readFileSync('public/local-assets/prefabs/20217.json','utf8')).renderers[0].sprite;
    const material=native.create({materialKey:'sharedassets0.assets:20',sprite})!,original=material.uniforms._BloodColor.value.clone();
    updateBodyMaterial(material,{temperature:500,charge:25,burnProgress:.4,temperatureValue:.25,electrocutionIntensity:1,rottenProgress:.2,acidProgress:.1,skinVisible:true,fleshVisible:true,wounds:[{x:.1,y:.2,type:1,intensity:5,time:2}]},10);
    expect(material.uniforms._Time.value.toArray()).toEqual([.5,10,20,30]);expect(material.uniforms._DamagePointCount.value).toBe(1);expect(material.uniforms._DamagePoints.value[0].toArray()).toEqual([.1,.2,5,1]);expect(material.uniforms._DamagePointTimeStamp.value[0]).toBe(2);expect(material.uniforms._Temperature.value).toBe(.25);expect(material.uniforms._BloodColor.value).toEqual(original);
  });
});
