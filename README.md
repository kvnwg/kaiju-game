# Kaiju Rampage

A playable browser prototype of the **Kaiju Rampage** core run loop, built from the game design doc. It is rendered as an endless, procedurally generated voxel city that is built around you as you move. Every run gets a new world, and you always start human-sized in a suburban backyard, eating people your own size (and hopping over the garden fences). You grow through backyards, houses, apartment blocks and towers until you are skyline-sized. The run ends in a boss fight against the Coast Guard Mech. The light goes from golden hour at the start of a run to neon night by the boss.

It is plain ES modules with no build step. three.js r147 (with bloom) loads from jsDelivr, so the page needs an internet connection.

## Run it

```sh
npm start            # serves the folder on http://localhost:8080 (or use any static server)
npm test             # unit tests + headless autopilot runs (Node 20+)
```

- **Move:** drag anywhere for a floating virtual stick, or use WASD / arrow keys. Movement is relative to the tilted camera. Attacks fire automatically at the nearest target.
- **Pause:** the II button, Esc or P. The pause menu has a graphics setting (High, Medium or Low). The game also steps down on its own if frames run slow.
- **URL flags:** `?play` skips the menu, `?kaiju=volt` picks a kaiju, `?seed=7` fixes the run seed (and with it the world), `?q=low` sets quality, `?look=pixel` turns on the optional retro pixel filter. `?debug=1` enables G (grow a stage, skipping its size boss), N (fill the growth bar to call the size boss), B (summon the boss early at Apex), K (kill the boss) and H (heal).

## What's in it

