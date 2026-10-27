// The hub between runs: a cinematic title screen, then a Habby-style home with currencies on
// top, a bottom bar (Shop, Gear, Battle, Kaiju, Mutations) and every meta-game screen: crates,
// quests, the login calendar, the Rampage Pass, Patrol, the Lucky Wheel and the shop. There are
// no real-money purchases: the shop runs on gems, scrap and rewarded ads, which play through the
// platform layer (CrazyGames, or a placeholder). meta.js holds the rules.
import { KAIJU } from './config.js';
import { createRng } from './rng.js';
import {
  ECONOMY, RARITY, GEAR, GEAR_SLOTS, SLOT_BY_ID, MUTATIONS, MUTATION_ROW_LEVEL, KAIJU_META, SHARD_UNLOCK, STAR_SHARDS, CHAPTERS,
  MODES, CRATES, AD_PLACEMENTS, DAILY_QUESTS, WEEKLY_QUESTS, DAILY_QUEST_REWARD, WEEKLY_QUEST_REWARD, LOGIN_REWARDS, PASS, WHEEL,
  SKINS, EPIC,
  rollover, syncEnergy, energyCap, nextEnergyIn, xpToLevel, featureOpen, FEATURES, itemByUid, equippedItem, itemStats, levelCost,
  levelUp, resetItem, equip, unequip, mergeFodder, merge, mergeAll, autoEquip, kaijuState, nextStarCost, starUp, unlockKaiju,
  mutationLevel, mutationCost, mutationOpen, buyMutation, power, recommendedPower, loadout, openCrate, pityLeft, crateOdds,
  questState, claimQuest, claimQuestBonus, loginReady, claimLogin, passTier, claimPass, passReward, passEndsIn, patrolPending,
  patrolRate, claimPatrol, quickPatrol, adsLeft, adWait, adEnergy, adGems, buyEnergy, spinWheel, buyDeal, buySkin, notifications, canAfford,
} from './meta.js';

const hq = (root, sel) => root.querySelector(sel);
const REVIVE_OFFER = 10; // seconds to take the ad revive
export function hfmt(n) {
  n = Math.floor(n);
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return n.toLocaleString('en-US');
}
export function hmoney(n) {
  return `$${hfmt(n)}`;
}
function hclock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
const ico = (name, extra = '') => `<i class="ic ic-${name}${extra ? ` ${extra}` : ''}"></i>`;

// One line per part of a reward bundle, for reward screens and offer cards.
function rewardParts(r) {
  const out = [];
  if (!r) return out;
  if (r.gems) out.push({ icon: 'gem', text: hfmt(r.gems), label: 'Gems' });
  if (r.scrap) out.push({ icon: 'scrap', text: hfmt(r.scrap), label: 'Scrap' });
  if (r.energy) out.push({ icon: 'energy', text: r.energy, label: 'Energy' });
  if (r.dna) for (const [k, v] of Object.entries(r.dna)) if (v) out.push({ icon: `slot-${k}`, text: v, label: `${SLOT_BY_ID[k].name} DNA` });
  if (r.dnaAny) out.push({ icon: 'dna', text: r.dnaAny, label: 'DNA' });
  if (r.dnaEach) out.push({ icon: 'dna', text: `${r.dnaEach} each`, label: 'DNA' });
  if (r.keys) for (const [k, v] of Object.entries(r.keys)) if (v) out.push({ icon: k === 'egg' ? 'egg' : 'crate', text: v, label: k === 'egg' ? 'Kaiju Egg' : 'Supply Crate' });
  if (r.shards) for (const [k, v] of Object.entries(r.shards)) if (v) out.push({ icon: 'shard', text: v, label: `${KAIJU[k] ? KAIJU[k].name : k} shards`, color: KAIJU[k] && KAIJU[k].color });
  if (r.geneCores) out.push({ icon: 'gene', text: r.geneCores, label: 'Gene Core' });
  if (r.items) {
    for (const it of r.items) {
      const id = Array.isArray(it) ? it[0] : it.id;
      const rar = Array.isArray(it) ? it[1] : it.rarity;
      out.push({ icon: `slot-${GEAR[id].slot}`, text: RARITY[rar].name, label: GEAR[id].name, rarity: rar });
    }
  }
  if (r.skin) out.push({ icon: 'skin', text: SKINS[r.skin].name, label: 'Skin' });
  if (r.xp) out.push({ icon: 'xp', text: r.xp, label: 'Account XP' });
  if (r.passXp) out.push({ icon: 'pass', text: r.passXp, label: 'Pass XP' });
  return out;
}
function rewardChips(r, cls = '') {
  return rewardParts(r)
    .map((p) => `<span class="rchip ${cls}" ${p.rarity !== undefined ? `style="--rc:${RARITY[p.rarity].color}"` : p.color ? `style="--rc:${p.color}"` : ''}>${ico(p.icon)}<b>${p.text}</b><small>${p.label}</small></span>`)
    .join('');
}

// What each gear slot does, in plain words, for the Gear tab.
const SLOT_ROLE = {
  fangs: { stat: 'Attack', text: 'Your bite. Adds attack, and every Fangs piece changes how your basic attack works.' },
  claws: { stat: 'Attack', text: 'Adds attack. Epic and better claws add a special effect to your hits.' },
  hide: { stat: 'Health', text: 'Adds health. Epic and better hides help you take less damage.' },
  spines: { stat: 'Health', text: 'Adds health. Epic and better spines hit back or fire on their own.' },
  tail: { stat: 'Speed', text: 'Adds speed and a little health. Epic and better tails power up your Charge.' },
  heart: { stat: 'Atk + HP', text: 'Adds a little attack and health. Epic and better hearts speed up your moves or your XP.' },
};

const NAV = [
  { id: 'shop', name: 'Shop', icon: 'shop', feature: 'shop' },
  { id: 'gear', name: 'Gear', icon: 'gear', feature: 'gear' },
  { id: 'battle', name: 'Battle', icon: 'battle' },
  { id: 'kaiju', name: 'Kaiju', icon: 'kaiju', feature: 'kaiju' },
  { id: 'mutations', name: 'Mutate', icon: 'gene', feature: 'mutations' },
];

export class Hub {
  constructor({ app, getSave, persist, onPlay, sfx, platform, getNow = () => Date.now() }) {
    this.getSave = getSave;
    this.platform = platform;
    platform.placeholder = (kind) => this.adPlaceholder(kind);
    this.persist = persist;
    this.onPlay = onPlay;
    this.sfx = sfx;
    this.now = getNow;
    this.tab = 'battle';
    this.rng = createRng(Date.now());
    app.insertAdjacentHTML('beforeend', `
      <div id="title" class="title-screen hidden">
        <div class="title-grade"></div>
        <div class="title-logo"><span class="t1">KAIJU</span><span class="t2">RAMPAGE</span></div>
        <div class="title-tap">Tap to begin</div>
      </div>
      <div id="hub" class="hub hidden">
        <div class="hub-top"></div>
        <div class="hub-side left"></div>
        <div class="hub-side right"></div>
        <div class="hub-body"></div>
        <nav class="hub-nav"></nav>
      </div>
      <div id="hubModal" class="modal hub-modal hidden"></div>
      <div id="adBreak" class="ad-break hidden"></div>
      <div id="toast" class="toast"></div>`);
    this.title = hq(app, '#title');
    this.el = hq(app, '#hub');
    this.top = hq(this.el, '.hub-top');
    this.left = hq(this.el, '.hub-side.left');
    this.right = hq(this.el, '.hub-side.right');
    this.body = hq(this.el, '.hub-body');
    this.nav = hq(this.el, '.hub-nav');
    this.modal = hq(app, '#hubModal');
    this.toastEl = hq(app, '#toast');
    this.adEl = hq(app, '#adBreak');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.modal.addEventListener('click', (e) => this.onClick(e));
    setInterval(() => this.tick(), 1000);
  }

  get save() {
    return this.getSave();
  }

  commit() {
    this.persist();
    if (this.visible) this.render();
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
  }

  // ------------------------------------------------------------------ title
  showTitle(onBegin) {
    this.title.classList.remove('hidden');
    const go = () => {
      this.title.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      this.title.classList.add('leaving');
      setTimeout(() => {
        this.title.classList.add('hidden');
        this.title.classList.remove('leaving');
        onBegin();
      }, 450);
    };
    this.title.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }

  // ------------------------------------------------------------------ hub
  show(tab = this.tab) {
    this.tab = tab;
    this.visible = true;
    rollover(this.save, this.now());
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.visible = false;
    this.el.classList.add('hidden');
    this.closeModal();
  }

  tick() {
    if (!this.visible) return;
    syncEnergy(this.save, this.now());
    this.renderTop();
    // The free-gems ad comes back off its cooldown.
    const cooling = adWait(this.save, 'gems', this.now()) > 0;
    if (cooling !== this.gemsCooling) {
      this.gemsCooling = cooling;
      this.render();
    }
    for (const el of this.el.querySelectorAll('[data-timer]')) {
      const end = Number(el.dataset.timer);
      el.textContent = hclock(end - this.now());
    }
    if (this.modalKind === 'patrol') this.openPatrol(true);
  }

