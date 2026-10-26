// Augments, Vampire Survivors style. Every level-up offers 3 choices: a new augment or the
// next level of one you hold. You can hold 6 moves and 6 passives.
//  - move:    an attack on its own cooldown. Levels 1-8; each level is a stat bump or a
//             signature upgrade (strike twice, split into 3, cyclone...).
//  - passive: levels 1-5. Stat passives scale one global stat; perks add a mechanic.
//  - evolution: a maxed move plus the right passive unlocks its evolution, offered at the next
//               level-up (Vampire Survivors style). Evolutions take no slot.
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
  { id: 'lightningBreath', kind: 'move', name: 'Lightning Breath', tier: 'gold', text: 'Lightning arcs through metal', cd: 3.5, count: 3, unit: 'jumps',
    levels: [up({ dmg: 0.3 }), up({ count: 2 }, 'Chains further'), up({ cd: -0.2 }), up({ dmg: 0.3 }), up({ fork: true }, 'Every bolt forks'), up({ count: 2 }), up({ dmg: 0.5 })] },
  { id: 'buildingHurl', kind: 'move', name: 'Building Hurl', tier: 'prismatic', text: 'Throw a building at a squad', cd: 7, count: 1, unit: 'buildings',
    levels: [up({ dmg: 0.3 }), up({ area: 0.3 }), up({ cd: -0.2 }), up({ count: 1 }, 'Throws two'), up({ dmg: 0.4 }), up({ quake: true }, 'Landing shockwave'), up({ count: 1 })] },
  { id: 'acidSpit', kind: 'move', name: 'Acid Spit', tier: 'silver', text: 'Globs leave melting puddles', cd: 3.5, count: 1, unit: 'globs',
    levels: [up({ count: 1 }), up({ dmg: 0.3 }), up({ area: 0.4 }, 'Bigger puddles'), up({ cd: -0.2 }), up({ count: 1 }), up({ duration: 0.5 }), up({ splash: true }, 'Globs splash in 3')] },
  { id: 'iceBreath', kind: 'move', name: 'Ice Breath', tier: 'gold', text: 'Freeze foes; frozen ones shatter', cd: 7,
    levels: [up({ area: 0.3 }), up({ duration: 0.4 }), up({ cd: -0.2 }), up({ dmg: 0.4 }), up({ nova: true }, 'Frost nova all around'), up({ area: 0.3 }), up({ duration: 0.6 }, 'Freeze lasts much longer')] },
  { id: 'vortexBelch', kind: 'move', name: 'Vortex Belch', tier: 'gold', text: 'A whirlwind drags units in', cd: 9, count: 1, unit: 'vortexes',
    levels: [up({ area: 0.3 }), up({ duration: 0.4 }), up({ cd: -0.2 }), up({ dmg: 0.4 }), up({ count: 1 }, 'Two vortexes'), up({ area: 0.3 }), up({ implode: true }, 'Ends in a blast')] },
  { id: 'orbitingSpines', kind: 'move', name: 'Orbiting Spines', tier: 'silver', text: 'Spines circle and shred', cd: 1, count: 2, unit: 'spines',
    levels: [up({ count: 1 }), up({ dmg: 0.3 }), up({ area: 0.3 }), up({ count: 1 }), up({ speed: 0.5 }, 'Spin faster'), up({ dmg: 0.4 }), up({ count: 2 })] },
  { id: 'magneticRoar', kind: 'move', name: 'Magnetic Roar', tier: 'silver', text: 'Yank vehicles into a heap', cd: 8,
    levels: [up({ area: 0.3 }), up({ dmg: 0.3 }), up({ cd: -0.2 }), up({ blast: true }, 'The heap explodes'), up({ area: 0.3 }), up({ dmg: 0.4 }), up({ heavy: true }, 'Pulls tanks and mechs too')] },
  { id: 'frenzyBite', kind: 'move', name: 'Frenzy Bite', tier: 'silver', text: 'Bite flurry on the toughest foe', cd: 3, count: 3, unit: 'bites',
    levels: [up({ count: 1 }), up({ dmg: 0.3 }), up({ cd: -0.2 }), up({ count: 1 }), up({ crit: true }, 'Last bite crits'), up({ dmg: 0.4 }), up({ count: 2 })] },
  { id: 'broodCall', kind: 'move', name: 'Brood Call', tier: 'prismatic', text: 'Hatchlings swarm your enemies', cd: 12, count: 3, unit: 'hatchlings',
    levels: [up({ count: 1 }), up({ dmg: 0.3 }), up({ duration: 0.4 }), up({ count: 1 }), up({ cd: -0.2 }), up({ boom: true }, 'Hatchlings burst on death'), up({ count: 2 })] },

  // ---- stat passives
  { id: 'might', kind: 'passive', name: 'Might', tier: 'silver', max: 5, text: '+10% damage', stat: true },
  { id: 'area', kind: 'passive', name: 'Kaiju-Sized', tier: 'silver', max: 5, text: '+10% move area', stat: true },
  { id: 'adrenaline', kind: 'passive', name: 'Adrenaline', tier: 'silver', max: 5, text: '-8% move cooldowns', stat: true },
  { id: 'longLegs', kind: 'passive', name: 'Long Legs', tier: 'silver', max: 5, text: '+8% move speed', stat: true },
  { id: 'toughness', kind: 'passive', name: 'Toughness', tier: 'silver', max: 5, text: '+15% max health', stat: true },
  { id: 'appetite', kind: 'passive', name: 'Appetite', tier: 'silver', max: 5, text: '+10% XP', stat: true },
  { id: 'scavenger', kind: 'passive', name: 'Scavenger', tier: 'silver', max: 5, text: '+20% scrap', stat: true },
  { id: 'thickHide', kind: 'passive', name: 'Thick Hide', tier: 'silver', max: 5, text: '-8% bullet & shell damage', stat: true },
  { id: 'glassCannon', kind: 'passive', name: 'Glass Cannon', tier: 'gold', max: 5, text: '+10% damage, -6% max health', stat: true },
  { id: 'momentum', kind: 'passive', name: 'Momentum', tier: 'silver', max: 5, text: 'Keep moving: up to +8% damage', stat: true },
  { id: 'spikedHide', kind: 'passive', name: 'Spiked Hide', tier: 'silver', max: 5, text: 'Melee attackers take damage', stat: true },
  { id: 'bigBones', kind: 'passive', name: 'Big Bones', tier: 'silver', max: 5, text: '+12% crush radius', stat: true },
  { id: 'ironStomach', kind: 'passive', name: 'Iron Stomach', tier: 'silver', max: 5, text: '+25% XP from eating', stat: true },
  { id: 'magnetJaws', kind: 'passive', name: 'Magnet Jaws', tier: 'silver', max: 5, text: '+40% orb pickup range', stat: true },
  { id: 'steadyFooting', kind: 'passive', name: 'Steady Footing', tier: 'silver', max: 5, text: 'Nets & sedation end 25% faster', stat: true },
  { id: 'overclock', kind: 'passive', name: 'Overclock', tier: 'gold', max: 5, text: '+15% cooldown speed when hurt', stat: true },

  // ---- perk passives
  { id: 'gasMain', kind: 'passive', name: 'Gas Main', tier: 'gold', max: 3, text: '20% of buildings explode', levelText: '+10% explode chance' },
  { id: 'magneticHide', kind: 'passive', name: 'Magnetic Hide', tier: 'gold', max: 3, text: 'Wreckage becomes a shield', levelText: 'Shield builds faster' },
  { id: 'rageMode', kind: 'passive', name: 'Rage Mode', tier: 'gold', max: 3, text: 'Up to +40% damage when hurt', levelText: '+20% max rage' },
  { id: 'echo', kind: 'passive', name: 'Echo', tier: 'prismatic', max: 3, text: '30% of moves repeat', levelText: '+30% repeat chance' },
  { id: 'perfectRhythm', kind: 'passive', name: 'Perfect Rhythm', tier: 'gold', max: 3, text: 'Perfect dodges blast a shockwave', levelText: '+25% shockwave size' },
  { id: 'bloodlust', kind: 'passive', name: 'Bloodlust', tier: 'gold', max: 3, text: 'Kills cut cooldowns by 0.08 s', levelText: '+0.08 s per kill' },
  { id: 'powerSurge', kind: 'passive', name: 'Power Surge', tier: 'silver', max: 3, text: 'Downed power lines electrify', levelText: '+50% shock damage' },

  // ---- evolutions: a maxed move plus its partner passive
  { id: 'omegaBeam', kind: 'evolution', name: 'Omega Beam', tier: 'prismatic', max: 1, move: 'laserEyes', passive: 'might', text: 'Laser Eyes leave a burning scar' },
  { id: 'cycloneKing', kind: 'evolution', name: 'Cyclone King', tier: 'prismatic', max: 1, move: 'tailSpin', passive: 'longLegs', text: 'Become a moving tornado' },
  { id: 'spineStorm', kind: 'evolution', name: 'Spine Storm', tier: 'prismatic', max: 1, move: 'spineMissiles', passive: 'echo', text: 'A constant rain of spines' },
  { id: 'meltdown', kind: 'evolution', name: 'Meltdown', tier: 'prismatic', max: 1, move: 'atomicBreath', passive: 'rageMode', text: 'Hurt: breath ends in a blast' },
  { id: 'extinctionEvent', kind: 'evolution', name: 'Extinction Event', tier: 'prismatic', max: 1, move: 'meteorCall', passive: 'area', text: 'A meteor shower follows you' },
  { id: 'earthbreaker', kind: 'evolution', name: 'Earthbreaker', tier: 'prismatic', max: 1, move: 'seismicSlam', passive: 'toughness', text: 'Slams split squad-eating chasms' },
  { id: 'junkyardStorm', kind: 'evolution', name: 'Junkyard Storm', tier: 'prismatic', max: 1, move: 'carToss', passive: 'magneticHide', text: 'Cars orbit you, then fire out' },
  { id: 'doomRoar', kind: 'evolution', name: 'Doom Roar', tier: 'prismatic', max: 1, move: 'roar', passive: 'adrenaline', text: 'Roar flattens everything smaller' },
];

