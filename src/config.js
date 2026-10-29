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

export const FOV = 32; // the camera's vertical field of view, in degrees

// Growth stages. The city takes six, from human-sized to skyline-sized, size roughly doubling
// each time. Beating the city's last boss doesn't end the run: the kaiju outgrows the planet and
// keeps going, through the solar system, the galaxy and the multiverse, until the camera pulls
// back far enough to show the whole multiverse was a speck in a back garden, where it is suddenly
// ant-sized. Outgrow the garden and it is back where it started, human-sized in the home
// neighbourhood: the next loop.
// Each realm has its own world, and sizes there are counted in that world's own units (`radius`
// starts again at the bottom of the range), so the camera, speeds and ranges stay in the same
// comfortable range everywhere. Health, damage and biomass keep climbing.
export const STAGES = [
  null,
  { n: 1, name: 'Hatchling', size: 'Human', realm: 'city', radius: 2.5, maxHp: 100, damage: 5, speed: 26, biomassToNext: 18 },
  { n: 2, name: 'Prowler', size: 'Backyard', realm: 'city', radius: 6, maxHp: 200, damage: 20, speed: 52, biomassToNext: 1100 },
  { n: 3, name: 'Brute', size: 'House', realm: 'city', radius: 14, maxHp: 400, damage: 80, speed: 105, biomassToNext: 6500 },
  { n: 4, name: 'Titan', size: 'Apartment block', realm: 'city', radius: 30, maxHp: 800, damage: 320, speed: 190, biomassToNext: 25000 },
  { n: 5, name: 'Colossus', size: 'Office tower', realm: 'city', radius: 64, maxHp: 1600, damage: 1280, speed: 320, biomassToNext: 48000 },
  // The top city size grows by beating the final boss, not by biomass.
  { n: 6, name: 'Apex', size: 'Skyline', realm: 'city', radius: 135, maxHp: 3200, damage: 5120, speed: 520, biomassToNext: Infinity },
  { n: 7, name: 'Worldbreaker', size: 'Planet', realm: 'solar', radius: 30, maxHp: 6400, damage: 20480, speed: 190, biomassToNext: 900000 },
  { n: 8, name: 'Star Eater', size: 'Galaxy', realm: 'galaxy', radius: 30, maxHp: 12800, damage: 81920, speed: 190, biomassToNext: 3600000 },
  { n: 9, name: 'Omnivore', size: 'Universe', realm: 'cosmos', radius: 30, maxHp: 25600, damage: 327680, speed: 190, biomassToNext: 14400000 },
  { n: 10, name: 'Speck', size: 'Ant', realm: 'garden', radius: 6, maxHp: 51200, damage: 1310720, speed: 52, biomassToNext: 6.6e7 },
  { n: 11, name: 'Critter', size: 'Shrub', realm: 'garden', radius: 14, maxHp: 102400, damage: 5242880, speed: 105, biomassToNext: 2.7e8 },
];
// The city's top size (the final boss fights you there) and the very last size before the loop.
export const MAX_STAGE = 6;
export const LAST_STAGE = 11;

// The worlds the kaiju passes through. `cell` is the streaming chunk size in that world's units.
export const REALMS = {
  city: { id: 'city', name: 'The City', cell: 420 },
  solar: { id: 'solar', name: 'The Solar System', cell: 560, space: true, outgrew: 'You outgrew the Earth' },
  galaxy: { id: 'galaxy', name: 'The Milky Way', cell: 560, space: true, outgrew: 'You outgrew the Solar System' },
  cosmos: { id: 'cosmos', name: 'The Multiverse', cell: 560, space: true, outgrew: 'You outgrew the galaxy' },
  garden: { id: 'garden', name: 'A Back Garden', cell: 220, outgrew: 'You outgrew the multiverse' },
};
export const realmOf = (stage) => STAGES[stage].realm;

// Shown when the kaiju grows into a stage.
export const STAGE_INFO = [
  null,
  { destroys: 'People, bins, hydrants, mailboxes', military: 'Cops on foot' },
  { destroys: 'Cars, fences, sheds, trees, lampposts', military: 'Police cars and K9 units' },
  { destroys: 'Houses, shops, gas stations', military: 'SWAT vans and roadblocks' },
  { destroys: 'Apartments, garages, factories', military: 'Tanks, rocket teams, gunship drones' },
  { destroys: 'Skyscrapers, stadiums, power plants', military: 'Jets, artillery, mini-mechs' },
  { destroys: 'Everything, including the landmark', military: 'The boss arrives' },
  { destroys: 'Satellites, moons, space stations, planets', military: 'The Galactic Federation' },
  { destroys: 'Stars, black holes, whole solar systems', military: 'Federation battle fleets' },
  { destroys: 'Galaxies, quasars, entire universes', military: 'The Cosmic Guard' },
  { destroys: 'Ants, crumbs, seeds, blades of grass', military: 'Soldier ants, wasps and spiders' },
  { destroys: 'Mushrooms, flowers, snails, mini shrubs', military: "Beetles and the Queen's army" },
];

