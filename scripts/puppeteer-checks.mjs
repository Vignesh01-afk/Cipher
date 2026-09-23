/**
 * Puppeteer-core cross-check for CipherNote (second browser-automation method).
 *
 * Drives the same system Chrome through the CDP to independently verify:
 *   1. Auth (register -> dashboard -> lock -> unlock -> logout).
 *   2. Encrypted note roundtrip through the UI.
 *   3. File upload -> secure preview.
 *   4. Mobile viewport: bottom-safe layout, composer usable, no horizontal
 *      overflow at 390x844 (iPhone-ish).
 *
 * Run: node scripts/puppeteer-checks.mjs
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:5173';
const stamp = Date.now();
const EMAIL = `pptr${stamp}@test.dev`;
const PASSWORD = 'password123';
const results = [];

function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Every full page load starts locked (keys are memory-only by design), so a
 * `goto` to a vault page lands on /unlock. Unlock, then let the SPA settle.
 */
async function gotoAndUnlock(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const url = await page.evaluate(() => window.location.pathname);
  if (url === '/unlock') {
    await page.type('#password', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (path !== '/dashboard' && !path.startsWith('/dashboard')) {
    // After unlocking, the app redirected to /dashboard; navigate in-SPA via
    // clicking the sidebar link so the JS context (and keys) survive.
    await page.evaluate((target) => {
      const links = [...document.querySelectorAll('a')];
      const link = links.find((a) => a.getAttribute('href') === target);
      link?.click();
    }, path);
    await page.waitForFunction(
      (target) => window.location.pathname === target,
      { timeout: 15000 },
      path,
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // --- 1. Register ---------------------------------------------------------
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle0' });
    await page.type('#displayName', 'Puppeteer User');
    await page.type('#email', EMAIL);
    await page.type('#password', PASSWORD);
    await page.type('#confirmPassword', PASSWORD);
    await page.click('button[type=submit]');
    // Registration now ends on the one-time recovery-key handoff.
    await page.waitForFunction(() => document.body.innerText.includes('Save your recovery key'), { timeout: 30000 });
    const recoveryKey = await page.evaluate(() => document.querySelector('p.font-mono')?.textContent?.trim() ?? '');
    report(
      'register: recovery key generated',
      /^RCVR-[A-Za-z0-9_-]{43}$/.test(recoveryKey),
      recoveryKey ? '' : 'no key shown',
    );
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      buttons.find((b) => /i saved it - continue/i.test(b.innerText))?.click();
    });
    await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 30000 });
    report('register: dashboard reached', true);

    // --- 2. Note roundtrip -----------------------------------------------------
    const title = `PPTR note ${stamp}`;
    await gotoAndUnlock(page, '/notes/new');
    await page.type('#title', title);
    await page.type('#content', 'Puppeteer encrypted content.');
    await page.click('button[type=submit]');
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      { timeout: 20000 },
      title,
    );
    report('note: encrypted roundtrip visible', true);

    // --- 3. File upload + preview ------------------------------------------------
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find((b) => /attach encrypted file/i.test(b.innerText));
      target?.click();
    });
    const fileInput = await page.waitForSelector('input[type=file]', { visible: false });
    // uploadFile cannot take a buffer; write a temp file instead.
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = path.join(os.tmpdir(), `pptr-${stamp}.txt`);
    fs.writeFileSync(tmp, `Puppeteer confidential ${stamp}`);
    await fileInput.uploadFile(tmp);
    await page.waitForFunction(() => document.body.innerText.includes('Securely stored'), { timeout: 30000 });
    report('file: encrypted upload completed', true);

    // Wait for the uploaded file's row to appear before opening its preview.
    await page.waitForFunction(
      (s) => [...document.querySelectorAll('button')].some((b) => b.innerText.includes(`pptr-${s}.txt`)),
      { timeout: 20000 },
      stamp,
    );

    await page.evaluate((stampValue) => {
      const links = [...document.querySelectorAll('button')];
      const target = links.find((b) => b.innerText.includes(`pptr-${stampValue}.txt`));
      target?.click();
    }, stamp);
    await page.waitForFunction(
      () => document.querySelector('iframe, img, video, audio') !== null,
      { timeout: 20000 },
    );
    report('file: secure preview opened', true);

    // Close the modal
    await page.keyboard.press('Escape');

    // --- 4. Privacy: blur on blur ------------------------------------------------
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const blurred = await page.evaluate(() => document.querySelectorAll('.blur-lg').length);
    report('privacy: blur engages on window blur', blurred > 0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const cleared = await page.evaluate(() => document.querySelectorAll('.blur-lg').length);
    report('privacy: blur clears on focus', cleared === 0);

    // --- 5. Mobile viewport checks (390x844) --------------------------------------
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await gotoAndUnlock(page, '/notes');
    await new Promise((resolve) => setTimeout(resolve, 400));

    const noHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    report('mobile: no horizontal overflow', noHorizontalOverflow);

    const menuButton = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button[aria-label]')];
      return buttons.some((b) => /open navigation/i.test(b.getAttribute('aria-label') ?? ''));
    });
    report('mobile: drawer navigation available', menuButton);

    // Composer usable on the editor screen (in-SPA navigation keeps keys)
    await page.evaluate(() => {
      const links = [...document.querySelectorAll('a')];
      const link = links.find((a) => a.getAttribute('href') === '/notes/new');
      link?.click();
    });
    await page.waitForFunction(() => window.location.pathname === '/notes/new', { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const composerInput = await page.$('#content');
    report('mobile: composer reachable', composerInput !== null);

    // Privacy settings reachable and scrollable (in-SPA navigation)
    await page.evaluate(() => {
      const links = [...document.querySelectorAll('a')];
      const link = links.find((a) => a.getAttribute('href') === '/privacy');
      link?.click();
    });
    await page.waitForFunction(() => window.location.pathname === '/privacy', { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const switches = await page.evaluate(() => document.querySelectorAll('[role=switch]').length);
    report('mobile: privacy toggles rendered', switches >= 5, `${switches} switches`);

    // Touch target sanity: primary buttons are at least ~40px tall
    const smallTargets = await page.evaluate(() => {
      return [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 24)
        .length;
    });
    report('mobile: no sub-24px touch targets', smallTargets === 0, `${smallTargets} too small`);

    // --- 6. Logout -----------------------------------------------------------------
    await page.setViewport({ width: 1440, height: 900 });
    await gotoAndUnlock(page, '/dashboard');
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find((b) => /sign out/i.test(b.innerText));
      target?.click();
    });
    await page.waitForFunction(() => window.location.pathname === '/login', { timeout: 20000 });
    report('logout: back to login', true);
  } catch (error) {
    report('unexpected failure', false, error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
