// BREACHLINE — entry point: renderer, player controller, combat, rounds.
// Round-based tactical FPS, Counter-Strike-style, single player against
// bots, fully offline. The game state machine is:
//
//   menu -> buy (12 s, keyboard buy menu) -> live (100 s round)
//        -> roundEnd (4 s banner) -> buy ... -> matchEnd (first to 8)
//
// The player defends with four Vanguard bots; five Specter bots attack
// and try to plant the spike at site A or B. A round is won by wiping
// the other team, by defusing a planted spike, or by running the clock
// out before a plant. A planted spike that burns down wins the round
// for the Specters.
//
// ?shot=start|play|end&seed=N stages a deterministic frame for capture:
// it starts the match, places the actors, renders twice, freezes the
// loop and sets window.__shotReady.

import * as THREE from 'three';
import {
  MAP, SOLIDS, SITES, SPAWNS, HOLD_SPOTS, buildMapMeshes,
  moveCircle, rayHitSolids, sightBlocked, siteAt,
} from './map.js';
import { mulberry32, clamp, turnToward } from './util.js';
import {
  WEAPONS, ARMOR_PRICE, KILL_REWARD, ROUND_WIN_REWARD, ROUND_LOSS_REWARD,
  PLANT_REWARD, DEFUSE_REWARD, START_MONEY,
  baseDamage, applyArmor, shotInterval, freshAmmo,
} from './weapons.js';
import { createBots, TEAMS } from './bots.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const WIN_ROUNDS = 8;
const MAX_ROUNDS = 15;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.15;
const PLAYER_RADIUS = 0.42;
const PLAYER_SPEED = 4.6;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed * 7919 + 13);

// --- renderer / scene ----------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x191e26);
scene.fog = new THREE.Fog(0x191e26, 26, 78);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x2a2620, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 90;
scene.add(sun);

buildMapMeshes(THREE, scene);

const audio = createAudio();
const hud = createHud();
const bots = createBots(scene, random);

// --- viewmodel: the player's gun, built from boxes -----------------------
const viewmodel = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.55, metalness: 0.45 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.8 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), dark);
  body.position.set(0, 0, 0);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), dark);
  barrel.position.set(0, 0.02, -0.4);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), grip);
  mag.position.set(0, -0.14, 0.05);
  mag.rotation.x = 0.25;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), grip);
  sight.position.set(0, 0.09, -0.12);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.3), accentMat);
  stripe.position.set(0, 0.07, -0.05);
  viewmodel.add(body, barrel, mag, sight, stripe);
  viewmodel.position.set(0.26, -0.24, -0.55);
  camera.add(viewmodel);
}
const muzzle = new THREE.Object3D();
muzzle.position.set(0.26, -0.2, -1.1);
camera.add(muzzle);
const flashLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
camera.add(flashLight);
flashLight.position.set(0.26, -0.2, -1);

// --- tracers & impacts ----------------------------------------------------
const tracerPool = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffd166, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  }));
  line.frustumCulled = false;
  scene.add(line);
  tracerPool.push({ line, life: 0 });
}
let tracerIndex = 0;
function spawnTracer(from, to, color) {
  const t = tracerPool[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracerPool.length;
  const p = t.line.geometry.attributes.position;
  p.setXYZ(0, from.x, from.y, from.z);
  p.setXYZ(1, to.x, to.y, to.z);
  p.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.9;
  t.life = 0.09;
}
const sparkPool = [];
for (let i = 0; i < 6; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffc46b, size: 0.12, transparent: true, opacity: 0,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  sparkPool.push({ pts, vel: new Float32Array(30), life: 0 });
}
let sparkIndex = 0;
function spawnSparks(at) {
  const s = sparkPool[sparkIndex];
  sparkIndex = (sparkIndex + 1) % sparkPool.length;
  const p = s.pts.geometry.attributes.position;
  for (let i = 0; i < 10; i++) {
    p.setXYZ(i, at.x, at.y, at.z);
    s.vel[i * 3] = (Math.random() - 0.5) * 4;
    s.vel[i * 3 + 1] = Math.random() * 3;
    s.vel[i * 3 + 2] = (Math.random() - 0.5) * 4;
  }
  p.needsUpdate = true;
  s.pts.material.opacity = 1;
  s.life = 0.35;
}

// --- spike (bomb) visual ---------------------------------------------------
const spikeGroup = new THREE.Group();
{
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.5 }),
  );
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2 }),
  );
  light.position.y = 0.14;
  light.name = 'spike-light';
  spikeGroup.add(box, light);
  spikeGroup.visible = false;
  scene.add(spikeGroup);
}

