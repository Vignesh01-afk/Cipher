/**
 * One-off visual check: does the login page render the real cipher-logo.png?
 * Verifies <img src="/cipher-logo.png"> is present, loaded (naturalWidth > 0),
 * visible, and takes a screenshot for eyeballing.
 */
import puppeteer from 'puppeteer-core';
import { resolveChromePath } from './chrome-path.mjs';

const browser = await puppeteer.launch({
  executablePath: resolveChromePath(),
  headless: 'new',
  args: ['--no-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle0', timeout: 30000 });

  const result = await page.evaluate(() => {
    const img = document.querySelector('img[src="/cipher-logo.png"]');
    if (!img) return { found: false };
    const rect = img.getBoundingClientRect();
    return {
      found: true,
      loaded: img.complete && img.naturalWidth > 0,
      naturalWidth: img.naturalWidth,
      renderedSize: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      visible: rect.width > 0 && rect.height > 0,
    };
  });

  console.log('logo check:', JSON.stringify(result, null, 2));

  await page.screenshot({ path: 'logo-check-login.png' });
  console.log('screenshot saved: logo-check-login.png');

  if (!result.found || !result.loaded) {
    console.error('FAIL: logo image not found or not loaded');
    process.exitCode = 1;
  } else {
    console.log('PASS: cipher-logo.png renders on the login page');
  }
} finally {
  await browser.close();
}
