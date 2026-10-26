# Thermal, electrical and machinery reconstruction

Source: installed `Assembly-CSharp.dll`, SHA-256
`83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`.
ILSpy reconstructions are retained locally in `research/local/decompiled`.

REA MCP retained selected CIL member evidence:

- PhysicalBehaviour core: `ev_74559254575850e45ea84018adb6ab5b98ac13aeafc95ec2010404af68d105d0`.
- PhysicalProperties, TemperatureTransferBehaviour, ExplosionCreator,
  FirearmBehaviour, ExplosiveBehaviour:
  `ev_25760e486adb5480d113d509b225739ba8a5d7dc5f0f356913466976246ed4dd`.
- GeneratorBehaviour, HeatingElementBehaviour, HoverboxBehaviour, RotorBehaviour,
  IonThrusterBehaviour, FanBehaviour, Cartridge, BallisticsEmitter:
  `ev_6b257f203131e5424e8f53c271e1e3e8640661004cb77d97a7cacd5230aa06a8`.

These are static evidence. No native execution or native/browser equivalence has
been observed for these systems.

`src/systems/physical.ts` reconstructs per-fixed-step 0.95 charge decay, material
conduction flags, contact heat transfer weighted by heat capacity, friction
heating, ambient relaxation, ignition, combustion progression, fire intensity and
wet extinguishing. `ObjectArea` follows the source expression: the diagonal of
the sprite bounds, despite its name. Render-frame charring is kept separate from
fixed-step simulation because the original expression depends on frames.
`physical-world.ts` connects those rules to actual touching Planck fixtures and
resolved prefab PhysicalProperties. Freezing a rigidbody does not make it a Unity
static GameObject; frozen combustible objects can still burn.

`devices.ts` reconstructs generator activation/warmup/charge and heat, heater and
cooler target tracking, hoverbox gravity cancellation and damping, rotor motor
speed/charge-dependent torque and ion-thruster force. Device settings come from
each prefab's serialized script data. These controllers do not substitute one
common behavior for all catalogue machinery.

Remaining boundaries include the ambient-temperature spatial grid option,
Perlin-noise ignition sampling (browser receives a random sample), local fire
propagation maps, fire spread to nearby non-contacting objects, underwater
electricity, penetration/stabbing contact rules, particle emitters, sound loops,
material shader progress, damage-dependent device destruction and activation
wires. Fan behavior is inspected but not registered as implemented by devices.ts.

Two browser robustness adaptations differ from undefined/extreme source cases:
zero-size heat capacities are guarded, and zero thermal multipliers do not
divide by zero. Temperatures are clamped to finite physical bounds. These are
not evidence of native equivalence for malformed data.

Validation includes thermal-energy conservation across unequal capacities,
non-overshooting exchange, exact decay/conduction coefficients, combustion and
wetness transitions, static/disabled flags, actual contact integration, removal
cleanup, generator warmup, heater convergence, hoverbox gravity cancellation,
and transformed ion thrust. Tests validate the implemented boundaries only.
