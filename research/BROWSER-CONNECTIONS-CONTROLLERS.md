# Connection and controller browser verification

Verified 2026-10-26 against the local Vite application, using the extracted game
assets. This is reconstruction evidence, not a paired replay of the Unity game.

The installed REA scenario click schema has locator targets but no pointer
coordinates. An owned Chrome instance was driven with Playwright for actual
canvas pointer gestures. REA then passively observed the resulting page through
that instance's loopback CDP endpoint. No application debugging API was added.

`research/local/verify-connections.mjs` exercised:

- Two-click energy wire between two source Metal Cubes.
- One fixed step transferring charge: saved object charges were 95 and 84.55,
  starting from 100 and 0.
- Scene download and import with the global connection restored to new bodies.
- Drag creation of a breakable blue activation wire, channel retention,
  direction reversal and deletion.
- A body-to-world rope, visible endpoints, and all 13 connection tool entries.

The browser recorded no page or console errors. The screenshot exposed an opaque
wire being drawn before transparent map sprites; wire meshes now participate in
the transparent queue with depth writing disabled. The repeated gesture run
confirmed visible links. REA screenshot evidence:
`ev_d9c452b8df73a686ae882e13675e6d6c28df490851d76bfbb5a0af0d3dd8d09b`.

`research/local/verify-controllers.mjs` spawned source Servo, Piston, Car,
Liquid Valve, Liquid Duplicator, Liquidentifier and Rocket Launcher objects.
It changed servo angle/speed, toggled and reversed the engine, opened the valve,
started a duplicator flush and scanner, and fired a rocket launcher. Firing
created a second native resource entity. The scanner remained in its source
initialisation phase during the short paused test; scan completion was not
asserted. No page or console errors occurred.

REA controller DOM evidence:
`ev_4735ef43e533f3f25676b5fa5558e2c4d239dfdfe7121bf09702b2b9f4a7a238`.
REA controller screenshot:
`ev_a2341f65f25c797c8e909e800e8310c5fdf24c18424ea202b9b2d965f4bf3443`.
REA attaches after the gestures, so its console window does not cover startup;
the Playwright listeners recorded startup and interaction errors separately.
The screenshot also shows a large projectile flare; complete source particle
and additive-material rendering requires its own verification.

The ignored reproducibility artifacts are `connections-browser-report.json`,
`controller-browser-report.json`, both verification scripts and screenshots,
the downloaded scene, and `rea-connections-controllers-evidence.json`, all under
`research/local/`. The REA bundle contains 10 records. Both owned browser
instances were closed through their browser CDP sessions after capture.

Production build and all 228 tests passed after integration. New transaction
tests cover connection import rollback and world anchors. A frozen object test
checks custom mass, inertia, center of mass and saved motion after save/load and
unfreezing. Wire color, glow and pulse markers remain presentation adaptations;
the actual original animated wire materials have not been reproduced.

The subsequent particle integration build passed all 242 tests. The controller
browser sequence was repeated without errors, and an Ion Cannon shot created
the native second entity with visible recovered particle emission. This exposed
a missing catalogue renderer-to-material binding for source glow renderer17748;
expanding the original material bindings removed its opaque black square.
`ion-browser-report.json` and `ion-browser.png` record that separate check.
Applying the additive light material across the map makes its overlapping
large light sprites very bright; final HDR/linear-light composition and native
postprocessing still require paired visual validation. The snapshot is not
evidence of native image parity.

The Javelin's initially collapsed fins now unfold through their recovered local
Transform positions and scale curve. The source SpriteRenderer size and exported
19×4 sprite establish its unscaled dimensions. A regression checks its height
and offsets, and confirms another instance and cached prefab remain unchanged.
