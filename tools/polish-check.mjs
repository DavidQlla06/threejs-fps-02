// BREACHLINE — polish check: retake the three ?shot= screenshots, then
// open the live game, deploy, hold TAB and capture the scoreboard.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';

const ROOT = process.env.BREACHLINE_ROOT || '/home/hatch/workspace/makefun/threejs-fps-02';
const PORT = 8140;
const EXE = join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');

const server = spawn('node', ['serve.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 1000));
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 480 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

for (const shot of ['start', 'play', 'end']) {
  await page.goto(`http://localhost:${PORT}/?shot=${shot}&seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 20000 });
  await page.waitForTimeout(200);
  const name = shot === 'start' ? '1-start' : shot === 'play' ? '2-play' : '3-end';
  await page.screenshot({ path: join(ROOT, 'screenshots', `${name}.jpg`), type: 'jpeg', quality: 78 });
  console.log(`shot ${shot} saved`);
}

// Live game: deploy, buy phase, hold TAB for the scoreboard.
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.click('#play');
await page.waitForTimeout(800);
await page.keyboard.down('Tab');
await page.waitForTimeout(400);
const sbVisible = await page.evaluate(() => !document.getElementById('scoreboard').hidden);
const rows = await page.evaluate(() => document.getElementById('sb-rows').children.length);
await page.screenshot({ path: join(ROOT, 'screenshots', '4-scoreboard.jpg'), type: 'jpeg', quality: 78 });
await page.keyboard.up('Tab');
console.log('scoreboard visible:', sbVisible, 'rows:', rows);
// Fire the pistol once and confirm the magazine drops.
const before = await page.evaluate(() => window.__breachline.player.mag);
await page.keyboard.press('Enter'); // deploy now (skip buy)
await page.waitForTimeout(400);
await page.mouse.down();
await page.waitForTimeout(300);
await page.mouse.up();
const after = await page.evaluate(() => ({ mag: window.__breachline.player.mag, phase: window.__breachline.match.phase }));
console.log('mag before/after firing:', before, '->', JSON.stringify(after));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
server.kill();
