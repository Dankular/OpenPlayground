# Machinery and defibrillator reconstruction

The source assembly is `Assembly-CSharp.dll`, SHA-256
`83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`,
MVID `2457bb93-e7d9-4337-91e2-d226cdef17a0`.
REA medical member inspection is retained in
`ev_6568547954d95f4054bbfebf0990e1e8323ac6585ec172ffc57bf70413c1169a`.
Machinery member inspection is retained in
`ev_8266dda7678a1310d50831849128e3ce1af94f68e03dbc669c82a3693d3909f7`.
Static inspection and recovered C# establish the source rules; they do not
establish equivalence to the running native game.

`DefibrillatorBehaviour.DefibRoutine` waits two scaled seconds, then invokes
`Defibrillate` on both referenced pads. Each pad receives 0.2 charge. A circle
of radius 0.1 centered at local (-0.1, 0) finds circulation components and resets
IsPump to WasInitiallyPumping, BloodFlow to 1, consciousness to 1, and adds 20
adrenaline. This does not heal health, brain death, blood loss or severed joints.
The browser implementation uses exact circle/fixture overlap and component
pointers; original screen typography and native audio timing need comparison.

`DamagableMachineryBehaviour` occurs 103 times in catalogue prefabs. The shared
adapter now implements serialized health and firearm/stab/fragment/break damage,
slice and EMP failure, thermal/fire/water thresholds, indestructibility, thermal
shielding, repair and persisted state. Referenced controller failure is queried
at runtime without modifying shared extracted prefab data. Fragment damage is
force × ExplosionDamageMultiplier × 250. Heat failure uses strict greater-than
comparisons. Water failure requires non-waterproof machinery, wetness > 0.95 and
random > 0.9 per fixed step. Repair resets burning and limits temperature below
the damage threshold.

Remaining machinery obligations include native broken-machine material/sparks,
secondary explosions and debris prefabs, arbitrary serialized UnityEvent calls,
and specialized controllers beyond the registered device/weapon subset. The
adapter is not a complete port of all 103 objects containing this component.

Tests exercise delayed pad effects, distance rejection, preserved brain death,
source damage scales, controller failure/repair, thermal shielding, waterproofing,
indestructibility and invalid state rejection. They verify the reconstruction;
no paired native runtime comparison has been performed.
