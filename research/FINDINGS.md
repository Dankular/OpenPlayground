# People Playground → OpenPlayground

This is an incremental reconstruction of the supplied local Windows installation,
with Three.js rendering and Planck 2D physics. It is not a Unity binary-to-JavaScript
translation, and full game equivalence has not been established.

## Source identity

- Installed root: `D:\SteamLibrary\steamapps\common\People Playground`.
- Main code artifact: `People Playground_Data/Managed/Assembly-CSharp.dll`.
- SHA-256: `83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`.
- MVID: `2457bb93-e7d9-4337-91e2-d226cdef17a0`.
- REA observed a Unity Mono, IL-only AnyCPU managed assembly with complete
  metadata: 1,581 type definitions and 8,584 method definitions.
- Identity evidence: `ev_cf59532f8419043018160ec280445d601901cd7a86606b6b728fef328ef6c628`.
- Unity serialized asset version observed separately through UnityPy: `2020.3.1f1`.

## Evidence and interpretation

REA MCP inspected the shipped assembly without loading or executing target code.
An unrestricted member inspection exceeded REA's 64 MiB representation budget;
two subsequent selections succeeded with complete coverage within those selections.
Complete local evidence is exported under the Git-ignored `research/evidence/`.
ILSpy 11.0.0.9375 was used as an additional reconstruction tool. Its generated C#
is an interpretation of the CIL, not recovered original source. Generated C# is
kept under the Git-ignored `research/local/`.

| Question | Evidence | Finding and limits |
| --- | --- | --- |
| Rendering/camera model | Core REA member evidence below; ILSpy `CameraControlBehaviour` | Camera uses `orthographicSize`. Cursor-origin zoom scales the size by wheel delta × speed × 0.1 × sensitivity and offsets camera position to retain the cursor anchor. Code defaults: zoom limits 0.2–1000. Prefab overrides require separate inspection. |
| Core simulation boundaries | `ev_74559254575850e45ea84018adb6ab5b98ac13aeafc95ec2010404af68d105d0` | Five exact types: `PhysicalBehaviour`, `PersonBehaviour`, `LimbBehaviour`, `Global`, `CameraControlBehaviour`. 307 fields and 291 methods. Names and CIL anchors are observations; feature equivalence is not implied. |
| Pause and slow motion | Same core evidence; ILSpy `Global` | `Update` approaches a pause-dependent timescale target. `TogglePaused` schedules a delayed simulation/sync. `ToggleSlowmotion` selects preference percentage / 100. Installed user preference is 20%, so the browser exposes 0.2×. |
| Drag and catalogue structure | `ev_901b772f749ffcb0290bff505790c735220492da943dcf132e8c2121ad410751`; ILSpy `DragTool`, `GentleDragTool`, `SpawnableAsset` | Six selected types, 80 fields and 93 methods. Original drag uses a rigidbody/hinge when running and direct movement while paused. Browser mouse joints approximate running drag. Spawnable metadata references a category, prefab and view sprite. |
| Time and gravity | UnityPy, `globalgamemanagers` | Serialized fixed timestep ≈0.02 s; gravity ≈(0, −9.81); velocity and position iterations 16. Installed config requests PhysicsIterations=32; runtime override remains a separate question. |
| Grid and rotation | Installed `config.json` | GridSnap=0.25 and AngleSnap=15. These are preferences in this installation, not universal defaults. |
| Human geometry/assets | UnityPy local extraction pipeline | Recovered 14 bodies and 13 hinge joints, masses, damping, transforms, colliders and all human sprites. Recovered 284 catalogue records across nine categories and 267 PNG sprites. Twenty-four catalogue icon decodes failed explicitly. Refer to generated `public/local-assets/manifest.json` for source hashes and warnings. Parser output is separate from REA Evidence. |

## Current reconstruction boundary

The objective is a complete rewrite with all assets. It remains active and is not
complete. The browser now loads all 284 catalogue prefabs through a generic
source-data adapter. Source colliders, rigidbody settings, joint families, break
thresholds, render attachments and materials replace the initial primitive-only
implementation. Source visibility/lock flags apply by default; a Show all objects
control exposes the complete library. A structural sweep instantiates all 284
prefabs and checks body/joint identities, finite physics and cleanup. That sweep
does not verify each item's game behavior.

