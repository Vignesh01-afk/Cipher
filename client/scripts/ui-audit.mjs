#!/usr/bin/env node
/**
 * STEP 0: browser UI audit harness.
 *
 * Registers a throwaway user through the REAL UI, then for every route at
 * 1440x900 and 390x844 in dark AND light theme runs checks (a)-(h) and prints
 * a table: route | viewport | theme | check | PASS/FAIL | detail.
 * Screenshots land in client/ui-audit-shots/ (gitignored).
 * Exit code 1 if any row FAILs.
 *
 * Usage: node client/scripts/ui-audit.mjs [--only <route-substring>]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.AUDIT_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, '..', 'ui-audit-shots');

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];
const THEMES = ['dark', 'light'];
const PUBLIC_ROUTES = ['/login', '/register', '/', '/terms', '/privacy-policy'];
const AUTH_ROUTES = [
  '/dashboard',
  '/notes',
  '/notes/new',
  '/shared',
  '/chat',
  '/files',
  '/activity',
  '/settings',
  '/settings?tab=privacy',
];
const SAMPLE_DATA = ['Moushika', 'Aravind', 'Priya', 'Surya', 'Akash', 'CN-3K9T12'];

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

const rows = [];
function record(route, vp, theme, check, pass, detail) {
  rows.push({ route, vp, theme, check, pass, detail });
  if (!pass) {
    console.log(
      `FAIL  ${route} | ${vp} | ${theme} | ${check} | ${detail}`.slice(0, 400),
    );
  }
}

function slug(route, vp, theme) {
  return `${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}__${vp}__${theme}`;
}

// Runs inside the page: implements checks (a)-(h) against the live DOM.
function auditInPage(sampleNames) {
  const result = {};

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      Number(s.opacity) > 0.05 &&
      r.width > 1 &&
      r.height > 1
    );
  };

  const parseColor = (str) => {
    const m = String(str).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m
      ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
      : null;
  };

  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const contrast = (c1, c2) => {
    const l1 = lum(c1);
    const l2 = lum(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  // First non-transparent background walking up; flags gradient/image fills.
  const bgOf = (el) => {
    let node = el;
    while (node) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') return { image: true };
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0.02) return { color: c };
      node = node.parentElement;
    }
    return { color: { r: 255, g: 255, b: 255, a: 1 } }; // fallback: white page
  };

  // (a) no horizontal overflow
  const sw = document.documentElement.scrollWidth;
  const iw = window.innerWidth;
  result.overflow = {
    pass: sw <= iw,
    detail: `scrollWidth=${sw} innerWidth=${iw} (over by ${Math.max(0, sw - iw)}px)`,
  };

  // (c) logo image loads
  const logoImgs = Array.from(document.querySelectorAll('img[src*="logo"]'));
  const brokenLogos = logoImgs.filter((img) => !(img.complete === true && img.naturalWidth > 0));
  result.logo = {
    pass: brokenLogos.length === 0,
    detail:
      logoImgs.length === 0
        ? 'no logo <img> on this route'
        : brokenLogos.length === 0
          ? `${logoImgs.length} logo img(s) loaded`
          : `${brokenLogos.length}/${logoImgs.length} broken: ${brokenLogos.map((i) => i.getAttribute('src')).join(', ')}`,
  };

  // (d) every visible button / a.btn has a visible fill or border, and its
  // text colour contrasts >= 3 with the background.
  const buttons = Array.from(document.querySelectorAll('button, a.btn')).filter(visible);
  const btnProblems = [];
  const nameOf = (el) =>
    (el.textContent || '').trim().slice(0, 20) ||
    el.getAttribute('aria-label') ||
    `.${String(el.className).split(' ')[0]}(unnamed)`;
  for (const el of buttons) {
    const s = getComputedStyle(el);
    const bg = parseColor(s.backgroundColor);
    const hasFill = (bg && bg.a > 0.02) || (s.backgroundImage && s.backgroundImage !== 'none');
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(
      (side) => parseFloat(s[`border${side}Width`]) > 0,
    );
    if (!hasFill && !hasBorder) {
      btnProblems.push(`no fill/border: "${nameOf(el)}"`);
      continue;
    }
    const eff = bgOf(el);
    if (eff.color) {
      const fg = parseColor(s.color);
      if (fg) {
        const ratio = contrast(fg, eff.color);
        if (ratio < 3) {
          btnProblems.push(
            `contrast ${ratio.toFixed(2)}<3: "${(el.textContent || '').trim().slice(0, 24)}" (${s.color} on ${`rgb(${eff.color.r}, ${eff.color.g}, ${eff.color.b})`})`,
          );
        }
      }
    }
  }
  result.buttonFill = {
    pass: btnProblems.length === 0,
    detail: btnProblems.length === 0 ? `${buttons.length} controls ok` : btnProblems.join(' | ').slice(0, 300),
  };

  // (e) no <button> nested inside a <button>
  const nested = Array.from(document.querySelectorAll('button button'));
  result.nested = {
    pass: nested.length === 0,
    detail: nested.length === 0 ? 'ok' : `${nested.length} nested button pair(s)`,
  };

  // (f) no two clickable elements sharing the same centre point
  const CLICKABLE =
    'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="link"], [role="checkbox"], label[for], select, input[type="checkbox"], input[type="radio"]';
  const clickables = Array.from(document.querySelectorAll(CLICKABLE)).filter(visible);
  const overlaps = [];
  for (const el of clickables) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || el.contains(hit)) continue;
    const owner = hit.closest(CLICKABLE);
    if (owner && owner !== el) {
      overlaps.push(
        `"${(el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 20)}" covered by "${(owner.textContent || owner.getAttribute('aria-label') || '?').trim().slice(0, 20)}"`,
      );
    }
  }
  result.overlap = {
    pass: overlaps.length === 0,
    detail: overlaps.length === 0 ? `${clickables.length} clickables ok` : overlaps.join(' | ').slice(0, 300),
  };

  // (g) contrast >= 4.5 (body) / >= 3 (large) on the 20 largest text nodes
  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const text = (t.nodeValue || '').trim();
    if (!text) continue;
    const el = t.parentElement;
    if (!el || seen.has(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    if (!visible(el)) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    textNodes.push({ el, text, size: parseFloat(s.fontSize), weight: Number(s.fontWeight) || 400, color: s.color });
  }
  textNodes.sort((a, b) => b.size - a.size || b.text.length - a.text.length);
  const top20 = textNodes.slice(0, 20);
  const contrastProblems = [];
  let computed = 0;
  for (const node of top20) {
    const eff = bgOf(node.el);
    if (!eff.color) continue; // gradient/image behind text: cannot sample
    const fg = parseColor(node.color);
    if (!fg) continue;
    computed += 1;
    const large = node.size >= 24 || (node.size >= 18.66 && node.weight >= 700);
    const need = large ? 3 : 4.5;
    const ratio = contrast(fg, eff.color);
    if (ratio < need) {
      contrastProblems.push(
        `${ratio.toFixed(2)}<${need} @${node.size}px "${node.text.slice(0, 28)}" (${node.color})`,
      );
    }
  }
  result.textContrast = {
    pass: contrastProblems.length === 0,
    detail:
      contrastProblems.length === 0
        ? `${computed}/${top20.length} text nodes ok`
        : contrastProblems.join(' | ').slice(0, 300),
  };

  // (h) no sample data on the page
  const body = document.body.innerText || '';
  const leaked = sampleNames.filter((n) => body.includes(n));
  result.sampleData = {
    pass: leaked.length === 0,
    detail: leaked.length === 0 ? 'ok' : `found: ${leaked.join(', ')}`,
  };

  return result;
}

async function clientNavigate(page, target) {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, target);
  await page.waitForTimeout(900); // render + data fetch + decryption
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();

  // --- collectors (b): console errors + failed requests -----------------
  let current = { console: [], failed: [] };

  async function attach(page) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') current.console.push(msg.text().slice(0, 160));
    });
    page.on('pageerror', (err) => current.console.push(`pageerror: ${String(err).slice(0, 160)}`));
    page.on('requestfailed', (req) => {
      const text = req.failure()?.errorText ?? '';
      if (/ERR_ABORTED|net::ERR_ABORTED/.test(text)) return; // navigation cancels are not app errors
      current.failed.push(`FAILED ${req.url().replace(BASE, '')} (${text})`);
    });
    page.on('response', (res) => {
      const url = res.url().replace(BASE, '');
      if (res.status() >= 400) {
        // Anonymous bootstrap legitimately probes the session -> 401 on /api/auth/me.
        if (res.status() === 401 && url.startsWith('/api/auth/me')) return;
        current.failed.push(`${res.status()} ${url}`);
      }
    });
  }

  async function visit(page, route, vp, theme, spa) {
    current = { console: [], failed: [] };
    await page.setViewportSize({ width: vp.width, height: vp.height });
    if (spa) {
      await clientNavigate(page, route);
    } else {
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 45_000 });
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      await page.waitForTimeout(700);
    }
    // let late requests settle so (b) sees their status
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, slug(route, vp.name, theme) + '.png'), fullPage: true });
    const res = await page.evaluate(auditInPage, SAMPLE_DATA);

    record(route, vp.name, theme, 'a-no-overflow', res.overflow.pass, res.overflow.detail);
    record(
      route,
      vp.name,
      theme,
      'b-console-errors',
      current.console.length === 0,
      current.console.length === 0 ? 'none' : current.console.join(' | ').slice(0, 300),
    );
    record(
      route,
      vp.name,
      theme,
      'b-failed-requests',
      current.failed.length === 0,
      current.failed.length === 0 ? 'none' : [...new Set(current.failed)].join(' | ').slice(0, 300),
    );
    record(route, vp.name, theme, 'c-logo-loads', res.logo.pass, res.logo.detail);
    record(route, vp.name, theme, 'd-button-fill-contrast', res.buttonFill.pass, res.buttonFill.detail);
    record(route, vp.name, theme, 'e-nested-buttons', res.nested.pass, res.nested.detail);
    record(route, vp.name, theme, 'f-overlapping-clickables', res.overlap.pass, res.overlap.detail);
    record(route, vp.name, theme, 'g-text-contrast', res.textContrast.pass, res.textContrast.detail);
    record(route, vp.name, theme, 'h-sample-data', res.sampleData.pass, res.sampleData.detail);
  }

  // --- phase A: public routes, anonymous --------------------------------
  console.log('== Phase A: public routes (anonymous) ==');
  for (const theme of THEMES) {
    const context = await browser.newContext();
    await context.addInitScript((t) => {
      try {
        localStorage.setItem('ciphernote.theme', t);
      } catch {}
    }, theme);
    const page = await context.newPage();
    await attach(page);
    for (const vp of VIEWPORTS) {
      for (const route of PUBLIC_ROUTES) {
        if (only && !route.includes(only)) continue;
        process.stdout.write(`  ${route} @ ${vp.name} ${theme} ... `);
        await visit(page, route, vp, theme, false);
        console.log('ok');
      }
    }
    await context.close();
  }

  // --- phase B: authenticated routes, registered via the real UI --------
  console.log('== Phase B: register via real UI, then authenticated routes ==');
  const runId = Date.now().toString(36);
  const account = {
    email: `ui.audit.${runId}@ciphernote.test`,
    password: 'A-strong-ui-audit-password-1',
    displayName: `Audit User ${runId}`,
  };
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ciphernote.theme', 'dark');
    } catch {}
  });
  const page = await context.newPage();
  await attach(page);

  console.log(`  registering ${account.email} ...`);
  await page.goto(`${BASE}/register`, { waitUntil: 'load', timeout: 45_000 });
  await page.getByLabel('Full name').fill(account.displayName);
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Confirm password').fill(account.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await Promise.race([
    page.waitForURL('**/recovery-key', { timeout: 120_000 }),
    page.waitForURL('**/dashboard', { timeout: 120_000 }),
  ]);
  if (page.url().includes('/recovery-key')) {
    await page.getByRole('button', { name: /I saved it/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 60_000 });
  }
  console.log('  registered.');

  async function unlock() {
    await page.goto(`${BASE}/unlock`, { waitUntil: 'load', timeout: 45_000 });
    const field = page.getByLabel('Password', { exact: true });
    await field.waitFor({ state: 'visible', timeout: 30_000 });
    await field.fill(account.password);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await page.waitForURL(/dashboard|notes|chat|shared|files|activity|settings/, { timeout: 60_000 });
  }

  for (const theme of THEMES) {
    await page.evaluate((t) => localStorage.setItem('ciphernote.theme', t), theme);
    await page.reload({ waitUntil: 'load' });
    await unlock();
    console.log(`  theme=${theme} unlocked`);
    for (const vp of VIEWPORTS) {
      for (const route of AUTH_ROUTES) {
        if (only && !route.includes(only)) continue;
        process.stdout.write(`  ${route} @ ${vp.name} ${theme} ... `);
        await visit(page, route, vp, theme, true);
        console.log('ok');
      }
    }
  }

  await context.close();
  await browser.close();

  // --- report ------------------------------------------------------------
  const fails = rows.filter((r) => !r.pass);
  const line = (r) =>
    `${r.route.padEnd(22)} | ${r.vp.padEnd(9)} | ${r.theme.padEnd(5)} | ${r.check.padEnd(24)} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail}`;
  console.log('\n===== FULL TABLE =====');
  console.log('route                  | viewport  | theme | check                    | result | detail');
  console.log('-'.repeat(150));
  for (const r of rows) console.log(line(r));
  console.log(`\n===== SUMMARY: ${rows.length - fails.length} PASS / ${fails.length} FAIL (of ${rows.length}) =====`);
  writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(rows, null, 2));
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ui-audit crashed:', err);
  process.exit(2);
});
