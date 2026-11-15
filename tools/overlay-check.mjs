// BREACHLINE — overlay fix check: click deploy, confirm the menu overlay
// hides and the live game is visible; screenshot the result.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';

const ROOT = process.env.BREACHLINE_ROOT || '/home/hatch/workspace/makefun/threejs-fps-02';
const PORT = 8141;
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
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(600);
const overlayBefore = await page.evaluate(() => !document.getElementById('overlay').hidden);
await page.click('#play');
await page.waitForTimeout(1000);
const overlayAfter = await page.evaluate(() => !document.getElementById('overlay').hidden);
const phase = await page.evaluate(() => window.__breachline.match.phase);
console.log('overlay visible before click:', overlayBefore, '| after click:', overlayAfter, '| phase:', phase);
// Hold TAB for the scoreboard over the live game.
await page.keyboard.down('Tab');
await page.waitForTimeout(400);
const sb = await page.evaluate(() => !document.getElementById('scoreboard').hidden);
await page.screenshot({ path: '/tmp/overlay-fix.jpg', type: 'jpeg', quality: 78 });
await page.keyboard.up('Tab');
console.log('scoreboard over live game:', sb);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
server.kill();
