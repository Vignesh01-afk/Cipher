/**
 * TASK 5 audit: horizontal overflow, console errors, empty accessible names
 * and broken images for every app page, at 1440x900 and 390x844, dark and light.
 *
 * Stand-in API only - no real server. The vault is unlocked through the real UI
 * and one note is created through the real editor (the stand-in echoes the
 * ciphertext back on GET, so the note view renders genuinely decrypted content).
 *
 * Console errors ignore websocket / socket.io noise and /api/auth/google/url.
 * Screenshots land in client/ui-shots/ (git-ignored).
 *
 * Run:  cd client && npx tsx scripts/task5-audit.ts
 * Exit 1 if any page still reports an issue.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createUserKeyMaterial } from '../src/lib/crypto';

const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:5173';
const PASSWORD = 'Proof-vault-password-9';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, '..', 'ui-shots');

const NOTE_ID = 'proof-note-0001';

/** Auth-required routes, each with a readable label for the report. */
const ROUTES: Array<{ path: string; label: string }> = [
  { path: '/dashboard', label: '/dashboard' },
  { path: '/notes', label: '/notes' },
  { path: '/notes/new', label: '/notes/new' },
  { path: `/notes/${NOTE_ID}`, label: '/notes/:id (note view)' },
  { path: '/shared', label: '/shared' },
  { path: '/files', label: '/files' },
  { path: '/activity', label: '/activity (Audit Log)' },
  { path: '/inspector', label: '/inspector (Security Inspector)' },
  { path: '/chat', label: '/chat' },
  { path: '/settings?tab=account', label: '/settings (Account tab)' },
  { path: '/settings?tab=security', label: '/settings (Security tab)' },
  { path: '/settings?tab=appearance', label: '/settings (Appearance tab)' },
  { path: '/settings?tab=notifications', label: '/settings (Notifications tab)' },
  { path: '/settings?tab=privacy', label: '/settings (Privacy tab)' },
  { path: '/settings?tab=about', label: '/settings (About tab)' },
  { path: '/forgot-password', label: '/forgot-password' },
  { path: '/recovery-key', label: '/recovery-key' },
  { path: '/terms', label: '/terms' },
  { path: '/privacy-policy', label: '/privacy-policy' },
];

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];

interface PageAudit {
  overflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  consoleErrors: string[];
  unnamed: Array<{ tag: string; cls: string; snippet: string }>;
  brokenImages: string[];
}

/** Runs inside the page against the live DOM. */
function auditInPage(): PageAudit {
  const se = document.scrollingElement;

  const isVisible = (el: Element): boolean => {
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

  /** Simplified accessible name: aria-label > aria-labelledby > text > title > alt. */
  const accName = (el: Element): string => {
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const ab = el.getAttribute('aria-labelledby');
    if (ab) {
      const joined = ab
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
      if (joined) return joined;
    }
    const text = (el.textContent ?? '').trim();
    if (text) return text;
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    const value = (el as HTMLInputElement).value;
    if (typeof value === 'string' && value.trim()) return value.trim();
    return '';
  };

  const INTERACTIVE =
    'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="link"], [role="checkbox"], [role="option"]';
  const unnamed: Array<{ tag: string; cls: string; snippet: string }> = [];
  for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
    if (!isVisible(el)) continue;
    if (accName(el)) continue;
    unnamed.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 60),
      snippet: (el.outerHTML ?? '').slice(0, 120),
    });
  }

  const brokenImages: string[] = [];
  for (const img of Array.from(document.querySelectorAll('img'))) {
    if (!isVisible(img)) continue;
    if (img.naturalWidth === 0) {
      brokenImages.push(img.getAttribute('src') ?? '(no src)');
    }
  }

  return {
    overflow: se ? se.scrollWidth > se.clientWidth : false,
    scrollWidth: se?.scrollWidth ?? 0,
    clientWidth: se?.clientWidth ?? 0,
    consoleErrors: [],
    unnamed,
    brokenImages,
  };
}

