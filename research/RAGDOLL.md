# Ragdoll, pose, and injury reconstruction

The browser now drives the original serialized Human skeleton with its recovered
pose controller. This work is part of the complete rewrite; it does not establish
complete physiology, visual damage, or native runtime equivalence.

## Evidence

The source is the user-supplied `People Playground_Data/Managed/Assembly-CSharp.dll`,
SHA-256 `83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`,
MVID `2457bb93-e7d9-4337-91e2-d226cdef17a0`. Source identity and existing REA core
member evidence were reused rather than rerunning all-member analysis.

| Evidence | Coverage |
| --- | --- |
| `ev_74559254575850e45ea84018adb6ab5b98ac13aeafc95ec2010404af68d105d0` | Existing exact selection of PersonBehaviour, LimbBehaviour, PhysicalBehaviour, Global and CameraControlBehaviour. |
| `ev_6decac63112bca747cec3f4ced4c27236d9882dae3d8ae3f7bf67602765f33fc` | RagdollPose and CirculationBehaviour; 35 fields, 34 methods. Initial nested/node selectors were unmatched and are not treated as covered. |
| `ev_f93c054f1f47e8f5857c543e501bdbac555e6b85d71894bb2abe505e06f3f48a` | ConnectedNodeBehaviour and BloodContainer; 19 fields, 52 methods. |
| `ev_3c226660a093294053caa248dd4e8e78fd099d56908be10fe6f9596d0c122784` | Exact TypeDef selector `LimbPose`, token `0x02000504`; 12 fields, 4 methods. The parser reports this nested type by its leaf name. |
| `ev_ede6a2f97edfd31767187bb004eb7a7a959c6edb88f128c2a7c8722f9624c20e` | GForceMeasureBehaviour; 6 fields, 8 methods. |
| `ev_d765301db03d49247c824c39dd5e2e4a8a029e9a40b723a0297cb643f9d0d746` | SkinMaterialHandler, DamagePoint and DamageType; 37 fields, 33 methods. |

REA observations are execution-free CIL and metadata, not runtime observations.
Focused ILSpy 11.0.0.9375 reconstructions supplied the readable control flow.
Generated C# and detailed serialized prefab JSON remain in ignored `research/local/`.
The local `research/evidence/ragdoll-rea-bundle.json` retains the session evidence.

UnityPy recovered the root PersonBehaviour and fourteen LimbBehaviour,
CirculationBehaviour, SkinMaterialHandler and ConnectedNodeBehaviour configurations.
The Human root has eleven poses: Rest, Fetus, Flailing, Stumbling, Swimming, In pain,
Walking, Sitting, Flat, Decerebrate and Decorticate. Two candidates share the brain
damage state; the controller chooses a linked pose per state at attachment.

## Implemented behavior

`src/systems/ragdoll.ts` attaches only to prefabs containing actual PersonBehaviour
and LimbBehaviour metadata. It maps source component pointers to the live physics
bodies and joints rather than relying on display-name guesses.

- Pose selection follows PersonBehaviour's rest, protective, walking, swimming,
  pain and brain-damage state branches. Explicit pose selection uses the complete
  serialized pose list. Joint target angles, rigidity, force multipliers and
  animation keyframes come from those poses.
- Joint muscle strength depends on health, consciousness, adrenaline, blood
  quantity and flow, numbness, acid/burn damage, broken bones, paralysis and mass.
  Native owner-minus-connected joint angles/speeds are adapted to Planck's opposite
  joint convention. Relevant core methods are `get_MotorStrength` (`0x06000b3b`),
  `MoveIntoPose` (`0x06000b4d`), `FakeStandUpright` (`0x06000b4b`) and
  `InfluenceMotorSpeed` (`0x06000b55`).
- Upright assistance and velocity damping apply when the original conditions hold:
  contact, sufficient circulation, capability, upright pose and an upright-facing
  dynamic body. Stumbling/balance overrides use the serialized limb flags.
