# Coolify deployment

- Application: OpenPlayground (`upxkfqxbhdgcfsv4aatc2sp6`).
- Instance: `https://app.khosa.co`.
- Public URL: `https://upxkfqxbhdgcfsv4aatc2sp6.app.khosa.co`.
- Repository: Dankular/OpenPlayground, branch main.
- Deployed source checkpoint: `889781cbbe151d4addbdf6cfd97715450afde4a1`.
- Build pack: Dockerfile, repository `/Dockerfile`, port 3000.
- Health probe: `http://127.0.0.1:3000/healthz`.
- Persistent asset volume mounted at `/data/assets`.

`server.mjs` serves the built application and extracted assets, including correct
media types and byte ranges. The multi-stage Docker build includes the application
code; original media stays in the separate persistent volume so image rebuilds
do not duplicate it or require game data in Git.

The initial transfer contained 4,905 runtime files totaling 712,447,952 bytes.
Every transfer was verified by SHA-256 before the server atomically accepted it.
These include the catalogue, individual prefabs, maps, sprites, body-shader
resources, decoded textures/audio/video, fonts and mesh exports. Raw investigation
files and serialized binary archives remain local.

An authenticated bootstrap upload route is enabled only when
`ASSET_UPLOAD_TOKEN` is configured. The temporary deployment credential was
removed after the transfer; redeployment removes it from the running container.
No Coolify API key or upload credential is committed. Future asset updates need
a newly configured temporary upload credential, which should be removed again
after verification. The app's persistent data survives redeployments.

REA browser capture `ev_78742641dfe4ff5a76a749f49840b5c8fb8b4e5c3ca0a93cdbf0d5d70011db65`
loaded the HTTPS deployment with the original Default map, catalogue and Human
body shader without captured console or page errors. This verifies deployment
of the current rewrite; it does not establish complete native game parity.

Follow-up interaction capture:
`ev_a754ad33d2894a6f7b66107e01e5756a206835a51fe274d1653e12c562599014`.
The remote app paused, cleared the chamber, searched for Human, spawned the original
14-body prefab and applied an injury. All actions completed without captured
page or console errors. The post-upload credential-removal deployment finished
successfully as `2loqb17sjgpcwq0b8mkzipb6`.

## Medical and machinery repair deployment

Source commit `770b2c0ca81461de7bab69e4146419dd703bc071` deployed successfully as
`julnzkdcrdww3ac0pevjcitu` on 2026-10-26. Coolify reports `running:healthy`;
the public HTTPS `/healthz` returns `status: ok, assets: true`. The persistent
asset volume was reused; the recovered syringe shader/material are embedded
in the application bundle and require no additional asset upload credential.

The production build and all 139 tests pass. The combined simulation test drives
an extracted Life syringe into an extracted Human head, lodges the needle,
transfers serum and revives the injured head.

Local browser capture:
`ev_926205bf7120c3ffb1b0c3b4ed231fb5c4bc1fdd0d8d683d81ab09e6956ec9db`.
Public HTTPS capture:
`ev_87acd2fe9e4121a2785dd5b323ce78b86c26fb1d72f57dd53eba9ff54cdfb373`.
The public scenario paused, cleared, searched for Life syringe, spawned it,
disabled infinite supply and activated extraction. Every declared action completed
with no captured console/page errors. This verifies the deployed controls and
native-shader adaptation; it does not establish full native-game equivalence.
