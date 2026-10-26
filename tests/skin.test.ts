import {describe,expect,it} from 'vitest';
import {addSkinWound,createSkinState,DamageKind,regenerateSkin,rotSkin,skinUniforms} from '../src/systems/skin';

describe('recovered skin material state',()=>{
  it('clamps source wound intensities and merges nearby wounds without resetting their age',()=>{
    const state=createSkinState({});addSkinWound(state,DamageKind.Bullet,{x:0,y:0},50,2);addSkinWound(state,DamageKind.Bullet,{x:.01,y:0},1000,7);
    expect(state.wounds).toEqual([{x:0,y:0,intensity:10,type:DamageKind.Bullet,time:2}]);
    addSkinWound(state,DamageKind.Blunt,{x:0,y:0},10,8);expect(state.wounds).toHaveLength(2);
  });
  it('keeps the source128point limit instead of growing a shader array indefinitely',()=>{
    const state=createSkinState({});for(let i=0;i<200;i++)addSkinWound(state,DamageKind.Bullet,{x:i,y:0},1,i);
    expect(state.wounds).toHaveLength(128);expect(addSkinWound(state,DamageKind.Bullet,{x:0,y:0},5,200)).toBe(false);
  });
  it('regenerates at16Hz and preserves active bleeding wounds',()=>{
    const state=createSkinState({});addSkinWound(state,DamageKind.Blunt,{x:0,y:0},10,0);addSkinWound(state,DamageKind.Bullet,{x:1,y:0},10,0);
    regenerateSkin(state,{},1,50,50,2,true,false);expect(state.wounds[0].intensity).toBeCloseTo(.95);expect(state.wounds[1].intensity).toBe(1);
    regenerateSkin(state,{},1,50,50,0,true,false);expect(state.wounds[1].intensity).toBeCloseTo(.995);
  });
  it('produces source temperature, electric, burn and layer-visibility uniforms',()=>{
    const state=createSkinState({});const config={ShouldGlowWhenHot:true,ShouldRecolourWhenCold:true,MaxGlowTemperature:1000,MinFreezeTemperature:-30};
    expect(skinUniforms(state,config,{temperature:500,charge:50,burnProgress:0}).temperatureValue).toBe(.25);
    const frozen=skinUniforms(state,config,{temperature:-15,charge:50,burnProgress:.5});expect(frozen.temperatureValue).toBe(-.5);expect(frozen.electrocutionIntensity).toBe(2);expect(frozen.skinVisible).toBe(false);expect(frozen.fleshVisible).toBe(true);
    state.acidProgress=.9;expect(skinUniforms(state,config,{temperature:0,charge:0,burnProgress:0}).fleshVisible).toBe(false);
  });
  it('rots corpses but preserves Android and deeply frozen tissue',()=>{
    const human=createSkinState({}),android=createSkinState({}),frozen=createSkinState({});rotSkin(human,{},10,0,'Human',18,false);rotSkin(android,{},10,0,'Android',18,false);rotSkin(frozen,{},10,0,'Human',-60,false);
    expect(human.rottenProgress).toBe(.02);expect(android.rottenProgress).toBe(0);expect(frozen.rottenProgress).toBe(0);
  });
});
