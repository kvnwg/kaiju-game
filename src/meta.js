// The meta game around the runs: currencies, energy, account level, chapters, gear with a merge
// ladder, crates with pity counters, a shop paid in gems, scrap and rewarded ads (no real-money
// purchases), quests, a login calendar, the Rampage Pass, Patrol idle rewards, the Lucky Wheel,
// the Mutation tree and kaiju stars.
// No DOM: everything here is plain functions over a save object, with the time passed in, so it
// can be tested and later moved behind a server without changes.
import { createRng } from './rng.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- tuning
export const ECONOMY = {
  energyCap: 30,
  energyPerRun: 5,
  energyRegenMs: 12 * 60000,
  energyAd: 5,
  energyGemPack: { energy: 15, gems: 50, perDay: 3 },
  adGems: 30, // gems per rewarded ad (ten a day, a few minutes apart: see AD_PLACEMENTS.gems)
  passBonusGems: 20, // a pass bonus reward bought with gems, when ads can't be shown
  wheelGems: 20, // a Lucky Wheel spin bought with gems, when ads can't be shown
  levelUpEnergy: 5,
  levelUpGems: 20,
  quickPatrolEnergy: 15,
  quickPatrolPerDay: 3,
  quickPatrolHours: 2,
  patrolCapHours: 12,
  reviveGems: [30, 60],
};

export const RARITY = [
  { id: 'common', name: 'Common', color: '#b9bec7', cap: 10, mult: 1 },
  { id: 'uncommon', name: 'Uncommon', color: '#6fdc6f', cap: 20, mult: 1.6 },
  { id: 'rare', name: 'Rare', color: '#4fa8ff', cap: 30, mult: 2.4 },
  { id: 'epic', name: 'Epic', color: '#b468ff', cap: 40, mult: 3.6 },
  { id: 'legendary', name: 'Legendary', color: '#ffb43c', cap: 50, mult: 5.2 },
  { id: 'mythic', name: 'Mythic', color: '#ff4d5e', cap: 60, mult: 7.5 },
];
export const EPIC = 3;

export const GEAR_SLOTS = [
  { id: 'fangs', name: 'Fangs', main: 'atk', base: { atk: 4 } },
  { id: 'claws', name: 'Claws', main: 'atk', base: { atk: 3.5 } },
  { id: 'hide', name: 'Hide', main: 'hp', base: { hp: 6 } },
  { id: 'spines', name: 'Spines', main: 'hp', base: { hp: 5 } },
  { id: 'tail', name: 'Tail', main: 'speed', base: { hp: 2.5, speed: 1.5 } },
  { id: 'heart', name: 'Heart', main: 'atk', base: { atk: 2, hp: 3 } },
];
export const SLOT_BY_ID = Object.fromEntries(GEAR_SLOTS.map((s) => [s.id, s]));

// Fangs are weapons: their effect changes the basic attack at every rarity, and Epic upgrades
// it. Every other piece's perk switches on at Epic.
export const GEAR = {
  ironJaw: { slot: 'fangs', name: 'Iron Jaw', effect: 'Basic attacks hit buildings 40% harder', perk: 'Buildings take 80% more' },
  sawTeeth: { slot: 'fangs', name: 'Saw Teeth', effect: 'Basic attacks cleave a 120° arc', perk: 'Cleave widens to 200°' },
  venomFangs: { slot: 'fangs', name: 'Venom Fangs', effect: 'Hits poison units', perk: 'Poison spreads on death' },
  thunderFangs: { slot: 'fangs', name: 'Thunder Fangs', effect: 'Hits chain to 2 more targets', perk: 'Chains to 4 targets' },
  plasmaMaw: { slot: 'fangs', name: 'Plasma Maw', effect: 'Every 4th attack fires a plasma bolt', perk: 'Every 3rd attack' },
  razorClaws: { slot: 'claws', name: 'Razor Claws', perk: '+15% critical hits (double damage)' },
  hookClaws: { slot: 'claws', name: 'Hook Claws', perk: 'Yanks small units into bite range' },
  magmaClaws: { slot: 'claws', name: 'Magma Claws', perk: 'Hits leave burning ground' },
  graniteHide: { slot: 'hide', name: 'Granite Hide', perk: '12% less damage taken' },
  mirrorScales: { slot: 'hide', name: 'Mirror Scales', perk: '20% chance to shrug off a shot' },
  mossHide: { slot: 'hide', name: 'Moss Hide', perk: 'Shield regrows when not hit' },
  thornSpines: { slot: 'spines', name: 'Thorn Spines', perk: 'Melee attackers take damage' },
  rocketSpines: { slot: 'spines', name: 'Rocket Spines', perk: 'A homing spine every 5 s' },
  crystalSpines: { slot: 'spines', name: 'Crystal Spines', perk: '+15% move area' },
  whipTail: { slot: 'tail', name: 'Whip Tail', perk: 'Charges deal triple damage' },
  rudderTail: { slot: 'tail', name: 'Rudder Tail', perk: 'Charge recharges 35% faster' },
  clubTail: { slot: 'tail', name: 'Club Tail', perk: 'Charges send units flying' },
  atomicHeart: { slot: 'heart', name: 'Atomic Heart', perk: '10% shorter move cooldowns' },
  gluttonHeart: { slot: 'heart', name: 'Glutton Heart', perk: '+20% XP from eating' },
  titanHeart: { slot: 'heart', name: 'Titan Heart', perk: 'Start each run one level up' },
};
for (const [id, g] of Object.entries(GEAR)) g.id = id;
export const GEAR_IDS = Object.keys(GEAR);

export const MUTATIONS = [
  { id: 'atk', name: 'Strength', text: '+5% attack', per: { atk: 5 }, max: 40, row: 1 },
  { id: 'hp', name: 'Bulk', text: '+6% health', per: { hp: 6 }, max: 40, row: 1 },
  { id: 'speed', name: 'Long Stride', text: '+2% speed', per: { speed: 2 }, max: 10, row: 2 },
  { id: 'pickup', name: 'Magnetism', text: '+10% pickup range', per: { pickup: 10 }, max: 10, row: 2 },
  { id: 'xp', name: 'Quick Study', text: '+3% XP', per: { xp: 3 }, max: 10, row: 3 },
  { id: 'dash', name: 'Sprinter', text: '5% faster Charge', per: { dashCd: 5 }, max: 6, row: 3 },
  { id: 'reroll', name: 'Second Thoughts', text: '+1 reroll a run', per: { reroll: 1 }, max: 2, row: 4 },
  { id: 'revive', name: 'Nine Lives', text: '+1 free revive', per: { revive: 1 }, max: 1, row: 5 },
];
export const MUTATION_ROW_LEVEL = { 1: 4, 2: 6, 3: 9, 4: 12, 5: 15 };