// --- game state ------------------------------------------------------------
const player = {
  pos: { x: SPAWNS.vanguard[0].x, z: SPAWNS.vanguard[0].z },
  y: 0, vy: 0, yaw: SPAWNS.vanguard[0].yaw, pitch: 0,
  hp: 100, armor: 0, money: START_MONEY,
  weaponId: 'p9', mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve,
  alive: true, crouched: false, onGround: true,
  bloom: 0, recoil: 0, lastShotAt: -9, reloadingUntil: 0, reloadWeapon: null,
  defuseUntil: 0, defusing: false, stepPhase: 0,
  kills: 0, deaths: 0,
};

const match = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1,
  score: { v: 0, s: 0 },
  roundTime: MAP.roundTime,
  buyTime: MAP.buyTime,
  roundEndAt: 0,
  roundEndReason: '',
  roundWinner: null,
  time: 0,
  kills: { v: 0, s: 0 },
};

const bomb = {
  state: 'carried', // carried | planted
  site: null, x: 0, z: 0, timer: MAP.bombTime,
  carrier: null, defuser: null, plantSite: null,
};

const seenEnemies = []; // {x, z, t} for the minimap
let spectateBot = null;
let frozen = false;
let shotFrames = 0;

// --- input ------------------------------------------------------------------
const keys = new Set();
let mouseDown = false;
let locked = false;

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyB' && match.phase === 'live') hud.setHint('Buy menu opens between rounds');
  if (e.code === 'Enter' && match.phase === 'buy') startRound();
  if (e.code === 'KeyM') audio.setMuted(!audio.isMuted());
  if (e.code === 'Tab') {
    e.preventDefault();
    showScoreboard();
  }
  if (match.phase === 'buy') {
    if (e.code === 'Digit1') buyWeapon('p9');
    if (e.code === 'Digit2') buyWeapon('vk9');
    if (e.code === 'Digit3') buyWeapon('ar77');
    if (e.code === 'Digit4') buyWeapon('lm88');
    if (e.code === 'Digit5') buyArmor();
  }
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') hud.hideScoreboard();
});
window.addEventListener('blur', () => { keys.clear(); mouseDown = false; });

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseDown = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});
document.addEventListener('mousemove', (e) => {
  if (!locked || frozen) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch = clamp(player.pitch - e.movementY * 0.0021, -1.45, 1.45);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && !shot && match.phase !== 'menu' && match.phase !== 'matchEnd' && player.alive) {
    hud.showOverlay('paused');
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function requestLock() {
  renderer.domElement.requestPointerLock();
}

hud.onPlay(() => {
  audio.unlock();
  audio.click();
  if (shot) return;
  if (match.phase === 'menu') {
    hud.hideOverlay();
    startMatch();
  } else if (match.phase === 'matchEnd') {
    hud.hideOverlay();
    startMatch();
  } else if (match.phase === 'roundEnd') {
    hud.hideOverlay();
    requestLock();
  } else if (!player.alive) {
    hud.hideOverlay();
    hud.showSpectateNote();
  } else {
    hud.hideOverlay();
    requestLock();
  }
});

// --- shooting: one ray, walls vs bodies, nearest hit wins -----------------
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Body spheres for a bot (or the player when `isPlayer`).
function bodySpheres(target, isPlayer) {
  if (isPlayer) {
    const crouch = player.crouched;
    const eye = crouch ? EYE_CROUCH : EYE_STAND;
    return [
      { part: 'head', x: target.pos.x, y: eye - 0.08, z: target.pos.z, r: 0.26 },
      { part: 'torso', x: target.pos.x, y: crouch ? 0.72 : 1.08, z: target.pos.z, r: 0.46 },
      { part: 'leg', x: target.pos.x, y: crouch ? 0.3 : 0.42, z: target.pos.z, r: 0.4 },
    ];
  }
  return [
    { part: 'head', x: target.pos.x, y: 1.72, z: target.pos.z, r: 0.26 },
    { part: 'torso', x: target.pos.x, y: 1.22, z: target.pos.z, r: 0.44 },
    { part: 'leg', x: target.pos.x, y: 0.45, z: target.pos.z, r: 0.38 },
  ];
}

// Resolve one hitscan shot. Returns {hit: 'wall'|'bot'|'player'|null, ...}.
function resolveShot(shooter, ox, oy, oz, dx, dy, dz, maxDist) {
  const wallDist = rayHitSolids(ox, oy, oz, dx, dy, dz, maxDist);
  let best = null;
  let bestDist = wallDist;
  // Bots.
  for (const bot of bots) {
    if (!bot.alive || bot === shooter) continue;
    for (const s of bodySpheres(bot, false)) {
      const t = raySphere(ox, oy, oz, dx, dy, dz, s.x, s.y, s.z, s.r);
      if (t < bestDist) {
        bestDist = t;
        best = { kind: 'bot', bot, part: s.part, dist: t };
      }
    }
  }
  // The player (only when a bot shoots).
  if (shooter !== 'player' && player.alive) {
    for (const s of bodySpheres(player, true)) {
      const t = raySphere(ox, oy, oz, dx, dy, dz, s.x, s.y, s.z, s.r);
      if (t < bestDist) {
        bestDist = t;
        best = { kind: 'player', part: s.part, dist: t };
      }
    }
  }
  const endX = ox + dx * bestDist;
  const endY = oy + dy * bestDist;
  const endZ = oz + dz * bestDist;
  if (best) {
    best.point = { x: endX, y: endY, z: endZ };
    return best;
  }
  if (wallDist < maxDist) {
    return { kind: 'wall', dist: wallDist, point: { x: endX, y: endY, z: endZ } };
  }
  return { kind: null, dist: maxDist, point: { x: endX, y: endY, z: endZ } };
}

function applyShotResult(shooter, weapon, result) {
  const from = { x: _origin.x, y: _origin.y, z: _origin.z };
  spawnTracer(from, result.point, weapon.tracer);
  if (result.kind === 'wall') {
    spawnSparks(result.point);
    return;
  }
  if (result.kind === 'bot') {
    const victim = result.bot;
    const dmg = baseDamage(weapon, result.dist);
    const died = victim.takeDamage(dmg, result.part, weapon);
    if (shooter === 'player') {
      audio.hit();
      if (result.part === 'head') audio.headshot();
      hud.hitmarker(died, result.part === 'head');
      markSeen(victim);
    } else if (victim.team === 'vanguard') {
      // A teammate was hit; the player hears it.
      audio.distantShot();
    }
    if (died) handleKill(shooter, victim, result.part);
    return;
  }
  if (result.kind === 'player') {
    const dmg = baseDamage(weapon, result.dist);
    damagePlayer(dmg, result.part, weapon, shooter);
  }
}

function damagePlayer(amount, part, weapon, shooter) {
  const split = applyArmor(amount * (part === 'head' ? weapon.headshot : 1), player.armor, weapon.armorPen);
  player.armor = Math.max(0, player.armor - split.armor);
  player.hp -= split.hp;
  audio.hurt();
  const sx = shooter.pos ? shooter.pos.x : shooter.x;
  const sz = shooter.pos ? shooter.pos.z : shooter.z;
  const ang = Math.atan2(sx - player.pos.x, sz - player.pos.z);
  hud.damageFlash(((ang - player.yaw) * 180) / Math.PI);
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    player.deaths++;
    const aliveMates = bots.filter((b) => b.team === 'vanguard' && b.alive);
    spectateBot = aliveMates[0] || bots.find((b) => b.alive) || null;
    if (!shot) hud.showOverlay('dead');
    hud.showSpectateNote();
    checkRoundEnd();
  }
}

function handleKill(killer, victim, part) {
  victim.deaths++;
  const killerName = killer === 'player' ? 'YOU' : killer.name;
  const killerTeam = killer === 'player' ? 'vanguard' : killer.team;
  hud.addKill(killerName, victim.name, killerTeam, part === 'head');
  if (killer !== 'player') {
    killer.kills++;
    if (killer.team === 'vanguard') match.kills.v++;
    else match.kills.s++;
  } else {
    player.kills++;
    match.kills.v++;
    player.money += KILL_REWARD;
    audio.kill();
    hud.setMoney(player.money);
  }
  // The spike changes hands when its carrier dies.
  if (victim.carrier) {
    victim.carrier = false;
    const next = bots.find((b) => b.team === 'specter' && b.alive);
    if (next) {
      next.carrier = true;
      bomb.carrier = next;
    }
  }
  checkRoundEnd();
}

function markSeen(bot) {
  seenEnemies.push({ x: bot.pos.x, z: bot.pos.z, t: match.time });
  if (seenEnemies.length > 40) seenEnemies.shift();
}

// --- player firing ---------------------------------------------------------
let prevMouseDown = false;
function tryFire(now) {
  const weapon = WEAPONS[player.weaponId];
  if (match.phase !== 'live' || !player.alive) return;
  if (player.reloadingUntil) return;
  if (now - player.lastShotAt < shotInterval(weapon)) return;
  const want = weapon.auto ? mouseDown : mouseDown && !prevMouseDown;
  if (!want) return;
  if (player.mag <= 0) {
    audio.dryFire();
    startReload();
    player.lastShotAt = now;
    return;
  }
  player.lastShotAt = now;
  player.mag--;
  player.bloom = Math.min(1, player.bloom + 0.22);
  player.pitch = clamp(player.pitch + weapon.recoil * 0.0035, -1.45, 1.45);
  player.recoil = 1;
  const moving = keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
  const spread = weapon.spread + player.bloom * 0.02 + (moving ? weapon.moveSpread : 0);
  const yaw = player.yaw + (Math.random() - 0.5) * 2 * spread;
  const pitch = player.pitch + (Math.random() - 0.5) * 2 * spread;
  camera.getWorldPosition(_origin);
  _dir.set(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
  muzzle.getWorldPosition(_hit);
  _origin.set(_hit.x, _hit.y, _hit.z);
  const result = resolveShot('player', _origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, 90);
  applyShotResult('player', weapon, result);
  audio.shot(player.weaponId);
  flashLight.intensity = 14;
  hud.setAmmo(player.mag, player.reserve, player.weaponId);
  if (player.mag === 0) startReload();
}

function startReload() {
  const weapon = WEAPONS[player.weaponId];
  if (player.reloadingUntil || player.mag >= weapon.mag || player.reserve <= 0) return;
  if (match.phase !== 'live' && match.phase !== 'buy') return;
  player.reloadingUntil = match.time + weapon.reload;
  player.reloadWeapon = player.weaponId;
  audio.reload();
}

// --- economy ---------------------------------------------------------------
function showScoreboard() {
  const rows = [
    { name: 'YOU', team: 'vanguard', kills: player.kills, deaths: player.deaths, money: player.money, me: true },
    ...bots
      .filter((b) => b.team === 'vanguard')
      .map((b) => ({ name: b.name, team: 'vanguard', kills: b.kills, deaths: b.deaths, money: null })),
    ...bots
      .filter((b) => b.team === 'specter')
      .map((b) => ({ name: b.name, team: 'specter', kills: b.kills, deaths: b.deaths, money: null })),
  ];
  hud.showScoreboard(match.score.v, match.score.s, rows);
}

function buyWeapon(id) {
  const w = WEAPONS[id];
  if (player.weaponId === id) { audio.denied(); return; }
  if (player.money < w.price) { audio.denied(); hud.setHint('Not enough money'); return; }
  player.money -= w.price;
  player.weaponId = id;
  const ammo = freshAmmo(id);
  player.mag = ammo.mag;
  player.reserve = ammo.reserve;
  player.reloadingUntil = 0;
  audio.buy();
  hud.setAmmo(player.mag, player.reserve, id);
  hud.setMoney(player.money);
  hud.showBuy(player.money, match.buyTime, { weapon: player.weaponId, armor: player.armor > 0 });
}

function buyArmor() {
  if (player.armor >= 100) { audio.denied(); return; }
  if (player.money < ARMOR_PRICE) { audio.denied(); hud.setHint('Not enough money'); return; }
  player.money -= ARMOR_PRICE;
  player.armor = 100;
  audio.buy();
  hud.setMoney(player.money);
  hud.showBuy(player.money, match.buyTime, { weapon: player.weaponId, armor: true });
}

// --- rounds ------------------------------------------------------------------
function startMatch() {
  match.score = { v: 0, s: 0 };
  match.round = 1;
  match.kills = { v: 0, s: 0 };
  player.money = START_MONEY;
  player.weaponId = 'p9';
  const ammo = freshAmmo('p9');
  player.mag = ammo.mag;
  player.reserve = ammo.reserve;
  player.armor = 0;
  startBuy();
}

function startBuy() {
  match.phase = 'buy';
  match.buyTime = MAP.buyTime;
  match.roundTime = MAP.roundTime;
  // Reset everyone to their spawns.
  player.pos.x = SPAWNS.vanguard[0].x;
  player.pos.z = SPAWNS.vanguard[0].z;
  player.yaw = SPAWNS.vanguard[0].yaw;
  player.pitch = 0;
  player.hp = 100;
  player.alive = true;
  player.reloadingUntil = 0;
  player.defusing = false;
  player.defuseUntil = 0;
  spectateBot = null;
  hud.hideSpectateNote();
  // If the player died last round they lost their rifle.
  if (player.weaponId !== 'p9' && !player._survived) {
    player.weaponId = 'p9';
    const ammo = freshAmmo('p9');
    player.mag = ammo.mag;
    player.reserve = ammo.reserve;
  }
  player._survived = false;
  bomb.state = 'carried';
  bomb.site = null;
  bomb.defuser = null;
  spikeGroup.visible = false;
  seenEnemies.length = 0;
  // Vanguard bots take four of the five hold spots, shuffled.
  const spots = [...HOLD_SPOTS];
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  bots.forEach((bot, i) => {
    const spawn = bot.team === 'vanguard'
      ? SPAWNS.vanguard[bot.index + 1]
      : SPAWNS.specter[bot.index];
    bot.reset(spawn);
    if (bot.team === 'vanguard') {
      bot.holdSpot = spots[i];
      bot.state = 'hold';
    } else {
      bot.weaponId = bot.index === 0 || random() < 0.3 ? 'ar77' : 'vk9';
      bot.mag = bot.weapon.mag;
      bot.reserve = bot.weapon.reserve;
    }
  });
  // Specters pick a site; one of them carries the spike.
  const siteKey = random() < 0.5 ? 'A' : 'B';
  const attackers = bots.filter((b) => b.team === 'specter');
  const carrier = attackers[Math.floor(random() * attackers.length)];
  carrier.carrier = true;
  bomb.carrier = carrier;
  for (const bot of attackers) bot.setObjective(siteKey);
  hud.setScore(match.score.v, match.score.s, match.round);
  hud.setHealth(player.hp, player.armor);
  hud.setAmmo(player.mag, player.reserve, player.weaponId);
  hud.setMoney(player.money);
  hud.setAlive(5, 5);
  hud.setBomb('carried');
  hud.showBuy(player.money, match.buyTime, { weapon: player.weaponId, armor: player.armor > 0 });
  hud.banner(`ROUND ${match.round}`, 'Buy phase — keys 1-5 to buy, ENTER to deploy', 2200);
  if (!shot) requestLock();
}

function startRound() {
  if (match.phase !== 'buy') return;
  match.phase = 'live';
  match.roundTime = MAP.roundTime;
  hud.hideBuy();
  hud.setHint('');
  hud.banner(`ROUND ${match.round} — GO`, 'Defend the sites. Stop the spike.', 1800);
}

function endRound(winner, reason) {
  if (match.phase !== 'live') return;
  match.phase = 'roundEnd';
  match.roundWinner = winner;
  match.roundEndReason = reason;
  match.roundEndAt = match.time + 4.5;
  if (winner === 'vanguard') {
    match.score.v++;
    player.money += ROUND_WIN_REWARD;
    if (reason === 'defused') player.money += DEFUSE_REWARD;
    audio.roundWin();
  } else {
    match.score.s++;
    player.money += ROUND_LOSS_REWARD;
    audio.roundLose();
  }
  player._survived = player.alive;
  hud.setScore(match.score.v, match.score.s, match.round);
  hud.setMoney(player.money);
  hud.setBomb('none');
  hud.banner(
    winner === 'vanguard' ? 'ROUND WON' : 'ROUND LOST',
    reason === 'eliminated' ? 'Enemy team eliminated'
    : reason === 'defused' ? 'Spike defused'
    : reason === 'detonated' ? 'The spike detonated'
    : reason === 'time' ? 'Time expired — no plant'
    : reason,
    4200,
  );
  spikeGroup.visible = false;
}

function checkRoundEnd() {
  if (match.phase !== 'live') return;
  const vAlive = bots.filter((b) => b.team === 'vanguard' && b.alive).length + (player.alive ? 1 : 0);
  const sAlive = bots.filter((b) => b.team === 'specter' && b.alive).length;
  if (sAlive === 0 && bomb.state !== 'planted') {
    endRound('vanguard', 'eliminated');
  } else if (vAlive === 0) {
    endRound('specter', 'eliminated');
  }
}

function endMatch() {
  match.phase = 'matchEnd';
  const won = match.score.v > match.score.s;
  hud.showOverlay('match', { won, v: match.score.v, s: match.score.s });
  document.exitPointerLock && document.exitPointerLock();
}

// --- bot world callbacks -----------------------------------------------------
const world = {
  get time() { return match.time; },
  player,
  playerDefusing: () => player.defusing,
  bots,
  bomb,
  onShoot(bot, eye, dir, dist) {
    _origin.set(eye.x, eye.y, eye.z);
    const result = resolveShot(bot, _origin.x, _origin.y, _origin.z, dir.x, dir.y, dir.z, 80);
    applyShotResult(bot, bot.weapon, result);
    const pd = Math.hypot(eye.x - player.pos.x, eye.z - player.pos.z);
    if (pd < 26) audio.shot(bot.weaponId);
    else audio.distantShot();
  },
  onReload(bot) {
    const pd = Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z);
    if (pd < 18) audio.reload();
  },
  onPlantStart(bot) {
    audio.plantStart();
    hud.banner('SPIKE BEING PLANTED', `Site ${bot.channel.site} — get there now`, 2200);
    hud.setHint('The spike is being planted — rotate!');
  },
  onDefuseStart(bot) {
    audio.defuseBeep();
    bomb.defuser = bot;
    hud.banner('TEAMMATE DEFUSING', `${bot.name} is on the spike — cover them`, 2200);
  },
};

function updateBots(dt) {
  // A dead defuser frees the spike for the next defender.
  if (bomb.defuser && !bomb.defuser.alive) bomb.defuser = null;
  for (const bot of bots) {
    const event = bot.update(dt, world);
    if (event === 'planted') {
      bomb.state = 'planted';
      bomb.site = bot.targetSite;
      bomb.timer = MAP.bombTime;
      const plant = SITES[bomb.site].plant;
      bomb.x = plant.x;
      bomb.z = plant.z;
      spikeGroup.position.set(plant.x, 0.12, plant.z);
      spikeGroup.visible = true;
      audio.plantBeep();
      player.money += 0; // plant reward goes to the attackers, not the player
      hud.banner(`SPIKE PLANTED — SITE ${bomb.site}`, 'Defuse it before the timer burns down', 3000);
      hud.setBomb('planted', bomb.timer);
      hud.setHint('Spike planted — hold E near it to defuse');
      // Defenders rotate to the site.
      for (const mate of bots) {
        if (mate.team === 'vanguard' && mate.alive) {
          mate.state = 'rotate';
          mate.targetSite = bomb.site;
          mate.goToNode(bomb.site === 'A' ? 12 : 13);
        }
      }
    } else if (event === 'defused') {
      bomb.defuser = null;
      bomb.state = 'carried';
      spikeGroup.visible = false;
      audio.roundWin();
      endRound('vanguard', 'defused');
    }
  }
}

// --- player movement & camera --------------------------------------------------
function updatePlayer(dt) {
  const now = match.time;
  if (player.reloadingUntil && now >= player.reloadingUntil) {
    const w = WEAPONS[player.reloadWeapon];
    const need = w.mag - player.mag;
    const take = Math.min(need, player.reserve);
    player.mag += take;
    player.reserve -= take;
    player.reloadingUntil = 0;
    hud.setAmmo(player.mag, player.reserve, player.weaponId);
  }

  const canMove = (match.phase === 'live' || match.phase === 'buy') && player.alive;
  let mx = 0;
  let mz = 0;
  if (canMove && locked) {
    if (keys.has('KeyW')) mz -= 1;
    if (keys.has('KeyS')) mz += 1;
    if (keys.has('KeyA')) mx -= 1;
    if (keys.has('KeyD')) mx += 1;
  }
  const moving = mx !== 0 || mz !== 0;
  player.crouched = keys.has('ControlLeft') || keys.has('ControlRight');
  const speed = PLAYER_SPEED * (player.crouched ? 0.5 : 1) * (player.defusing ? 0 : 1);
  if (moving) {
    const len = Math.hypot(mx, mz);
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const dx = ((mx * cos - mz * sin) / len) * speed * dt;
    const dz = ((mx * sin + mz * cos) / len) * speed * dt;
    moveCircle(player.pos, PLAYER_RADIUS, dx, dz, player.y, 1.7);
    player.stepPhase += dt * speed * 1.6;
    if (Math.floor(player.stepPhase / Math.PI) !== Math.floor((player.stepPhase - dt * speed * 1.6) / Math.PI)) {
      audio.step();
    }
  }

  // Jump / gravity.
  if (canMove && keys.has('Space') && player.onGround) {
    player.vy = 5.2;
    player.onGround = false;
  }
  if (!player.onGround || player.y > 0) {
    player.vy -= 16 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.onGround = true;
    }
  }

  // Firing.
  if (locked || shot) tryFire(now);
  prevMouseDown = mouseDown;

  // Bloom recovery, recoil recovery, viewmodel.
  player.bloom = Math.max(0, player.bloom - dt * 1.4);
  player.recoil = Math.max(0, player.recoil - dt * 6);
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 220);
  const bob = moving && player.onGround ? Math.sin(player.stepPhase * 2) * 0.012 : 0;
  const reloading = player.reloadingUntil ? 1 : 0;
  viewmodel.position.set(
    0.26 + bob * 0.4,
    -0.24 + bob - reloading * 0.08,
    -0.55 + player.recoil * 0.09,
  );
  viewmodel.rotation.x = player.recoil * 0.14 + reloading * 0.5;

  // Defuse: hold E within 1.6 m of a planted spike.
  if (match.phase === 'live' && bomb.state === 'planted' && player.alive) {
    const bd = Math.hypot(bomb.x - player.pos.x, bomb.z - player.pos.z);
    if (bd < 1.6 && keys.has('KeyE')) {
      if (!player.defusing) {
        player.defusing = true;
        player.defuseUntil = now + MAP.defuseTime;
        audio.defuseBeep();
      }
      const pct = Math.round((1 - (player.defuseUntil - now) / MAP.defuseTime) * 100);
      hud.setChannel(pct, 'DEFUSING THE SPIKE — HOLD E');
      if (now >= player.defuseUntil) {
        player.defusing = false;
        hud.hideChannel();
        bomb.state = 'carried';
        spikeGroup.visible = false;
        endRound('vanguard', 'defused');
      }
    } else {
      if (player.defusing) hud.setHint('Spike planted — hold E near it to defuse');
      player.defusing = false;
      if (!bomb.defuser) hud.hideChannel();
    }
  } else {
    player.defusing = false;
    if (!bomb.defuser) hud.hideChannel();
  }

  // Camera.
  const eyeY = player.y + (player.crouched ? EYE_CROUCH : EYE_STAND);
  if (player.alive) {
    camera.position.set(player.pos.x, eyeY, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  } else if (spectateBot) {
    camera.position.set(spectateBot.pos.x, 1.62, spectateBot.pos.z);
    camera.rotation.set(spectateBot.aimPitch || 0, spectateBot.yaw, 0, 'YXZ');
  }
  hud.setSpread(player.bloom, moving);
}

