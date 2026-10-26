import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/rng.js';
import {
  newSave, migrateV1, rollover, ECONOMY, syncEnergy, spendEnergy, nextEnergyIn, energyCap, openCrate, pityLeft, crateOdds,
  addItem, levelUp, levelCost, resetItem, merge, mergeFodder, mergeAll, equip, autoEquip, loadout, power, recommendedPower,
  buyMutation, mutationCost, runRewards, applyRun, questState, claimQuest, claimQuestBonus, DAILY_QUESTS, claimLogin, loginReady,
  addPassXp, passTier, claimPass, patrolPending, claimPatrol, quickPatrol, adsLeft, useAd, adEnergy, adGems,
  buyEnergy, spinWheel, buyDeal, starUp, unlockKaiju, addAccountXp, featureOpen, notifications, buySkin,
  RARITY, GEAR, CRATES, EPIC, SKINS,
} from '../src/meta.js';

const T0 = new Date(2026, 9, 26, 10, 0, 0).getTime();
const MIN = 60000;
const HOUR = 60 * MIN;

test('energy regenerates one point per 12 minutes up to the cap, and runs spend 5', () => {
  const s = newSave(T0);
  assert.equal(s.cur.energy, ECONOMY.energyCap);
  assert.ok(spendEnergy(s, 5, T0));
  assert.equal(s.cur.energy, 25);
  syncEnergy(s, T0 + 11 * MIN);
  assert.equal(s.cur.energy, 25);
  assert.equal(nextEnergyIn(s, T0 + 11 * MIN), MIN);
  syncEnergy(s, T0 + 25 * MIN);
  assert.equal(s.cur.energy, 27);
  syncEnergy(s, T0 + 10 * HOUR);
  assert.equal(s.cur.energy, energyCap(s, T0));
  s.cur.energy = 3;
  assert.equal(spendEnergy(s, 5, T0 + 10 * HOUR), false, 'not enough energy');
});

test('daily state resets at the day boundary and deals are the same for everyone that day', () => {
  const s = newSave(T0);
  rollover(s, T0);
  useAd(s, 'energy', T0);
  assert.equal(adsLeft(s, 'energy', T0), 2);
  const deals = JSON.stringify(s.daily.deals);
  rollover(s, T0 + 2 * HOUR);
  assert.equal(adsLeft(s, 'energy', T0 + 2 * HOUR), 2, 'same day keeps the count');
  rollover(s, T0 + 24 * HOUR);
  assert.equal(adsLeft(s, 'energy', T0 + 24 * HOUR), 3, 'new day resets it');
  const other = newSave(T0 + 5 * HOUR);
  rollover(other, T0 + 5 * HOUR);
  assert.equal(JSON.stringify(other.daily.deals), deals);
});

test('ads are capped per day and the energy ad pays 5', () => {
  const s = newSave(T0);
  s.cur.energy = 0;
  for (let i = 0; i < 3; i++) assert.ok(adEnergy(s, T0));
  assert.equal(adEnergy(s, T0), null);
  assert.equal(s.cur.energy, 15);
  s.cur.gems = 1000;
  for (let i = 0; i < 3; i++) assert.ok(buyEnergy(s, T0));
  assert.equal(buyEnergy(s, T0), null, 'gem refills capped at 3 a day');
  assert.equal(s.cur.gems, 850, '15 energy for 50 gems');
});