// How each kaiju is earned, and the shards that raise it a star (stars 1 to 5).
export const KAIJU_META = {
  rex: { unlock: 'free' },
  gorilla: { unlock: 'Clear chapter 1', chapter: 1 },
  ember: { unlock: 'Account level 6 or 1,500 gems', level: 6, gems: 1500 },
  volt: { unlock: '30 shards from Kaiju Eggs' },
};
export const SHARD_UNLOCK = 30;
export const STAR_SHARDS = [30, 60, 120, 240];
export const STAR_BONUS = 0.08;

export const CHAPTERS = [
  'Harbor Town', 'Pastel Bay', 'Brickport', 'Neon Heights', 'Garden City',
  'Iron Docks', 'Neo Tokyo', 'Frostgate', 'Sunset Strip', 'Capital City',
].map((name, i) => ({ n: i + 1, name, seed: 1101 + i * 7919, featured: GEAR_SLOTS[i % GEAR_SLOTS.length].id }));
export const CHAPTER_MUL = 1.35;
export const MODES = {
  normal: { id: 'normal', name: 'Normal', firstClearGems: 100 },
  hard: { id: 'hard', name: 'Hard', firstClearGems: 150 },
  nightmare: { id: 'nightmare', name: 'Nightmare', firstClearGems: 200 },
};

export const CRATES = {
  supply: {
    id: 'supply', name: 'Supply Crate', gems: 80, rarity: { 0: 70, 1: 25, 2: 5 },
    pity: { rarity: 2, every: 10 }, text: 'One gear piece, DNA and scrap',
  },
  egg: {
    id: 'egg', name: 'Kaiju Egg', gems: 300, ten: 2680, rarity: { 2: 72, 3: 25, 4: 3 },
    pity: { rarity: 3, every: 10 }, legendary: 50, text: 'A Rare or better piece and kaiju shards',
  },
};

// Features open with account level, one at a time.
export const FEATURES = {
  gear: 2, shop: 2, quests: 3, wheel: 3, mutations: 4,
  pass: 5, patrol: 5, hard: 5, kaiju: 6, eggAd: 8, deals: 8,
};

export const AD_PLACEMENTS = {
  double: { cap: 3, name: 'Double run rewards' },
  energy: { cap: 3, name: '+5 energy' },
  crate: { cap: 1, name: 'Free Supply Crate' },
  gems: { cap: 10, cooldown: 180, name: '30 gems' }, // a few minutes apart, so ads aren't pushed
  pass: { cap: Infinity, name: 'Bonus pass reward' },
  wheel: { cap: 5, name: 'Lucky Wheel spin' },
  patrol: { cap: 1, name: 'Free Quick Patrol' },
  deal: { cap: 1, name: 'Free Daily Deal' },
  egg: { cap: 1, weekly: true, name: 'Weekly Kaiju Egg' },
};

export const DAILY_QUESTS = [
  { id: 'runs', text: 'Play 2 runs', stat: 'runs', goal: 2 },
  { id: 'eat', text: 'Eat 100 people', stat: 'people', goal: 100 },
  { id: 'topple', text: 'Topple 30 buildings', stat: 'buildings', goal: 30 },
  { id: 'boss', text: 'Beat a size boss', stat: 'gateBosses', goal: 1 },
  { id: 'crate', text: 'Open any crate', stat: 'crates', goal: 1 },
];
export const DAILY_QUEST_REWARD = { gems: 16, passXp: 20 };
export const WEEKLY_QUESTS = [
  { id: 'clear', text: 'Clear a chapter', stat: 'clears', goal: 1 },
  { id: 'bosses', text: 'Beat 10 bosses', stat: 'bosses', goal: 10 },
  { id: 'apex', text: 'Reach Apex size 3 times', stat: 'apex', goal: 3 },
  { id: 'damage', text: 'Cause $1B of damage', stat: 'damage', goal: 1e9 },
];
export const WEEKLY_QUEST_REWARD = { gems: 100 };

export const LOGIN_REWARDS = [
  { scrap: 1000 }, { gems: 30 }, { dnaAny: 10 }, { energy: 15 }, { gems: 50 }, { keys: { supply: 1 } }, { keys: { egg: 1 } },
];

export const PASS = { tiers: 30, xpPerTier: 100, seasonDays: 28 };

// Eight equal slices on the wheel; the odds come from the weights (out of 100).
export const WHEEL = [
  { reward: { scrap: 500 }, weight: 28 },
  { reward: { dnaAny: 5 }, weight: 20 },
  { reward: { gems: 10 }, weight: 15 },
  { reward: { energy: 5 }, weight: 10 },
  { reward: { scrap: 1500 }, weight: 13 },
  { reward: { keys: { supply: 1 } }, weight: 6 },
  { reward: { gems: 30 }, weight: 6 },
  { reward: { keys: { egg: 1 } }, weight: 2 },
];

export const SKINS = {
  golden: { name: 'Golden', gems: 1500, tint: [1, 0.78, 0.25], mix: 0.55, metal: true },
  shadow: { name: 'Shadow', gems: 800, tint: [0.32, 0.18, 0.5], mix: 0.6 },
  neon: { name: 'Neon', gems: 1200, tint: [0.15, 0.95, 1], mix: 0.45, glow: true },
  zombie: { name: 'Zombie', how: 'Rampage Pass tier 30', tint: [0.45, 0.62, 0.35], mix: 0.6 },
};

// ---------------------------------------------------------------- time helpers
const pad = (n) => String(n).padStart(2, '0');
export function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function weekKey(now) {
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(monday.getTime());
}
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- save
export function newSave(now = Date.now()) {
  return normalize({ v: 2, created: now }, now);
}