  render() {
    const s = this.save;
    syncEnergy(s, this.now());
    this.renderTop();
    this.renderSides();
    this.renderNav();
    const body = {
      battle: () => this.battleTab(), gear: () => this.gearTab(), shop: () => this.shopTab(), kaiju: () => this.kaijuTab(), mutations: () => this.mutationsTab(),
    }[this.tab];
    this.body.innerHTML = body ? body() : '';
    this.body.dataset.tab = this.tab;
    this.el.dataset.tab = this.tab;
  }

  renderTop() {
    const s = this.save;
    const now = this.now();
    const cap = energyCap(s, now);
    const next = nextEnergyIn(s, now);
    const xpPct = Math.min(100, (100 * s.account.xp) / xpToLevel(s.account.level));
    this.top.innerHTML = `
      <button class="acct" data-act="settings" title="Account level">
        <span class="lv"><small>LV</small><b>${s.account.level}</b></span>
        <span class="xpbar"><i style="width:${xpPct}%"></i></span>
      </button>
      <button class="cur energy" data-act="energy">${ico('energy')}<b>${s.cur.energy}/${cap}</b>${next ? `<small>${hclock(next)}</small>` : ''}<span class="plus">+</span></button>
      <button class="cur gems" data-act="tab" data-tab="shop" data-scroll="gems">${ico('gem')}<b>${hfmt(s.cur.gems)}</b><span class="plus">+</span></button>
      <button class="cur scrap" data-act="scrap" title="Scrap: levels up gear">${ico('scrap')}<b>${hfmt(s.cur.scrap)}</b></button>`;
  }

  renderSides() {
    const s = this.save;
    const now = this.now();
    const n = notifications(s, now);
    const side = (act, icon, label, badge, open = true, extra = '') => (open ? `<button class="side-btn" data-act="${act}">${ico(icon)}<span>${label}</span>${badge ? `<em>${badge > 9 ? '9+' : badge}</em>` : ''}${extra}</button>` : '');
    if (this.tab !== 'battle') {
      this.left.innerHTML = '';
      this.right.innerHTML = '';
      return;
    }
    this.left.innerHTML = [
      side('quests', 'quest', 'Quests', n.quests, featureOpen(s, 'quests')),
      side('login', 'calendar', 'Daily', n.login),
      side('pass', 'pass', 'Pass', n.pass, featureOpen(s, 'pass')),
      side('patrol', 'patrol', 'Patrol', n.patrol, featureOpen(s, 'patrol')),
      side('wheel', 'wheel', 'Wheel', n.wheel ? '' : 0, featureOpen(s, 'wheel')),
    ].join('');
    this.right.innerHTML = this.ads && adsLeft(s, 'gems', now) > 0 ? this.gemsButton('side-btn') : '';
  }

  // The free-gems ad button: +30, or a countdown while it cools down between ads.
  gemsButton(cls) {
    const s = this.save;
    const now = this.now();
    const wait = adWait(s, 'gems', now);
    const label = wait ? `<span data-timer="${now + wait * 1000}">${hclock(wait * 1000)}</span>` : `+${ECONOMY.adGems}`;
    return `<button class="${cls} ad" data-act="adgems" ${wait ? 'disabled' : ''}>${ico('gem')}<span>${label}</span></button>`;
  }

  renderNav() {
    const s = this.save;
    const n = notifications(s, this.now());
    this.nav.innerHTML = NAV.map((t) => {
      const open = !t.feature || featureOpen(s, t.feature);
      const badge = t.id === 'shop' ? n.freeCrate : t.id === 'gear' ? this.gearBadge() : 0;
      return `<button class="nav-btn ${t.id === this.tab ? 'on' : ''} ${open ? '' : 'locked'} ${t.id === 'battle' ? 'main' : ''}" data-act="tab" data-tab="${t.id}">
        ${ico(t.icon)}<span>${t.name}</span>${open ? (badge ? `<em>${badge > 9 ? '9+' : badge}</em>` : '') : `<i class="lock">Lv ${FEATURES[t.feature]}</i>`}</button>`;
    }).join('');
  }

  gearBadge() {
    const s = this.save;
    let n = 0;
    for (const sl of GEAR_SLOTS) if (!equippedItem(s, sl.id) && s.gear.items.some((i) => GEAR[i.id].slot === sl.id)) n++;
    return n + mergeAll(JSON.parse(JSON.stringify(s)));
  }

  // ------------------------------------------------------------------ Battle
  battleTab() {
    const s = this.save;
    const ch = CHAPTERS[s.chapter.selected - 1];
    const n = ch.n;
    const mode = s.chapter.mode;
    const pw = power(s, s.lastKaiju);
    const rec = recommendedPower(n) * (mode === 'hard' ? 1.6 : mode === 'nightmare' ? 2.4 : 1);
    const ms = [3, 5, 6].map((st) => `<i class="star ${s.chapter.milestones[`${n}:${st}`] ? 'on' : ''}" title="${st === 6 ? 'Reach Apex' : `Reach size ${st}`}"></i>`).join('');
    const cleared = s.chapter.cleared[`${n}:normal`];
    const modes = Object.values(MODES).map((m) => {
      const ok = m.id === 'normal' || (cleared && featureOpen(s, 'hard') && (m.id === 'hard' || s.chapter.cleared[`${n}:hard`]));
      return `<button class="seg ${m.id === mode ? 'on' : ''}" data-act="mode" data-mode="${m.id}" ${ok ? '' : 'disabled'}>${m.name}</button>`;
    }).join('');
    const kd = KAIJU[s.lastKaiju];
    const stars = kaijuState(s, s.lastKaiju).stars;
    const canPlay = s.cur.energy >= ECONOMY.energyPerRun;
    return `<div class="battle">
      <div class="chapter-card">
        <div class="ch-row">
          <button class="arrow" data-act="chapter" data-dir="-1" ${n > 1 ? '' : 'disabled'}>&lsaquo;</button>
          <div class="ch-title"><small>Chapter ${n}</small><b>${ch.name}</b></div>
          <button class="arrow" data-act="chapter" data-dir="1" ${n < s.chapter.unlocked ? '' : 'disabled'}>&rsaquo;</button>
        </div>
        <div class="ch-stars">${ms}${cleared ? '<span class="cleared">Cleared</span>' : ''}</div>
        <div class="ch-power ${pw < rec ? 'low' : 'ok'}">${ico('power')}<span>Power <b>${hfmt(pw)}</b> / ${hfmt(rec)}</span></div>
        <div class="segs mode-segs">${modes}</div>
      </div>
      <button class="play-btn ${canPlay ? '' : 'no-energy'}" data-act="play"><b>PLAY</b><span>${ico('energy')}${ECONOMY.energyPerRun}</span></button>
      <button class="kaiju-pill" data-act="tab" data-tab="kaiju" style="--kc:${kd.color}"><i class="kport"></i><span>${kd.name}</span><small>${'★'.repeat(stars)}</small></button>
    </div>`;
  }

  // ------------------------------------------------------------------ Gear
  itemTile(item, opts = {}) {
    const g = GEAR[item.id];
    const r = RARITY[item.rarity];
    const can = mergeFodder(this.save, item.uid).length === 2;
    return `<button class="item ${opts.eq ? 'eq' : ''}" data-act="item" data-uid="${item.uid}" style="--rc:${r.color}">
      ${ico(`slot-${g.slot}`)}<span class="ilv">Lv${item.level}</span>${can ? '<em class="merge-dot" title="Can merge">3</em>' : ''}
      <small>${g.name}</small><small class="irar">${r.name}</small></button>`;
  }

  // The strongest piece the player owns for a slot.
  bestFor(slot) {
    return this.save.gear.items.filter((i) => GEAR[i.id].slot === slot).sort((a, b) => b.rarity - a.rarity || b.level - a.level)[0] || null;
  }

