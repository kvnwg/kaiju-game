import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { STAGE_INFO } from '../src/config.js';
import { frontPage, money } from '../src/news.js';

test('every size-up front page says what the kaiju can crush now, what is coming, and the damage so far', () => {
  const game = new Game({ seed: 3, kaijuId: 'rex' });
  Object.assign(game.stats, { buildings: 214, people: 1302, cars: 37, units: 52, scrap: 4234567 });
  for (let stage = 2; stage <= 6; stage++) {
    for (const roll of [0, 0.99]) {
      const page = frontPage(game, stage, () => roll);
      for (const key of ['edition', 'price', 'note', 'headline', 'subhead', 'menu', 'incoming', 'caption', 'damage']) assert.ok(page[key], `stage ${stage}: ${key}`);
      assert.equal(page.menu, `${STAGE_INFO[stage].destroys}.`);
      assert.equal(page.city, 'Harbor Town');
      assert.equal(page.damage, '$4.2 million');
      assert.deepEqual(page.numbers.map(([n]) => n), ['214', '1,302', '37', '52']);
      assert.equal(page.jokes.length, 3);
      assert.equal(new Set(page.jokes.map(([head]) => head)).size, 3, 'three different jokes');
    }
  }
  assert.match(frontPage(game, 6).incoming, /Coast Guard Mech/, 'the last edition names the final boss');
  assert.equal(frontPage(game, 6).price, 'FREE');
  assert.equal(frontPage(game, 3).size, 'Size 3 · Brute · as big as a house');
  assert.notEqual(frontPage(game, 2, () => 0).headline, frontPage(game, 2, () => 0.99).headline, 'headlines vary between runs');
});

test('damage reads like a newspaper would print it', () => {
  assert.equal(money(950), '$950');
  assert.equal(money(48200), '$48,000');
  assert.equal(money(999600), '$1,000,000');
  assert.equal(money(4234567), '$4.2 million');
  assert.equal(money(2.75e9), '$2.8 billion');
});
