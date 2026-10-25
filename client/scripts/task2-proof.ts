/**
 * TASK 2 proof: is the toast background solid in light and dark?
 *
 * Boots the real app against a stand-in API, unlocks the vault through the real
 * UI, then creates a note through the real editor so the genuine "Note created"
 * toast appears over a page that has text behind it.
 *
 * A page-side sampler records, at T+100ms and T+1500ms from the moment the
 * toast first appears:
 *   - getComputedStyle(.toast).backgroundColor / .opacity   (literal .toast)
 *   - the LIVE toast element's backgroundColor / opacity
 *   - opacity of every ancestor up to <body>
 *
 * Run:  cd client && npx tsx scripts/task2-proof.ts   (Vite dev server on 5173)
 * Exit 1 if any sample after 600ms has a non-opaque background or an ancestor
 * opacity < 1.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createUserKeyMaterial } from '../src/lib/crypto';

const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:5173';
const PASSWORD = 'Proof-vault-password-9';

interface AncestorSample {
  tag: string;
  cls: string;
  opacity: string;
}

interface ToastSample {
  atMs: number;
  text: string;
  /** literal `.toast` element (may be absent - reported as null) */
  classicBg: string | null;
  classicOpacity: string | null;
  liveBg: string;
  liveOpacity: string;
  liveBorder: string;
  liveShadow: string;
  ancestors: AncestorSample[];
}

/** Installed in the page before the toast fires; records samples on a timer. */
const SAMPLER = () => {
  const w = window as unknown as {
    __toastSamples?: ToastSample[];
    __toastSeen?: string;
  };
  w.__toastSamples = [];
  w.__toastSeen = '';

  const readAncestors = (el: Element): AncestorSample[] => {
    const out: AncestorSample[] = [];
    let p: Element | null = el.parentElement;
    while (p) {
      out.push({
        tag: p.tagName,
        cls: String(p.className || '').slice(0, 70),
        opacity: getComputedStyle(p).opacity,
      });
      if (p === document.body) break;
      p = p.parentElement;
    }
    return out;
  };

  const findLive = (): Element | null => {
    const classic = document.querySelector('.toast');
    if (classic) return classic;
    const holder = document.querySelector('[role="status"]');
    if (holder && holder.firstElementChild) return holder.firstElementChild;
    return null;
  };

  const snapshot = (label: string, atMs: number) => {
    const live = findLive();
    if (!live) return;
    const cs = getComputedStyle(live);
    const classic = document.querySelector('.toast');
    const ccs = classic ? getComputedStyle(classic) : null;
    w.__toastSamples!.push({
      atMs,
      text: label,
      classicBg: ccs ? ccs.backgroundColor : null,
      classicOpacity: ccs ? ccs.opacity : null,
      liveBg: cs.backgroundColor,
      liveOpacity: cs.opacity,
      liveBorder: cs.borderTopWidth + ' ' + cs.borderTopColor,
      liveShadow: cs.boxShadow,
      ancestors: readAncestors(live),
    });
  };

  const start = (): void => {
    const live = findLive();
    if (!live || w.__toastSeen) return;
    w.__toastSeen = String(Date.now());
    snapshot('appear', 0);
    window.setTimeout(() => snapshot('t+100ms', 100), 100);
    window.setTimeout(() => snapshot('t+1500ms', 1500), 1500);
  };

  const mo = new MutationObserver(() => start());
  mo.observe(document.body, { childList: true, subtree: true });
  start();
};

async function newThemedContext(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  theme: 'light' | 'dark',
): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // tsx/esbuild runs with keepNames, which rewrites serialized page functions
  // with a __name() helper that does not exist inside the browser. A raw-string
  // init script (never transformed) installs the shim before any evaluate().
  await context.addInitScript(
    'globalThis.__name = globalThis.__name || function (fn) { return fn; };',
  );
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('ciphernote.session.token', 'proof-session-token');
      localStorage.setItem('ciphernote.theme', t);
    } catch {
      /* storage unavailable */
    }
  }, theme);
  return context;
}

