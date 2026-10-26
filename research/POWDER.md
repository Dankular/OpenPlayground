# Powder grid: chemistry, particles and elements from The Powder Toy

`src/powder/` adds a cellular particle simulation ported from **The Powder Toy** (TPT,
https://github.com/The-Powder-Toy/The-Powder-Toy). It runs beside the Planck rigid-body world: particles live on a
612 x 384 pixel grid (153 x 96 air cells), bodies and particles interact through the rules in
[Coupling with rigid bodies](#coupling-with-rigid-bodies).

## Provenance and licence

* Source read: the upstream checkout recorded in `src/generated/powder-elements.json` (`commit`). Everything below
  marked *ported* was translated by reading the C++ in `src/simulation/` (`Simulation.cpp`, `Air.cpp`,
  `SimulationData.cpp`, `elements/*.cpp`). Nothing was run: no TPT binary was built, so there is **no differential test
  against the original game**.
* TPT is **GPL-3.0**. The ported files are derivative works; see `src/powder/NOTICE.md`. The rest of this repository
  declared no licence when the module was added. **Open question for the maintainer**: distributing a build that contains
  `src/powder/` obliges the combined work to GPL-3.0 terms, or the module has to be removed or reimplemented from
  behavioural descriptions instead of from the code.
* `scripts/extract_powder_toy.py <checkout>` regenerates `src/generated/powder-elements.json`: element ids (from the
  order of `simulation_elem_names` in `elements/meson.build`), colours, movement/air/heat/transition properties and
  default particle properties. Expressions are evaluated with a restricted arithmetic evaluator; the script aborts on
  anything it cannot evaluate. It does not record which elements need special transition code beyond the upstream `ST`
  marker.

## Engine: what is ported

Confirmed by reading the cited upstream functions:

| Area | Upstream | Here |
| --- | --- | --- |
| Particle store, free list, `pmap`/`photons` maps, stacking check (`CheckStacking`) | `Simulation.cpp` | `PowderSim` |
| `can_move` table, `eval_move`, `try_move` (swap, share, eat cases: VOID/PVOD, BHOL/NBHL, WHOL, DEUT, VIBR, NEUT, CNCT, GBMB, EHOLE) | `SimulationData.cpp`, `Simulation.cpp` | `buildCanMove`, `evalMove`, `tryMove` |
| Movement planning along velocity, liquid/powder spreading, gas bounce, gravity modes | `PlanMove`, `MovementPhase` | `planMove`, `movementPhase` |
| Heat conduction (8-neighbour equilibrium, convection swap for liquids, ambient air exchange) | `TransitionPhase` | `transitionPhase` |
| Temperature and pressure transitions incl. special cases (ICEI/SNOW, SLTW, BRMT, CRMC, RIME, WTRV, LAVA) | `TransitionPhase` | `transitionPhase` |
| Pressure/velocity/ambient-heat solver, vorticity confinement, Boussinesq convection, fans, air modes | `Air.cpp` | `updateAir`, `updateAirH` |
| Photon refraction/reflection (`get_normal`, wavelength bins) | `Simulation.cpp` | `getNormal*`, `wavelengthBin` |
| Wall types, E-wall/detector spark map (`set_emap`) | `Simulation.cpp` | `bmap`, `emap`, `setEmap` |
| `create_part`, `kill_part`, `part_change_type`, `flood_prop`, `CreateLine`, SPRK creation rules | `Simulation.cpp` | same names in camelCase |
| Frame order: air, ambient heat, gravity mask and Newtonian force update, `RecalcFreeParticles`, wall/air block maps, stacking check, LOVE/LOLZ growth, WIRE, PPIP tmp shift, Game of Life, wireless channels, stickman respawn, particle update, EMP burst | `BeforeSim`, `UpdateParticles`, `AfterSim` | `step`, `beforeSim` |
| Newtonian gravity: mass map convolved with a 1/r² kernel by FFT, gravity mask flooded from the border across non-gravity walls | `gravity/Fft.cpp`, `UpdateGravityMask` | `NewtonianGravity` (own radix-2 FFT, see deviations) |
| Portals (`portalp` records, orbit animation, `try_move` entry) | `PRTI.cpp`, `PRTO.cpp`, `Simulation.cpp` | `portals.ts`, `tryMove` |
| Particle pipes and PPIP triggers, STOR transfer | `PIPE.cpp`, `PPIP.cpp` | `pipes.ts` |
| Game of Life rule engine (all 24 built-in rulesets, multi-state rules, wraparound) | `SimulateGoL`, `SimulationData.cpp`, `LIFE.cpp` | `gol.ts` |
| LOVE / LOLZ pattern growth | `BeforeSim`, `LOVE.cpp`, `LOLZ.cpp` | `growLoveLolz` |
| Stickmen and fighters (legs, controls, element use, deaths, portals, respawn) | `STKM.cpp`, `STKM2.cpp`, `FIGH.cpp`, `SPAWN*.cpp` | `stickman.ts` |
| Pistons and frames | `PSTN.cpp` | `pistons.ts` |
| EMP burst | `EMP.cpp`, `Probability.cpp` | `emp.ts` |

Known deviations and gaps (each is a real difference, not a rounding detail):

* **Random numbers**: mulberry32 instead of the original xoroshiro128+, so the same seed does not reproduce the same
  run. Distributions (`between`, `chance`) follow the originals.
* **Floating point**: particle fields are `Float32Array`, arithmetic is JS double precision between stores; results can
  differ from the C++ float math in the last bits.
* **Newtonian gravity** uses its own radix-2 FFT with zero padding to the next power of two instead of FFTW, runs on the
  calling thread (so forces are not one frame late as on the upstream worker thread), and recomputes only when the mass map
  or gravity mask changed. The `-M_GRAV/(NCELL*4)` kernel scale in the original compensates for FFTW's unnormalised inverse;
  here the inverse is normalised so the kernel scale is `-M_GRAV` (checked against the force of a single point mass in
  `tests/powder-engine.test.ts`, not against FFTW output). It is **off by default**, as upstream; the panel has a toggle.
* **Stickmen**: leg state is `Float32Array`, intermediate maths is double precision. Keyboard control: arrow keys drive STKM,
  W/A/S/D drive STKM2 while the powder grid runs and that stickman exists. Not ported: the hover HP readout, search-highlight
  colouring, the save-file stickman flags.
* **Not ported**: signs, edge modes other than *void* (`EDGE_LOOP`/`EDGE_SOLID`; the stickman edge-loop leg correction goes
  with it), `flood_water` water equalisation, the legacy (non-heat) mode paths, decoration colours (`dcolour`; so BIZR/BIZRG/
  BIZRS only render, they do not tint neighbours, and CRAY/DRAY/PIPE do not carry decoration), custom Game of Life rules'
  colour registry, the property tool, save-file (`.cps`/`.stm`) loading, Lua.
* **Ambient heat** (`aheat_enable`) is on here (off by default upstream) because bodies exchange heat with it.
* `isHeatInsulator` uses `PFLAG_CAN_CONDUCT = 1` for PIPE/PPIP (verified in `PIPE.h`).

## Elements: what is ported

Behaviours live in `src/powder/behaviors/*.ts`, registered in `behaviors/index.ts`. Each function is a statement-by-
statement translation of the upstream `update` (and `create`) function; omissions are listed below and in
`PARTIAL_PORTS`. Elements without an update function upstream need no code: their behaviour is the static table.

The table below is generated by `tests/powder-coverage.test.ts` (run with `UPDATE_POWDER_DOC=1` to rewrite it) and the
test fails if it drifts from the code.

<!-- coverage:start -->
Upstream commit `c205becb1cf7ef1915293e2c99b2c7901d2887cd` (GPL-3.0).

* 194 enabled elements in the generated table.
* 51 have no update function upstream: their full behaviour is the static table plus the engine (movement, state changes, flammability, heat, pressure).
* 140 update functions are ported (4 with a documented omission).
* 3 elements are not functional beyond their static properties.

| Menu group | Static only | Ported | Ported with omissions | Not ported |
| --- | --- | --- | --- | --- |
| Electronics | METL PSCN NSCN INSL ETRD INWR TESC INST BRAY EMP | SPRK NTCT PTCT BTRY SWCH ARAY WIRE CRAY TUNG DRAY | WIFI | – |
| Powered | – | LCRY PCLN DLAY STOR PVOD PUMP PBCN GPMP PPIP | HSWC | – |
| Sensors | – | INVIS DTEC TSNS PSNS LSNS LDTC VSNS | – | – |
| Force | FRME | PIPE ACEL DCEL GBMB FRAY RPEL DMG PSTN | – | – |
| Explosives | GUNP NITR PLEX RBDM LRBD THRM CFLM | FIRE THDR FUSE FSEP LIGH DEST BOMB C5 BANG IGNT EMBR LITH | FIRW FWRK | – |
| Gases | GAS SMKE | WTRV PLSM NBLE O2 CO2 CAUS FOG BOYL H2 VRSG RFRG | – | BIZRG |
| Liquids | OIL MWAX LNTG DESL LO2 PSTE | WATR LAVA ACID DSTW SLTW GLOW CBNW FRZW GEL SOAP MERC VIRS RFGL RSST BASE | – | BIZR |
| Powders | DUST STNE CNCT SALT SAND BGLA DYST SAWD | SNOW BRMT YEST BCOL FRZZ GRAV ANAR PQRT BREC CLST SLCN SEED | – | – |
| Solids | WAX NICE BRCK DRIC PSTS SPAWN2 SPAWN FILT ROCK | GOO ICEI WOOD PLNT BMTL GLAS COAL IRON SPNG RIME VINE SHLD1 SHLD2 SHLD3 SHLD4 QRTZ TTAN GOLD VRSS CRMC HEAC PTNM RSSS | – | BIZRS |
| Radioactive | – | NEUT PLUT PHOT URAN AMTR DEUT WARP ISOZ ISZS SING ELEC EXOT VIBR BVBR PROT GRVT POLO | – | – |
| Special | VOID DMND BHOL WHOL LOVE E116 LOLZ | CLNE STKM MORT CONV BCLN PRTI PRTO STKM2 TRON NBHL NWHL FIGH | – | – |
| Life | LIFE | – | – | – |

Omissions in ported elements:

* `LIFE`: custom rulesets (ctype >= 24) have no colour registry, so they render white; the rule engine itself is ported
* `HSWC`: FILT temperature deserialisation omitted
* `FIRW`: burst colour is random RGB instead of Renderer::firwTable
* `FWRK`: burst colour is random RGB (as in the original)
* `WIFI`: channel flags are cleared every frame (equivalent to the original ISWIRE countdown)

Not ported, with reason where known:

* `BIZR`: update only blends decoration colour (not tracked)
* `BIZRG`: update only blends decoration colour (not tracked)
* `BIZRS`: update only blends decoration colour (not tracked)
<!-- coverage:end -->

## Coupling with rigid bodies

Pure OpenPlayground design (`src/powder/world.ts`); TPT has no rigid bodies, so none of this is derived from it.

* **Placement and scale**: one pixel is 0.04 m (the grid is 24.5 x 15.4 m). The lower-left corner is placed so the grid's
  floor border sits just under the ground plane. "Move grid to view" recentres it.
* **Solids**: fixtures overlapping the grid are rasterised into a per-pixel mask; non-energy particles cannot enter masked
  pixels. Static bodies are cached and rebuilt only when static fixtures appear, move or vanish; dynamic bodies are rebuilt
  every physics step. Energy particles (photons, neutrons, electrons...) pass through bodies.
* **Heat**: particles orthogonally adjacent to a body exchange heat with its `PhysicalObject` (scaled by the element's
  `HeatConduct / 250`); the body also relaxes toward the ambient-air cell it occupies. Units: grid kelvin, body degrees
  Celsius.
* **Ignition**: contact with FIRE/PLSM/LAVA/CFLM/EMBR, or any particle hotter than the body's burning threshold, calls
  the existing `ignite`. Burning bodies emit FIRE/SMKE particles into free neighbouring pixels.
* **Wetness**: contact with WATR/DSTW/SLTW/CBNW/FRZW/ICEI raises `wetness`, which the existing frame update uses to put
  fires out.
* **Pressure**: the grid pressure gradient at a body's centre applies a force (`PRESSURE_FORCE` = 40 N per pressure unit
  per cell per m², capped at 40 x weight). Explosions in the rigid-body world inject a pressure pulse. The factor is a
  tuning choice, not a measured equivalent.
* **Air drag**: moving bodies pull the air in their cell toward their velocity by 2 % per step.
* **Not coupled**: acid/caustic damage to people, particles pushing bodies by impact, body deformation, radiation
  doses, electricity between grid conductors and body `charge`.

Scene files gain a `powder` system entry (particles as numeric rows, walls). Loading validates every row and
rejects the whole payload on error. Scenes without it clear the grid.

## Performance

Measured in Node 22 on the CI container, 20k mixed liquid and powder particles: about 24 ms per grid frame; an empty
grid about 5 ms (air solver). Real-time (60 Hz) therefore holds up to roughly 10k active particles; beyond that the grid
runs in slow motion rather than dropping frames (`PowderWorld.advance` caps at 3 grid frames per physics step). The
panel shows the measured milliseconds per frame. No optimisation work beyond removing per-particle allocations was done.
Newtonian gravity (off by default) costs about 80 ms per recomputation at the full 153 x 96 size in the same environment (3 complex 512 x 256 FFTs, no real-input optimisation). It recomputes only on frames where the mass map or gravity mask changed, so static sources are free but moving ones (GRVT, GPMP, GBMB timers) make every frame that slow.

## Verification

* `tests/powder-core.test.ts`: element ids, falling, resting, liquid weight swap, freeze/boil/solidify transitions,
  ambient heat, border kill.
* `tests/powder-engine.test.ts`: CRAY/DRAY, portals, EMP, Newtonian gravity (direction, and off by default), PIPE, TRON, SOAP,
  PSTN/FRME, LSNS/VSNS/LDTC, SEED/PLNT trees, stickmen and fighters, Game of Life (blinker, block, Seeds, multi-state), LOVE.
* `tests/powder-chem.test.ts`: fire spread and extinguishing, spark conduction and insulation, explosions, acid, lava
  and water, ice crushing, rust.
* `tests/powder-physics.test.ts`: photon motion and reflection, neutron chain reaction, electrolysis, sponge,
  cloner, H2/O2 burning, singularity pressure.
* `tests/powder-exotic.test.ts`, `tests/powder-devices.test.ts`: glass shock, lightning, lithium, viruses, shields,
  fireworks, quartz growth, base/acid neutralisation, filters, ray emitters, powered cloners, pumps, accelerators,
  sensors, storage.
* `tests/powder-world.test.ts`: coordinate mapping, ground and body collision, ignition and wetting of bodies,
  pressure push, persistence round-trip and rejection.
* The tests assert the behaviours described in the translated source (for example "water freezes below 273.15 K",
  "NEUT + PLUT multiplies neutrons"). They are not comparisons with the running original, so a transcription error
  that preserves such qualitative behaviour would not be caught.
* A headless-browser run confirmed that the Powder tool opens, paints, and that sand rests on a crate and the
  ground while lava cools to stone.
