// BREACHLINE — "Foundry" map: layout, collision and line of sight.
// Pure data + math (no three.js import) so the same module runs in the
// browser game and in the Node tools that stage screenshots and smoke tests.
//
// The yard is 64 m (x) by 48 m (z). North is -z. Two spike sites sit in the
// north half: A "Refinery" west, B "Depot" east. Vanguard (the player's
// team) spawns south and defends; Specters spawn north and attack.
// Three lanes link the halves: the west A-lane, the east B-lane, and mid
// through the double doors. Crates are low (1.1-1.4 m): they block feet
// but not a standing sightline, so they are cover, not walls.

export const MAP = {
  name: 'Foundry',
  bounds: { x0: -32, z0: -24, x1: 32, z1: 24 },
  wallHeight: 3.4,
  roundTime: 100,
  buyTime: 12,
  bombTime: 35,
  plantTime: 4,
  defuseTime: 5,
};

// Axis-aligned boxes. kind 'wall' is full height, 'crate' is low cover,
// 'tank' is a tall cylinder-ish block treated as a box for collision.
export const SOLIDS = [
  // --- perimeter (thick, so nothing leaves the yard) ---
  { x0: -33, z0: -25, x1: 33, z1: -24, h: 3.4, kind: 'wall' }, // north
  { x0: -33, z0: 24, x1: 33, z1: 25, h: 3.4, kind: 'wall' }, // south
  { x0: -33, z0: -24, x1: -32, z1: 24, h: 3.4, kind: 'wall' }, // west
  { x0: 32, z0: -24, x1: 33, z1: 24, h: 3.4, kind: 'wall' }, // east
  // --- lane dividers: west wall splits A-lane from mid, gap at z 3..6 ---
  { x0: -14, z0: -8, x1: -13, z1: 3, h: 3.4, kind: 'wall' },
  { x0: -14, z0: 6, x1: -13, z1: 8, h: 3.4, kind: 'wall' },
  // --- east divider, mirrored ---
  { x0: 13, z0: -8, x1: 14, z1: 3, h: 3.4, kind: 'wall' },
  { x0: 13, z0: 6, x1: 14, z1: 8, h: 3.4, kind: 'wall' },
  // --- mid north wall with the double doors (gap x -2..2) ---
  { x0: -6, z0: -9, x1: -2, z1: -8, h: 3.4, kind: 'wall' },
  { x0: 2, z0: -9, x1: 6, z1: -8, h: 3.4, kind: 'wall' },
  // --- north-yard spine between the sites (gap z -12..-9) ---
  { x0: -1, z0: -20, x1: 1, z1: -12, h: 3.4, kind: 'wall' },
  // --- site A south wall, entry gap x -21..-15 ---
  { x0: -26, z0: -10, x1: -21, z1: -9, h: 3.4, kind: 'wall' },
  { x0: -15, z0: -10, x1: -14, z1: -9, h: 3.4, kind: 'wall' },
  // --- site B south wall, entry gap x 15..21 ---
  { x0: 14, z0: -10, x1: 15, z1: -9, h: 3.4, kind: 'wall' },
  { x0: 21, z0: -10, x1: 26, z1: -9, h: 3.4, kind: 'wall' },
  // --- site A back alcove pillar ---
  { x0: -27, z0: -20, x1: -25, z1: -18, h: 3.4, kind: 'wall' },
  // --- site B back alcove pillar ---
  { x0: 25, z0: -20, x1: 27, z1: -18, h: 3.4, kind: 'wall' },
  // --- mid south block: two generator housings flanking the spawn exit
  // (kept off the x=0 lane so the spawn -> plaza waypoint stays open) ---
  { x0: -12, z0: 16, x1: -8, z1: 19, h: 3.4, kind: 'wall' },
  { x0: 8, z0: 16, x1: 12, z1: 19, h: 3.4, kind: 'wall' },

  // --- crates: low cover, shoot over them ---
  { x0: -24, z0: -18, x1: -22, z1: -16, h: 1.2, kind: 'crate' },
  { x0: -16, z0: -19, x1: -14, z1: -17, h: 1.2, kind: 'crate' },
  { x0: -22, z0: -12.5, x1: -20, z1: -10.5, h: 1.4, kind: 'crate' },
  { x0: 22, z0: -18, x1: 24, z1: -16, h: 1.2, kind: 'crate' },
  { x0: 14, z0: -19, x1: 16, z1: -17, h: 1.2, kind: 'crate' },
  { x0: 20, z0: -12.5, x1: 22, z1: -10.5, h: 1.4, kind: 'crate' },
  { x0: -4, z0: 2, x1: -2, z1: 4, h: 1.2, kind: 'crate' },
  { x0: 2, z0: -4, x1: 4, z1: -2, h: 1.2, kind: 'crate' },
  { x0: -8, z0: -2, x1: -6, z1: 0, h: 1.1, kind: 'crate' },
  { x0: 8, z0: 0, x1: 10, z1: 2, h: 1.1, kind: 'crate' },
  { x0: -28, z0: 4, x1: -26, z1: 6, h: 1.3, kind: 'crate' },
  { x0: 26, z0: 4, x1: 28, z1: 6, h: 1.3, kind: 'crate' },
  { x0: -24, z0: -4, x1: -22, z1: -2, h: 1.3, kind: 'crate' },
  { x0: 22, z0: -4, x1: 24, z1: -2, h: 1.3, kind: 'crate' },
  { x0: -5, z0: -17, x1: -3, z1: -15, h: 1.2, kind: 'crate' },
  { x0: 3, z0: -17, x1: 5, z1: -15, h: 1.2, kind: 'crate' },
  // --- mid silos: break the spawn-to-spawn sightline so neither team
  // can trade fire across the whole map from their spawn ---
  { x0: 4.5, z0: 1.5, x1: 7, z1: 4.5, h: 3.4, kind: 'tank' },
  { x0: -7, z0: 1.5, x1: -4.5, z1: 4.5, h: 3.4, kind: 'tank' },
  // --- storage tanks in the north yard (tall, round-ish blocks) ---
  { x0: -8, z0: -22, x1: -5, z1: -19, h: 3.4, kind: 'tank' },
  { x0: 5, z0: -22, x1: 8, z1: -19, h: 3.4, kind: 'tank' },
  // --- barrels: low round cover ---
  { x0: -11, z0: 8, x1: -10, z1: 9, h: 1.1, kind: 'barrel' },
  { x0: 10, z0: -6, x1: 11, z1: -5, h: 1.1, kind: 'barrel' },
];

