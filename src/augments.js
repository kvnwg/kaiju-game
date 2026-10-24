// Augments, Vampire Survivors style. Every level-up offers 3 choices: a new augment or the
// next level of one you hold. You can hold 6 moves and 6 passives.
//  - move:    an attack on its own cooldown. Levels 1-8; each level is a stat bump or a
//             signature upgrade (strike twice, split into 3, cyclone...).
//  - passive: levels 1-5. Stat passives scale one global stat; perks add a mechanic.
// Rarity (common / rare / epic, styled silver / gold / prismatic) sets how often it is offered.

export const MOVE_SLOTS = 6;
export const PASSIVE_SLOTS = 6;
export const TIER_ORDER = ['silver', 'gold', 'prismatic'];
const WEIGHT = { silver: 1, gold: 0.65, prismatic: 0.35 };

// Level tables for moves: the upgrade applied when reaching levels 2..8.
// Numbers are relative (dmg: 0.3 = +30% damage, cd: -0.2 = 20% faster); `text` overrides the
// generated description for signature upgrades.
const up = (o, text) => ({ ...o, text });

export const AUGMENTS = [
  // ---- moves
  { id: 'clawStrike', kind: 'move', name: 'Claw Strike', tier: 'silver', text: 'Rake what’s in front of you', cd: 2.2,
    levels: [up({ dmg: 0.3 }), up({ twice: true }, 'Strikes twice'), up({ area: 0.4 }), up({ cd: -0.2 }), up({ molten: true }, 'Claw marks burn'), up({ dmg: 0.4 }), up({ full: true }, 'Full-circle sweep')] },
  { id: 'tailSpin', kind: 'move', name: 'Tail Spin', tier: 'silver', text: 'Spin and smash everything near', cd: 6,
    levels: [up({ area: 0.3 }), up({ spins: 1 }, 'Spins twice'), up({ cd: -0.2 }), up({ dmg: 0.4 }), up({ cyclone: true }, 'Becomes a cyclone'), up({ area: 0.3 }), up({ dmg: 0.5, duration: 0.5 }, 'Longer, harder cyclone')] },
  { id: 'spineMissiles', kind: 'move', name: 'Spine Missiles', tier: 'silver', text: 'Homing spines from your back', cd: 5, count: 4, unit: 'spines',
    levels: [up({ count: 2 }), up({ dmg: 0.3 }), up({ cd: -0.2 }), up({ cluster: true }, 'Spines split in 3'), up({ count: 2 }), up({ dmg: 0.4 }), up({ count: 4 })] },
  { id: 'carToss', kind: 'move', name: 'Car Toss', tier: 'silver', text: 'Hurl a car at a threat', cd: 3.5, count: 1, unit: 'cars',
    levels: [up({ count: 1 }), up({ dmg: 0.3 }), up({ bounce: 1 }, 'Cars bounce once'), up({ cd: -0.2 }), up({ count: 1 }), up({ bounce: 1 }, 'Cars bounce twice'), up({ area: 0.5, dmg: 0.3 })] },
  { id: 'roar', kind: 'move', name: 'Roar', tier: 'silver', text: 'Scare soldiers, shatter glass', cd: 9,
    levels: [up({ cd: -0.2 }), up({ area: 0.3 }), up({ sonic: true }, 'Blast wave flattens'), up({ dmg: 0.5 }), up({ cd: -0.2 }), up({ area: 0.3 }), up({ dmg: 1, fear: 2 }, 'Terrifying')] },
  { id: 'laserEyes', kind: 'move', name: 'Laser Eyes', tier: 'gold', text: 'Twin eye beams sweep ahead', cd: 6,
    levels: [up({ dmg: 0.3 }), up({ length: 0.4 }), up({ sweepBack: true }, 'Sweeps back again'), up({ split: true }, 'Each beam splits in 3'), up({ cd: -0.2 }), up({ width: 0.5 }), up({ dmg: 0.5 })] },
  { id: 'seismicSlam', kind: 'move', name: 'Seismic Slam', tier: 'gold', text: 'Leap and slam a shockwave', cd: 8,
    levels: [up({ area: 0.25 }), up({ aftershock: 1 }, 'Adds an aftershock'), up({ cd: -0.2 }), up({ faults: true }, 'Cracks race outward'), up({ dmg: 0.4 }), up({ area: 0.25 }), up({ aftershock: 1 }, 'Second aftershock')] },
  { id: 'atomicBreath', kind: 'move', name: 'Atomic Breath', tier: 'gold', text: 'Charge, then breathe a beam', cd: 9,
    levels: [up({ dmg: 0.3 }), up({ duration: 0.5 }), up({ napalm: true }, 'Leaves fire behind'), up({ length: 0.3 }), up({ cd: -0.2 }), up({ duration: 0.5 }), up({ dmg: 0.5, width: 0.5 })] },
  { id: 'meteorCall', kind: 'move', name: 'Meteor Call', tier: 'prismatic', text: 'Meteor on the biggest building', cd: 18, count: 1, unit: 'meteors',
    levels: [up({ cd: -0.15 }), up({ count: 2 }), up({ area: 0.4 }), up({ count: 2 }), up({ cd: -0.2 }), up({ dmg: 0.4 }), up({ count: 4 })] },

  // ---- stat passives
  { id: 'might', kind: 'passive', name: 'Might', tier: 'silver', max: 5, text: '+10% damage', stat: true },
  { id: 'area', kind: 'passive', name: 'Kaiju-Sized', tier: 'silver', max: 5, text: '+10% move area', stat: true },
  { id: 'adrenaline', kind: 'passive', name: 'Adrenaline', tier: 'silver', max: 5, text: '-8% move cooldowns', stat: true },
  { id: 'longLegs', kind: 'passive', name: 'Long Legs', tier: 'silver', max: 5, text: '+8% move speed', stat: true },
  { id: 'toughness', kind: 'passive', name: 'Toughness', tier: 'silver', max: 5, text: '+15% max health', stat: true },
  { id: 'regen', kind: 'passive', name: 'Regeneration', tier: 'silver', max: 5, text: 'Heal 0.3% health/s', stat: true },
  { id: 'appetite', kind: 'passive', name: 'Appetite', tier: 'silver', max: 5, text: '+10% XP', stat: true },
  { id: 'scavenger', kind: 'passive', name: 'Scavenger', tier: 'silver', max: 5, text: '+20% scrap', stat: true },
  { id: 'thickHide', kind: 'passive', name: 'Thick Hide', tier: 'silver', max: 5, text: '-8% bullet & shell damage', stat: true },

  // ---- perk passives
  { id: 'gasMain', kind: 'passive', name: 'Gas Main', tier: 'gold', max: 3, text: '20% of buildings explode', levelText: '+10% explode chance' },
  { id: 'buildingEater', kind: 'passive', name: 'Building Eater', tier: 'gold', max: 3, text: 'Big buildings heal 1.5%', levelText: '+0.5% heal per building' },
  { id: 'magneticHide', kind: 'passive', name: 'Magnetic Hide', tier: 'gold', max: 3, text: 'Wreckage becomes a shield', levelText: '+50% shield gain' },
  { id: 'snackAttack', kind: 'passive', name: 'Snack Attack', tier: 'silver', max: 3, text: 'Vehicles heal 1%', levelText: '+0.5% heal per vehicle' },
  { id: 'rageMode', kind: 'passive', name: 'Rage Mode', tier: 'gold', max: 3, text: 'Up to +40% damage when hurt', levelText: '+20% max rage' },
  { id: 'echo', kind: 'passive', name: 'Echo', tier: 'prismatic', max: 3, text: '30% of moves repeat', levelText: '+30% repeat chance' },
];

