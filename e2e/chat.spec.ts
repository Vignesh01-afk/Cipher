import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getSessionToken, loadAccounts, storageStatePath, unlockVault } from './helpers/accounts';
import { authHeaders, clientNavigate } from './helpers/api';

const book = loadAccounts();

async function openUser(
  browser: Browser,
  role: 'alice' | 'bob',
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  const page = await context.newPage();
  await unlockVault(page, book[role].password);
  return { context, page };
}

async function gotoChat(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Chat', exact: true }).click();
  await page.waitForURL(/\/chat$/);
}

/** Starts (or opens) a 1:1 conversation with Bob from Alice's chat page. */
async function aliceStartsChatWithBob(alice: Page): Promise<void> {
  await gotoChat(alice);
  await alice.getByRole('button', { name: 'New Chat', exact: true }).click();

  const search = alice.getByLabel('Search contacts');
  // Search this run's unique handle, not the common substring "Bob": the
  // shared dev database holds many similarly named users and the endpoint
  // returns only the first 10 matches.
  await search.fill(book.bob.displayName);
  // The app debounces the search by 250ms.  Yield so the debounce timer
  // fires and the dropdown is populated before we assert against it.
  await alice.waitForTimeout(350);

  await expect(alice.getByText(book.bob.displayName)).toBeVisible({
    timeout: 30_000,
  });
  await alice.getByRole('button', { name: 'Start chat' }).first().click();

  // The composer only renders once the conversation key has been unwrapped.
  await expect(alice.getByLabel('Message input')).toBeVisible({ timeout: 30_000 });
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message input').fill(text);
  await page.getByLabel('Send message').click();
}

test.describe('Encrypted chat', () => {
  test('Alice starts a chat, sends a message, and Bob can read it and reply', async ({ browser }) => {
    const { context: aliceCtx, page: alice } = await openUser(browser, 'alice');
    const { context: bobCtx, page: bob } = await openUser(browser, 'bob');

    try {
      await aliceStartsChatWithBob(alice);

      const first = `hello from alice ${Date.now().toString(36)}`;
      await sendMessage(alice, first);
      // The optimistic bubble renders immediately.
      await expect(alice.getByText(first)).toBeVisible({ timeout: 30_000 });

      // --- Bob opens the conversation and reads the message -------------
      await gotoChat(bob);
      const conversation = bob.getByRole('button', { name: /Alice E2E/ });
      await expect(conversation).toBeVisible({ timeout: 30_000 });
      await conversation.click();
      await expect(bob.getByLabel('Message input')).toBeVisible({ timeout: 30_000 });
      await expect(bob.getByText(first)).toBeVisible({ timeout: 30_000 });

      // On Bob's page the conversation header/list shows the PEER (Alice).
      await expect(bob.getByText(book.alice.displayName).first()).toBeVisible({ timeout: 30_000 });

      // --- Bob replies, Alice sees it (socket or the 4s polling fallback) ---
      const reply = `reply from bob ${Date.now().toString(36)}`;
      await sendMessage(bob, reply);
      await expect(bob.getByText(reply)).toBeVisible({ timeout: 30_000 });
      await expect(alice.getByText(reply)).toBeVisible({ timeout: 30_000 });
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test('messages persist across client-side navigation', async ({ browser }) => {
    const { context: aliceCtx, page: alice } = await openUser(browser, 'alice');
    const { context: bobCtx, page: bob } = await openUser(browser, 'bob');

    try {
      await aliceStartsChatWithBob(alice);
      const message = `persist ${Date.now().toString(36)}`;
      await sendMessage(alice, message);
      await expect(alice.getByText(message)).toBeVisible({ timeout: 30_000 });

      // Leave and come back (still the same session/keys).
      await gotoChat(alice);
      await alice.getByRole('button', { name: /Bob E2E/ }).first().click();
      await expect(alice.getByText(message)).toBeVisible({ timeout: 30_000 });

      // A second browser (Bob) confirms the message really is on the server.
      await gotoChat(bob);
      await bob.getByRole('button', { name: /Alice E2E/ }).first().click();
      await expect(bob.getByText(message)).toBeVisible({ timeout: 30_000 });
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test('handles long messages and unicode', async ({ browser }) => {
    const { context: aliceCtx, page: alice } = await openUser(browser, 'alice');
    const { context: bobCtx, page: bob } = await openUser(browser, 'bob');

    try {
      await aliceStartsChatWithBob(alice);

      const unicode = 'méssage 你好 🚀 emoji & symbols <html> "quoted"';
      await sendMessage(alice, unicode);
      await expect(alice.getByText(unicode)).toBeVisible({ timeout: 30_000 });

      const long = `LONG-${Date.now().toString(36)}-${'z'.repeat(1200)}`;
      await sendMessage(alice, long);
      await expect(alice.getByText(/LONG-/)).toBeVisible({ timeout: 30_000 });

      await gotoChat(bob);
      await bob.getByRole('button', { name: /Alice E2E/ }).first().click();
      await expect(bob.getByText(unicode)).toBeVisible({ timeout: 30_000 });
      await expect(bob.getByText(/LONG-/)).toBeVisible({ timeout: 30_000 });
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test('the API returns ciphertext, never chat plaintext', async ({ browser, request }) => {
    const { context: aliceCtx, page: alice } = await openUser(browser, 'alice');

    try {
      await aliceStartsChatWithBob(alice);
      const secret = `plaintext-should-never-leave ${Date.now().toString(36)}`;
      await sendMessage(alice, secret);

      const token = await getSessionToken(alice);
      await clientNavigate(alice, '/chat');
      const list = await request.get('/api/chat/conversations', { headers: authHeaders(token) });
      expect(list.status()).toBe(200);
      const { conversations } = (await list.json()) as { conversations: { id: string }[] };
      expect(conversations.length).toBeGreaterThan(0);

      const messages = await request.get(
        `/api/chat/conversations/${conversations[0]!.id}/messages`,
        { headers: authHeaders(token) },
      );
      expect(messages.status()).toBe(200);
      const raw = await messages.text();
      expect(raw).not.toContain(secret);
      expect(raw).toContain('ciphertext');
    } finally {
      await aliceCtx.close();
    }
  });
});
