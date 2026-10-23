// Tuning tables taken from the Kaiju Rampage game design doc.
// Numbers are prototype starting points, meant to be tuned in playtests.

export const WORLD = {
  cell: 420, // one city block plus its road
  road: 60,
  cols: 24,
  rows: 16,
  seaWidth: 900, // the sea runs along the west edge
};
WORLD.width = WORLD.cols * WORLD.cell + WORLD.seaWidth;
WORLD.height = WORLD.rows * WORLD.cell;

// 6 growth stages, from human-sized to skyline-sized. Size roughly doubles each stage.
export const STAGES = [
  null,
  { n: 1, name: 'Hatchling', size: 'Human', radius: 2.5, maxHp: 100, damage: 5, speed: 26, biomassToNext: 45 },
  { n: 2, name: 'Prowler', size: 'Backyard', radius: 6, maxHp: 200, damage: 20, speed: 52, biomassToNext: 1100 },
  { n: 3, name: 'Brute', size: 'House', radius: 14, maxHp: 400, damage: 80, speed: 105, biomassToNext: 7000 },
  { n: 4, name: 'Titan', size: 'Apartment block', radius: 30, maxHp: 800, damage: 320, speed: 190, biomassToNext: 30000 },
  { n: 5, name: 'Colossus', size: 'Office tower', radius: 64, maxHp: 1600, damage: 1280, speed: 320, biomassToNext: 60000 },
  { n: 6, name: 'Apex', size: 'Skyline', radius: 135, maxHp: 3200, damage: 5120, speed: 520, biomassToNext: Infinity },
];
export const MAX_STAGE = 6;

// Shown when the kaiju grows into a stage.
export const STAGE_INFO = [
  null,
  { destroys: 'People, bins, hydrants, mailboxes', military: 'Cops on foot' },
  { destroys: 'Cars, fences, sheds, trees, lampposts', military: 'Police cars and K9 units' },
  { destroys: 'Houses, shops, gas stations', military: 'SWAT vans and roadblocks' },
  { destroys: 'Apartments, garages, factories', military: 'Tanks, rocket teams, gunship drones' },
  { destroys: 'Skyscrapers, stadiums, power plants', military: 'Jets, artillery, mini-mechs' },
  { destroys: 'Everything, including the landmark', military: 'The boss arrives' },
];

// Destructible size classes. A tier-N object is "your size" at stage N.
export const TIER_HP = [0, 10, 40, 160, 640, 2560, 10240];
export const LANDMARK_HP = TIER_HP[6] * 8;

// Size rules (design doc): below your size breaks in one hit; one size above takes
// several hits and drops much more loot; landmarks only break at max size.
export function canDamage(tier, stage, landmark = false) {
  if (landmark) return stage >= MAX_STAGE;
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
    color: '#5aa84f', attack: { kind: 'bite', mult: 1.5, cooldown: 0.7, range: 1.7 },
    hpMult: 1, speedMult: 1,
  },
  gorilla: {
    id: 'gorilla', name: 'Gorilla Grunt', rarity: 'Common', element: 'None',
    ability: 'Ground Pound', abilityText: 'Area damage around you',
    playstyle: 'Close-range brawler', earn: 'Beat Harbor Town',
    color: '#6d5a4e', attack: { kind: 'pound', mult: 1.1, cooldown: 0.85, range: 1.9 },
    hpMult: 1.15, speedMult: 0.95,
  },
  ember: {
    id: 'ember', name: 'Ember Lizard', rarity: 'Rare', element: 'Fire',
    ability: 'Fire Trail', abilityText: 'Leave burning ground behind you',
    playstyle: 'Damage over time, great with destruction augments', earn: 'Rare egg',
    color: '#d9622b', attack: { kind: 'bite', mult: 1.0, cooldown: 0.6, range: 1.6 },
    trail: true, hpMult: 0.95, speedMult: 1.05,
  },
  volt: {
    id: 'volt', name: 'Volt Beetle', rarity: 'Epic', element: 'Electric',
    ability: 'Chain Zap', abilityText: 'Lightning jumps between vehicles',
    playstyle: 'Hits groups; fits the Storm Bringer set', earn: 'Epic egg',
    color: '#3d6fd6', attack: { kind: 'zap', mult: 0.95, cooldown: 0.6, range: 2.3, chains: 3 },
    hpMult: 1, speedMult: 1,
  },
};

export const CITIES = {
  harbor: {
    id: 'harbor', name: 'Harbor Town', twist: 'Suburbs, a pastel old town, a brick district, neon downtown and a lake bridge',
    landmark: 'Lighthouse', boss: 'Coast Guard Mech', available: true,
  },
  neotokyo: {
    id: 'neotokyo', name: 'Neo Tokyo', twist: 'Dense skyscrapers, great for chain collapses',
    landmark: 'Broadcast Tower', boss: 'Mecha Samurai', available: false,
  },
};

