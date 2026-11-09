import test from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from '../src/platform.js';

// CrazyGames: the game must not move on while an ad is requested or playing, so the game's
// buttons are blocked (onAdBusy) from the request until the ad is over, whether it plays or not.
test('the game is blocked from an ad request until the ad is over', async () => {
  const platform = new Platform(); // no SDK under node: the placeholder stands in
  const busy = [];
  platform.onAdBusy = (on) => busy.push(on);
  let finish;
  platform.placeholder = () => new Promise((resolve) => { finish = resolve; });
  const ad = platform.showAd('rewarded');
  assert.deepEqual(busy, [true], 'blocked as soon as the ad is asked for');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(platform.adPlaying, true);
  assert.equal(await platform.showAd('rewarded'), false, 'no second ad on top of the first');
  assert.deepEqual(busy, [true]);
  finish(true);
  assert.equal(await ad, true);
  assert.deepEqual(busy, [true, false], 'unblocked once it is over');
  assert.equal(platform.adPlaying, false);

  // An ad that fails still unblocks the game.
  platform.placeholder = () => Promise.reject(new Error('unfilled'));
  assert.equal(await platform.showAd('midgame'), false);
  assert.deepEqual(busy, [true, false, true, false]);
});
