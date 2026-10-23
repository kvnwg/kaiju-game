// Local profile: best scores and unlocks (the MVP's "local best scores").
// Storage can be unavailable (private mode, blocked site data), so every access is guarded.
const KEY = 'kaiju-rampage-profile-v1';

const DEFAULT_PROFILE = {
  tutorialDone: false,
  runs: 0,
  wins: 0,
  best: {}, // `${cityId}:${difficulty}` -> score
  cleared: {}, // `${cityId}:${difficulty}` -> true
  unlocked: { rex: true, gorilla: false, ember: true, volt: true },
  lastKaiju: 'rex',
  lastDifficulty: 'normal',
};

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_PROFILE);
    const saved = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_PROFILE), ...saved, unlocked: { ...DEFAULT_PROFILE.unlocked, ...saved.unlocked } };
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Progress just won't persist this session.
  }
}

// Folds a finished run into the profile; returns { newBest, unlocked: [kaijuIds] }.
export function recordRun(profile, results) {
  const key = `${results.cityId}:${results.difficulty}`;
  const out = { newBest: false, unlocked: [] };
  profile.runs++;
  profile.tutorialDone = true;
  profile.lastKaiju = results.kaijuId;
  profile.lastDifficulty = results.difficulty;
  if (results.score > (profile.best[key] || 0)) {
    profile.best[key] = results.score;
    out.newBest = true;
  }
  if (results.won) {
    profile.wins++;
    profile.cleared[key] = true;
    // Gorilla Grunt unlocks by beating city 1 (design doc: How kaiju are earned).
    if (results.cityId === 'harbor' && !profile.unlocked.gorilla) {
      profile.unlocked.gorilla = true;
      out.unlocked.push('gorilla');
    }
  }
  return out;
}