export const SITES = {
  A: { name: 'Refinery', x0: -26, z0: -20, x1: -14, z1: -10, plant: { x: -20, z: -15 } },
  B: { name: 'Depot', x0: 14, z0: -20, x1: 26, z1: -10, plant: { x: 20, z: -15 } },
};

export const SPAWNS = {
  // Yaw 0 faces north (-z), yaw PI faces south (+z). Vanguard defends
  // from the south and looks north up the map; Specters attack from
  // the north and look south.
  vanguard: [
    { x: 0, z: 20, yaw: 0 },
    { x: -3, z: 21, yaw: 0 },
    { x: 3, z: 21, yaw: 0 },
    { x: -6, z: 19, yaw: 0 },
    { x: 6, z: 19, yaw: 0 },
  ],
  specter: [
    { x: 0, z: -21.5, yaw: Math.PI },
    { x: -4, z: -22, yaw: Math.PI },
    { x: 4, z: -22, yaw: Math.PI },
    { x: -8, z: -20, yaw: Math.PI },
    { x: 8, z: -20, yaw: Math.PI },
  ],
};

// Defender hold positions, one per bot (index matches bot slot).
// Site holders watch the south entries; lane holders watch north.
export const HOLD_SPOTS = [
  { x: -19, z: -15, yaw: Math.PI }, // site A
  { x: 19, z: -15, yaw: Math.PI }, // site B
  { x: 0, z: -2, yaw: 0 }, // mid
  { x: -25, z: 0, yaw: 0 }, // A lane
  { x: 25, z: 0, yaw: 0 }, // B lane
];