export const AUGMENT_BY_ID = Object.fromEntries(AUGMENTS.map((a) => [a.id, a]));
export const MOVES = AUGMENTS.filter((a) => a.kind === 'move');
export const PASSIVES = AUGMENTS.filter((a) => a.kind === 'passive');

// When everything is maxed, picks fall back to these (Vampire Survivors' chicken and coins).
export const FILLERS = [
  { id: 'feast', kind: 'filler', name: 'Feast', tier: 'silver', text: 'Heal 30% health' },
  { id: 'scrapPile', kind: 'filler', name: 'Scrap Pile', tier: 'silver', text: '+scrap' },
];
for (const f of FILLERS) AUGMENT_BY_ID[f.id] = f;

export function maxLevel(a) {
  if (a.kind === 'move') return a.levels.length + 1;
  return a.max || 1;
}

// Short text for what the next level gives.
export function levelText(id, level) {
  const a = AUGMENT_BY_ID[id];
  if (!level) return a.text;
  if (a.kind === 'passive') return a.stat ? a.text : a.levelText;
  const u = a.levels[level - 1];
  if (!u) return '';
  if (u.text) return u.text;
  const parts = [];
  if (u.dmg) parts.push(`+${Math.round(u.dmg * 100)}% damage`);
  if (u.area) parts.push(`+${Math.round(u.area * 100)}% area`);
  if (u.cd) parts.push(`${Math.round(u.cd * 100)}% cooldown`);
  if (u.count) parts.push(`+${u.count} ${a.unit || ''}`.trim());
  if (u.length) parts.push(`+${Math.round(u.length * 100)}% reach`);
  if (u.width) parts.push(`+${Math.round(u.width * 100)}% width`);
  if (u.duration) parts.push(`+${Math.round(u.duration * 100)}% duration`);
  return parts.join(', ');
}

