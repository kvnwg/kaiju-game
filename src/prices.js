// What things cost in real dollars, for the damage counter, the results and the newspaper: a
// garden shed is about $15,000, a house $700,000, a skyscraper a couple of hundred million.
// Buildings are priced by floor area (the world is about 2.7 units to the metre, a floor 3.5 m);
// props, vehicles, military hardware and bosses each have a sticker price. People aren't priced.

const UNITS_PER_M = 2.7;
const FLOOR_M = 3.5;

// Building cost per square metre of floor, by district.
const STYLE_RATE = {
  suburb: 2500, pastel: 3000, garden: 3200, brick: 2200, neon: 4500, civic: 4000, docks: 1500, forest: 1800, bridge: 9000,
};
// Buildings that are worth more (or less) than their district.
const TYPE_RATE = {
  garden_shed: 1500, carport: 1200, playhouse: 1200, garage_workshop: 1600, warehouse: 1300, harbor_warehouse: 1300,
  self_storage: 1200, parking_garage: 1500, factory: 2000, lumber_mill: 1500, market_shanty: 1200, gas_station: 2500,
  data_center: 9000, hospital: 6000, medical_center: 6500, museum: 8000, bank: 6000, cathedral: 7000, church: 4000,
  power_plant: 6000, tv_tower: 12000, police_station: 4500, fire_station: 4000, library: 4500,
};
// Buildings with a fixed price instead (structures that aren't floors of rooms).
const TYPE_PRICE = {
  road_bridge: 6e6, bridge_deck: 40e6, bridge_tower: 350e6, metro_track: 3e6, metro_station: 60e6, crane: 15e6,
  construction_site: 30e6,
};
const LANDMARK_PRICE = 2.5e9;

// Props and street furniture.
const PROP_PRICE = {
  barrier: 800, bbq: 400, beach_umbrella: 100, bench: 1500, bike: 600, bike_rack: 1200, bollard: 1000, bush: 150,
  cafe_table: 300, campfire: 50, climber: 4000, cone: 30, crates: 200, doghouse: 500, drums: 300, flagpole: 2500,
  flower_bed: 200, gnome: 25, hay: 80, hoop: 800, hot_tub: 8000, hydrant: 3500, ice_cream_cart: 3000, lawn_chair: 40,
  log: 50, mailbox: 150, newspaper_box: 500, parking_meter: 600, picnic_table: 800, planter: 600, rock: 100, scooter: 3000,
  seesaw: 1500, slide: 3000, street_sign: 300, tennis_net: 500, trash_can: 400, vending: 4000,
  boat: 60000, bus_stop: 15000, container: 25000, dumpster: 1500, fence: 400, food_cart: 6000, food_truck: 90000,
  gazebo: 15000, lamppost: 4000, lifeguard_tower: 20000, metro_entrance: 500000, neon_lamp: 6000, neon_pole: 8000,
  newsstand: 10000, palm: 5000, phone_booth: 6000, planter_tree: 3000, pool: 40000, power_pole: 8000, statue: 250000,
  swing_set: 2500, tent: 300, traffic_light: 25000, trampoline: 400, tree_autumn: 3000, tree_birch: 2500,
  tree_blossom: 3500, tree_pine: 2500, tree_pine_tall: 5000, tree_round: 3000, big_screen: 1.5e6, fountain: 300000,
  // Vehicles, parked or driving.
  car: 28000, hatchback: 22000, taxi: 35000, van: 45000, pickup: 42000, bus: 450000, truck: 150000,
};
const PROP_TIER_PRICE = [0, 300, 10000, 200000];

// Military hardware (people and dogs aren't priced).
const UNIT_PRICE = {
  police: 55000, swat: 300000, netter: 400000, roadblock: 25000, tank: 9e6, infantry: 150000, heli: 25e6, jet: 95e6,
  artillery: 6e6, battery: 40e6, mech: 120e6, drone: 8000, robodog: 120000, walker: 2.5e6, crusher: 15e6,
  warframe: 70e6, titan: 450e6,
};
// Size bosses: a cyborg, a suit of power armour, an armoured truck, a crane, and City Hall.
const BOSS_PRICE = { kilowatt: 2e6, karen: 5e6, whippy: 3e6, bill: 25e6, mayor: 900e6 };
const FINAL_BOSS_PRICE = 5e9;

export const TRAIN_PRICE = 20e6;
export const VAULT_PRICE = 50e6; // the gold in a cracked vault

export function objectPrice(o) {
  if (o.landmark) return LANDMARK_PRICE;
  if (o.kind !== 'building') return PROP_PRICE[o.type] ?? PROP_TIER_PRICE[Math.min(3, o.tier)] ?? 0;
  if (TYPE_PRICE[o.type]) return TYPE_PRICE[o.type];
  const floorArea = (o.w / UNITS_PER_M) * (o.h / UNITS_PER_M);
  const floors = Math.max(1, Math.round((o.height || 0) / UNITS_PER_M / FLOOR_M));
  const rate = TYPE_RATE[o.type] ?? STYLE_RATE[o.style] ?? 2500;
  return floorArea * floors * rate;
}

export function vehiclePrice(model) {
  return PROP_PRICE[model] ?? 25000;
}

export function unitPrice(u) {
  return (UNIT_PRICE[u.type] || 0) * (u.elite ? 3 : 1);
}

export function bossPrice(b) {
  return b.gate ? BOSS_PRICE[b.model] ?? 50e6 : FINAL_BOSS_PRICE;
}

// Short dollars for floating text: $900, $15K, $2.1M, $204M, $1.5B.
export function shortMoney(n) {
  const f = (v, s) => `$${v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}${s}`;
  if (n >= 1e9) return f(n / 1e9, 'B');
  if (n >= 1e6) return f(n / 1e6, 'M');
  if (n >= 1e3) return f(n / 1e3, 'K');
  return `$${Math.round(n)}`;
}
