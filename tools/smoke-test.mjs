// BREACHLINE — headless smoke test. Runs the real bot AI (bots.js,
// map.js, weapons.js) in Node against a fake scene and a scripted
// player, and asserts the match actually plays: attackers path to a
// site, the spike gets planted, defenders rotate, and rounds resolve.
// Run via tools/run-smoke.sh (it stages the files with a `three` shim).
import * as THREE from 'three';
import { createBots } from './bots.js';
import { NODES, EDGES, SOLIDS, SITES, moveCircle, rayHitSolids, sightBlocked } from './map.js';
import { mulberry32 } from './util.js';
import { WEAPONS, baseDamage } from './weapons.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const random = mulberry32(42);
const scene = { add() {}, remove() {} };
const bots = createBots(scene, random);
check('9 bots created (4 Vanguard + 5 Specters)', bots.length === 9);
check('vanguard bots hold spots assigned',
  bots.filter((b) => b.team === 'vanguard').every((b) => b.holdSpot));

// --- map sanity -----------------------------------------------------------
check('wall blocks a ray (mid north wall)',
  rayHitSolids(0, 1.5, 0, 0, 0, -1, 50) < 50);
check('open lane has no wall hit',
  rayHitSolids(0, 1.5, 10, 0, 0, -1, 4) === 4);
// Every waypoint edge must be walkable: no solid within a bot's radius
// of any point on the segment (regression: the old furnace sat on the
// spawn -> plaza edge and bots walked into it forever).
let blockedEdge = null;
for (const [a, b] of EDGES) {
  const A = NODES[a];
  const B = NODES[b];
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const x = A.x + (B.x - A.x) * t;
    const z = A.z + (B.z - A.z) * t;
    for (const s of SOLIDS) {
      const cx = Math.max(s.x0, Math.min(x, s.x1));
      const cz = Math.max(s.z0, Math.min(z, s.z1));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < 0.45 * 0.45) { blockedEdge = `${a}-${b} at (${x.toFixed(1)},${z.toFixed(1)})`; break; }
    }
    if (blockedEdge) break;
  }
  if (blockedEdge) break;
}
check('all waypoint edges are walkable', blockedEdge === null, blockedEdge || '');
check('sight blocked through divider wall',
  sightBlocked(-16, 1.5, 0, -10, 1.5, 0) === true);
check('sight open down mid',
  sightBlocked(0, 1.5, 8, 0, 1.5, -4) === false);
check('spawn-to-spawn sightline is blocked',
  sightBlocked(8, 1.5, -20, 6, 1.5, 19) === true);
check('spawn-to-spawn sightline is blocked (west)',
  sightBlocked(-8, 1.5, -20, -6, 1.5, 19) === true);
const probe = { x: -12.9, z: 0 };
moveCircle(probe, 0.42, -1.5, 0); // walk west into the divider wall
check('collision stops at a wall', probe.x > -13.5, `x=${probe.x.toFixed(2)}`);

// --- weapons sanity ---------------------------------------------------------
check('rifle damage falls off with range',
  baseDamage(WEAPONS.ar77, 5) > baseDamage(WEAPONS.ar77, 50));
check('sniper one-shots torso at close range',
  baseDamage(WEAPONS.lm88, 10) >= 100);

// --- full simulated round ----------------------------------------------------
const attackers = bots.filter((b) => b.team === 'specter');
const defenders = bots.filter((b) => b.team === 'vanguard');
const carrier = attackers[2];
carrier.carrier = true;
for (const bot of attackers) bot.setObjective('A');

const player = { pos: { x: 0, z: 20 }, hp: 100, alive: true, crouched: false };
const bomb = { state: 'carried', site: null, x: 0, z: 0, timer: 35, carrier, defuser: null };
let shotsFired = 0;
let kills = 0;

const world = {
  time: 0,
  allowCombat: false,
  player,
  bots,
  bomb,
  onShoot(shooter, eye, dir) {
    shotsFired++;
    // Simplified resolution for the smoke test: damage a random visible
    // enemy in the shot's rough direction, so kills actually happen.
    const enemies = bots.filter((b) => b.alive && b.team !== shooter.team);
    const visible = enemies.filter((b) =>
      Math.hypot(b.pos.x - eye.x, b.pos.z - eye.z) < 45 &&
      !sightBlocked(eye.x, eye.y, eye.z, b.pos.x, 1.55, b.pos.z));
    const target = visible[Math.floor(random() * visible.length)];
    if (target) {
      const died = target.takeDamage(baseDamage(shooter.weapon, 20), 'torso', shooter.weapon);
      if (died) kills++;
    }
  },
  onReload() {},
  onPlantStart() {},
  onDefuseStart(bot) { bomb.defuser = bot; },
};