export const AUGMENT_BY_ID = Object.fromEntries(AUGMENTS.map((a) => [a.id, a]));
export const MOVES = AUGMENTS.filter((a) => a.kind === 'move');
export const PASSIVES = AUGMENTS.filter((a) => a.kind === 'passive');
export const EVOLUTIONS = AUGMENTS.filter((a) => a.kind === 'evolution');

// Evolutions whose move is maxed and whose partner passive is held, not yet taken.
export function readyEvolutions(held) {
  return EVOLUTIONS.filter((e) => !held.has(e.id) && held.get(e.move) >= maxLevel(AUGMENT_BY_ID[e.move]) && held.has(e.passive));
}

// The evolution an augment belongs to: as its move, its partner passive, or itself.
export function evolutionFor(id) {
  return EVOLUTIONS.find((e) => e.id === id || e.move === id || e.passive === id) || null;
}

// Where a recipe stands, optionally as if `pickId` were taken too.
export function recipeState(held, e, pickId = null) {
  const max = maxLevel(AUGMENT_BY_ID[e.move]);
  const level = Math.min(max, (held.get(e.move) || 0) + (pickId === e.move ? 1 : 0));
  const passive = held.has(e.passive) || pickId === e.passive;
  const done = held.has(e.id) || pickId === e.id;
  return { level, max, passive, done, ready: !done && level >= max && passive };
}

// When everything is maxed, picks fall back to these (Vampire Survivors' chicken and coins).
export const FILLERS = [
  { id: 'growthSpurt', kind: 'filler', name: 'Growth Spurt', tier: 'silver', text: '+15% growth' },
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
  if (a.kind === 'evolution') return a.text;
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
  const s = { dmg: 1, area: 1, cd: 1, count: a.count || 1, length: 1, width: 1, duration: 1, spins: 1, bounce: 0, aftershock: 0, fear: 3, speed: 1 };
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
  { id: 'unkillable', name: 'Unkillable', augments: ['toughness', 'magneticHide', 'thickHide'],
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
  if (a.kind === 'evolution') return readyEvolutions(held).includes(a);
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
  // A ready evolution always shows up.
  for (const e of readyEvolutions(held)) if (offer.length < count && !offer.includes(e.id) && !exclude.includes(e.id)) offer.push(e.id);
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