  gearTab() {
    const s = this.save;
    const slots = GEAR_SLOTS.map((sl) => {
      const it = equippedItem(s, sl.id);
      return it ? this.itemTile(it, { eq: true })
        : `<button class="item empty" data-act="slotinfo" data-slot="${sl.id}">${ico(`slot-${sl.id}`)}<small>${sl.name}</small><small class="irar">${SLOT_ROLE[sl.id].stat}</small><span class="plus">+</span></button>`;
    });
    const eqUids = new Set(Object.values(s.gear.equipped));
    const inv = s.gear.items.filter((i) => !eqUids.has(i.uid)).sort((a, b) => b.rarity - a.rarity || b.level - a.level || a.id.localeCompare(b.id));
    const kd = KAIJU[s.lastKaiju];
    // What the Power number is measured against: the chapter selected on the Battle tab.
    const n = s.chapter.selected;
    const mode = s.chapter.mode;
    const pw = power(s);
    const rec = recommendedPower(n) * (mode === 'hard' ? 1.6 : mode === 'nightmare' ? 2.4 : 1);
    const better = GEAR_SLOTS.filter((sl) => {
      const best = this.bestFor(sl.id);
      return best && s.gear.equipped[sl.id] !== best.uid;
    }).length;
    // How many merges the button would make (on a copy, so chains like 3 → 1 → 3 count too).
    const merges = mergeAll(JSON.parse(JSON.stringify(s)));
    const mats = GEAR_SLOTS.map((sl) => `<div class="mat">${ico(`slot-${sl.id}`)}<b>${hfmt(s.cur.dna[sl.id])}</b><small>${sl.name} DNA</small></div>`).join('');
    return `<div class="gear">
      <div class="gear-head">
        <div class="gear-power">${ico('power')}<span>Power <b>${hfmt(pw)}</b></span></div>
        <div class="gear-rec ${pw < rec ? 'low' : 'ok'}">Chapter ${n}${mode === 'normal' ? '' : ` ${MODES[mode].name}`} needs ${hfmt(rec)}</div>
        <button class="btn ghost help-btn" data-act="gearhelp">? How gear works</button>
      </div>
      <p class="gear-intro">Gear makes ${kd.name} stronger. Put a piece in each slot: every piece adds attack, health or speed, and Power is the total.</p>
      <div class="gear-doll">
        <div class="col">${slots.slice(0, 3).join('')}</div>
        <div class="doll" style="--kc:${kd.color}"><i class="kport big"></i><span>${kd.name}</span></div>
        <div class="col">${slots.slice(3).join('')}</div>
      </div>
      <div class="gear-actions">
        <div class="ga"><button class="btn ghost" data-act="autoequip" ${better ? '' : 'disabled'}>Equip best${better ? ` (${better})` : ''}</button><small>Puts your strongest piece in every slot</small></div>
        <div class="ga"><button class="btn ghost" data-act="mergeall" ${merges ? '' : 'disabled'}>Merge all${merges ? ` (${merges})` : ''}</button><small>3 of the same piece become 1 of the next rarity</small></div>
      </div>
      <h3 class="gear-h">Upgrade materials <small>Tap a piece to level it up with these</small></h3>
      <div class="mats">
        <div class="mat scrap">${ico('scrap')}<b>${hfmt(s.cur.scrap)}</b><small>Scrap: levels up any piece</small></div>
        ${mats}
      </div>
      <h3 class="gear-h">Spare gear (${inv.length}) <small>Tap a piece to see it, level it up or equip it</small></h3>
      ${inv.length ? `<div class="inv">${inv.map((i) => this.itemTile(i)).join('')}</div>`
        : `<div class="empty-card"><p>No spare gear yet. You find gear in crates in the Shop, and every chapter you clear gives you a piece.</p>
          <button class="btn primary" data-act="tab" data-tab="shop">${ico('shop')}Go to the Shop</button></div>`}
    </div>`;
  }

  // An empty slot: what it does and how to fill it.
  openSlotInfo(slot) {
    const sl = SLOT_BY_ID[slot];
    const best = this.bestFor(slot);
    this.openModal('slot', `<div class="panel small">
      <div class="item-hero">${ico(`slot-${slot}`, 'big')}</div>
      <h2>${sl.name}</h2>
      <p>${SLOT_ROLE[slot].text}</p>
      ${best ? `<div class="col"><button class="btn primary" data-act="equip" data-uid="${best.uid}">Equip ${GEAR[best.id].name}</button><button class="btn ghost" data-act="close">Close</button></div>`
        : `<p class="tiny">You don't have any ${sl.name} yet. Open crates in the Shop to find some.</p>
        <div class="row"><button class="btn primary" data-act="tab" data-tab="shop">Go to the Shop</button><button class="btn ghost" data-act="close">Close</button></div>`}
    </div>`);
  }

  openGearHelp() {
    const rar = RARITY.map((r) => `<b style="color:${r.color}">${r.name}</b>`).join(' → ');
    this.openModal('gearhelp', `<div class="panel small help-panel">
      <h2>How gear works</h2>
      <ol class="help-list">
        <li><b>Equip</b> one piece in each of the 6 slots. Each piece adds attack, health or speed to your kaiju in every run. Your <b>Power</b> is all of it added up: aim for what the chapter needs.</li>
        <li><b>Level up</b> a piece by tapping it. Each level costs ${ico('scrap')}<b>Scrap</b> plus <b>DNA</b> for that slot (Fangs DNA for Fangs, and so on). Every run pays you both. You can reset a piece any time and get it all back.</li>
        <li><b>Merge</b> 3 copies of the same piece at the same rarity into one piece of the next rarity:<br>${rar}</li>
        <li>Pieces that are <b style="color:${RARITY[EPIC].color}">Epic</b> or better also unlock a special perk.</li>
        <li><b>Find gear</b> in crates in the Shop. Every chapter you clear gives you a piece too.</li>
      </ol>
      <button class="btn primary" data-act="close">Got it</button>
    </div>`);
  }

  openItem(uid) {
    const s = this.save;
    const item = itemByUid(s, uid);
    if (!item) return this.closeModal();
    const g = GEAR[item.id];
    const r = RARITY[item.rarity];
    const st = itemStats(item);
    const lines = [];
    if (st.atk) lines.push(`+${st.atk.toFixed(1)}% attack`);
    if (st.hp) lines.push(`+${st.hp.toFixed(1)}% health`);
    if (st.speed) lines.push(`+${st.speed.toFixed(1)}% speed`);
    if (st.xp) lines.push(`+${st.xp.toFixed(0)}% XP`);
    const isEq = s.gear.equipped[g.slot] === uid;
    const cost = levelCost(item);
    const maxed = item.level >= r.cap;
    const fodder = mergeFodder(s, uid);
    const perkOn = item.rarity >= EPIC;
    const perk = g.effect
      ? `<p class="perk on">${ico('battle')} ${g.effect}</p><p class="perk ${perkOn ? 'on' : ''}">${perkOn ? '' : '<b>Epic:</b> '}${g.perk}</p>`
      : `<p class="perk ${perkOn ? 'on' : ''}">${perkOn ? '' : '<b>Epic:</b> '}${g.perk}</p>`;
    this.openModal('item', `<div class="panel small item-panel" style="--rc:${r.color}">
      <div class="item-hero">${ico(`slot-${g.slot}`, 'big')}</div>
      <h2>${g.name}</h2>
      <div class="rar">${r.name} ${SLOT_BY_ID[g.slot].name} · Level ${item.level}/${r.cap}</div>
      <div class="stat-lines">${lines.map((l) => `<span>${l}</span>`).join('')}</div>
      ${perk}
      <div class="col">
        <button class="btn primary" data-act="levelup" data-uid="${uid}" ${maxed || !canAfford(s, cost) ? 'disabled' : ''}>${maxed ? 'Max level' : 'Level up'}</button>
        ${maxed ? '' : `<p class="tiny cost-line">Costs ${ico('scrap')}${hfmt(cost.scrap)} scrap + ${ico(`slot-${g.slot}`)}${Object.values(cost.dna)[0]} ${SLOT_BY_ID[g.slot].name} DNA<br>You have ${hfmt(s.cur.scrap)} scrap and ${hfmt(s.cur.dna[g.slot])} ${SLOT_BY_ID[g.slot].name} DNA</p>`}
        ${fodder.length === 2 ? `<button class="btn gold" data-act="merge" data-uid="${uid}">Merge 3 → ${RARITY[item.rarity + 1].name}</button>` : item.rarity < RARITY.length - 1 ? `<p class="tiny muted">${item.rarity >= 4 ? `Merge with 2 more Legendary ${SLOT_BY_ID[g.slot].name}` : `Merge with 2 more ${r.name} ${g.name}`} for ${RARITY[item.rarity + 1].name}</p>` : ''}
        <div class="row">
          <button class="btn ghost" data-act="${isEq ? 'unequip' : 'equip'}" data-uid="${uid}">${isEq ? 'Unequip' : 'Equip'}</button>
          <button class="btn ghost" data-act="resetitem" data-uid="${uid}" ${item.level > 1 ? '' : 'disabled'}>Reset (refund)</button>
          <button class="btn ghost" data-act="close">Close</button>
        </div>
      </div></div>`);
  }