// Fills in anything a save is missing, so older saves keep working as systems are added.
export function normalize(s, now = Date.now()) {
  const def = (obj, key, val) => {
    if (obj[key] === undefined || obj[key] === null) obj[key] = val;
    return obj[key];
  };
  def(s, 'v', 2);
  def(s, 'created', now);
  def(s, 'tutorialDone', false);
  def(s, 'runs', 0);
  def(s, 'wins', 0);
  def(s, 'best', {});
  def(s, 'unlocked', { rex: true });
  def(s, 'lastKaiju', 'rex');
  def(s, 'account', { level: 1, xp: 0 });
  const cur = def(s, 'cur', {});
  def(cur, 'scrap', 0);
  def(cur, 'gems', 0);
  def(cur, 'energy', ECONOMY.energyCap);
  def(cur, 'geneCores', 0);
  const dna = def(cur, 'dna', {});
  for (const sl of GEAR_SLOTS) def(dna, sl.id, 0);
  def(cur, 'shards', {});
  const keys = def(cur, 'keys', {});
  def(keys, 'supply', 0);
  def(keys, 'egg', 0);
  def(s, 'energyAt', now);
  const ch = def(s, 'chapter', {});
  def(ch, 'unlocked', 1);
  def(ch, 'selected', 1);
  def(ch, 'mode', 'normal');
  def(ch, 'cleared', {}); // `${n}:${mode}` -> true
  def(ch, 'milestones', {}); // `${n}:${stage}` -> true
  def(ch, 'bossFirsts', {}); // `${n}:${mode}:${stage}` -> true
  const gear = def(s, 'gear', {});
  def(gear, 'items', []);
  def(gear, 'equipped', {});
  def(gear, 'nextUid', 1);
  def(s, 'kaiju', {});
  def(s, 'mutations', {});
  def(s, 'mutationsBought', 0);
  const crates = def(s, 'crates', {});
  def(crates, 'supplySince', 0);
  def(crates, 'eggSince', 0);
  def(crates, 'eggSinceLeg', 0);
  def(crates, 'freeFirst', false);
  def(s, 'daily', { day: '' });
  def(s, 'weekly', { week: '' });
  const login = def(s, 'login', {});
  def(login, 'index', 0);
  def(login, 'last', '');
  const pass = def(s, 'pass', {});
  def(pass, 'season', 1);
  def(pass, 'xp', 0);
  def(pass, 'free', {});
  def(pass, 'prem', {});
  def(s, 'patrol', { since: now });
  const skins = def(s, 'skins', {});
  def(skins, 'owned', {});
  def(skins, 'equipped', null);
  def(s, 'stats', { bosses: 0, gateBosses: 0, people: 0, buildings: 0, bestDamage: 0, crates: 0 });
  def(s, 'settings', {});
  return s;
}

// Carries an old (version 1) profile over: runs, wins, best scores and kaiju.
export function migrateV1(p, now = Date.now()) {
  const s = newSave(now);
  s.tutorialDone = Boolean(p.tutorialDone);
  s.runs = p.runs || 0;
  s.wins = p.wins || 0;
  s.best = { ...(p.best || {}) };
  s.unlocked = { rex: true };
  if (p.unlocked && p.unlocked.gorilla) s.unlocked.gorilla = true;
  if (p.cleared && p.cleared['harbor:normal']) {
    s.chapter.cleared['1:normal'] = true;
    s.chapter.unlocked = 2;
  }
  s.lastKaiju = p.lastKaiju && s.unlocked[p.lastKaiju] ? p.lastKaiju : 'rex';
  s.settings = { sound: p.sound, music: p.music, pixelArt: p.pixelArt, quality: p.quality };
  return s;
}

// ---------------------------------------------------------------- daily and weekly resets
export function genDeals(day) {
  const rng = createRng(hashString(`deals:${day}`));
  const slot = () => rng.pick(GEAR_SLOTS).id;
  const nonFree = Object.keys(KAIJU_META).filter((k) => KAIJU_META[k].unlock !== 'free');
  return [
    { give: { dna: { [slot()]: 5 } }, cost: { ad: true } },
    { give: { items: [[rng.pick(GEAR_IDS), 1]] }, cost: { gems: 60 } },
    { give: { dna: { [slot()]: 15 } }, cost: { scrap: 2000 } },
    { give: { scrap: 5000 }, cost: { gems: 60 } },
    { give: { items: [[rng.pick(GEAR_IDS), 2]] }, cost: { gems: 240 } },
    { give: { shards: { [rng.pick(nonFree)]: 5 } }, cost: { gems: 150 } },
  ];
}

export function rollover(s, now = Date.now()) {
  const day = dayKey(now);
  if (s.daily.day !== day) {
    s.daily = { day, progress: {}, claimed: {}, bonus: false, ads: {}, deals: genDeals(day), dealsBought: {}, energyBuys: 0, quickPatrols: 0 };
  }
  const week = weekKey(now);
  if (s.weekly.week !== week) s.weekly = { week, progress: {}, claimed: {}, bonus: false, ads: {} };
  // Seasons of the pass run back to back from the day the save was made.
  const season = Math.floor((now - s.created) / (PASS.seasonDays * DAY)) + 1;
  if (s.pass.season !== season) s.pass = { season, xp: 0, free: {}, prem: {} };
  syncEnergy(s, now);
}

// ---------------------------------------------------------------- energy
export function energyCap() {
  return ECONOMY.energyCap;
}
export function syncEnergy(s, now = Date.now()) {
  const cap = energyCap(s, now);
  const c = s.cur;
  if (c.energy >= cap) {
    s.energyAt = now;
    return;
  }
  const gained = Math.floor((now - s.energyAt) / ECONOMY.energyRegenMs);
  if (gained > 0) {
    c.energy = Math.min(cap, c.energy + gained);
    s.energyAt += gained * ECONOMY.energyRegenMs;
  }
  if (c.energy >= cap) s.energyAt = now;
}
export function nextEnergyIn(s, now = Date.now()) {
  if (s.cur.energy >= energyCap(s, now)) return 0;
  return Math.max(0, ECONOMY.energyRegenMs - (now - s.energyAt));
}
export function spendEnergy(s, n, now = Date.now()) {
  syncEnergy(s, now);
  if (s.cur.energy < n) return false;
  const wasFull = s.cur.energy >= energyCap(s, now);
  s.cur.energy -= n;
  if (wasFull) s.energyAt = now;
  return true;
}

