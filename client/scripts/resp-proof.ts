/**
 * Responsive proof harness (stand-in API, no real server needed).
 *
 * Boots the real app on the Vite dev server, fakes every /api call in
 * Playwright, unlocks the vault through the real UI (local WebCrypto), then
 * for viewports 1440x900 and 390x844 prints the number of VISIBLE elements
 * (boundingBox non-null AND getComputedStyle display != none) for:
 *   - settings tab navs        (expect exactly 1)
 *   - hamburger button         (expect 0 at 1440, 1 at 390)
 *   - standalone search icon   (expect 0 at 1440, 1 at 390)
 *   - search input box         (expect 1 at 1440, 0 at 390)
 *   - lock button              (expect 1 at both)
 * plus the user menu's right-edge gap at 1440 (expect <= 24px), the sidebar
 * X close button at lg (expect 0 at 1440), and URL/status before/after
 * clicking the lock button.
 *
 * Run:  cd client && npx tsx scripts/resp-proof.ts     (Vite dev server on 5173)
 * Exit code 1 if any expected count is missed.
 */
import { chromium, type Locator } from '@playwright/test';
import { createUserKeyMaterial } from '../src/lib/crypto';

const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:5173';
const PASSWORD = 'Proof-vault-password-9';

interface Row {
  vp: string;
  label: string;
  expected: number;
  actual: number;
}

const rows: Row[] = [];
const notes: string[] = [];

function check(vp: string, label: string, expected: number, actual: number): void {
  rows.push({ vp, label, expected, actual });
  const ok = expected === actual;
  if (!ok) notes.push(`MISS ${vp} ${label}: expected ${expected}, got ${actual}`);
}

/** VISIBLE = boundingBox non-null AND computed display != none (as specified). */
async function countVisible(loc: Locator): Promise<number> {
  const total = await loc.count();
  let visible = 0;
  for (let i = 0; i < total; i += 1) {
    const el = loc.nth(i);
    const box = await el.boundingBox();
    if (!box) continue;
    const display = await el.evaluate((node) => getComputedStyle(node).display);
    if (display !== 'none') visible += 1;
  }
  return visible;
}

