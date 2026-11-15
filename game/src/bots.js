// BREACHLINE — bot agents: bodies, movement, aiming and tactics.
// A bot is a small state machine over the map's waypoint graph:
//   hold   — defenders sit on a hold spot and watch a lane
//   push   — attackers walk a BFS path toward their chosen site
//   plant  — the spike carrier channels the plant at a site
//   defuse — a defender channels the defuse on a planted spike
//   rotate — defenders run to the site where the spike went down
//   hunt   — anyone with no objective left chases the last known enemy
//   engage — overrides the rest while an enemy is visible: stop, aim,
//            and fire in bursts with a human-like reaction delay and
//            an aim error that grows with distance and movement.
//
// Bots never see through walls: every sight check runs the map's
// segment test, and every shot is a real ray against the same solids
// the player's bullets use, so a bot can miss, hit a wall, or be
// outplayed by cover exactly like a player can.

import * as THREE from 'three';
import { NODES, EDGES, SPAWNS, HOLD_SPOTS, moveCircle, sightBlocked, SITES } from './map.js';
import { bfsPath, nearestNode, turnToward, clamp, mulberry32 } from './util.js';
import { WEAPONS, baseDamage, applyArmor, shotInterval } from './weapons.js';

export const TEAMS = {
  vanguard: { name: 'Vanguard', color: 0x2f7fb8, dark: 0x1d4e6e, label: 'VAN' },
  specter: { name: 'Specters', color: 0xc0392b, dark: 0x7a241a, label: 'SPC' },
};

const BOT_NAMES = {
  vanguard: ['Kestrel', 'Bramble', 'Onyx', 'Piper'],
  specter: ['Wraith', 'Fenrir', 'Sable', 'Moth', 'Grimm'],
};

// Per-bot skill: reaction seconds, aim error at 10 m, burst size, walk
// speed. The carrier is a little slower; the first Specter is the best shot.
function skillFor(team, index, random) {
  const base = {
    reaction: 0.28 + random() * 0.35,
    aimError: 0.030 + random() * 0.035,
    burst: 3 + Math.floor(random() * 3),
    speed: 3.4 + random() * 0.7,
  };
  if (team === 'specter' && index === 0) {
    base.reaction = 0.22;
    base.aimError = 0.022;
    base.burst = 5;
  }
  return base;
}

function buildBody(THREE, team) {
  const colors = TEAMS[team];
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: colors.color, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: colors.dark, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x111417, roughness: 0.25, metalness: 0.5 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), suit);
  torso.position.y = 1.18;
  torso.castShadow = true;
  torso.userData.part = 'torso';
  group.add(torso);

  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.38), dark);
  vest.position.y = 1.24;
  vest.userData.part = 'torso';
  group.add(vest);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.32), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  head.userData.part = 'head';
  group.add(head);

  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.06), visor);
  visorMesh.position.set(0, 1.74, 0.17);
  visorMesh.userData.part = 'head';
  group.add(visorMesh);

  const legGeo = new THREE.BoxGeometry(0.24, 0.78, 0.26);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.16, 0.39, 0);
  legL.userData.part = 'leg';
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, dark);
  legR.position.set(0.16, 0.39, 0);
  legR.userData.part = 'leg';
  group.add(legR);

  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.18);
  const armL = new THREE.Mesh(armGeo, suit);
  armL.position.set(-0.4, 1.2, 0.1);
  armL.userData.part = 'torso';
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, suit);
  armR.position.set(0.4, 1.2, 0.1);
  armR.userData.part = 'torso';
  group.add(armR);

  // Rifle held across the chest, pointing where the bot faces.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.85), dark);
  gun.position.set(0.18, 1.32, 0.35);
  group.add(gun);

  group.userData = { torso, head, legL, legR, gun };
  return group;
}