  // ------------------------------------------------------------------ Shop
  shopTab() {
    const s = this.save;
    const now = this.now();
    // Daily deals
    const deals = featureOpen(s, 'deals')
      ? `<div class="deals">${s.daily.deals.map((d, i) => {
        if (d.cost.ad && !this.ads) return '';
        const sold = s.daily.dealsBought[i];
        const price = d.cost.ad ? (adsLeft(s, 'deal', now) ? `${ico('ad')}Free` : 'Tomorrow') : d.cost.gems ? `${ico('gem')}${d.cost.gems}` : `${ico('scrap')}${hfmt(d.cost.scrap)}`;
        return `<button class="deal ${sold ? 'sold' : ''}" data-act="deal" data-i="${i}" ${sold ? 'disabled' : ''}>${rewardChips(d.give, 'big')}<span class="dprice">${sold ? 'Sold out' : price}</span></button>`;
      }).join('')}</div>`
      : `<p class="locked-note">Daily Deals unlock at account level ${FEATURES.deals}.</p>`;
    // Crates
    const crate = (id) => {
      const c = CRATES[id];
      const keys = s.cur.keys[id] || 0;
      const pity = pityLeft(s, id);
      const adOk = this.ads && (id === 'supply' ? adsLeft(s, 'crate', now) > 0 : featureOpen(s, 'eggAd') && adsLeft(s, 'egg', now) > 0);
      const free = id === 'supply' && !s.crates.freeFirst;
      return `<div class="crate-card ${id}">
        <div class="crate-art">${ico(id === 'egg' ? 'egg' : 'crate', 'huge')}</div>
        <div class="crate-info"><b>${c.name}</b><small>${c.text}</small>
          <small class="pity">${id === 'supply' ? `Rare guaranteed in ${pity.rare}` : `Epic in ${pity.epic} · Legendary in ${pity.legendary}`}</small>
          <button class="link" data-act="odds" data-id="${id}">Odds</button></div>
        <div class="crate-buy">
          ${free ? `<button class="btn gold" data-act="crate" data-id="${id}" data-how="free">Free!</button>` : ''}
          ${keys ? `<button class="btn gold" data-act="crate" data-id="${id}" data-how="key">${ico(id === 'egg' ? 'egg' : 'crate')}Open (${keys})</button>` : ''}
          ${adOk && !free ? `<button class="btn ghost ad" data-act="crate" data-id="${id}" data-how="ad">Free</button>` : ''}
          <button class="btn primary" data-act="crate" data-id="${id}" data-how="gems">${ico('gem')}${c.gems}</button>
          ${c.ten ? `<button class="btn primary" data-act="crate" data-id="${id}" data-how="gems" data-n="10">10× ${ico('gem')}${hfmt(c.ten)}</button>` : ''}
        </div></div>`;
    };
    const skins = Object.entries(SKINS).map(([id, sk]) => {
      const owned = s.skins.owned[id];
      const on = s.skins.equipped === id;
      const tint = `rgb(${sk.tint.map((v) => Math.round(v * 255)).join(',')})`;
      return `<div class="skin-card" style="--st:${tint}"><i class="kport" style="--kc:${tint}"></i><b>${sk.name}</b>
        ${owned ? `<button class="btn ${on ? 'gold' : 'ghost'}" data-act="skin" data-id="${id}">${on ? 'Equipped' : 'Equip'}</button>` : sk.gems ? `<button class="btn primary" data-act="buyskin" data-id="${id}">${ico('gem')}${hfmt(sk.gems)}</button>` : `<small>${sk.how}</small>`}</div>`;
    }).join('');
    const energyRow = `<div class="energy-row">
      ${this.ads ? `<button class="btn primary ad" data-act="adenergy" ${adsLeft(s, 'energy', now) ? '' : 'disabled'}>${ico('energy')}+${ECONOMY.energyAd} (${adsLeft(s, 'energy', now)} left)</button>` : ''}
      <button class="btn primary" data-act="buyenergy" ${s.daily.energyBuys < ECONOMY.energyGemPack.perDay ? '' : 'disabled'}>${ico('energy')}+${ECONOMY.energyGemPack.energy} for ${ico('gem')}${ECONOMY.energyGemPack.gems}</button></div>`;
    const gemsLeft = adsLeft(s, 'gems', now);
    const freeGems = this.ads
      ? `<div class="free-gems" id="shop-gems">${ico('gem', 'huge')}<div class="fg-text"><b>Free gems</b><small>${gemsLeft ? `Watch a short ad for ${ECONOMY.adGems} gems. ${gemsLeft} left today.` : 'That’s all the free gems for today. More tomorrow!'}</small></div>
        ${gemsLeft ? this.gemsButton('btn primary') : ''}</div>`
      : '';
    return `<div class="shop">
      ${freeGems}
      <h3>Crates</h3>${crate('supply')}${crate('egg')}
      <h3>Daily Deals <small data-timer="${new Date(new Date(now).setHours(24, 0, 0, 0)).getTime()}"></small></h3>${deals}
      <h3>Energy</h3>${energyRow}
      <h3>Rampage Pass</h3><div class="offers">
        <div class="offer-card"><div class="oc-head"><b>Rampage Pass</b><em>Season ${s.pass.season}</em></div><p class="tiny">Free rewards every tier, plus a bonus reward on every tier: gems, Kaiju Eggs and the Zombie skin.</p><button class="btn primary" data-act="pass">${featureOpen(s, 'pass') ? 'Open pass' : `Unlocks at level ${FEATURES.pass}`}</button></div></div>
      <h3>Skins</h3><div class="skins">${skins}</div>
    </div>`;
  }

  // ------------------------------------------------------------------ Kaiju
  kaijuTab() {
    const s = this.save;
    return `<div class="roster">${Object.values(KAIJU).map((kd) => {
      const open = s.unlocked[kd.id];
      const ks = kaijuState(s, kd.id);
      const shards = s.cur.shards[kd.id] || 0;
      const meta = KAIJU_META[kd.id];
      const need = open ? nextStarCost(s, kd.id) : SHARD_UNLOCK;
      const sel = s.lastKaiju === kd.id;
      const masteryLv = Math.floor(Math.sqrt(ks.mastery / 100));
      let action = '';
      if (open) action = sel ? '<span class="tag">Selected</span>' : `<button class="btn primary" data-act="pickkaiju" data-id="${kd.id}">Select</button>`;
      else if (shards >= SHARD_UNLOCK) action = `<button class="btn gold" data-act="unlockkaiju" data-id="${kd.id}">Unlock</button>`;
      else if (meta.gems) action = `<button class="btn primary" data-act="unlockkaiju" data-id="${kd.id}" data-how="gems">${ico('gem')}${hfmt(meta.gems)}</button>`;
      return `<div class="kcard2 ${open ? '' : 'locked'} ${sel ? 'sel' : ''}" style="--kc:${kd.color}">
        <i class="kport big"></i>
        <div class="kinfo"><b>${kd.name}</b><small>${kd.rarity} · ${kd.ability}</small>
          <span class="kstars">${open ? '★'.repeat(ks.stars) + '☆'.repeat(5 - ks.stars) : meta.unlock}</span>
          ${need ? `<span class="shardbar"><i style="width:${Math.min(100, (100 * shards) / need)}%"></i><small>${ico('shard')}${shards}/${need}</small></span>` : '<small>Max stars</small>'}
          ${open ? `<small class="muted">Mastery ${masteryLv}</small>` : ''}
        </div>
        <div class="kact">${action}${open && need && shards >= need ? `<button class="btn gold" data-act="starup" data-id="${kd.id}">Star up</button>` : ''}</div>
      </div>`;
    }).join('')}<p class="tiny muted">Shards come from Kaiju Eggs, Daily Deals and packs. Each star adds 8% attack and health.</p></div>`;
  }

  // ------------------------------------------------------------------ Mutations
  mutationsTab() {
    const s = this.save;
    const cost = mutationCost(s);
    const rows = [1, 2, 3, 4, 5].map((row) => {
      const ms = MUTATIONS.filter((m) => m.row === row);
      const open = mutationOpen(s, ms[0]);
      return `<div class="mut-row ${open ? '' : 'locked'}">${open ? '' : `<span class="lock">Account level ${MUTATION_ROW_LEVEL[row]}</span>`}${ms.map((m) => {
        const lv = mutationLevel(s, m.id);
        const max = lv >= m.max;
        return `<button class="mut ${max ? 'max' : ''}" data-act="mutate" data-id="${m.id}" ${open && !max ? '' : 'disabled'}>
          ${ico(`mut-${m.id}`)}<b>${m.name}</b><small>${m.text}</small><span class="mlv">${lv}/${m.max}</span></button>`;
      }).join('')}</div>`;
    }).join('');
    return `<div class="mutations">
      <div class="mut-head"><span>Next node: ${ico('scrap')}${hfmt(cost.scrap)}${cost.geneCores ? ` + ${ico('gene')}1 Gene Core` : ''}</span><span>${ico('gene')}${s.cur.geneCores} Gene Cores</span></div>
      ${rows}
      <p class="tiny muted">Gene Cores come from first clears. Every 10th node needs one.</p></div>`;
  }

  // ------------------------------------------------------------------ modals
  openModal(kind, html) {
    this.modalKind = kind;
    this.modal.innerHTML = html;
    this.modal.classList.remove('hidden');
    this.modal.dataset.kind = kind;
  }

  // Rewarded ads can be offered (not switched off for this session, and no ad blocker).
  get ads() {
    return this.platform.rewardedAds;
  }

  // Rewarded ads just became unavailable: redraw so no ad button is left that can't pay out.
  adsChanged() {
    if (!this.visible) return;
    this.render();
    const kind = this.modalKind;
    if (kind === 'wheel' && !this.spinning) this.openWheel();
    else if (kind === 'pass') this.openPass();
    else if (kind === 'patrol') this.openPatrol(true);
    else if (kind === 'energy') this.openEnergy();
    else if (kind === 'results' || kind === 'revive') for (const b of this.modal.querySelectorAll('.btn.ad')) b.remove();
  }