| Area | Built here |
| --- | --- |
| Growth | 6 stages, roughly doubling in size each time: Human, Backyard, House, Apartment block, Office tower, Apex. Each stage opens a new class of things to break and a new military response |
| World | Endless and generated as you go: the world is cut into 420-unit cells that are generated from the seed and their position when the kaiju gets near, and dropped again once it has moved on (destruction is remembered, so a flattened block stays flattened). District centres are scattered one per 7x7-cell region, with seven district styles: suburbs with fenced backyards, a pastel old town, a red-brick industrial district, garden midtown with green roofs, neon downtown, harbor docks and parks, with forest in between. Lakes, the occasional sea and winding rivers come from a noise water field; highways every 8 cells cross wide water on suspension bridges, smaller roads on road bridges, and lighthouses stand on piers by the docks. A downtown is always a short walk from the home suburb |
| Buildings | 89 procedural voxel building types in 4 variants each (85 are placed by the generator). Towers vary their composition (podium + tower, setbacks, chamfered corners, L-shapes), facade (punched windows, ribbon windows, glass curtain wall, concrete grid, stripes, tiles, fins), glass tint, window light colours and crown (spire, dome, pyramid, helipad, lit frame, water tank, roof garden, mast, slanted glass). Civic landmarks: city hall, museum, library, bank, cathedral, clock tower, train station, theater, pagoda. Everyday city: shop rows, townhouse rows, supermarket, car dealership, diner, construction sites with tower cranes. Examples: houses, sheds, playhouses, ramen bars, arcades, tenements with fire escapes, megablocks, ring towers, stepped towers, twin towers, an arcology, a TV tower, a stadium, a power plant, cabins, ranger towers and the lighthouse landmark |
| City life | Parks with paths, ponds, playgrounds, basketball and tennis courts and gazebos; plazas with promenades, big screens, food trucks and cafe seating; elevated metro lines every 9 rows with stations, subway entrances and running trains; power lines between poles; painted parking bays and manholes; beaches; bird flocks that scatter; boats; a blimp that drifts after the kaiju |
| Size bosses | You can't size up for free: a full growth bar sends a boss built for your current size, and you grow once it is down (the bar reads BOSS until then). Size 1: **Agent Kilowatt**, a cyborg hitman (laser-sighted pistol bursts, teleport blinks, exploding business cards). Size 2: **KAREN-9000**, an HOA president in power armour (homing violation notices, clipboard charges, "I want to speak to your MANAGER" calls in the cops). Size 3: **Mr. Whippy**, an armoured ice-cream truck (lobbed scoops that cause brain freeze, a tightening donut lap that sprays sprinkles, ramming charges). Size 4: **Wrecking Bill**, a sentient demolition crane (wrecking-ball spins that chase you round, steel beams dropped across your path, union breaks where he sits down and takes extra damage). Size 5: **The Mecha-Mayor**, City Hall on legs (tax laser, Budget Cuts X-slashes, a filibuster speech that makes him immune while his supporters arrive, campaign-blimp carpet bombs). Each has quips, a furious second phase at half health, and health counted in hits of your own damage. Ground attacks lead where you are heading; a fight never starts below half health (second wind) |
| Healing | No augment heals. **Hospitals** wear a pulsing green outline and a floating cross; smash one to heal 25% (12% if it is a size below you, less below that), and from size 5 a bigger **medical center** does the same. While you are small (sizes 1-2) a **doctor** very rarely turns up in the crowd, marked by a spinning green cross: eat them to heal 12%. Big heals skip the healing falloff and clear sedation. Eating people as a hatchling and killing units still heal a sliver |
| Swarms | The military answers in squads, with a field cap that grows from 6 units to 36 (more at high threat). Each size fields units built to that size, led by a melee mob that charges in, about three-quarters your size and a little slower than you: attack drones, robo-hounds, exo walkers, spider crushers, warframes and titans. Mobs stride over anything smaller than they are |
| Pushback | A threat meter (five pips under the size bar) fills as you smash and kill and drains when you ease off; threat speeds up reinforcements, raises how many units can be on the field and brings strike waves sooner. From size 2, a telegraphed strike wave arrives every 40-55 s from three sides at once, with artillery barrages onto your path from size 4 and jet runs from size 5. Every level-up makes new units (and the boss) tougher and harder-hitting. Each size from 2 has a named elite (Interceptor, Riot Command, Mammoth Tank, Warframe Prime, Omega Titan) that pays a free level-up. Healing from eating falls off the more you have healed recently; net launchers slow you and rocket teams' sedative rounds stop healing for a moment; missile batteries fire six-missile volleys. The first session ramps up half as fast |
| Detail that scales with you | The ground is painted per cell at a resolution that follows the kaiju's size: about 0.4 units per texel for the hatchling (with sidewalk joints, grass tufts, lily pads and road patches), coarser and in bigger 2x2 and 4x4-cell tiles once it is huge. A world-space voxel grain in the shader keeps it crisp up close, and coastlines are drawn as smooth contours. Buildings far below your size switch to half-resolution voxel meshes, pocket-sized clutter is left out of cells generated once you are huge, and instanced meshes grow with the view |
| Small assets | 79 voxel props: cars, taxis, buses, trucks, lampposts, neon poles, vending machines, food carts, barriers, power poles, billboards, swing sets, pools, trampolines, BBQs, gnomes, and pine, birch, blossom and autumn trees |
| Life | Voxel crowds that walk the streets and flee from you, plus traffic driving the road network |
| Destruction | Buildings are pre-fractured into Voronoi chunks. Hits knock off the chunks nearest the impact, shoving into a building chips it where you push, and collapses tip toward the hit direction, then break into physics debris and leave a rubble pile. Small things shatter into voxels |
| Lighting | Golden afternoon to sunset to neon night, following run progress. Windows light up after dark, neon glows, street lights pool on the ground, and the effects include soft shadows and bloom. The world renders as crisp full-resolution voxels with tilt-shift, while the HUD is pixel art. An optional Retro pixel look (pause menu) renders a small upscaled frame with 1px outlines, a limited palette and ordered dithering |
| Kaiju | Rex, Gorilla Grunt, Ember Lizard and Volt Beetle, each with its own animated voxel rig (walk cycle, tail, jaw, punches) |
| Augments | Vampire Survivors-style levelling. Eating and smashing fill an **XP bar** (separate from size); every level-up is a pick of 3, about every 10-20 seconds, ~40 per run. Hold up to **6 moves and 6 passives**. **Moves** (Claw Strike, Tail Spin, Spine Missiles, Car Toss, Roar, Laser Eyes, Seismic Slam, Atomic Breath, Meteor Call) level 1-8: most levels are stat bumps, key levels add the signature upgrade (Claw Lv3 strikes twice, Laser Lv5 splits in 3, Tail Spin Lv6 becomes a cyclone...). **Moves** also include Lightning Breath (chains through metal), Building Hurl, Acid Spit (melting puddles), Ice Breath (frozen units shatter in one hit), Vortex Belch, Orbiting Spines (always on), Magnetic Roar (yanks vehicles into a heap), Frenzy Bite and Brood Call (hatchling allies). **Passives** level 1-5: stat passives (Might, Kaiju-Sized area, Adrenaline cooldown, Long Legs speed, Toughness, Appetite XP, Scavenger scrap, Thick Hide, Glass Cannon, Momentum, Spiked Hide, Big Bones crush radius, Iron Stomach, Magnet Jaws orb range, Steady Footing, Overclock) and perks (Gas Main, Magnetic Hide, Rage Mode, Echo, Perfect Rhythm, Bloodlust, Power Surge). **Evolutions**: a maxed move plus its partner passive is offered as an evolution at the next level-up, taking no slot: Omega Beam (Laser Eyes + Might), Cyclone King (Tail Spin + Long Legs), Spine Storm (Spine Missiles + Echo), Meltdown (Atomic Breath + Rage Mode), Extinction Event (Meteor Call + Kaiju-Sized), Earthbreaker (Seismic Slam + Toughness), Junkyard Storm (Car Toss + Magnetic Hide) and Doom Roar (Roar + Adrenaline). Kills scatter loot orbs that pay a little XP or scrap when you walk close. When everything is maxed, picks offer a growth spurt or scrap. 3 rerolls per run |
| Run loop | 2 synergy sets, rerolls, escalating military, the boss, revive, results, difficulty tiers and local best scores |

