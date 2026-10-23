// Tuning tables taken from the Kaiju Rampage game design doc.
// Numbers are prototype starting points, meant to be tuned in playtests.

export const WORLD = {
  cell: 420, // one city block plus its road
  road: 60,
  cols: 15,
  rows: 15,
  seaWidth: 700, // Harbor Town's sea runs along the west edge
};
WORLD.width = WORLD.cols * WORLD.cell + WORLD.seaWidth;
WORLD.height = WORLD.rows * WORLD.cell;

// 5 growth stages; size roughly doubles each stage (design doc: Growth stages).
// pickOdds is the augment tier roll used when the kaiju grows INTO that stage.
export const STAGES = [
  null,
  { n: 1, name: 'Hatchling', size: 'Car', radius: 14, maxHp: 100, damage: 5, speed: 135, biomassToNext: 18, pickOdds: null },
  { n: 2, name: 'Brute', size: 'Bus', radius: 28, maxHp: 200, damage: 20, speed: 195, biomassToNext: 200, pickOdds: { silver: 1 } },
  { n: 3, name: 'Titan', size: '3-storey house', radius: 56, maxHp: 400, damage: 80, speed: 285, biomassToNext: 1400, pickOdds: { silver: 0.5, gold: 0.5 } },
  { n: 4, name: 'Colossus', size: 'Office tower', radius: 112, maxHp: 800, damage: 320, speed: 415, biomassToNext: 3400, pickOdds: { gold: 1 } },
  { n: 5, name: 'Apex', size: 'Skyline', radius: 224, maxHp: 1600, damage: 1280, speed: 600, biomassToNext: Infinity, pickOdds: { gold: 0.7, prismatic: 0.3 } },
];
export const MAX_STAGE = 5;

// Shown when the kaiju grows into a stage (design doc: Growth stages table).
export const STAGE_INFO = [
  null,
  { destroys: 'Lampposts, cars, kiosks, fences', military: 'Police cars, civilians fleeing' },
  { destroys: 'Shops, gas stations, small houses', military: 'SWAT vans, attack dogs, roadblocks' },
  { destroys: 'Apartments, parking garages, cranes', military: 'Tanks, rocket infantry, helicopters' },
  { destroys: 'Skyscrapers, stadiums, power plants', military: 'Jets, artillery, mini-mechs' },
  { destroys: 'Everything, including the landmark', military: 'The boss arrives' },
];

// Destructible size classes. A tier-N object is "your size" at stage N.
export const TIER_HP = [0, 10, 40, 160, 640, 2560];
export const LANDMARK_HP = TIER_HP[5] * 8;

// Size rules (design doc): below your size breaks in one hit; one size above takes
// several hits and drops much more loot; landmarks only break at stage 5.
export function canDamage(tier, stage, landmark = false) {
  if (landmark) return stage >= 5;
  return tier <= stage + 1;
}

export function isSnack(tier, stage) {
  return tier < stage;
}

// A bigger-than-you object already holds 4x the biomass of one your size; the
// "much more loot" bonus for out-sizing yourself is paid in scrap.
export function lootFor(tier, stage, value = 1) {
  const bonus = tier > stage ? 3 : 1;
  return {
    biomass: Math.pow(4, tier - 1) * value,
    scrap: Math.round(5 * Math.pow(3, tier - 1) * bonus * value),
  };
}

export const DIFFICULTIES = {
  normal: { id: 'normal', name: 'Normal', enemyHp: 1, enemyDmg: 1, loot: 1 },
  hard: { id: 'hard', name: 'Hard', enemyHp: 1.6, enemyDmg: 1.4, loot: 1.5 },
  nightmare: { id: 'nightmare', name: 'Nightmare', enemyHp: 2.4, enemyDmg: 1.9, loot: 2.2 },
};

// MVP roster: Rex, Gorilla Grunt, Ember Lizard, Volt Beetle (design doc: MVP scope).
export const KAIJU = {
  rex: {
    id: 'rex', name: 'Rex', rarity: 'Common', element: 'None',
    ability: 'Bite', abilityText: 'Heavy single-target damage',
    playstyle: 'All-rounder, teaches the basics', earn: 'Free from the start',
    color: '#5aa84f', dark: '#2f6b2a', belly: '#c7d98a',
    attack: { kind: 'bite', mult: 1.5, cooldown: 0.7, range: 1.7 },
    hpMult: 1, speedMult: 1,
  },
  gorilla: {
    id: 'gorilla', name: 'Gorilla Grunt', rarity: 'Common', element: 'None',
    ability: 'Ground Pound', abilityText: 'Area damage around you',
    playstyle: 'Close-range brawler', earn: 'Beat Harbor Town',
    color: '#6d5a4e', dark: '#3b2f28', belly: '#a8968a',
    attack: { kind: 'pound', mult: 1.1, cooldown: 0.85, range: 1.9 },
    hpMult: 1.15, speedMult: 0.95,
  },
  ember: {
    id: 'ember', name: 'Ember Lizard', rarity: 'Rare', element: 'Fire',
    ability: 'Fire Trail', abilityText: 'Leave burning ground behind you',
    playstyle: 'Damage over time, great with destruction augments', earn: 'Rare egg',
    color: '#d9622b', dark: '#7a2a10', belly: '#f2c14e',
    attack: { kind: 'bite', mult: 1.0, cooldown: 0.6, range: 1.6 },
    trail: true, hpMult: 0.95, speedMult: 1.05,
  },
  volt: {
    id: 'volt', name: 'Volt Beetle', rarity: 'Epic', element: 'Electric',
    ability: 'Chain Zap', abilityText: 'Lightning jumps between vehicles',
    playstyle: 'Hits groups; fits the Storm Bringer set', earn: 'Epic egg',
    color: '#3d6fd6', dark: '#1d2f6b', belly: '#9fd3ff',
    attack: { kind: 'zap', mult: 0.95, cooldown: 0.6, range: 2.3, chains: 3 },
    hpMult: 1, speedMult: 1,
  },
};

