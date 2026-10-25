/**
 * TASK 4 proof: for every control that has (or lacks) a backend, print
 * disabled=true/false, title text, aria-disabled, cursor and opacity from the
 * live DOM.
 *
 * Boots the real app against a stand-in API, unlocks the vault through the real
 * UI, then:
 *   - visits Settings -> Account and probes the 5 account controls
 *   - visits Chat, opens a real conversation, opens "Conversation details" and
 *     probes the 3 chat controls
 *
 * Expectations:
 *   no-backend controls -> disabled=true, title="Not available yet",
 *                          aria-disabled="true"
 *   Block user / Delete conversation -> disabled=false (live, per decision)
 *
 * Run:  cd client && npx tsx scripts/task4-proof.ts   (Vite dev server on 5173)
 * Exit 1 on any mismatch.
 */
import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createUserKeyMaterial } from '../src/lib/crypto';

const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:5173';
const PASSWORD = 'Proof-vault-password-9';

const NO_BACKEND_TITLE = 'Not available yet';

interface Expectation {
  /** Where it appears, for the printed report. */
  where: string;
  label: string;
  /** How to find it. */
  kind: 'text' | 'aria';
  selector: string;
  expectDisabled: boolean;
  /** Minimum number of matching elements we require to be found. */
  minCount: number;
}

const SETTINGS: Expectation[] = [
  { where: 'Settings -> Account -> Profile fields', label: 'Save changes', kind: 'text', selector: 'Save changes', expectDisabled: true, minCount: 1 },
  { where: 'Settings -> Account -> profile header', label: 'Change Photo', kind: 'text', selector: 'Change Photo', expectDisabled: true, minCount: 1 },
  { where: 'Settings -> Account -> Quick Actions', label: 'Two-Factor Authentication', kind: 'text', selector: 'Two-Factor Authentication', expectDisabled: true, minCount: 1 },
  { where: 'Settings -> Account -> Quick Actions', label: 'Download My Data', kind: 'text', selector: 'Download My Data', expectDisabled: true, minCount: 1 },
  { where: 'Settings -> Account -> Quick Actions', label: 'Delete Account', kind: 'text', selector: 'Delete Account', expectDisabled: true, minCount: 1 },
];

const CHAT: Expectation[] = [
  { where: 'Chat -> composer', label: 'Attach file', kind: 'aria', selector: 'Attach file', expectDisabled: true, minCount: 1 },
  { where: 'Chat -> Conversation details', label: 'Report user', kind: 'text', selector: 'Report user', expectDisabled: true, minCount: 1 },
  { where: 'Chat -> Conversation details', label: 'Block user', kind: 'text', selector: 'Block user', expectDisabled: false, minCount: 1 },
  { where: 'Chat -> Conversation details', label: 'Delete conversation', kind: 'text', selector: 'Delete conversation', expectDisabled: false, minCount: 1 },
];

interface Probe {
  disabled: boolean | null;
  title: string | null;
  ariaDisabled: string | null;
  cursor: string;
  opacity: string;
  visible: boolean;
}

function locatorFor(page: Page, e: Expectation): Locator {
  return e.kind === 'aria'
    ? page.locator(`button[aria-label="${e.selector}"]`)
    : page.getByRole('button', { name: e.selector, exact: true });
}

async function probe(el: Locator): Promise<Probe> {
  return el.evaluate((node) => {
    const b = node as HTMLButtonElement;
    const cs = getComputedStyle(node);
    return {
      disabled: typeof b.disabled === 'boolean' ? b.disabled : null,
      title: node.getAttribute('title'),
      ariaDisabled: node.getAttribute('aria-disabled'),
      cursor: cs.cursor,
      opacity: cs.opacity,
      visible: (node as HTMLElement).offsetParent !== null || cs.position === 'fixed',
    };
  });
}

