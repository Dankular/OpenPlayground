"""Inventory reconstruction obligations without treating a present adapter as parity."""
from __future__ import annotations
import argparse
from collections import Counter
import json
from pathlib import Path

BOUNDARIES = {
    "PhysicalBehaviour": ("src/systems/physical.ts", "thermal/charge/contact subset"),
    "PersonBehaviour": ("src/systems/ragdoll.ts", "poses/standing/scalar physiology subset"),
    "LimbBehaviour": ("src/systems/ragdoll.ts", "motor/damage/temperature/bone subset"),
    "CirculationBehaviour": ("src/systems/liquids.ts", "mixed-liquid transport linked to ragdoll circulation; native parity unverified"),
    "ConnectedNodeBehaviour": ("src/systems/ragdoll.ts", "limb connectivity subset"),
    "SkinMaterialHandler": ("src/systems/skin.ts", "wound state/native body shader adaptation; native pixel parity unverified"),
    "DamagableMachineryBehaviour": ("src/systems/machinery.ts", "health/thermal/water/failure gates/repair; destruction presentation and UnityEvents incomplete"),
    "DefibrillatorBehaviour": ("src/systems/defibrillator.ts", "timed pad-local circulation shock; native runtime comparison unverified"),
    "GeneratorBehaviour": ("src/systems/devices.ts", "charge/warmup/heat/vibration"),
    "HeatingElementBehaviour": ("src/systems/devices.ts", "temperature controller"),
    "HoverboxBehaviour": ("src/systems/devices.ts", "gravity cancellation/damping"),
    "RotorBehaviour": ("src/systems/devices.ts", "hinge motor activation/charge"),
    "IonThrusterBehaviour": ("src/systems/devices.ts", "thrust activation/charge"),
    "FirearmBehaviour": ("src/systems/weapons.ts", "firing/ballistics/recoil/heat; presentation partial"),
    "ExplosiveBehaviour": ("src/systems/weapons.ts", "fuse/triggers/fragmentation; presentation partial"),
}
for syringe_class in (
    "AcidSyringe", "AdrenalineSyringe", "BoneEatingPoisonSyringe", "CoagulationSyringe",
    "DeathSyringe", "EmptySyringe", "FreezeSyringe", "KnockoutSyringe", "LifeSyringe",
    "MendingSyringe", "PainKillerSyringe", "PinkSyringe", "UltraStrengthSyringe",
    "WaterBreathingSyringe", "ZombieSyringe",
):
    BOUNDARIES[syringe_class] = ("src/systems/liquids.ts", "source reservoirs/pressure/lodging/liquid effects; presentation and native equivalence incomplete")
for container_class in ("FlaskBehaviour", "LiquidCanisterBehaviour", "BloodTankBehaviour"):
    BOUNDARIES[container_class] = ("src/systems/liquids.ts", "reservoir/source state; full controller/network presentation incomplete")
BOUNDARIES["LiquidPumpBehaviour"] = ("src/systems/liquids.ts", "pressure-only pump/modes/vibration/snapshot; native display/audio comparison incomplete")
for liquid_device_class in ("ValveBehaviour", "LiquidPressureValveBehaviour", "LiquidDuplicatorBehaviour", "LiquidOutletBehaviour", "LiquidentifierBehaviour", "LiquidFilterBehaviour", "LiquidContainerLeakingBehaviour", "LiquidContainerHoleBehaviour", "PointLiquidTransferBehaviour"):
    BOUNDARIES[liquid_device_class] = ("src/systems/liquid-devices.ts", "source liquid controller/pressure/drain/transfer state; particle deposition and native presentation incomplete")
for mechanism_class in ("PistonBehaviour", "MotorisedHingeBehaviour", "GearBehaviour"):
    BOUNDARIES[mechanism_class] = ("src/systems/mechanisms.ts", "source piston/servo rules and native obsolete gear no-op; solver/presentation equivalence unverified")
for vehicle_class in ("CarBehaviour", "HovercarBehaviour", "BoatMotorBehaviour", "TankBarrelBehaviour", "AutomaticWheelJointCreator"):
    BOUNDARIES[vehicle_class] = ("src/systems/vehicles.ts", "source controllers/generated wheels; native projectile/presentation/solver gaps remain")
for projectile_class in ("ProjectileLauncherBehaviour", "RocketLauncherBehaviour", "ProjectileBehaviour", "LaunchedRocketBehaviour", "MachineGunProjectileBehaviour", "StunnerBehaviour", "IonBoltBehaviour", "JavelinMissileBehaviour", "DeleteAfterTime", "PointToVelocityBehaviour"):
    BOUNDARIES[projectile_class] = ("src/systems/projectiles.ts", "native resource launch/movement/impact/lifetime controllers; source FX, ownership and native replay boundaries documented")

def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, default=root / "public/local-assets")
    parser.add_argument("--output", type=Path, default=root / "research/local/rewrite-coverage.json")
    args = parser.parse_args()
    prefabs = json.loads((args.assets / "prefabs.json").read_text(encoding="utf-8"))["prefabs"]
    scripts, native, owners = Counter(), Counter(), {}
    items = []
    for prefab in prefabs:
        classes = set()
        for node in prefab["nodes"]:
            for component in node["components"]:
                name = component.get("className") or component["type"]
                if component["type"] == "MonoBehaviour":
                    scripts[name] += 1
                    owners.setdefault(name, set()).add(prefab["catalogId"])
                    classes.add(name)
                else:
                    native[component["type"]] += 1
        missing = sorted(classes - BOUNDARIES.keys())
        items.append({"id": prefab["catalogId"], "name": prefab["name"],
                      "scriptClasses": sorted(classes), "unassignedScriptClasses": missing,
                      "status": "incomplete", "nativeParityVerified": False})
    rows = [{"class": name, "instances": count, "catalogIds": sorted(owners[name]),
             "implementation": BOUNDARIES.get(name, (None, None))[0],
             "boundary": BOUNDARIES.get(name, (None, None))[1],
             "status": "partial-unverified" if name in BOUNDARIES else "unassigned",
             "nativeParityVerified": False} for name, count in sorted(scripts.items())]
    result = {"schemaVersion": 1, "objective": "complete rewrite with all assets",
              "status": "incomplete", "completionProven": False,
              "scope": "catalogue prefabs only; menus, maps, resources, native integrations and other code remain separate obligations",
              "catalogueItems": len(items), "scriptClasses": len(rows),
              "partialScriptClasses": sum(name in BOUNDARIES for name in scripts),
              "nativeComponents": dict(sorted(native.items())), "scripts": rows, "items": items,
              "verification": {"structuralPrefabSweep": "tests/prefabs.test.ts; instantiation/stability is not behavior parity",
                               "nativeBehaviorComparison": "not yet performed"}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("status", "catalogueItems", "scriptClasses", "partialScriptClasses")}, indent=2))

if __name__ == "__main__":
    main()
