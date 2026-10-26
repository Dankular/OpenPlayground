# Firearms, explosives and original audio

The implementation uses the inspected Assembly-CSharp build recorded in FINDINGS.md.
REA static member evidence for FirearmBehaviour, ExplosiveBehaviour and
ExplosionCreator is `ev_25760e486adb5480d113d509b225739ba8a5d7dc5f0f356913466976246ed4dd`.
BallisticsEmitter and Cartridge are covered by
`ev_6b257f203131e5424e8f53c271e1e3e8640661004cb77d97a7cacd5230aa06a8`.
Readable control flow comes from focused ILSpy reconstruction. These records do
not establish native execution or native/browser equivalence.

`src/systems/ballistics.ts` adapts the original emitter's 0.08-unit penetration
steps, 128-iteration and 1000-distance limits, material hardness, distance damage,
speed attenuation, entry/exit events, ricochet probability and reflected course,
traversal distance/drop, charge transfer and hit forces. Queries use real Planck
fixtures, skipping source-entity and sensor geometry. Material softness,
brittleness and speed absorption come from resolved PhysicalProperties. Cartridge
configuration comes from the original serialized Cartridge asset, with exact file
and path identity; a missing cartridge does not receive a made-up substitute.

`weapons.ts` implements FirearmBehaviour activation, delayed shots, held automatic
fire, shot intervals, bullets per shot, barrel position/direction, spread, recoil
and heat. Entry/exit hits call the limb shot implementation. ExplosiveBehaviour
uses source fuse delays and use/temperature/burn/charge/impact/shot/fragment
triggers. Fragment rays apply impulses and limb damage, with source dismemberment
chance. Source burn/lift/temperature effects and source destruction flags apply.
Snapshots preserve delayed shots, firing timers and explosive fuse state.

Remaining boundaries include specialized weapons with other script classes,
attachment-dependent spread multipliers, muzzle shockwaves and casings, water/lava
ballistic diversion, explosive rounds, kill zones, ballistic shrapnel emitters,
destruction of individual children of compound entities, non-limb Shot handlers,
native coroutine/render scheduling, exact ray/layer semantics and native visual
effects. The current yellow tracer and explosion ring are browser presentation
adaptations, not reconstructions of all original particle systems. Repeated
arming uses the earliest scheduled fuse rather than duplicating native coroutines.
In-flight projectiles are not preserved in browser scene saves.

`audio.ts` resolves original audio by source file and path ID, loads WAV buffers
on demand and plays original firearm and material-impact samples. Firearm volume
and automatic first/subsequent-shot differences follow source fields. Material
impact threshold, mass scaling and soft/hard selection follow PhysicalBehaviour.
Playback pitch follows simulation time scale, including pause. Browser spatial
audio currently uses a stereo/attenuation approximation; original mixer routing,
reverb, distant effects, all device loops and other sound events remain separate
work. Web Audio is unlocked only following a user interaction.

Tests exercise penetration entry/exit, source exclusion, empty-space traversal,
charge transfer, nonpenetrable materials, damage bounds, source cartridge firing,
recoil and heat, shot delay/automatic intervals, timed and thermal detonation,
fragment impulses and fuse persistence. Audio tests verify source identities are
not conflated across files. None of these narrow tests proves complete weapon or
audio parity.
