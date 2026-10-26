import { newSave, migrateV1, normalize } from './meta.js';

// The save: everything the meta game tracks (see meta.js), as one JSON string in `store`, which
// has the localStorage API (the CrazyGames Data module or the browser's localStorage; see
// Platform.storage). Version 1 profiles are migrated. Storage can be missing or blocked, so every
// access is guarded and the game just starts fresh or doesn't persist.
const SAVE_KEY = 'kaiju-rampage-save-v2';

export function loadSave(store, now = Date.now()) {
  try {
    const raw = store.getItem(SAVE_KEY);
    if (raw) return normalize(JSON.parse(raw), now);
    const old = store.getItem('kaiju-rampage-profile-v1');
    if (old) return migrateV1(JSON.parse(old), now);
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return newSave(now);
}

export function writeSave(store, save) {
  try {
    store.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Progress just won't persist this session.
  }
}

export function clearSave(store) {
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}
