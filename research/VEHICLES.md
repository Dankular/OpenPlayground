# Vehicle controllers

`src/systems/vehicles.ts` adapts shipped managed control flow to Planck. This is a source-derived baseline, not a claim of native runtime parity.

## Evidence

Assembly-CSharp.dll SHA-256 `83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`, MVID `2457bb93-e7d9-4337-91e2-d226cdef17a0`. Focused REA member inspection selected CarBehaviour, HovercarBehaviour, BoatMotorBehaviour, TankBarrelBehaviour, AutomaticWheelJointCreator and ActOnShot: 6 types, 57 fields, 47 methods; metadata coverage complete, no unmatched types. Parent evidence `ev_09ddd8637428ae571c1909cfb4153c04568fcd87478ee1228633b608d647ebfd`, summary `ev_773e36a2902167db1109a251b845d110a75ea1fa8a36c5032be61dd26b3c8aaa`. Local bundle: `research/evidence/vehicles-rea-bundle.json`. Generated C# remains ignored in `research/local/decompiled`.

| Source method | Build-local token | Adaptation |
| --- | --- | --- |
| CarBehaviour.Awake | 0x06000594 | Descendant wheel discovery, initial parking brake, wheel break force 15000 × strength |
| CarBehaviour.Update | 0x06000599 | Wetness health loss .5/s, source Hermite acceleration at time × .25, charge boost ±50, wheel motor/brake control |
| CarBehaviour.Use / SetHealth | 0x0600059a / 0x0600059d | Channel 1 reverse; activation blocked only below zero health; negative health shuts engine off |
| HovercarBehaviour.Awake / Hover | 0x060001e2 / 0x060001ea | Source local hover-point calibration, masked raycast, normal-weighted support power, per-point velocity retention, support-body reaction and parking forces |
| HovercarBehaviour.FixedUpdate | 0x060001e6 | Drive only while supported, source BaseSpeed + charge, reflection sign |
| BoatMotorBehaviour.FixedUpdate / Use | 0x0600009d / 0x0600009e | Underwater-only normalized local thrust, charge, mirrored x, channel 1 direction reversal |
| TankBarrelBehaviour.Use | 0x06000dfa | Original projectile/muzzle identity callbacks, projectile temperature 300, pulse force 3 / range 10 and local recoil impulse |
| AutomaticWheelJointCreator.Awake | 0x060004d1 | Builds Old Tank's nine runtime suspension joints from exact Wheels references |
| ActOnShot.Shot | 0x0600048b | Damage/cartridge thresholds, probability, serialized target-specific SetHealth action |

## Extracted instances

| Catalogue ID | Object | Controller distinction |
| --- | --- | --- |
| 20138 | Bus | Speed -4000, strength 1, CollideWithChildren true |
| 20141 | Car | Speed -4200, strength 1; Engine shot threshold 20 invokes Car.SetHealth(-1) |
| 20269 | Motorised Wheel | Speed -500, strength 100, waterproof |
| 20275 | Old Tank | Speed -500, strength 15; no serialized wheel joints, runtime creator builds nine at frequency 4 / damping 1; barrel recoil 80 |
| 20341 | Tank | Speed -500, strength 15; nine serialized wheels; barrel recoil 80 |
| 20352 | Truck | Speed -3000, strength 2; root controller resolves referenced PhysicalBehaviour on another body; descendant wheels |
| 20216 | Hovercar | Five source hover transforms; height 1.3, force 300, speed 900, mask 272912 |
| 20128 | Boat Motor | Force 25, local direction (1,0), visual speed 7000 |

All six car instances retain their source acceleration curves and serialized maximum motor torques. Unity wheel speed degrees/sec becomes negative radians/sec for Planck's opposite motor convention. Car child-collider suppression applies only to source transform descendants when CollideWithChildren is false. It does not invent a whole-prefab rule.

## Integration

Attach after bodies/source joints exist. `update(dt)` runs once before each fixed physics step. `get(entity)` returns controller states, including multiple controllers on tanks. Discrete `use(entity, channel, continuous, targetPart)` and `canUse(entity, targetPart)` follow the selected body's transform subtree through the shared source BroadcastMessage targeting helper; continuous input does not toggle controls. `setBrake`, `setHealth`, `repair`, `emp` and `shot` expose source control/damage operations. `shot` changes health only through matching serialized ActOnShot events; arbitrary chassis impacts and heat do not receive invented engine damage. Generic physical temperature/fire/explosive fuel remain separate systems.

Host supplies physical charge/wetness, underwater status, native fixture layer lookup, physical-body recognition and break-force registration. Tank callbacks must instantiate the referenced original projectile (source GameObject 3281), apply its native projectile behavior, present source muzzle assets and apply the pulse; the controller supplies recoil directly. Audio/presentation can use source config IDs, `onActivation`, `onRepair`, fan and volume state. Non-health serialized shot actions are forwarded through `onSourceAction`.

Snapshot/restore stores controller ID, activation, brake, health, speed/reverse and acceleration timer without replaying activation callbacks. Runtime-created wheel IDs derive only from creator component and existing source wheel references; `generatedVehicleJointIds(prefab)` gives the host's import validator that exact whitelist. Source joint removal remains in Simulation, and removed wheels stop receiving motors. Snapshot native joint existence is handled by the host's activeJointIds.

## Validation and boundaries

Twelve focused Vitest cases pass, including all six actual extracted cars, acceleration/charge/reverse/freewheel, wetness versus waterproof health, source engine shot event and EMP, state restore/invalid-state atomicity, five native hover calibrations, source boat submerged thrust and reverse, both native tank projectile callbacks/recoil, subtree activation excluding sibling controllers, exact collision opt-out, Old Tank generated suspensions and 100 finite physics steps. A synthetic physical support fixture checks actual hover lift/drive and layer rejection. TypeScript compilation passes.

The tests compare source configuration and adapted runtime consequences; no synchronized native Unity replay has been performed. Unity's native AddComponent WheelJoint2D default maximum torque is outside the managed artifact; generated Old Tank joints use an explicit configurable 10000 assumption (`generatedWheelMotorTorque`). Generated suspension axis uses Unity's default vertical suspension convention. Startup execution ordering in Unity is not proven; this adaptation deliberately creates joints before Car wheel discovery. Update/FixedUpdate run together at the host fixed clock. Audio mixing, cosmetic fan geometry and non-health UnityEvents require presentation callbacks. Collision scripts outside CarBehaviour (such as NoCollide), source runtime deformation and exact tire simulation remain separate fidelity gaps. Physical-body and layer adapters matter for hover reaction/parking behavior and map support.