export class Bot {
  constructor(scene, team, index, spawn, random) {
    this.team = team;
    this.index = index;
    this.name = BOT_NAMES[team][index];
    this.random = random;
    this.skill = skillFor(team, index, random);
    this.group = buildBody(THREE, team);
    this.group.position.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw;
    this.group.rotation.y = this.yaw;
    this.group.traverse((m) => { if (m.isMesh) m.userData.bot = this; });
    scene.add(this.group);

    this.pos = { x: spawn.x, z: spawn.z };
    this.eyeY = 1.55;
    this.radius = 0.42;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.weaponId = team === 'specter' ? (index === 0 ? 'ar77' : 'vk9') : 'ar77';
    this.mag = WEAPONS[this.weaponId].mag;
    this.reserve = WEAPONS[this.weaponId].reserve;
    this.state = 'hold';
    this.path = [];
    this.pathIndex = 0;
    this.targetSite = null;
    this.holdSpot = null;
    this.enemy = null; // current visible enemy (Bot or 'player')
    this.lastSeen = null; // {x, z, t} last known enemy position
    this.aimYaw = this.yaw;
    this.aimPitch = 0;
    this.reactUntil = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.reloadUntil = 0;
    this.channel = null; // {kind: 'plant'|'defuse', until, site}
    this.walkPhase = random() * Math.PI * 2;
    this.moving = false;
    this.deathTime = 0;
    this.carrier = false;
    this.kills = 0;
    this.deaths = 0;
    this.stuckFor = 0;
    this.sidestepDir = 1;
    this.sidestepUntil = 0;
  }

  // Move toward (tx, tz) at speed, with stuck recovery: when a wall or
  // crate stops all progress for a while, the bot sidesteps around it
  // instead of pushing into it forever. Returns true on arrival.
  moveToward(tx, tz, dt, speed, now) {
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const step = Math.min(dist, speed * dt);
    const bx = this.pos.x;
    const bz = this.pos.z;
    if (now < this.sidestepUntil) {
      const px = (-dz / dist) * this.sidestepDir;
      const pz = (dx / dist) * this.sidestepDir;
      moveCircle(this.pos, this.radius, px * speed * 0.7 * dt, pz * speed * 0.7 * dt);
    }
    moveCircle(this.pos, this.radius, (dx / dist) * step, (dz / dist) * step);
    const moved = Math.hypot(this.pos.x - bx, this.pos.z - bz);
    if (moved < step * 0.25) {
      this.stuckFor += dt;
      if (this.stuckFor > 1.2) {
        this.stuckFor = 0;
        this.sidestepDir = this.random() < 0.5 ? -1 : 1;
        this.sidestepUntil = now + 0.7;
      }
    } else {
      this.stuckFor = 0;
    }
    return false;
  }

  get weapon() { return WEAPONS[this.weaponId]; }

  eyePos(out) {
    out.set(this.pos.x, this.eyeY, this.pos.z);
    return out;
  }

  // Pick a site to attack and walk the graph there.
  setObjective(siteKey) {
    this.targetSite = siteKey;
    const goal = siteKey === 'A' ? 12 : 13;
    const start = nearestNode(NODES, this.pos.x, this.pos.z);
    this.path = bfsPath(adjacencyList(), start, goal) || [];
    this.pathIndex = 0;
    this.state = 'push';
  }

  // Direct order: walk to a node, used for rotates and hunts.
  goToNode(nodeIndex) {
    const start = nearestNode(NODES, this.pos.x, this.pos.z);
    this.path = bfsPath(adjacencyList(), start, nodeIndex) || [];
    this.pathIndex = 0;
  }

  // Where this bot is trying to get to right now, for the HUD minimap.
  destination() {
    if (this.path.length && this.pathIndex < this.path.length) {
      const n = NODES[this.path[this.pathIndex]];
      return { x: n.x, z: n.z };
    }
    return null;
  }

