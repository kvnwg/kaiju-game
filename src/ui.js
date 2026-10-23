import { STAGES, MAX_STAGE, STAGE_INFO, KAIJU, CITIES, DIFFICULTIES, xpToNext } from './config.js';
import { AUGMENT_BY_ID, setsFor, SYNERGY_SETS, levelText, maxLevel, movesHeld, passivesHeld, MOVE_SLOTS, PASSIVE_SLOTS } from './augments.js';

const $ = (sel) => document.querySelector(sel);

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function iconFor(a) {
  return a.id;
}

function icon(a) {
  return `<i class="aug-ico ico-${iconFor(a)}"></i>`;
}

function fmtNum(n) {
  return Math.round(n).toLocaleString('en-US');
}

export class UI {
  constructor() {
    this.hud = $('#hud');
    this.hpFill = $('#hp .fill');
    this.shieldFill = $('#hp .shield');
    this.hpText = $('#hp span');
    this.growthFill = $('#growth .fill');
    this.growthText = $('#growth span');
    this.growthPct = $('#growth em');
    this.stageNum = $('#stageBadge b');
    this.hpBar = $('#hp');
    this.scrapEl = $('#scrap');
    this.timerEl = $('#timer');
    this.bossbar = $('#bossbar');
    this.bossFill = $('#bossbar .fill');
    this.bossName = $('#bossbar span');
    this.augbar = $('#augbar');
    this.bannerEl = $('#banner');
    this.hintEl = $('#hint');
    this.hintText = $('#hint span');
    this.modals = {
      pick: $('#pick'), revive: $('#revive'), results: $('#results'), menu: $('#menu'), pause: $('#pause'),
    };
    this.augSig = '';
    this.xpFill = $('#xpbar .fill');
    this.xpText = $('#xpbar span');
    this.comboEl = $('#combo');
    this.comboNum = $('#combo b');
    this.comboBar = $('#combo i');
    this.calloutEl = $('#callout');
    this.flashEl = $('#screenFlash');
    this.growthEl = $('#growth');
    this.scrapPill = this.scrapEl.parentElement;
    this.lastCombo = 0;
    this.lastBio = 0;
    this.lastScrap = 0;
    this.bannerTimer = null;
  }

  show(name, on = true) {
    const el = name === 'hud' ? this.hud : this.modals[name];
    el.classList.toggle('hidden', !on);
  }

  hideModals() {
    for (const m of Object.values(this.modals)) m.classList.add('hidden');
  }

