# Pistons, servos and the obsolete gear controller

`src/systems/mechanisms.ts` adapts `PistonBehaviour` and
`MotorisedHingeBehaviour` from the installed managed assembly. The four source
gear prefabs are also registered, with their tooth counts retained. Their
obsolete `GearBehaviour` does not implement a coupling or motor algorithm.

REA member Evidence
`ev_ad3cbb7579cbf593c628b84bb7e8c4936688bfb7ea6cabb07a78a042e6a9344e`
covers the three selected types, 26 methods and 24 fields, with complete static
selection coverage. Assembly SHA-256:
`83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`;
MVID: `2457bb93-e7d9-4337-91e2-d226cdef17a0`. The source was reconstructed
using ILSpy and checked against the REA method inventory/CIL constants.

| Source method | Build-local token | Adaptation |
| --- | --- | --- |
| `PistonBehaviour.MovePiston` | `0x06000c6e` | Limit reached latch, squared-error correction and destruction gate |
| `PistonBehaviour.UpdateLimits` | `0x06000c71` | Original translation limits times absolute local X scale |
| `PistonBehaviour.SetMotorSpeed` | `0x06000c72` | Scale/direction times speed multiplier and `max(1,Charge)` |
| `MotorisedHingeBehaviour.FixedUpdate` | `0x06000a75` | Shortest-angle servo drive, charge torque and motor-audio state |
| `MotorisedHingeBehaviour.GetScaledDelta` | `0x06000a76` | Target sign from local X reflection |
| `GearBehaviour.ManagedUpdate` | `0x060001af` | One-byte `ret` body: no forces or coupling |
| `GearBehaviour.ManagedLateUpdate` | `0x060001b0` | One-byte `ret` body: no forces or coupling |

The inspected regular Piston (`20282`) uses slider `19739`, speed multiplier 1,
limits approximately 0.05..0.82 and maximum motor force 50,000. Industrial
Piston (`20223`) uses slider `19742`, multiplier 0.8, limits 0.05..2.66 and force
100,000. Servo (`20312`) uses hinge `19631`, target 90 degrees, speed 1 and force
10,000. All are read from extracted prefabs rather than assumed from class
defaults (which differ for piston speed and servo force).

Inactive pistons retract; activation makes them extend. Reaching the target
limit sets a latch and commands zero speed. If subsequently displaced, the
controller uses `clamp01(positionError² * CorrectionSpeedMultiplier)` until a
new activation resets the latch. Damage disables the motor and blocks use;
repair permits operation again. Existing native motor-force values are retained.

Servos continuously drive the owner-minus-connected hinge angle toward the
configured target when active, and zero when inactive. The speed command is
`DeltaAngle(current,target) * Speed`; Planck's opposite relative-angle convention
requires a sign reversal and degrees-to-radians conversion. Unity's exact
half-turn boundary returns positive 180 degrees. Torque is `Force * (1+Charge)`.
Target-angle edits update the source indicator transform, and speed edits use the
source 0..10 UI clamp. Activation toggles the source light. Motor audio callbacks
use native degree-based joint speed and the original threshold/volume formula.
Both controllers implement discrete `IUse`, so continuous-use events do not
repeatedly toggle them.

A reflected piston requires Unity's `Slider.angle=180` behavior. Planck has no
public axis setter, so the adapter rebuilds that slider through the public joint
definition while retaining source ID, anchors, limits and force. The optional
`onJointReplaced` callback lets the host transfer finite break-force bookkeeping.
The inspected piston joints have infinite break thresholds. Limit detection uses
measured Planck translation, because Unity's native `limitState` is unavailable;
solver contact tolerances remain a fidelity boundary.

`GearBehaviour` and `GearManagerBehaviour` are marked obsolete in the source.
The manager shuffles/updates its registration list, but both managed gear update
methods are empty. The trigger handler only looks up another gear and discards
the result. Adding a browser `GearJoint` would therefore invent a behavior not
present in this build. Physical interaction between tooth colliders remains the
physics engine's job; matching tooth count metadata does not establish matching
Unity/Planck friction/contact behavior. No separate hydraulic controller class
was found in the recovered class inventory; the implemented pistons use native
slider joints.

Integration: `MechanismSystem(physical,options)`, `attach/remove`, `get/canUse`,
`use(entity,channel,continuous,targetPart?)`, `beforeStep`, `setServoDelta`,
`setServoSpeed`, and per-entity `snapshot/restore`. Damage callbacks connect to
the existing machinery system. Renderer/indicator and audio callbacks keep
presentation separate from force control. Snapshots validate all controllers
before mutation and preserve the piston latch and original limits.

Remaining boundaries include native solver/limit-state equivalence, dynamic
fixture rescaling (the controller reads scale but does not resize the host's
colliders), Unity lifecycle scheduling, native audio playback, and the piston's
0.05 Z-only visual offset. Tests cover extension/retraction, source values,
charge and scale, reflected axes, correction after displacement, damage/repair,
servo convergence/angle wrapping, reflected targets, UI setters, audio state,
discrete activation, invalid-state rejection and obsolete gear behavior.

Run: `npm test -- tests/mechanisms.test.ts`.