// Destructible size classes. A tier-N object is "your size" at stage N.
export const TIER_HP = [0, 10, 40, 160, 640, 2560, 10240, 40960, 163840, 655360, 2621440, 10485760, 41943040, 167772160];
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
  netter: { name: 'Net launcher', tier: 3, r: 9, hp: 260, speed: 70, standoff: 130, range: 280, cd: 5.5, attack: 'net', dmg: 2, proj: 150, vehicle: true, soft: true, model: 'swat' },
  roadblock: { name: 'Roadblock', tier: 3, r: 11, hp: 320, speed: 0, standoff: 0, range: 250, cd: 1.8, attack: 'bullet', dmg: 6, proj: 260, soft: true },
  tank: { name: 'Tank', tier: 4, r: 15, hp: 1600, speed: 45, standoff: 220, range: 480, cd: 3.2, attack: 'shell', dmg: 40, aoe: 26, vehicle: true },
  infantry: { name: 'Rocket team', tier: 4, r: 4, hp: 240, speed: 50, standoff: 180, range: 360, cd: 2.8, attack: 'rocket', dmg: 10, proj: 220, soft: true, sedate: 2 },
  // Melee mobs: your size, in squads, slightly slower than you. They charge and brawl.
  drone: { name: 'Attack drone', tier: 1, r: 1.6, hp: 6, speed: 21, standoff: 0, range: 0, cd: 1, attack: 'melee', dmg: 1, mob: true },
  robodog: { name: 'Robo-hound', tier: 2, r: 4, hp: 30, speed: 44, standoff: 0, range: 0, cd: 1, attack: 'melee', dmg: 2, mob: true },
  walker: { name: 'Exo Walker', tier: 3, r: 10, hp: 130, speed: 84, standoff: 0, range: 0, cd: 1.3, attack: 'melee', dmg: 5.5, mob: true },
  crusher: { name: 'Spider Crusher', tier: 4, r: 22, hp: 450, speed: 155, standoff: 0, range: 0, cd: 1.3, attack: 'melee', dmg: 15, mob: true },
  warframe: { name: 'Warframe', tier: 5, r: 42, hp: 1800, speed: 255, standoff: 0, range: 0, cd: 1.4, attack: 'melee', dmg: 44, mob: true },
  titan: { name: 'Titan', tier: 6, r: 88, hp: 8500, speed: 410, standoff: 0, range: 0, cd: 1.5, attack: 'melee', dmg: 110, mob: true },
  battery: { name: 'Missile battery', tier: 5, r: 18, hp: 5000, speed: 0, standoff: 0, range: 1100, cd: 6.5, attack: 'volley', dmg: 34, proj: 260, vehicle: true, model: 'artillery' },
  heli: { name: 'Gunship drone', tier: 4, r: 14, hp: 1200, speed: 140, standoff: 260, range: 450, cd: 3.2, attack: 'missile', dmg: 8, proj: 260, flying: true, vehicle: true },
  jet: { name: 'Jet', tier: 5, r: 18, hp: 2000, speed: 1500, standoff: 0, range: 0, cd: 0, attack: 'strafe', dmg: 95, aoe: 52, flying: true, vehicle: true },
  artillery: { name: 'Artillery', tier: 5, r: 18, hp: 3600, speed: 20, standoff: 900, range: 1300, cd: 4.2, attack: 'artillery', dmg: 110, aoe: 80, vehicle: true },
  mech: { name: 'Mini-mech', tier: 5, r: 24, hp: 10000, speed: 75, standoff: 330, range: 560, cd: 2.4, attack: 'laser', dmg: 56, aoe: 23 },
  // Past the city, units are built for a size (`base`) and keep coming back at later sizes in the
  // same realm, tougher (see Game.scaledDef); `rel` is their size class relative to the kaiju's.
  // Space: the Galactic Federation, then the Cosmic Guard.
  interceptor: { name: 'Star Interceptor', base: 7, rel: 0, r: 18, hp: 28800, speed: 160, standoff: 0, range: 0, cd: 1.3, attack: 'melee', dmg: 120, mob: true },
  frigate: { name: 'Laser Frigate', base: 7, rel: 0, r: 15, hp: 80000, speed: 60, standoff: 230, range: 480, cd: 3.4, attack: 'laser', dmg: 320, aoe: 16 },
  cruiser: { name: 'Plasma Cruiser', base: 7, rel: 0, r: 22, hp: 143000, speed: 35, standoff: 300, range: 600, cd: 3.8, attack: 'shell', dmg: 320, aoe: 30 },
  saucer: { name: 'Saucer', base: 7, rel: 0, r: 13, hp: 76800, speed: 140, standoff: 260, range: 450, cd: 3.2, attack: 'missile', dmg: 64, proj: 260, flying: true, hover: 1.6 },
  mothership: { name: 'Mothership', base: 7, rel: 1, r: 30, hp: 160000, speed: 0, standoff: 0, range: 560, cd: 6.5, attack: 'volley', dmg: 136, proj: 260, flying: true, hover: 1.2 },
  starjet: { name: 'Star Fighter', base: 7, rel: 1, r: 18, hp: 128000, speed: 700, standoff: 0, range: 0, cd: 0, attack: 'strafe', dmg: 380, aoe: 26, flying: true },
  sentinel: { name: 'Cosmic Sentinel', base: 9, rel: 0, r: 18, hp: 460000, speed: 170, standoff: 0, range: 0, cd: 1.3, attack: 'melee', dmg: 480, mob: true, hover: 0.8 },
  warden: { name: 'Void Warden', base: 9, rel: 0, r: 16, hp: 1280000, speed: 55, standoff: 240, range: 500, cd: 3, attack: 'laser', dmg: 1280, aoe: 18, flying: true, hover: 1.4 },
  // The back garden.
  soldier_ant: { name: 'Soldier ant', base: 10, rel: 0, r: 3.2, hp: 1970000, speed: 44, standoff: 0, range: 0, cd: 1, attack: 'melee', dmg: 512, mob: true },
  wasp: { name: 'Wasp', base: 10, rel: 0, r: 3, hp: 2100000, speed: 60, standoff: 45, range: 120, cd: 1.6, attack: 'burst', dmg: 512, proj: 150, flying: true, hover: 2.2, skittish: true },
  spider: { name: 'Garden spider', base: 10, rel: 0, r: 4.2, hp: 2600000, speed: 40, standoff: 70, range: 150, cd: 5, attack: 'net', dmg: 512, proj: 110 },
  beetle: { name: 'Stag beetle', base: 10, rel: 0, r: 5.5, hp: 6000000, speed: 22, standoff: 80, range: 190, cd: 3.4, attack: 'shell', dmg: 2560, aoe: 7 },
};

