/**
 * Playwright browser checks for CipherNote.
 *
 * Drives the real UI at http://localhost:5173 through system Chrome:
 *   1. Landing page renders with the new branding.
 *   2. Registration generates keys and lands in the vault.
 *   3. Note create -> decrypt roundtrip through the UI.
 *   4. Encrypted file upload -> in-app preview (in-memory decrypt).
 *   5. Privacy mode: blur on window blur, cover on hidden tab.
 *   6. Privacy settings page toggles persist.
 *   7. Security badge claims and lock/logout flow.
 *
 * Run: node scripts/browser-checks.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const results = [];
const stamp = Date.now();
const EMAIL = `pw${stamp}@test.dev`;
const PASSWORD = 'password123';

function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Navigates and handles the app's by-design unlock interstitial.
 *
 * Keys live in memory only, so EVERY full page load starts locked and asks
 * for the password (that is the app's core security model, not a bug). After
 * unlocking we continue with client-side navigation, because another full
 * `goto` would start a fresh page context and lock again.
 */
const NAV_LINKS = {
  '/notes/new': 'Create Note',
  '/privacy': 'Privacy Mode',
  '/files': 'Secure Files',
  '/notes': 'My Notes',
};

async function gotoAndUnlock(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  if (page.url().includes('/unlock')) {
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /unlock vault/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 30000 });
    await page.waitForTimeout(400);
    if (path !== '/dashboard') {
      const label = NAV_LINKS[path];
      if (!label) throw new Error(`No sidebar link known for ${path}`);
      await page.getByRole('link', { name: label }).first().click();
      await page.waitForTimeout(800);
    }
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  try {
    // --- 1. Landing page ---------------------------------------------------
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const brand = await page.getByText('Private by design.').first().isVisible().catch(() => false);
    report('landing: branding visible', brand);

    // --- 2. Registration ---------------------------------------------------
    // Registration ends on the one-time recovery-key handoff, which must be
    // acknowledged before the dashboard.
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
    await page.getByLabel('Display name').fill('Playwright User');
    await page.getByLabel('Email address').fill(EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: /generate keys and create vault/i }).click();
    await page.getByText('Save your recovery key').waitFor({ timeout: 30000 });
    const recoveryShown = await page.locator('p.font-mono').first().textContent();
    report('register: recovery key generated', /^RCVR-[A-Za-z0-9_-]{43}$/.test(recoveryShown?.trim() ?? ''));
    await page.getByRole('button', { name: /i saved it - continue/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 30000 });
    report('register: landed on dashboard', true);

    // --- 3. Note create -> decrypt roundtrip -------------------------------
    const noteTitle = `PW note ${stamp}`;
    await gotoAndUnlock(page, '/notes/new');
    await page.getByLabel('Title').fill(noteTitle);
    await page.getByLabel('Content').fill('Secret content written by Playwright.');
    await page.getByRole('button', { name: /encrypt and save/i }).click();
    await page.waitForURL('**/notes/*', { timeout: 30000 });
    await page.getByText(noteTitle).first().waitFor({ timeout: 15000 });
    report('note: create + decrypt roundtrip', true);

    // --- 4. Encrypted file upload + preview --------------------------------
    // If the guard re-locked after navigation, unlock again first.
    if (page.url().includes('/unlock')) {
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: /unlock vault/i }).click();
      await page.waitForURL('**/notes/*', { timeout: 30000 });
    }
    await page.getByRole('button', { name: /attach encrypted file/i }).click();
    await page.setInputFiles('input[type=file]', {
      name: 'pw-report.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`Playwright confidential payload ${stamp}`),
    });
    await page.getByText('Securely stored · Sent').waitFor({ timeout: 30000 });
    report('file: upload flow completed', true);

    await page.getByRole('button', { name: 'pw-report.txt' }).first().click();
    const previewFrame = page.frameLocator('iframe').first();
    const previewText = await previewFrame.locator('pre').first().textContent().catch(() => null);
    report(
      'file: in-app preview decrypts in memory',
      previewText?.includes(`Playwright confidential payload ${stamp}`) ?? false,
      previewText ? 'decrypted text shown in secure viewer' : 'preview text not found',
    );
    await page.getByRole('button', { name: /close dialog/i }).click();

    // --- 5. Privacy mode: blur on window blur ------------------------------
    await page.context().pages(); // no-op, keep handle
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(400);
    const blurred = await page.locator('div.blur-lg').count();
    report('privacy: content blurs on window blur', blurred > 0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    const unblurred = await page.locator('div.blur-lg').count();
    report('privacy: blur lifts on focus', unblurred === 0);

    // --- 6. Privacy settings persist ----------------------------------------
    await gotoAndUnlock(page, '/privacy');
    const watermarkSwitch = page.getByRole('switch', { name: /watermark/i });
    await watermarkSwitch.click();
    await page.waitForTimeout(200);
    const watermarkOn = await page.getByText(/Watermark: on/i).isVisible().catch(() => false);
    report('privacy: watermark toggle works', watermarkOn);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    if (page.url().includes('/unlock')) {
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: /unlock vault/i }).click();
      await page.waitForURL('**/dashboard', { timeout: 30000 });
      await gotoAndUnlock(page, '/privacy');
    }
    const persisted = await page
      .getByRole('switch', { name: /watermark/i })
      .getAttribute('aria-checked');
    report('privacy: settings persist after reload', persisted === 'true');
    // Restore default
    await page.getByRole('switch', { name: /watermark/i }).click();
    // Close the info dialog the privacy page opened, so later modal checks
    // don't hit two stacked close buttons.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Watermark text actually renders on sensitive screens
    await gotoAndUnlock(page, '/dashboard');
    await page.evaluate(() => {
      localStorage.setItem('ciphernote.privacy', JSON.stringify({ privacyMode: true, blurOnBlur: true, hideOnHidden: true, captureProtection: true, watermark: true, autoLockSeconds: 900 }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    if (page.url().includes('/unlock')) {
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: /unlock vault/i }).click();
      await page.waitForURL('**/dashboard', { timeout: 30000 });
    }
    await page.waitForTimeout(400);
    await page.waitForTimeout(300);
    const wmVisible = await page.getByText(/@test\.dev · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/).isVisible().catch(() => false);
    report('privacy: watermark renders with session identity', wmVisible);
    // Reset watermark off for the remaining checks.
    await page.evaluate(() => {
      localStorage.setItem('ciphernote.privacy', JSON.stringify({ privacyMode: true, blurOnBlur: true, hideOnHidden: true, captureProtection: true, watermark: false, autoLockSeconds: 900 }));
    });

    // --- 7. Security badge --------------------------------------------------
    const badge = page.getByRole('button', { name: /end-to-end encrypted/i }).first();
    const badgeVisible = (await badge.count()) > 0;
    report('security: E2E badge present', badgeVisible);
    if (badgeVisible) {
      await badge.click();
      const claim = await page.getByText(/messages and notes are encrypted with aes-gcm-256/i).isVisible().catch(() => false);
      report('security: badge modal shows true claims', claim);
      await page.getByRole('button', { name: /close dialog/i }).click();
    }

    // --- 8. Lock / unlock flow ------------------------------------------------
    await page.getByRole('button', { name: /^Lock$/i }).click();
    await page.waitForURL('**/unlock', { timeout: 15000 });
    report('lock: drops keys and routes to unlock', true);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: /unlock vault/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 30000 });
    report('lock: password unlocks again', true);

    // --- 9. Logout --------------------------------------------------------------
    await gotoAndUnlock(page, '/dashboard');
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL('**/login', { timeout: 15000 });
    report('logout: returns to login', true);
  } catch (error) {
    report('unexpected failure', false, error instanceof Error ? error.message : String(error));
  }

  const realErrors = consoleErrors.filter(
    (text) =>
      !text.includes('favicon') &&
      !text.includes('401') &&
      !text.includes('403') &&
      !text.includes('404') &&
      !text.includes('Failed to load resource'),
  );
  report('console: no unexpected page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
