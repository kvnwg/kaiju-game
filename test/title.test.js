import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { setupTitle, roamRange, TITLE } from '../src/title.js';

test('the title shot: a fixed camera in the city, the kaiju kept in frame, the foreground left standing', () => {
  const game = new Game({ seed: 11, kaijuId: 'rex' });
  const title = setupTitle(game);
  const s = title.shot;
  assert.ok(Number.isFinite(s.score), 'found a camera spot with a clear view of the kaiju');
  const { lo, hi } = roamRange(s.d, 16 / 9);
  const near = game.city.objects.filter((o) => o.kind === 'building' && o.state === 'intact' && Math.hypot(o.x - s.ex, o.y - s.ey) < s.d * 0.4);
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 90; i++) {
    title.update(dt, 16 / 9);
    game.update(dt);
    game.kaiju.r = TITLE.r;
    game.drainEvents();
    game.drainVfx();
    const k = game.kaiju;
    const side = (k.x - s.ax) * -s.uy + (k.y - s.ay) * s.ux;
    assert.ok(side > lo - TITLE.r * 0.5 && side < hi + TITLE.r * 0.5, `the kaiju stays in frame (${Math.round(side)} across)`);
  }
  assert.equal(game.state, 'playing');
  assert.ok(game.stats.destroyed > 150, `it wrecks the city (${game.stats.destroyed} destroyed)`);
  assert.ok(near.length > 0 && near.every((o) => o.state === 'intact'), 'the buildings around the camera still stand');
  assert.ok(game.units.length > 0 && game.units.every((u) => u.type === 'heli'), 'only gunships come after it');
  assert.equal(game.boss, null, 'no boss walks in');
});
