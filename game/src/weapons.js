// BREACHLINE — weapons and ballistics. Pure data + math (no three.js,
// no DOM) so the Node smoke test can exercise the same damage model the
// browser game uses. All damage numbers are per-bullet at the stated
// ranges; headshots multiply by the weapon's headshot factor.

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', short: 'P9', price: 0, slot: 1,
    auto: false, rpm: 320, mag: 12, reserve: 48, reload: 1.1,
    damage: [34, 26, 19], ranges: [12, 30], // [close, mid, far] damage
    headshot: 3.0, spread: 0.011, moveSpread: 0.02, recoil: 0.35,
    armorPen: 0.5, tracer: 0xffe08a, kick: 0.006,
  },
  vk9: {
    id: 'vk9', name: 'VK-9 Ripper', short: 'VK-9', price: 1500, slot: 2,
    auto: true, rpm: 780, mag: 28, reserve: 112, reload: 1.9,
    damage: [27, 20, 14], ranges: [14, 32],
    headshot: 2.4, spread: 0.016, moveSpread: 0.03, recoil: 0.5,
    armorPen: 0.55, tracer: 0xffc46b, kick: 0.009,
  },
  ar77: {
    id: 'ar77', name: 'AR-77 Longshot', short: 'AR-77', price: 2700, slot: 3,
    auto: true, rpm: 620, mag: 30, reserve: 90, reload: 2.3,
    damage: [36, 30, 24], ranges: [18, 45],
    headshot: 3.2, spread: 0.009, moveSpread: 0.024, recoil: 0.8,
    armorPen: 0.7, tracer: 0xffd166, kick: 0.013,
  },
  lm88: {
    id: 'lm88', name: 'LM-88 Deadeye', short: 'LM-88', price: 4750, slot: 4,
    auto: false, rpm: 48, mag: 5, reserve: 15, reload: 3.1,
    damage: [105, 95, 85], ranges: [25, 60],
    headshot: 2.0, spread: 0.0015, moveSpread: 0.05, recoil: 2.6,
    armorPen: 0.9, tracer: 0x9adcff, kick: 0.05,
  },
};

export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.5; // half of the damage goes to armor first
export const KILL_REWARD = 300;
export const ROUND_WIN_REWARD = 3250;
export const ROUND_LOSS_REWARD = 1900;
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;
export const START_MONEY = 800;

// Damage at a distance, before armor / headshot.
export function baseDamage(weapon, distance) {
  const [close, mid, far] = weapon.damage;
  const [r1, r2] = weapon.ranges;
  if (distance <= r1) return close;
  if (distance >= r2) return far;
  const t = (distance - r1) / (r2 - r1);
  return close + (mid - close) * t;
}

// Split incoming damage between armor and health. Returns {hp, armor}
// damage amounts. The vest absorbs a share of the hit; high armor
// penetration leaves less for the vest to catch, so more reaches health.
export function applyArmor(damage, armor, armorPen) {
  if (armor <= 0) return { hp: damage, armor: 0 };
  const absorbShare = ARMOR_ABSORB * (1.15 - armorPen);
  const absorbed = Math.min(armor, damage * absorbShare);
  return { hp: damage - absorbed, armor: absorbed };
}

// Time between shots, seconds.
export function shotInterval(weapon) {
  return 60 / weapon.rpm;
}

// A fresh ammo state for a weapon id.
export function freshAmmo(weaponId) {
  const w = WEAPONS[weaponId];
  return { mag: w.mag, reserve: w.reserve };
}
