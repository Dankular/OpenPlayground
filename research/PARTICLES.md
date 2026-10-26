# Original particle systems and additive glow sprites

`src/particles.ts` provides `ParticleSystemView`, an instanced Three.js adapter
for the installed Unity particle data. It reads active prefab nodes rather than
substituting visual effects. Ion Bolt GameObject `sharedassets0.assets:5720` has
no SpriteRenderers: its three original emitters (`15063`, `15472`, `15168`) are
therefore essential to its appearance.

`scripts/extract_particle_assets.py` generates tracked
`src/generated/particle-materials.json` without re-exporting media. It resolves
823 original ParticleSystemRenderer references and all 3004 sprite renderer
references to 106 materials, including their original texture URLs, hashes,
filter/wrap/color-space settings, uniforms, keywords and shader-pass state.
Existing PNG payloads are hash-verified. Nine focused projectile/muzzle/impact
effect GameObjects include original emitter definitions, source transform data,
cross-file pointer mappings and source `DeleteAfterTime` timers. The generated
data reports zero missing converted texture payloads in the installed build.
Source serialized-file and managed assembly hashes are included. This is
UnityPy static asset extraction, not REA runtime evidence.

```powershell
.\.venv\Scripts\python.exe scripts/extract_particle_assets.py --game-root 'D:\SteamLibrary\steamapps\common\People Playground'
```

## Runtime integration

Construct `new ParticleSystemView(scene, options)`, then call `attach(entity)`,
`remove(entity)` and `update(scaledFrameDelta)`. Options allow the host's gravity,
texture loader, random source and explicit particle budget. The default budget
uses each source `maxNumParticles`. `spawnEffect(pointer, sourceFile, position,
angle)` resolves the focused original effect definition, including external-file
pointers. `play` and `stop` control an entity or one emitter node. `dispose`
releases GPU resources. Source metadata remains immutable; live particles,
timers and emission accumulators are separate.

`setEmitter(entity, particleSystemPointer, {playing, rate, distanceRate, speed,
color})` applies runtime overrides without modifying serialized modules. Rates
and speed are absolute values; color/speed affect new births. Stopping preserves
existing particles. This supports original liquid outlets whose emitters have
`playOnAwake=false`, including water-puff selection and source pressure speed.

The adapter handles:

- Constant, curve, two-curve and two-constant MinMaxCurves using source Hermite
  tangents and multipliers; independent gradient color/alpha key times.
- Source lifetime, speed, size, size axes, rotation, color, gravity, duration,
  delay, simulation speed, looping and particle cap.
- Time/distance emission and burst counts, probability, cycle count and repeat
  interval. Distance emissions are distributed along the travelled segment.
- Local/world simulation, body-relative emitter pose, shape position/rotation/
  scale, and circle, sphere/hemisphere, cone, box/rectangle and edge sampling.
- Lifetime size/color/rotation, velocity/force curves, initial inherited emitter
  velocity and size-by-speed. World gravity is transformed into local coordinates
  when needed.
- Source-textured billboards and velocity stretching, original blend factors and
  equations, alpha cutoff, material tint, texture transforms, vertex color and
  color-space settings. Renderers can hide while particle simulation continues;
  inactive GameObjects stop both.

Ion Bolt's `Effect` emitter has world-space distance emission 15, native circle
radius .2, size .05–.1 and life .5–1. Its two local flash emitters use distance
rates 15 and 1, life .05–.1 and cap 5; the third node has original scale 15.
All use original `globalgamemanagers.assets:7` FireParticles, texture `24`
HDParticle, and source alpha/one additive blending. They emit when the bolt
travels, rather than inventing a stationary light.

## Native additive sprite shader

`createNativeSpriteMaterial(rendererKey, texture, spriteColor, projectLinear)`
adapts shader `sharedassets0.assets:885`, `Unlit/AdditiveGlowSprite`, for source
sprite renderers and returns null for other shaders. Javelin renderer `18729`
uses material `48` LightSprite. Its native pass uses **ONE/ONE additive blending
and ZWrite off**, despite stale `_SrcBlend`/`_DstBlend` material fields. The
recovered GL fragment evaluates texture × tint × vertex color × glow color ×
glow intensity × vertex alpha. Native sprite dimensions remain unchanged.

## Explicit remaining differences

`unsupported` reports enabled modules which are not implemented: collision,
triggers, trails, subemitters, noise, velocity limiting, lights, external forces,
custom data and corresponding speed-based color/rotation variants. Texture-sheet
animation, custom simulation space, mesh/horizontal/vertical rendering and
non-hierarchy scaling are also flagged. Unsupported source shaders are omitted
with a diagnostic, rather than being replaced with a generic texture.

Shape sampling reconstructs the exposed shape geometry in the XY scene; it does
not reproduce Unity's native random generator, out-of-plane sorting or every
box-shell/cone distribution detail. Rotation-over-lifetime currently samples
angular speed over elapsed age, rather than integrating arbitrary speed curves.
Current-mode inherited velocity and source drag/noise/trail behavior remain
partial. Prewarming uses bounded 60 Hz sampling and reports that approximation.
Camera-relative stretch, viewport min/max particle size and soft-particle/depth
fading are not reproduced. Shader color modes beyond the ordinary multiply path
are not yet adapted. Particle GPU/live simulation state is not serialized;
restoring an entity restarts its visual emitters.

The implementation follows Unity 2020 enum values from the
[official Unity C# reference](https://github.com/Unity-Technologies/UnityCsReference/blob/2020.3/Modules/ParticleSystem/Managed/ParticleSystemEnums.cs).
Linear particle vertex-color conversion follows Unity's
[applyActiveColorSpace contract](https://docs.unity3d.com/2020.3/Documentation/ScriptReference/ParticleSystemRenderer-applyActiveColorSpace.html).
The shipped serialized values and shader program remain authoritative for this
installed build.

`tests/particles.test.ts` checks curve/gradient semantics, all three original Ion
Bolt emitters, original texture/blend metadata, distance/time emissions, caps,
bursts, local/world movement, gravity, active/renderer-disabled states, source
immutability, focused effect spawning, delays and original additive sprite
state. Browser verification remains necessary for visual fidelity and GPU shader
compilation; these tests do not claim pixel equivalence to Unity.

Browser integration uncovered a separate whole-scene composition difference:
the default map contains very large overlapping native additive glow sprites.
The current display framebuffer blends already encoded per-object output;
Unity's Linear/HDR rendering blends linear values before the final display
transfer. Their accumulated brightness can therefore clip white even when each
source fragment and blend factor is correct. Correcting that requires a shared
linear scene target and one final display conversion, coordinated with existing
body/syringe shaders; source dimensions and intensities must not be arbitrarily
reduced to conceal it.
