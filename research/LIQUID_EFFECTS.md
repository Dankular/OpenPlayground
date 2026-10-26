# Syringe and liquid physiology

`src/systems/liquid-effects.ts` implements the source liquid lifecycle against
live ragdoll state and the shared mixed-liquid reservoirs. This addresses the
previous gap where a syringe could exist and transfer fluid without producing
the original physiological effect.

## Source boundary

Source: the supplied `Assembly-CSharp.dll`, SHA-256
`83597029aadc84f24324858afb64997a6b29e0e402fea206eaa38101bd6bc395`.
REA member evidence
`ev_1a6cb89d2d4f032dfa26db8e60b04658fc0dfdfe0034264ca894a7abacc0b493`
covers nineteen exact source types, 117 methods and nineteen fields:
TemporaryBodyLiquid; LifeSerumLiquid; AdrenalineLiquid; InstantDeathPoisonLiquid;
KnockoutPoisonLiquid; PainKillerLiquid; MendingSerum; FreezePoisonLiquid;
CoagulationLiquid; UltraStrengthSerumLiquid; WaterBreathingSerum; ZombiePoisonLiquid;
BoneHurtingJuiceLiquid; GorseBlood; Blood; Oil; Coolant; Tritium; BeverageM04.
The observation is static CIL, not execution. Existing focused ILSpy reconstructions
of these and PinkSyringe/Chemistry/BloodContainer supplied readable control flow.

## Important source distinctions

- `BloodContainer.Update` calls liquid `OnUpdate` only after its timer exceeds one
  second, then resets that timer to zero. Entry effects and update effects differ.
  Instant death poison has a no-op entry, then kills its affected limb on update,
  including Android tissue. Knockout, joint-lock, coagulation and bone poison also
  use their update callbacks rather than an invented immediate generic response.
- `TemporaryBodyLiquid.OnUpdate` removes its entire amount with probability
  `RemovalChancePerSecond²`, then normally calls OnEnterLimb again even when the
  removal happened. The default probability is 0.64 per update, while mending's
  override yields 0.4096. This is not modeled as per-frame exponential decay.
- Adrenaline and painkiller override OnUpdate and call their helper again after
  the base update, so a retained dose causes two helper calls on that tick. The
  implementation preserves that observed behavior.
- Circulation allows overflow despite its nominal one-unit capacity. Syringes
  have a bounded 1.4-unit reservoir. Injecting serum does not replace native blood
  with a generic health bar or silently cap mixed circulation at one unit.

## Implemented effects

Life serum revives organic brain tissue, repairs bones, restores health and native
blood flow, stops internal/external bleeding, and starts the source burn/acid/rot/
wound healing routines. It does not heal Androids, reattach severed limbs, or
clear unrelated permanent joint-lock state. Mending differs: it repairs health
and bones, reduces bleeding/rot, and only has a small brain-damage recovery chance;
it does not supply life's guaranteed blood refill.

Adrenaline, painkiller (including overdose), knockout, joint-lock, coagulation,
bone-eating poison, ultra strength, water breathing and reanimation use their
source species gates, amount multipliers and state changes. Ultra strength and
the pink mutation serums modify an instance's biological parameters rather than
the shared prefab. Ragdoll snapshots preserve increased initial health, strength,
shot-damage/regen modifiers, zombie state and other modified source fields.

Acid and Gorse blood run 0.03-second corrosion steps, with slower Android corrosion
and Gorse resistance. Oil, blood, coolant, tritium and Beverage M04 preserve their
distinct species responses. Pink serum variants with direct physiological effects
retain their source operations. Integer Random.Range calls remain integer ranges;
for example Random.Range(-1, 1) produces -1 or 0, not a continuous symmetric sample.

The external reservoir owns composition, diffusion and dosing. Ragdoll scalar
transport is disabled when that adapter is attached, avoiding double diffusion.
Native blood amount remains synchronized for muscle strength and circulation.
`resume(part,id,container)` reconstructs ongoing life/acid routines after a restored
mixture is installed without replaying immediate entry effects or permanently
strengthening an already strengthened limb again. `remove(entity)` releases the
routine references when an experiment is cleared.

## Verification and limits

Sixteen focused liquid-effect tests cover organic revival and gradual wound
healing; Android life immunity; delayed death; temporary removal and mending's
different removal chance; double helper callbacks; knockout/joint-lock/bone/
coagulation timing; mending versus life; zombie and water-breathing behavior;
per-instance ultra-strength changes and saved modifiers; species-specific acid;
coroutine-only resume; permanent pink entry behavior; explicit unsupported mass
behavior; and removed-entity cleanup. Seventeen existing ragdoll tests also pass,
and TypeScript checks pass. These establish the tested browser behaviors rather
than native runtime equivalence.

Remaining gaps include native coroutine/update scheduling and random-sequence
equivalence; exact resumed sub-frame coroutine phase; native nonpositive mass-setter
behavior for the mass agent; full fragmentation and visual glow/resize/laser-flag
bridges for optional pink effects; exotic flash timing; and the broader chemistry
mixing registry. Missing optional bridges are recorded in `LiquidEffects.unsupported`
rather than falsely treated as implemented. Contact/needle mechanics, syringe
pressure controls, fluid displays and transport have separate implementations and
verification; this module alone does not establish their fidelity.
