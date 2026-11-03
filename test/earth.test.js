import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldMap, EarthSim, EARTH, dirOf, latLonOf } from '../src/earth.js';
import { Game } from '../src/game.js';
import { STAGES, EARTH_STAGE } from '../src/config.js';
import { createRng } from '../src/rng.js';

const at = (sim, lat, lon) => {
  const id = sim.map.ids[sim.cellOf(dirOf(lat, lon))];
  return id ? sim.map.countries[id].name : null;
};

test('the globe is the real map: every country drawn, cities in the right countries, nothing smeared over the date line', () => {
  const m = worldMap();
  assert.equal(m.countries.length - 1, 177);
  assert.equal(m.eatable, 177, 'every country covers some of the map');
  const sim = new EarthSim(createRng(3));
  assert.equal(at(sim, 48.86, 2.35), 'France');
  assert.equal(at(sim, 35.68, 139.69), 'Japan');
  assert.equal(at(sim, 55.75, 37.6), 'Russia');
  assert.equal(at(sim, 30.04, 31.24), 'Egypt');
  assert.equal(at(sim, -23.55, -46.63), 'Brazil');
  assert.equal(at(sim, 61.2, -149.9), 'United States of America');
  assert.equal(at(sim, -89.9, 40), 'Antarctica', 'the south pole is ice, not sea');
  // Russia's far east and Fiji cross the date line; drawn wrongly they smear right across the map.
  assert.equal(at(sim, 68, -30), null);
  assert.equal(at(sim, -17.8, -30), null);
  // Neighbours never share a map colour.
  const fr = m.countries.find((k) => k && k.name === 'France');
  const de = m.countries.find((k) => k && k.name === 'Germany');
  assert.notEqual(fr.color, de.color);
});

test('walking all the way round the globe comes back to the start', () => {
  const sim = new EarthSim(createRng(5));
  sim.standOn([10, 20]);
  const start = sim.up();
  const lap = 2 * Math.PI * sim.R;
  for (let i = 0; i < 400; i++) sim.move(lap / 400, 0);
  const end = sim.up();
  assert.ok(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) < 1e-6);
  // A quarter of the way north from the equator is the north pole.
  sim.standOn([0, 0]);
  for (let i = 0; i < 100; i++) sim.move(0, -(lap / 4) / 100);
  assert.ok(latLonOf(sim.up()).lat > 89.9, 'walking up the screen walks north at the start');
});

test('bites carve out land; a country nearly gone is finished off', () => {
  const sim = new EarthSim(createRng(7));
  sim.standOn([50.6, 4.6]); // Belgium
  const id = sim.map.countries.findIndex((k) => k && k.name === 'Belgium');
  const before = sim.left[id];
  let res;
  for (let i = 0; i < 20 && !sim.gone.has(id); i++) res = sim.bite(0, 0, 30);
  assert.ok(sim.gone.has(id), 'Belgium was eaten');
  assert.equal(sim.left[id], 0);
  assert.ok(sim.landEaten >= before);
  assert.ok(res.finished.includes(id) || sim.gone.has(id));
  // The sea can't be eaten.
  sim.standOn([0, -30]);
  assert.equal(sim.bite(0, 0, 30).area, 0);
});

test('the globe comes between the city and the planet: eat enough of it and you outgrow the Earth', () => {
  assert.equal(STAGES[EARTH_STAGE].realm, 'earth');
  assert.equal(STAGES[EARTH_STAGE + 1].name, 'Worldbreaker');
  const g = new Game({ seed: 9 });
  g.debugJump(EARTH_STAGE);
  assert.equal(g.realm, 'earth');
  assert.ok(g.earth);
  assert.equal(g.objects.length, 0);
  // Stand somewhere big and let the kaiju bite.
  g.earth.standOn([60, 90]);
  g.input = { x: 0, y: 0 };
  const bio = g.kaiju.biomass;
  for (let i = 0; i < 90; i++) {
    g.update(1 / 30);
    while (g.state === 'picking') g.choose(g.pick.options[0]);
    g.kaiju.hp = g.kaiju.maxHp;
  }
  assert.ok(g.kaiju.biomass > bio, 'biting the land fills the growth bar');
  assert.ok(g.earth.progress > 0);
  assert.ok(g.stats.damage > 0, 'and the damage counter');
  // A full bar: no gate boss here, straight off to the solar system.
  g.kaiju.biomass = g.stage.biomassToNext;
  for (let i = 0; i < 600 && g.realm === 'earth'; i++) {
    g.update(1 / 30);
    while (g.state === 'picking') g.choose(g.pick.options[0]);
  }
  assert.equal(g.boss, null);
  assert.equal(g.realm, 'solar');
  assert.equal(g.kaiju.stage, EARTH_STAGE + 1);
  assert.equal(g.earth, null);
});

test('countries fire missiles: standing still gets you hit, a charge through one does not', () => {
  const g = new Game({ seed: 4 });
  g.debugJump(EARTH_STAGE);
  g.earth.standOn([45, 60]);
  g.input = { x: 0, y: 0 };
  const k = g.kaiju;
  for (let i = 0; i < 30 * 30 && k.hp === k.maxHp; i++) {
    g.update(1 / 30);
    while (g.state === 'picking') g.choose(g.pick.options[0]);
  }
  assert.ok(k.hp < k.maxHp, 'a missile landed');
  // Mid-charge, a missile landing on you does nothing.
  k.hp = k.maxHp;
  const m = { from: g.earth.up(), to: g.earth.up(), t: 0, dur: 0.05, r: 0.05, nuke: false, by: 1, dmg: EARTH.missile.dmg };
  g.earth.missiles = [m];
  g.earth.launchT = 99;
  k.dashCd = 0;
  g.tryDash();
  for (let i = 0; i < 3; i++) g.update(1 / 30);
  assert.equal(k.hp, k.maxHp);
});
