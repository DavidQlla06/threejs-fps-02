// BREACHLINE — HUD: all DOM overlay work. The 3D scene never touches the
// DOM; this module owns the crosshair, health/ammo/money readouts, the
// round timer and score, the kill feed, the minimap canvas, the buy menu
// and the start / round-end / match-end overlays. Every update is a plain
// function call from main.js, so the HUD can be driven by the real game
// or by the deterministic ?shot= captures.

import { formatClock, formatMoney } from './util.js';
import { WEAPONS, ARMOR_PRICE } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    health: $('health-value'),
    healthBar: $('health-bar'),
    armor: $('armor-value'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    weaponName: $('weapon-name'),
    money: $('money-value'),
    timer: $('timer-value'),
    scoreV: $('score-v'),
    scoreS: $('score-s'),
    round: $('round-value'),
    aliveV: $('alive-v'),
    aliveS: $('alive-s'),
    feed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    damage: $('damage-flash'),
    bomb: $('bomb-status'),
    bombText: $('bomb-text'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    buyTimer: $('buy-timer'),
    minimap: $('minimap'),
    hint: $('hint'),
    spec: $('spectate'),
    channel: $('channel'),
    channelBar: $('channel-bar'),
    channelLabel: $('channel-label'),
    scoreboard: $('scoreboard'),
    sbScore: $('sb-score'),
    sbRows: $('sb-rows'),
  };
  const mapCtx = els.minimap.getContext('2d');
  let bannerTimer = null;
  let hitTimer = null;

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  const hud = {
    setHealth(hp, armor) {
      els.health.textContent = Math.ceil(hp);
      els.armor.textContent = Math.ceil(armor);
      els.healthBar.style.width = `${Math.max(0, hp)}%`;
      els.healthBar.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve, weaponId) {
      els.ammoMag.textContent = mag;
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.weaponName.textContent = WEAPONS[weaponId].name;
      els.ammoBox.classList.toggle('empty', mag === 0);
    },
    setMoney(money) {
      els.money.textContent = formatMoney(money);
    },
    setTimer(seconds) {
      els.timer.textContent = formatClock(seconds);
      els.timer.classList.toggle('urgent', seconds <= 10);
    },
    setScore(v, s, round) {
      els.scoreV.textContent = v;
      els.scoreS.textContent = s;
      els.round.textContent = `ROUND ${round}`;
    },
    setAlive(v, s) {
      els.aliveV.textContent = '●'.repeat(v) + '○'.repeat(Math.max(0, 5 - v));
      els.aliveS.textContent = '●'.repeat(s) + '○'.repeat(Math.max(0, 5 - s));
    },
    setBomb(state, seconds) {
      if (state === 'planted') {
        show(els.bomb);
        els.bombText.textContent = `SPIKE PLANTED — ${formatClock(seconds)}`;
        els.bomb.classList.add('planted');
      } else if (state === 'carried') {
        show(els.bomb);
        els.bombText.textContent = 'SPIKE IN ENEMY HANDS';
        els.bomb.classList.remove('planted');
      } else {
        hide(els.bomb);
      }
    },
    // Crosshair gap grows with spread (0..1) and while moving.
    setSpread(spread, moving) {
      const gap = 3 + spread * 14 + (moving ? 3 : 0);
      els.crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitmarker(kill, headshot) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!kill);
      els.hitmarker.classList.toggle('head', !!headshot);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill', 'head'), kill ? 220 : 110);
    },
    damageFlash(fromAngle) {
      els.damage.style.opacity = '1';
      els.damage.style.setProperty('--angle', `${fromAngle}deg`);
      setTimeout(() => { els.damage.style.opacity = '0'; }, 160);
    },
    addKill(killer, victim, killerTeam, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      const k = document.createElement('span');
      k.className = `team-${killerTeam}`;
      k.textContent = killer;
      const v = document.createElement('span');
      v.className = `team-${killerTeam === 'vanguard' ? 'specter' : 'vanguard'}`;
      v.textContent = victim;
      line.append(k, document.createTextNode(headshot ? ' ⌖ ' : '  ×  '), v);
      els.feed.prepend(line);
      while (els.feed.children.length > 5) els.feed.lastChild.remove();
      setTimeout(() => line.remove(), 6000);
    },
    banner(title, sub, ms = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
      show(els.banner);
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => hide(els.banner), ms);
    },
    // --- overlays -------------------------------------------------------
    showOverlay(kind, data = {}) {
      hide(els.buyMenu);
      els.overlayTitle.textContent =
        kind === 'start' ? 'BREACHLINE'
        : kind === 'paused' ? 'PAUSED'
        : kind === 'dead' ? 'YOU ARE DOWN'
        : kind === 'match' ? (data.won ? 'VICTORY' : 'DEFEAT')
        : 'BREACHLINE';
      els.overlayCopy.innerHTML =
        kind === 'start'
          ? 'Round-based tactical FPS. Defend the Foundry with four Vanguard bots against five Specters. Hold the sites, stop the spike, win 8 rounds.'
          : kind === 'paused'
          ? 'Pointer released. Click to jump back in.'
          : kind === 'dead'
          ? 'Your squad fights on without you. Click to spectate the round.'
          : kind === 'match'
          ? `Final score — Vanguard ${data.v} : ${data.s} Specters.<br>Click to play again.`
          : '';
      els.play.textContent =
        kind === 'start' ? 'CLICK TO DEPLOY'
        : kind === 'dead' ? 'SPECTATE'
        : kind === 'match' ? 'PLAY AGAIN'
        : 'RESUME';
      show(els.overlay);
    },
    hideOverlay() { hide(els.overlay); },
    showSpectateNote() { show(els.spec); },
    hideSpectateNote() { hide(els.spec); },
    setHint(text) {
      els.hint.textContent = text || '';
      els.hint.hidden = !text;
    },
    setChannel(pct, label) {
      show(els.channel);
      els.channelLabel.textContent = label;
      els.channelBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    },
    hideChannel() { hide(els.channel); },
    // Scoreboard: rows are {name, team, kills, deaths, money, me}.
    showScoreboard(scoreV, scoreS, rows) {
      els.sbScore.textContent = `${scoreV} : ${scoreS}`;
      els.sbRows.innerHTML = '';
      for (const r of rows) {
        const tr = document.createElement('tr');
        if (r.me) tr.className = 'me';
        const name = document.createElement('td');
        name.innerHTML = `<span class="team-${r.team}">${r.name}</span>${r.me ? ' (YOU)' : ''}`;
        const k = document.createElement('td');
        k.textContent = r.kills;
        const d = document.createElement('td');
        d.textContent = r.deaths;
        const m = document.createElement('td');
        m.textContent = r.money == null ? '—' : formatMoney(r.money);
        tr.append(name, k, d, m);
        els.sbRows.append(tr);
      }
      show(els.scoreboard);
    },
    hideScoreboard() { hide(els.scoreboard); },
    // --- buy menu -------------------------------------------------------
    showBuy(money, secondsLeft, owned) {
      els.buyMoney.textContent = formatMoney(money);
      els.buyTimer.textContent = `Round starts in ${Math.ceil(secondsLeft)}s — press ENTER to deploy now`;
      els.buyItems.innerHTML = '';
      const entries = [
        ...Object.values(WEAPONS).map((w) => ({
          key: String(w.slot), label: `${w.name} — ${w.mag} rounds`,
          price: w.price, owned: owned.weapon === w.id, disabled: owned.weapon === w.id,
        })),
        {
          key: '5', label: 'Kevlar Vest — absorbs half of each hit', price: ARMOR_PRICE,
          owned: owned.armor, disabled: owned.armor,
        },
      ];
      for (const e of entries) {
        const row = document.createElement('div');
        row.className = 'buy-row' + (e.disabled ? ' owned' : '') + (money < e.price ? ' poor' : '');
        row.innerHTML = `<kbd>${e.key}</kbd><span class="buy-label">${e.label}</span>` +
          `<span class="buy-price">${e.owned ? 'OWNED' : formatMoney(e.price)}</span>`;
        els.buyItems.append(row);
      }
      show(els.buyMenu);
    },
    hideBuy() { hide(els.buyMenu); },
    updateBuyTimer(secondsLeft) {
      els.buyTimer.textContent = `Round starts in ${Math.ceil(secondsLeft)}s — press ENTER to deploy now`;
    },
    // --- minimap ----------------------------------------------------------
    // Draws the yard top-down: walls, sites, teammates (blue), enemies
    // the player has seen recently (red, fading), the spike (amber).
    drawMinimap(map, player, bots, seenEnemies, bomb) {
      const W = els.minimap.width;
      const H = els.minimap.height;
      const sx = W / 66;
      const sz = H / 50;
      const X = (x) => (x + 33) * sx;
      const Z = (z) => (z + 25) * sz;
      mapCtx.clearRect(0, 0, W, H);
      mapCtx.fillStyle = '#16181c';
      mapCtx.fillRect(0, 0, W, H);
      mapCtx.fillStyle = '#2c3036';
      for (const s of map.SOLIDS) {
        mapCtx.fillRect(X(s.x0), Z(s.z0), (s.x1 - s.x0) * sx, (s.z1 - s.z0) * sz);
      }
      for (const [key, site] of Object.entries(map.SITES)) {
        mapCtx.strokeStyle = '#f0a830';
        mapCtx.lineWidth = 1;
        mapCtx.strokeRect(X(site.x0), Z(site.z0), (site.x1 - site.x0) * sx, (site.z1 - site.z0) * sz);
        mapCtx.fillStyle = '#f0a830';
        mapCtx.font = 'bold 10px system-ui, sans-serif';
        mapCtx.textAlign = 'center';
        mapCtx.fillText(key, X((site.x0 + site.x1) / 2), Z((site.z0 + site.z1) / 2) + 3);
      }
      const dot = (x, z, color, r = 3) => {
        mapCtx.fillStyle = color;
        mapCtx.beginPath();
        mapCtx.arc(X(x), Z(z), r, 0, Math.PI * 2);
        mapCtx.fill();
      };
      const now = performance.now() / 1000;
      for (const b of bots) {
        if (!b.alive) continue;
        dot(b.pos.x, b.pos.z, b.team === 'vanguard' ? '#4da3ff' : '#ff5a4d');
      }
      for (const e of seenEnemies) {
        const age = now - e.t;
        if (age > 6) continue;
        mapCtx.globalAlpha = Math.max(0.25, 1 - age / 6);
        dot(e.x, e.z, '#ff5a4d', 2.5);
        mapCtx.globalAlpha = 1;
      }
      if (bomb.state === 'planted') {
        dot(bomb.x, bomb.z, '#f0a830', 4);
      }
      // Player arrow, rotated to the view yaw.
      mapCtx.save();
      mapCtx.translate(X(player.pos.x), Z(player.pos.z));
      mapCtx.rotate(Math.PI - player.yaw);
      mapCtx.fillStyle = '#ffffff';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -6);
      mapCtx.lineTo(4, 5);
      mapCtx.lineTo(-4, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
    onPlay(handler) { els.play.addEventListener('click', handler); },
  };
  return hud;
}
