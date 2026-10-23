// Augment pool and pick rules (design doc: Augments).
// The MVP calls for 16 augments (10 silver, 5 gold, 1 prismatic); the doc's sample list
// only names 8 silver, so this prototype ships 14 and leaves 2 silver slots open.

export const TIER_ORDER = ['silver', 'gold', 'prismatic'];

export const AUGMENTS = [
  // Silver
  { id: 'tailShockwave', name: 'Tail Shockwave', tier: 'silver', category: 'Attack', upgradable: true, maxLevel: 3,
    text: 'Every 5th tail swipe sends out a ring that breaks small objects', levelText: 'Ring reaches 30% further' },
  { id: 'heavyStomp', name: 'Heavy Stomp', tier: 'silver', category: 'Attack', upgradable: true, maxLevel: 3,
    text: 'Walking causes small tremors that damage nearby ground units', levelText: 'Tremors deal 50% more damage' },
  { id: 'thickHide', name: 'Thick Hide', tier: 'silver', category: 'Defense', upgradable: true, maxLevel: 3,
    text: 'Take 15% less damage from bullets and shells', levelText: 'A further 10% less bullet and shell damage' },
  { id: 'snackAttack', name: 'Snack Attack', tier: 'silver', category: 'Sustain',
    text: 'Eating vehicles heals 3% max health' },
  { id: 'scavenger', name: 'Scavenger', tier: 'silver', category: 'Economy',
    text: 'Destroyed objects drop 20% more scrap' },
  { id: 'quickGrowth', name: 'Quick Growth', tier: 'silver', category: 'Growth',
    text: 'Gain 15% more biomass' },
  { id: 'debrisToss', name: 'Debris Toss', tier: 'silver', category: 'Attack',
    text: 'Grab rubble and throw it at the nearest enemy every 4 seconds' },
  { id: 'roar', name: 'Roar', tier: 'silver', category: 'Control',
    text: 'Every 10 seconds, nearby infantry flee and stop shooting for 3 seconds' },
  // Gold
  { id: 'atomicBreath', name: 'Atomic Breath', tier: 'gold', category: 'Attack',
    text: 'A beam that cuts through a full row of buildings every 8 seconds' },
  { id: 'dominoEffect', name: 'Domino Effect', tier: 'gold', category: 'Destruction',
    text: 'Collapsing buildings fall onto and damage neighbours' },
  { id: 'buildingEater', name: 'Building Eater', tier: 'gold', category: 'Sustain',
    text: 'Destroying a building heals 5% max health' },
  { id: 'magneticHide', name: 'Magnetic Hide', tier: 'gold', category: 'Defense',
    text: 'Cars and debris stick to you as a shield that absorbs damage' },
  { id: 'gasMain', name: 'Gas Main', tier: 'gold', category: 'Destruction',
    text: 'Destroyed buildings have a 20% chance to explode, chaining to others' },
  // Prismatic
  { id: 'meteorCall', name: 'Meteor Call', tier: 'prismatic', category: 'Destruction',
    text: 'Every 30 seconds a meteor hits the biggest building on screen' },
];

export const AUGMENT_BY_ID = Object.fromEntries(AUGMENTS.map((a) => [a.id, a]));

// MVP ships 2 synergy sets.
export const SYNERGY_SETS = [
  { id: 'demolition', name: 'Demolition Crew', augments: ['dominoEffect', 'gasMain', 'debrisToss'],
    bonus: 'Chain collapses also drop biomass' },
  { id: 'unkillable', name: 'Unkillable', augments: ['buildingEater', 'magneticHide', 'thickHide'],
    bonus: 'Debris shield regenerates while standing still' },
];

export function setsFor(augmentId) {
  return SYNERGY_SETS.filter((s) => s.augments.includes(augmentId));
}

export function completedSets(held) {
  return SYNERGY_SETS.filter((s) => s.augments.every((id) => held.has(id)));
}

export function rollTier(odds, rng) {
  return rng.weighted(odds);
}

function isOfferable(aug, held) {
  if (!held.has(aug.id)) return true;
  return Boolean(aug.upgradable) && held.get(aug.id) < aug.maxLevel;
}

// Offers `count` augments of one tier. A held augment is only offered again when it is
// upgradable (marked +). If the tier runs dry (the MVP pool is small), the remaining
// slots are filled from the next tier down, then up.
export function offerAugments({ held, tier, rng, count = 3, exclude = [], guarantee = null }) {
  const start = TIER_ORDER.indexOf(tier);
  const fallback = [start, ...[start - 1, start - 2, start + 1, start + 2].filter((i) => i >= 0 && i < TIER_ORDER.length)];
  const offer = [];
  const tryFill = (avoid) => {
    for (const ti of fallback) {
      if (offer.length >= count) break;
      const pool = rng.shuffle(
        AUGMENTS.filter((a) => a.tier === TIER_ORDER[ti] && isOfferable(a, held) && !offer.includes(a.id) && !avoid.includes(a.id)),
      );
      for (const a of pool) {
        if (offer.length >= count) break;
        offer.push(a.id);
      }
    }
  };
  if (guarantee && AUGMENT_BY_ID[guarantee] && isOfferable(AUGMENT_BY_ID[guarantee], held)) offer.push(guarantee);
  tryFill(exclude);
  // A reroll prefers fresh options but never offers fewer than `count`.
  if (offer.length < count) tryFill([]);
  return rng.shuffle(offer);
}

// Returns the new level of the augment.
export function applyPick(held, id) {
  const aug = AUGMENT_BY_ID[id];
  if (!aug) throw new Error(`Unknown augment ${id}`);
  const level = (held.get(id) || 0) + 1;
  if (level > (aug.maxLevel || 1)) throw new Error(`${aug.name} is already at max level`);
  held.set(id, level);
  return level;
}