Active ragdoll poses and scalar physiology/injury, heat/electricity/fire, selected
machinery, firearm ballistics and basic ExplosiveBehaviour have implementations.
Original shot/impact audio is loaded on demand. See PHYSICAL.md and RAGDOLL.md for
evidence and precise limitations. Scene v2 saves build identity, prefab/body/joint
identity and implemented system state with staged import validation.

Full extraction now preserves 36,358 unique serialized objects and decoded media;
all catalogue prefabs and fifteen maps are available locally. The original missing
icons were fixed. One postprocessing shader export remains unsupported; its bytes
are retained. Extraction is distinct from runtime behavior, rendering and effect
parity. The full catalogue uses 238 distinct MonoBehaviour classes, with many
unassigned reconstruction obligations. Run scripts/rewrite_coverage.py to regenerate
the explicit incomplete ledger at research/local/rewrite-coverage.json.

The medical repair pass adds mixed-liquid reservoirs, syringe pressure modes,
needle lodging/extraction, serum/poison effects and permanent-stat persistence.
Shared machinery damage/repair and delayed pad-local defibrillation are also
implemented. See LIQUIDS.md, LIQUID_EFFECTS.md and MACHINERY.md for source anchors,
tests and remaining boundaries. These additions do not establish native parity.

Further work includes remaining specialized scripts, advanced liquid devices, wires and
activation propagation, vehicle controls, map/environment systems, particles and
compiled shaders, native contraption format, mods, menus/settings, platform
integrations and native runtime comparisons. Browser JSON saves are a new format;
they are not native game contraption serialization.

Latest browser machinery check:
`ev_36038f79017d12cf23d5dce008ef72c13a3eaab2aa763229630cbff987e4d4a3`.
REA searched for Generator, spawned its original prefab, activated it, resumed
simulation and paused again. DOM captured 30.1 C and 95.0 charge after warmup;
all declared actions completed with no captured browser errors. This confirms
the browser integration, not equivalent native generator timing.

## Browser verification

REA performed the declared actions in [browser-smoke.json](browser-smoke.json)
against the local app with headless Chrome, at a 1440 × 1000 viewport. Evidence:
`ev_0b14a24a68d0f2820d1a7b39d85227413234e49a5cc7833dfcba8544de5428d4`.
The scenario paused simulation, cleared the chamber, spawned a human, froze and
rotated it, and advanced one physics frame. All actions completed. Captured DOM
confirmed the paused state, empty chamber after clear, one object after placement,
14 human bodies and frozen state. A screenshot confirmed the original sprites
rendered. No page errors or console errors were captured during this scenario.
This tests the browser reconstruction; it is not a comparison against a running
native game. The scenario does not exercise drag/pan gestures or file dialogs.

Physics tests cover floor collisions, jointed-body stability, pause and explicit
stepping, scene round trips, frozen objects, malformed import preservation and
joint/grab cleanup. The extracted human has an additional optional test that runs
when local assets exist. Extraction was run twice with matching rig and manifest
digests; all 14 human sprite references resolved to exported PNGs.

## Repeatable investigation

1. Verify the assembly SHA-256 before reusing build-local tokens or existing evidence.
2. Call REA `inspect_managed_artifact` with `detail: summary` for a new build.
3. Call `inspect_managed_members` with exact `type_names` and `detail: summary`.
   Broad all-member inspection is known to exceed the current budget for this build.
4. Page needed rows through `inspect_analysis_view` using the retained parent ID.
   Preserve method tokens, signature hashes and normalized CIL hashes if comparing builds.
5. Use ILSpy for focused reconstructions and the UnityPy script for serialized data.
6. Validate behavior in the browser, and compare against an explicitly scoped native
   runtime scenario before calling a feature equivalent. No native runtime has yet
   been observed in this investigation.

No native REA disassembler session was opened; there is no such session to close.