async function runGroup(
  page: Page,
  group: string,
  list: Expectation[],
  failures: string[],
): Promise<void> {
  console.log(`\n===== ${group} =====`);
  console.log(
    'control'.padEnd(28) +
      ' where'.padEnd(44) +
      ' disabled'.padEnd(11) +
      ' aria-disabled'.padEnd(16) +
      ' title'.padEnd(20) +
      ' cursor/opacity',
  );

  for (const e of list) {
    const loc = locatorFor(page, e);
    const count = await loc.count();

    if (count < e.minCount) {
      failures.push(`${e.label}: found ${count} element(s), expected >= ${e.minCount}`);
      console.log(
        `${e.label.padEnd(28)} ${e.where.padEnd(44)} NOT FOUND (${count})`,
      );
      continue;
    }

    for (let i = 0; i < count; i += 1) {
      const info = await probe(loc.nth(i));
      const suffix = count > 1 ? ` [${i + 1}/${count}]` : '';
      console.log(
        `${(e.label + suffix).padEnd(28)} ${e.where.padEnd(44)} ` +
          `${String(info.disabled).padEnd(11)} ${String(info.ariaDisabled).padEnd(16)} ` +
          `${String(info.title).padEnd(20)} ${info.cursor}/${info.opacity}`,
      );

      if (info.disabled !== e.expectDisabled) {
        failures.push(
          `${e.label}: disabled=${info.disabled}, expected ${e.expectDisabled}`,
        );
      }
      if (e.expectDisabled) {
        if (info.title !== NO_BACKEND_TITLE) {
          failures.push(`${e.label}: title=${JSON.stringify(info.title)}, expected "${NO_BACKEND_TITLE}"`);
        }
        if (info.ariaDisabled !== 'true') {
          failures.push(`${e.label}: aria-disabled=${JSON.stringify(info.ariaDisabled)}, expected "true"`);
        }
        if (info.cursor !== 'not-allowed') {
          failures.push(`${e.label}: cursor=${info.cursor}, expected not-allowed`);
        }
        if (parseFloat(info.opacity) >= 1) {
          failures.push(`${e.label}: opacity=${info.opacity}, expected < 1 (looks disabled)`);
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const { material } = await createUserKeyMaterial(PASSWORD);
  const myId = 'proof-user-0001';
  const peerId = 'proof-peer-0002';
  const now = new Date().toISOString();

  const standInUser = {
    id: myId,
    email: 'proof@example.test',
    displayName: 'Proof User',
    createdAt: now,
    cipherId: 'CN-PROOF01',
    username: null,
    ...material,
  };

  const browser = await chromium.launch();
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(
    'globalThis.__name = globalThis.__name || function (fn) { return fn; };',
  );
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ciphernote.session.token', 'proof-session-token');
      localStorage.setItem('ciphernote.theme', 'dark');
    } catch {
      /* storage unavailable */
    }
  });

  const page = await context.newPage();

  // --- stand-in API --------------------------------------------------------
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
              user: { id: myId, displayName: 'Proof User', cipherId: 'CN-PROOF01', username: null },
              wrappedConversationKey: '',
              keyAlgorithm: 'AES-GCM-256',
              lastReadAt: now,
            },
            {
              user: { id: peerId, displayName: 'Peer User', cipherId: 'CN-PEER02', username: 'peer' },
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
              { id: myId, displayName: 'Proof User', cipherId: 'CN-PROOF01', username: null },
              { id: peerId, displayName: 'Peer User', cipherId: 'CN-PEER02', username: 'peer' },
            ],
            lastMessage: null,
            unreadCount: 0,
          },
        ],
      };
    } else if (p.includes('/chat/users/search')) {
      payload = {
        users: [
          { id: peerId, displayName: 'Peer User', cipherId: 'CN-PEER02', username: 'peer' },
        ],
      };
    } else if (method === 'GET') {
      if (/\/notes$/.test(p)) payload = { notes: [], nextCursor: null };
      else if (p.includes('/shared')) payload = { shares: [], nextCursor: null };
      else if (p.includes('/audit')) payload = [];
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
    await page.waitForTimeout(900);
  };

  // --- unlock through the real UI -----------------------------------------
  await page.goto(`${BASE}/unlock`, { waitUntil: 'load', timeout: 45_000 });
  const pwField = page.getByLabel('Password', { exact: true });
  await pwField.waitFor({ state: 'visible', timeout: 30_000 });
  await pwField.fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  const failures: string[] = [];

  // --- Settings -> Account -------------------------------------------------
  await spa('/settings');
  await page.getByRole('button', { name: 'Account', exact: true }).waitFor({ timeout: 20_000 });
  await runGroup(page, 'Settings -> Account controls', SETTINGS, failures);

  // --- Chat ----------------------------------------------------------------
  await spa('/chat');
  const peerRow = page.getByRole('button', { name: /Peer User/ }).first();
  await peerRow.waitFor({ state: 'visible', timeout: 20_000 });
  await peerRow.click();
  await page.waitForTimeout(1200);

  const attach = page.locator('button[aria-label="Attach file"]');
  await attach.first().waitFor({ state: 'visible', timeout: 20_000 });
  await runGroup(page, 'Chat -> composer', CHAT.slice(0, 1), failures);

  await page.locator('button[aria-label="Conversation details"]').first().click();
  await page
    .getByRole('button', { name: 'Report user', exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(400);
  await runGroup(page, 'Chat -> Conversation details', CHAT.slice(1), failures);

  await context.close();
  await browser.close();

  console.log('\n===== TASK 4 RESULT =====');
  if (failures.length === 0) {
    console.log('PASS: every no-backend control is disabled with title "Not available yet"');
    console.log('      and aria-disabled="true"; Block user and Delete conversation are live.');
    process.exit(0);
  }
  console.log('FAIL:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('task4-proof crashed:', err);
  process.exit(2);
});