// ---------------------------------------------------------------- currencies and grants
export function canAfford(s, cost) {
  if (!cost) return true;
  if (cost.gems && s.cur.gems < cost.gems) return false;
  if (cost.scrap && s.cur.scrap < cost.scrap) return false;
  if (cost.energy && s.cur.energy < cost.energy) return false;
  if (cost.geneCores && s.cur.geneCores < cost.geneCores) return false;
  if (cost.dna) for (const [k, v] of Object.entries(cost.dna)) if ((s.cur.dna[k] || 0) < v) return false;
  return true;
}
export function pay(s, cost) {
  if (!canAfford(s, cost)) return false;
  if (cost.gems) s.cur.gems -= cost.gems;
  if (cost.scrap) s.cur.scrap -= cost.scrap;
  if (cost.energy) s.cur.energy -= cost.energy;
  if (cost.geneCores) s.cur.geneCores -= cost.geneCores;
  if (cost.dna) for (const [k, v] of Object.entries(cost.dna)) s.cur.dna[k] -= v;
  return true;
}

// Applies a reward bundle and returns it with random parts resolved (for the rewards screen).
export function grant(s, reward, rng = createRng(Date.now())) {
  const out = { ...reward };
  const c = s.cur;
  if (reward.scrap) c.scrap += reward.scrap;
  if (reward.gems) c.gems += reward.gems;
  if (reward.energy) c.energy += reward.energy;
  if (reward.geneCores) c.geneCores += reward.geneCores;
  if (reward.dna || reward.dnaAny || reward.dnaEach) {
    const add = { ...(reward.dna || {}) };
    if (reward.dnaEach) for (const sl of GEAR_SLOTS) add[sl.id] = (add[sl.id] || 0) + reward.dnaEach;
    for (let i = 0; i < (reward.dnaAny || 0); i++) {
      const k = rng.pick(GEAR_SLOTS).id;
      add[k] = (add[k] || 0) + 1;
    }
    for (const [k, v] of Object.entries(add)) c.dna[k] = (c.dna[k] || 0) + v;
    out.dna = add;
    delete out.dnaAny;
    delete out.dnaEach;
  }
  if (reward.keys) for (const [k, v] of Object.entries(reward.keys)) c.keys[k] = (c.keys[k] || 0) + v;
  if (reward.shards) for (const [k, v] of Object.entries(reward.shards)) c.shards[k] = (c.shards[k] || 0) + v;
  if (reward.items) out.items = reward.items.map(([id, r]) => addItem(s, id, r));
  if (reward.skin) s.skins.owned[reward.skin] = true;
  if (reward.xp) out.levels = addAccountXp(s, reward.xp, Date.now());
  if (reward.passXp) addPassXp(s, reward.passXp);
  return out;
}

// ---------------------------------------------------------------- account level
export function xpToLevel(level) {
  return Math.round(200 * Math.pow(1.25, level - 1));
}
export function featureOpen(s, feature) {
  return s.settings.unlockAll || s.account.level >= (FEATURES[feature] || 1);
}
// Returns the levels gained; each pays energy and gems.
export function addAccountXp(s, xp, now = Date.now()) {
  const a = s.account;
  a.xp += xp;
  const gained = [];
  while (a.xp >= xpToLevel(a.level)) {
    a.xp -= xpToLevel(a.level);
    a.level++;
    gained.push(a.level);
    s.cur.energy += ECONOMY.levelUpEnergy;
    s.cur.gems += ECONOMY.levelUpGems;
    if (a.level === KAIJU_META.ember.level) s.unlocked.ember = true;
  }
  return gained;
}

// ---------------------------------------------------------------- gear
export function addItem(s, id, rarity = 0) {
  const item = { uid: s.gear.nextUid++, id, rarity, level: 1 };
  s.gear.items.push(item);
  return item;
}
export function itemByUid(s, uid) {
  return s.gear.items.find((i) => i.uid === uid) || null;
}
export function equippedItem(s, slot) {
  return itemByUid(s, s.gear.equipped[slot]);
}
export function itemStats(item) {
  const slot = SLOT_BY_ID[GEAR[item.id].slot];
  const k = RARITY[item.rarity].mult * (1 + 0.08 * (item.level - 1));
  const out = {};
  for (const [stat, v] of Object.entries(slot.base)) out[stat] = v * k;
  // Uncommon and up add a cross stat; Rare and up add XP gain.
  if (item.rarity >= 1) {
    const cross = slot.main === 'hp' ? 'atk' : 'hp';
    const mainV = slot.base[slot.main === 'speed' ? 'hp' : slot.main] || 0;
    out[cross] = (out[cross] || 0) + mainV * 0.3 * k;
  }
  if (item.rarity >= 2) out.xp = (out.xp || 0) + 3 + item.rarity;
  return out;
}
export function levelCost(item) {
  return { scrap: Math.round(100 * Math.pow(1.12, item.level - 1)), dna: { [GEAR[item.id].slot]: 2 + Math.floor((item.level - 1) / 3) } };
}
export function gearMaxLevel(item) {
  return RARITY[item.rarity].cap;
}
export function levelUp(s, uid) {
  const item = itemByUid(s, uid);
  if (!item || item.level >= gearMaxLevel(item)) return false;
  if (!pay(s, levelCost(item))) return false;
  item.level++;
  return true;
}
function invested(item) {
  let scrap = 0;
  let dna = 0;
  for (let l = 1; l < item.level; l++) {
    const c = levelCost({ ...item, level: l });
    scrap += c.scrap;
    dna += Object.values(c.dna)[0];
  }
  return { scrap, dna };
}
// Resetting refunds everything spent on levels, so no choice is permanent.
export function resetItem(s, uid) {
  const item = itemByUid(s, uid);
  if (!item || item.level <= 1) return null;
  const back = invested(item);
  s.cur.scrap += back.scrap;
  s.cur.dna[GEAR[item.id].slot] += back.dna;
  item.level = 1;
  return back;
}
export function equip(s, uid) {
  const item = itemByUid(s, uid);
  if (!item) return false;
  s.gear.equipped[GEAR[item.id].slot] = uid;
  return true;
}
export function unequip(s, slot) {
  delete s.gear.equipped[slot];
}
// The two pieces a merge would eat: the same item at the same rarity (Legendary: any piece of
// the same slot), never something equipped.
export function mergeFodder(s, uid) {
  const base = itemByUid(s, uid);
  if (!base || base.rarity >= RARITY.length - 1) return [];
  const equippedUids = new Set(Object.values(s.gear.equipped));
  const slot = GEAR[base.id].slot;
  const ok = (i) => i.uid !== uid && !equippedUids.has(i.uid) && i.rarity === base.rarity
    && (base.rarity >= 4 ? GEAR[i.id].slot === slot : i.id === base.id);
  const pool = s.gear.items.filter(ok).sort((a, b) => a.level - b.level);
  return pool.length >= 2 ? pool.slice(0, 2) : [];
}
export function merge(s, uid) {
  const base = itemByUid(s, uid);
  const fodder = mergeFodder(s, uid);
  if (fodder.length < 2) return false;
  for (const f of fodder) {
    const back = invested(f);
    s.cur.scrap += back.scrap;
    s.cur.dna[GEAR[f.id].slot] += back.dna;
    base.level = Math.max(base.level, f.level);
  }
  const gone = new Set(fodder.map((f) => f.uid));
  s.gear.items = s.gear.items.filter((i) => !gone.has(i.uid));
  base.rarity++;
  return true;
}
// Merges everything that can be merged (up to Legendary), best pieces first.
export function mergeAll(s) {
  let n = 0;
  for (let pass = 0; pass < 50; pass++) {
    const items = [...s.gear.items].filter((i) => i.rarity < 4).sort((a, b) => b.rarity - a.rarity || b.level - a.level);
    const target = items.find((i) => mergeFodder(s, i.uid).length === 2);
    if (!target) break;
    merge(s, target.uid);
    n++;
  }
  return n;
}
// Equips the strongest piece in every empty slot (new players never have to think about it).
export function autoEquip(s) {
  for (const sl of GEAR_SLOTS) {
    if (equippedItem(s, sl.id)) continue;
    const best = s.gear.items.filter((i) => GEAR[i.id].slot === sl.id).sort((a, b) => b.rarity - a.rarity || b.level - a.level)[0];
    if (best) s.gear.equipped[sl.id] = best.uid;
  }
}

