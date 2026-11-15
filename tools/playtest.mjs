// BREACHLINE — headless browser playtest (Playwright + Chromium headless
// shell with SwiftShader WebGL). Serves game/, captures the three
// ?shot= screenshots into screenshots/, then plays a real round through
// the UI and reports console errors, phase transitions and the outcome.
// Usage: node tools/playtest.mjs [--shots-only] [--round-only]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

const ROOT = process.env.BREACHLINE_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_ONLY = process.argv.includes('--shots-only');
const ROUND_ONLY = process.argv.includes('--round-only');
const PORT = 8137;
const EXE = join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');

const server = spawn('node', ['serve.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 1200));

const report = { errors: [], shots: {}, round: {} };
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 480 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message));

async function state() {
  return page.evaluate(() => {
    const b = window.__breachline;
    if (!b) return null;
    return {
      phase: b.match.phase, round: b.match.round,
      score: { ...b.match.score }, roundTime: Math.round(b.match.roundTime * 10) / 10,
      player: { hp: Math.round(b.player.hp), alive: b.player.alive, mag: b.player.mag, money: b.player.money, weapon: b.player.weaponId, x: Math.round(b.player.pos.x * 10) / 10, z: Math.round(b.player.pos.z * 10) / 10 },
      bomb: { state: b.bomb.state, site: b.bomb.site, timer: Math.round(b.bomb.timer * 10) / 10 },
      botsAlive: b.bots.filter((x) => x.alive).length,
      vAlive: b.bots.filter((x) => x.alive && x.team === 'vanguard').length,
      sAlive: b.bots.filter((x) => x.alive && x.team === 'specter').length,
    };
  });
}

if (!ROUND_ONLY) {
  for (const shot of ['start', 'play', 'end']) {
    await page.goto(`http://localhost:${PORT}/?shot=${shot}&seed=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 20000 });
    await page.waitForTimeout(300);
    const file = join(ROOT, 'screenshots', `${shot === 'start' ? '1-start' : shot === 'play' ? '2-play' : '3-end'}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 78 });
    const webgl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    });
    report.shots[shot] = { file, webgl2: webgl };
    console.log(`shot ${shot}: saved, webgl2=${webgl}`);
  }
}

if (!SHOTS_ONLY) {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  console.log('menu state:', JSON.stringify(await state()));
  await page.click('#play');
  await page.waitForTimeout(1000);
  const lock = await page.evaluate(() => !!document.pointerLockElement);
  console.log('pointer locked after deploy click:', lock);
  console.log('buy phase:', JSON.stringify(await state()));
  // Buy a rifle + armor, then deploy.
  await page.keyboard.press('Digit3');
  await page.keyboard.press('Digit5');
  await page.waitForTimeout(200);
  console.log('after buy:', JSON.stringify(await state()));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  console.log('live:', JSON.stringify(await state()));
  // Walk forward and look around, fire a few bursts.
  await page.keyboard.down('KeyW');
  await page.mouse.move(640, 240);
  await page.mouse.move(700, 240, { steps: 5 });
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  console.log('after firing:', JSON.stringify(await state()));
  // Let the round play out (bots fight on their own). Poll for the end.
  const seenBomb = new Set();
  let outcome = null;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(1000);
    const s = await state();
    if (s) {
      seenBomb.add(s.bomb.state + (s.bomb.site ? '@' + s.bomb.site : ''));
      if (s.phase === 'roundEnd' || s.phase === 'matchEnd') { outcome = s; break; }
      // Keep the player alive-ish: wiggle and shoot occasionally.
      if (i % 10 === 5 && s.player.alive) {
        await page.mouse.move(640 + (i % 3) * 40, 240);
        await page.mouse.down();
        await page.waitForTimeout(400);
        await page.mouse.up();
      }
    }
  }
  report.round = { outcome, bombStates: [...seenBomb] };
  console.log('round outcome:', JSON.stringify(outcome));
  console.log('bomb states seen:', [...seenBomb].join(', '));
}

console.log('errors:', report.errors.length ? report.errors : 'none');
writeFileSync('/tmp/breachline-playtest.json', JSON.stringify(report, null, 2));
await browser.close();
server.kill();
process.exit(report.errors.length ? 1 : 0);