// --- explosion effect --------------------------------------------------------
const boom = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0 }),
);
boom.visible = false;
scene.add(boom);
const boomLight = new THREE.PointLight(0xff8030, 0, 30, 1.5);
scene.add(boomLight);
let boomLife = 0;
let lastBeepAt = 0;

function detonate() {
  boom.position.set(bomb.x, 1, bomb.z);
  boom.visible = true;
  boomLife = 0.9;
  boomLight.position.set(bomb.x, 2, bomb.z);
  boomLight.intensity = 60;
  audio.explosion();
  spikeGroup.visible = false;
  endRound('specter', 'detonated');
}

// --- timers ------------------------------------------------------------------
function updateTimers(dt) {
  if (match.phase === 'buy') {
    match.buyTime -= dt;
    hud.updateBuyTimer(match.buyTime);
    hud.setTimer(match.buyTime);
    if (match.buyTime <= 0) startRound();
    return;
  }
  if (match.phase === 'live') {
    if (bomb.state === 'planted') {
      bomb.timer -= dt;
      hud.setTimer(bomb.timer);
      hud.setBomb('planted', bomb.timer);
      const interval = bomb.timer > 20 ? 1.0 : bomb.timer > 10 ? 0.6 : 0.35;
      if (match.time - lastBeepAt >= interval) {
        lastBeepAt = match.time;
        audio.plantBeep();
      }
      if (bomb.timer <= 0) detonate();
    } else {
      match.roundTime -= dt;
      hud.setTimer(match.roundTime);
      if (match.roundTime <= 0) endRound('vanguard', 'time');
    }
    return;
  }
  if (match.phase === 'roundEnd' && match.time >= match.roundEndAt) {
    if (match.score.v >= WIN_ROUNDS || match.score.s >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
      endMatch();
    } else {
      match.round++;
      startBuy();
    }
  }
}