// How the military responds at each stage: spawn weights, cap and interval.
export const ESCALATION = [
  null,
  { weights: { cop: 2, drone: 1 }, maxAlive: 3, interval: 6, firstDelay: 12 },
  { weights: { police: 2, dog: 1, robodog: 3 }, maxAlive: 5, interval: 4 },
  { weights: { swat: 2, roadblock: 0.6, netter: 1, walker: 3 }, maxAlive: 6, interval: 3.5 },
  { weights: { tank: 1.5, infantry: 1, heli: 1, crusher: 3 }, maxAlive: 7, interval: 3.2 },
  { weights: { mech: 1, artillery: 1, battery: 0.5, warframe: 3 }, maxAlive: 9, interval: 3, jetEvery: 7 },
  { weights: { titan: 3, warframe: 1.5, artillery: 1, battery: 0.5 }, maxAlive: 10, interval: 3, jetEvery: 7 },
  // `jet`: what makes the strafing runs there.
  { weights: { interceptor: 3, frigate: 1, cruiser: 0.8, saucer: 1 }, maxAlive: 8, interval: 3.2, jetEvery: 9, jet: 'starjet' },
  { weights: { interceptor: 3, frigate: 1.2, cruiser: 1, saucer: 1, mothership: 0.4 }, maxAlive: 9, interval: 3, jetEvery: 8, jet: 'starjet' },
  { weights: { sentinel: 3, warden: 1.2, cruiser: 0.8, mothership: 0.5 }, maxAlive: 10, interval: 3, jetEvery: 7, jet: 'starjet' },
  { weights: { soldier_ant: 3, wasp: 1.5, spider: 1 }, maxAlive: 6, interval: 3.5 },
  { weights: { soldier_ant: 3, wasp: 1.2, spider: 1, beetle: 1 }, maxAlive: 8, interval: 3.2 },
];

