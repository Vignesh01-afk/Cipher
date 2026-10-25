/**
 * TASK 6 proof: /api/auth/google/url must not be called on page load.
 *
 * Counts real network requests to /api/auth/google/url while:
 *   1. opening /login      -> expect 0
 *   2. opening /register   -> expect 0
 *   3. clicking "Sign in with Google"    -> expect exactly 1 more
 *   4. clicking "Sign up with Google"    -> expect exactly 1 more
 *
 * Requests are counted from Playwright's `request` events against the real
 * Vite dev server, with a stand-in API answering /api/*.
 *
 * Run:  cd client && npx tsx scripts/task6-proof.ts   (Vite dev server on 5173)
 * Exit 1 if any count misses its expectation.
 */
import { chromium, type Page } from '@playwright/test';

const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:5173';

interface Row {
  step: string;
  expected: number;
  actual: number;
}

const rows: Row[] = [];

function check(step: string, expected: number, actual: number): void {
  rows.push({ step, expected, actual });
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    'globalThis.__name = globalThis.__name || function (fn) { return fn; };',
  );
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ciphernote.theme', 'light');
    } catch {
      /* storage unavailable */
    }
  });

  const page = await context.newPage();

  // Count requests to the rate-limited endpoint.
  let googleUrlCalls = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/auth/google/url')) googleUrlCalls += 1;
  });

  // Stand-in API (the page only needs these to not error).
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const body = url.includes('/auth/google/url')
      ? { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=proof' }
      : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  // --- 1. open /login -------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 45_000 });
  await page.getByRole('button', { name: 'Sign in with Google' }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  // Give any mount-time fetch plenty of time to land before counting.
  await page.waitForTimeout(2500);
  check('open /login (on load)', 0, googleUrlCalls);

  const afterLoginLoad = googleUrlCalls;

  // --- 2. click the Google button on /login ---------------------------------
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.waitForTimeout(2000);
  check('click "Sign in with Google" on /login', 1, googleUrlCalls - afterLoginLoad);

  const afterLoginClick = googleUrlCalls;

  // The click navigates away (window.location.href) - go back for /register.
  await page.goto(`${BASE}/register`, { waitUntil: 'load', timeout: 45_000 });
  await page.getByRole('button', { name: 'Sign up with Google' }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  await page.waitForTimeout(2500);
  check('open /register (on load)', 0, googleUrlCalls - afterLoginClick);

  const afterRegisterLoad = googleUrlCalls;

  // --- 3. click the Google button on /register ------------------------------
  await page.getByRole('button', { name: 'Sign up with Google' }).click();
  await page.waitForTimeout(2000);
  check('click "Sign up with Google" on /register', 1, googleUrlCalls - afterRegisterLoad);

  await browser.close();

  console.log('===== TASK 6: /api/auth/google/url request counts =====');
  const failures: string[] = [];
  for (const r of rows) {
    const ok = r.expected === r.actual;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${r.step.padEnd(42)} expected=${r.expected} actual=${r.actual}`,
    );
    if (!ok) failures.push(`${r.step}: expected ${r.expected}, got ${r.actual}`);
  }

  if (failures.length > 0) {
    console.log('\nFAIL');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nPASS: zero calls on page load; exactly one per Google button click.');
  process.exit(0);
}

main().catch((err) => {
  console.error('task6-proof crashed:', err);
  process.exit(2);
});