// Waypoint graph bots walk. Edges are bidirectional.
export const NODES = [
  { x: 0, z: 20 }, // 0 vanguard spawn
  { x: 0, z: 14 }, // 1 south plaza
  { x: -25, z: 12 }, // 2 A lane low
  { x: 25, z: 12 }, // 3 B lane low
  { x: -25, z: 0 }, // 4 A lane mid
  { x: 25, z: 0 }, // 5 B lane mid
  { x: -25, z: -6 }, // 6 A lane high
  { x: 25, z: -6 }, // 7 B lane high
  { x: 0, z: 6 }, // 8 mid low
  { x: 0, z: -2 }, // 9 mid
  { x: 0, z: -8.5 }, // 10 mid doors
  { x: 0, z: -10.5 }, // 11 north yard (south of the spine wall)
  { x: -19, z: -15 }, // 12 site A
  { x: 19, z: -15 }, // 13 site B
  { x: -19, z: -8 }, // 14 A entry
  { x: 19, z: -8 }, // 15 B entry
  { x: -10, z: -14 }, // 16 north yard west
  { x: 10, z: -14 }, // 17 north yard east
  { x: -16, z: 4.5 }, // 18 west connector
  { x: 16, z: 4.5 }, // 19 east connector
  { x: 0, z: -21.5 }, // 20 specter spawn
];

export const EDGES = [
  [0, 1], [1, 2], [1, 3], [1, 8],
  [2, 4], [3, 5], [4, 6], [5, 7],
  [6, 14], [7, 15], [14, 12], [15, 13],
  [8, 9], [9, 10], [10, 11], [11, 16], [11, 17],
  [16, 12], [17, 13], [4, 18], [18, 8], [5, 19], [19, 8],
  [6, 16], [7, 17], [14, 16], [15, 17],
  [20, 16], [20, 17], [10, 16], [10, 17],
];

// ---------------------------------------------------------------------------
// Collision: circle (x, z, radius) against the solid boxes, axis separated.
// `pos` is mutated in place. Returns true when a wall stopped the move.
// Solids only block when the mover's feet are below their top (a crouched
// player still cannot walk through a crate, but bullets fly over them).
// ---------------------------------------------------------------------------
function overlapsSolid(x, z, radius, feetY, headY) {
  for (const s of SOLIDS) {
    if (feetY >= s.h) continue; // mover is above this solid
    if (headY <= 0) continue;
    const cx = Math.max(s.x0, Math.min(x, s.x1));
    const cz = Math.max(s.z0, Math.min(z, s.z1));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) return s;
  }
  return null;
}

export function moveCircle(pos, radius, dx, dz, feetY = 0, height = 1.7) {
  const headY = feetY + height;
  let hit = false;
  const nx = pos.x + dx;
  if (!overlapsSolid(nx, pos.z, radius, feetY, headY)) {
    pos.x = nx;
  } else {
    hit = true;
  }
  const nz = pos.z + dz;
  if (!overlapsSolid(pos.x, nz, radius, feetY, headY)) {
    pos.z = nz;
  } else {
    hit = true;
  }
  // Clamp inside the yard as a backstop.
  pos.x = Math.max(MAP.bounds.x0 + radius, Math.min(MAP.bounds.x1 - radius, pos.x));
  pos.z = Math.max(MAP.bounds.z0 + radius, Math.min(MAP.bounds.z1 - radius, pos.z));
  return hit;
}

// ---------------------------------------------------------------------------
// Rays: 3D ray vs the solid boxes (slab test). Returns the distance to the
// nearest solid, or Infinity. Used for bullets and for bot sight checks.
// ---------------------------------------------------------------------------
export function rayHitSolids(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const s of SOLIDS) {
    let t0 = 0;
    let t1 = best;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < s.x0 || ox > s.x1) continue;
    } else {
      let ta = (s.x0 - ox) / dx;
      let tb = (s.x1 - ox) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (oz < s.z0 || oz > s.z1) continue;
    } else {
      let ta = (s.z0 - oz) / dz;
      let tb = (s.z1 - oz) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // Y slab (box spans 0..h)
    if (Math.abs(dy) < 1e-9) {
      if (oy < 0 || oy > s.h) continue;
    } else {
      let ta = (0 - oy) / dy;
      let tb = (s.h - oy) / dy;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (t0 < best && t0 >= 0) best = t0;
  }
  return best;
}