// --- per-frame HUD -------------------------------------------------------------
function refreshHud() {
  const vAlive = bots.filter((b) => b.team === 'vanguard' && b.alive).length + (player.alive ? 1 : 0);
  const sAlive = bots.filter((b) => b.team === 'specter' && b.alive).length;
  hud.setAlive(vAlive, sAlive);
  hud.setHealth(player.hp, player.armor);
  // A teammate on the spike: show their defuse progress.
  if (bomb.defuser && bomb.defuser.channel && bomb.defuser.channel.kind === 'defuse') {
    const ch = bomb.defuser.channel;
    const pct = Math.round((1 - (ch.until - match.time) / MAP.defuseTime) * 100);
    hud.setChannel(pct, `${bomb.defuser.name.toUpperCase()} IS DEFUSING`);
  }
  if (match.phase === 'live') {
    // Spot enemies the player can actually see, for the minimap.
    const eyeY = player.y + (player.crouched ? EYE_CROUCH : EYE_STAND);
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    for (const bot of bots) {
      if (bot.team !== 'specter' || !bot.alive) continue;
      const dx = bot.pos.x - player.pos.x;
      const dz = bot.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 45 || dist < 0.5) continue;
      if ((dx * fx + dz * fz) / dist < 0.82) continue;
      if (sightBlocked(player.pos.x, eyeY, player.pos.z, bot.pos.x, bot.eyeY, bot.pos.z)) continue;
      markSeen(bot);
    }
  }
  hud.drawMinimap({ SOLIDS, SITES }, player, bots, seenEnemies, bomb);
}

