# Valves, duplicators, outlets, identifiers and container leaks

`src/systems/liquid-devices.ts` controls the original liquid-network devices.
`LiquidSystem` owns their mixtures and pressure reservoirs; `WireSystem` owns
wire transport. Device attachment follows liquid attachment. Render-frame work
runs before `LiquidSystem.frame`, and fixed-step drain/point transfer runs in
`beforeStep`. Source component data is immutable; controller state is separate.

REA evidence `ev_ea1e29525adcdc7c56db6f4ef9242a0eff17c8aaca84c6cf16cd5ece13f375d4`
inspected ten types, 86 methods and 66 fields with complete static selection
coverage. Recovered source is under ignored `research/local/decompiled`.
Assembly SHA-256 is
`83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`,
MVID `2457bb93-e7d9-4337-91e2-d226cdef17a0`.

| Native controller | Runtime behavior |
| --- | --- |
| `ValveBehaviour` | Capacity .5; liquid and pressure pass only above valve position .5. Source animation curve, duration and angle are retained. Channel 1 opens, 2 closes, other channels toggle the last target. Ordinary use preserves simultaneous turn coroutines; explicit open/close replaces them. |
| `LiquidPressureValveBehaviour` | The same animated pressure gate, but liquid transfer is always prohibited. |
| `LiquidDuplicatorBehaviour` | Replicates each existing liquid by its current amount / capacity × rate multiplier × (1 + charge × .1) × delta time × 60. Empty containers produce nothing. Overflow is allowed, so a final generating frame can exceed nominal capacity. The actual prefab capacity is 53.57141876220703, unlike the class default 1.7857144. Destruction stops generation and push pressure. |
| `LiquidOutletBehaviour` | Pull pressure, capacity 2.8, overflow allowed. Drains .1 every physics tick only while total exceeds .1. Charge changes particle speed rather than drain volume. |
| `LiquidFilterBehaviour` | Bounded capacity 28. The recovered class has no filtering algorithm; it retains all mixture types. |
| `LiquidentifierBehaviour` | Bounded capacity 7. Initialization waits 1.123 seconds, then 30 scan blinks each wait .0682 seconds. Native descending percentages use ties-to-even rounding and a final remainder. Disabling cancels the job. |
| `LiquidContainerLeakingBehaviour` | Entry/exit shots create holes with intensity clamped .2..5; a wound-causing unstab creates intensity 5. Source canister intensity multiplier is .05. Each hole drains intensity × .05 × multiplier per physics tick while amount exceeds that rate. Repair removes every hole. |
| `LiquidContainerHoleBehaviour` | Standalone fixed-tick drain using its source container and configured rate. |
| `PointLiquidTransferBehaviour` | Bottle outlet checks continuous use, transforms the configured query point, honors layer mask and transfers units-per-second × fixed delta to the hit container. The native `OnlyWhileUse` field is not read by its method. |

Duplicator and identifier channel 1 start a guarded flush. Drain uses the initial
amount × frame delta / 1.521. It continues until both empty and the sound has
finished, with a five-second ceiling. The native clip is 3.807281494140625 seconds;
the audio-duration callback can supply a different serialized clip length.
An active duplicator continues generating during a flush, as in the source.

Outlet and hole emission callbacks expose amount, mixture color, position,
direction and pressure speed. A corresponding particle collision copies the
current mixture into the target without draining it a second time. Rendering
and collision routing must consume those callbacks; draining alone does not
establish visible splashes or deposition. Underwater puff selection, native
particle randomness and fancy blood decals remain presentation gaps.

Use/canUse support a selected part and descendant dispatch, including syringe,
tank and pump handling in `LiquidSystem`. Snapshot/restore retains valve jobs,
generation, flush/scan timing and holes, rejects malformed state before mutation,
and does not replay use, audio or liquid-entry effects. Scanner light randomness
is regenerated on subsequent blinks; its exact intermediate bulb pattern is not
serialized. Frame-quantized Unity coroutine timing is approximated with browser
frames. Default point-overlap selection uses Planck fixture order; callers can
provide the host query for consistent overlap priorities.

`LiquidLevelGateBehaviour` is deliberately unsupported: its recovered
`FixedUpdate` throws `NotImplementedException`. No liquid-level detector has
been invented for that obsolete component.

`tests/liquid-devices.test.ts` covers native capacities, strict valve thresholds,
pressure-only gating, duplication/overflow/destruction, flush timing, scanning,
outlet residuals and particle copies, shot holes/repair, continuous Bottle
transfer, targeted syringe activation, snapshot validation, and attachment of six
original extracted device prefabs. Original-asset checks skip when local assets
are absent.