// True when the segment between two eye-level points is blocked by a wall.
// Crates (low) do not block a standing sightline.
export function sightBlocked(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return false;
  const hit = rayHitSolids(ax, ay, az, dx / len, dy / len, dz / len, len);
  return hit < len - 0.05;
}

export function siteAt(x, z) {
  for (const key of Object.keys(SITES)) {
    const s = SITES[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Visuals: build the three.js meshes for the yard. Takes THREE as a
// parameter so this module stays import-free of three.js itself.
// ---------------------------------------------------------------------------
export function buildMapMeshes(THREE, scene) {
  const meshes = [];
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.95 });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0x6a6d70, roughness: 0.95 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xb3541e, roughness: 0.8 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a6a4f, roughness: 0.9 });
  const crateMat2 = new THREE.MeshStandardMaterial({ color: 0x4f5d6b, roughness: 0.9 });
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a3, roughness: 0.6, metalness: 0.35 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0xb3541e, roughness: 0.7, metalness: 0.25 });

  // Ground: dark asphalt with a painted grid, drawn once on a canvas.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, 0, 512, 384);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 512; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 384); ctx.stroke(); }
  for (let y = 0; y <= 384; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
  // Hazard stripes along the site borders.
  ctx.fillStyle = '#c9a227';
  for (const site of Object.values(SITES)) {
    const px = ((site.x0 + 32) / 64) * 512;
    const pz = ((site.z0 + 24) / 48) * 384;
    const pw = ((site.x1 - site.x0) / 64) * 512;
    ctx.fillRect(px, pz, pw, 4);
    ctx.fillRect(px, pz + ((site.z1 - site.z0) / 48) * 384 - 4, pw, 4);
  }
  const groundTex = new THREE.CanvasTexture(canvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(66, 50),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  meshes.push(ground);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const s of SOLIDS) {
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    if (s.kind === 'barrel') {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, s.h, 14), barrelMat);
      barrel.position.set((s.x0 + s.x1) / 2, s.h / 2, (s.z0 + s.z1) / 2);
      barrel.castShadow = true;
      barrel.receiveShadow = true;
      scene.add(barrel);
      meshes.push(barrel);
      continue;
    }
    let mat = concrete;
    if (s.kind === 'crate') mat = (Math.abs(s.x0) % 7 < 3.5) ? crateMat : crateMat2;
    if (s.kind === 'tank') mat = tankMat;
    if (s.kind === 'wall' && (s.x1 - s.x0 > 20 || s.z1 - s.z0 > 20)) mat = darkConcrete;
    const mesh = new THREE.Mesh(boxGeo, mat);
    mesh.scale.set(w, s.h, d);
    mesh.position.set((s.x0 + s.x1) / 2, s.h / 2, (s.z0 + s.z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
    // A thin hazard trim on top of full walls so lanes read at a glance.
    if (s.kind === 'wall' && w >= 1 && d >= 1 && s.h > 3) {
      const trim = new THREE.Mesh(boxGeo, accent);
      trim.scale.set(w, 0.12, d);
      trim.position.set((s.x0 + s.x1) / 2, s.h + 0.06, (s.z0 + s.z1) / 2);
      scene.add(trim);
      meshes.push(trim);
    }
  }

  // Site markers: floating letters A / B made from a canvas sprite.
  for (const [key, site] of Object.entries(SITES)) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(20,22,26,0.85)';
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#f0a830';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#f0a830';
    g.font = 'bold 72px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(key, 64, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set(3.2, 3.2, 1);
    sprite.position.set((site.x0 + site.x1) / 2, 5.2, (site.z0 + site.z1) / 2);
    scene.add(sprite);
    meshes.push(sprite);
  }

  // Floodlight poles at the four corners of mid.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.7, metalness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffdf8a, emissiveIntensity: 1.4 });
  for (const [px, pz] of [[-10, 10], [10, 10], [-10, -6], [10, -6]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8), poleMat);
    pole.position.set(px, 2.7, pz);
    pole.castShadow = true;
    scene.add(pole);
    meshes.push(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.5), lampMat);
    lamp.position.set(px, 5.5, pz);
    scene.add(lamp);
    meshes.push(lamp);
  }
  return meshes;
}
