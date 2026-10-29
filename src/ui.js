import { STAGES, MAX_STAGE, KAIJU, CITIES, DIFFICULTIES, xpToNext } from './config.js';
import { AUGMENTS, AUGMENT_BY_ID, EVOLUTIONS, evolutionFor, recipeState, setsFor, SYNERGY_SETS, levelText, maxLevel, movesHeld, passivesHeld, MOVE_SLOTS, PASSIVE_SLOTS } from './augments.js';
import { MONEY_NAMES, moneyScale } from './prices.js';

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

const RARITY_OF_TIER = { silver: 0, gold: 2, prismatic: 4 };
const REEL_POOL = AUGMENTS.filter((a) => a.kind !== 'evolution');

// Evolution recipe strip: move (level/max) + partner passive = evolution, as it would stand
// after taking `pickId`. Parts you have light up; a complete recipe glows.
function recipe(held, e, pickId = null) {
  const st = recipeState(held, e, pickId);
  const move = AUGMENT_BY_ID[e.move];
  const pas = AUGMENT_BY_ID[e.passive];
  const part = (a, have, label) => `<span class="ing${have ? ' have' : ''}${pickId === a.id ? ' this' : ''}">${icon(a)}<em>${label}</em></span>`;
  return `<div class="recipe${st.ready ? ' ready' : ''}${st.done ? ' done' : ''}" title="${move.name} (max) + ${pas.name} = ${e.name}">
      ${part(move, st.level >= st.max, st.level >= st.max ? 'Max' : `${st.level}/${st.max}`)}<b>+</b>${part(pas, st.passive, st.passive ? 'Got' : 'Need')}<b>=</b>
      <span class="ing evo${st.ready || st.done ? ' have' : ''}">${icon(e)}</span>
    </div>`;
}

// Every evolution recipe, for the pause menu and the pick screen.
function codex(held) {
  return `<div class="codex">${EVOLUTIONS.map((e) => `<div class="codex-row">${recipe(held, e)}<span class="codex-name">${e.name}<small>${e.text}</small></span></div>`).join('')}</div>`;
}

// A slot reel: the result on top, random augments below it; the strip rolls down to the result.
// Card colours by kind: moves warm, passives cool, evolutions gold, bonuses green.
const KIND_LOOK = { move: ['#ff8a9a', '#c8344a'], passive: ['#8ad4ff', '#2a74c8'], evolution: ['#ffe07a', '#c8901a'], filler: ['#9ee88a', '#3a9a3a'] };

function reel(a, i) {
  const syms = Array.from({ length: 10 + i * 5 }, () => REEL_POOL[Math.floor(Math.random() * REEL_POOL.length)]);
  return `<div class="reel"><div class="strip">${icon(a)}${syms.map(icon).join('')}</div></div>`;
}

function fmtNum(n) {
  return Math.round(n).toLocaleString('en-US');
}
// Short form for the smallest phones: 1.6k, 12k, 3.4M.
function fmtShort(n) {
  n = Math.round(n);
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}