// Swarms. The military answers with numbers: squads instead of single units, and a field cap
// that grows with size. Each size fields units built to that size, led by a melee mob that
// charges in (drones, robo-hounds, exo walkers, spider crushers, warframes, titans).
export const SWARM = {
  maxAlive: [0, 6, 12, 18, 24, 30, 36, 28, 32, 36, 18, 24],
  squad: {
    cop: 3, police: 2, dog: 3, swat: 2, netter: 1, roadblock: 1, tank: 2, infantry: 2, heli: 1, artillery: 1, mech: 1, battery: 1, jet: 1, drone: 5, robodog: 4, walker: 3, crusher: 3, warframe: 2, titan: 2,
    interceptor: 3, frigate: 1, cruiser: 1, saucer: 2, mothership: 1, sentinel: 3, warden: 1, soldier_ant: 4, wasp: 2, spider: 1, beetle: 1,
  },
  dmg: 0.5, // per-unit damage, since there are so many of them
  loot: 0.5, // swarm units are worth less each (melee mobs half again)
};

// Pressure. Destruction fills a threat meter (0-100) that drains a few seconds after you stop;
// threat speeds up and swells the military's response. Every so often a telegraphed strike
// wave arrives from several sides at once, sooner the higher the threat.
export const THREAT = {
  drain: 3, // per second, always, plus 3% of the current threat
  decay: 8, // extra per second once idle
  idle: 3, // seconds without new threat before the extra drain starts
  waveEvery: [0, 0, 55, 50, 45, 42, 40, 42, 40, 38, 50, 45],
  firstWave: 35, // seconds into a size before its first wave
};
// The military keeps pace with your build: every level-up makes new units tougher and
// harder-hitting.
export const ENEMY_SCALING = { hpPerLevel: 0.05, dmgPerLevel: 0.032 };
// One named elite per size, with a big reward.
export const ELITES = [
  null,
  null,
  { type: 'police', name: 'Interceptor' },
  { type: 'swat', name: 'Riot Command' },
  { type: 'tank', name: 'Mammoth Tank' },
  { type: 'warframe', name: 'Warframe Prime' },
  { type: 'titan', name: 'Omega Titan' },
  { type: 'cruiser', name: 'Star Dreadnought' },
  { type: 'interceptor', name: 'Ace of the Federation' },
  { type: 'warden', name: 'The All-Seeing Eye' },
  { type: 'beetle', name: 'Stag Beetle King' },
  { type: 'spider', name: 'Widow Matriarch' },
];
export const ELITE = { hp: 9, dmg: 1.8, size: 1.5, first: 40, every: 95 };
// Charge: a short dash with i-frames that tramples units in the way and tears nets off.
// Dashing through a hit as it lands is a perfect dodge: most of the cooldown comes back.
export const DASH = { cd: 2.8, time: 0.24, speed: 3.4, iframes: 0.32, refund: 0.7, dmg: 1.5 };
// Killing a pack of units in quick succession pays a bonus.
export const MULTI = { window: 0.7, tiers: [5, 10, 20] };
// Healing gets weaker the more you have healed recently; sedative rounds pause it.
export const HEALING = { falloff: 10, recover: 0.03 };
// There are no healing augments: health comes back from hospitals (outlined in green; smash one
// to heal, less if it is far below your size) and, while small, the rare doctor you can eat.
export const HOSPITAL = { heal: [0.25, 0.12, 0.05, 0.02] }; // by how many sizes below you it is
export const DOCTOR_HEAL = { heal: 0.12, gap: [55, 85], chance: 0.06, maxStage: 2 };

// The final boss. It never hurts by touch: every hit is a red telegraph (sizes in kaiju radii).
export const BOSS = {
  name: 'Coast Guard Mech',
  hp: 6750000,
  r: 150,
  speed: 150,
  interval: 2.6, // seconds between attacks; 30% faster when enraged
  patterns: ['barrage', 'laser', 'charge', 'cross', 'missiles'],
  patterns2: ['barrage', 'sweep', 'charge', 'missiles', 'laser', 'cross', 'sweep'],
  barrageDmg: 260,
  laserDmg: 560,
  chargeDmg: 640,
  crossDmg: 420,
  sweepDmg: 480,
  missileDmg: 240,
  chargeSpeed: 900,
  arriveDelay: 6, // seconds after reaching Apex before the boss walks in
};

