// The platform layer: video ads and gameplay events. On CrazyGames the CrazyGames SDK (loaded by
// index.html) plays real ads and hears when play starts and stops; anywhere else, such as a
// local build or a preview, a short placeholder stands in so every ad moment can be tried.
// See https://docs.crazygames.com/sdk/video-ads and https://docs.crazygames.com/sdk/game/.
export class Platform {
  constructor() {
    this.sdk = null;
    this.playing = false;
    this.adPlaying = false;
    this.lastError = null;
    this.placeholder = null; // (kind) => Promise<boolean>, drawn by the hub
    this.onAdStart = null; // mute the game while an ad plays
    this.onAdEnd = null;
    this.ready = this.init();
  }

  async init() {
    const sdk = typeof window !== 'undefined' && window.CrazyGames && window.CrazyGames.SDK;
    if (!sdk) return false;
    try {
      await sdk.init();
      // Off CrazyGames the SDK reports itself disabled; the placeholder stands in there.
      this.sdk = sdk.environment === 'disabled' ? null : sdk;
    } catch (err) {
      this.sdk = null;
    }
    return Boolean(this.sdk);
  }

  // The SDK's game events are optional extras: a failure there never stops the game.
  game(fn) {
    try {
      const g = this.sdk && this.sdk.game;
      if (g && typeof g[fn] === 'function') g[fn]();
    } catch (err) {
      // ignore
    }
  }

  loadingStart() {
    this.ready.then(() => this.game('loadingStart'));
  }

  loadingStop() {
    this.ready.then(() => this.game('loadingStop'));
  }

  // For the rare big moment: a chapter won.
  happytime() {
    this.game('happytime');
  }

  // Called every frame with whether a run is being played right now; passed on when it changes.
  setPlaying(on) {
    if (on === this.playing || !this.sdk) return;
    this.playing = on;
    this.game(on ? 'gameplayStart' : 'gameplayStop');
  }

  // A video ad: 'midgame' between runs, or 'rewarded' when the player chose one for a reward.
  // Resolves true once it has played to the end, which is when a reward is earned. No ad (none
  // to show, an ad blocker, the platform's cooldown) resolves false and the game carries on.
  async showAd(kind) {
    if (this.adPlaying) return false;
    this.adPlaying = true;
    await this.ready;
    let started = false;
    const start = () => {
      started = true;
      if (this.onAdStart) this.onAdStart();
    };
    const end = (ok) => {
      this.adPlaying = false;
      if (started && this.onAdEnd) this.onAdEnd();
      return ok;
    };
    if (!this.sdk) {
      start();
      try {
        return end(this.placeholder ? await this.placeholder(kind) : true);
      } catch (err) {
        return end(false);
      }
    }
    return new Promise((resolve) => {
      try {
        this.sdk.ad.requestAd(kind, {
          adStarted: start,
          adFinished: () => resolve(end(true)),
          adError: (err) => {
            this.lastError = (err && err.code) || String(err);
            resolve(end(false));
          },
        });
      } catch (err) {
        resolve(end(false));
      }
    });
  }
}
