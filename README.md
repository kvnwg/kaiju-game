# Kaiju Rampage

A playable browser prototype of the **Kaiju Rampage** core run loop, built from the game design doc. It is rendered as a procedurally generated voxel city. You start human-sized in a suburban backyard, eating people your own size. You grow through backyards, houses, apartment blocks and towers until you are skyline-sized. The run ends in a boss fight against the Coast Guard Mech. The light goes from golden hour at the start of a run to neon night by the boss.

It is plain ES modules with no build step. three.js r147 (with bloom) loads from jsDelivr, so the page needs an internet connection.

## Run it

```sh
npm start            # serves the folder on http://localhost:8080 (or use any static server)
npm test             # unit tests + headless autopilot runs (Node 20+)
```

- **Move:** drag anywhere for a floating virtual stick, or use WASD / arrow keys. Movement is relative to the tilted camera. Attacks fire automatically at the nearest target.
- **Pause:** the II button, Esc or P. The pause menu has a graphics setting (High, Medium or Low). The game also steps down on its own if frames run slow.
- **URL flags:** `?play` skips the menu, `?kaiju=volt` picks a kaiju, `?seed=7` fixes the run seed, `?q=low` sets quality. `?debug=1` enables G (grow a stage), B (summon the boss early at Apex), K (kill the boss) and H (heal).

## What's in it

| Area | Built here |
| --- | --- |
| Growth | 6 stages, roughly doubling in size each time: Human, Backyard, House, Apartment block, Office tower, Apex. Each stage opens a new class of things to break and a new military response |
| World | One procedural map with seven district styles: suburbs with fenced backyards, a pastel old town, a red-brick industrial district, garden midtown with green roofs, neon downtown, a second neon city (Neon Heights) beyond a forest belt, and harbor docks. A lake with a river runs through it, crossed by a long suspension bridge |
| Buildings | 69 procedural voxel building types in 3 variants each (65 are placed by the generator). Examples: houses, sheds, playhouses, ramen bars, arcades, tenements with fire escapes, megablocks, ring towers, stepped towers, twin towers, an arcology, a TV tower, a stadium, a power plant, cabins, ranger towers and the lighthouse landmark |
| Small assets | 57 voxel props: cars, taxis, buses, trucks, lampposts, neon poles, vending machines, food carts, barriers, power poles, billboards, swing sets, pools, trampolines, BBQs, gnomes, and pine, birch, blossom and autumn trees |
| Life | Voxel crowds that walk the streets and flee from you, plus traffic driving the road network |
| Destruction | Buildings are pre-fractured into Voronoi chunks. Hits knock off the chunks nearest the impact, shoving into a building chips it where you push, and collapses tip toward the hit direction, then break into physics debris and leave a rubble pile. Small things shatter into voxels |
| Lighting | Golden afternoon to sunset to neon night, following run progress. Windows light up after dark, neon glows, street lights pool on the ground, and the effects include soft shadows, bloom and tilt-shift |
| Kaiju | Rex, Gorilla Grunt, Ember Lizard and Volt Beetle, each with its own animated voxel rig (walk cycle, tail, jaw, punches) |
| Run loop | 14 augments with 2 synergy sets, rerolls, escalating military, the boss, revive, results, difficulty tiers and local best scores (unchanged from the first prototype, retuned for 6 stages) |

Not built yet: the lair, eggs, gems, the shop, live ops, the other cities, and real ad or IAP SDKs.

## Code map

```
src/config.js     tuning: stages, size rules, kaiju, enemies, escalation, boss
src/voxel.js      voxel grid + building toolkit (windows, cornices, signs, neon, vines, roofs)
src/buildings.js  69 procedural building types
src/props.js      57 street and nature props
src/models.js     kaiju rigs, people, military units, boss
src/mesher.js     voxel meshing with face culling and ambient occlusion; Voronoi pre-fracture
src/world.js      districts, roads, lake, bridge, lots, backyards, forest
src/game.js       simulation (no DOM): movement, size rules, crowds, traffic, combat, augments, boss
src/render3d.js   three.js scene: camera, day/night, ground, water, building streaming, chipping, collapses
src/actors3d.js   animated kaiju/boss rigs, units, crowd and traffic instancing
src/fx3d.js       debris physics, dust and glow particles, rings, beams, telegraphs
src/ui.js, input.js, storage.js, main.js
test/             node:test suites + an autopilot bot used for balance checks
```

The simulation and the voxel generators never touch the DOM, so tests can build every building and run full games headlessly. With the current numbers, the bot reaches the boss in about 5 to 12 minutes and wins most runs.

## Gaps in the design doc

These came up while building. Each one is handled one way in the prototype and still needs a decision in the doc:

0. **Starting size.** The doc starts the kaiju car-sized with 5 stages. This prototype starts it human-sized and adds a stage, so there are 6 stages and 5 augment picks per run.
1. **First pick tier.** The first pick is meant to be Silver, but the first session guarantees Domino Effect (Gold) on it. The prototype makes the first-ever pick a Gold pick.
2. **MVP augment count.** The MVP calls for 10 silver augments, but the doc names only 8. The prototype ships those 8, leaving 2 silver slots open.
3. **Prismatic offers.** The MVP has a single prismatic augment, so a prismatic roll at stage 5 can't fill 3 slots. The prototype offers Meteor Call plus 2 golds.
4. **First-session timing.** The doc grows the player at 0:30 but shows the first pick at 1:30. In the prototype, growing opens the pick immediately.
