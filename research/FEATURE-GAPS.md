# Runtime behavior gaps

The catalogue and extracted media are available, but this is an incomplete
reconstruction. Loading all 284 prefabs does not establish that their original
gameplay works. `scripts/rewrite_coverage.py` inventories the 238 distinct script
classes found on catalogue objects and records partial implementations without
claiming native parity. Counts describe components/classes, not percent complete.

## Current repair pass

- Syringes: reconstruct contents, pressure modes, finite/infinite sources,
  needle lodging, extraction and circulation effects. Previously these objects
  had sprites and colliders without syringe gameplay.
- Defibrillator: implement the delayed shock at the actual pads, circulation
  recovery and activation state.
- Machinery: implement shared damage, heat/water failure, controller disabling
  and repair. The native damage component appears 103 times in catalogue prefabs.

## Other confirmed obligations

These source classes occur in recovered catalogue prefabs but have no complete
native-equivalent adapter. This is a source inventory, not an exhaustive list of
bugs observed in a running native comparison.

| Area | Source examples | Missing work |
| --- | --- | --- |
| Vehicles | CarBehaviour (6), HovercarBehaviour, BoatMotorBehaviour, TankBarrelBehaviour | Source drive/brake/reverse/hover/boat controllers now implemented; native tank projectile instantiation, cosmetic/audio effects and solver replay remain |
| Mechanisms | PistonBehaviour (2), MotorisedHingeBehaviour, GearBehaviour | Piston/servo source controllers now implemented; gear update is a native obsolete no-op; native solver/audio comparison remains |
| Sensors/logic | DetectorBehaviour (6), GateBehaviour, TimedGateBehaviour, LaserReceiverBehaviour | Detection filters, signal timing and usable connection tools |
| Specialized weapons | ProjectileLauncherBehaviour (8), RocketLauncherBehaviour (2), BeamCannonBehaviour, LaserBehaviour (2) | Native projectile/rocket families, ion/stun bolts and Javelin now implemented; beam/laser families, remaining effects, exact guidance and native replay remain |
| Liquids beyond syringes | LiquidPumpBehaviour, LiquidPressureValveBehaviour, LiquidOutletBehaviour, LiquidDuplicatorBehaviour, FlaskBehaviour (8) | Pressure, valves, duplication, identification, drains/leaks and Bottle transfer now implemented; full particle deposition, advanced chemistry and medical monitor/bypass endpoints remain |
| Attachments | FirearmAttachmentPointBehaviour (30), FlashlightAttachmentBehaviour | Attachment manipulation and actual effects on weapons |
| Destruction | DestroyableBehaviour (14), ShatteredObjectGenerator (24), BreakJointOnShotBehaviour (25) | Native debris, shattering, removal and specialized break triggers |
| Rendering/effects | GlowingHotMetalBehaviour (35), ColorWave (56), BurnableSpriteBehaviour (63) | Native materials, animation, particles and environment lighting |
| Interface/platform | Native menus, contraption files, undo, workshop/mods | Full workflows and compatibility |

Existing ragdoll, physical, firearm, explosive, environmental and wire adapters
also have documented fidelity boundaries. Native runtime comparisons remain
necessary before any subsystem can be called equivalent. Connection tools,
renderer and scene persistence are being integrated with the wire kernel. Native
pin tools, all source materials and solver/timing comparisons remain obligations
even when a browser connection can be placed and saved.