export const CITIES = {
  harbor: {
    id: 'harbor', name: 'Harbor Town', twist: 'Tutorial city, light military',
    landmark: 'Lighthouse', boss: 'Coast Guard Mech', available: true,
  },
  neotokyo: {
    id: 'neotokyo', name: 'Neo Tokyo', twist: 'Dense skyscrapers, great for chain collapses',
    landmark: 'Broadcast Tower', boss: 'Mecha Samurai', available: false,
  },
};

// Enemy types by escalation stage (design doc: Enemy escalation).
export const ENEMIES = {
  police: { name: 'Police car', tier: 1, r: 7, hp: 8, speed: 150, standoff: 70, range: 230, cd: 1.5, attack: 'bullet', dmg: 1, vehicle: true },
  swat: { name: 'SWAT van', tier: 2, r: 11, hp: 50, speed: 130, standoff: 130, range: 340, cd: 1.8, attack: 'burst', dmg: 1.5, vehicle: true, soft: true },
  dog: { name: 'Attack dog', tier: 2, r: 5, hp: 15, speed: 235, standoff: 0, range: 0, cd: 0.9, attack: 'melee', dmg: 2, soft: true },
  roadblock: { name: 'Roadblock', tier: 2, r: 15, hp: 80, speed: 0, standoff: 0, range: 360, cd: 1.8, attack: 'bullet', dmg: 3, soft: true },
  tank: { name: 'Tank', tier: 3, r: 17, hp: 400, speed: 70, standoff: 320, range: 680, cd: 3.2, attack: 'shell', dmg: 20, vehicle: true },
  infantry: { name: 'Rocket infantry', tier: 3, r: 6, hp: 60, speed: 90, standoff: 260, range: 500, cd: 2.8, attack: 'rocket', dmg: 5, soft: true },
  heli: { name: 'Helicopter', tier: 3, r: 19, hp: 300, speed: 210, standoff: 360, range: 620, cd: 3.2, attack: 'missile', dmg: 4, flying: true, vehicle: true },
  jet: { name: 'Jet', tier: 4, r: 22, hp: 500, speed: 1900, standoff: 0, range: 0, cd: 0, attack: 'strafe', dmg: 55, flying: true, vehicle: true },
  artillery: { name: 'Artillery', tier: 4, r: 22, hp: 900, speed: 25, standoff: 1150, range: 1700, cd: 4.2, attack: 'artillery', dmg: 65, vehicle: true },
  mech: { name: 'Mini-mech', tier: 4, r: 28, hp: 2500, speed: 95, standoff: 430, range: 720, cd: 2.4, attack: 'laser', dmg: 28 },
};

// How the military responds at each stage: spawn weights, cap and interval.
export const ESCALATION = [
  null,
  { weights: { police: 1 }, maxAlive: 3, interval: 5, firstDelay: 8 },
  { weights: { police: 2, swat: 3, dog: 2, roadblock: 1 }, maxAlive: 5, interval: 4 },
  { weights: { tank: 3, infantry: 2, heli: 2, swat: 1 }, maxAlive: 7, interval: 3.8 },
  { weights: { tank: 1, mech: 3, artillery: 2, heli: 1 }, maxAlive: 9, interval: 4, jetEvery: 7 },
  { weights: { mech: 2, artillery: 1, tank: 1 }, maxAlive: 6, interval: 5, jetEvery: 10 },
];

export const BOSS = {
  name: 'Coast Guard Mech',
  hp: 170000,
  r: 220,
  speed: 170,
  contactDmg: 15,
  barrageDmg: 70,
  laserDmg: 160,
  chargeDmg: 150,
  arriveDelay: 6, // seconds after reaching Apex before the boss walks in
};

export const LIMITS = {
  debris: 40, // physics debris pieces on screen (design doc: performance budget)
  collapsing: 3, // buildings mid-collapse at once
  particles: 600,
};

export const UNIT_HEAL = 0.02; // eating an enemy heals 2% max health
export const LOSS_SCRAP_KEEP = 0.5;