// Newsprint: the photo turned into ink dots on paper, a little brighter and harsher than life.
function halftone(img) {
  const w = img.width;
  const h = img.height;
  const ctx = img.getContext('2d');
  const d = ctx.getImageData(0, 0, w, h).data;
  ctx.fillStyle = '#ece3cb';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1d1b17';
  const cell = 4;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      let sum = 0;
      let n = 0;
      for (let yy = y; yy < Math.min(h, y + cell); yy++) {
        for (let xx = x; xx < Math.min(w, x + cell); xx++) {
          const i = (yy * w + xx) * 4;
          sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
          n++;
        }
      }
      const lum = Math.min(1, Math.max(0, (Math.pow(sum / n / 255, 0.55) - 0.5) * 1.5 + 0.5));
      const r = cell * 0.62 * Math.sqrt(1 - lum);
      if (r < 0.3) continue;
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return img;
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
    this.dashBtn = $('#dashBtn');
    this.dashFill = $('#dashBtn i');
    this.threatEl = $('#threat');
    this.threatPips = [...document.querySelectorAll('#threat i')];
    this.threatNote = $('#threat em');
    this.stageNum = $('#stageBadge b');
    this.hpBar = $('#hp');
    this.tiny = window.matchMedia('(max-width: 360px)');
    this.scrapEl = $('#scrap');
    this.objWrap = $('#objective');
    this.objEl = $('#objective span');
    this.timerEl = $('#timer');
    this.bossbar = $('#bossbar');
    this.bossFill = $('#bossbar .fill');
    this.bossName = $('#bossbar span');
    this.bossQuip = $('#bossbar .quip');
    this.bossPoise = $('#bossbar .poise i');
    this.bossRage = $('#bossbar .rage');
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
    this.sizeUpEl = $('#sizeUp');
    this.flashEl = $('#screenFlash');
    this.growthEl = $('#growth');
    this.traitEl = $('#trait');
    this.traitLabel = $('#trait b');
    this.traitFill = $('#trait .track i');
    this.scrapPill = this.scrapEl.parentElement;
    this.lastCombo = 0;
    this.lastBio = 0;
    this.lastScrap = 0;
    this.bannerTimer = null;
  }

  // The newspaper's typefaces, fetched ahead of the first front page.
  warmNewsFonts() {
    if (this.newsFonts || !document.fonts) return;
    this.newsFonts = true;
    for (const f of ['900 40px "Playfair Display"', 'italic 16px "Playfair Display"', '700 16px "Playfair Display"', '40px "UnifrakturMaguntia"']) document.fonts.load(f).catch(() => {});
  }

  // The size-up newspaper: spins in and slams onto the screen, then waits for a tap (or Space or
  // Enter) and flies away. photo: a canvas of the moment, turned to newsprint here.
  showNewspaper(page, photo, onClose) {
    const el = $('#news');
    el.innerHTML = `<div class="news-shake"><div class="news-fit"><div class="news-paper">
        <div class="np-stamp">Extra!</div>
        <div class="np-top"><span>${page.edition}</span><span>${page.city}</span><span>${page.price}</span></div>
        <div class="np-mast">${page.mast || 'The Daily Stomp'}</div>
        <div class="np-note">“${page.note}”</div>
        <div class="np-kicker">${page.size}</div>
        <h1 class="np-head">${page.headline}</h1>
        <p class="np-sub">${page.subhead}</p>
        <div class="np-body">
          <figure class="np-photo"><div class="np-img"></div><figcaption>${page.caption}</figcaption></figure>
          <div class="np-side">
            <div class="np-box"><h4>Now on the menu</h4><p>${page.menu}</p></div>
            <div class="np-box warn"><h4>Coming for it</h4><p>${page.incoming}</p></div>
            <div class="np-damage"><small>Damage so far</small><b>${page.damage}</b></div>
          </div>
        </div>
        <div class="np-nums">${page.numbers.map(([n, label]) => `<div><b>${n}</b><small>${label}</small></div>`).join('')}</div>
        <div class="np-foot">${page.jokes.map(([head, text]) => `<p><b>${head}:</b> ${text}</p>`).join('')}</div>
      </div><div class="news-dust"></div></div></div>
      <div class="news-tap">Tap to keep stomping</div>`;
    if (photo) el.querySelector('.np-img').appendChild(halftone(photo));
    el.classList.remove('hidden', 'out');
    const paper = el.querySelector('.news-paper');
    const fit = Math.min(1, (window.innerWidth * 0.94) / paper.offsetWidth, (window.innerHeight * 0.84) / paper.offsetHeight);
    el.querySelector('.news-fit').style.setProperty('--fit', fit.toFixed(3));
    const shown = performance.now();
    const close = (ev) => {
      if (ev.type === 'keydown') {
        if (![' ', 'Enter'].includes(ev.key)) return;
        ev.preventDefault();
        ev.stopPropagation();
      }
      // A beat to see it land, so a tap already on its way doesn't throw it straight away.
      if (performance.now() - shown < 900) return;
      el.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close, true);
      el.classList.add('out');
      if (this.sfx) this.sfx.dash();
      setTimeout(() => {
        el.classList.add('hidden');
        el.innerHTML = '';
        onClose();
      }, 380);
    };
    el.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close, true);
  }

  show(name, on = true) {
    const el = name === 'hud' ? this.hud : this.modals[name];
    el.classList.toggle('hidden', !on);
    if (name === 'hud' && !on) this.dashBtn.classList.add('hidden');
  }

  hideModals() {
    for (const m of Object.values(this.modals)) m.classList.add('hidden');
  }

  updateHud(game) {
    const k = game.kaiju;
    this.hpFill.style.width = `${(100 * k.hp) / k.maxHp}%`;
    this.shieldFill.style.width = `${Math.min(100, (100 * k.shield) / k.maxHp)}%`;
    const num = this.tiny.matches ? fmtShort : fmtNum;
    this.hpText.textContent = `${num(k.hp)}/${num(k.maxHp)}${k.shield > 1 ? ` +${num(k.shield)}` : ''}`;
    this.hpBar.classList.toggle('low', k.hp < k.maxHp * 0.3);
    const s = STAGES[k.stage];
    // The city's top size waits on the final boss, not on biomass: its bar just stays full.
    const top = k.stage === MAX_STAGE;
    const growth = top ? 1 : Math.min(1, k.biomass / s.biomassToNext);
    this.growthFill.style.width = `${growth * 100}%`;
    const sizeText = `${game.loop > 1 && !this.tiny.matches ? `Loop ${game.loop} · ` : ''}Size ${k.stage} · ${s.name}`;
    if (this.growthText.textContent !== sizeText) this.growthText.textContent = sizeText;
    const gated = !top && growth >= 1 && !game.gateCleared[k.stage];
    // At full size the full bar says it all (and "MAX" would crowd the size name on a phone).
    this.growthPct.textContent = top ? '' : gated ? 'BOSS' : `${Math.floor(growth * 100)}%`;
    this.stageNum.textContent = k.level;
    this.xpFill.style.width = `${Math.min(100, (100 * k.xp) / xpToNext(k.level))}%`;
    this.xpText.textContent = game.pendingPicks > 1 ? `+${game.pendingPicks} picks` : '';
    // The kaiju's trait meter: Gorilla Grunt's grip towards a throw, Volt Beetle's charge.
    const tm = game.traitMeter ? game.traitMeter() : null;
    this.traitEl.classList.toggle('hidden', !tm);
    if (tm) {
      if (this.traitLabel.textContent !== tm.label) this.traitLabel.textContent = tm.label;
      this.traitFill.style.width = `${Math.round(tm.value * 100)}%`;
      this.traitEl.classList.toggle('full', tm.full);
    }
    const ob = game.objective;
    if (ob) {
      const objText = ob.done ? `${ob.text} · done` : `${ob.text} (${Math.min(ob.goal, Math.floor(ob.stat(game)))}/${ob.goal})`;
      if (this.objEl.textContent !== objText) this.objEl.textContent = objText;
      this.objWrap.classList.toggle('done', ob.done);
    }
    // Damage in dollars: rolls up toward the real figure like a slot counter, and flashes at each
    // new milestone ($1 million, $10 million, $100 million, $1 billion...).
    const target = Math.floor(game.stats.damage);
    if (target < (this.dmgShown || 0)) this.dmgShown = 0;
    this.dmgShown = (this.dmgShown || 0) + Math.max(1, (target - (this.dmgShown || 0)) * 0.18);
    if (this.dmgShown > target) this.dmgShown = target;
    const mag = Math.floor(Math.log10(Math.max(1, this.dmgShown)));
    if (mag >= 6 && mag > (this.lastMag || 0)) this.retrigger(this.scrapPill, 'billion');
    this.lastMag = mag;
    const shown = Math.floor(this.dmgShown);
    if (shown >= 1e9) {
      const [v, i] = moneyScale(shown);
      this.scrapEl.textContent = `$${v.toFixed(3)}${MONEY_NAMES[i][0]}`;
    } else this.scrapEl.textContent = `$${shown.toLocaleString('en-US')}`;
    // Little pops when things go up: the growth bar glows, the coin pill bumps.
    if (k.biomass > this.lastBio + 1e-6) this.retrigger(this.growthEl, 'gain');
    this.lastBio = k.biomass;
    if (Math.floor(game.stats.damage) > this.lastScrap) this.retrigger(this.scrapPill, 'bump');
    this.lastScrap = Math.floor(game.stats.damage);
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
    this.dashBtn.classList.remove('hidden');
    const ready = k.dashCd <= 0;
    if (ready && !this.dashReady) this.retrigger(this.dashBtn, 'flash');
    this.dashReady = ready;
    this.dashBtn.classList.toggle('ready', ready);
    this.dashFill.style.height = `${Math.min(100, (100 * k.dashCd) / 2.8)}%`;
    this.threatPips.forEach((el, i) => el.classList.toggle('on', game.threat > i * 20 + 2));
    this.threatEl.classList.toggle('hot', game.threat >= 80);
    const note = k.netted > 0 ? 'Netted' : k.sedated > 0 ? 'No healing' : '';
    if (this.threatNote.textContent !== note) {
      this.threatNote.textContent = note;
      this.threatNote.classList.toggle('net', k.netted > 0);
    }

    const b = game.boss;
    const bossOn = Boolean(b && !b.dead);
    this.bossbar.classList.toggle('hidden', !bossOn);
    if (bossOn) {
      const name = b.phase === 2 ? `${b.name} · ${b.gate ? 'furious' : 'enraged'}` : b.name;
      if (this.bossName.textContent !== name) this.bossName.textContent = name;
      const staggered = b.staggerT > 0;
      const quip = staggered ? 'Staggered: hit it now!' : b.quip && game.time < b.quipUntil ? `“${b.quip}”` : b.shield ? 'Filibustering: immune' : b.state === 'break' ? 'On break: takes extra damage' : '';
      if (this.bossQuip.textContent !== quip) this.bossQuip.textContent = quip;
      this.bossFill.style.width = `${(100 * b.hp) / b.maxHp}%`;
      // The stagger meter (full and flashing while it reels), and Rage once a fight runs long.
      this.bossPoise.style.width = `${staggered ? 100 : Math.min(100, (100 * b.poise) / b.poiseNeed)}%`;
      this.bossbar.classList.toggle('staggered', staggered);
      this.bossbar.classList.toggle('phased', Boolean(b.tanky));
      const rage = game.bossRage ? Math.round((game.bossRage(b) - 1) * 100) : 0;
      const rageText = rage > 0 ? `Rage +${rage}%` : '';
      if (this.bossRage.textContent !== rageText) this.bossRage.textContent = rageText;
    }

    const sig = [...game.held.entries()].map(([id, l]) => `${id}${l}`).join(',');
    if (sig !== this.augSig) {
      // A freshly earned evolution slams into the grid (not on the first draw of a run).
      if (!this.augSig) this.knownAug = new Set(game.held.keys());
      const fresh = [...game.held.keys()].filter((id) => !this.knownAug.has(id) && AUGMENT_BY_ID[id] && AUGMENT_BY_ID[id].kind === 'evolution');
      for (const id of game.held.keys()) this.knownAug.add(id);
      this.augSig = sig;
      // Moves on top (with a cooldown meter), passives in a smaller row below.
      const tile = ([id, level]) => {
          const a = AUGMENT_BY_ID[id];
          // A move shows its partner passive in the corner (lit once held) and glows when it can evolve.
          const evo = a.kind === 'move' ? evolutionFor(id) : null;
          const st = evo && !game.held.has(evo.id) ? recipeState(game.held, evo) : null;
          const hint = st ? `<i class="evo-hint aug-ico ico-${evo.passive}${st.passive ? ' have' : ''}"></i>` : '';
          const title = st ? `${a.name}: ${a.text}. Max it and hold ${AUGMENT_BY_ID[evo.passive].name} to evolve into ${evo.name}` : `${a.name}: ${a.text}`;
          return `<div class="tile tier-${a.tier} kind-${a.kind}${st && st.ready ? ' evo-ready' : ''}${fresh.includes(id) ? ' slam-in' : ''}" ${a.kind === 'move' ? `data-move="${id}"` : ''} title="${title}">
            ${icon(a)}${hint}${a.kind === 'move' ? '<span class="cd"></span>' : ''}<b class="lvl${level >= maxLevel(a) ? ' max' : ''}">${level}</b></div>`;
      };
      const held = [...game.held.entries()].filter(([id]) => AUGMENT_BY_ID[id]);
      const row = (kind) => held.filter(([id]) => AUGMENT_BY_ID[id].kind === kind).map(tile).join('');
      this.augbar.innerHTML = `<div class="aug-row">${row('move')}${row('evolution')}</div><div class="aug-row">${row('passive')}</div>`;
      if (fresh.length) {
        this.augbar.classList.remove('slam-shake');
        void this.augbar.offsetWidth;
        this.augbar.classList.add('slam-shake');
        setTimeout(() => {
          if (this.sfx && this.sfx.ctx) this.sfx.slam();
          this.flash(0.5);
        }, 380);
      }
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

  // The size-up stamp: SIZE UP! slams onto the screen with the new size, and what comes next.
  sizeUp({ size, next }) {
    const el = this.sizeUpEl;
    el.innerHTML = `<i class="su-rays"></i><b>SIZE UP!</b><span>Now ${size}-sized</span>${next ? `<small>Next: ${next}</small>` : ''}`;
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

  // Mutation Altar: the angel heals and gives a free reroll; the devil boosts an augment for health.
  showAltar(game, onChoose) {
    const el = this.modals.pick;
    const devil = game.altar && game.altar.devil ? AUGMENT_BY_ID[game.altar.devil] : null;
    el.innerHTML = `<div class="panel pick-panel altar-panel">
        <div class="eyebrow">Mutation Altar</div>
        <h2>Choose your blessing</h2>
        <div class="altar-cards">
          <button class="altar-card angel" data-c="angel"><i class="halo"></i><b>Blessing</b><span>Heal 35% of your health</span><small>Plus one free reroll</small></button>
          ${devil ? `<button class="altar-card devil" data-c="devil"><i class="horns"></i><b>Devil's pact</b><span>${devil.name} +2 levels</span><small>Costs 15% of your max health for this run</small></button>` : ''}
        </div>
      </div>`;
    el.querySelectorAll('.altar-card').forEach((c) => c.addEventListener('click', () => onChoose(c.dataset.c)));
    this.show('pick');
  }

  showPick(game, { onChoose, onReroll, ads = true }) {
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
        const evo = evolutionFor(id);
        const st = evo && recipeState(game.held, evo, id);
        const evoLine = !evo ? '' : a.kind === 'evolution' ? 'Evolution!' : st.ready ? `Unlocks ${evo.name}!` : st.done ? `Evolved: ${evo.name}` : `Evolves into ${evo.name}`;
        // An evolution doesn't roll like the others: it slams down into its slot (see spinReels).
        const slam = a.kind === 'evolution';
        const [kc, kc2] = KIND_LOOK[a.kind] || KIND_LOOK.filler;
        return `<button class="card tier-${a.tier} kind-${a.kind}${level ? ' upgrade' : ''}${slam ? ' evo-slam' : ''}" data-id="${id}" style="--i:${i};--kc:${kc};--kc2:${kc2}">
          ${slam ? '<span class="slam-ring"></span><span class="slam-sparks"></span><span class="slam-stamp">Evolution!</span>' : ''}
          <span class="card-shine"></span>
          <div class="card-top"><span class="tier">${a.kind === 'filler' ? 'Bonus' : a.kind}</span><span class="cat">${tag}</span></div>
          <div class="card-main"><span class="medal"><span class="medal-rays"></span>${slam ? `<div class="reel"><div class="strip">${icon(a)}</div></div>` : reel(a, i)}</span><div class="name">${a.name}</div></div>
          <div class="text">${level ? levelText(id, level) : a.text}</div>
          ${pips}
          ${sets ? `<div class="sets">${sets}</div>` : ''}
          ${evo ? `<div class="recipe-wrap${st.ready || a.kind === 'evolution' ? ' ready' : ''}">${recipe(game.held, evo, id)}<span class="recipe-name">${evoLine}</span></div>` : ''}
        </button>`;
      })
      .join('');
    const more = game.pendingPicks > 1 ? `+${game.pendingPicks - 1} queued` : '';
    el.innerHTML = `<div class="pick-rays"></div><div class="panel pick-panel">
        <div class="pick-head">
          <h2><span class="lvl-word">Level up!</span><small>Level ${p.level}</small></h2>
          <p><span class="tier-chip tier-silver">Moves ${movesHeld(game.held)}/${MOVE_SLOTS}</span><span class="tier-chip tier-gold">Passives ${passivesHeld(game.held)}/${PASSIVE_SLOTS}</span>${more}</p>
        </div>
        <div class="cards">${cards}</div>
        <div class="row">
          <button class="btn ghost" id="rerollFree" ${game.rerolls > 0 ? '' : 'disabled'}>Reroll (${game.rerolls} left)</button>
          ${ads ? `<button class="btn ghost ad" id="rerollAd" ${game.rerolls === 0 && game.adRerollAvailable ? '' : 'disabled'}>Reroll · watch ad</button>` : ''}
        </div>
        <details class="recipes-help"><summary>Evolution recipes</summary>${codex(game.held)}</details>
      </div>`;
    const cardEls = [...el.querySelectorAll('.card')];
    const spin = this.spinReels(el, cardEls);
    // Picking: the chosen card swells and flashes while the others drop away, then the run resumes.
    let chosen = false;
    cardEls.forEach((c) => c.addEventListener('click', () => {
      if (chosen || !spin.canPick(c)) return;
      chosen = true;
      el.querySelector('.pick-panel').classList.add('choosing');
      c.classList.add('chosen');
      if (this.sfx) this.sfx.ding(RARITY_OF_TIER[AUGMENT_BY_ID[c.dataset.id].tier] ?? 1);
      setTimeout(() => onChoose(c.dataset.id), 420);
    }));
    el.querySelector('#rerollFree').addEventListener('click', () => onReroll(false));
    if (ads) el.querySelector('#rerollAd').addEventListener('click', () => onReroll(true));
    this.show('pick');
  }

  // Slot-machine reveal: every card's icon spins on a reel and the reels land left to right, each
  // with a ding pitched by rarity and a click per symbol on the way. A tap skips ahead; a card
  // can be picked once it has landed.
  spinReels(el, cards) {
    const sfx = this.sfx;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let guardUntil = 0;
    let lastTick = 0;
    const spins = cards.map((card, i) => {
      const strip = card.querySelector('.strip');
      const s = { card, strip, n: strip.children.length - 1, tier: AUGMENT_BY_ID[card.dataset.id].tier, landed: false, anim: null, last: -1 };
      s.land = (quiet) => {
        if (s.landed) return;
        s.landed = true;
        card.classList.remove('spinning');
        card.classList.add('landed');
        if (!quiet && sfx) sfx.ding(RARITY_OF_TIER[s.tier] ?? 0);
      };
      if (reduce || !strip.animate) {
        s.land(true);
        return s;
      }
      if (card.classList.contains('evo-slam')) {
        // The evolution card hangs high and huge for a beat, then slams into its slot: the panel
        // shakes, a golden shockwave rings out and EVOLUTION! is stamped across it.
        card.classList.add('spinning');
        const panel = el.querySelector('.pick-panel');
        const hit = () => {
          if (s.slammed) return;
          s.slammed = true;
          card.classList.add('slammed');
          if (panel) {
            panel.classList.remove('slam-shake');
            void panel.offsetWidth;
            panel.classList.add('slam-shake');
          }
          if (sfx && sfx.ctx) {
            sfx.slam();
            sfx.ding(5);
          }
          this.flash(0.6);
        };
        const land = s.land;
        s.land = (quiet) => {
          hit();
          land(true);
        };
        // The fall, then (on the animation's own clock, so the thump always matches the impact)
        // the squash and bounce as it settles.
        s.anim = card.animate([
          { transform: 'translateY(-150%) scale(2.3) rotate(-12deg)', opacity: 0 },
          { transform: 'translateY(-130%) scale(2.1) rotate(-9deg)', opacity: 1, offset: 0.38 },
          { transform: 'translateY(-120%) scale(2) rotate(-8deg)', opacity: 1, offset: 0.7, easing: 'cubic-bezier(.7,0,1,.6)' },
          { transform: 'translateY(4%) scale(1.06, 0.9) rotate(1deg)', opacity: 1 },
        ], { duration: 900, delay: 250 + i * 120, fill: 'both' });
        s.anim.onfinish = () => {
          hit();
          s.anim = card.animate([
            { transform: 'translateY(4%) scale(1.06, 0.9) rotate(1deg)' },
            { transform: 'translateY(-3%) scale(0.97, 1.04) rotate(0deg)', offset: 0.5 },
            { transform: 'none' },
          ], { duration: 260, fill: 'both' });
          s.anim.onfinish = () => s.land(false);
        };
        return s;
      }
      card.classList.add('spinning');
      s.anim = strip.animate([
        { transform: `translateY(${(-100 * s.n) / (s.n + 1)}%)`, easing: 'cubic-bezier(.2,.62,.35,1)' },
        { transform: `translateY(${24 / (s.n + 1)}%)`, offset: 0.9, easing: 'ease-in-out' },
        { transform: 'translateY(0)' },
      ], { duration: 950 + i * 420, fill: 'both' });
      s.anim.onfinish = () => s.land(false);
      return s;
    });
    const frame = () => {
      if (!el.isConnected || el.classList.contains('hidden')) return;
      let spinning = false;
      for (const s of spins) {
        if (s.landed || !s.anim) continue;
        spinning = true;
        const ty = new DOMMatrixReadOnly(getComputedStyle(s.strip).transform).m42;
        const idx = Math.floor(-ty / (s.strip.offsetHeight / (s.n + 1)));
        if (idx !== s.last) {
          s.last = idx;
          const now = performance.now();
          if (now - lastTick > 45 && sfx) {
            lastTick = now;
            sfx.tick();
          }
        }
      }
      if (spinning) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const skip = () => {
      const left = spins.filter((s) => !s.landed);
      if (!left.length) return;
      guardUntil = performance.now() + 300;
      for (const s of left) {
        if (s.anim) s.anim.finish();
        s.land(true);
      }
      if (sfx) sfx.ding(Math.max(...left.map((s) => RARITY_OF_TIER[s.tier] ?? 0)));
    };
    if (this.reelSkip) el.removeEventListener('pointerdown', this.reelSkip, true);
    this.reelSkip = skip;
    el.addEventListener('pointerdown', skip, true);
    return { canPick: (card) => card.classList.contains('landed') && performance.now() > guardUntil };
  }

  showPause({ held = new Map(), quality, pixelArt, sound, musicOn, onQuality, onPixelArt, onSound, onMusic, onResume, onQuit, onCashOut = null }) {
    const el = this.modals.pause;
    const opts = [['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['lowest', 'Lowest']];
    el.innerHTML = `<div class="panel small">
        <h2>Paused</h2>
        <div class="col">
          <button class="btn primary" id="resume">Resume</button>
          ${onCashOut ? '<button class="btn" id="cashout">Cash out (counts as a win)</button>' : ''}
          <button class="btn ghost" id="quit">Quit run</button>
        </div>
        <details class="recipes-help"><summary>Evolution recipes</summary>${codex(held)}</details>
        <div class="settings-grid">
          <h3>Sound</h3>
          <div class="segs" id="soundSegs"><button class="seg ${sound ? 'on' : ''}" data-s="1">On</button><button class="seg ${sound ? '' : 'on'}" data-s="0">Off</button></div>
          <h3>Music</h3>
          <div class="segs" id="musicSegs"><button class="seg ${musicOn ? 'on' : ''}" data-m="1">On</button><button class="seg ${musicOn ? '' : 'on'}" data-m="0">Off</button></div>
          <h3>Look</h3>
          <div class="segs" id="lookSegs"><button class="seg ${pixelArt ? '' : 'on'}" data-px="0">Voxel</button><button class="seg ${pixelArt ? 'on' : ''}" data-px="1">Retro pixel</button></div>
          <h3>Graphics</h3>
          <div class="segs" id="qualSegs">${opts.map(([id, name]) => `<button class="seg ${id === quality ? 'on' : ''}" data-q="${id}">${name}</button>`).join('')}</div>
        </div>
        <p class="tiny">Low turns off shadows, bloom and tilt-shift. Lowest also halves the resolution and draws less detail and debris, for devices that really struggle. The game lowers these on its own if it runs slowly.</p>
      </div>`;
    el.querySelector('#resume').addEventListener('click', onResume);
    el.querySelector('#quit').addEventListener('click', onQuit);
    if (onCashOut) el.querySelector('#cashout').addEventListener('click', onCashOut);
    el.querySelectorAll('#qualSegs .seg').forEach((b) => b.addEventListener('click', () => {
      onQuality(b.dataset.q);
      el.querySelectorAll('#qualSegs .seg').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll('#soundSegs .seg').forEach((b) => b.addEventListener('click', () => {
      onSound(b.dataset.s === '1');
      el.querySelectorAll('#soundSegs .seg').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll('#musicSegs .seg').forEach((b) => b.addEventListener('click', () => {
      onMusic(b.dataset.m === '1');
      el.querySelectorAll('#musicSegs .seg').forEach((x) => x.classList.toggle('on', x === b));
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
