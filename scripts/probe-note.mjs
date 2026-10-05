// Probe: create a note via the UI and dump state at each step.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const spaNav = (page, path) =>
  page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);

const browser = await chromium.launch();
const p = await browser.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 160)); });

// Register via UI
await p.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
const email = `note-probe-${Date.now()}@example.com`;
await p.fill('#displayName', 'Note Probe');
await p.fill('#email', email);
await p.fill('#password', 'probe-pass-123');
await p.fill('#confirmPassword', 'probe-pass-123');
await p.click('button[type="submit"]');
await p.waitForURL('**/recovery-key', { timeout: 30000 });
await p.click('text=I saved it - continue');
await p.waitForURL((u) => /\/(unlock|dashboard)$/.test(new URL(u).pathname), { timeout: 20000 });
if (p.url().includes('/unlock')) {
  await p.fill('#password', 'probe-pass-123');
  await p.click('button[type="submit"]');
  await p.waitForURL('**/dashboard', { timeout: 30000 });
}

await spaNav(p, '/notes/new');
await p.waitForSelector('#title', { timeout: 15000 });
await p.fill('#title', 'Probe Title XYZ');
await p.fill('#content', 'Probe content ABC');

const before = await p.evaluate(() => ({
  titleValue: document.querySelector('#title')?.value,
  contentValue: document.querySelector('#content')?.value,
}));
console.log('BEFORE SUBMIT:', JSON.stringify(before));

await p.click('button[type="submit"]');
await p.waitForTimeout(4000);
const errState = await p.evaluate(() => ({
  url: location.pathname,
  bodyText: document.body.innerText.slice(0, 500),
}));
console.log('AFTER SUBMIT +4s:', JSON.stringify(errState, null, 1));
await p.waitForTimeout(1500);

const after = await p.evaluate(() => ({
  url: location.pathname,
  h1: document.querySelector('h1')?.textContent,
  bodyHasTitle: document.body.innerText.includes('Probe Title XYZ'),
  bodyHasContent: document.body.innerText.includes('Probe content ABC'),
}));
console.log('AFTER SAVE:', JSON.stringify(after, null, 1));

// Notes list card
await spaNav(p, '/notes');
await p.waitForTimeout(2000);
const listState = await p.evaluate(() => ({
  bodyHasTitle: document.body.innerText.includes('Probe Title XYZ'),
  cardSample: [...document.querySelectorAll('h3, h2')].map((e) => e.textContent).slice(0, 5),
}));
console.log('NOTES LIST:', JSON.stringify(listState, null, 1));

await browser.close();
