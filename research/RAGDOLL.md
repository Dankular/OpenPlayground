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
  physiology, limb injury and disconnected hinge topology; invalid snapshots are
  rejected before mutations and unknown input keys cannot overwrite runtime state.

The shipped `AllLimbLoopChecks` does not increment its divisor. The browser keeps
that observed sum behavior rather than silently substituting an average.

## Verification

Ten focused tests exercise hinge correction, brain death, blood-dependent muscle
strength, broken-bone/unconscious states, detached circulation, drowning/bleeding/
regeneration, bullet vital damage, explicit poses, frozen-body physiology, curve
interpolation and snapshot validation/restoration. The local integration test reads
the actual extracted Human prefab, resolves every source limb pointer and all
eleven poses, simulates five seconds, and verifies a standing head height above
1.2 units, living limbs and finite body/motor state. The local integration test is
skipped when the extracted source data is absent.

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
  clock. Native random sequences, exact random-size spawning, G-force measurement,
  brain seizures and edge-case damage timing still need parity work.
- Collision impulses use the first entering contact in the current integration;
  native contact outlier removal, directional recursive impact propagation,
  prolonged crushing, friction wounds and joint reaction-force breakage remain
  incomplete. Immediate browser slicing adapts a native deferred break path.
- Blood is currently a scalar native-blood amount. Mixed liquids, poison effects,
  syringe chemistry, penetration wounds, blood particles, tissue strings, flesh/
  bone fragments, damage shaders and wound decals remain separate unfinished work.
- Brain injury recovery, zombie edge cases, artificial heartbeats, EMP behavior,
  skin rot simulation, grips and native death/stat/achievement events are incomplete.
- Passing these tests proves the listed browser behaviors, not full native game
  equivalence or all living prefab variants.