  closeModal() {
    this.modalKind = null;
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
    if (this.afterClose) {
      const f = this.afterClose;
      this.afterClose = null;
      f();
    }
  }

  showRewards(title, reward, { sub = '', onClose = null } = {}) {
    this.sfx.ding(2);
    this.afterClose = onClose;
    this.openModal('rewards', `<div class="panel small rewards-panel"><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}
      <div class="rlist">${rewardChips(reward, 'big pop')}</div>
      <button class="btn primary big" data-act="close">Collect</button></div>`);
  }

  // A rewarded ad for `placement`; `then` runs only once it has played to the end.
  watchAd(placement, then) {
    this.platform.showAd('rewarded').then((ok) => {
      if (ok) then();
      else if (!this.ads) this.toast('Video rewards aren’t available right now.');
      else this.toast('No ad available right now. Try again in a moment.');
    });
  }

  // Stands in for a real ad where the CrazyGames SDK isn't present: a short countdown.
  adPlaceholder(kind) {
    return new Promise((resolve) => {
      const el = this.adEl;
      let t = kind === 'midgame' ? 2 : 3;
      el.innerHTML = `<div class="ad-screen"><b>${kind === 'midgame' ? 'Ad break' : 'Rewarded ad'}</b><small>A real ad plays here on CrazyGames</small><span class="ad-count">${t}</span></div>`;
      el.classList.remove('hidden');
      const timer = setInterval(() => {
        t--;
        const c = hq(el, '.ad-count');
        if (c) c.textContent = t;
        if (t > 0) return;
        clearInterval(timer);
        el.classList.add('hidden');
        el.innerHTML = '';
        resolve(true);
      }, 1000);
    });
  }

  openOdds(id) {
    const odds = crateOdds(id);
    this.openModal('odds', `<div class="panel small"><h2>${CRATES[id].name} odds</h2>
      <table class="odds">${odds.map((o) => `<tr><td style="color:${o.rarity.color}">${o.rarity.name}</td><td>${o.pct.toFixed(1)}%</td></tr>`).join('')}</table>
      <p class="tiny muted">${id === 'supply' ? 'A Rare is guaranteed within 10 opens.' : 'An Epic is guaranteed every 10 opens and a Legendary by the 50th. Each egg also holds 1 to 3 kaiju shards.'} Every piece is equally likely within its rarity.</p>
      <button class="btn primary" data-act="close">OK</button></div>`);
  }

  // Crate opening: the crate shakes, then each card spins like a slot reel and lands with a ding.
  openCrateAnim(id, drops) {
    const best = Math.max(...drops.map((d) => d.item.rarity));
    const many = drops.length > 1;
    this.openModal('crate', `<div class="crate-open ${many ? 'many' : ''}" style="--rc:${RARITY[best].color}">
      <div class="crate-shake">${ico(id === 'egg' ? 'egg' : 'crate', 'huge')}</div>
      <div class="crate-cards">${drops.map((d, i) => {
        const g = GEAR[d.item.id];
        const r = RARITY[d.item.rarity];
        return `<div class="ccard" style="--rc:${r.color};--d:${i}"><div class="reel"><div class="strip">${GEAR_SLOTS.map((sl) => ico(`slot-${sl.id}`)).join('')}${GEAR_SLOTS.map((sl) => ico(`slot-${sl.id}`)).join('')}</div></div>
          <div class="face">${ico(`slot-${g.slot}`, 'big')}<b>${g.name}</b><small>${r.name}</small>${d.extra ? `<div class="extra">${rewardChips(d.extra)}</div>` : ''}</div></div>`;
      }).join('')}</div>
      <button class="btn primary big done-btn" data-act="close">Collect</button></div>`);
    const root = this.modal;
    const cards = [...root.querySelectorAll('.ccard')];
    const step = many ? 260 : 0;
    root.querySelector('.crate-open').classList.add('opening');
    this.sfx.tick();
    const spinTicks = setInterval(() => this.sfx.tick(), 70);
    cards.forEach((c, i) => {
      // The best card of a 10-open is held back for last.
      const isBest = many && drops[i].item.rarity === best && i === drops.findIndex((d) => d.item.rarity === best);
      const at = 700 + (isBest ? cards.length * step + 400 : i * step);
      setTimeout(() => {
        c.classList.add('landed');
        this.sfx.ding(drops[i].item.rarity);
        if (drops[i].item.rarity >= 3) root.querySelector('.crate-open').classList.add('flash');
      }, at);
    });
    const total = 700 + (many ? cards.length * step + 400 : 0) + 200;
    setTimeout(() => {
      clearInterval(spinTicks);
      root.querySelector('.crate-open')?.classList.add('done');
    }, total);
  }

  openQuests(weekly = false) {
    const s = this.save;
    const list = weekly ? WEEKLY_QUESTS : DAILY_QUESTS;
    const book = weekly ? s.weekly : s.daily;
    const reward = weekly ? WEEKLY_QUEST_REWARD : DAILY_QUEST_REWARD;
    const all = list.every((q) => book.claimed[q.id]);
    this.openModal('quests', `<div class="panel small quests-panel"><h2>Quests</h2>
      <div class="segs"><button class="seg ${weekly ? '' : 'on'}" data-act="quests" data-weekly="0">Daily</button><button class="seg ${weekly ? 'on' : ''}" data-act="quests" data-weekly="1">Weekly</button></div>
      <div class="qlist">${list.map((q) => {
        const st = questState(s, q, weekly);
        const pct = (100 * st.have) / st.goal;
        return `<div class="quest ${st.claimed ? 'claimed' : ''}"><div class="qtext"><b>${q.text}</b><span class="qbar"><i style="width:${pct}%"></i><small>${q.goal >= 1e6 ? `${hmoney(st.have)}/${hmoney(st.goal)}` : `${hfmt(st.have)}/${hfmt(st.goal)}`}</small></span></div>
          <div class="qrew">${rewardChips(reward)}</div>
          <button class="btn ${st.done && !st.claimed ? 'gold' : 'ghost'}" data-act="claimquest" data-id="${q.id}" data-weekly="${weekly ? 1 : 0}" ${st.done && !st.claimed ? '' : 'disabled'}>${st.claimed ? 'Done' : 'Claim'}</button></div>`;
      }).join('')}</div>
      <button class="btn ${all && !book.bonus ? 'gold' : 'ghost'} wide" data-act="questbonus" data-weekly="${weekly ? 1 : 0}" ${all && !book.bonus ? '' : 'disabled'}>${book.bonus ? 'Bonus claimed' : `All done: ${weekly ? 'a Kaiju Egg' : 'a Supply Crate'}`}</button>
      <button class="btn primary" data-act="close">Close</button></div>`);
  }

  openLogin() {
    const s = this.save;
    const ready = loginReady(s, this.now());
    const at = s.login.index % LOGIN_REWARDS.length;
    this.openModal('login', `<div class="panel small login-panel"><h2>Daily rewards</h2><p class="muted">Come back every day. Day 7 is a Kaiju Egg.</p>
      <div class="days">${LOGIN_REWARDS.map((r, i) => `<div class="day ${i < at ? 'got' : ''} ${i === at && ready ? 'today' : ''}"><small>Day ${i + 1}</small>${rewardChips(r)}</div>`).join('')}</div>
      <button class="btn ${ready ? 'gold' : 'ghost'} big" data-act="claimlogin" ${ready ? '' : 'disabled'}>${ready ? 'Claim' : 'Come back tomorrow'}</button>
      <button class="btn primary" data-act="close">Close</button></div>`);
  }

  openPass() {
    const s = this.save;
    const tier = passTier(s);
    const xpIn = s.pass.xp - tier * PASS.xpPerTier;
    const rows = [];
    for (let t = 1; t <= PASS.tiers; t++) {
      const reached = t <= tier;
      const fr = passReward(t, false);
      const pr = passReward(t, true);
      const fc = s.pass.free[t];
      const pc = s.pass.prem[t];
      rows.push(`<div class="ptier ${reached ? 'reached' : ''}"><span class="pn">${t}</span>
        <button class="prew free ${fc ? 'got' : ''}" data-act="claimpass" data-t="${t}" data-p="0" ${reached && !fc ? '' : 'disabled'}>${rewardChips(fr)}</button>
        <button class="prew prem ${pc ? 'got' : ''} ${reached && !pc && this.ads ? 'adclaim' : ''}" data-act="claimpass" data-t="${t}" data-p="1" ${reached && !pc ? '' : 'disabled'}>${rewardChips(pr)}${reached && !pc && !this.ads ? `<i class="pcost">${ico('gem')}${ECONOMY.passBonusGems}</i>` : ''}</button></div>`);
    }
    this.openModal('pass', `<div class="panel pass-panel"><h2>Rampage Pass · Season ${s.pass.season}</h2>
      <p class="muted">Tier ${tier}/${PASS.tiers} · ends in <span data-timer="${this.now() + passEndsIn(s, this.now())}">${hclock(passEndsIn(s, this.now()))}</span></p>
      <span class="qbar"><i style="width:${tier >= PASS.tiers ? 100 : (100 * xpIn) / PASS.xpPerTier}%"></i><small>${tier >= PASS.tiers ? 'Complete' : `${xpIn}/${PASS.xpPerTier} XP`}</small></span>
      <div class="pcols"><span></span><b>Free</b><b class="gold">${this.ads ? 'Bonus · watch an ad' : `Bonus · ${ico('gem')}${ECONOMY.passBonusGems} each`}</b></div>
      <div class="ptiers">${rows.join('')}</div>
      <div class="row"><button class="btn ghost" data-act="close">Close</button></div>
      <p class="tiny muted">Pass XP comes from daily quests and every run. ${this.ads ? 'Each bonus reward is one short ad.' : `Each bonus reward costs ${ECONOMY.passBonusGems} gems.`}</p></div>`);
  }

