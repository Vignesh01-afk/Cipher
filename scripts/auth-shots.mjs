/**
 * Auth-shell check.
 *
 * Every auth screen (sign in, sign up, forgot password, Google completion,
 * recovery-key handoff, unlock) should render the same split-screen shell:
 * the brand panel on the left and the glass form card on the right. This
 * script loads each route in both themes, asserts the shell is present, and
 * saves screenshots to client/ui-shots for eyeballing.
 *
 * Usage: node scripts/auth-shots.mjs   (needs `npm --prefix client run dev`)
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChromePath } from './chrome-path.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = resolve(root, 'client', 'ui-shots');
const base = process.env.CIPHER_WEB ?? 'http://localhost:5173';

/** Route -> screenshot name. */
const ROUTES = [
  { path: '/login', name: 'login' },
  { path: '/register', name: 'register' },
  { path: '/forgot-password', name: 'forgot-password' },
  { path: '/auth/google/signup', name: 'google-signup-expired' },
  { path: '/recovery-key', name: 'recovery-key-empty' },
];

mkdirSync(shotDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: resolveChromePath(),
  headless: 'new',
  args: ['--no-sandbox'],
});

const results = [];
let failed = false;

try {
  for (const theme of ['light', 'dark']) {
    for (const route of ROUTES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });

      const consoleErrors = [];
      page.on('pageerror', (error) => consoleErrors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });

      /** Theme is read from localStorage on boot, so seed it first. */
      await page.evaluateOnNewDocument((value) => {
        localStorage.setItem('ciphernote.theme', value);
      }, theme);

      await page.goto(`${base}${route.path}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 250));

      const probe = await page.evaluate(() => {
        const text = document.body.innerText;
        const card = document.querySelector('.card-glass');
        const rect = card?.getBoundingClientRect();
        return {
          url: window.location.pathname,
          brandPanel: text.includes('Your notes. Your privacy. Always.'),
          trustChips: text.includes('End-to-End') && text.includes('Encryption') && text.includes('Full'),
          hasCard: Boolean(card),
          cardWidth: rect ? Math.round(rect.width) : 0,
          heading: document.querySelector('h1')?.textContent?.trim() ?? null,
        };
      });

      const ok = probe.brandPanel && probe.trustChips && probe.hasCard;
      if (!ok) failed = true;

      const file = `${shotDir}/${route.name}-${theme}.png`;
      await page.screenshot({ path: file });
      await page.close();

      results.push({ theme, route: route.path, ok, ...probe, consoleErrors });
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));

if (failed) {
  console.error('FAIL: at least one auth screen does not render the shared AuthShell');
  process.exitCode = 1;
} else {
  console.log('PASS: every auth screen renders the shared AuthShell brand panel + glass card');
}
