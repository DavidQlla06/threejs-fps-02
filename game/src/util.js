// BREACHLINE — shared helpers. Pure functions, no DOM, no three.js, so the
// same file can run in the browser and in the Node smoke tests.
// (c) 2026 BREACHLINE contributors, MIT licence.

// Deterministic RNG (mulberry32). Used for bot behaviour and for the
// ?shot= captures so a given seed always stages the same scene.
export function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Smallest signed angle difference, in radians, wrapped to (-PI, PI].
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

// Turn `current` toward `target` by at most `maxStep` radians.
export function turnToward(current, target, maxStep) {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

// Breadth-first search over a waypoint graph. `edges` maps node index ->
// array of neighbour indices. Returns the list of node indices from start
// to goal (inclusive), or null when unreachable.
export function bfsPath(edges, start, goal) {
  if (start === goal) return [start];
  const prev = new Array(edges.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of edges[node] || []) {
      if (prev[next] === -1) {
        prev[next] = node;
        if (next === goal) {
          const path = [goal];
          let cur = goal;
          while (cur !== start) {
            cur = prev[cur];
            path.unshift(cur);
          }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return null;
}

// Nearest waypoint index to (x, z) among `nodes` ([{x, z}, ...]).
export function nearestNode(nodes, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const dx = nodes[i].x - x;
    const dz = nodes[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Format seconds as M:SS for the round timer.
export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Money as $1,500.
export function formatMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}