test('Supply Crates guarantee a Rare by the 10th open and Kaiju Eggs an Epic every 10 and a Legendary by 50', () => {
  const s = newSave(T0);
  s.cur.gems = 1e6;
  // A crate whose odds never roll Rare still pays out on the pity counter.
  const saved = CRATES.supply.rarity;
  CRATES.supply.rarity = { 0: 1 };
  try {
    const drops = openCrate(s, 'supply', 'gems', 10, T0, createRng(1));
    assert.equal(drops.length, 10);
    assert.deepEqual(drops.map((d) => d.item.rarity), [0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    assert.equal(pityLeft(s, 'supply').rare, 10);
  } finally {
    CRATES.supply.rarity = saved;
  }
  const savedEgg = CRATES.egg.rarity;
  CRATES.egg.rarity = { 2: 1 };
  try {
    const drops = [];
    for (let i = 0; i < 5; i++) drops.push(...openCrate(s, 'egg', 'gems', 10, T0, createRng(i)));
    const rar = drops.map((d) => d.item.rarity);
    assert.equal(rar.filter((r) => r >= 3).length, 5, 'one Epic or better per 10');
    assert.equal(rar.at(-1), 4, 'the 50th open is Legendary');
  } finally {
    CRATES.egg.rarity = savedEgg;
  }
  const odds = crateOdds('egg');
  assert.equal(Math.round(odds.reduce((a, o) => a + o.pct, 0)), 100);
});

test('crates can be paid with gems, keys, a daily ad, and the first one is free', () => {
  const s = newSave(T0);
  assert.equal(openCrate(s, 'supply', 'gems', 1, T0, createRng(2)), null, 'no gems');
  assert.ok(openCrate(s, 'supply', 'free', 1, T0, createRng(2)));
  assert.equal(openCrate(s, 'supply', 'free', 1, T0, createRng(2)), null);
  assert.ok(openCrate(s, 'supply', 'ad', 1, T0, createRng(2)));
  assert.equal(openCrate(s, 'supply', 'ad', 1, T0, createRng(2)), null, 'one ad crate a day');
  s.cur.keys.egg = 1;
  assert.ok(openCrate(s, 'egg', 'key', 1, T0, createRng(2)));
  s.cur.gems = 2680;
  assert.equal(openCrate(s, 'egg', 'gems', 10, T0, createRng(3)).length, 10);
  assert.equal(s.cur.gems, 0, 'ten eggs cost 2,680 gems');
  assert.equal(s.gear.items.length, 13);
});

test('gear levels cost scrap and DNA, cap by rarity, and a reset refunds everything', () => {
  const s = newSave(T0);
  const item = addItem(s, 'ironJaw', 0);
  s.cur.scrap = 1e6;
  s.cur.dna.fangs = 1000;
  const c1 = levelCost(item);
  assert.deepEqual(c1, { scrap: 100, dna: { fangs: 2 } });
  while (levelUp(s, item.uid));
  assert.equal(item.level, RARITY[0].cap);
  const scrap = s.cur.scrap;
  const dna = s.cur.dna.fangs;
  const back = resetItem(s, item.uid);
  assert.equal(item.level, 1);
  assert.equal(s.cur.scrap, scrap + back.scrap);
  assert.equal(s.cur.scrap, 1e6);
  assert.equal(s.cur.dna.fangs, 1000);
  assert.ok(dna < 1000);
});

test('three identical pieces merge up a rarity, keeping the best level and refunding the rest', () => {
  const s = newSave(T0);
  const a = addItem(s, 'sawTeeth', 0);
  const b = addItem(s, 'sawTeeth', 0);
  addItem(s, 'ironJaw', 0);
  assert.equal(mergeFodder(s, a.uid).length, 0, 'needs two more of the same item');
  const c = addItem(s, 'sawTeeth', 0);
  s.cur.scrap = 1e5;
  s.cur.dna.fangs = 100;
  levelUp(s, c.uid);
  levelUp(s, c.uid);
  const before = s.cur.scrap;
  equip(s, a.uid);
  assert.ok(merge(s, a.uid));
  assert.equal(a.rarity, 1);
  assert.equal(a.level, 3);
  assert.ok(s.cur.scrap > before, 'invested scrap comes back');
  assert.equal(s.gear.items.filter((i) => i.id === 'sawTeeth').length, 1);
  assert.equal(s.gear.items.includes(b), false);
  // mergeAll walks the ladder as far as it can.
  for (let i = 0; i < 9; i++) addItem(s, 'graniteHide', 0);
  assert.equal(mergeAll(s), 4);
  assert.deepEqual(s.gear.items.filter((i) => i.id === 'graniteHide').map((i) => i.rarity), [2]);
});

test('equipped gear, mutations and kaiju stars raise power; chapters ask for more each time', () => {
  const s = newSave(T0);
  assert.equal(power(s), 1000);
  assert.ok(recommendedPower(1) < 1000, 'a fresh account can clear chapter 1');
  addItem(s, 'ironJaw', 2);
  addItem(s, 'graniteHide', 1);
  autoEquip(s);
  const p1 = power(s);
  assert.ok(p1 > 1000);
  s.settings.unlockAll = true;
  s.cur.scrap = 1e6;
  s.cur.geneCores = 5;
  for (let i = 0; i < 6; i++) assert.ok(buyMutation(s, 'atk'));
  assert.equal(mutationCost(s).scrap, Math.round(500 * Math.pow(1.12, 6)));
  assert.ok(power(s) > p1);
  const l = loadout(s);
  assert.equal(l.fangs.id, 'ironJaw');
  assert.equal(l.fangs.up, false);
  s.cur.shards.rex = 30;
  assert.ok(starUp(s, 'rex'));
  assert.equal(loadout(s).stars, 2);
  assert.ok(recommendedPower(5) > recommendedPower(4));
});

test('mutation rows open with account level and every 10th node needs a Gene Core', () => {
  const s = newSave(T0);
  s.cur.scrap = 1e7;
  assert.equal(buyMutation(s, 'atk'), false, 'locked below level 4');
  s.account.level = 4;
  for (let i = 0; i < 9; i++) assert.ok(buyMutation(s, i % 2 ? 'atk' : 'hp'));
  assert.equal(mutationCost(s).geneCores, 1);
  assert.equal(buyMutation(s, 'atk'), false, 'needs a Gene Core');
  s.cur.geneCores = 1;
  assert.ok(buyMutation(s, 'atk'));
  assert.equal(buyMutation(s, 'speed'), false, 'row 2 opens at level 6');
});

test('a run pays scrap, DNA, XP and pass XP; first clears and milestones pay once', () => {
  const s = newSave(T0);
  const results = { won: true, stage: 6, people: 120, buildings: 80, gateKills: [1, 2, 3, 4, 5], scrapRaw: 5e8, score: 1000, kaijuId: 'rex' };
  const r = runRewards(s, results, { chapter: 1, mode: 'normal' }, createRng(4));
  assert.ok(r.firstClear);
  assert.ok(r.gems >= 100 + 5 * 20 + 3 * 20);
  assert.equal(r.items.length, 1);
  assert.equal(r.xp, 340);
  applyRun(s, results, { chapter: 1, mode: 'normal' }, r, {}, T0);
  assert.equal(s.chapter.unlocked, 2);
  assert.ok(s.unlocked.gorilla, 'clearing chapter 1 unlocks Gorilla Grunt');
  assert.equal(s.cur.geneCores, 1);
  assert.ok(s.account.level >= 2);
  const again = runRewards(s, results, { chapter: 1, mode: 'normal' }, createRng(5));
  assert.equal(again.firstClear, undefined);
  assert.equal(again.gems, 0, 'no repeat first-time gems');
  const lost = runRewards(s, { won: false, stage: 2, gateKills: [1] }, { chapter: 2, mode: 'normal' }, createRng(6));
  assert.ok(lost.scrap > 0 && lost.gems === 20, 'a lost run still pays, and a new chapter\'s first boss kill pays gems');
  // The doubling ad doubles scrap, DNA and pass XP but not gems.
  const s2 = newSave(T0);
  const r2 = runRewards(s2, results, { chapter: 1, mode: 'normal' }, createRng(4));
  applyRun(s2, results, { chapter: 1, mode: 'normal' }, r2, { doubled: true }, T0);
  assert.equal(s2.cur.gems, s.cur.gems - (s.cur.gems - s2.cur.gems));
  assert.ok(s2.cur.scrap > s.cur.scrap - again.scrap);
});

test('quests track runs and pay out once each, with a bonus key for the full set', () => {
  const s = newSave(T0);
  rollover(s, T0);
  const results = { won: false, stage: 4, people: 150, buildings: 40, gateKills: [1, 2, 3], scrapRaw: 1e6, kaijuId: 'rex' };
  for (let i = 0; i < 2; i++) applyRun(s, results, { chapter: 1 }, runRewards(s, results, { chapter: 1 }, createRng(i)), {}, T0);
  openCrate(s, 'supply', 'free', 1, T0, createRng(1));
  for (const q of DAILY_QUESTS) assert.ok(questState(s, q).done, q.id);
  const gems = s.cur.gems;
  for (const q of DAILY_QUESTS) assert.ok(claimQuest(s, q.id));
  assert.equal(claimQuest(s, 'runs'), null);
  assert.equal(s.cur.gems, gems + 80);
  assert.ok(claimQuestBonus(s));
  assert.equal(s.cur.keys.supply, 1);
});

test('the login calendar pays once a day and walks a 7-day loop', () => {
  const s = newSave(T0);
  assert.ok(loginReady(s, T0));
  const r = claimLogin(s, T0);
  assert.deepEqual(r, { scrap: 1000 });
  assert.equal(claimLogin(s, T0 + HOUR), null);
  assert.ok(claimLogin(s, T0 + 24 * HOUR));
  assert.equal(s.cur.gems, 30);
});

test('the Rampage Pass pays its free track to everyone and its bonus track for an ad a tier', () => {
  const s = newSave(T0);
  s.account.level = 5;
  addPassXp(s, 350);
  assert.equal(passTier(s), 3);
  assert.ok(claimPass(s, 1, false));
  assert.equal(claimPass(s, 1, false), null);
  assert.equal(claimPass(s, 4, false), null, 'tier not reached');
  assert.ok(claimPass(s, 1, true, undefined, T0), 'bonus tier, after its ad');
  assert.equal(claimPass(s, 1, true, undefined, T0), null, 'once a tier');
  assert.equal(claimPass(s, 4, true, undefined, T0), null, 'bonus tier not reached');
});

test('Patrol accrues scrap for up to 12 hours; Quick Patrol pays 2 hours for energy or an ad', () => {
  const s = newSave(T0);
  assert.equal(patrolPending(s, T0 + 30 * MIN).hours, 0.5);
  const p = patrolPending(s, T0 + 20 * HOUR);
  assert.equal(p.hours, 12);
  assert.ok(p.full);
  const scrap = s.cur.scrap;
  claimPatrol(s, T0 + 20 * HOUR);
  assert.equal(s.cur.scrap, scrap + p.scrap);
  assert.ok(quickPatrol(s, 'ad', T0 + 20 * HOUR));
  assert.equal(quickPatrol(s, 'ad', T0 + 20 * HOUR), null);
  assert.ok(quickPatrol(s, 'energy', T0 + 20 * HOUR));
});

test('no real-money store: gems come from play and from ads, 30 an ad with no daily cap', () => {
  const s = newSave(T0);
  const g = s.cur.gems;
  for (let i = 0; i < 25; i++) assert.ok(adGems(s, T0));
  assert.equal(s.cur.gems, g + 25 * ECONOMY.adGems);
  assert.equal(ECONOMY.adGems, 30);
  assert.equal(energyCap(s, T0), ECONOMY.energyCap);
  assert.equal(s.purchases, undefined, 'no purchase records');
  // Every skin can be earned in play: for gems or from the pass.
  for (const sk of Object.values(SKINS)) assert.ok(sk.gems || sk.how, sk.name);
  s.cur.gems = SKINS.golden.gems;
  assert.ok(buySkin(s, 'golden'));
  assert.equal(s.cur.gems, 0);
});

test('the wheel, deals and kaiju unlocks work end to end', () => {
  const s = newSave(T0);
  for (let i = 0; i < 5; i++) assert.ok(spinWheel(s, T0, createRng(i)));
  assert.equal(spinWheel(s, T0), null);
  rollover(s, T0);
  s.cur.gems = 1000;
  s.cur.scrap = 5000;
  for (let i = 0; i < 6; i++) assert.ok(buyDeal(s, i, T0, createRng(i)), `deal ${i}`);
  assert.equal(buyDeal(s, 0, T0), null);
  assert.equal(unlockKaiju(s, 'volt'), false);
  s.cur.shards.volt = 30;
  assert.ok(unlockKaiju(s, 'volt'));
  s.cur.gems = 1500;
  assert.ok(unlockKaiju(s, 'ember', 'gems'));
  addAccountXp(s, 1e5, T0);
  assert.ok(featureOpen(s, 'deals'));
  const n = notifications(s, T0);
  assert.ok(n.login === 1 && typeof n.quests === 'number');
});

test('an old profile carries over into the new save', () => {
  const s = migrateV1({ tutorialDone: true, runs: 7, wins: 2, best: { 'harbor:normal': 900 }, cleared: { 'harbor:normal': true }, unlocked: { rex: true, gorilla: true } }, T0);
  assert.equal(s.runs, 7);
  assert.equal(s.chapter.unlocked, 2);
  assert.ok(s.unlocked.gorilla);
  assert.equal(Object.keys(GEAR).length, 20);
});
