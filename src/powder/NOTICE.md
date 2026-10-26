# Notice: code derived from The Powder Toy

Files in `src/powder/`, `scripts/extract_powder_toy.py` and `src/generated/powder-elements.json` are ported from,
or generated from, **The Powder Toy** (https://github.com/The-Powder-Toy/The-Powder-Toy), which is licensed under the
**GNU General Public License v3.0**. The port is a TypeScript translation of its simulation core (`Simulation.cpp`,
`Air.cpp`, `SimulationData.cpp`) and of individual element update functions in `src/simulation/elements/`. The exact
upstream commit is recorded in `src/generated/powder-elements.json` (`commit`).

Because these files are derivative works, distributing a build that includes them is subject to GPL-3.0 terms
(source availability, license notice, and the same license for the combined work). The rest of the repository did not
declare a license at the time this module was added; see `research/POWDER.md` for the open question.
