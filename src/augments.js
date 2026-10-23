// Augments: picked on every growth spurt.
//  - move:    an attack the kaiju performs on its own cooldown (claws, lasers, tail spin...)
//  - mod:     upgrades one move ("strike twice", "split into three"); only offered once you
//             own that move. Mods with requires: 'any' boost every move.
//  - passive: always-on perks (destruction chains, defence, growth).

export const TIER_ORDER = ['silver', 'gold', 'prismatic'];

export const AUGMENTS = [
  // ---- moves
  { id: 'clawStrike', kind: 'move', name: 'Claw Strike', tier: 'silver', cd: 2.2,
    text: 'Rake everything in front of you with three glowing claw slashes' },
  { id: 'tailSpin', kind: 'move', name: 'Tail Spin', tier: 'silver', cd: 6,
    text: 'Whirl around and smash everything within a tail length, flinging the wreckage' },
  { id: 'spineMissiles', kind: 'move', name: 'Spine Missiles', tier: 'silver', cd: 5,
    text: 'Launch 4 glowing back spines that arc up and home in on targets' },
  { id: 'carToss', kind: 'move', name: 'Car Toss', tier: 'silver', cd: 3.5,
    text: 'Grab a car and hurl it at the nearest threat. It explodes on impact' },
  { id: 'roar', kind: 'move', name: 'Roar', tier: 'silver', cd: 9,
    text: 'A roar that shatters windows, knocks people flat and sends soldiers running' },
  { id: 'laserEyes', kind: 'move', name: 'Laser Eyes', tier: 'gold', cd: 6,
    text: 'Twin eye lasers sweep across the street in front of you, slicing through anything' },
  { id: 'seismicSlam', kind: 'move', name: 'Seismic Slam', tier: 'gold', cd: 8,
    text: 'Leap and slam down, cracking the ground and sending out a shockwave' },
  { id: 'atomicBreath', kind: 'move', name: 'Atomic Breath', tier: 'gold', cd: 9,
    text: 'Charge up, then breathe a long blue beam wherever you face' },
  { id: 'meteorCall', kind: 'move', name: 'Meteor Call', tier: 'prismatic', cd: 18,
    text: 'Call a meteor down on the biggest building in sight' },

  // ---- mods for one move
  { id: 'doubleStrike', kind: 'mod', requires: 'clawStrike', name: 'Double Strike', tier: 'silver',
    text: 'Claw Strike hits twice: a second slash from the other hand' },
  { id: 'crescentSweep', kind: 'mod', requires: 'clawStrike', name: 'Crescent Sweep', tier: 'silver',
    text: 'Claw slashes sweep all the way around you and reach 40% further' },
  { id: 'moltenClaws', kind: 'mod', requires: 'clawStrike', name: 'Molten Claws', tier: 'gold',
    text: 'Claw marks burn into the ground and keep scorching whatever stands there' },
  { id: 'doubleSpin', kind: 'mod', requires: 'tailSpin', name: 'Double Spin', tier: 'silver',
    text: 'Tail Spin goes around twice' },
  { id: 'cyclone', kind: 'mod', requires: 'tailSpin', name: 'Cyclone', tier: 'gold',
    text: 'Tail Spin becomes a 2-second cyclone that drags people, cars and soldiers in' },
  { id: 'barrage', kind: 'mod', requires: 'spineMissiles', name: 'Barrage', tier: 'silver',
    text: 'Spine Missiles fires 8 spines instead of 4' },
  { id: 'clusterSpines', kind: 'mod', requires: 'spineMissiles', name: 'Cluster Spines', tier: 'gold',
    text: 'Each spine bursts into 3 smaller spines when it hits' },
  { id: 'juggler', kind: 'mod', requires: 'carToss', name: 'Juggler', tier: 'silver',
    text: 'Car Toss throws 3 cars at once' },
  { id: 'ricochet', kind: 'mod', requires: 'carToss', name: 'Ricochet', tier: 'gold',
    text: 'Thrown cars bounce on to 2 more targets' },
  { id: 'sonicRoar', kind: 'mod', requires: 'roar', name: 'Sonic Roar', tier: 'gold',
    text: 'Roar becomes a blast wave that flattens anything your size or smaller' },
  { id: 'prismSplit', kind: 'mod', requires: 'laserEyes', name: 'Prism Split', tier: 'gold',
    text: 'Each eye laser splits into a fan of 3' },
  { id: 'overcharge', kind: 'mod', requires: 'laserEyes', name: 'Overcharge', tier: 'silver',
    text: 'Lasers reach 60% further, burn wider and sweep back again' },
  { id: 'aftershock', kind: 'mod', requires: 'seismicSlam', name: 'Aftershock', tier: 'silver',
    text: 'A second, bigger shockwave follows each slam' },
  { id: 'faultLines', kind: 'mod', requires: 'seismicSlam', name: 'Fault Lines', tier: 'gold',
    text: 'Slams split the ground: 4 glowing cracks race outward, wrecking everything on them' },
  { id: 'napalm', kind: 'mod', requires: 'atomicBreath', name: 'Napalm Breath', tier: 'silver',
    text: 'Atomic Breath leaves a trail of fire where it lands' },
  { id: 'longBreath', kind: 'mod', requires: 'atomicBreath', name: 'Long Breath', tier: 'gold',
    text: 'Atomic Breath lasts twice as long and reaches 50% further' },
  { id: 'meteorShower', kind: 'mod', requires: 'meteorCall', name: 'Meteor Shower', tier: 'prismatic',
    text: 'Meteor Call brings 4 extra meteors raining down around you' },

  // ---- mods for every move
  { id: 'hairTrigger', kind: 'mod', requires: 'any', name: 'Hair Trigger', tier: 'silver', upgradable: true, maxLevel: 3,
    text: 'All moves recharge 20% faster', levelText: 'Moves recharge another 20% faster' },
  { id: 'kaijuSized', kind: 'mod', requires: 'any', name: 'Kaiju-Sized', tier: 'gold',
    text: 'All moves are 35% bigger' },
  { id: 'echo', kind: 'mod', requires: 'any', name: 'Echo', tier: 'prismatic',
    text: 'Every move repeats itself as a ghostly echo half a second later' },

  // ---- passives
  { id: 'thickHide', kind: 'passive', name: 'Thick Hide', tier: 'silver', upgradable: true, maxLevel: 3,
    text: 'Take 15% less damage from bullets and shells', levelText: 'A further 10% less bullet and shell damage' },
  { id: 'snackAttack', kind: 'passive', name: 'Snack Attack', tier: 'silver',
    text: 'Eating vehicles heals 3% max health' },
  { id: 'quickGrowth', kind: 'passive', name: 'Quick Growth', tier: 'silver',
    text: 'Gain 15% more biomass' },
  { id: 'dominoEffect', kind: 'passive', name: 'Domino Effect', tier: 'gold',
    text: 'Collapsing buildings fall onto and damage neighbours' },
  { id: 'gasMain', kind: 'passive', name: 'Gas Main', tier: 'gold',
    text: 'Destroyed buildings have a 20% chance to explode, chaining to others' },
  { id: 'buildingEater', kind: 'passive', name: 'Building Eater', tier: 'gold',
    text: 'Destroying a building heals 5% max health' },
  { id: 'magneticHide', kind: 'passive', name: 'Magnetic Hide', tier: 'gold',
    text: 'Cars and debris stick to you as a shield that absorbs damage' },
  { id: 'rageMode', kind: 'passive', name: 'Rage Mode', tier: 'gold',
    text: 'Deal up to 60% more damage the lower your health' },
];

