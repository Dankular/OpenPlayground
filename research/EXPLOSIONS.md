# Fragmentation, pulses and ballistic shrapnel

`src/systems/explosions.ts` reconstructs `ExplosionCreator` from assembly
SHA-256 `83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`.
Focused REA member evidence:
`ev_d2e2a60c9e74c3e0a19c6ec2859ead914dcdd975be7a1a3bba3b8914fb529e21`.
This is static code evidence; tests exercise the adapted runtime.

Fragment rays are evenly spaced around the source position and stop at the
first non-trigger collider outside Ignore Raycast. Shipped Physics2D settings
disable both trigger queries and queries starting inside colliders. The fragment
message is separate from native limb wounds, damage and organic dismemberment.
Impulse points use the ray hit; direction points from explosion to the hit
rigidbody center. Bullet/blunt wound selection, integer intensity multiplier
3..7, damage force × 1.5 and source Android slicing immunity are preserved.

Pulse explosions query at most 64 overlapping colliders on Objects (9), Debris
(10) and CollidingDebris (13). They apply the source force/range expression and
mass capped at one, with per-collider semantics and source break probability.
Tank muzzle pulses pass force 3 and range 10, in that order.

`WeaponSystem.onFragmentation` routes existing ExplosiveBehaviour rays to this
shared engine while retaining its extra burning, lift and temperature effects.
Native projectile explosions preserve their own serialized ExplosionParameters.
Callbacks keep unrelated fragment receivers separate from limb damage so the
same hit is not applied twice.

`scripts/extract_shrapnel.py` recovers the actual level1 GlobalShrapnelEmitter
and its external cartridge reference into `src/generated/shrapnel.json`.
The reference resolves to sharedassets0.assets:20038, the original 5.56x45mm
cartridge. `ShrapnelSystem` waits for end of frame, then fixed update, emits
directions distributed over the unit circle, and retains the source 16 iteration,
30 distance, 4× ricochet and no-tracer settings. Layer mask 10752 is preserved.
The emitter's ownership is independent of the destroyed explosive, as in native
GlobalShrapnelEmitter. Water layer 16 remains recorded in the source bundle;
BallisticsSystem's complete native water traversal/splash behavior is not ported.

Tests verify blocking geometry and radial impulse, wound/damage dispatch without
duplicates, pulse layer/trigger/mass rules, underwater effect and shrapnel
parameters, delayed real-cartridge shrapnel hits and independence from source
deletion. Original decals, particles, sounds, procedural limb fragmentation,
complete water effects and paired Unity solver replay remain fidelity gaps.