// ---------------------------------------------------------------- kaiju
export function kaijuState(s, id) {
  if (!s.kaiju[id]) s.kaiju[id] = { stars: 1, mastery: 0 };
  return s.kaiju[id];
}
export function nextStarCost(s, id) {
  const st = kaijuState(s, id).stars;
  return st >= 5 ? null : STAR_SHARDS[st - 1];
}
export function starUp(s, id) {
  const cost = nextStarCost(s, id);
  if (!s.unlocked[id] || cost === null || (s.cur.shards[id] || 0) < cost) return false;
  s.cur.shards[id] -= cost;
  kaijuState(s, id).stars++;
  return true;
}
export function unlockKaiju(s, id, how = 'shards') {
  if (s.unlocked[id]) return false;
  const meta = KAIJU_META[id];
  if (how === 'gems' && meta.gems) {
    if (!pay(s, { gems: meta.gems })) return false;
  } else if ((s.cur.shards[id] || 0) >= SHARD_UNLOCK) {
    s.cur.shards[id] -= SHARD_UNLOCK;
  } else return false;
  s.unlocked[id] = true;
  return true;
}

// ---------------------------------------------------------------- mutations
export function mutationLevel(s, id) {
  return s.mutations[id] || 0;
}
export function mutationCost(s) {
  const n = s.mutationsBought;
  return { scrap: Math.round(500 * Math.pow(1.12, n)), geneCores: (n + 1) % 10 === 0 ? 1 : 0 };
}
export function mutationOpen(s, m) {
  return s.settings.unlockAll || s.account.level >= MUTATION_ROW_LEVEL[m.row];
}
export function buyMutation(s, id) {
  const m = MUTATIONS.find((x) => x.id === id);
  if (!m || !mutationOpen(s, m) || mutationLevel(s, id) >= m.max) return false;
  const cost = mutationCost(s);
  if (!pay(s, cost)) return false;
  s.mutations[id] = mutationLevel(s, id) + 1;
  s.mutationsBought++;
  return true;
}

// ---------------------------------------------------------------- power and run bonuses
// Everything permanent, summed into the numbers a run needs.
export function loadout(s, kaijuId = s.lastKaiju) {
  const tot = { atk: 0, hp: 0, speed: 0, xp: 0, pickup: 0, dashCd: 0, reroll: 0, revive: 0 };
  const perks = {};
  let fangs = null;
  for (const sl of GEAR_SLOTS) {
    const item = equippedItem(s, sl.id);
    if (!item) continue;
    for (const [k, v] of Object.entries(itemStats(item))) tot[k] = (tot[k] || 0) + v;
    if (sl.id === 'fangs') fangs = { id: item.id, up: item.rarity >= EPIC };
    else if (item.rarity >= EPIC) perks[item.id] = true;
  }
  for (const m of MUTATIONS) for (const [k, v] of Object.entries(m.per)) tot[k] += v * mutationLevel(s, m.id);
  const stars = s.unlocked[kaijuId] ? kaijuState(s, kaijuId).stars : 1;
  const starMul = 1 + STAR_BONUS * (stars - 1);
  return {
    atkMul: (1 + tot.atk / 100) * starMul,
    hpMul: (1 + tot.hp / 100) * starMul,
    speedMul: 1 + tot.speed / 100,
    xpMul: 1 + tot.xp / 100,
    pickupMul: 1 + tot.pickup / 100,
    dashCdMul: 1 - tot.dashCd / 100,
    rerolls: tot.reroll,
    revives: tot.revive,
    perks,
    fangs,
    skin: s.skins.equipped,
    totals: tot,
    stars,
  };
}
export function power(s, kaijuId = s.lastKaiju) {
  const l = loadout(s, kaijuId);
  return Math.round(1000 * Math.sqrt(l.atkMul * l.hpMul) * (1 + (l.speedMul - 1) / 2));
}
export function chapterMul(n) {
  return Math.pow(CHAPTER_MUL, n - 1);
}
export function recommendedPower(n) {
  return Math.round((1000 * chapterMul(n) * 0.9) / 10) * 10;
}