function updateEffects(dt) {
  for (const t of tracerPool) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
    }
  }
  for (const s of sparkPool) {
    if (s.life > 0) {
      s.life -= dt;
      const p = s.pts.geometry.attributes.position;
      for (let i = 0; i < 10; i++) {
        p.setXYZ(i,
          p.getX(i) + s.vel[i * 3] * dt,
          Math.max(0.02, p.getY(i) + s.vel[i * 3 + 1] * dt),
          p.getZ(i) + s.vel[i * 3 + 2] * dt);
        s.vel[i * 3 + 1] -= 9 * dt;
      }
      p.needsUpdate = true;
      s.pts.material.opacity = Math.max(0, s.life / 0.35);
    }
  }
  if (boomLife > 0) {
    boomLife -= dt;
    const t = 1 - Math.max(0, boomLife) / 0.9;
    boom.scale.setScalar(1 + t * 13);
    boom.material.opacity = Math.max(0, 0.85 * (1 - t));
    boomLight.intensity = Math.max(0, 60 * (1 - t));
    if (boomLife <= 0) boom.visible = false;
  }
  // Spike beacon blink.
  if (spikeGroup.visible) {
    const light = spikeGroup.getObjectByName('spike-light');
    if (light) light.material.emissiveIntensity = 1 + Math.sin(match.time * 9) * 1.2;
  }
}

