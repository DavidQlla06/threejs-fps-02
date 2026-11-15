// BREACHLINE — focused diagnostic: how fast does the player die at spawn,
// and does W actually move the player? Samples state at 250 ms.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';

const ROOT = process.env.BREACHLINE_ROOT || '/home/hatch/workspace/makefun/threejs-fps-02';
const PORT = 8138;
const EXE = join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');

const server = spawn('node', ['serve.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 1000));
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 480 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.click('#play');
await page.waitForTimeout(500);
await page.keyboard.press('Enter'); // skip buy
await page.waitForTimeout(300);

async function snap(label) {
  const s = await page.evaluate(() => {
    const b = window.__breachline;
    return {
      t: Math.round(b.match.time * 10) / 10,
      phase: b.match.phase,
      hp: Math.round(b.player.hp),
      alive: b.player.alive,
      x: Math.round(b.player.pos.x * 10) / 10,
      z: Math.round(b.player.pos.z * 10) / 10,
      locked: !!document.pointerLockElement,
      bots: b.bots.map((x) => `${x.name.slice(0, 4)}:${x.alive ? 'a' : 'x'}@${Math.round(x.pos.x)},${Math.round(x.pos.z)}`).join(' '),
    };
  });
  console.log(label, JSON.stringify(s));
}

for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  await snap(`t+${(i + 1) * 250}ms`);
}
console.log('--- holding W for 2s ---');
const before = await page.evaluate(() => ({ x: window.__breachline.player.pos.x, z: window.__breachline.player.pos.z, hp: window.__breachline.player.hp }));
await page.keyboard.down('KeyW');
await page.waitForTimeout(2000);
await page.keyboard.up('KeyW');
const after = await page.evaluate(() => ({ x: window.__breachline.player.pos.x, z: window.__breachline.player.pos.z, hp: window.__breachline.player.hp, alive: window.__breachline.player.alive }));
console.log('before', JSON.stringify(before), 'after', JSON.stringify(after));
await browser.close();
server.kill();