async function main(): Promise<void> {
  // Real key material so the app's genuine unlock (local WebCrypto) succeeds
  // against the stand-in /auth/me response. Crypto code is used, never edited.
  const { material } = await createUserKeyMaterial(PASSWORD);
  const standInUser = {
    id: 'proof-user-0001',
    email: 'proof@example.test',
    displayName: 'Proof User',
    createdAt: new Date().toISOString(),
    cipherId: 'CN-PROOF01',
    username: null,
    ...material,
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ciphernote.session.token', 'proof-session-token');
    } catch {
      /* storage unavailable */
    }
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160));
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 160)}`));

  // --- stand-in API ---------------------------------------------------------
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    let payload: unknown;
    if (url.pathname.endsWith('/auth/me')) {
      payload = { user: standInUser };
    } else if (method === 'GET') {
      if (/\/notes$/.test(url.pathname)) payload = { notes: [], nextCursor: null };
      else if (url.pathname.includes('/shared')) payload = { shares: [], nextCursor: null };
      else if (url.pathname.includes('/conversations')) payload = { conversations: [] };
      else if (url.pathname.includes('/audit')) payload = [];
      else payload = {};
    } else {
      payload = {};
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  // --- unlock through the real UI ------------------------------------------
  await page.goto(`${BASE}/unlock`, { waitUntil: 'load', timeout: 45_000 });
  const pwField = page.getByLabel('Password', { exact: true });
  await pwField.waitFor({ state: 'visible', timeout: 30_000 });
  await pwField.fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  // SPA navigation (no reload: a reload would drop the in-memory keys).
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, '/settings');
  await page.getByRole('button', { name: 'Account', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);

  const tabNavs = page.locator('nav').filter({
    has: page.getByRole('button', { name: 'Account', exact: true }),
  });
  const hamburger = page.locator('button[aria-label="Open navigation"]');
  const searchIcon = page.locator('button[aria-label="Search notes"]');
  const searchBox = page.locator('header.topbar input[type="search"]');
  const lockBtn = page.locator('button[aria-label="Lock vault"]');
  const sidebarX = page.locator('aside button[aria-label="Close navigation"]');
  const profileMenu = page.locator('header.topbar button[aria-haspopup="menu"]');

  for (const vp of [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '390x844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(400);

    const cTabs = await countVisible(tabNavs);
    const cBurger = await countVisible(hamburger);
    const cIcon = await countVisible(searchIcon);
    const cBox = await countVisible(searchBox);
    const cLock = await countVisible(lockBtn);
    const cX = await countVisible(sidebarX);

    check(vp.name, 'settings tab navs', 1, cTabs);
    check(vp.name, 'hamburger button', vp.name === '1440x900' ? 0 : 1, cBurger);
    check(vp.name, 'standalone search icon button', vp.name === '1440x900' ? 0 : 1, cIcon);
    check(vp.name, 'search input box', vp.name === '1440x900' ? 1 : 0, cBox);
    check(vp.name, 'lock button', 1, cLock);
    if (vp.name === '1440x900') check(vp.name, 'sidebar X close button (lg)', 0, cX);

    console.log(`\n[${vp.name}] on ${page.url()}`);
    console.log(`  settings tab navs               = ${cTabs}   (expect 1)`);
    console.log(`  hamburger button                = ${cBurger}   (expect ${vp.name === '1440x900' ? 0 : 1})`);
    console.log(`  standalone search icon button   = ${cIcon}   (expect ${vp.name === '1440x900' ? 0 : 1})`);
    console.log(`  search input box                = ${cBox}   (expect ${vp.name === '1440x900' ? 1 : 0})`);
    console.log(`  lock button                     = ${cLock}   (expect 1)`);
    console.log(`  sidebar X close button          = ${cX}   (expect ${vp.name === '1440x900' ? 0 : '1 (below lg, drawer)'} )`);

    if (vp.name === '1440x900') {
      const box = await profileMenu.boundingBox();
      if (box) {
        const gap = 1440 - (box.x + box.width);
        console.log(
          `  user menu right edge: x=${box.x.toFixed(1)} width=${box.width.toFixed(1)} right=${(box.x + box.width).toFixed(1)} viewport=1440 gap=${gap.toFixed(1)}px (expect <= 24)`,
        );
        notes.push(...(gap <= 24 ? [] : [`MISS 1440x900 user menu right gap ${gap.toFixed(1)}px > 24px`]));
      } else {
        notes.push('MISS 1440x900 profile menu not visible');
      }
    }
  }

  // --- lock button click: URL/status before and after ----------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const urlBefore = page.url();
  const lockBefore = (await countVisible(lockBtn)) === 1 ? 'present (vault unlocked)' : 'missing';
  await lockBtn.click();
  const unlockedScreen = page.getByLabel('Password', { exact: true });
  let lockAfter = 'unknown';
  try {
    await unlockedScreen.waitFor({ state: 'visible', timeout: 8000 });
    lockAfter = 'unlock screen shown (vault locked)';
  } catch {
    lockAfter = 'unlock screen NOT shown';
    notes.push('MISS lock click did not reach the unlock screen');
  }
  const urlAfter = page.url();
  console.log(`\n[lock click] before: url=${urlBefore} status=${lockBefore}`);
  console.log(`[lock click] after : url=${urlAfter} status=${lockAfter}`);

  if (consoleErrors.length > 0) {
    console.log(`\nconsole errors (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 10)) console.log(`  - ${e}`);
  }

  await context.close();
  await browser.close();

  console.log('\n===== EXPECTED vs ACTUAL =====');
  for (const r of rows) {
    const ok = r.expected === r.actual ? 'OK  ' : 'FAIL';
    console.log(`${ok} ${r.vp.padEnd(9)} ${r.label.padEnd(32)} expected=${r.expected} actual=${r.actual}`);
  }
  if (notes.length > 0) {
    console.log('\nProblems:');
    for (const n of notes) console.log(`  - ${n}`);
    process.exit(1);
  }
  console.log('\nALL EXPECTED COUNTS MET.');
  process.exit(0);
}

main().catch((err) => {
  console.error('resp-proof crashed:', err);
  process.exit(2);
});
