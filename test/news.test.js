import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { STAGE_INFO } from '../src/config.js';
import { frontPage, money } from '../src/news.js';

test('every size-up front page says what the kaiju can crush now, what is coming, and the damage so far', () => {
  const game = new Game({ seed: 3, kaijuId: 'rex' });
  Object.assign(game.stats, { buildings: 214, people: 1302, cars: 37, units: 52, damage: 4234567 });
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

test('past the city, each realm has its own paper, and the next loop gets a second printing', () => {
  const game = new Game({ seed: 3, kaijuId: 'rex' });
  for (const [stage, mast] of [[7, 'The Galactic Gazette'], [9, 'The Galactic Gazette'], [10, 'The Anthill Herald'], [11, 'The Anthill Herald']]) {
    game.debugJump(stage);
    const page = frontPage(game, stage, () => 0.5);
    assert.equal(page.mast, mast, `size ${stage}`);
    assert.equal(page.menu, `${STAGE_INFO[stage].destroys}.`);
    assert.ok(page.headline && page.subhead && page.size.includes(`Size ${stage}`));
  }
  game.loop = 2;
  game.debugJump(1);
  const again = frontPage(game, 1, () => 0);
  assert.equal(again.mast, 'The Daily Stomp');
  assert.match(again.edition, /Second Printing/);
  assert.equal(again.incoming, 'Cops on foot. Again.');
  assert.equal(money(4.2e21), '$4.2 sextillion');
});