// ---------------------------------------------------------------- runs
export function canStartRun(s, now = Date.now()) {
  syncEnergy(s, now);
  return s.cur.energy >= ECONOMY.energyPerRun;
}

// What a finished run pays. Lost runs still pay, and first-time milestones pay extra, so every
// run moves the account forward.
export function runRewards(s, results, { chapter = 1, mode = 'normal' } = {}, rng = createRng(Date.now())) {
  const stage = results.stage || 1;
  const won = Boolean(results.won);
  const loot = mode === 'nightmare' ? 2.2 : mode === 'hard' ? 1.5 : 1;
  const r = { scrap: 0, gems: 0, dna: {}, xp: 0, passXp: 0, items: [], geneCores: 0, keys: {}, notes: [] };
  r.scrap = Math.round(400 * Math.pow(1.25, chapter - 1) * (0.25 + 0.15 * stage) * (won ? 1.5 : 1) * loot);
  const dnaCount = 4 + stage + (won ? 2 : 0);
  const equippedSlots = GEAR_SLOTS.filter((sl) => equippedItem(s, sl.id)).map((sl) => sl.id);
  for (let i = 0; i < dnaCount; i++) {
    const k = equippedSlots.length && rng.chance(0.6) ? rng.pick(equippedSlots) : rng.pick(GEAR_SLOTS).id;
    r.dna[k] = (r.dna[k] || 0) + 1;
  }
  r.xp = 100 + 40 * stage;
  r.passXp = 20 + 5 * stage;
  if (results.vaultGems) r.gems += results.vaultGems;
  if (results.objectiveDone) r.keys = { supply: 1 };
  // First kills of each size boss in this chapter and mode.
  for (const st of results.gateKills || []) {
    const key = `${chapter}:${mode}:${st}`;
    if (!s.chapter.bossFirsts[key]) {
      r.gems += 20;
      r.firstBosses = (r.firstBosses || 0) + 1;
    }
  }
  // First time reaching sizes 3, 5 and Apex in this chapter: a milestone chest.
  for (const st of [3, 5, 6]) {
    if (stage >= st && !s.chapter.milestones[`${chapter}:${st}`]) {
      r.milestones = [...(r.milestones || []), st];
      r.gems += 20;
      r.scrap += Math.round(300 * Math.pow(1.25, chapter - 1));
      for (let i = 0; i < 3; i++) {
        const k = rng.pick(GEAR_SLOTS).id;
        r.dna[k] = (r.dna[k] || 0) + 1;
      }
    }
  }
  if (won && !s.chapter.cleared[`${chapter}:${mode}`]) {
    r.firstClear = true;
    r.gems += MODES[mode].firstClearGems;
    r.geneCores += 1;
    const ch = CHAPTERS[Math.min(CHAPTERS.length, chapter) - 1];
    const options = GEAR_IDS.filter((id) => GEAR[id].slot === ch.featured);
    r.items.push([rng.pick(options), mode === 'normal' ? 2 : 3]);
  }
  return r;
}

// Books a run: rewards (doubled if an ad was watched), quest progress, unlocks and stats.
export function applyRun(s, results, ctx, rewards, { doubled = false } = {}, now = Date.now()) {
  const { chapter = 1, mode = 'normal' } = ctx;
  const m = doubled ? 2 : 1;
  const dna = Object.fromEntries(Object.entries(rewards.dna).map(([k, v]) => [k, v * m]));
  const out = grant(s, { scrap: rewards.scrap * m, gems: rewards.gems, dna, geneCores: rewards.geneCores, items: rewards.items, xp: rewards.xp, passXp: rewards.passXp * m, keys: rewards.keys });
  for (const st of results.gateKills || []) s.chapter.bossFirsts[`${chapter}:${mode}:${st}`] = true;
  for (const st of rewards.milestones || []) s.chapter.milestones[`${chapter}:${st}`] = true;
  if (results.won) {
    s.wins++;
    s.chapter.cleared[`${chapter}:${mode}`] = true;
    if (mode === 'normal') s.chapter.unlocked = Math.max(s.chapter.unlocked, Math.min(CHAPTERS.length, chapter + 1));
    if (chapter >= 1) s.unlocked.gorilla = true;
  }
  s.runs++;
  s.tutorialDone = true;
  s.lastKaiju = results.kaijuId || s.lastKaiju;
  kaijuState(s, s.lastKaiju).mastery += rewards.xp;
  const st = s.stats;
  st.people += results.people || 0;
  st.buildings += results.buildings || 0;
  st.gateBosses += (results.gateKills || []).length;
  st.bosses += (results.gateKills || []).length + (results.won ? 1 : 0);
  st.bestDamage = Math.max(st.bestDamage, results.scrapRaw || 0);
  const key = `${chapter}:${mode}`;
  if ((results.score || 0) > (s.best[key] || 0)) s.best[key] = results.score;
  trackQuests(s, {
    runs: 1, people: results.people || 0, buildings: results.buildings || 0, gateBosses: (results.gateKills || []).length,
    clears: results.won ? 1 : 0, bosses: (results.gateKills || []).length + (results.won ? 1 : 0), apex: (results.stage || 1) >= 6 ? 1 : 0,
    damage: results.scrapRaw || 0,
  }, now);
  return out;
}

