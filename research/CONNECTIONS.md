# Connections and activation transport

Source assembly SHA-256:
`83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`.
REA member evidence
`ev_58ff41cf9252aab2dcd2fa1841eb7625d6af1067378bb973159ce5553019ab90`
covers selected wire classes and DistanceWireTool. Focused recovered C# supplies
the pressure, energy, sag, breakage and activation control flow. This is static
evidence, not a synchronized native runtime comparison.

`src/systems/wires.ts` implements body-local/world anchors, live tether joints,
source-shaped sag, electrical resistance transfer, heat exchange, directional
three-channel legacy activation, queued propagation and cycle limits, combustion
and mass-dependent break thresholds, deletion and staged scene restoration.
World-anchor helper bodies are removed when no connections need them. Rigid
connections use exact-distance joints, fixed cables preserve relative pose with
welds, springs use the source 2/8 Hz strengths, and chains retain slack tethers.
Bandages use 3 Hz and 0.2 damping, reduce bleeding by 0.9 per fixed tick, heal
toward initial health by 0.001, add the original entry adrenaline and preserve
their soaking state. Android tissue receives no organic bandage effect.

Runtime-added SpringJoint2D's ordinary damping default is not established by the
managed source; the adapter currently uses zero outside bandages. Unity's
[damping API](https://docs.unity.com/en-us/engine/6000.5/script-reference/unityengine/springjoint2d/dampingratio)
describes its effect but does not establish that native creation default for the
installed game build. That value and solver equivalence still need native replay.

Blood wires transfer a mixed dose of `2 * fixedDeltaTime` from higher to lower
measured pressure, then average pressure by the fixed timestep. Transfer is
blocked if either reservoir's AllowsTransfer is false. Organic circulation
endpoints also average their BloodFlow by the fixed timestep. Actual blood is
synchronized to limb state after external transfer so the next physiology/liquid
synchronization cannot undo it. Flow and liquid color track source interpolation
and decay. A pump transmits pressure without transporting liquid through itself.

Activation follows `UseWireBehaviour` and `ActivationPropagation`: direct input
uses each outgoing wire's channel, relays retain it, source delay and propagation
opt-out are honored, and transform-root cycle protection remains. Dispatch targets
the connected rigidbody and its descendants rather than every component in the
prefab. `ContinuousActivationBehaviour` uses a 40 Hz distributor capped at four
cycles per render frame. Ordinary IUse controllers must not toggle repeatedly on
continuous events. The physics adapter still quantizes delayed delivery to its
fixed-step clock.

`NewUseWireBehaviour` is distinct from the legacy implementation. Its referenced
`Activations.NodeBehaviour.Use` and serialization methods have empty bodies in
this build. The reconstruction does not infer a functional replacement node
network from that unfinished API.

Tests verify live tethers, energy/heat exchange, delayed/channelled/cycle-safe
activation, body targeting, deletion and rollback, world-body cleanup, pressure
transport without pump liquid flow, mixture flow, and real extracted Human
circulation retaining externally transferred blood. Interface and renderer
verification are recorded with deployment evidence once integrated.

Remaining obligations include paired Unity solver/timing comparisons, original
wire materials/glow/audio, native pin/wood-pin tools and exact spring defaults,
heart monitor/bypass medical endpoint behavior, and native contraption format.