// Effective stats of a move at a level: base values with every upgrade up to that level.
export function moveStats(id, level) {
  const a = AUGMENT_BY_ID[id];
  const s = { dmg: 1, area: 1, cd: 1, count: a.count || 1, length: 1, width: 1, duration: 1, spins: 1, bounce: 0, aftershock: 0, fear: 3 };
  for (let i = 0; i < level - 1 && i < a.levels.length; i++) {
    const u = a.levels[i];
    for (const [k, v] of Object.entries(u)) {
      if (k === 'text') continue;
      if (typeof v === 'boolean') s[k] = v;
      else if (k === 'count' || k === 'spins' || k === 'bounce' || k === 'aftershock' || k === 'fear') s[k] += v;
      else s[k] += v;
    }
  }
  return s;
}

export const SYNERGY_SETS = [
  { id: 'demolition', name: 'Demolition Crew', augments: ['gasMain', 'seismicSlam', 'meteorCall'],
    bonus: 'Chain collapses also give XP and growth' },
  { id: 'unkillable', name: 'Unkillable', augments: ['buildingEater', 'magneticHide', 'thickHide'],
    bonus: 'Shield regenerates while standing still' },
];

export function setsFor(augmentId) {
  return SYNERGY_SETS.filter((s) => s.augments.includes(augmentId));
}

export function completedSets(held) {
  return SYNERGY_SETS.filter((s) => s.augments.every((id) => held.has(id)));
}

export function movesHeld(held) {
  return MOVES.filter((m) => held.has(m.id)).length;
}

export function passivesHeld(held) {
  return PASSIVES.filter((p) => held.has(p.id)).length;
}

function isOfferable(a, held) {
  const lvl = held.get(a.id) || 0;
  if (lvl >= maxLevel(a)) return false;
  if (lvl > 0) return true;
  // New augments need a free slot.
  return a.kind === 'move' ? movesHeld(held) < MOVE_SLOTS : passivesHeld(held) < PASSIVE_SLOTS;
}

function weightedPick(pool, held, rng) {
  // Upgrades of what you hold come up a little more often, so builds snowball.
  const w = pool.map((a) => WEIGHT[a.tier] * (held.has(a.id) ? 1.4 : 1));
  let r = rng.next() * w.reduce((s, x) => s + x, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= w[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Offers `count` options. With no move yet, the offer leans on moves (at least two) so the
// first pick gives you an attack. Falls back to fillers when everything is maxed.
export function offerAugments({ held, rng, count = 3, exclude = [], guarantee = null }) {
  const offer = [];
  const take = (filter, upTo) => {
    while (offer.length < upTo) {
      const pool = AUGMENTS.filter((a) => filter(a) && isOfferable(a, held) && !offer.includes(a.id) && !exclude.includes(a.id));
      if (!pool.length) return;
      offer.push(weightedPick(pool, held, rng).id);
    }
  };
  if (guarantee && AUGMENT_BY_ID[guarantee] && isOfferable(AUGMENT_BY_ID[guarantee], held)) offer.push(guarantee);
  if (movesHeld(held) === 0) take((a) => a.kind === 'move', 2);
  take(() => true, count);
  // A reroll prefers fresh options, but never offers fewer than `count` if it can help it.
  if (offer.length < count && exclude.length) {
    const ex = exclude;
    exclude = [];
    take(() => true, count);
    exclude = ex;
  }
  for (const f of FILLERS) if (offer.length < count) offer.push(f.id);
  return rng.shuffle(offer);
}

// Returns the new level of the augment.
export function applyPick(held, id) {
  const a = AUGMENT_BY_ID[id];
  if (!a) throw new Error(`Unknown augment ${id}`);
  if (a.kind === 'filler') return 0;
  const level = (held.get(id) || 0) + 1;
  if (level > maxLevel(a)) throw new Error(`${a.name} is already at max level`);
  held.set(id, level);
  return level;
}
