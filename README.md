# Kaiju Rampage

A playable browser prototype of the **Kaiju Rampage** core run loop, built from the game design doc. It is rendered as a procedurally generated voxel city. Every run generates a new map, and you always start human-sized in a suburban backyard, eating people your own size (and hopping over the garden fences). You grow through backyards, houses, apartment blocks and towers until you are skyline-sized. The run ends in a boss fight against the Coast Guard Mech. The light goes from golden hour at the start of a run to neon night by the boss.

It is plain ES modules with no build step. three.js r147 (with bloom) loads from jsDelivr, so the page needs an internet connection.

## Run it

```sh
npm start            # serves the folder on http://localhost:8080 (or use any static server)
npm test             # unit tests + headless autopilot runs (Node 20+)
```

- **Move:** drag anywhere for a floating virtual stick, or use WASD / arrow keys. Movement is relative to the tilted camera. Attacks fire automatically at the nearest target.
- **Pause:** the II button, Esc or P. The pause menu has a graphics setting (High, Medium or Low). The game also steps down on its own if frames run slow.
- **URL flags:** `?play` skips the menu, `?kaiju=volt` picks a kaiju, `?seed=7` fixes the run seed (and with it the map), `?q=low` sets quality, `?look=smooth` turns off the pixel-art look. `?debug=1` enables G (grow a stage), B (summon the boss early at Apex), K (kill the boss) and H (heal).

## What's in it

| Area | Built here |
| --- | --- |
| Growth | 6 stages, roughly doubling in size each time: Human, Backyard, House, Apartment block, Office tower, Apex. Each stage opens a new class of things to break and a new military response |
| World | A new procedural map every run (the districts, lake, river, forest belts, highway bridge and metro all move with the seed), with seven district styles: suburbs with fenced backyards, a pastel old town, a red-brick industrial district, garden midtown with green roofs, neon downtown, a second neon city (Neon Heights) beyond a forest belt, and harbor docks. A lake with a river runs through it, crossed by a long suspension bridge |
| Buildings | 89 procedural voxel building types in 4 variants each (85 are placed by the generator). Towers vary their composition (podium + tower, setbacks, chamfered corners, L-shapes), facade (punched windows, ribbon windows, glass curtain wall, concrete grid, stripes, tiles, fins), glass tint, window light colours and crown (spire, dome, pyramid, helipad, lit frame, water tank, roof garden, mast, slanted glass). Civic landmarks: city hall, museum, library, bank, cathedral, clock tower, train station, theater, pagoda. Everyday city: shop rows, townhouse rows, supermarket, car dealership, diner, construction sites with tower cranes. Examples: houses, sheds, playhouses, ramen bars, arcades, tenements with fire escapes, megablocks, ring towers, stepped towers, twin towers, an arcology, a TV tower, a stadium, a power plant, cabins, ranger towers and the lighthouse landmark |
| City life | Parks with paths, ponds, playgrounds, basketball and tennis courts and gazebos; plazas with promenades, big screens, food trucks and cafe seating; an elevated metro line with stations, subway entrances and running trains; power lines between poles; painted parking bays and manholes; a beach; bird flocks that scatter; boats; a blimp over downtown |
| Small assets | 79 voxel props: cars, taxis, buses, trucks, lampposts, neon poles, vending machines, food carts, barriers, power poles, billboards, swing sets, pools, trampolines, BBQs, gnomes, and pine, birch, blossom and autumn trees |
| Life | Voxel crowds that walk the streets and flee from you, plus traffic driving the road network |
| Destruction | Buildings are pre-fractured into Voronoi chunks. Hits knock off the chunks nearest the impact, shoving into a building chips it where you push, and collapses tip toward the hit direction, then break into physics debris and leave a rubble pile. Small things shatter into voxels |
| Lighting | Golden afternoon to sunset to neon night, following run progress. Windows light up after dark, neon glows, street lights pool on the ground, and the effects include soft shadows and bloom. The default Pixel look renders a small frame upscaled with hard pixels, with 1px outlines, a limited palette and ordered dithering; Smooth swaps that for full resolution and tilt-shift |
| Kaiju | Rex, Gorilla Grunt, Ember Lizard and Volt Beetle, each with its own animated voxel rig (walk cycle, tail, jaw, punches) |
| Augments | 38 augments in three kinds. **Moves** are attacks that fire on their own cooldown, each with its own animation and effects: Claw Strike, Tail Spin, Spine Missiles, Car Toss, Roar, Laser Eyes, Seismic Slam, Atomic Breath and Meteor Call. **Mods** upgrade one move (Double Strike, Crescent Sweep, Molten Claws, Cyclone, Barrage, Cluster Spines, Juggler, Ricochet, Prism Split, Overcharge, Aftershock, Fault Lines, Napalm, Long Breath, Meteor Shower...) or all of them (Hair Trigger, Kaiju-Sized, Echo), and are only offered once you own their move. **Passives** cover destruction chains, defence and growth. Your first offer is always three moves |
| Run loop | 2 synergy sets, rerolls, escalating military, the boss, revive, results, difficulty tiers and local best scores |

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
src/augments.js   augment catalogue (moves, mods, passives) and offer rules
src/moves.js      the attack moves and how their mods change them
src/game.js       simulation (no DOM): movement, size rules, crowds, traffic, combat, boss
src/render3d.js   three.js scene: camera, day/night, ground, water, building streaming, chipping, collapses
src/actors3d.js   animated kaiju/boss rigs, units, crowd and traffic instancing
src/fx3d.js       debris physics, dust and glow particles, rings, beams, telegraphs
src/ui.js, input.js, storage.js, main.js
test/             node:test suites + an autopilot bot used for balance checks
```

The simulation and the voxel generators never touch the DOM, so tests can build every building and run full games headlessly. With the current numbers, the bot finishes a run in about 6 to 13 minutes and wins most of them.

## Gaps in the design doc

These came up while building. Each one is handled one way in the prototype and still needs a decision in the doc:

0. **Starting size.** The doc starts the kaiju car-sized with 5 stages. This prototype starts it human-sized and adds a stage, so there are 6 stages and 5 augment picks per run.
1. **First pick tier.** The first pick is meant to be Silver, but the first session guarantees a Gold move on it (Laser Eyes, so the first pick is showy). The prototype makes the first-ever pick a Gold pick.
2. **Augment pool.** The doc's MVP pool (16 mostly passive augments) was replaced by a larger pool built around moves and mods, so the doc's augment list needs updating.
3. **Prismatic offers.** There are only a few prismatic augments, so a prismatic roll can come up short. The prototype tops it up from Gold.
4. **First-session timing.** The doc grows the player at 0:30 but shows the first pick at 1:30. In the prototype, growing opens the pick immediately.