  openPatrol(refresh = false) {
    const s = this.save;
    const now = this.now();
    const p = patrolPending(s, now);
    const rate = patrolRate(s, now);
    const html = `<div class="panel small patrol-panel"><h2>Patrol</h2><p class="muted">Your kaiju rampages while you are away: up to ${ECONOMY.patrolCapHours} hours.</p>
      <div class="patrol-art">${ico('patrol', 'huge')}<span class="qbar"><i style="width:${(100 * p.hours) / ECONOMY.patrolCapHours}%"></i><small>${p.hours.toFixed(1)}h / ${ECONOMY.patrolCapHours}h</small></span></div>
      <div class="rlist">${rewardChips({ scrap: p.scrap, dnaAny: p.dna, xp: p.xp })}</div>
      <p class="tiny">${hfmt(rate.scrap)} scrap an hour. Clear chapters to raise it.</p>
      <button class="btn gold big" data-act="claimpatrol" ${p.scrap > 0 ? '' : 'disabled'}>Collect</button>
      <h3>Quick Patrol: 2 hours now</h3>
      <div class="row">
        <button class="btn primary" data-act="quickpatrol" data-how="energy" ${s.daily.quickPatrols < ECONOMY.quickPatrolPerDay ? '' : 'disabled'}>${ico('energy')}${ECONOMY.quickPatrolEnergy} (${ECONOMY.quickPatrolPerDay - s.daily.quickPatrols} left)</button>
        ${this.ads ? `<button class="btn primary ad" data-act="quickpatrol" data-how="ad" ${adsLeft(s, 'patrol', now) ? '' : 'disabled'}>Free</button>` : ''}
      </div>
      <button class="btn primary" data-act="close">Close</button></div>`;
    if (refresh) {
      if (this.modalKind === 'patrol') this.modal.innerHTML = html;
      return;
    }
    this.openModal('patrol', html);
  }