export const AUGMENT_BY_ID = Object.fromEntries(AUGMENTS.map((a) => [a.id, a]));
export const MOVES = AUGMENTS.filter((a) => a.kind === 'move');

export const SYNERGY_SETS = [
  { id: 'demolition', name: 'Demolition Crew', augments: ['dominoEffect', 'gasMain', 'seismicSlam'],
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

export function movesHeld(held) {
  return MOVES.filter((m) => held.has(m.id)).length;
}

function isOfferable(aug, held) {
  if (aug.kind === 'mod') {
    if (aug.requires === 'any' ? movesHeld(held) === 0 : !held.has(aug.requires)) return false;
  }
  if (!held.has(aug.id)) return true;
  return Boolean(aug.upgradable) && held.get(aug.id) < aug.maxLevel;
}

// Offers `count` augments of one tier. A held augment is only offered again when it is
// upgradable. With no move yet, every option is a move; once you have moves, one slot
// prefers a mod for something you own so builds snowball. A dry tier falls back to the
// next tier down, then up.
export function offerAugments({ held, tier, rng, count = 3, exclude = [], guarantee = null }) {
  const start = TIER_ORDER.indexOf(tier);
  const fallback = [start, ...[start - 1, start - 2, start + 1, start + 2].filter((i) => i >= 0 && i < TIER_ORDER.length)];
  const offer = [];
  const tryFill = (avoid, filter = () => true, upTo = count) => {
    for (const ti of fallback) {
      if (offer.length >= upTo) break;
      const pool = rng.shuffle(
        AUGMENTS.filter((a) => a.tier === TIER_ORDER[ti] && filter(a) && isOfferable(a, held) && !offer.includes(a.id) && !avoid.includes(a.id)),
      );
      for (const a of pool) {
        if (offer.length >= upTo) break;
        offer.push(a.id);
      }
    }
  };
  if (guarantee && AUGMENT_BY_ID[guarantee] && isOfferable(AUGMENT_BY_ID[guarantee], held)) offer.push(guarantee);
  if (movesHeld(held) === 0) tryFill(exclude, (a) => a.kind === 'move');
  else tryFill(exclude, (a) => a.kind === 'mod' && a.requires !== 'any', offer.length + 1);
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