  takeDamage(amount, part, shooterWeapon) {
    if (!this.alive) return false;
    const mult = part === 'head' ? shooterWeapon.headshot : part === 'leg' ? 0.8 : 1;
    const split = applyArmor(amount * mult, this.armor, shooterWeapon.armorPen);
    this.armor = Math.max(0, this.armor - split.armor);
    this.hp -= split.hp;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deathTime = performance.now() / 1000;
      this.channel = null;
      // Fall over and sink slightly: the death pose.
      this.group.rotation.x = -Math.PI / 2;
      this.group.rotation.y = this.yaw;
      this.group.position.y = 0.25;
      return true;
    }
    return false;
  }

  reset(spawn) {
    this.pos.x = spawn.x;
    this.pos.z = spawn.z;
    this.yaw = spawn.yaw;
    this.aimYaw = spawn.yaw;
    this.group.position.set(spawn.x, 0, spawn.z);
    this.group.rotation.set(0, spawn.yaw, 0);
    this.hp = 100;
    this.armor = this.team === 'vanguard' ? 0 : 0;
    this.alive = true;
    this.mag = this.weapon.mag;
    this.reserve = this.weapon.reserve;
    this.state = 'hold';
    this.path = [];
    this.enemy = null;
    this.lastSeen = null;
    this.channel = null;
    this.carrier = false;
    this.aimPitch = 0;
    this.reactUntil = 0;
    this.burstLeft = 0;
  }

  // One simulation step. `world` gives the bot everything it needs:
  //   time, player {pos, hp, alive, crouched}, bots[], bomb {state, site, x, z},
  //   onShoot(bot, targetPoint), onPlant(bot), onDefuse(bot), onKill(killer, victim, part)
  // Returns an event string ('planted' | 'defused' | null) when a channel
  // completes.
  update(dt, world) {
    if (!this.alive) return null;
    const now = world.time;

    // Reloading pauses everything else.
    if (this.reloadUntil) {
      if (now >= this.reloadUntil) {
        const need = this.weapon.mag - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloadUntil = 0;
      } else {
        return null;
      }
    }

    // Finish a plant / defuse channel.
    if (this.channel) {
      if (now >= this.channel.until) {
        const kind = this.channel.kind;
        this.channel = null;
        return kind === 'plant' ? 'planted' : 'defused';
      }
      return null; // channelling: stand still, stay quiet
    }

    // --- perception: nearest visible enemy (player first if closer) ---
    let seen = null;
    let seenDist = Infinity;
    const eye = new THREE.Vector3(this.pos.x, this.eyeY, this.pos.z);
    const consider = (target, tx, ty, tz, isPlayer) => {
      const dx = tx - eye.x;
      const dy = ty - eye.y;
      const dz = tz - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 35) return; // bots cannot see across the whole map
      if (dist >= seenDist) return;
      if (sightBlocked(eye.x, eye.y, eye.z, tx, ty, tz)) return;
      seen = { target, dist, isPlayer, x: tx, y: ty, z: tz };
      seenDist = dist;
    };
    if (world.player.alive && this.team === 'specter') {
      // Only the Specters hunt the player: Vanguard bots are teammates.
      const py = world.player.crouched ? 1.15 : 1.55;
      consider('player', world.player.pos.x, py, world.player.pos.z, true);
    }
    for (const other of world.bots) {
      if (other === this || !other.alive || other.team === this.team) continue;
      consider(other, other.pos.x, other.eyeY, other.pos.z, false);
    }

    if (seen) {
      if (this.enemy !== seen.target) {
        // New contact: reaction delay before the first shot.
        this.enemy = seen.target;
        this.reactUntil = now + this.skill.reaction;
        this.burstLeft = this.skill.burst;
      }
      this.lastSeen = { x: seen.x, z: seen.z, t: now };
    } else if (this.enemy && (!this.lastSeen || now - this.lastSeen.t > 1.2)) {
      this.enemy = null;
    }

    // --- combat: aim at the enemy and fire in bursts ---
    // (No firing while the round has not started: world.allowCombat is
    // false during the buy phase, so bots walk to their spots in peace.)
    if (this.enemy && seen && world.allowCombat !== false) {
      const targetYaw = Math.atan2(-(seen.x - this.pos.x), -(seen.z - this.pos.z));
      const dy = seen.y - this.eyeY;
      const targetPitch = Math.atan2(dy, Math.hypot(seen.x - this.pos.x, seen.z - this.pos.z));
      const turnRate = 6.5;
      this.aimYaw = turnToward(this.aimYaw, targetYaw, turnRate * dt);
      this.aimPitch += clamp(targetPitch - this.aimPitch, -turnRate * dt, turnRate * dt);
      this.yaw = this.aimYaw;
      this.moving = false;

      // Contact while pushing: keep closing on the objective instead of
      // duelling from a fixed spot — a stalled attack never plants.
      // Moving fire is less accurate, so the advance costs aim.
      if ((this.state === 'push' || this.state === 'rotate')
        && this.pathIndex < this.path.length) {
        const node = NODES[this.path[this.pathIndex]];
        const nd = Math.hypot(node.x - this.pos.x, node.z - this.pos.z);
        if (nd < 0.6) {
          this.pathIndex++;
        } else {
          this.moveToward(node.x, node.z, dt, this.skill.speed * 0.55, now);
          this.moving = true;
        }
      }

      if (now >= this.reactUntil && now >= this.nextShotAt) {
        if (this.mag <= 0) {
          if (this.reserve > 0) {
            this.reloadUntil = now + this.weapon.reload;
            world.onReload && world.onReload(this);
          }
          this.nextShotAt = now + 0.3;
        } else if (this.burstLeft > 0) {
          this.burstLeft--;
          this.mag--;
          this.nextShotAt = now + shotInterval(this.weapon);
          // Aim error: grows with distance and while the target moves.
          const err = this.skill.aimError * (0.6 + seen.dist / 25);
          const spreadYaw = this.aimYaw + (this.random() - 0.5) * 2 * err;
          const spreadPitch = this.aimPitch + (this.random() - 0.5) * 2 * err;
          const dir = new THREE.Vector3(
            -Math.sin(spreadYaw) * Math.cos(spreadPitch),
            Math.sin(spreadPitch),
            -Math.cos(spreadYaw) * Math.cos(spreadPitch),
          );
          world.onShoot(this, eye, dir, seen.dist);
          if (this.burstLeft === 0) {
            this.burstLeft = this.skill.burst;
            this.nextShotAt = now + 0.35 + this.random() * 0.45;
          }
        }
      }
      this.syncMesh(dt, false);
      return null;
    }

    // --- tactics when nothing is visible ---
    this.moving = false;
    if (this.state === 'hold' && this.holdSpot) {
      // Take up the hold position first: a defender that just spawned
      // walks to its spot instead of guarding the spawn.
      const hd = Math.hypot(this.holdSpot.x - this.pos.x, this.holdSpot.z - this.pos.z);
      if (hd > 1.5) {
        this.state = 'takePosition';
        this.goToNode(nearestNode(NODES, this.holdSpot.x, this.holdSpot.z));
      }
    }
    // Attackers wait at spawn during the buy phase; only the walk to a
    // hold spot (takePosition) happens before the round starts.
    const mayAdvance = world.allowCombat !== false || this.state === 'takePosition';
    if (mayAdvance && (this.state === 'push' || this.state === 'rotate' || this.state === 'hunt' || this.state === 'takePosition')) {
      if (this.pathIndex < this.path.length) {
        const node = NODES[this.path[this.pathIndex]];
        const nd = Math.hypot(node.x - this.pos.x, node.z - this.pos.z);
        if (nd < 0.6) {
          this.pathIndex++;
        } else {
          const speed = this.skill.speed * (this.carrier ? 0.92 : 1);
          this.moveToward(node.x, node.z, dt, speed, now);
          this.moving = true;
          this.yaw = turnToward(this.yaw, Math.atan2(-(node.x - this.pos.x), -(node.z - this.pos.z)), 5 * dt);
          this.aimYaw = this.yaw;
        }
      } else if (this.state === 'push' && this.targetSite) {
        // Arrived at the site: carrier plants, the rest spread out.
        if (this.carrier && world.bomb.state === 'carried') {
          const plant = SITES[this.targetSite].plant;
          const pd = Math.hypot(plant.x - this.pos.x, plant.z - this.pos.z);
          if (pd < 1.2) {
            this.channel = { kind: 'plant', until: now + 4, site: this.targetSite };
            world.onPlantStart && world.onPlantStart(this);
          } else {
            this.moveToward(plant.x, plant.z, dt, this.skill.speed, now);
            this.moving = true;
          }
        } else {
          this.state = 'hold';
          this.holdSpot = {
            x: this.pos.x + (this.random() - 0.5) * 6,
            z: this.pos.z + (this.random() - 0.5) * 6,
            yaw: this.yaw,
          };
        }
      } else if (this.state === 'rotate' && world.bomb.state === 'planted') {
        // Reached the planted site: defuse if nobody else is.
        const bd = Math.hypot(world.bomb.x - this.pos.x, world.bomb.z - this.pos.z);
        if (bd < 1.4 && !world.bomb.defuser && !(world.playerDefusing && world.playerDefusing())) {
          this.channel = { kind: 'defuse', until: now + 5, site: world.bomb.site };
          world.onDefuseStart && world.onDefuseStart(this);
        } else if (bd >= 1.4) {
          this.moveToward(world.bomb.x, world.bomb.z, dt, this.skill.speed, now);
          this.moving = true;
        }
      } else if (this.state === 'hunt' && this.lastSeen) {
        const ld = Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
        if (ld > 1.5) {
          this.moveToward(this.lastSeen.x, this.lastSeen.z, dt, this.skill.speed, now);
          this.moving = true;
          this.yaw = turnToward(this.yaw, Math.atan2(-(this.lastSeen.x - this.pos.x), -(this.lastSeen.z - this.pos.z)), 5 * dt);
          this.aimYaw = this.yaw;
        } else {
          this.state = 'hold';
        }
      } else {
        this.state = 'hold';
      }
    } else if (this.state === 'hold' && this.holdSpot) {
      // Idle scan: slowly sweep the view across the lane.
      this.aimYaw = this.holdSpot.yaw + Math.sin(now * 0.35 + this.index) * 0.55;
      this.yaw = this.aimYaw;
    }

    this.syncMesh(dt, this.moving);
    return null;
  }

  syncMesh(dt, moving) {
    this.group.position.x = this.pos.x;
    this.group.position.z = this.pos.z;
    if (this.alive) {
      this.group.rotation.y = this.yaw;
      if (moving) {
        this.walkPhase += dt * 9;
        const swing = Math.sin(this.walkPhase) * 0.5;
        this.group.userData.legL.rotation.x = swing;
        this.group.userData.legR.rotation.x = -swing;
      } else {
        this.group.userData.legL.rotation.x *= 0.8;
        this.group.userData.legR.rotation.x *= 0.8;
      }
    }
  }
}

// Adjacency list built once from EDGES (undirected).
let _adj = null;
function adjacencyList() {
  if (_adj) return _adj;
  _adj = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    _adj[a].push(b);
    _adj[b].push(a);
  }
  return _adj;
}

// Build both teams. Vanguard bots take the hold spots; Specters get a
// site objective and one of them carries the spike.
export function createBots(scene, random) {
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const bot = new Bot(scene, 'vanguard', i, SPAWNS.vanguard[i + 1], random);
    bot.holdSpot = HOLD_SPOTS[i];
    bot.state = 'hold';
    bots.push(bot);
  }
  for (let i = 0; i < 5; i++) {
    const bot = new Bot(scene, 'specter', i, SPAWNS.specter[i], random);
    bots.push(bot);
  }
  return bots;
}
