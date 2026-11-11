# Launching on CrazyGames

Everything needed to submit Kaiju Rampage to CrazyGames as a full implementation (SDK v3: ads,
saves, gameplay events). Requirements are from [docs.crazygames.com](https://docs.crazygames.com/requirements/intro/).

## 1. Build the upload

```sh
npm ci
npm test
npm run build
```

`npm run build` writes `dist/` and `dist/kaiju-rampage.zip`. Upload the zip: `index.html` is at its
root, all paths are relative, and it holds 15 files (about 1.6 MB unpacked, well under the 20 MB
needed for the mobile homepage). three.js r147 and the fonts ship inside it; the only outside
script is the CrazyGames SDK itself.

## 2. Submission form (Developer Portal)

| Field | Choose |
| --- | --- |
| Game files | HTML5, `dist/kaiju-rampage.zip` |
| **Progress save** | **"Yes, using the Data module from the CrazyGames SDK".** Without it the SDK disables the Data module and nothing is saved on CrazyGames |
| Implementation | Full (SDK v3) |
| Devices | Desktop and mobile (touch controls are built in) |
| Mobile orientation | Landscape and portrait (every screen has a layout for both) |
| Covers | `store/covers/cover-1920x1080.png`, `cover-800x1200.png`, `cover-800x800.png` (true pixel art, 4x4 screen pixels per art pixel; drawn by `tools/cover-pixel.html`, rendered with `node tools/cover-art.mjs covers`) |
| Preview videos | `store/video/kaiju-rampage-1920x1080.mp4` and `kaiju-rampage-1080x1620.mp4`: silent, about 18.5 s, opening on the cover (filmed by `tools/trailer.mjs`, cut by `tools/trailer-edit.py`; the videos are not in git, rebuild them with those two) |
| Title, description, controls, tags | Below |

## 3. Store text

**Title:** Kaiju Rampage (see the note on the name at the end)

**Description:**
Start as a hatchling no bigger than a person and eat your way up to a monster taller than the
skyline. Stomp cars, flatten houses and topple skyscrapers in an endless voxel city full of things
to wreck. Pick a new power every level (laser eyes, atomic breath, meteor showers, tail spins,
building throws) and beat a ridiculous boss at every size: a cyborg hitman, an HOA president in
power armour, an armoured ice-cream truck, a sentient demolition crane and City Hall itself.

Then keep growing. Stomp across a real map of the Earth eating whole countries while they fire
missiles at you, outgrow the planet, eat stars and galaxies, swallow the universe, and wake up
ant-sized in somebody's back garden.

Four kaiju, four ways to play: Rex pounces and devours, Gorilla Grunt rips buildings out of the
ground and throws them, Ember Lizard sets the city ablaze, and Volt Beetle teleports through
everything in its way. Between runs, upgrade your gear, hatch new kaiju and mutate your way to
bigger rampages. Every time you grow, the local paper slams onto the screen with the damage report.

**Controls:**
- Move: WASD or arrow keys (phones and tablets: drag anywhere on the screen)
- Attack: automatic, at whatever is nearest
- Special: Space or Shift (touch: the button in the corner). Rex pounces, Volt Beetle blinks,
  the others charge
- Pause: P or the II button

**Suggested tags:** Kaiju, Monster, Destruction, Dinosaur, Roguelite, Upgrade, Boss, Voxel, 3D, Casual

**Category:** Action

## 4. How the game meets the requirements (for QA)

| Requirement | In the game |
| --- | --- |
| Gameplay start/stop | Start when a run is being played, stop on pause, knock-downs, level-up picks, the newspaper, ads, results and menus (`src/platform.js`, `setPlaying`) |
| Loading start/stop, happytime | Loading around boot; happytime when a chapter is won |
| Lands new players in gameplay immediately | No title or play button: once the city has loaded, a new player is in their first run (controls tip on screen); returning players land in the hub |
| Progress saving | Everything is one save in the SDK's Data module (a few KB; the limit is 1 MB), read after `SDK.init()` |
| muteAudio setting | Obeyed at start and on change; the in-game sound toggle can't override it |
| Midgame ads | Only after a size-up: the newspaper slams in, and once the player taps it away an ad break may follow (QA's suggestion); never during play, and never on a navigational button (a run ends on "Give up" or "Cash out" and goes straight to the results). On top of the SDK's 3-minute cap, `src/adpacing.js` waits for 3–5 minutes of play before the first one (longer in a player's first session), keeps 90 s of real play between breaks, skips one straight after a rewarded video, and skips the first break for players back after 3+ days |
| Rewarded ads | Every rewarded button wears the same green tag: a video-camera icon and "AD" (revive, reroll, 2x rewards, free crates and eggs, the free daily deal, energy, gems, pass, patrol, wheel); the reward only after `adFinished`; a "try again later" message on failure; game muted and paused while an ad plays |
| No progress during an ad | From the moment an ad is requested until it finishes or fails, gameplay is frozen and an invisible layer takes every click and tap (`onAdBusy` in `src/platform.js`, `#app.ad-busy`) |
| Not too often / not pushed | Free gems: 10 a day, 3 minutes apart with a countdown on the button; no flashing promos |
| Skip matches the ad button | Revive / Give up, Spin / Close, energy, patrol and results buttons are the same size and colour |
| Out-of-lives ads | The ad revive is at most one offer per run and at least 5 minutes apart (not every knock-down), on a 10 s countdown; no ad break follows a knock-down. New players, players back after a break and players on a losing streak get one free revive a session instead |
| Ad pressure (`AD_PRESSURE` in `src/config.js`) | Once a run, when an ad revive is ready and the run nears the player's best, enemies hit 1.8x harder for 25 s with two extra strike waves. Never without ads, never in a player's first 3 runs; one A/B arm in three never gets it. **Review risk:** CrazyGames bans ads that "trigger deceptively"; if QA questions it, set `enabled: false` and rebuild |
| Ads off (Basic Launch) or ad blockers | Detected (`hasAdblock`, `adsDisabled`) and every rewarded button is hidden; the pass bonus and the wheel switch to small gem prices; the game plays normally |
| No external ads, links, purchases or logins | None in the game |
| No custom fullscreen button | None (CrazyGames provides fullscreen) |
| Restricted keys | Escape isn't used (P pauses); WASD is read by key position, so ZQSD works on AZERTY |
| Readable in small 16:9 frames | Every font size went up by 2px for Full Launch QA (the smallest text is now 8px in the pixel font, from 6px). Above about 800x480 the whole interface scales with the frame (`fitUi` in `src/main.js`), so every 16:9 frame from 821x462 to 1920x1080 shows the same layout, just bigger, and the HUD gets a further 1.25x on anything bigger than a phone. Floating combat text and speech bubbles scale with it. The in-run HUD is dark glass with white type and a bright gold damage counter by a gold coin (it was pale gold on lavender, which QA flagged as hard to read), and on short screens it packs down (narrower bars, a smaller charge button, the tutorial tip moved to a corner) so the kaiju keeps the middle of the screen |
| Consistent at 144 Hz+ | Simulation runs on frame time (capped at 20 fps steps) |
| Text selection on touch | Off (`user-select: none` with every prefix, no touch callouts) |
| iOS audio | The audio context resumes on every touch or click while suspended or interrupted |
| PEGI 12 | Cartoon voxel violence; people are eaten but there is no blood or gore |
| Language | English |

## 5. Check on real hardware before submitting

- Chrome and Edge on desktop; Safari on a Mac and an iPhone (CrazyGames switches off games that
  run badly on Safari).
- A 4 GB Chromebook or an older phone: if late runs stutter, the game steps graphics down on its own,
  and the pause menu has Low graphics.
- In the Developer Portal preview: an ad break after tapping away a size-up newspaper (after the
  first few minutes of play), none after "Give up", a rewarded ad for gems, and the game with an ad
  blocker on.
- Signing in and out of a CrazyGames account: progress should follow the account.

## 6. Decisions for you

- **The name.** "Kaiju Rampage" is also the name of a 2025 LAI Games arcade cabinet, and *Rampage* is
  Warner Bros.' long-running series about giant monsters wrecking cities. CrazyGames asks for names
  that can't be confused with other games, so a more distinct name would be safer.
- **English only** is allowed. Translations would have to follow the SDK's `locale` and be accurate.