// A boss guards every size-up: fill the growth bar and one is sent after you; beat it to grow.
// Sizes are in units of your radius at that stage, damage in fractions of that stage's max health,
// and health in hits of your current base damage (so augments still make the fight shorter).
export const GATE = { warn: 2.5, hits: 46, hitsPerLevel: 0.6, interval: 3.1, furious: 0.7, heal: 0.15, secondWind: 0.5 };
export const GATE_BOSSES = [
  null,
  {
    id: 'kilowatt', name: 'Agent Kilowatt', title: 'Cyborg hitman. Sent to "handle" you.',
    r: 1.3, speed: 0.8, keep: 5, hits: 0.5, patterns: ['pistol', 'blink', 'pistol', 'mines'],
    quips: { pistol: ['Nothing personal.', 'Hold still.', 'Bang. Bang. Bang.'], blink: ['Over here.', 'Too slow.'], mines: ["Here's my card.", 'Networking!'] },
    furious: 'Kilowatt has removed his sunglasses.', defeat: 'Agent Kilowatt has been... decommissioned.',
  },
  {
    id: 'karen', name: 'KAREN-9000', title: 'HOA president. Power armour. Opinions.',
    r: 1.4, speed: 0.75, keep: 3, chargeSpeed: 3.2, chargeDmg: 0.16, patterns: ['violation', 'charge', 'manager', 'violation', 'charge'],
    quips: { violation: ["That's a violation!", 'Your lawn is TOO SMASHED.', 'I am filing a complaint.'], charge: ['Excuse me?!', 'I was HERE first!'], manager: ['I want to speak to your MANAGER.', 'Officers! THAT one!'] },
    furious: 'KAREN-9000 has escalated to corporate.', defeat: 'KAREN-9000 will be leaving a one-star review.',
  },
  {
    id: 'whippy', name: 'Mr. Whippy', title: 'Armoured ice-cream truck. The jingle never stops.',
    r: 1.3, speed: 0.95, keep: 2, chargeSpeed: 3.6, chargeDmg: 0.2, patterns: ['scoops', 'donut', 'scoops', 'charge'],
    quips: { scoops: ['Brain freeze!', 'Two scoops!', 'Sprinkles are extra.'], donut: ['♪ Pop goes the weasel ♪', 'Wheeeee!'], charge: ['Beep beep!', 'No refunds!'] },
    furious: 'Mr. Whippy has switched to rocky road.', defeat: 'Mr. Whippy has melted.',
  },
  {
    id: 'bill', name: 'Wrecking Bill', title: 'Sentient demolition crane. Paid by the hour.',
    r: 1.3, speed: 0.7, keep: 3, hits: 0.85, hpMul: 30, patterns: ['swing', 'beams', 'swing', 'unionBreak'],
    quips: { swing: ['Coming through!', 'Swing batter!', 'Mind the ball!'], beams: ['Heads up!', 'Load incoming!'], unionBreak: ['Union break. Fifteen minutes.', 'Contractually obligated nap.'] },
    furious: 'Wrecking Bill is working overtime.', defeat: 'Wrecking Bill has clocked out. Permanently.',
  },
  {
    id: 'mayor', name: 'The Mecha-Mayor', title: 'City Hall, standing up for itself.',
    r: 1.3, speed: 0.75, keep: 3, hits: 0.85, hpMul: 30, patterns: ['taxLaser', 'budgetCuts', 'speech', 'blimps', 'taxLaser', 'budgetCuts'],
    quips: { taxLaser: ['Time to pay your fair share!', 'Audit beam, engage!'], budgetCuts: ['Budget cuts!', 'Slashing spending!'], speech: ['My fellow citizens...', 'Four more years!', 'I will now filibuster.'], blimps: ['Vote Mayor!', 'Campaign drop!'] },
    furious: 'The Mecha-Mayor has declared a state of emergency.', defeat: 'The Mecha-Mayor has been voted out.',
  },
  // Size 6 has no gate: the city's final boss fights you there (see BOSS).
  null,
  {
    id: 'zorblax', name: 'Admiral Zorblax', title: 'Supreme commander of the Galactic Federation. Has a cape.',
    r: 1.3, speed: 0.8, keep: 4, hits: 0.85, hpMul: 25, patterns: ['pistol', 'manager', 'blink', 'mines', 'pistol', 'blink'],
    quips: { pistol: ['Pew pew!', 'Set phasers to... lots.', 'Surrender, earthling!'], manager: ['Squadron, attack!', 'All ships, open fire!'], blink: ['Engage hyperdrive!', 'Warp speed!'], mines: ['Space mines!', 'Mind the minefield.'] },
    furious: 'Admiral Zorblax has lost his cape.', defeat: 'Admiral Zorblax has been demoted. Permanently.',
  },
  {
    id: 'nomoon', name: "That's No Moon", title: 'A battle station. Definitely, totally a moon.',
    r: 1.45, speed: 0.6, keep: 4, hits: 0.85, hpMul: 25, patterns: ['taxLaser', 'manager', 'blimps', 'budgetCuts', 'taxLaser', 'blimps'],
    quips: { taxLaser: ['Firing the main reactor!', 'Totally normal moon laser.'], manager: ['Launch the fighters!', 'Moon pilots, scramble!'], blimps: ['Orbital bombardment!', 'Moon rocks, incoming!'], budgetCuts: ['Crossfire protocol!', 'Trench run THIS.'] },
    furious: "That's No Moon has stopped pretending to be a moon.", defeat: "That's No Moon is now no moon.",
  },
  {
    id: 'nebulor', name: 'Nebulor', title: 'The other kaiju. It got big first, and it wants its multiverse back.',
    r: 1.4, speed: 0.85, keep: 3, hits: 0.85, hpMul: 25, chargeSpeed: 3.4, chargeDmg: 0.18, patterns: ['charge', 'taxLaser', 'swing', 'blimps', 'charge', 'taxLaser'],
    quips: { charge: ['RAAAWR!', 'MINE!', 'Get your own multiverse!'], taxLaser: ['Star breath!', 'Taste the cosmos!'], swing: ['Tail sweep!', 'Out of my way, lizard!'], blimps: ['Meteor storm!', 'Raining worlds!'] },
    furious: 'Nebulor is really, really angry now.', defeat: 'Nebulor has been eaten. There can be only one.',
  },
  {
    id: 'queen', name: 'The Ant Queen', title: 'Mother of millions. All of them angry.',
    r: 1.45, speed: 0.75, keep: 3, hits: 0.85, hpMul: 25, chargeSpeed: 3.2, chargeDmg: 0.16, patterns: ['manager', 'violation', 'charge', 'scoops', 'manager', 'charge'],
    quips: { manager: ['Children! Attack!', 'Defend the colony!'], violation: ['Acid!', 'Formic acid, darling.'], charge: ['Bow to your queen!', 'Off with your head!'], scoops: ['Sticky honeydew!', 'Have a snack. It is a trap.'] },
    furious: 'The Ant Queen has called the whole colony.', defeat: 'The colony is looking for a new queen.',
  },
  {
    id: 'mower', name: 'The Lawnmower', title: 'It has one job.',
    r: 1.4, speed: 0.95, keep: 2, hits: 0.85, hpMul: 25, chargeSpeed: 3.8, chargeDmg: 0.2, patterns: ['charge', 'donut', 'beams', 'charge', 'swing'],
    quips: { charge: ['VRRRRRM!', 'BRRRAP!'], donut: ['Mowing stripes!', 'Round and round!'], beams: ['Grass clippings!', 'Edge trimming!'], swing: ['Blade spin!', 'WHIRRRR!'] },
    furious: 'The Lawnmower has been switched to TURBO.', defeat: 'The Lawnmower has run out of gas.',
  },
];

export const LIMITS = {
  collapsing: 3, // buildings mid-collapse at once (design doc: performance budget)
  vfx: 600,
};

export const UNIT_HEAL = 0.006; // killing a full-strength enemy heals 0.6% max health (swarm units heal nothing)
export const LOSS_SCRAP_KEEP = 0.5;

// Ambient life: civilians and traffic near the kaiju.
export const CROWD = { people: 55, traffic: 22, personHp: 4, carHp: 30 };

// How long eating one person takes: snatch, toss, chomp, gulp (seconds).
export const EAT_TIME = 0.8;

// Experience: biomass also fills a separate XP bar. Each level-up is an augment pick. XP is
// biomass measured against your size (a bigger kaiju eats bigger things, so it counts for less),
// and every level costs 20% more than the last: picks come every ~15 s at first and thin out
// to about one a minute late in a run.
export const XP = { base: 5, growth: 1.17, carry: 0.6 };
export function xpToNext(level) {
  return XP.base * Math.pow(XP.growth, level - 1);
}
export function xpFor(biomass, stage) {
  return biomass / Math.pow(4, stage - 1);
}