async function standInApi(page: Page, material: Record<string, string>): Promise<void> {
  const standInUser = {
    id: 'proof-user-0001',
    email: 'proof@example.test',
    displayName: 'Proof User',
    createdAt: new Date().toISOString(),
    cipherId: 'CN-PROOF01',
    username: null,
    ...material,
  };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    let payload: unknown;

    if (url.pathname.endsWith('/auth/me')) {
      payload = { user: standInUser };
    } else if (url.pathname.endsWith('/auth/google/url')) {
      payload = { url: 'https://accounts.google.com/o/oauth2/v2/auth' };
    } else if (method === 'POST' && /\/notes$/.test(url.pathname)) {
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
      payload = {
        note: {
          id: 'proof-note-0001',
          ownerId: standInUser.id,
          ciphertext: body.ciphertext ?? '',
          iv: body.iv ?? '',
          encryptionVersion: body.encryptionVersion ?? 1,
          algorithm: body.algorithm ?? 'AES-GCM-256',
          payloadBytes: body.payloadBytes ?? 0,
          wrappedNoteKey: body.wrappedNoteKey ?? '',
          noteKeyIv: body.noteKeyIv ?? '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          shares: [],
        },
      };
    } else if (method === 'GET' && /\/notes\//.test(url.pathname)) {
      payload = {
        note: {
          id: 'proof-note-0001',
          ownerId: standInUser.id,
          ciphertext: 'x',
          iv: 'x',
          encryptionVersion: 1,
          algorithm: 'AES-GCM-256',
          payloadBytes: 0,
          wrappedNoteKey: '',
          noteKeyIv: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          shares: [],
        },
      };
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
}

/** Parse an rgba()/rgb() colour into its alpha. */
function alphaOf(css: string): number {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
}

async function runTheme(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  theme: 'light' | 'dark',
  material: Record<string, string>,
): Promise<string[]> {
  const problems: string[] = [];
  const context = await newThemedContext(browser, theme);
  const page = await context.newPage();
  await standInApi(page, material);

  // --- unlock through the real UI -----------------------------------------
  await page.goto(`${BASE}/unlock`, { waitUntil: 'load', timeout: 45_000 });
  const pwField = page.getByLabel('Password', { exact: true });
  await pwField.waitFor({ state: 'visible', timeout: 30_000 });
  await pwField.fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  // --- go to the real note editor and create a note ------------------------
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, '/notes/new');
  await page.getByLabel('Title', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });

  await page.evaluate(SAMPLER);

  await page.getByLabel('Title', { exact: true }).fill('Toast opacity probe');
  await page.getByLabel('Content', { exact: true }).fill('Body text behind the toast.');
  await page.getByRole('button', { name: /Encrypt and save/ }).click();

  // Wait for the sampler to have both timed samples.
  await page
    .waitForFunction(
      () =>
        ((window as unknown as { __toastSamples?: unknown[] }).__toastSamples?.length ?? 0) >= 3,
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => undefined);

  const samples = (await page.evaluate(
    () => (window as unknown as { __toastSamples?: ToastSample[] }).__toastSamples ?? [],
  )) as ToastSample[];

  console.log(`\n================ ${theme.toUpperCase()} THEME ================`);
  if (samples.length === 0) {
    console.log('  no toast appeared - nothing measured');
    problems.push(`${theme}: no toast appeared`);
    await context.close();
    return problems;
  }

  for (const s of samples) {
    console.log(`  [${s.atMs}ms]`);
    console.log(`    literal .toast          : bg=${s.classicBg ?? '(no .toast element)'} opacity=${s.classicOpacity ?? 'n/a'}`);
    console.log(`    live toast              : bg=${s.liveBg} opacity=${s.liveOpacity}`);
    console.log(`                            border=${s.liveBorder}`);
    console.log(`                            shadow=${s.liveShadow}`);
    console.log('    ancestors (opacity):');
    for (const a of s.ancestors) {
      console.log(`      ${a.tag}.${a.cls || '(no class)'} -> ${a.opacity}`);
    }

    if (s.atMs >= 600) {
      const bgAlpha = alphaOf(s.liveBg);
      if (bgAlpha < 1) {
        problems.push(
          `${theme} @${s.atMs}ms: toast background is NOT opaque (${s.liveBg})`,
        );
      }
      if (parseFloat(s.liveOpacity) < 1) {
        problems.push(`${theme} @${s.atMs}ms: toast opacity=${s.liveOpacity} < 1`);
      }
      const transparentAncestor = s.ancestors.find((a) => parseFloat(a.opacity) < 1);
      if (transparentAncestor) {
        problems.push(
          `${theme} @${s.atMs}ms: ancestor ${transparentAncestor.tag}.${transparentAncestor.cls} opacity=${transparentAncestor.opacity} < 1`,
        );
      }
    }
  }

  await context.close();
  return problems;
}

async function main(): Promise<void> {
  const { material } = await createUserKeyMaterial(PASSWORD);
  const browser = await chromium.launch();

  const problems: string[] = [];
  problems.push(...(await runTheme(browser, 'light', material)));
  problems.push(...(await runTheme(browser, 'dark', material)));

  await browser.close();

  console.log('\n===== TASK 2 RESULT =====');
  if (problems.length === 0) {
    console.log('PASS: toast is fully opaque in both themes at 100ms and 1500ms;');
    console.log('      every ancestor up to <body> has opacity 1 after 600ms.');
    process.exit(0);
  }
  console.log('FAIL:');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('task2-proof crashed:', err);
  process.exit(2);
});