  // The Lucky Wheel: eight slices on a gold rim of chasing lights. A spin is one rewarded ad; the
  // wheel winds down past the pointer (a click per slice), the winning slice flashes, then the
  // reward shows. The wheel remembers where it stopped.
  openWheel() {
    const s = this.save;
    const n = WHEEL.length;
    const step = 360 / n;
    const R = 100;
    const pt = (deg, r) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    };
    const jackpot = (w) => Boolean(w.reward.keys && w.reward.keys.egg);
    const slices = WHEEL.map((w, i) => `<path class="wsl" data-i="${i}" d="M0 0 L${pt(i * step, R)} A${R} ${R} 0 0 1 ${pt((i + 1) * step, R)} Z" fill="url(#${jackpot(w) ? 'wjack' : i % 2 ? 'wb' : 'wa'})"/>`).join('');
    const dividers = WHEEL.map((_, i) => {
      const [x, y] = pt(i * step, R).split(' ');
      return `<line x1="0" y1="0" x2="${x}" y2="${y}"/>`;
    }).join('');
    const labels = WHEEL.map((w, i) => {
      const part = rewardParts(w.reward)[0];
      const text = w.reward.keys ? (w.reward.keys.egg ? 'EGG!' : 'Crate') : part.text;
      return `<div class="wseg ${jackpot(w) ? 'jackpot' : ''}" style="--a:${(i + 0.5) * step}deg"><span>${ico(part.icon)}<b>${text}</b></span></div>`;
    }).join('');
    const bulbs = Array.from({ length: 16 }, (_, i) => {
      const [x, y] = pt(i * 22.5, 104).split(' ');
      return `<circle class="bulb ${i % 2 ? 'b2' : 'b1'}" cx="${x}" cy="${y}" r="3.4"/>`;
    }).join('');
    const left = adsLeft(s, 'wheel', this.now());
    this.openModal('wheel', `<div class="panel small wheel-panel"><h2>Lucky Wheel</h2>
      <div class="wheel-wrap">
        <div class="wheel" style="transform: rotate(${this.wheelAngle || 0}deg)">
          <svg class="wheel-face" viewBox="-100 -100 200 200" aria-hidden="true">
            <defs>
              <radialGradient id="wa" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse"><stop offset="0.15" stop-color="#4a63b0"/><stop offset="1" stop-color="#1f2b5c"/></radialGradient>
              <radialGradient id="wb" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse"><stop offset="0.15" stop-color="#7a4fb8"/><stop offset="1" stop-color="#33205e"/></radialGradient>
              <radialGradient id="wjack" cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse"><stop offset="0.15" stop-color="#fff0a0"/><stop offset="1" stop-color="#d08a18"/></radialGradient>
            </defs>
            <g class="wsls">${slices}</g>
            <g class="wdiv">${dividers}</g>
          </svg>
          ${labels}
        </div>
        <svg class="wheel-rim" viewBox="-112 -112 224 224" aria-hidden="true">
          <defs><linearGradient id="wrim" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#ffe9a0"/><stop offset="0.5" stop-color="#e0a83a"/><stop offset="1" stop-color="#9a6416"/></linearGradient></defs>
          <circle r="104" fill="none" stroke="#0d0e14" stroke-width="13"/>
          <circle r="104" fill="none" stroke="url(#wrim)" stroke-width="9"/>
          ${bulbs}
        </svg>
        <div class="wheel-hub">${ico('gem')}</div>
        <svg class="wheel-pin" viewBox="0 0 40 52" aria-hidden="true"><path d="M20 50 L5 16 A15.5 15.5 0 1 1 35 16 Z" fill="#ff4d5a" stroke="#0d0e14" stroke-width="3"/><circle cx="20" cy="16" r="6" fill="#ffe27a" stroke="#0d0e14" stroke-width="2"/></svg>
      </div>
      <div class="row wheel-btns">
        <button class="btn primary big ${this.ads ? 'ad' : ''}" data-act="spin" ${left && !this.spinning ? '' : 'disabled'}>${left ? (this.ads ? 'Spin' : `Spin ${ico('gem')}${ECONOMY.wheelGems}`) : 'Come back tomorrow'}</button>
        <button class="btn primary big" data-act="close">Close</button>
      </div>
      <p class="tiny muted">${this.wheelNote(left)}</p></div>`);
  }

  wheelNote(left) {
    return `${left} of ${AD_PLACEMENTS.wheel.cap} spins left today · ${this.ads ? 'one short ad each' : `${ECONOMY.wheelGems} gems each`}`;
  }

  spin() {
    const wrap = hq(this.modal, '.wheel-wrap');
    const wheel = wrap && hq(wrap, '.wheel');
    if (!wheel || this.spinning) return;
    const s = this.save;
    const res = spinWheel(s, this.now(), this.rng, this.ads ? 'ad' : 'gems');
    if (!res) {
      this.toast(adsLeft(s, 'wheel', this.now()) ? 'Not enough gems' : 'No spins left today');
      return;
    }
    this.persist();
    this.spinning = true;
    const note = hq(this.modal, '.wheel-panel .tiny');
    if (note) note.textContent = this.wheelNote(adsLeft(s, 'wheel', this.now()));
    const n = WHEEL.length;
    const step = 360 / n;
    const from = this.wheelAngle || 0;
    // Slice i's middle sits (i + 0.5) slices clockwise of the pointer at rest; six turns, then
    // stop with it under the pointer, a little off-centre so it doesn't look rigged.
    const land = 360 - (res.index + 0.5) * step + (this.rng.next() - 0.5) * step * 0.6;
    const to = from - (from % 360) + 6 * 360 + land;
    this.wheelAngle = ((to % 360) + 360) % 360;
    wrap.classList.add('spinning');
    const btn = hq(this.modal, '[data-act="spin"]');
    if (btn) btn.disabled = true;
    const pin = hq(wrap, '.wheel-pin');
    const anim = wheel.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], { duration: 4200, easing: 'cubic-bezier(0.1, 0.7, 0.15, 1)', fill: 'forwards' });
    // A click and a flick of the pointer as each slice goes past.
    let lastSlice = null;
    const watch = () => {
      if (!this.spinning || !wheel.isConnected) return;
      const m = new DOMMatrixReadOnly(getComputedStyle(wheel).transform);
      const ang = (((Math.atan2(m.b, m.a) * 180) / Math.PI) % 360 + 360) % 360;
      const slice = Math.floor(ang / step);
      if (lastSlice !== null && slice !== lastSlice) {
        this.sfx.tick();
        pin.classList.remove('tick');
        void pin.getBoundingClientRect();
        pin.classList.add('tick');
      }
      lastSlice = slice;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    anim.onfinish = () => {
      this.spinning = false;
      wrap.classList.remove('spinning');
      const won = WHEEL[res.index];
      const big = Boolean(won.reward.keys && won.reward.keys.egg);
      hq(wrap, `.wsl[data-i="${res.index}"]`)?.classList.add('win');
      wrap.querySelectorAll('.wseg')[res.index]?.classList.add('win');
      this.sfx.ding(big ? 4 : 2);
      this.render();
      setTimeout(() => this.showRewards('Lucky Wheel', res.reward, { onClose: () => this.openWheel() }), 900);
    };
  }

  openSettings() {
    const s = this.save;
    this.openModal('settings', `<div class="panel small"><h2>Account</h2>
      <p>Level ${s.account.level} · ${s.runs} runs · ${s.wins} wins</p>
      <p class="tiny muted">Best damage: ${hmoney(s.stats.bestDamage)}</p>
      <div class="col">
        ${this.debug ? `<button class="btn ghost" data-act="dev" data-what="rich">Dev: +10,000 gems, +1M scrap, +500 DNA</button>
        <button class="btn ghost" data-act="dev" data-what="level">Dev: +5 account levels</button>
        <button class="btn ghost" data-act="dev" data-what="unlock">Dev: unlock every feature</button>
        <button class="btn ghost" data-act="dev" data-what="energy">Dev: refill energy</button>
        <button class="btn ghost" data-act="dev" data-what="time">Dev: skip 6 hours</button>
        <button class="btn ghost" data-act="dev" data-what="reset">Dev: reset save</button>` : ''}
        <button class="btn primary" data-act="close">Close</button>
      </div></div>`);
  }

  openEnergy() {
    const s = this.save;
    const now = this.now();
    this.openModal('energy', `<div class="panel small"><h2>Energy</h2><p class="muted">Each run costs ${ECONOMY.energyPerRun}. One point returns every 12 minutes.</p>
      <div class="col">
        ${this.ads ? `<button class="btn primary ad" data-act="adenergy" ${adsLeft(s, 'energy', now) ? '' : 'disabled'}>${ico('energy')}+${ECONOMY.energyAd} (${adsLeft(s, 'energy', now)} left today)</button>` : ''}
        <button class="btn primary" data-act="buyenergy" ${s.daily.energyBuys < ECONOMY.energyGemPack.perDay ? '' : 'disabled'}>${ico('energy')}+${ECONOMY.energyGemPack.energy} for ${ico('gem')}${ECONOMY.energyGemPack.gems}</button>
        <button class="btn primary" data-act="close">Close</button></div></div>`);
  }

  // The results screen: what the run paid, with the doubling ad and the next step.
  showRunResults(results, rewards, ctx, { onDouble, onContinue, onAgain, doubled = false }) {
    const s = this.save;
    const m = doubled ? 2 : 1;
    const won = results.won;
    const ch = CHAPTERS[ctx.chapter - 1];
    const adLeft = adsLeft(s, 'double', this.now());
    const notes = [];
    if (rewards.firstClear) notes.push(`First clear of ${ch.name}! Chapter ${Math.min(CHAPTERS.length, ctx.chapter + 1)} unlocked.`);
    if (rewards.milestones) notes.push(`Milestones: ${rewards.milestones.map((m) => (m === 6 ? 'Apex' : `size ${m}`)).join(', ')}`);
    if (rewards.firstBosses) notes.push(`${rewards.firstBosses} new boss kill${rewards.firstBosses > 1 ? 's' : ''}`);
    this.openModal('results', `<div class="panel results2 ${won ? 'won' : 'lost'}">
      <h1>${won ? 'City claimed!' : 'Rampage over'}</h1>
      <p class="muted">Chapter ${ctx.chapter} · ${ch.name} · ${MODES[ctx.mode].name}</p>
      <div class="damage">${ico('cash')}<b>${hmoney(results.damage || 0)}</b><small>in damages</small></div>
      <div class="stats-row"><span><b>${results.stage}</b><small>size</small></span><span><b>${hfmt(results.buildings)}</b><small>toppled</small></span><span><b>${hfmt(results.people)}</b><small>eaten</small></span><span><b>${(results.gateKills || []).length}</b><small>bosses</small></span></div>
      ${notes.map((n) => `<p class="note">${n}</p>`).join('')}
      <h3>Rewards</h3>
      <div class="rlist ${doubled ? 'doubled' : ''}">${rewardChips({ scrap: rewards.scrap * m, gems: rewards.gems, dna: Object.fromEntries(Object.entries(rewards.dna).map(([k, v]) => [k, v * m])), items: rewards.items, geneCores: rewards.geneCores, xp: rewards.xp, passXp: rewards.passXp * m }, doubled ? 'big' : 'big pop')}</div>
      <div class="row">
        ${this.ads || doubled ? `<button class="btn primary ${doubled ? '' : 'ad'}" data-act="resdouble" ${adLeft && !doubled ? '' : 'disabled'}>${doubled ? 'Doubled!' : `2× rewards (${adLeft} left)`}</button>` : ''}
        <button class="btn primary" data-act="resagain">Again ${ico('energy')}${ECONOMY.energyPerRun}</button>
        <button class="btn primary" data-act="rescontinue">Continue</button>
      </div></div>`);
    this.results = { onDouble, onContinue, onAgain };
  }

  // Down: free revive, ad revive, gem revive, or give up. The ad revive is a one-off offer
  // against a countdown (and "Give up" is just as big); when the countdown runs out, the run ends.
  // Returns whether an ad was offered.
  showRevive({ free, ad, gems, onRevive, onGiveUp }) {
    const s = this.save;
    const adOffer = ad && !free && this.ads;
    this.openModal('revive', `<div class="panel small revive2"><h2>Knocked down!</h2><p class="muted">Get back up at half health with a shockwave.</p>
      <div class="col">
        ${free ? '<button class="btn gold big" data-act="rev" data-how="free">Revive (Nine Lives)</button>' : ''}
        ${adOffer ? `<button class="btn primary big ad" data-act="rev" data-how="ad">Revive <span class="rev-count">${REVIVE_OFFER}</span></button>` : ''}
        ${!free && !adOffer && gems ? `<button class="btn primary big" data-act="rev" data-how="gems" ${s.cur.gems >= gems ? '' : 'disabled'}>Revive ${ico('gem')}${gems}</button>` : ''}
        <button class="btn primary big" data-act="rev" data-how="quit">Give up</button>
      </div></div>`);
    this.revive = { onRevive, onGiveUp, gems };
    clearInterval(this.reviveTimer);
    if (adOffer) {
      let left = REVIVE_OFFER;
      this.reviveTimer = setInterval(() => {
        if (this.modalKind !== 'revive') return clearInterval(this.reviveTimer);
        if (this.platform.adPlaying) return null; // the countdown waits while the ad plays
        left--;
        const el = hq(this.modal, '.rev-count');
        if (el) el.textContent = left;
        if (left > 0) return null;
        clearInterval(this.reviveTimer);
        this.closeModal();
        onGiveUp();
        return null;
      }, 1000);
    }
    return adOffer;
  }

  // ------------------------------------------------------------------ actions
  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const s = this.save;
    const now = this.now();
    const d = b.dataset;
    this.sfx.click();
    switch (d.act) {
      case 'close':
        this.closeModal();
        break;
      case 'tab': {
        const t = NAV.find((x) => x.id === d.tab);
        if (t && t.feature && !featureOpen(s, t.feature)) {
          this.toast(`${t.name} opens at account level ${FEATURES[t.feature]}. Play runs to level up.`);
          break;
        }
        this.closeModal();
        this.tab = d.tab;
        this.render();
        if (d.scroll === 'gems') setTimeout(() => hq(this.body, '#shop-gems')?.scrollIntoView({ block: 'start' }), 30);
        break;
      }
      case 'chapter':
        s.chapter.selected = Math.max(1, Math.min(s.chapter.unlocked, s.chapter.selected + Number(d.dir)));
        if (!s.chapter.cleared[`${s.chapter.selected}:normal`]) s.chapter.mode = 'normal';
        this.commit();
        break;
      case 'mode':
        s.chapter.mode = d.mode;
        this.commit();
        break;
      case 'play':
        syncEnergy(s, now);
        if (s.cur.energy < ECONOMY.energyPerRun) {
          this.openEnergy();
          break;
        }
        this.onPlay({ kaijuId: s.lastKaiju, chapter: s.chapter.selected, mode: s.chapter.mode });
        break;
      case 'energy':
        this.openEnergy();
        break;
      case 'settings':
        this.openSettings();
        break;
      case 'item':
        this.openItem(Number(d.uid));
        break;
      case 'levelup':
        if (levelUp(s, Number(d.uid))) {
          this.sfx.ding(1);
          this.persist();
          this.render();
          this.openItem(Number(d.uid));
        }
        break;
      case 'merge':
        if (merge(s, Number(d.uid))) {
          this.sfx.ding(itemByUid(s, Number(d.uid)).rarity);
          this.persist();
          this.render();
          this.openItem(Number(d.uid));
        }
        break;
      case 'equip':
        equip(s, Number(d.uid));
        this.closeModal();
        this.commit();
        break;
      case 'unequip':
        unequip(s, GEAR[itemByUid(s, Number(d.uid)).id].slot);
        this.closeModal();
        this.commit();
        break;
      case 'resetitem': {
        const back = resetItem(s, Number(d.uid));
        if (back) this.toast(`Refunded ${hfmt(back.scrap)} scrap and ${back.dna} DNA`);
        this.persist();
        this.render();
        this.openItem(Number(d.uid));
        break;
      }
      case 'autoequip':
        for (const sl of GEAR_SLOTS) {
          const best = this.bestFor(sl.id);
          if (best) s.gear.equipped[sl.id] = best.uid;
        }
        this.commit();
        break;
      case 'slotinfo':
        this.openSlotInfo(d.slot);
        break;
      case 'gearhelp':
        this.openGearHelp();
        break;
      case 'scrap':
        this.toast('Scrap levels up your gear. Every run pays some.');
        break;
      case 'mergeall': {
        const n = mergeAll(s);
        this.toast(n ? `Merged ${n} time${n > 1 ? 's' : ''}` : 'Nothing to merge yet');
        if (n) this.sfx.ding(2);
        this.commit();
        break;
      }
      case 'crate': {
        const run = () => {
          const drops = openCrate(s, d.id, d.how, Number(d.n || 1), this.now(), this.rng);
          if (!drops) return this.toast(d.how === 'gems' ? 'Not enough gems' : 'Not available');
          autoEquip(s);
          this.persist();
          this.render();
          this.openCrateAnim(d.id, drops);
          return null;
        };
        if (d.how === 'ad') this.watchAd(d.id === 'egg' ? 'egg' : 'crate', run);
        else if (d.how === 'gems' && !canAfford(s, { gems: Number(d.n) === 10 ? CRATES[d.id].ten : CRATES[d.id].gems })) this.toast('Not enough gems');
        else run();
        break;
      }
      case 'odds':
        this.openOdds(d.id);
        break;
      case 'deal': {
        const deal = s.daily.deals[Number(d.i)];
        const run = () => {
          const out = buyDeal(s, Number(d.i), this.now(), this.rng);
          if (!out) return this.toast('Not enough to buy that');
          autoEquip(s);
          this.persist();
          this.showRewards('Daily Deal', out);
          this.render();
          return null;
        };
        if (deal.cost.ad) this.watchAd('deal', run);
        else run();
        break;
      }
      case 'skin':
        s.skins.equipped = s.skins.equipped === d.id ? null : d.id;
        this.commit();
        break;
      case 'buyskin':
        if (buySkin(s, d.id)) {
          s.skins.equipped = d.id;
          this.sfx.cash();
          this.commit();
        } else this.toast('Not enough gems');
        break;
      case 'adenergy':
        this.watchAd('energy', () => {
          if (adEnergy(s, this.now())) this.toast(`+${ECONOMY.energyAd} energy`);
          this.commit();
          if (this.modalKind === 'energy') this.openEnergy();
        });
        break;
      case 'buyenergy':
        if (buyEnergy(s, now)) this.toast(`+${ECONOMY.energyGemPack.energy} energy`);
        else this.toast('Not enough gems');
        this.commit();
        if (this.modalKind === 'energy') this.openEnergy();
        break;
      case 'adgems':
        if (adWait(s, 'gems', now) > 0 || adsLeft(s, 'gems', now) <= 0) break;
        this.watchAd('gems', () => {
          if (adGems(s, this.now())) {
            this.sfx.cash();
            this.toast(`+${ECONOMY.adGems} gems`);
          }
          this.commit();
        });
        break;
      case 'quests':
        this.openQuests(d.weekly === '1');
        break;
      case 'claimquest': {
        const out = claimQuest(s, d.id, d.weekly === '1', this.rng);
        if (out) {
          this.sfx.ding(1);
          this.persist();
          this.openQuests(d.weekly === '1');
          this.render();
        }
        break;
      }
      case 'questbonus': {
        const out = claimQuestBonus(s, d.weekly === '1', this.rng);
        if (out) {
          this.persist();
          this.showRewards('Quest bonus', out, { onClose: () => this.openQuests(d.weekly === '1') });
          this.render();
        }
        break;
      }
      case 'login':
        this.openLogin();
        break;
      case 'claimlogin': {
        const out = claimLogin(s, now, this.rng);
        if (out) {
          this.persist();
          this.showRewards(`Day ${((s.login.index - 1) % LOGIN_REWARDS.length) + 1}`, out);
          this.render();
        }
        break;
      }
      case 'pass':
        if (!featureOpen(s, 'pass')) this.toast(`Unlocks at account level ${FEATURES.pass}`);
        else this.openPass();
        break;
      case 'claimpass': {
        const claim = (how) => {
          const out = claimPass(s, Number(d.t), d.p === '1', this.rng, this.now(), how);
          if (!out) {
            if (how === 'gems') this.toast('Not enough gems');
            return;
          }
          this.sfx.ding(d.p === '1' ? 3 : 1);
          this.persist();
          this.openPass();
          this.render();
        };
        // The bonus track is one rewarded ad a tier (or a few gems where ads can't be shown).
        if (d.p !== '1') claim();
        else if (this.ads) this.watchAd('pass', () => claim('ad'));
        else claim('gems');
        break;
      }
      case 'patrol':
        this.openPatrol();
        break;
      case 'claimpatrol': {
        const out = claimPatrol(s, now, this.rng);
        if (out) {
          this.persist();
          this.showRewards('Patrol', out, { onClose: () => this.openPatrol() });
          this.render();
        }
        break;
      }
      case 'quickpatrol': {
        const run = () => {
          const out = quickPatrol(s, d.how, this.now(), this.rng);
          if (!out) return this.toast('Not available');
          this.persist();
          this.showRewards('Quick Patrol', out, { onClose: () => this.openPatrol() });
          this.render();
          return null;
        };
        if (d.how === 'ad') {
          if (adsLeft(s, 'patrol', now) <= 0) break;
          this.watchAd('patrol', () => {
            // The ad is the payment: quickPatrol books it against the daily cap.
            run();
          });
        } else run();
        break;
      }
      case 'wheel':
        this.openWheel();
        break;
      case 'spin':
        if (this.spinning || adsLeft(s, 'wheel', now) <= 0) break;
        if (this.ads) this.watchAd('wheel', () => this.spin());
        else this.spin();
        break;
      case 'pickkaiju':
        s.lastKaiju = d.id;
        this.commit();
        break;
      case 'unlockkaiju':
        if (unlockKaiju(s, d.id, d.how || 'shards')) {
          this.sfx.ding(3);
          this.toast(`${KAIJU[d.id].name} unlocked!`);
        } else this.toast('Not enough');
        this.commit();
        break;
      case 'starup':
        if (starUp(s, d.id)) this.sfx.ding(3);
        this.commit();
        break;
      case 'mutate':
        if (buyMutation(s, d.id)) {
          this.sfx.ding(1);
          this.commit();
        } else this.toast('Not enough scrap or Gene Cores');
        break;
      case 'resdouble':
        this.watchAd('double', () => this.results && this.results.onDouble());
        break;
      case 'rescontinue':
        this.closeModal();
        if (this.results) this.results.onContinue();
        break;
      case 'resagain':
        this.closeModal();
        if (this.results) this.results.onAgain();
        break;
      case 'rev': {
        const r = this.revive;
        if (!r) break;
        if (d.how === 'quit') {
          this.closeModal();
          r.onGiveUp();
        } else if (d.how === 'ad') {
          this.watchAd('revive', () => r.onRevive('ad'));
        } else if (d.how === 'gems') {
          if (s.cur.gems < r.gems) break;
          s.cur.gems -= r.gems;
          this.persist();
          this.closeModal();
          r.onRevive('gems');
        } else {
          this.closeModal();
          r.onRevive('free');
        }
        break;
      }
      case 'dev':
        this.dev(d.what);
        break;
      default:
        break;
    }
  }

  dev(what) {
    const s = this.save;
    if (what === 'rich') {
      s.cur.gems += 10000;
      s.cur.scrap += 1e6;
      for (const sl of GEAR_SLOTS) s.cur.dna[sl.id] += 500;
      s.cur.geneCores += 5;
    } else if (what === 'level') {
      s.account.level += 5;
    } else if (what === 'unlock') {
      s.settings.unlockAll = true;
    } else if (what === 'energy') {
      s.cur.energy = energyCap(s, this.now());
    } else if (what === 'time') {
      this.timeShift = (this.timeShift || 0) + 6 * 3600000;
    } else if (what === 'reset') {
      if (this.onReset) this.onReset();
      return;
    }
    this.closeModal();
    this.commit();
  }
}