// ---------------------------------------------------------------- quests
export function trackQuests(s, delta, now = Date.now()) {
  rollover(s, now);
  for (const [k, v] of Object.entries(delta)) {
    if (!v) continue;
    s.daily.progress[k] = (s.daily.progress[k] || 0) + v;
    s.weekly.progress[k] = (s.weekly.progress[k] || 0) + v;
  }
}
export function questState(s, q, weekly = false) {
  const book = weekly ? s.weekly : s.daily;
  const have = (book.progress && book.progress[q.stat]) || 0;
  return { have: Math.min(q.goal, have), goal: q.goal, done: have >= q.goal, claimed: Boolean(book.claimed && book.claimed[q.id]) };
}
export function claimQuest(s, id, weekly = false, rng) {
  const list = weekly ? WEEKLY_QUESTS : DAILY_QUESTS;
  const q = list.find((x) => x.id === id);
  const book = weekly ? s.weekly : s.daily;
  if (!q || !questState(s, q, weekly).done || book.claimed[id]) return null;
  book.claimed[id] = true;
  return grant(s, weekly ? WEEKLY_QUEST_REWARD : DAILY_QUEST_REWARD, rng);
}
// A bonus for finishing the whole list: a Supply Crate key daily, a Kaiju Egg key weekly.
export function claimQuestBonus(s, weekly = false, rng) {
  const list = weekly ? WEEKLY_QUESTS : DAILY_QUESTS;
  const book = weekly ? s.weekly : s.daily;
  if (book.bonus || !list.every((q) => book.claimed[q.id])) return null;
  book.bonus = true;
  return grant(s, { keys: weekly ? { egg: 1 } : { supply: 1 } }, rng);
}
export function questsWaiting(s) {
  let n = 0;
  for (const q of DAILY_QUESTS) {
    const st = questState(s, q);
    if (st.done && !st.claimed) n++;
  }
  for (const q of WEEKLY_QUESTS) {
    const st = questState(s, q, true);
    if (st.done && !st.claimed) n++;
  }
  return n;
}

// ---------------------------------------------------------------- login calendar
export function loginReady(s, now = Date.now()) {
  return s.login.last !== dayKey(now);
}
export function claimLogin(s, now = Date.now(), rng) {
  if (!loginReady(s, now)) return null;
  const reward = LOGIN_REWARDS[s.login.index % LOGIN_REWARDS.length];
  s.login.index++;
  s.login.last = dayKey(now);
  return grant(s, reward, rng);
}

// ---------------------------------------------------------------- Rampage Pass
export function passTier(s) {
  return Math.min(PASS.tiers, Math.floor(s.pass.xp / PASS.xpPerTier));
}
export function addPassXp(s, xp) {
  s.pass.xp = Math.min(PASS.tiers * PASS.xpPerTier, s.pass.xp + xp);
}
export function passReward(tier, premium) {
  if (premium) {
    if (tier === 30) return { gems: 500, skin: 'zombie' };
    if (tier % 5 === 0) return { gems: 100, keys: { egg: 1 } };
    return { gems: 100 };
  }
  if (tier % 10 === 0) return { keys: { egg: 1 } };
  if (tier % 5 === 0) return { gems: 50 };
  if (tier % 3 === 0) return { keys: { supply: 1 } };
  if (tier % 2 === 0) return { dnaAny: 6 };
  return { scrap: 800 };
}
// The bonus track pays a tier at a time for a rewarded ad, which the hub plays first.
// A bonus (premium) reward costs an ad, or a few gems where ads can't be shown (how = 'gems').
export function claimPass(s, tier, premium, rng, now = Date.now(), how = 'ad') {
  if (tier > passTier(s) || tier < 1) return null;
  const book = premium ? s.pass.prem : s.pass.free;
  if (book[tier]) return null;
  if (premium && !(how === 'gems' ? pay(s, { gems: ECONOMY.passBonusGems }) : useAd(s, 'pass', now))) return null;
  book[tier] = true;
  return grant(s, passReward(tier, premium), rng);
}
export function passWaiting(s) {
  let n = 0;
  for (let t = 1; t <= passTier(s); t++) {
    if (!s.pass.free[t]) n++;
    if (!s.pass.prem[t]) n++;
  }
  return n;
}
export function passEndsIn(s, now = Date.now()) {
  const end = s.created + s.pass.season * PASS.seasonDays * DAY;
  return Math.max(0, end - now);
}

// ---------------------------------------------------------------- Patrol
export function bestChapter(s) {
  let best = 0;
  for (const key of Object.keys(s.chapter.cleared)) best = Math.max(best, Number(key.split(':')[0]));
  return best;
}
export function patrolRate(s, now = Date.now()) {
  return {
    scrap: 300 + 60 * bestChapter(s),
    dna: 1,
    xp: 20,
  };
}
export function patrolPending(s, now = Date.now()) {
  const hours = Math.min(ECONOMY.patrolCapHours, Math.max(0, (now - s.patrol.since) / HOUR));
  const rate = patrolRate(s, now);
  return { hours, scrap: Math.floor(hours * rate.scrap), dna: Math.floor(hours * rate.dna), xp: Math.floor(hours * rate.xp), full: hours >= ECONOMY.patrolCapHours };
}
export function claimPatrol(s, now = Date.now(), rng) {
  const p = patrolPending(s, now);
  if (p.scrap <= 0 && p.dna <= 0) return null;
  s.patrol.since = now;
  return grant(s, { scrap: p.scrap, dnaAny: p.dna, xp: p.xp }, rng);
}
// Two hours of Patrol at once: for energy (3 a day) or by ad (1 a day).
export function quickPatrol(s, how, now = Date.now(), rng) {
  rollover(s, now);
  if (how === 'energy') {
    if (s.daily.quickPatrols >= ECONOMY.quickPatrolPerDay || !spendEnergy(s, ECONOMY.quickPatrolEnergy, now)) return null;
    s.daily.quickPatrols++;
  } else if (how === 'ad') {
    if (!useAd(s, 'patrol', now)) return null;
  } else return null;
  const rate = patrolRate(s, now);
  const h = ECONOMY.quickPatrolHours;
  return grant(s, { scrap: Math.floor(h * rate.scrap), dnaAny: h * rate.dna, xp: h * rate.xp }, rng);
}

// ---------------------------------------------------------------- rewarded ads
export function adsLeft(s, id, now = Date.now()) {
  rollover(s, now);
  const p = AD_PLACEMENTS[id];
  const book = p.weekly ? s.weekly.ads : s.daily.ads;
  return Math.max(0, p.cap - (book[id] || 0));
}
// Seconds until placement `id` can be watched again (its cooldown since the last one); 0 when ready.
export function adWait(s, id, now = Date.now()) {
  rollover(s, now);
  const p = AD_PLACEMENTS[id];
  const at = s.daily.adAt && s.daily.adAt[id];
  if (!p.cooldown || !at) return 0;
  return Math.max(0, Math.ceil(p.cooldown - (now - at) / 1000));
}
export function useAd(s, id, now = Date.now()) {
  if (adsLeft(s, id, now) <= 0 || adWait(s, id, now) > 0) return false;
  const book = AD_PLACEMENTS[id].weekly ? s.weekly.ads : s.daily.ads;
  book[id] = (book[id] || 0) + 1;
  if (AD_PLACEMENTS[id].cooldown) (s.daily.adAt ||= {})[id] = now;
  return true;
}
export function adEnergy(s, now = Date.now()) {
  if (!useAd(s, 'energy', now)) return null;
  return grant(s, { energy: ECONOMY.energyAd });
}
export function adGems(s, now = Date.now()) {
  if (!useAd(s, 'gems', now)) return null;
  return grant(s, { gems: ECONOMY.adGems });
}
export function buyEnergy(s, now = Date.now()) {
  rollover(s, now);
  const p = ECONOMY.energyGemPack;
  if (s.daily.energyBuys >= p.perDay || !pay(s, { gems: p.gems })) return null;
  s.daily.energyBuys++;
  return grant(s, { energy: p.energy });
}

