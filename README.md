# OpenPlayground

A local browser reconstruction of People Playground using **Three.js + Planck**.
The rewrite is in progress. With local assets extracted, the library contains all
**284 original catalogue prefabs**, original categories and thumbnails. Prefabs
load on demand with their compound colliders, rigidbodies, joints, materials and
child sprites. Without local assets, a small procedural sandbox is available.

Implemented systems include active Human/Android/Gorse ragdolls and poses, a
physiology and injury model, temperature and electricity, combustion, several
machinery controllers, firearm ballistics and timed explosives. Syringes carry
source mixtures, support finite push/pull and infinite-source modes, inject while
their needle is lodged, and apply serum/poison effects through circulation.
Broken nonempty syringes also dose nearby organic limbs. Original gunshot
and material-impact audio loads on demand. Controls include grabbing/throwing,
freeze/delete/rotate, pause/step, slow motion, camera navigation and scene saves.
Connection tools provide electrical, heat, activation, blood, rope, cable, rigid,
fixed, spring, chain and bandage links. Source piston/servo, vehicle controls and
liquid-device controllers are implemented, alongside eleven recovered resource
projectile prefabs and their launcher/impact behaviors.

**This is not yet a complete rewrite or a verified equivalent of the native
game.** The catalogue references 238 distinct script classes; many still need
implementation, and implemented systems have explicit fidelity gaps. See the
research documents and the generated coverage report rather than treating a
spawnable prefab as a fully working game feature.

## Run

Requires Node.js 20.19+ or 22.12+ and npm.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173).
`npm.cmd run build` checks TypeScript and creates `dist/`.
`npm.cmd test` runs the physics and scene-persistence checks.

## Extract the installed game's assets

Requires Python 3.12 on this Windows setup. Extraction reads serialized assets and
managed metadata without launching the game or modifying the installation.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r scripts\requirements.txt
.\.venv\Scripts\python.exe scripts\extract_all_assets.py --game-root "D:\SteamLibrary\steamapps\common\People Playground"
.\.venv\Scripts\python.exe scripts\validate_extraction.py --verify-payload-hashes
python scripts\rewrite_coverage.py
```

Reload after extraction. Generated assets and source hashes are under
`public/local-assets/`; investigation data is under `research/local/`. Both are
ignored by Git. The normal build compiles the application; `npm.cmd run preview`
serves its assets from `public/local-assets/` without making a second copy.
For deployment, serve that directory at `/local-assets/` beside `dist/`.
`npm.cmd run build:standalone` explicitly copies all extracted files into `dist/`
when sufficient disk space is available.

The inspected build contains 36,358 unique serialized objects. Extraction
preserves each object's raw bytes and metadata, and exports all 1,169 sprites,
918 stored textures, 1,135 audio clips, four videos, 14 meshes and two embedded
fonts. Three empty textures and a system font have no stored image/font payload.
Fifteen source maps are extracted separately. One compiled postprocessing shader
still has an unsupported export variant; its raw bytes and parsed metadata are
retained. Raw preservation and successful format conversion are separate from
implementing an asset's runtime behavior or shader in the browser.

The previous 24 catalogue icon failures have been resolved using their original
serialized texture rectangles. HDR textures preserve their original half-float
payload alongside PNG previews. See `all-assets-manifest.json` and
`asset-inventory.json` for conversion status and limits. `--resume` reuses
hash-verified exports when rerunning the full extractor. The smaller
`extract_game_assets.py` command remains available for human-only setup.

## Controls

| Action | Control |
| --- | --- |
| Choose an object | Library card or 1–4 |
| Place object | Left click the chamber |
| Interact tool | V or Escape |
| Create connections | W; choose a type, then click two points or drag |
| Remove connections | X or select a link and Delete |
| Grab/throw | Left drag in Interact mode |
| Pan / zoom | Right or middle drag / wheel |
| Pause / step | Space / . |
| Freeze / delete selection | F / Delete |
| Activate / fire selected object | T; hold for supported automatic firearms |
| Temperature, charge, fire and pose | Selected-object panel |
| Syringe pressure / infinite source | Selected-syringe controls; T cycles push/pull |
| Vehicle engine, parking brake, reverse / servo target | Selected-object controls |
| Rotate selection | Q / E, in 15° increments |
| Reset camera | Home |
| Find an object | / |
| Save / open | Header buttons; OpenPlayground JSON format |

## Reconstruction notes

REA MCP established assembly identity and inspected selected core methods and
fields. Focused ILSpy reconstruction and UnityPy asset parsing supplied additional
evidence. See [research/FINDINGS.md](research/FINDINGS.md) for provenance, evidence
IDs, recovered parameters, approximations and remaining work. Further details:
[ragdolls](research/RAGDOLL.md), [physical systems](research/PHYSICAL.md),
[environment](research/ENVIRONMENT.md), [liquids and syringes](research/LIQUIDS.md).
[connections](research/CONNECTIONS.md), [mechanisms](research/MECHANISMS.md),
[vehicles](research/VEHICLES.md), [liquid devices](research/LIQUID-DEVICES.md),
[projectiles](research/PROJECTILES.md), [explosions](research/EXPLOSIONS.md).
See the [runtime gap inventory](research/FEATURE-GAPS.md) and
[machinery/defibrillator notes](research/MACHINERY.md) for current repair scope.
`scripts/rewrite_coverage.py` writes an explicit incomplete-behavior ledger to
`research/local/rewrite-coverage.json`.

The browser uses an orthographic camera and a 0.02-second fixed physics step.
Planck joints, collision filtering and rendering are adaptations; using original
prefab values does not establish identical Unity behavior. Native contraption and
mod compatibility, most specialized machinery, advanced chemistry/device
interactions and many audiovisual effects remain separate work. Source liquid
transport and the implemented serum/poison effects have their own documented
limits. Browser JSON saves include source build identity,
body/joint identity and implemented system state; legacy browser saves remain
loadable. They are not native game contraption files.

The original installation and generated extraction archive are not committed.
Focused syringe shader/material sources are included under `src/shaders/source`.
The normalized projectile and shrapnel configuration bundles under `src/generated`
make production builds reproducible without uploading the extraction archive.
Recreate them for a changed source build with `scripts/extract_projectile_prefabs.py`
and `scripts/extract_shrapnel.py`, passing `--game-root` and the installed game
directory. Provenance and extraction commands are documented in
[PROJECTILE-ASSETS.md](research/PROJECTILE-ASSETS.md).