// Enemy types by escalation stage. aoe = telegraph radius / beam width; proj = projectile speed.
export const ENEMIES = {
  cop: { name: 'Cop', tier: 1, r: 1.2, hp: 8, speed: 14, standoff: 22, range: 60, cd: 1.5, attack: 'bullet', dmg: 1, proj: 90, soft: true, human: true, skittish: true },
  police: { name: 'Police car', tier: 2, r: 6, hp: 32, speed: 60, standoff: 45, range: 120, cd: 1.5, attack: 'bullet', dmg: 2, proj: 160, vehicle: true, skittish: true },
  dog: { name: 'K9 unit', tier: 2, r: 2, hp: 15, speed: 70, standoff: 0, range: 0, cd: 0.9, attack: 'melee', dmg: 3, soft: true },
  swat: { name: 'SWAT van', tier: 3, r: 9, hp: 200, speed: 75, standoff: 90, range: 230, cd: 1.8, attack: 'burst', dmg: 3, proj: 240, vehicle: true, soft: true },
  roadblock: { name: 'Roadblock', tier: 3, r: 11, hp: 320, speed: 0, standoff: 0, range: 250, cd: 1.8, attack: 'bullet', dmg: 6, proj: 260, soft: true },
  tank: { name: 'Tank', tier: 4, r: 15, hp: 1600, speed: 45, standoff: 220, range: 480, cd: 3.2, attack: 'shell', dmg: 40, aoe: 26, vehicle: true },
  infantry: { name: 'Rocket team', tier: 4, r: 4, hp: 240, speed: 50, standoff: 180, range: 360, cd: 2.8, attack: 'rocket', dmg: 10, proj: 220, soft: true },
  heli: { name: 'Gunship drone', tier: 4, r: 14, hp: 1200, speed: 140, standoff: 260, range: 450, cd: 3.2, attack: 'missile', dmg: 8, proj: 260, flying: true, vehicle: true },
  jet: { name: 'Jet', tier: 5, r: 18, hp: 2000, speed: 1500, standoff: 0, range: 0, cd: 0, attack: 'strafe', dmg: 95, aoe: 52, flying: true, vehicle: true },
  artillery: { name: 'Artillery', tier: 5, r: 18, hp: 3600, speed: 20, standoff: 900, range: 1300, cd: 4.2, attack: 'artillery', dmg: 110, aoe: 80, vehicle: true },
  mech: { name: 'Mini-mech', tier: 5, r: 24, hp: 10000, speed: 75, standoff: 330, range: 560, cd: 2.4, attack: 'laser', dmg: 56, aoe: 23 },
};

// How the military responds at each stage: spawn weights, cap and interval.
export const ESCALATION = [
  null,
  { weights: { cop: 1 }, maxAlive: 3, interval: 6, firstDelay: 12 },
  { weights: { police: 3, dog: 2, cop: 1 }, maxAlive: 5, interval: 4 },
  { weights: { swat: 3, roadblock: 1, police: 1 }, maxAlive: 6, interval: 4 },
  { weights: { tank: 3, infantry: 2, heli: 2, swat: 1 }, maxAlive: 7, interval: 3.8 },
  { weights: { tank: 1, mech: 3, artillery: 2, heli: 1 }, maxAlive: 9, interval: 4, jetEvery: 7 },
  { weights: { mech: 2, artillery: 1, tank: 1 }, maxAlive: 6, interval: 5, jetEvery: 10 },
];

export const BOSS = {
  name: 'Coast Guard Mech',
  hp: 4500000,
  r: 150,
  speed: 150,
  contactDmg: 30,
  barrageDmg: 140,
  barrageR: 66,
  laserDmg: 320,
  laserW: 78,
  chargeDmg: 300,
  chargeSpeed: 900,
  arriveDelay: 6, // seconds after reaching Apex before the boss walks in
};

export const LIMITS = {
  collapsing: 3, // buildings mid-collapse at once (design doc: performance budget)
  vfx: 600,
};

export const UNIT_HEAL = 0.02; // eating an enemy heals 2% max health
export const LOSS_SCRAP_KEEP = 0.5;

// Ambient life: civilians and traffic near the kaiju.
export const CROWD = { people: 55, traffic: 22, personHp: 4, carHp: 30 };

// How long eating one person takes: snatch, toss, chomp, gulp (seconds).
export const EAT_TIME = 0.8;

// Experience: biomass also fills a separate XP bar. Each level-up is an augment pick; the
// cost of a level grows geometrically so picks come every ~20-40 s at every size.
export const XP = { base: 8, growth: 1.24 };
export function xpToNext(level) {
  return XP.base * Math.pow(XP.growth, level - 1);
}