- Circulation pumps replenish flow from blood volume; non-pumps decay over time.
  Source PushesTo references distribute flow. Blood diffusion retains the original
  per-limb alternating iteration and clamped container transfer behavior. Bleeding,
  blood regeneration and internal bleeding decay use the reconstructed rates.
- Consciousness, oxygen, shock, pain and adrenaline update at recovered rates.
  Brain death disables voluntary muscle control. Detachment disconnects downstream
  limbs from the head/root and causes gradual detached-limb health loss. Torso bone
  breaks propagate paralysis through the nearest-brain chain.
- Thermal physiology exchanges internal and external temperature, generates body
  heat, applies electrical/heat/cold/fire damage, and handles lung punctures and
  wet-head oxygen loss. Ambient heat/contact conduction and electrical decay belong
  to the separate physical system and are not duplicated here.
- Bullet events use mass-scaled damage, android thresholds, source vital/artery
  bounds, bleeding, shock, numbness, brain-shot probabilities, capped health damage
  and projectile crush callbacks. Entry and exit wounds are distinct. Relevant
  methods are LimbBehaviour.Shot (`0x06000b59`) and CirculationBehaviour.Shot.
- Break/mend/slice and direct damage/heal have explicit APIs. Save snapshots retain
  physiology, limb injury, wound points and disconnected hinge topology; invalid snapshots are
  rejected before mutations and unknown input keys cannot overwrite runtime state.
- G-force injury uses the actual GForceMeasureBehaviour algorithm: velocity
  differences per physics step, smoothed with a 0.5 interpolation factor. It does
  not divide by timestep; the serialized SustainedAccelerationRatio field is
  unused by that method. Limb damage keeps the original Human-species guard.
- Biological joint fragility derives break force/torque from the limb's threshold,
  current mass ratio, rot and temperature, with the source Android multiplier.
  Reaction-force breakage updates circulation, connection topology, dismemberment
  and lethal-limb consequences. Browser slicing applies its break immediately;
  the native path defers the physical break.
- Species-specific serialized settings are retained. Android has fourteen limbs,
  thirteen hinges, ten poses and 300 initial health per limb. Gorse has nine limbs,
  eight hinges and ten poses, with 200 health on the brain/body and 100 on its legs.
  Android low-energy shot immunity, EMP death and wet electrical shorts differ
  from Gorse freezing and organic health/bleeding behavior.

The shipped `AllLimbLoopChecks` does not increment its divisor. The browser keeps
that observed sum behavior rather than silently substituting an average.

## Skin state and the original pixel shader

`src/systems/skin.ts` implements SkinMaterialHandler's 128-point damage buffer,
type-specific proximity merging, source intensity scaling/clamping, wound ages,
adjacent-skin propagation, 16 Hz wound regeneration, rot and material inputs.
Blunt/bullet/stab/dismemberment/burn points remain distinct. Regeneration and rot
respect the source species and limb-state gates. `skinFor(part)` exposes the exact
source-facing shader inputs; bullet and vital-bound coordinates are converted
back into the source sprite's local space, including Android's 1.3 scale.

The installed Body shader contained a readable compiled GLCore subprogram.
`src/shaders/body.ts` loads that extracted subprogram at runtime, retains its
fragment arithmetic/control flow, and replaces desktop-only headers/bindings with
WebGL 2 declarations. Its vertex adapter supplies the same atlas UV and native
local-position varyings using Three.js matrices. This is the original fragment
program, rather than a substitute wound overlay.

Source material IDs 20 (Human), 9 (Android) and 40 (Gorse) all reference shader 892,
but retain their separate flesh, bone, skin, damage/noise maps and blood/bruise/
temperature colors. The extraction supplies original atlas rectangles and full
source textures. The browser supplies `_DamagePoints`, timestamps, `_Time`,
`_BurnProgress`, `_AcidProgress`, `_Temperature`, `_ElectrocutionIntensity` and
`_RottenProgress` from reconstructed state. Generated native shader code and
textures remain under ignored `public/local-assets/`; the tracked adapter contains
only the loader and compatibility changes.