// --- main loop -------------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;

function step(dt) {
  match.time += dt;
  updateTimers(dt);
  world.allowCombat = match.phase === 'live';
  if (match.phase === 'live' || match.phase === 'buy') {
    updatePlayer(dt);
    // Bots walk to their positions during the buy phase and fight live.
    updateBots(dt);
  }
  updateEffects(dt);
  refreshHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (frozen) return;
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += dt;
  let guard = 0;
  while (accumulator >= FIXED_STEP && guard < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    guard++;
  }
  renderer.render(scene, camera);
  if (shot) {
    shotFrames++;
    if (shotFrames >= 2) {
      frozen = true;
      window.__shotReady = true;
    }
  }
}

// --- deterministic captures --------------------------------------------------
function stageShot() {
  if (shot === 'start') {
    player.pos.x = SPAWNS.vanguard[0].x;
    player.pos.z = SPAWNS.vanguard[0].z;
    player.yaw = 0;
    player.pitch = 0;
    camera.position.set(player.pos.x, EYE_STAND, player.pos.z);
    camera.rotation.set(0, player.yaw, 0, 'YXZ');
    hud.showOverlay('start');
    hud.setScore(0, 0, 1);
    hud.setHealth(100, 0);
    hud.setAmmo(WEAPONS.p9.mag, WEAPONS.p9.reserve, 'p9');
    hud.setMoney(START_MONEY);
    hud.setTimer(MAP.roundTime);
    hud.setAlive(5, 5);
    return;
  }
  if (shot === 'end') {
    match.score = { v: 8, s: 5 };
    match.round = 13;
    hud.setScore(8, 5, 13);
    hud.setHealth(100, 50);
    hud.setAmmo(24, 60, 'ar77');
    hud.setMoney(4200);
    hud.setTimer(0);
    hud.setAlive(3, 0);
    endMatch();
    return;
  }
  // shot === 'play': a live firefight, mid-map, staged deterministically.
  startMatch();
  startRound();
  locked = true; // pretend the pointer is locked for this capture
  player.pos.x = 0;
  player.pos.z = 9;
  player.yaw = 0.12;
  player.pitch = 0.01;
  player.weaponId = 'ar77';
  const ammo = freshAmmo('ar77');
  player.mag = ammo.mag;
  player.reserve = ammo.reserve;
  const attackers = bots.filter((b) => b.team === 'specter');
  const mates = bots.filter((b) => b.team === 'vanguard');
  // Two Specters pushing mid, one Vanguard mate beside the player.
  const stage = [
    [attackers[0], 2.5, -4.5],
    [attackers[1], -3, -7],
    [attackers[2], 24, -6],
    [mates[0], -4.5, 6.5],
    [mates[1], 18, -12],
  ];
  for (const [bot, x, z] of stage) {
    bot.pos.x = x;
    bot.pos.z = z;
    bot.state = 'hold';
    bot.path = [];
    bot.holdSpot = { x, z, yaw: bot.team === 'specter' ? 0 : Math.PI };
    bot.yaw = bot.team === 'specter' ? 0 : Math.PI;
    bot.aimYaw = bot.yaw;
  }
  // Let the bots aim and trade fire for a couple of simulated seconds,
  // and let the player put a burst downrange, so the frame has tracers.
  for (let i = 0; i < 150; i++) {
    match.time += FIXED_STEP;
    updateBots(FIXED_STEP);
    if (i > 90 && i < 100) {
      mouseDown = true;
      tryFire(match.time);
      mouseDown = false;
    }
  }
  mouseDown = false;
  // The staged firefight may have downed the player; stand them back up
  // for the capture and keep the staged readouts.
  player.hp = 86;
  player.alive = true;
  spectateBot = null;
  hud.hideSpectateNote();
  match.roundTime = 61;
  updatePlayer(0);
  hud.hideOverlay();
  hud.setAmmo(player.mag, player.reserve, 'ar77');
  hud.setHealth(86, 50);
  hud.setMoney(2750);
  hud.setTimer(61);
  hud.setScore(2, 1, 4);
  hud.setAlive(4, 4);
  hud.setBomb('carried');
  hud.banner('ROUND 4', 'Specters pushing mid', 60000);
}

// --- boot ----------------------------------------------------------------------
// Read-only state handle for playtesting and debugging (used by the
// headless playtest; it exposes no mutating controls).
window.__breachline = { match, bomb, bots, player, version: 1 };

if (shot) {
  stageShot();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
} else {
  hud.showOverlay('start');
  hud.setScore(0, 0, 1);
  hud.setHealth(100, 0);
  hud.setAmmo(WEAPONS.p9.mag, WEAPONS.p9.reserve, 'p9');
  hud.setMoney(START_MONEY);
  hud.setTimer(MAP.roundTime);
  hud.setAlive(5, 5);
  hud.setBomb('none');
  requestAnimationFrame(frame);
}
