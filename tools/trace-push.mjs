// Trace one site-A push: log attacker positions, states, enemies and
// shots every 5 sim-seconds to find why the attack stalls.
import * as THREE from 'three';
import { createBots } from './bots.js';
import { SITES, sightBlocked } from './map.js';
import { mulberry32 } from './util.js';
import { baseDamage } from './weapons.js';

const random = mulberry32(42);
const scene = { add() {}, remove() {} };
const bots = createBots(scene, random);
const attackers = bots.filter((b) => b.team === 'specter');
const defenders = bots.filter((b) => b.team === 'vanguard');
const carrier = attackers[2];
carrier.carrier = true;
for (const bot of attackers) bot.setObjective('A');

const player = { pos: { x: 0, z: 20 }, hp: 100, alive: true, crouched: false };
const bomb = { state: 'carried', site: null, x: 0, z: 0, timer: 35, carrier, defuser: null };
let shots = 0;
const world = {
  time: 0, allowCombat: false, player, bots, bomb,
  onShoot(shooter, eye, dir) {
    shots++;
    const enemies = bots.filter((b) => b.alive && b.team !== shooter.team);
    const visible = enemies.filter((b) =>
      Math.hypot(b.pos.x - eye.x, b.pos.z - eye.z) < 45 &&
      !sightBlocked(eye.x, eye.y, eye.z, b.pos.x, 1.55, b.pos.z));
    const target = visible[Math.floor(random() * visible.length)];
    if (target) target.takeDamage(baseDamage(shooter.weapon, 20), 'torso', shooter.weapon);
  },
  onReload() {},
  onPlantStart() {},
  onDefuseStart(bot) { bomb.defuser = bot; },
};

// Buy phase.
for (let step = 0; step < 60 * 20; step++) {
  world.time = step / 60;
  for (const bot of bots) bot.update(1 / 60, world);
}
world.allowCombat = true;
console.log('buy done. defenders:', defenders.map((b) => `${b.name}@${Math.round(b.pos.x)},${Math.round(b.pos.z)}`).join(' '));

for (let sec = 0; sec <= 60; sec += 5) {
  for (let step = 0; step < 60 * 5; step++) {
    world.time += 1 / 60;
    for (const bot of bots) {
      const ev = bot.update(1 / 60, world);
      if (ev === 'planted') { console.log(`PLANTED at t=${world.time.toFixed(1)}`); process.exit(0); }
    }
    if (bomb.carrier && !bomb.carrier.alive) {
      const next = attackers.find((b) => b.alive);
      if (next) { next.carrier = true; bomb.carrier = next; }
    }
  }
  const att = attackers.map((b) =>
    `${b.name.slice(0, 4)}:${b.alive ? 'a' : 'x'}@${Math.round(b.pos.x)},${Math.round(b.pos.z)}[${b.state}${b.enemy ? '/F' : ''}]`).join(' ');
  const def = defenders.map((b) =>
    `${b.name.slice(0, 4)}:${b.alive ? 'a' : 'x'}@${Math.round(b.pos.x)},${Math.round(b.pos.z)}[${b.state}${b.enemy ? '/F' : ''}]`).join(' ');
  console.log(`t=${world.time.toFixed(0)}s shots=${shots} | ${att} || ${def}`);
}
console.log('no plant in 60s');
