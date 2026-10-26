# Liquid reservoirs and syringes

`src/systems/liquids.ts` reconstructs the installed `BloodContainer`,
`SyringeBehaviour`, syringe subclasses, pressure averaging and circulation
mixture transport. `liquid-effects.ts` supplies the separate native liquid
lifecycle effects; `syringe-contact.ts` supplies needle lodging physics, and
`syringe-break.ts` supplies delayed breakage and nearby liquid dosing. These
boundaries keep contact detection, liquid quantities and physiological effects
independent and testable.

REA member Evidence
`ev_8c05bbdcd362eee1ca4dffa6744a8c2eac76085e2df70e1a98b2dfff7f526caf`
covers eight selected types (`SyringeBehaviour`, `BloodContainer`,
`BloodWireBehaviour`, `Liquid`, `CirculationBehaviour`, `LifeSyringe`,
`EmptySyringe`, `PinkSyringe`), 145 methods and 69 fields with complete static
selection coverage. Artifact SHA-256 is
`83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`, MVID
`2457bb93-e7d9-4337-91e2-d226cdef17a0`. Source behavior was reconstructed with
ILSpy and checked against the managed metadata/CIL. This does not establish
runtime equivalence with Unity's native contact solver.

The source behaviors that distinguish these syringes from a generic click-to-heal
tool are implemented:

* A typed syringe starts with 1.4 liquid units, normally as an infinite source.
  One unit is 5/14 litre; a full syringe is half a litre. The extracted Empty
  Syringe starts empty, finite and pulling.
* `PressureDirection` has exact ordinal values Push=0, Pull=1, None=2. Activation
  channel 0 toggles push/pull; channel 1 forces push; channel 2 permits pull only
  when finite. Infinite-source toggling forces push. Infinite typed syringes
  replenish their registered liquid each fixed step and always push, even if
  their displayed pressure mode is pull.
* Transfer occurs only to needle-lodged `BloodContainer` targets, at the source
  `TransferRate` of 0.01 units per 0.02-second fixed step. Finite syringes average
  pressure with their targets and transfer according to the measured pressure
  difference. The source None mode is passive pressure equilibrium, rather than
  a hard transfer-disable switch.
* A circulation reservoir has nominal limits 0..1 but permits overflow. Serum
  is added to existing blood instead of replacing it or being blocked by a full
  limb. Typed syringes stop pushing when that serum is at least 0.5 units in a
  circulation target. Empty and Pink mixtures use the source unrestricted path.
* Mixtures transfer proportionally. `Drain` removes equal quantities per liquid
  type. Source bounded-target transfer removes the donor quantity even if the
  recipient accepts less; this source loss behavior is retained.
* First entry of a liquid key invokes its entry callback once. Liquid updates
  happen strictly after the container timer exceeds one second; the timer then
  resets to zero. Temporary removal/repeated effects belong to the liquid-effects
  adapter. Trace cleanup at 0.02 preserves a newly increasing trace and removes
  decreasing or unchanged traces, matching `RefFloat.Previous` behavior.
* Serum diffuses proportionally between the original connected limb neighbors
  at 1.5 units per second, alternating traversal direction. Removed hinges stop
  that path. Ragdoll scalar blood transport is disabled when this adapter owns
  mixture transport; original-blood quantities remain synchronized with the
  physiology system's bleeding and regeneration.
* Native Pink Syringe fingerprints choose the original set of poison/serum
  ingredients and quantities. The fingerprint and mixture survive scene saves;
  infinite Pink sources use the source proportional replenishment rule.

The four native chemical recipes are implemented on the one-second update:
tritium+mending→immortality, acid+mending→osteomorphosis (both outside a body),
water-breathing+tritium→exotic liquid, and adrenaline+mending+inert→beverage M04.
Colors use the native liquid registry and amount-weighted mixtures.
This includes the constructor colors for chemistry liquids, rather than a
shared placeholder tint. Correct color/registration does not imply complete
chemistry behavior: nitroglycerine's dynamically attached explosive device,
exotic-liquid delayed force/flash routines, and some advanced chemistry agents
remain separate device/effect work.

`SyringeBreakSystem` adapts the original nonempty guard and shot handling:
an entrance shot waits 0.05 seconds, while exit shots, fragments and explicit
breaks request immediate destruction. Work is deferred outside the locked
Planck callback. The extracted splash radius is three world units. Its
64-collider query buffer determines the denominator, including non-limb hits;
each organic circulation hit receives every liquid at
`total / liquidTypeCount / overlapColliderCount * 3`. Androids are excluded.
The source gives every liquid an equal splash dose, even when its concentration
in the syringe differs. Empty syringes survive the source liquid-empty guard.
The original particle prefab and its audio are presentation work; physical
dosing and the resulting serum/poison effects are handled independently.

Flasks (default 2.8), liquid canisters (default 70), and blood tanks (14) expose
their source capacities to the same transfer system. Infinite liquid sources
add 10 units per second in the frame update. Tank pressure modes and drain
amounts are implemented. Canister text/response-curve buoyancy, tank particle
spills, native syringe splash presentation and arbitrary modded liquid classes
remain separate visual/device/native boundaries; they are not implied by
reservoir support.

Integration uses `LiquidSystem.attach/remove`, `beforeStep` after the existing
physiology step, and `frame` once per simulated render frame. Pass the effect
adapter as `effects`, plus `getBlood/setBlood` callbacks. Do not call
`effects.frame` separately: the liquid system already invokes it. Needle events
call `lodged/dislodged`. The renderer reads `computedColor`, `scaledAmount` and
`pressureMode`; the interface exposes finite/infinite and pressure controls.

Snapshots validate every reservoir, registered ID, finite quantity, timer,
mode and Pink fingerprint before mutation. Distribution restoration bypasses
entry callbacks, so loading a previously saved life-serum dose does not heal or
revive the body again. The optional effect `resume` hook rebuilds ongoing
healing/corrosion jobs after all distributions are installed, without replaying
permanent entry effects. Needle cross-entity links are restored by the contact
adapter's scene state.

Validation: `npm test -- tests/liquids.test.ts` exercises quantity/overflow and
source transfer loss, mixtures, cleanup, the strict update timer, recipes,
pressure, lodging/detachment, finite pull/infinite push, diffusion after joint
removal, Pink serialization, source container capacities and the extracted
Life/Empty defaults. An extracted Human test verifies immediate Life-serum
revival and delayed Death-poison effects through the actual reservoirs.
`tests/syringe-break.test.ts` checks delayed breakage, nearby organic dosing,
Android/distant-target exclusion and the empty-syringe guard.
`tests/syringe-integration.test.ts` physically drives an extracted Life syringe
into an extracted Human head and verifies lodging, transfer and revival through
the combined simulation systems. This is a browser-port simulation test, not a
paired native-game comparison.
