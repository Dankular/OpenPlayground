# Water, lava and map environment reconstruction

`src/systems/environment.ts` adapts the installed game's `WaterBehaviour`,
`LavaBehaviour`, `MapConfig`, and `EnvironmentalSettings`. It uses the extracted
map nodes, trigger fixtures, source material properties and baked physical-object
collider grid samples. It does not execute Unity code.

The inspected `Assembly-CSharp.dll` has SHA-256
`83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395` and MVID
`2457bb93-e7d9-4337-91e2-d226cdef17a0`. REA member Evidence
`ev_b26b247cfd0136d7e24bb7bb4aab06fc604abebd93994c0ec06d848e3a46c881`
covers the selected four types, 50 methods and 63 fields with complete static
selection coverage. The local retained bundle is
`research/evidence/environment-rea.json` (ignored by Git). ILSpy reconstruction
was compared against the REA CIL anchors. Static agreement does not establish
Unity/Planck runtime equivalence.

| Method | Build-local token | Browser behavior |
| --- | --- | --- |
| `WaterBehaviour.ManagedFixedUpdate` | `0x0600120d` | Per-sample upward buoyancy, drag, temperature interpolation, wetness and boiling scalding |
| `WaterBehaviour.GetDragFactor` | `0x0600120e` | Original clamped power function |
| `LavaBehaviour.FixedUpdate` | `0x06000237` | Point damping, mass damping, buoyancy, ignition and heat transfer |
| `MapConfig.ApplySettings` | `0x06000961` | Gravity, ambient temperature and weather settings |
| `MapConfig.SetGravity` | `0x06000962` | `(0, Gravity)` world vector |

The normal fixed interval is 0.02 seconds. Water force for each submerged baked
sample is `mass / sampleCount * depthFactor * Properties.Buoyancy *
BuoyancyModifier * Water.Buoyancy`, upward, where `depthFactor` is
`clamp(abs(bodyY-surfaceY)^0.25,1,8)`. Drag uses each point's linear plus angular
velocity and the original depth multiplier. Temperature approaches
`min(ambient, boilingPoint)` by `0.05 * HeatTransferSpeedMultiplier` each fixed
step; wetness increases by 0.1 each step and the physical frame update later
dries/clamps it. A saved state can therefore legitimately contain wetness above
one between those updates.

At the boiling boundary, water stops applying buoyancy, sets burn progress to at
least 0.5 and adds pain to affected people. Water freezes strictly below its
configured freezing point and evaporates strictly above `boilingPoint + 100`.
Frozen water captures objects with at least 5% sample immersion, preserves their
prior body type, sets wetness to one, extinguishes fires and releases them on
thaw or removal. Native ice object activation and water-only render objects are
reflected in the source node/renderer flags; a rendering adapter must honor
changes to those flags.

Lava preserves an unusual shipped arithmetic detail: the outside-sample count
is divided by the total count as integers before conversion to float. Any
sampled immersion therefore uses the full heat interpolation factor, rather
than a proportional fraction. Lava also applies its mass-dependent velocity
multiplier once per immersed sample, plus 0.95 when fully immersed. It ignites
through the physical system's source flammability rule; limb burn and internal
temperature damage are handled by the ragdoll system.

Drowning is deliberately handled once: the environment supplies wetness and
the existing reconstructed `LimbBehaviour.HandleDrowning` logic uses the brain's
wetness to remove oxygen over 40 seconds. Water-impact damage above speed 30
and boiling pain are forwarded to the ragdoll adapter. Rain, snow and fog are
cosmetic in the source settings and do not invent additional wetness or forces.
Their display densities use the source `1 - pow(0.3, deltaTime)` fade.

Runtime integration uses `attach`/`remove`, `beforeStep` before ragdoll updates,
and `frame` for weather fades. Map config automatically applies source settings;
`onSettings` supplies the shared physical ambient temperature. `captureSettings`
and strictly validated `restoreSettings` allow scene-import rollback to restore
world gravity and ambient state. `snapshot`/`restore` provide map scene state.

Remaining native boundaries include Unity's 0.02-radius random grid jitter,
Physics2D overlap and force solver differences, freeze-stack interactions with
providers beyond water/user freezing, collider Z-depth filters, native splash,
sizzle, weather particle/audio prefab playback, SpriteMask water clipping and
the original water shader's thermal appearance. Planck fixture tags identify
the original collider node; older runtimes without tags use sensor/position
matching. No native particle fidelity or full environment equivalence is claimed.

Validation: `npm test -- tests/environment.test.ts` covers source water force
and partial immersion, drag, temperature, boiling, freeze/thaw, evaporation,
ignore lists, splash thresholds, lava integer heat arithmetic and damping,
contact masks, disabled temperature simulation, settings rollback and the
extracted Sea map's actual trigger/config binding. Tests requiring installed
game assets skip when those ignored assets are absent.