The source PlayerSettings records `m_ActiveColorSpace = 1` (Linear). Texture metadata
distinguishes sRGB skin/flesh/bone maps from linear damage maps, with point filtering
and per-texture wrap modes. The adapter honors those sampler flags and converts
source Color uniforms into linear values, then applies an sRGB presentation
transfer to raw WebGL output. This keeps the native fragment calculations in the
source project's color space. Unity's documented
[2020.3 linear workflow](https://docs.unity3d.com/2020.3/Documentation/Manual/LinearRendering-LinearOrGammaWorkflow.html)
and [Color-property conversion](https://docs.unity3d.com/2020.3/Documentation/ScriptReference/Material.SetVector.html)
support these compatibility changes; native postprocessing and exact final-pixel
comparison remain unverified.

REA browser evidence
`ev_eb21ea6118d9d621feb90a0437358b310785068089ca2459844dab8acb6be9e4`
records a standalone Chrome/WebGL 2 fixture rendering a clean Human head next to a
wounded head using that extracted fragment program. The DOM reported ready, the
screenshot showed the native red wound, and no page or shader errors were captured.
This verifies browser compilation and that bounded rendering scenario. It does
not establish pixel equivalence against a running native Unity game.

## Verification

Seventeen ragdoll tests exercise hinge correction, brain death, blood-dependent muscle
strength, broken-bone/unconscious states, detached circulation, drowning/bleeding/
regeneration, bullet vital damage, explicit poses, frozen-body physiology, curve
interpolation, G-force injury, biological reaction-force breaks and snapshot validation/restoration. The local integration test reads
the actual extracted Human prefab, resolves every source limb pointer and all
eleven poses, simulates five seconds, and verifies a standing head height above
1.2 units, living limbs and finite body/motor state. The local integration test is
skipped when the extracted source data is absent. Android and Gorse integration
tests load their actual prefabs, verify source health/poses/rigging, simulate standing,
and exercise distinct projectile, EMP, thermal and dismemberment behavior. A wound
coordinate test verifies native local coordinates for all three species.

Five skin-state tests check bounded buffers, merge/age behavior, regeneration,
shader input values and species-specific rot. Four shader tests check source-stage
validation, removal of desktop-only declarations, original species texture/color
binding, source sampler/color-space flags, finite current uniforms and wound/time/temperature updates. Together these
26 focused tests and TypeScript checking pass with the local extracted assets.

## Remaining fidelity boundaries

- Unity's native Perlin noise and native AnimationCurve evaluation were not
  recovered from the managed artifact. The browser supports unweighted Hermite
  keyframes and a smooth injectable noise surrogate. The serialized infinity-mode
  mapping used for cyclic poses is an adaptation requiring native runtime
  comparison; weighted tangents are not implemented. Unity's public curve APIs
  delegate evaluation to native code, as shown in its
  [AnimationCurve bindings](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Export/Animation/AnimationCurve.bindings.cs).
- Unity update/manager scheduling and cross-object event order are adapted to the
  fixed browser simulation step. Pose animation uses a shared browser simulation
  clock. Native random sequences, exact random-size spawning,
  brain seizures and edge-case damage timing still need parity work.
- Collision impulses use the first entering contact in the current integration;
  native contact outlier removal, directional recursive impact propagation,
  prolonged crushing and friction wounds remain
  incomplete. Immediate browser slicing adapts a native deferred break path.
- Blood is currently a scalar native-blood amount. Mixed liquids, poison effects,
  syringe chemistry, penetration wounds, blood particles, tissue strings, flesh/
  bone fragments and world wound decals remain separate unfinished work.
- Native shader pixel equivalence, final native graphics/postprocessing parity,
  arbitrary packed/rotated sprite variants and native renderer scheduling remain
  unverified. The current adapter declines unsupported packed rotations rather
  than inventing atlas mappings.
- Brain injury recovery, zombie edge cases, artificial heartbeats, grips and native
  death/stat/achievement events are incomplete.
- Passing these tests proves the listed browser behaviors, not full native game
  equivalence or all living prefab variants.
