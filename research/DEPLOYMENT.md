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
