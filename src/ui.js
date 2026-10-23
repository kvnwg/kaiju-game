import { STAGES, MAX_STAGE, STAGE_INFO, KAIJU, CITIES, DIFFICULTIES } from './config.js';
import { AUGMENT_BY_ID, setsFor, SYNERGY_SETS } from './augments.js';

const $ = (sel) => document.querySelector(sel);

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
    this.scrapEl = $('#scrap');
    this.timerEl = $('#timer');
    this.bossbar = $('#bossbar');
    this.bossFill = $('#bossbar .fill');
    this.bossName = $('#bossbar span');
    this.augbar = $('#augbar');
    this.bannerEl = $('#banner');
    this.hintEl = $('#hint');
    this.modals = {
      pick: $('#pick'), revive: $('#revive'), results: $('#results'), menu: $('#menu'), pause: $('#pause'),
    };
    this.augSig = '';
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
    this.hpText.textContent = `${fmtNum(k.hp)} / ${fmtNum(k.maxHp)}${k.shield > 1 ? ` +${fmtNum(k.shield)}` : ''}`;
    const s = STAGES[k.stage];
    const growth = k.stage >= MAX_STAGE ? 1 : Math.min(1, k.biomass / s.biomassToNext);
    this.growthFill.style.width = `${growth * 100}%`;
    this.growthText.textContent = k.stage >= MAX_STAGE ? `Stage 5 · ${s.name} · max size` : `Stage ${k.stage} · ${s.name}`;
    this.scrapEl.textContent = fmtNum(game.stats.scrap);
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
      this.augbar.innerHTML = [...game.held.entries()]
        .map(([id, level]) => {
          const a = AUGMENT_BY_ID[id];
          return `<div class="chip tier-${a.tier}" title="${a.text}">${a.name}${level > 1 ? ` <b>${level}</b>` : ''}</div>`;
        })
        .join('');
    }
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
    this.hintEl.textContent = text;
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
    const tierName = { silver: 'Silver', gold: 'Gold', prismatic: 'Prismatic' }[p.tier];
    const cards = p.options
      .map((id) => {
        const a = AUGMENT_BY_ID[id];
        const level = game.level(id);
        const sets = setsFor(id)
          .map((s) => {
            const have = s.augments.filter((x) => game.has(x) || x === id).length;
            return `<span class="set" title="${s.bonus}">${s.name} ${have}/3</span>`;
          })
          .join('');
        return `<button class="card tier-${a.tier}" data-id="${id}">
          <div class="card-top"><span class="tier">${a.tier}</span><span class="cat">${a.category}</span></div>
          <div class="name">${a.name}${a.upgradable ? ' +' : ''}</div>
          ${level ? `<div class="lvl">Level ${level} → ${level + 1}: ${a.levelText}</div>` : ''}
          <div class="text">${a.text}</div>
          <div class="sets">${sets}</div>
        </button>`;
      })
      .join('');
    const freeLabel = p.freeRerolls > 0 ? 'Reroll (free)' : 'Reroll used';
    el.innerHTML = `<div class="panel pick-panel">
        <h2>You grew! Pick an augment</h2>
        <p class="muted">${tierName} tier · lasts the rest of the run</p>
        <div class="cards">${cards}</div>
        <div class="row">
          <button class="btn ghost" id="rerollFree" ${p.freeRerolls > 0 ? '' : 'disabled'}>${freeLabel}</button>
          <button class="btn ghost ad" id="rerollAd" ${p.freeRerolls === 0 && game.adRerollAvailable ? '' : 'disabled'}>Reroll · watch ad</button>
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

  showPause({ quality, onQuality, onResume, onQuit }) {
    const el = this.modals.pause;
    const opts = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
    el.innerHTML = `<div class="panel small">
        <h2>Paused</h2>
        <div class="col">
          <button class="btn primary" id="resume">Resume</button>
          <button class="btn ghost" id="quit">Quit run</button>
        </div>
        <h3>Graphics</h3>
        <div class="segs">${opts.map(([id, name]) => `<button class="seg ${id === quality ? 'on' : ''}" data-q="${id}">${name}</button>`).join('')}</div>
        <p class="tiny">Low turns off shadows, bloom and tilt-shift for older phones.</p>
      </div>`;
    el.querySelector('#resume').addEventListener('click', onResume);
    el.querySelector('#quit').addEventListener('click', onQuit);
    el.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
      onQuality(b.dataset.q);
      el.querySelectorAll('.seg').forEach((x) => x.classList.toggle('on', x === b));
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