  updateHud(game) {
    const k = game.kaiju;
    this.hpFill.style.width = `${(100 * k.hp) / k.maxHp}%`;
    this.shieldFill.style.width = `${Math.min(100, (100 * k.shield) / k.maxHp)}%`;
    this.hpText.textContent = `${fmtNum(k.hp)}/${fmtNum(k.maxHp)}${k.shield > 1 ? ` +${fmtNum(k.shield)}` : ''}`;
    this.hpBar.classList.toggle('low', k.hp < k.maxHp * 0.3);
    const s = STAGES[k.stage];
    const growth = k.stage >= MAX_STAGE ? 1 : Math.min(1, k.biomass / s.biomassToNext);
    this.growthFill.style.width = `${growth * 100}%`;
    this.growthText.textContent = `Size ${k.stage} · ${s.name}`;
    this.growthPct.textContent = k.stage >= MAX_STAGE ? 'MAX' : `${Math.floor(growth * 100)}%`;
    this.stageNum.textContent = k.level;
    this.xpFill.style.width = `${Math.min(100, (100 * k.xp) / xpToNext(k.level))}%`;
    this.xpText.textContent = game.pendingPicks > 1 ? `+${game.pendingPicks} picks` : '';
    this.scrapEl.textContent = fmtNum(game.stats.scrap);
    // Little pops when things go up: the growth bar glows, the coin pill bumps.
    if (k.biomass > this.lastBio + 1e-6) this.retrigger(this.growthEl, 'gain');
    this.lastBio = k.biomass;
    if (Math.floor(game.stats.scrap) > this.lastScrap) this.retrigger(this.scrapPill, 'bump');
    this.lastScrap = Math.floor(game.stats.scrap);
    const c = game.combo;
    const showCombo = c.n >= 3;
    this.comboEl.classList.toggle('on', showCombo);
    if (showCombo) {
      if (c.n !== this.lastCombo) {
        this.comboNum.textContent = `x${c.n}`;
        this.comboEl.dataset.tier = String(c.tier);
        this.retrigger(this.comboEl, 'hit');
      }
      this.comboBar.style.width = `${Math.max(0, c.t / 2.2) * 100}%`;
    }
    this.lastCombo = c.n;
    this.timerEl.textContent = fmtTime(game.time);

    const b = game.boss;
    const bossOn = Boolean(b && !b.dead);
    this.bossbar.classList.toggle('hidden', !bossOn);
    if (bossOn) {
      this.bossName.textContent = b.phase === 2 ? `${b.name} · enraged` : b.name;
      this.bossFill.style.width = `${(100 * b.hp) / b.maxHp}%`;
    }

    const sig = [...game.held.entries()].map(([id, l]) => `${id}${l}`).join(',');
    if (sig !== this.augSig) {
      this.augSig = sig;
      // Moves on top (with a cooldown meter), passives in a smaller row below.
      const tile = ([id, level]) => {
          const a = AUGMENT_BY_ID[id];
          return `<div class="tile tier-${a.tier} kind-${a.kind}" ${a.kind === 'move' ? `data-move="${id}"` : ''} title="${a.name}: ${a.text}">
            ${icon(a)}${a.kind === 'move' ? '<span class="cd"></span>' : ''}<b class="lvl${level >= maxLevel(a) ? ' max' : ''}">${level}</b></div>`;
      };
      const held = [...game.held.entries()].filter(([id]) => AUGMENT_BY_ID[id]);
      const row = (kind) => held.filter(([id]) => AUGMENT_BY_ID[id].kind === kind).map(tile).join('');
      this.augbar.innerHTML = `<div class="aug-row">${row('move')}</div><div class="aug-row">${row('passive')}</div>`;
      this.moveTiles = [...this.augbar.querySelectorAll('[data-move]')].map((el) => ({ el, id: el.dataset.move, cd: el.querySelector('.cd'), last: 1 }));
    }
    for (const t of this.moveTiles || []) {
      const r = game.moves.readiness(t.id);
      t.cd.style.height = `${Math.round((1 - r) * 100)}%`;
      t.el.classList.toggle('ready', r >= 1);
      if (r < t.last - 0.5) {
        t.el.classList.remove('fired');
        void t.el.offsetWidth;
        t.el.classList.add('fired');
      }
      t.last = r;
    }
  }

