//////////////////////////////////////////
//
// NOTE: This is *not* a valid shader file
//
///////////////////////////////////////////
Shader "Unlit/SyringeShader" {
Properties {

_MainTex ("Texture", 2D) = "white" { }

_CutoffA ("Cutoff A", Range(0, 1)) = 0.10000000149011612

_CutoffB ("Cutoff B", Range(0, 1)) = 0.10000000149011612

_LiquidColour ("Liquid colour", Color) = (1,0,1,1)

_Direction ("Flow direction", Range(-1, 1)) = 0.0

}
SubShader {
 Tags { "CanUseSpriteAtlas" = "true" "QUEUE" = "Transparent+1" "RenderType" = "Opaque" }
 Pass {
  Tags { "CanUseSpriteAtlas" = "true" "QUEUE" = "Transparent+1" "RenderType" = "Opaque" }
 ZWrite Off
 Cull Off
  GpuProgramID 29369
Program "vp" {
SubProgram "glcore " {
"#ifdef VERTEX
#version 150
#extension GL_ARB_explicit_attrib_location : require
#ifdef GL_ARB_shader_bit_encoding
#extension GL_ARB_shader_bit_encoding : enable
#endif

#define HLSLCC_ENABLE_UNIFORM_BUFFERS 1
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
#define UNITY_UNIFORM
#else
#define UNITY_UNIFORM uniform
#endif
#define UNITY_SUPPORTS_UNIFORM_LOCATION 1
#if UNITY_SUPPORTS_UNIFORM_LOCATION
#define UNITY_LOCATION(x) layout(location = x)
#define UNITY_BINDING(x) layout(binding = x, std140)
#else
#define UNITY_LOCATION(x)
#define UNITY_BINDING(x) layout(std140)
#endif
uniform 	vec4 hlslcc_mtx4x4unity_ObjectToWorld[4];
uniform 	vec4 hlslcc_mtx4x4unity_MatrixVP[4];
uniform 	vec4 _MainTex_ST;
in  vec4 in_POSITION0;
in  vec2 in_TEXCOORD0;
out vec2 vs_TEXCOORD0;
vec4 u_xlat0;
vec4 u_xlat1;
void main()
{
    vs_TEXCOORD0.xy = in_TEXCOORD0.xy * _MainTex_ST.xy + _MainTex_ST.zw;
    u_xlat0 = in_POSITION0.yyyy * hlslcc_mtx4x4unity_ObjectToWorld[1];
    u_xlat0 = hlslcc_mtx4x4unity_ObjectToWorld[0] * in_POSITION0.xxxx + u_xlat0;
    u_xlat0 = hlslcc_mtx4x4unity_ObjectToWorld[2] * in_POSITION0.zzzz + u_xlat0;
    u_xlat0 = u_xlat0 + hlslcc_mtx4x4unity_ObjectToWorld[3];
    u_xlat1 = u_xlat0.yyyy * hlslcc_mtx4x4unity_MatrixVP[1];
    u_xlat1 = hlslcc_mtx4x4unity_MatrixVP[0] * u_xlat0.xxxx + u_xlat1;
    u_xlat1 = hlslcc_mtx4x4unity_MatrixVP[2] * u_xlat0.zzzz + u_xlat1;
    gl_Position = hlslcc_mtx4x4unity_MatrixVP[3] * u_xlat0.wwww + u_xlat1;
    return;
}

#endif
#ifdef FRAGMENT
#version 150
#extension GL_ARB_explicit_attrib_location : require
#ifdef GL_ARB_shader_bit_encoding
#extension GL_ARB_shader_bit_encoding : enable
#endif

#define HLSLCC_ENABLE_UNIFORM_BUFFERS 1
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
#define UNITY_UNIFORM
#else
#define UNITY_UNIFORM uniform
#endif
#define UNITY_SUPPORTS_UNIFORM_LOCATION 1
#if UNITY_SUPPORTS_UNIFORM_LOCATION
#define UNITY_LOCATION(x) layout(location = x)
#define UNITY_BINDING(x) layout(binding = x, std140)
#else
#define UNITY_LOCATION(x)
#define UNITY_BINDING(x) layout(std140)
#endif
uniform 	vec4 _Time;
uniform 	float _CutoffA;
uniform 	float _CutoffB;
uniform 	float _Direction;
uniform 	vec4 _LiquidColour;
UNITY_LOCATION(0) uniform  sampler2D _MainTex;
in  vec2 vs_TEXCOORD0;
layout(location = 0) out vec4 SV_Target0;
vec4 u_xlat0;
vec4 u_xlat1;
bool u_xlatb1;
vec4 u_xlat2;
float u_xlat3;
bool u_xlatb3;
vec3 u_xlat4;
bool u_xlatb4;
float u_xlat7;
bool u_xlatb7;
float u_xlat8;
bool u_xlatb8;
bool u_xlatb11;
void main()
{
    u_xlat0.x = vs_TEXCOORD0.x + vs_TEXCOORD0.x;
    u_xlat4.x = _Time.y * -2.0 + u_xlat0.x;
    u_xlat0.x = _Time.y * 2.0 + u_xlat0.x;
    u_xlatb8 = u_xlat4.x>=(-u_xlat4.x);
    u_xlat4.x = fract(abs(u_xlat4.x));
    u_xlat4.x = (u_xlatb8) ? u_xlat4.x : (-u_xlat4.x);
    u_xlat4.x = abs(u_xlat4.x) + -0.850000024;
    u_xlat4.x = u_xlat4.x * 20.0000191;
    u_xlat4.x = clamp(u_xlat4.x, 0.0, 1.0);
    u_xlat8 = u_xlat4.x * -2.0 + 3.0;
    u_xlat4.x = u_xlat4.x * u_xlat4.x;
    u_xlat4.x = u_xlat4.x * u_xlat8;
    u_xlatb8 = u_xlat0.x>=(-u_xlat0.x);
    u_xlat0.x = fract(abs(u_xlat0.x));
    u_xlat0.x = (u_xlatb8) ? u_xlat0.x : (-u_xlat0.x);
    u_xlat0.x = abs(u_xlat0.x) + -0.850000024;
    u_xlat0.x = u_xlat0.x * 20.0000191;
    u_xlat0.x = clamp(u_xlat0.x, 0.0, 1.0);
    u_xlat8 = u_xlat0.x * -2.0 + 3.0;
    u_xlat0.x = u_xlat0.x * u_xlat0.x;
    u_xlat0.x = u_xlat0.x * u_xlat8;
    u_xlatb8 = 0.0<_Direction;
    u_xlat0.x = (u_xlatb8) ? u_xlat4.x : u_xlat0.x;
    u_xlat0.x = u_xlat0.x * abs(_Direction);
    u_xlat1 = texture(_MainTex, vs_TEXCOORD0.xy);
    u_xlat0.x = u_xlat0.x * u_xlat1.w;
    u_xlat0.x = u_xlat0.x * 0.25;
    u_xlat4.x = dot(_LiquidColour.xyz, vec3(0.298999995, 0.587000012, 0.114));
    u_xlatb4 = 0.5<u_xlat4.x;
    u_xlat4.x = (u_xlatb4) ? 0.0 : 1.0;
    u_xlat4.xyz = u_xlat4.xxx + (-_LiquidColour.xyz);
    u_xlat0.xyz = u_xlat0.xxx * u_xlat4.xyz + _LiquidColour.xyz;
    u_xlat0.w = 1.0;
    u_xlat2 = (-u_xlat0) + vec4(1.0, 1.0, 1.0, 1.0);
    u_xlatb3 = _CutoffA<vs_TEXCOORD0.x;
    u_xlat7 = (-_CutoffA) + _CutoffB;
    u_xlat7 = _LiquidColour.w * u_xlat7 + _CutoffA;
    u_xlatb11 = vs_TEXCOORD0.x<u_xlat7;
    u_xlatb7 = u_xlat7<vs_TEXCOORD0.x;
    u_xlatb3 = u_xlatb11 || u_xlatb3;
    u_xlat3 = u_xlatb3 ? 1.0 : float(0.0);
    u_xlat0 = vec4(u_xlat3) * u_xlat2 + u_xlat0;
    u_xlat0 = u_xlat0 * u_xlat1;
    u_xlatb1 = vs_TEXCOORD0.x<_CutoffB;
    u_xlatb1 = u_xlatb1 || u_xlatb7;
    u_xlat1.x = (u_xlatb1) ? 1.0 : 0.25;
    SV_Target0.w = u_xlat0.w * u_xlat1.x;
    SV_Target0.xyz = u_xlat0.xyz;
    return;
}

#endif
"
}
SubProgram "d3d11 " {
"// shader disassembly not supported on DXBC"
}
SubProgram "vulkan " {
""
}
SubProgram "glcore " {
Keywords { "INSTANCING_ON" }
"#ifdef VERTEX
#version 330
#extension GL_ARB_explicit_attrib_location : require
#ifndef UNITY_RUNTIME_INSTANCING_ARRAY_SIZE
	#define UNITY_RUNTIME_INSTANCING_ARRAY_SIZE 2
#endif

#define HLSLCC_ENABLE_UNIFORM_BUFFERS 1
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
#define UNITY_UNIFORM
#else
#define UNITY_UNIFORM uniform
#endif
#define UNITY_SUPPORTS_UNIFORM_LOCATION 1
#if UNITY_SUPPORTS_UNIFORM_LOCATION
#define UNITY_LOCATION(x) layout(location = x)
#define UNITY_BINDING(x) layout(binding = x, std140)
#else
#define UNITY_LOCATION(x)
#define UNITY_BINDING(x) layout(std140)
#endif
uniform 	vec4 hlslcc_mtx4x4unity_MatrixVP[4];
uniform 	int unity_BaseInstanceID;
uniform 	vec4 _MainTex_ST;
struct unity_Builtins0Array_Type {
	vec4 hlslcc_mtx4x4unity_ObjectToWorldArray[4];
	vec4 hlslcc_mtx4x4unity_WorldToObjectArray[4];
};
UNITY_BINDING(1) uniform UnityInstancing_PerDraw0 {
	unity_Builtins0Array_Type unity_Builtins0Array[UNITY_RUNTIME_INSTANCING_ARRAY_SIZE];
};
in  vec4 in_POSITION0;
in  vec2 in_TEXCOORD0;
flat out uint vs_SV_InstanceID0;
out vec2 vs_TEXCOORD0;
vec4 u_xlat0;
int u_xlati0;
vec4 u_xlat1;
void main()
{
    vs_SV_InstanceID0 =  uint(gl_InstanceID);
    vs_TEXCOORD0.xy = in_TEXCOORD0.xy * _MainTex_ST.xy + _MainTex_ST.zw;
    u_xlati0 = gl_InstanceID + unity_BaseInstanceID;
    u_xlati0 = u_xlati0 << 3;
    u_xlat1 = in_POSITION0.yyyy * unity_Builtins0Array[u_xlati0 / 8].hlslcc_mtx4x4unity_ObjectToWorldArray[1];
    u_xlat1 = unity_Builtins0Array[u_xlati0 / 8].hlslcc_mtx4x4unity_ObjectToWorldArray[0] * in_POSITION0.xxxx + u_xlat1;
    u_xlat1 = unity_Builtins0Array[u_xlati0 / 8].hlslcc_mtx4x4unity_ObjectToWorldArray[2] * in_POSITION0.zzzz + u_xlat1;
    u_xlat0 = u_xlat1 + unity_Builtins0Array[u_xlati0 / 8].hlslcc_mtx4x4unity_ObjectToWorldArray[3];
    u_xlat1 = u_xlat0.yyyy * hlslcc_mtx4x4unity_MatrixVP[1];
    u_xlat1 = hlslcc_mtx4x4unity_MatrixVP[0] * u_xlat0.xxxx + u_xlat1;
    u_xlat1 = hlslcc_mtx4x4unity_MatrixVP[2] * u_xlat0.zzzz + u_xlat1;
    gl_Position = hlslcc_mtx4x4unity_MatrixVP[3] * u_xlat0.wwww + u_xlat1;
    return;
}

#endif
#ifdef FRAGMENT
#version 330
#extension GL_ARB_explicit_attrib_location : require
#ifndef UNITY_RUNTIME_INSTANCING_ARRAY_SIZE
	#define UNITY_RUNTIME_INSTANCING_ARRAY_SIZE 2
#endif

#define HLSLCC_ENABLE_UNIFORM_BUFFERS 1
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
#define UNITY_UNIFORM
#else
#define UNITY_UNIFORM uniform
#endif
#define UNITY_SUPPORTS_UNIFORM_LOCATION 1
#if UNITY_SUPPORTS_UNIFORM_LOCATION
#define UNITY_LOCATION(x) layout(location = x)
#define UNITY_BINDING(x) layout(binding = x, std140)
#else
#define UNITY_LOCATION(x)
#define UNITY_BINDING(x) layout(std140)
#endif
uniform 	vec4 _Time;
uniform 	int unity_BaseInstanceID;
uniform 	float _CutoffA;
uniform 	float _CutoffB;
struct PropsArray_Type {
	float _Direction;
	vec4 _LiquidColour;
};
UNITY_BINDING(0) uniform UnityInstancing_Props {
	PropsArray_Type PropsArray[UNITY_RUNTIME_INSTANCING_ARRAY_SIZE];
};
UNITY_LOCATION(0) uniform  sampler2D _MainTex;
flat in  uint vs_SV_InstanceID0;
in  vec2 vs_TEXCOORD0;
layout(location = 0) out vec4 SV_Target0;
float u_xlat0;
bool u_xlatb0;
vec4 u_xlat1;
vec4 u_xlat2;
vec4 u_xlat3;
float u_xlat4;
bool u_xlatb4;
float u_xlat8;
int u_xlati8;
bool u_xlatb8;
bool u_xlatb12;
void main()
{
    u_xlat0 = vs_TEXCOORD0.x + vs_TEXCOORD0.x;
    u_xlat4 = _Time.y * -2.0 + u_xlat0;
    u_xlat0 = _Time.y * 2.0 + u_xlat0;
    u_xlatb8 = u_xlat4>=(-u_xlat4);
    u_xlat4 = fract(abs(u_xlat4));
    u_xlat4 = (u_xlatb8) ? u_xlat4 : (-u_xlat4);
    u_xlat4 = abs(u_xlat4) + -0.850000024;
    u_xlat4 = u_xlat4 * 20.0000191;
    u_xlat4 = clamp(u_xlat4, 0.0, 1.0);
    u_xlat8 = u_xlat4 * -2.0 + 3.0;
    u_xlat4 = u_xlat4 * u_xlat4;
    u_xlat4 = u_xlat4 * u_xlat8;
    u_xlatb8 = u_xlat0>=(-u_xlat0);
    u_xlat0 = fract(abs(u_xlat0));
    u_xlat0 = (u_xlatb8) ? u_xlat0 : (-u_xlat0);
    u_xlat0 = abs(u_xlat0) + -0.850000024;
    u_xlat0 = u_xlat0 * 20.0000191;
    u_xlat0 = clamp(u_xlat0, 0.0, 1.0);
    u_xlat8 = u_xlat0 * -2.0 + 3.0;
    u_xlat0 = u_xlat0 * u_xlat0;
    u_xlat0 = u_xlat0 * u_xlat8;
    u_xlati8 = int(vs_SV_InstanceID0) + unity_BaseInstanceID;
    u_xlati8 = u_xlati8 << 1;
    u_xlatb12 = 0.0<PropsArray[u_xlati8 / 2]._Direction;
    u_xlat0 = (u_xlatb12) ? u_xlat4 : u_xlat0;
    u_xlat0 = u_xlat0 * abs(PropsArray[u_xlati8 / 2]._Direction);
    u_xlat1 = texture(_MainTex, vs_TEXCOORD0.xy);
    u_xlat0 = u_xlat0 * u_xlat1.w;
    u_xlat0 = u_xlat0 * 0.25;
    u_xlat4 = dot(PropsArray[u_xlati8 / 2]._LiquidColour.xyz, vec3(0.298999995, 0.587000012, 0.114));
    u_xlatb4 = 0.5<u_xlat4;
    u_xlat4 = (u_xlatb4) ? 0.0 : 1.0;
    u_xlat2.xyz = vec3(u_xlat4) + (-PropsArray[u_xlati8 / 2]._LiquidColour.xyz);
    u_xlat2.xyz = vec3(u_xlat0) * u_xlat2.xyz + PropsArray[u_xlati8 / 2]._LiquidColour.xyz;
    u_xlat2.w = 1.0;
    u_xlat3 = (-u_xlat2) + vec4(1.0, 1.0, 1.0, 1.0);
    u_xlat0 = (-_CutoffA) + _CutoffB;
    u_xlat0 = PropsArray[u_xlati8 / 2]._LiquidColour.w * u_xlat0 + _CutoffA;
    u_xlatb4 = vs_TEXCOORD0.x<u_xlat0;
    u_xlatb0 = u_xlat0<vs_TEXCOORD0.x;
    u_xlatb8 = _CutoffA<vs_TEXCOORD0.x;
    u_xlatb4 = u_xlatb4 || u_xlatb8;
    u_xlat4 = u_xlatb4 ? 1.0 : float(0.0);
    u_xlat2 = vec4(u_xlat4) * u_xlat3 + u_xlat2;
    u_xlat1 = u_xlat1 * u_xlat2;
    u_xlatb4 = vs_TEXCOORD0.x<_CutoffB;
    u_xlatb0 = u_xlatb4 || u_xlatb0;
    u_xlat0 = (u_xlatb0) ? 1.0 : 0.25;
    SV_Target0.w = u_xlat0 * u_xlat1.w;
    SV_Target0.xyz = u_xlat1.xyz;
    return;
}

#endif
"
}
SubProgram "d3d11 " {
Keywords { "INSTANCING_ON" }
"// shader disassembly not supported on DXBC"
}
SubProgram "vulkan " {
Keywords { "INSTANCING_ON" }
""
}
}
Program "fp" {
SubProgram "d3d11 " {
"// shader disassembly not supported on DXBC"
}
SubProgram "d3d11 " {
Keywords { "INSTANCING_ON" }
"// shader disassembly not supported on DXBC"
}
}
}
}
}