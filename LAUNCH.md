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
| Covers | `store/covers/cover-1920x1080.png`, `cover-800x1200.png`, `cover-800x800.png` |
| Preview videos | The 16:9 and 2:3 1080p clips (silent, about 19 s, opening on the cover) |
| Title, description, controls, tags | Below |

## 3. Store text

**Title:** Kaiju Rampage (see the note on the name at the end)

**Description:**
Start as a hatchling no bigger than a person and eat your way up to a monster taller than the
skyline. Smash an endless voxel city, pick a new power at every level (laser eyes, atomic breath,
meteor showers, tail spins) and beat a ridiculous boss at every size: a cyborg hitman, an HOA
president in power armour, an armoured ice-cream truck, a sentient demolition crane and City Hall
itself. Every time you grow, the local paper slams onto the screen with the damage report.
Between runs, upgrade your gear, unlock new kaiju and mutate your way to bigger rampages.

**Controls:**
- Move: WASD or arrow keys (phones and tablets: drag anywhere on the screen)
- Attack: automatic, at whatever is nearest
- Charge: Space or Shift (touch: the Charge button)
- Pause: P or the II button

**Suggested tags:** Kaiju, Monster, Destruction, Roguelite, Upgrade, Boss, Voxel, 3D

## 4. How the game meets the requirements (for QA)

| Requirement | In the game |
| --- | --- |
| Gameplay start/stop | Start when a run is being played, stop on pause, knock-downs, level-up picks, the newspaper, ads, results and menus (`src/platform.js`, `setPlaying`) |
| Loading start/stop, happytime | Loading around boot; happytime when a chapter is won |
| Lands new players in gameplay within one click | One tap on the title starts the first run; no menus before it |
| Progress saving | Everything is one save in the SDK's Data module (a few KB; the limit is 1 MB), read after `SDK.init()` |
| muteAudio setting | Obeyed at start and on change; the in-game sound toggle can't override it |
| Midgame ads | After a match ends, before the results; never during play. On top of the SDK's 3-minute cap, `src/adpacing.js` waits for 3–5 minutes of play before the first one (longer in a player's first session), skips very short runs, keeps 90 s of real play between breaks, and skips the first break for players back after 3+ days |
| Rewarded ads | Labelled with a ▶ icon; the reward only after `adFinished`; a "try again later" message on failure; game muted and paused while an ad plays |
| Not too often / not pushed | Free gems: 10 a day, 3 minutes apart with a countdown on the button; no flashing promos |
| Skip matches the ad button | Revive / Give up, Spin / Close, energy, patrol and results buttons are the same size and colour |
| Out-of-lives ads | The ad revive is at most one offer per run and at least 5 minutes apart (not every knock-down), on a 10 s countdown; no ad break follows a knock-down that offered one. New players, players back after a break and players on a losing streak get one free revive a session instead |
| Ads off (Basic Launch) or ad blockers | Detected (`hasAdblock`, `adsDisabled`) and every rewarded button is hidden; the pass bonus and the wheel switch to small gem prices; the game plays normally |
| No external ads, links, purchases or logins | None in the game |
| No custom fullscreen button | None (CrazyGames provides fullscreen) |
| Restricted keys | Escape isn't used (P pauses); WASD is read by key position, so ZQSD works on AZERTY |
| Readable in small 16:9 frames | Checked at 821x462, 800x450 and up to 1920x1080; the interface scales up on big screens |
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
- In the Developer Portal preview: an ad break after a run (after the first few minutes of play), a
  rewarded ad for gems, and the game with an ad blocker on.
- Signing in and out of a CrazyGames account: progress should follow the account.

## 6. Decisions for you

- **The name.** "Kaiju Rampage" is also the name of a 2025 LAI Games arcade cabinet, and *Rampage* is
  Warner Bros.' long-running series about giant monsters wrecking cities. CrazyGames asks for names
  that can't be confused with other games, so a more distinct name would be safer.
- **English only** is allowed. Translations would have to follow the SDK's `locale` and be accurate.
