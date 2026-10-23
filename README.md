# Kaiju Rampage

A playable browser prototype of the **Kaiju Rampage** core run loop, built from the game design doc. You start car-sized at the edge of Harbor Town. You smash and eat your way through 5 growth stages and pick 1 of 3 augments each time you grow. The run ends in a boss fight against the Coast Guard Mech on top of a collapsing skyline.

The GDD recommends prototyping first, and this is that prototype. It tests whether the smash, grow and pick loop is fun before any engine or monetization work. It is plain HTML5 canvas and ES modules: no build step and no dependencies.

## Run it

```sh
npm start            # serves the folder on http://localhost:8080 (or use any static server)
npm test             # unit tests + headless autopilot runs (Node 20+)
```

Open the page on a phone or a desktop browser.

- **Move:** drag anywhere for a floating virtual stick, or use WASD / arrow keys. Attacks fire automatically at the nearest target. Aimed augments (Atomic Breath) fire along your movement direction.
- **Pause:** the II button, Esc or P.
- **URL flags:** `?play` skips the menu, `?kaiju=volt` picks a kaiju, `?seed=7` fixes the run seed. `?debug=1` enables G (grow a stage), B (summon the boss early at Apex), K (kill the boss) and H (heal).

As the doc specifies, the first session drops straight into Harbor Town as Rex with no menus. After that, a menu lets you pick a kaiju and a difficulty.

## What's in the prototype

| GDD area | Built here |
| --- | --- |
| Core run loop | Drop in, smash and eat, grow, augment pick, escalation, boss, results, one revive per run (rewarded-ad placeholder) |
| Growth stages | All 5 stages: size doubles, the camera pulls back, and each stage opens a new class of destructible targets and a new military response |
| Size rules | Smaller things break in one hit (and get crushed underfoot). One size up takes several hits and pays 3x scrap. Two sizes up is out of reach. The landmark (Lighthouse) only breaks at stage 5 and drops a rare material |
| Augments | 14 of the MVP's 16 (8 silver, 5 gold, 1 prismatic), with upgradable `+` augments, same-tier offers, 1 free reroll per pick plus 1 ad reroll per run, and synergy-set tags on the pick cards |
| Synergy sets | Demolition Crew (chain collapses drop biomass) and Unkillable (shield regenerates while standing still), with a run title on the results screen |
| Kaiju roster | MVP four: Rex (Bite), Gorilla Grunt (Ground Pound), Ember Lizard (Fire Trail), Volt Beetle (Chain Zap). Gorilla Grunt unlocks by beating Harbor Town. Ember and Volt come from eggs in the full game, and are open for testing here |
| Military | Police, SWAT, dogs and roadblocks, then tanks, rocket infantry and helicopters, then jets, artillery and mini-mechs, then the boss with elite support. Big hits are telegraphed so you can dodge them |
| Boss | Coast Guard Mech: missile barrage, laser sweep and a charge that tramples the skyline, plus a phase 2 at 50% health |
| Difficulty | Normal, Hard and Nightmare. Each tier unlocks by beating the one below |
| Destruction tech | Buildings go through intact, damaged and rubble states. Collapses are scripted and directional. Physics debris is capped at 40 pieces and collapse animations at 3 at once. Also includes screen shake, dust, and a rationed slow-motion beat on big collapses |
| Economy | Scrap and biomass during the run. A loss keeps 50% of scrap. The results screen has a 2x-scrap rewarded-ad placeholder |
| Social | Local best scores per city and difficulty (the MVP's "local best scores") |

Not built yet: the lair, eggs, gems, the shop, live ops, Neo Tokyo and the other cities, and real ad or IAP SDKs. Those sit after Gate 1 in the roadmap.

## Code map

```
src/config.js    tuning tables: stages, size rules, kaiju, enemies, escalation, boss
src/augments.js  augment pool, synergy sets, offer and reroll rules
src/world.js     Harbor Town generator + spatial grid
src/game.js      simulation (no DOM): movement, combat, destruction, augments, military, boss, results
src/render.js    canvas renderer (2.5D buildings, units, kaiju, effects)
src/ui.js        HUD, augment pick, revive, results, menu
src/input.js     virtual stick + keyboard
src/main.js      bootstrap and game loop
test/            node:test suites + an autopilot bot used for balance checks
```

The simulation in `src/game.js` never touches the DOM. Tests and balance passes can therefore run full games headlessly with `test/bot.js`. With the current numbers, the bot reaches Apex in about 4 to 9 minutes, and first-session runs win about 7 times in 8.

## Gaps in the design doc

These came up while building. Each one is handled one way in the prototype and still needs a decision in the doc:

1. **First pick tier.** The stage 2 pick is Silver, but the first session guarantees Domino Effect (Gold) on the first pick. The prototype makes the first-ever pick a Gold pick.
2. **MVP augment count.** The MVP calls for 10 silver augments, but the doc names only 8. The prototype ships those 8, leaving 2 silver slots open.
3. **Prismatic offers.** The MVP has a single prismatic augment, so a prismatic roll at stage 5 can't fill 3 slots. The prototype offers Meteor Call plus 2 golds.
4. **First-session timing.** The doc grows the player at 0:30 but shows the first pick at 1:30. In the prototype, growing opens the pick immediately.
