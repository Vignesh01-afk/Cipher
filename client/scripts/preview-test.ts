/**
 * TEMP: one browser run of the mockup-ui Preview (real Neon database).
 *
 * Covers exactly what was asked: register, create a note, use the lock button.
 * Also: confirms the new contact email is live, and screenshots the two pages
 * that were only code-checked (recovery-key fallback, Google callback).
 *
 * The raw recovery key is never printed - only screenshotted for eye review.
 * Run:  cd client && npx tsx scripts/preview-test.ts
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.PREVIEW_BASE_URL ?? 'https://ciphernote-git-mockup-ui-sync-squad2.vercel.app';
const PASSWORD = 'Preview-vault-9x!';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, '..', 'ui-shots');

const results: Array<[string, string]> = [];
const ok = (step: string, detail = ''): void => {
  results.push(['PASS', detail ? `${step}  (${detail})` : step]);
  console.log(`PASS  ${step}${detail ? `  (${detail})` : ''}`);
};
const fail = (step: string, detail = ''): void => {
  results.push(['FAIL', detail ? `${step}  (${detail})` : step]);
  console.log(`FAIL  ${step}${detail ? `  (${detail})` : ''}`);
};

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const shot = (name: string): string => path.join(SHOTS, `preview-${name}.png`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 220));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 220)}`));
  const apiCalls: string[] = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/')) apiCalls.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
  });

  const email = `preview-test-${Date.now()}@example.com`;

  // In-session navigation without a reload: the crypto keys live in memory,
  // so a full page load would re-lock the vault and gate the editor.
  const spa = async (to: string): Promise<void> => {
    await page.evaluate((target) => {
      window.history.pushState({}, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, to);
    await page.waitForTimeout(900);
  };

  // --- 1. register -------------------------------------------------------
  await page.goto(`${BASE}/register`, { waitUntil: 'load', timeout: 60_000 });
  await page.fill('#displayName', 'Preview Tester');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.fill('#confirmPassword', PASSWORD);
  await page.getByRole('checkbox').first().check();
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL('**/recovery-key', { timeout: 45_000 });
    ok('register -> recovery-key handoff', email);
  } catch {
    fail('register -> recovery-key handoff', `stuck at ${page.url()}`);
    await page.screenshot({ path: shot('register-stuck') });
  }

  // Eye-check shot only; never read the key text into logs.
  await page.screenshot({ path: shot('recovery-key-handoff') });

  // --- 2. continue to dashboard ------------------------------------------
  await page.click('text=I saved it').catch(() => undefined);
  await page.waitForURL((u) => /\/(unlock|dashboard)$/.test(new URL(u).pathname), { timeout: 30_000 })
    .catch(() => undefined);
  if (page.url().includes('/unlock')) {
    await page.fill('#password', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 45_000 }).catch(() => undefined);
  }
  if (page.url().includes('/dashboard')) ok('lands on dashboard after handoff', page.url());
  else fail('lands on dashboard after handoff', page.url());
  await page.screenshot({ path: shot('dashboard') });

  // --- 3. create a note through the real editor --------------------------
  await spa('/notes/new');
  await page.getByLabel('Title', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  const BODY = 'Created against the real Neon database from the mockup-ui Preview.';
  await page.getByLabel('Title', { exact: true }).fill('Preview note');
  await page.getByLabel('Content', { exact: true }).fill(BODY);
  await page.getByRole('button', { name: /Encrypt and save/ }).click();
  // The save does a slow client-side key wrap; wait for the REAL note-view
  // URL (the editor is at /notes/new, which must not match).
  await page
    .waitForURL(
      (u) => {
        const p = new URL(u).pathname;
        return /^\/notes\/[A-Za-z0-9_-]+$/.test(p) && p !== '/notes/new';
      },
      { timeout: 90_000 },
    )
    .catch(() => undefined);
  {
    const p = new URL(page.url()).pathname;
    if (/^\/notes\/[A-Za-z0-9_-]+$/.test(p) && p !== '/notes/new')
      ok('note saved -> note view', page.url());
    else fail('note saved -> note view', page.url());
  }

  // Round-trip proof: poll for the plaintext - key operations can be slow.
  const decryptStart = Date.now();
  const decrypted = await page
    .waitForFunction((t) => document.body.innerText.includes(t), BODY, { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  const elapsed = ((Date.now() - decryptStart) / 1000).toFixed(1);
  if (decrypted) ok('note decrypts in view (encrypt -> DB -> decrypt)', `${elapsed}s`);
  else {
    fail('note decrypts in view', `still spinning after ${elapsed}s`);
    console.log('  last API calls:');
    for (const c of apiCalls.slice(-12)) console.log(`    ${c}`);
    console.log('  body:', JSON.stringify((await page.locator('body').innerText()).slice(0, 300)));
  }
  await page.screenshot({ path: shot('note-view') });

  // --- 4. lock button ----------------------------------------------------
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await page.waitForURL('**/unlock', { timeout: 30_000 }).catch(() => undefined);
  if (page.url().includes('/unlock')) ok('lock button -> unlock screen', page.url());
  else fail('lock button -> unlock screen', page.url());
  await page.screenshot({ path: shot('after-lock') });

  // Locked means locked: dashboard must bounce back to /unlock.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(2500);
  if (page.url().includes('/unlock')) ok('locked vault redirects /dashboard -> /unlock');
  else fail('locked vault redirects /dashboard -> /unlock', page.url());

  // --- 5. the two code-checked-only pages, by eye (public routes: full loads) ----
  await page.goto(`${BASE}/recovery-key`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('recovery-key-fallback') });
  const rkText = await page.locator('body').innerText();
  ok('/recovery-key fallback renders', JSON.stringify(rkText.slice(0, 90)));

  await page.goto(`${BASE}/auth/google/callback`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shot('google-callback') });
  const gcText = await page.locator('body').innerText();
  ok('/auth/google/callback renders', JSON.stringify(gcText.slice(0, 90)));

  // --- 6. new contact email live on the deployed build? -------------------
  await page.goto(`${BASE}/terms`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(800);
  const terms = await page.locator('body').innerText();
  if (terms.includes('me@example.com')) {
    ok('terms page shows me@example.com on the Preview');
  } else {
    fail('terms page shows me@example.com on the Preview');
  }

  // --- console errors ------------------------------------------------------
  const seen = new Set<string>();
  const unique = consoleErrors.filter((e) => (seen.has(e) ? false : (seen.add(e), true)));
  console.log(`\nconsole errors: ${unique.length} unique`);
  for (const e of unique) console.log(`  - ${e}`);

  await browser.close();

  const failed = results.filter(([s]) => s === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
