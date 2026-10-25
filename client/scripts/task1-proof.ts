/**
 * TASK 1 proof: the Confirm password field must start its placeholder text at
 * the same left x as the Password field (same lock icon + same pl-10).
 *
 * Method: for each input, compute the left edge of its CONTENT box, which is
 * exactly where the placeholder glyphs begin:
 *     textStartX = boundingBox.x + borderLeftWidth + paddingLeft
 * Read from the live DOM via page.evaluate (computed styles), never from code.
 *
 * Run:  cd client && npx tsx scripts/task1-proof.ts   (Vite dev server on 5173)
 * Exit 1 if the two fields differ by more than 2px, or if either field is
 * missing its lock icon / eye toggle.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:5173';
const TOLERANCE_PX = 2;
const VIEWPORT = { width: 1440, height: 900 };

interface FieldMeasure {
  id: string;
  textStartX: number;
  paddingLeft: number;
  borderLeft: number;
  boxX: number;
  type: string;
  hasLeftLockIcon: boolean;
  hasEyeToggle: boolean;
  eyeToggleAriaLabel: string | null;
}

/** Read the placeholder text-start x plus the facts we need to explain it. */
async function measure(
  page: import('@playwright/test').Page,
  id: string,
): Promise<FieldMeasure> {
  return page.evaluate((fieldId) => {
    const el = document.getElementById(fieldId) as HTMLInputElement | null;
    if (!el) throw new Error(`#${fieldId} not found`);
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const borderLeft = parseFloat(cs.borderLeftWidth) || 0;
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;

    // The lock icon is absolutely positioned inside the same `relative` wrapper.
    const wrapper = el.parentElement;
    const lock = wrapper
      ? wrapper.querySelector('svg.lucide, svg[class*="lock"], svg')
      : null;

    // The eye toggle is the sibling <button> positioned at the right edge.
    const toggle = wrapper ? wrapper.querySelector('button[type="button"]') : null;

    return {
      id: fieldId,
      textStartX: box.x + borderLeft + paddingLeft,
      paddingLeft,
      borderLeft,
      boxX: box.x,
      type: el.type,
      hasLeftLockIcon: Boolean(lock),
      hasEyeToggle: Boolean(toggle),
      eyeToggleAriaLabel: toggle ? toggle.getAttribute('aria-label') : null,
    };
  }, id);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  // Stand-in API: the register page probes /auth/google/url on mount.
  let googleUrlCalls = 0;
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/google/url')) googleUrlCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://accounts.google.com/o/oauth2/v2/auth' }),
    });
  });

  await page.goto(`${BASE}/register`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForSelector('#password', { timeout: 20_000 });
  await page.waitForSelector('#confirmPassword', { timeout: 20_000 });

  const password = await measure(page, 'password');
  const confirm = await measure(page, 'confirmPassword');

  const delta = Math.abs(confirm.textStartX - password.textStartX);

  console.log('=== TASK 1: placeholder text start x @ 1440x900 ===');
  console.log(
    `Password         #password       textStartX=${password.textStartX.toFixed(2)}  ` +
      `(box.x=${password.boxX.toFixed(2)} + border=${password.borderLeft} + padLeft=${password.paddingLeft})  type=${password.type}`,
  );
  console.log(
    `Confirm password #confirmPassword textStartX=${confirm.textStartX.toFixed(2)}  ` +
      `(box.x=${confirm.boxX.toFixed(2)} + border=${confirm.borderLeft} + padLeft=${confirm.paddingLeft})  type=${confirm.type}`,
  );
  console.log(`|delta| = ${delta.toFixed(2)}px   (must be <= ${TOLERANCE_PX}px)`);
  console.log(
    `lock icon: password=${password.hasLeftLockIcon} confirm=${confirm.hasLeftLockIcon}`,
  );
  console.log(
    `eye toggle: password=${password.hasEyeToggle} ("${password.eyeToggleAriaLabel}") ` +
      `confirm=${confirm.hasEyeToggle} ("${confirm.eyeToggleAriaLabel}")`,
  );
  console.log(`(stand-in /api/auth/google/url calls during load: ${googleUrlCalls})`);

  // Toggle behaviour: clicking the confirm eye must flip its input type.
  const confirmToggle = page.locator('#confirmPassword ~ button[type="button"]').first();
  const typeBefore = await page.locator('#confirmPassword').getAttribute('type');
  await confirmToggle.click();
  const typeAfter = await page.locator('#confirmPassword').getAttribute('type');
  console.log(`confirm eye toggle: type ${typeBefore} -> ${typeAfter}`);
  await confirmToggle.click();
  const typeBack = await page.locator('#confirmPassword').getAttribute('type');
  console.log(`confirm eye toggle: type ${typeAfter} -> ${typeBack} (back to start)`);

  const failures: string[] = [];
  if (delta > TOLERANCE_PX) {
    failures.push(
      `placeholder x mismatch: ${password.textStartX.toFixed(2)} vs ${confirm.textStartX.toFixed(2)} (delta ${delta.toFixed(2)}px > ${TOLERANCE_PX}px)`,
    );
  }
  if (!confirm.hasLeftLockIcon) failures.push('confirm field has no lock icon');
  if (!confirm.hasEyeToggle) failures.push('confirm field has no eye toggle');
  if (typeBefore !== 'password' || typeAfter !== 'text' || typeBack !== 'password') {
    failures.push(`confirm eye toggle did not behave (password->${typeAfter}->${typeBack})`);
  }

  await browser.close();

  if (failures.length > 0) {
    console.log('\nFAIL');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nPASS: placeholder text starts within tolerance, lock icon + eye toggle present and working.');
}

main().catch((err) => {
  console.error('task1-proof crashed:', err);
  process.exit(2);
});