/** Console errors to ignore: websocket noise and the rate-limited Google URL. */
function ignorable(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes('websocket') || t.includes('socket.io') || t.includes('ws://')) return true;
  if (t.includes('wss://')) return true;
  if (t.includes('/api/auth/google/url')) return true;
  if (t.includes('failed to load resource') && t.includes('google')) return true;
  return false;
}

function slug(label: string, vp: string, theme: string): string {
  const base = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base}__${vp}__${theme}`;
}

interface Row {
  label: string;
  vp: string;
  theme: string;
  issues: string[];
}

async function runTheme(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  theme: 'light' | 'dark',
  material: Record<string, string>,
  rows: Row[],
): Promise<void> {
  const now = new Date().toISOString();
  const standInUser = {
    id: 'proof-user-0001',
    email: 'proof@example.test',
    displayName: 'Proof User',
    createdAt: now,
    cipherId: 'CN-PROOF01',
    username: null,
    ...material,
  };

  // The stand-in remembers the ciphertext the real editor POSTs, so the note
  // view can decrypt it with the vault's own keys.
  let createdNote: Record<string, unknown> | null = null;

  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
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

  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text().slice(0, 200);
    if (!ignorable(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = `pageerror: ${String(err).slice(0, 200)}`;
    if (!ignorable(text)) consoleErrors.push(text);
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const p = url.pathname;
    let payload: unknown;

    if (p.endsWith('/auth/me')) {
      payload = { user: standInUser };
    } else if (p.endsWith('/auth/google/url')) {
      payload = { url: 'https://accounts.google.com/o/oauth2/v2/auth' };
    } else if (method === 'POST' && /\/notes$/.test(p)) {
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
      createdNote = {
        id: NOTE_ID,
        ownerId: standInUser.id,
        ciphertext: body.ciphertext ?? '',
        iv: body.iv ?? '',
        encryptionVersion: body.encryptionVersion ?? 1,
        algorithm: body.algorithm ?? 'AES-GCM-256',
        payloadBytes: body.payloadBytes ?? 0,
        wrappedNoteKey: body.wrappedNoteKey ?? '',
        noteKeyIv: body.noteKeyIv ?? '',
        createdAt: now,
        updatedAt: now,
        shares: [],
      };
      payload = { note: createdNote };
    } else if (method === 'GET' && p.includes(`/notes/${NOTE_ID}`)) {
      payload = { note: createdNote ?? {} };
    } else if (method === 'GET' && /\/notes$/.test(p)) {
      payload = {
        notes: createdNote ? [createdNote] : [],
        nextCursor: null,
      };
    } else if (p.includes('/chat/conversations') && p.endsWith('/messages')) {
      payload = { messages: [], nextCursor: null };
    } else if (p.includes('/chat/conversations/') && method === 'GET') {
      payload = {
        conversation: {
          id: 'conv-proof-0001',
          contextNoteId: null,
          createdAt: now,
          members: [
            {
              user: { id: standInUser.id, displayName: 'Proof User', cipherId: 'CN-PROOF01', username: null },
              wrappedConversationKey: '',
              keyAlgorithm: 'AES-GCM-256',
              lastReadAt: now,
            },
            {
              user: { id: 'proof-peer-0002', displayName: 'Peer User', cipherId: 'CN-PEER02', username: 'peer' },
              wrappedConversationKey: '',
              keyAlgorithm: 'AES-GCM-256',
              lastReadAt: null,
            },
          ],
        },
      };
    } else if (p.endsWith('/chat/conversations') && method === 'GET') {
      payload = {
        conversations: [
          {
            id: 'conv-proof-0001',
            contextNoteId: null,
            createdAt: now,
            updatedAt: now,
            lastReadAt: now,
            wrappedConversationKey: '',
            keyAlgorithm: 'AES-GCM-256',
            participants: [
              { id: standInUser.id, displayName: 'Proof User', cipherId: 'CN-PROOF01', username: null },
              { id: 'proof-peer-0002', displayName: 'Peer User', cipherId: 'CN-PEER02', username: 'peer' },
            ],
            lastMessage: null,
            unreadCount: 0,
          },
        ],
      };
    } else if (p.includes('/chat/users/search')) {
      payload = {
        users: [
          { id: 'proof-peer-0002', displayName: 'Peer User', cipherId: 'CN-PEER02', username: 'peer' },
        ],
      };
    } else if (method === 'GET') {
      if (p.includes('/shared')) payload = { shares: [], nextCursor: null };
      else if (p.includes('/audit')) payload = { logs: [], limit: 80 };
      else if (p.includes('/files')) payload = { files: [] };
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

  const spa = async (target: string): Promise<void> => {
    await page.evaluate((to) => {
      window.history.pushState({}, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, target);
    await page.waitForTimeout(700);
  };

  // --- unlock through the real UI -----------------------------------------
  await page.goto(`${BASE}/unlock`, { waitUntil: 'load', timeout: 45_000 });
  const pwField = page.getByLabel('Password', { exact: true });
  await pwField.waitFor({ state: 'visible', timeout: 30_000 });
  await pwField.fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  // --- create one real note so the note view is genuinely decrypted ---------
  await spa('/notes/new');
  await page.getByLabel('Title', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByLabel('Title', { exact: true }).fill('Audit note');
  await page.getByLabel('Content', { exact: true }).fill('Decrypted body used by the page audit.');
  await page.getByRole('button', { name: /Encrypt and save/ }).click();
  await page.waitForURL(`**/notes/${NOTE_ID}`, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(600);

  console.log(`\n########## theme=${theme} ##########`);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);

    for (const route of ROUTES) {
      consoleErrors.length = 0;
      await spa(route.path);
      await page.waitForTimeout(500);

      const res = await page.evaluate(auditInPage);
      res.consoleErrors = [...consoleErrors];

      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: path.join(SHOTS, slug(route.label, vp.name, theme) + '.png'),
        fullPage: true,
      });

      const issues: string[] = [];
      if (res.overflow) {
        issues.push(`overflow +${res.scrollWidth - res.clientWidth}px (scrollWidth=${res.scrollWidth} clientWidth=${res.clientWidth})`);
      }
      if (res.consoleErrors.length > 0) {
        issues.push(`${res.consoleErrors.length} console error(s): ${res.consoleErrors.join(' | ').slice(0, 200)}`);
      }
      if (res.unnamed.length > 0) {
        issues.push(
          `${res.unnamed.length} empty accessible name: ` +
            res.unnamed.map((u) => `<${u.tag} class="${u.cls}">`).join(', '),
        );
      }
      if (res.brokenImages.length > 0) {
        issues.push(`${res.brokenImages.length} broken <img>: ${res.brokenImages.join(', ')}`);
      }

      const status = issues.length === 0 ? 'ok ' : 'ISSUE';
      console.log(
        `${status} ${route.label.padEnd(34)} ${vp.name.padEnd(9)} ${theme.padEnd(5)} ` +
          `overflow=${res.overflow} errors=${res.consoleErrors.length} ` +
          `unnamed=${res.unnamed.length} brokenImg=${res.brokenImages.length}`,
      );
      for (const i of issues) console.log(`        - ${i}`);

      rows.push({ label: route.label, vp: vp.name, theme, issues });
    }
  }

  await context.close();
}

async function main(): Promise<void> {
  const { material } = await createUserKeyMaterial(PASSWORD);
  const browser = await chromium.launch();
  const rows: Row[] = [];

  await runTheme(browser, 'dark', material, rows);
  await runTheme(browser, 'light', material, rows);

  await browser.close();

  const withIssues = rows.filter((r) => r.issues.length > 0);
  console.log('\n===== TASK 5 SUMMARY =====');
  console.log(`pages checked: ${rows.length} (19 routes x 2 viewports x 2 themes)`);
  console.log(`pages with issues: ${withIssues.length}`);
  if (withIssues.length > 0) {
    console.log('\nPages still reporting an issue:');
    for (const r of withIssues) {
      console.log(`  ${r.label} @ ${r.vp} ${r.theme}`);
      for (const i of r.issues) console.log(`      - ${i}`);
    }
    process.exit(1);
  }
  console.log('PASS: no overflow, no console errors, no empty names, no broken images.');
  process.exit(0);
}

main().catch((err) => {
  console.error('task5-audit crashed:', err);
  process.exit(2);
});