Not built yet: the lair, eggs, gems, the shop, live ops, the other cities, and real ad or IAP SDKs.

## Code map

```
src/config.js     tuning: stages, size rules, kaiju, enemies, escalation, boss
src/voxel.js      voxel grid + building toolkit (windows, cornices, signs, neon, vines, roofs)
src/buildings.js  69 procedural building types
src/props.js      57 street and nature props
src/models.js     kaiju rigs, people, military units, size bosses, final boss
src/mesher.js     voxel meshing with face culling and ambient occlusion; Voronoi pre-fracture
src/world.js      the endless world: water field, districts, roads, bridges, lots, streaming cells
src/augments.js   augment catalogue, move level tables, slots and offer rules
src/moves.js      the attack moves and how their levels change them
src/game.js       simulation (no DOM): movement, size rules, crowds, traffic, combat, boss
src/render3d.js   three.js scene: camera, day/night, building streaming and LOD, chipping, collapses
src/terrain3d.js  streamed ground tiles with size-based resolution, shorelines, water
src/actors3d.js   animated kaiju/boss rigs, units, crowd and traffic instancing
src/fx3d.js       debris physics, dust and glow particles, rings, beams, telegraphs
src/ui.js, input.js, storage.js, main.js
test/             node:test suites + an autopilot bot used for balance checks
```

The simulation and the voxel generators never touch the DOM, so tests can build every building and run full games headlessly. With the current numbers, the bot reaches the boss in about 10 to 15 minutes with ~27 level-ups (picks thin out from about five a minute to one); each size boss takes it 10 to 40 seconds. On later runs it loses about 1 to 3 in 10 (usually to KAREN-9000 or the swarm right after her), and it wins every first run.

## Gaps in the design doc

These came up while building. Each one is handled one way in the prototype and still needs a decision in the doc:

0. **Starting size.** The doc starts the kaiju car-sized with 5 stages. This prototype starts it human-sized and adds a stage, so there are 6 stages and 5 augment picks per run.
1. **First pick tier.** The first pick is meant to be Silver, but the first session guarantees a Gold move on it (Laser Eyes, so the first pick is showy). The prototype makes the first-ever pick a Gold pick.
2. **Augment pool and pacing.** The doc's MVP pool (16 mostly passive augments, one pick per size stage) was replaced by Vampire Survivors-style levelling: an XP bar with frequent picks, levelled moves and passives, and 6 + 6 slots. The doc's augment section needs updating.
3. **Prismatic offers.** There are only a few prismatic augments, so a prismatic roll can come up short. The prototype tops it up from Gold.
4. **First-session timing.** The doc grows the player at 0:30 but shows the first pick at 1:30. In the prototype, growing opens the pick immediately.