// ---------------------------------------------------------------- Lucky Wheel
// One spin costs an ad, or a few gems where ads can't be shown; five spins a day either way.
export function spinWheel(s, now = Date.now(), rng = createRng(now), how = 'ad') {
  if (how === 'gems') {
    if (adsLeft(s, 'wheel', now) <= 0 || !pay(s, { gems: ECONOMY.wheelGems })) return null;
    s.daily.ads.wheel = (s.daily.ads.wheel || 0) + 1;
  } else if (!useAd(s, 'wheel', now)) return null;
  const idx = Number(rng.weighted(Object.fromEntries(WHEEL.map((w, i) => [i, w.weight]))));
  return { index: idx, reward: grant(s, WHEEL[idx].reward, rng) };
}

// ---------------------------------------------------------------- crates
function rollRarity(weights, rng) {
  return Number(rng.weighted(weights));
}
// Opens `count` crates paid by `how` ('gems', 'key', 'ad', 'free'). Returns the drops, or null
// if it can't be paid.
export function openCrate(s, id, how = 'gems', count = 1, now = Date.now(), rng = createRng(now)) {
  const c = CRATES[id];
  if (!c) return null;
  rollover(s, now);
  if (how === 'gems') {
    const cost = count === 10 && c.ten ? c.ten : c.gems * count;
    if (!pay(s, { gems: cost })) return null;
  } else if (how === 'key') {
    if ((s.cur.keys[id] || 0) < count) return null;
    s.cur.keys[id] -= count;
  } else if (how === 'ad') {
    if (count !== 1 || !useAd(s, id === 'egg' ? 'egg' : 'crate', now)) return null;
  } else if (how === 'free') {
    if (count !== 1 || s.crates.freeFirst) return null;
    s.crates.freeFirst = true;
  } else return null;
  const drops = [];
  for (let n = 0; n < count; n++) {
    let rarity = rollRarity(c.rarity, rng);
    if (id === 'supply') {
      if (s.crates.supplySince >= c.pity.every - 1) rarity = Math.max(rarity, c.pity.rarity);
      s.crates.supplySince = rarity >= c.pity.rarity ? 0 : s.crates.supplySince + 1;
    } else {
      if (s.crates.eggSinceLeg >= c.legendary - 1) rarity = 4;
      if (s.crates.eggSince >= c.pity.every - 1) rarity = Math.max(rarity, c.pity.rarity);
      s.crates.eggSince = rarity >= c.pity.rarity ? 0 : s.crates.eggSince + 1;
      s.crates.eggSinceLeg = rarity >= 4 ? 0 : s.crates.eggSinceLeg + 1;
    }
    const item = addItem(s, rng.pick(GEAR_IDS), rarity);
    const drop = { item };
    if (id === 'supply') {
      drop.extra = grant(s, { dnaAny: rng.int(2, 4), scrap: rng.int(150, 300) }, rng);
    } else {
      const pool = Object.keys(KAIJU_META).filter((k) => KAIJU_META[k].unlock !== 'free');
      const who = rng.pick(pool);
      drop.extra = grant(s, { shards: { [who]: rng.int(1, 3) } }, rng);
    }
    drops.push(drop);
  }
  s.stats.crates = (s.stats.crates || 0) + count;
  trackQuests(s, { crates: count }, now);
  return drops;
}
export function pityLeft(s, id) {
  const c = CRATES[id];
  if (id === 'supply') return { rare: c.pity.every - s.crates.supplySince };
  return { epic: c.pity.every - s.crates.eggSince, legendary: c.legendary - s.crates.eggSinceLeg };
}
// Published odds for the crate panel, as percentages.
export function crateOdds(id) {
  const c = CRATES[id];
  const total = Object.values(c.rarity).reduce((a, b) => a + b, 0);
  return Object.entries(c.rarity).map(([r, w]) => ({ rarity: RARITY[Number(r)], pct: (100 * w) / total }));
}

// ---------------------------------------------------------------- daily deals
export function buyDeal(s, i, now = Date.now(), rng) {
  rollover(s, now);
  const d = s.daily.deals[i];
  if (!d || s.daily.dealsBought[i]) return null;
  if (d.cost.ad) {
    if (!useAd(s, 'deal', now)) return null;
  } else if (!pay(s, d.cost)) return null;
  s.daily.dealsBought[i] = true;
  return grant(s, d.give, rng);
}

// ---------------------------------------------------------------- skins
export function buySkin(s, id) {
  const sk = SKINS[id];
  if (!sk || s.skins.owned[id] || !sk.gems || !pay(s, { gems: sk.gems })) return false;
  s.skins.owned[id] = true;
  return true;
}

// Badges for the hub: how many things are waiting to be collected.
export function notifications(s, now = Date.now()) {
  rollover(s, now);
  return {
    quests: featureOpen(s, 'quests') ? questsWaiting(s) : 0,
    login: loginReady(s, now) ? 1 : 0,
    pass: featureOpen(s, 'pass') ? passWaiting(s) : 0,
    patrol: featureOpen(s, 'patrol') && patrolPending(s, now).hours >= 1 ? 1 : 0,
    wheel: featureOpen(s, 'wheel') ? adsLeft(s, 'wheel', now) : 0,
    freeCrate: adsLeft(s, 'crate', now) + (s.crates.freeFirst ? 0 : 1) + (s.cur.keys.supply || 0) + (s.cur.keys.egg || 0),
  };
}