  retrigger(el, cls) {
    const now = performance.now();
    if (el._last && now - el._last < 90) return;
    el._last = now;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  levelUp() {
    this.retrigger($('#xpbar'), 'ding');
    this.retrigger($('#stageBadge'), 'ding');
  }

  // Big stamped word for combo milestones.
  callout(text, tier = 1) {
    const el = this.calloutEl;
    el.textContent = text;
    el.dataset.tier = String(tier);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  flash(strength = 1) {
    const el = this.flashEl;
    el.style.setProperty('--a', String(0.55 * strength));
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  banner(title, sub = '', kind = '') {
    const el = this.bannerEl;
    el.className = `banner ${kind}`;
    el.innerHTML = `<div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    // Restart the CSS animation.
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  hint(text) {
    if (text) this.hintText.textContent = text;
    this.hintEl.classList.toggle('show', Boolean(text));
  }

  growBanner(stage) {
    const s = STAGES[stage];
    const info = STAGE_INFO[stage];
    this.banner(`Stage ${stage} · ${s.name}`, `${s.size}-sized. Now breaks: ${info.destroys.toLowerCase()}. Incoming: ${info.military.toLowerCase()}.`, 'grow');
  }

  showPick(game, { onChoose, onReroll }) {
    const p = game.pick;
    const el = this.modals.pick;
    const cards = p.options
      .map((id, i) => {
        const a = AUGMENT_BY_ID[id];
        const level = game.level(id);
        const max = a.kind === 'filler' ? 0 : maxLevel(a);
        const next = level + 1;
        const tag = a.kind === 'filler' ? 'Bonus' : level ? `Lv ${level} → ${next}${next === max ? ' · Max' : ''}` : 'New';
        const sets = setsFor(id)
          .map((st) => {
            const have = st.augments.filter((x) => game.has(x) || x === id).length;
            return `<span class="set" title="${st.bonus}">${st.name} ${have}/3</span>`;
          })
          .join('');
        const pips = max > 1 ? `<div class="pips">${Array.from({ length: max }, (_, j) => `<i class="${j < level ? 'on' : j === level ? 'next' : ''}"></i>`).join('')}</div>` : '';
        return `<button class="card tier-${a.tier} kind-${a.kind}${level ? ' upgrade' : ''}" data-id="${id}" style="--i:${i}">
          <div class="card-top"><span class="tier">${a.kind === 'filler' ? 'Bonus' : a.kind}</span><span class="cat">${tag}</span></div>
          <div class="card-main">${icon(a)}<div class="name">${a.name}</div></div>
          <div class="text">${level ? levelText(id, level) : a.text}</div>
          ${pips}
          ${sets ? `<div class="sets">${sets}</div>` : ''}
        </button>`;
      })
      .join('');
    const more = game.pendingPicks > 1 ? `+${game.pendingPicks - 1} queued` : '';
    el.innerHTML = `<div class="panel pick-panel">
        <div class="pick-head">
          <h2>Level ${p.level}!</h2>
          <p><span class="tier-chip tier-silver">Moves ${movesHeld(game.held)}/${MOVE_SLOTS}</span><span class="tier-chip tier-gold">Passives ${passivesHeld(game.held)}/${PASSIVE_SLOTS}</span>${more}</p>
        </div>
        <div class="cards">${cards}</div>
        <div class="row">
          <button class="btn ghost" id="rerollFree" ${game.rerolls > 0 ? '' : 'disabled'}>Reroll (${game.rerolls} left)</button>
          <button class="btn ghost ad" id="rerollAd" ${game.rerolls === 0 && game.adRerollAvailable ? '' : 'disabled'}>Reroll · watch ad</button>
        </div>
      </div>`;
    el.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => onChoose(c.dataset.id)));
    el.querySelector('#rerollFree').addEventListener('click', () => onReroll(false));
    el.querySelector('#rerollAd').addEventListener('click', () => onReroll(true));
    this.show('pick');
  }

  showRevive({ onRevive, onGiveUp }) {
    const el = this.modals.revive;
    el.innerHTML = `<div class="panel small">
        <h2>Your kaiju is down</h2>
        <p class="muted">One revive per run: back up at 50% health.</p>
        <div class="col">
          <button class="btn primary ad" id="reviveAd">Revive · watch ad</button>
          <button class="btn ghost" id="giveUp">Give up (keep 50% scrap)</button>
        </div>
        <p class="tiny">Ads and gems are placeholders in this prototype; the revive is free.</p>
      </div>`;
    el.querySelector('#reviveAd').addEventListener('click', onRevive);
    el.querySelector('#giveUp').addEventListener('click', onGiveUp);
    this.show('revive');
  }

  showPause({ quality, pixelArt, sound, onQuality, onPixelArt, onSound, onResume, onQuit }) {
    const el = this.modals.pause;
    const opts = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
    el.innerHTML = `<div class="panel small">
        <h2>Paused</h2>
        <div class="col">
          <button class="btn primary" id="resume">Resume</button>
          <button class="btn ghost" id="quit">Quit run</button>
        </div>
        <h3>Sound</h3>
        <div class="segs" id="soundSegs"><button class="seg ${sound ? 'on' : ''}" data-s="1">On</button><button class="seg ${sound ? '' : 'on'}" data-s="0">Off</button></div>
        <h3>Look</h3>
        <div class="segs" id="lookSegs"><button class="seg ${pixelArt ? '' : 'on'}" data-px="0">Voxel</button><button class="seg ${pixelArt ? 'on' : ''}" data-px="1">Retro pixel</button></div>
        <h3>Graphics</h3>
        <div class="segs" id="qualSegs">${opts.map(([id, name]) => `<button class="seg ${id === quality ? 'on' : ''}" data-q="${id}">${name}</button>`).join('')}</div>
        <p class="tiny">Low turns off shadows, bloom and tilt-shift for older phones.</p>
      </div>`;
    el.querySelector('#resume').addEventListener('click', onResume);
    el.querySelector('#quit').addEventListener('click', onQuit);
    el.querySelectorAll('#qualSegs .seg').forEach((b) => b.addEventListener('click', () => {
      onQuality(b.dataset.q);
      el.querySelectorAll('#qualSegs .seg').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll('#soundSegs .seg').forEach((b) => b.addEventListener('click', () => {
      onSound(b.dataset.s === '1');
      el.querySelectorAll('#soundSegs .seg').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll('#lookSegs .seg').forEach((b) => b.addEventListener('click', () => {
      onPixelArt(b.dataset.px === '1');
      el.querySelectorAll('#lookSegs .seg').forEach((x) => x.classList.toggle('on', x === b));
    }));
    this.show('pause');
  }

  showResults(r, { best, newBest, unlocked, onDouble, onAgain, onMenu }) {
    const el = this.modals.results;
    const stat = (label, value) => `<div class="stat"><div class="v">${value}</div><div class="l">${label}</div></div>`;
    const augs = r.augments.map((a) => `<span class="chip tier-${AUGMENT_BY_ID[a.id].tier}">${a.name}${a.level > 1 ? ` ${a.level}` : ''}</span>`).join('') || '<span class="muted">None</span>';
    el.innerHTML = `<div class="panel results-panel ${r.won ? 'won' : 'lost'}">
        <div class="eyebrow">${r.city} · ${DIFFICULTIES[r.difficulty].name}</div>
        <h1>${r.won ? 'City claimed!' : 'The city holds'}</h1>
        ${r.title ? `<div class="run-title">Run title: ${r.title}</div>` : ''}
        <div class="stats">
          ${stat('Score', fmtNum(r.score))}
          ${stat('Time', fmtTime(r.time))}
          ${stat('Buildings', fmtNum(r.buildings))}
          ${stat('People eaten', fmtNum(r.people || 0))}
          ${stat('Military eaten', fmtNum(r.units))}
          ${stat('Rare materials', r.rareMaterials)}
        </div>
        <div class="loot">
          <div><span class="scrap-icon"></span><b>${fmtNum(r.scrap)}</b> scrap ${r.won ? '' : '<span class="muted">(50% kept on a loss)</span>'}${r.doubled ? ' <span class="muted">(doubled)</span>' : ''}</div>
          <button class="btn ghost ad" id="double" ${r.doubled ? 'disabled' : ''}>2x scrap · watch ad</button>
        </div>
        <div class="augs"><div class="label">Build</div>${augs}</div>
        <p class="best">${newBest ? 'New best score!' : `Best: ${fmtNum(best)}`}</p>
        ${unlocked.map((id) => `<p class="unlock">Unlocked: ${KAIJU[id].name}</p>`).join('')}
        <div class="row">
          <button class="btn ghost" id="menuBtn">Kaiju &amp; city</button>
          <button class="btn primary" id="again">Rampage again</button>
        </div>
      </div>`;
    el.querySelector('#double').addEventListener('click', onDouble);
    el.querySelector('#again').addEventListener('click', onAgain);
    el.querySelector('#menuBtn').addEventListener('click', onMenu);
    this.show('results');
  }

  showMenu(profile, { onStart }) {
    const el = this.modals.menu;
    let kaijuId = profile.unlocked[profile.lastKaiju] ? profile.lastKaiju : 'rex';
    let difficulty = profile.lastDifficulty;
    const diffUnlocked = {
      normal: true,
      hard: Boolean(profile.cleared['harbor:normal']),
      nightmare: Boolean(profile.cleared['harbor:hard']),
    };
    if (!diffUnlocked[difficulty]) difficulty = 'normal';

    const render = () => {
      const kaijuCards = Object.values(KAIJU)
        .map((kd) => {
          const open = profile.unlocked[kd.id];
          const egg = kd.earn.includes('egg');
          return `<button class="kcard ${kd.id === kaijuId ? 'selected' : ''}" data-id="${kd.id}" ${open ? '' : 'disabled'} style="--kc:${kd.color}">
            <div class="kicon"></div>
            <div class="kname">${kd.name}</div>
            <div class="krar">${kd.rarity} · ${kd.element}</div>
            <div class="kab"><b>${kd.ability}:</b> ${kd.abilityText}</div>
            <div class="kplay">${kd.playstyle}</div>
            <div class="kearn">${open ? (egg ? `${kd.earn} · open for testing` : kd.earn) : `Locked · ${kd.earn}`}</div>
          </button>`;
        })
        .join('');
      const diffs = Object.values(DIFFICULTIES)
        .map((d) => `<button class="seg ${d.id === difficulty ? 'on' : ''}" data-d="${d.id}" ${diffUnlocked[d.id] ? '' : 'disabled'} title="${diffUnlocked[d.id] ? '' : 'Beat the tier below first'}">${d.name}</button>`)
        .join('');
      const cities = Object.values(CITIES)
        .map((c) => `<div class="city ${c.available ? 'on' : 'off'}">
            <div class="cname">${c.name}</div>
            <div class="ctwist">${c.twist}</div>
            <div class="cmeta">Landmark: ${c.landmark} · Boss: ${c.boss}</div>
            ${c.available ? '' : '<div class="ctag">Next in the MVP</div>'}
          </div>`)
        .join('');
      const best = profile.best[`harbor:${difficulty}`];
      el.innerHTML = `<div class="panel menu-panel">
          <h1 class="logo">Kaiju Rampage</h1>
          <p class="muted">Start human-sized in a backyard and grow to skyline-sized in one run. Smash, eat, pick augments, beat the boss.</p>
          <h3>Kaiju</h3>
          <div class="kaiju-grid">${kaijuCards}</div>
          <h3>City</h3>
          <div class="city-row">${cities}</div>
          <div class="segs">${diffs}</div>
          <div class="row end">
            <span class="muted">${best ? `Best: ${fmtNum(best)}` : ''} ${profile.runs ? `· ${profile.runs} run${profile.runs === 1 ? '' : 's'}, ${profile.wins} win${profile.wins === 1 ? '' : 's'}` : ''}</span>
            <button class="btn primary big" id="start">Rampage!</button>
          </div>
          <details class="sets-help"><summary>Synergy sets</summary>
            ${SYNERGY_SETS.map((s) => `<p><b>${s.name}:</b> ${s.augments.map((id) => AUGMENT_BY_ID[id].name).join(', ')}. Bonus: ${s.bonus}.</p>`).join('')}
          </details>
        </div>`;
      el.querySelectorAll('.kcard').forEach((c) => c.addEventListener('click', () => {
        kaijuId = c.dataset.id;
        render();
      }));
      el.querySelectorAll('.seg').forEach((c) => c.addEventListener('click', () => {
        difficulty = c.dataset.d;
        render();
      }));
      el.querySelector('#start').addEventListener('click', () => onStart({ kaijuId, difficulty }));
    };
    render();
    this.show('menu');
  }
}