let plantedAt = null;
let defusedAt = null;
let simSeconds = 0;

// Buy phase: defenders walk to their hold spots, attackers wait at
// spawn, nobody shoots. (20 s: the farthest hold spot is ~63 m of
// lanes from spawn at ~3.7 m/s.)
for (let step = 0; step < 60 * 20; step++) {
  world.time = step / 60;
  for (const bot of bots) bot.update(1 / 60, world);
}
check('defenders took their hold spots in the buy phase',
  defenders.every((b) => Math.hypot(b.pos.x - b.holdSpot.x, b.pos.z - b.holdSpot.z) < 2.5),
  defenders.map((b) => `${b.name}:${Math.hypot(b.pos.x - b.holdSpot.x, b.pos.z - b.holdSpot.z).toFixed(1)}m`).join(' '));
check('attackers waited at spawn in the buy phase',
  attackers.every((b) => b.pos.z < -19),
  attackers.map((b) => `${b.name}@${Math.round(b.pos.z)}`).join(' '));
check('nobody fired during the buy phase', shotsFired === 0, `${shotsFired} shots`);
world.allowCombat = true;

// Note: match time is monotonic in the real game (main.js never resets
// it), so the round continues it from the buy phase instead of
// rewinding to 0 — rewinding left bots' reaction timers 20 s in the
// "future" and froze all fire for the first seconds of the round.
for (let step = 0; step < 60 * 240; step++) {
  world.time += 1 / 60;
  simSeconds = world.time;
  for (const bot of bots) {
    const ev = bot.update(1 / 60, world);
    if (ev === 'planted' && !plantedAt) {
      plantedAt = world.time;
      bomb.state = 'planted';
      bomb.site = 'A';
      bomb.timer = 35;
      bomb.x = SITES.A.plant.x;
      bomb.z = SITES.A.plant.z;
      for (const mate of defenders) {
        if (mate.alive) {
          mate.state = 'rotate';
          mate.goToNode(12);
        }
      }
    }
    if (ev === 'defused' && !defusedAt) defusedAt = world.time;
  }
  const sAlive = attackers.filter((b) => b.alive).length;
  const vAlive = defenders.filter((b) => b.alive).length + (player.alive ? 1 : 0);
  // Spike changes hands when its carrier dies (mirrors main.js).
  if (bomb.carrier && !bomb.carrier.alive && bomb.state === 'carried') {
    const next = attackers.find((b) => b.alive);
    if (next) {
      next.carrier = true;
      bomb.carrier = next;
    }
  }
  if (sAlive === 0 || vAlive === 0 || defusedAt) break;
  if (bomb.state === 'planted') {
    bomb.timer -= 1 / 60;
    if (bomb.timer <= 0) break; // would detonate
  }
}

check('attackers reached site A area',
  attackers.some((b) => Math.hypot(b.pos.x - SITES.A.plant.x, b.pos.z - SITES.A.plant.z) < 12),
  `closest=${Math.min(...attackers.map((b) => Math.hypot(b.pos.x - SITES.A.plant.x, b.pos.z - SITES.A.plant.z))).toFixed(1)}m`);
check('spike planted or round ended by eliminations',
  plantedAt !== null || kills > 0, `plantedAt=${plantedAt}, kills=${kills}`);
check('bots fired their weapons', shotsFired >= 10, `${shotsFired} shots`);
check('defenders rotated toward the planted site',
  plantedAt === null || defenders.some((b) => Math.hypot(b.pos.x - SITES.A.plant.x, b.pos.z - SITES.A.plant.z) < 14),
  `plantedAt=${plantedAt}`);
check('simulation resolved within 240s', simSeconds < 240, `${simSeconds.toFixed(1)}s`);
check('someone died in the firefight', kills > 0, `${kills} kills`);
console.log(failures === 0 ? 'SMOKE OK' : `SMOKE FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
