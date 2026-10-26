// The platform layer: video ads, saves, settings and gameplay events. On CrazyGames the
// CrazyGames SDK (loaded by index.html) plays real ads, keeps the save with the player's
// account and hears when play starts and stops; anywhere else, such as a local build or a
// preview, the browser's own storage keeps the save and a short placeholder stands in for ads.
// See https://docs.crazygames.com/sdk/intro/.

// Ads that came back switched off (Basic Launch, kids mode) or blocked: remembered for a while so
// the next session doesn't show rewarded buttons that can't pay out. A real ad clears it.
const ADS_OFF_KEY = 'kaiju-rampage-ads-off';
const ADS_OFF_FOR = 12 * 3600 * 1000;

function local() {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

export class Platform {
  constructor() {
    this.sdk = null;
    this.playing = false;
    this.adPlaying = false;
    this.lastError = null;
    this.muteAudio = false; // CrazyGames' own sound setting: when on, the game stays silent
    this.adsOff = null; // why rewarded ads can't be offered right now, or null
    this.placeholder = null; // (kind) => Promise<boolean>, drawn by the hub
    this.onAdStart = null; // mute the game while an ad plays
    this.onAdEnd = null;
    this.onSettings = null; // the platform's settings changed (muteAudio)
    this.onAdsOff = null; // rewarded ads just became unavailable
    try {
      const until = Number(local().getItem(ADS_OFF_KEY));
      if (until > Date.now()) this.adsOff = 'remembered';
    } catch (err) {
      // No storage: start out offering ads.
    }
    this.ready = this.init();
  }

  async init() {
    const sdk = typeof window !== 'undefined' && window.CrazyGames && window.CrazyGames.SDK;
    if (!sdk) return false;
    try {
      // Also preloads the player's saved data (the Data module).
      await sdk.init();
      // Off CrazyGames the SDK reports itself disabled; the placeholder stands in there.
      this.sdk = sdk.environment === 'disabled' ? null : sdk;
    } catch (err) {
      this.sdk = null;
    }
    if (!this.sdk) return false;
    try {
      const apply = (settings) => {
        this.muteAudio = Boolean(settings && settings.muteAudio);
        if (this.onSettings) this.onSettings();
      };
      apply(this.sdk.game.settings);
      this.sdk.game.addSettingsChangeListener(apply);
    } catch (err) {
      // An older SDK without settings: nothing to obey.
    }
    this.sdk.ad.hasAdblock().then((blocked) => blocked && this.noAds('adblock'), () => {});
    return true;
  }

  // Where the save lives: the SDK's Data module on CrazyGames (it follows a signed-in player
  // between devices, and keeps guests' progress in this browser), localStorage anywhere else.
  // Both have the localStorage API. Only valid once `ready` has resolved.
  get storage() {
    return (this.sdk && this.sdk.data) || local();
  }

  // Whether rewarded-ad buttons should be offered at all.
  get rewardedAds() {
    return !this.adsOff;
  }

  noAds(why) {
    if (this.adsOff && this.adsOff !== 'remembered') return;
    const was = this.adsOff;
    this.adsOff = why;
    try {
      local().setItem(ADS_OFF_KEY, String(Date.now() + ADS_OFF_FOR));
    } catch (err) {
      // Not remembered, then.
    }
    if (!was && this.onAdsOff) this.onAdsOff(why);
  }

  adsBack() {
    if (!this.adsOff) return;
    this.adsOff = null;
    try {
      local().removeItem(ADS_OFF_KEY);
    } catch (err) {
      // Nothing to forget.
    }
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
      this.adsBack();
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
            // Switched off for this session (Basic Launch, kids mode) or blocked: stop offering them.
            if (this.lastError === 'adsDisabled' || this.lastError === 'adblock') this.noAds(this.lastError);
            resolve(end(false));
          },
        });
      } catch (err) {
        resolve(end(false));
      }
    });
  }
}
