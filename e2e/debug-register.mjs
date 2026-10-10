// Debug: run the real register UI flow with network/console instrumentation.
// Prints request outcomes and the final page state so we can see exactly where
// registration stalls. No credentials are real; accounts are throwaway.
import { chromium } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://localhost:5173';
const runId = 'dbg' + Date.now().toString(36);
const account = {
  displayName: 'Debug User',
  email: `debug-${runId}@ciphernote.test`,
  password: 'DebugPass!12345',
};

const browser = await chromium.launch();
const page = await browser.newPage({ baseURL });

page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log(`[console.${msg.type()}] ${msg.text().slice(0, 300)}`);
  }
});
page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 300)}`));
page.on('requestfailed', (req) => {
  console.log(`[requestfailed] ${req.method()} ${req.url()} -> ${req.failure()?.errorText}`);
});
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/api/')) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      body = '<no body>';
    }
    console.log(`[api] ${res.request().method()} ${url.replace(baseURL, '')} -> ${res.status()} ${body}`);
  }
});

try {
  await page.goto('/register', { waitUntil: 'networkidle' });
  console.log('landed on', page.url());

  await page.getByLabel('Full name').fill(account.displayName);
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Confirm password').fill(account.password);
  await page.getByRole('checkbox').check();
  console.log('form filled; clicking Create Account');

  const t0 = Date.now();
  await page.getByRole('button', { name: 'Create Account' }).click();

  // Watch navigation for up to 45s.
  let navigated = false;
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/register'), { timeout: 45_000 });
    navigated = true;
  } catch {
    navigated = false;
  }
  console.log(`after ${Date.now() - t0}ms navigated=${navigated} url=${page.url()}`);

  if (!navigated) {
    const text = await page.locator('body').innerText();
    console.log('--- visible text (first 600) ---');
    console.log(text.slice(0, 600).replace(/\n{2,}/g, '\n'));
    await page.screenshot({ path: 'e2e-debug-register.png', fullPage: true });
    console.log('screenshot: e2e-debug-register.png');
  } else if (page.url().includes('/recovery-key')) {
    console.log('recovery-key page reached; clicking I saved it');
    await page.getByRole('button', { name: /I saved it/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 30_000 });
    console.log('dashboard reached:', page.url());
  }
} catch (err) {
  console.log('DEBUG_ERROR', String(err).slice(0, 500));
  await page.screenshot({ path: 'e2e-debug-register.png', fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
