# Native projectile resources

`scripts/extract_projectile_prefabs.py` extracts the original projectile
GameObjects referenced by catalogue `TankBarrelBehaviour`,
`RocketLauncherBehaviour` and `ProjectileLauncherBehaviour`. It also resolves
`projectileAsset` through its `SpawnableAsset.Prefab` pointer. Extraction reads
the installed game and reuses `AllExtractor.prefab`, the same normalizer as the
catalogue. This is UnityPy static asset evidence, not REA execution evidence.

Run from the workspace:

```powershell
.\.venv\Scripts\python.exe scripts/extract_projectile_prefabs.py --game-root 'D:\SteamLibrary\steamapps\common\People Playground'
```

Existing `asset-inventory.json` and sprite exports are required. Sprite metadata
is reused with SHA-256 verification; no texture/audio/video inventory is
regenerated. Outputs are rejected inside the source installation.

The tracked `src/generated/projectiles.json` contains `prefabs` keyed by
`resource:<file>:<GameObject path ID>`. Its definitions have the existing
`SourcePrefab` shape and can be inserted into `PrefabLibrary.prefabs`, without
adding catalogue palette entries. `launchers` maps each original catalogue,
component, node and pointer field to its exact `projectileKey`; prefix that key
with `resource:` for the runtime prefab ID. `byId` contains individual local
URLs, hashes, counts and unsupported flags. Source serialized-file and assembly
hashes are included. Ignored `public/local-assets/projectiles.json` contains the
same bundle, with individual JSON under `public/local-assets/projectiles/`.

All eleven resources and thirteen launcher references resolve without extraction
errors in the installed build:

| sharedassets0.assets GameObject | Name | Original rigidbodies | Sprite renderers |
| --- | --- | --- | --- |
| 3084 | LaunchedRocket | 0 | 2 |
| 3281 | TankShell | 1 | 1 |
| 3440 | Bolt | 1 | 1 |
| 3574 | Stunbolt | 0 | 1 |
| 4415 | Loose spike | 1 | 1 |
| 4841 | Launched Explosive | 1 | 1 |
| 5317 | Launched missile | 1 | 4 |
| 5701 | Launched bazooka round | 0 | 2 |
| 5720 | ion bolt | 0 | 0 |
| 5936 | Crystal | 1 | 1 |
| 6024 | Kogel | 1 | 1 |

TankShell is `sharedassets0.assets:3281`. Its source body is `11194`, capsule
`14336`, sprite renderer `16691`, and `ProjectileBehaviour` `20967` supplies
local direction (1,0) and force 350. `DeleteAfterTime` supplies life 10 seconds.
Its `ExplosiveBehaviour` retains range 27, impact threshold 50, fragmentation
count 32, and the remaining original explosive configuration. Geometry, mass,
damping, gravity, raw components, physical properties, renderer references and
resolved material metadata are retained in the normalized prefab.

Zero-body resources remain zero-body in the source bundle. Their native
controllers use transform/raycast movement; extraction does not fabricate a
rigidbody or collider. Their runtime adapter must provide that movement and any
renderer anchor it requires. Likewise, TrailRenderer, particle, shader and
MonoBehaviour data preservation does not claim those effects are implemented.

The extractor fails on missing sprites, hash mismatches, undecoded components,
missing roots, duplicate body IDs and renderer/body-reference inconsistencies.
Extraction diagnostics remain explicit. A successful run validated all source
prefabs and launcher targets without re-exporting media.

## Global ballistic shrapnel

`scripts/extract_shrapnel.py` independently resolves the installed singleton
`GlobalShrapnelEmitter` into tracked `src/generated/shrapnel.json`. It performs
no media export. The source is `level1:2133`; its cartridge pointer has file ID
2 and path ID 20038, resolved through UnityPy's external-file mapping to
`sharedassets0.assets:20038`, named `5.56x45mm`. The actual fields are damage 15,
recoil .5, impact force approximately .2, start speed 10 and penetration random
angle multiplier approximately .1. Hit layers are 10752 and water layer is 16.
The generated bundle includes all original fields and source/assembly hashes.

The recovered `GlobalShrapnelEmitter.Awake` configures traversal true, traversal
tracers false, maximum ballistic iterations 16, ricochet multiplier 4 and total
distance 30. `EmitRoutine` waits for end-of-frame and then a fixed update before
emitting the requested count with `Random.insideUnitCircle` directions. These
managed rules belong in the runtime adapter; the extractor does not synthesize
or execute ballistic behavior.
