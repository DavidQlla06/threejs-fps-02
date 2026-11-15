// BREACHLINE — long round watch: small viewport (fast SwiftShader), skip
// the buy phase, then poll until the round resolves and log every
// transition (bomb state, alive counts, score). Run in background.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';

const ROOT = process.env.BREACHLINE_ROOT || '/home/hatch/workspace/makefun/threejs-fps-02';
const PORT = 8139;
const EXE = join(os.homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell');

const server = spawn('node', ['serve.mjs', '--port', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 1000));
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 240 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.click('#play');
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);

let lastKey = '';
const t0 = Date.now();
for (let i = 0; i < 400; i++) {
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => {
    const b = window.__breachline;
    return {
      t: Math.round(b.match.time),
      phase: b.match.phase,
      round: b.match.round,
      score: `${b.match.score.v}-${b.match.score.s}`,
      hp: Math.round(b.player.hp),
      alive: b.player.alive,
      v: b.bots.filter((x) => x.alive && x.team === 'vanguard').length,
      s: b.bots.filter((x) => x.alive && x.team === 'specter').length,
      bomb: b.bomb.state + (b.bomb.site ? '@' + b.bomb.site : '') + (b.bomb.state === 'planted' ? ` ${Math.round(b.bomb.timer)}s` : ''),
      reason: b.match.roundEndReason || '',
    };
  });
  const key = `${s.phase}|${s.bomb}|${s.v}v${s.s}s|${s.score}|${s.reason}`;
  if (key !== lastKey) {
    console.log(`wall ${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(s));
    lastKey = key;
  }
  // Keep going past the first round end until round 2 is live: this
  // proves the buy -> live -> roundEnd -> buy loop, not just round 1.
  if (s.round === 2 && s.phase === 'live') {
    console.log('ROUND 2 LIVE — full loop verified');
    break;
  }
  if (s.phase === 'matchEnd') break;
  // Nudge the player to stay alive: crouch in spawn, look around.
  if (i % 20 === 10) await page.mouse.move(320 + (i % 5) * 20, 120);
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
server.kill();
