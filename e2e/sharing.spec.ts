import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getSessionToken, loadAccounts, storageStatePath, unlockVault } from './helpers/accounts';
import {
  clientNavigate,
  createNoteViaApi,
  getNoteViaApi,
  listSharesViaApi,
  listSharedWithMeViaApi,
  lookupUserId,
  revokeShareViaApi,
  shareNoteViaApi,
  updateNoteViaApi,
} from './helpers/api';

const book = loadAccounts();

/** Opens a role's saved session and unlocks the vault. */
async function openUser(
  browser: Browser,
  role: 'alice' | 'bob',
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  const page = await context.newPage();
  await unlockVault(page, book[role].password);
  return { context, page };
}

async function waitForNoteView(page: Page): Promise<string> {
  await page.waitForURL(
    (url) => /^\/notes\/[^/]+$/.test(url.pathname) && url.pathname !== '/notes/new',
    { timeout: 30_000 },
  );
  return new URL(page.url()).pathname.split('/').pop() as string;
}

/** Creates a note through the real editor so it is genuinely decryptable. */
async function createNoteThroughUi(page: Page, title: string, content: string): Promise<string> {
  await page.getByRole('link', { name: 'Notes', exact: true }).click();
  await page.waitForURL(/\/notes$/);
  await page.getByRole('link', { name: 'Create Note' }).click();
  await page.waitForURL(/\/notes\/new$/);
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Content').fill(content);
  await page.getByRole('button', { name: /Encrypt and save/ }).click();
  return waitForNoteView(page);
}

/** Navigates client-side, remounting the target route (no full reload). */
async function goTo(page: Page, path: string): Promise<void> {
  await clientNavigate(page, '/dashboard');
  await clientNavigate(page, path);
}

/** Counts the active shares on a note via the API (owner token required). */
async function activeShareCount(
  request: Parameters<typeof listSharesViaApi>[0],
  token: string,
  noteId: string,
): Promise<number> {
  const response = await listSharesViaApi(request, token, noteId);
  if (response.status() !== 200) return -1;
  const body = (await response.json()) as { shares: { isActive: boolean }[] };
  return body.shares.filter((share) => share.isActive).length;
}

test.describe('Sharing and revocation', () => {
  test('Alice shares with Bob in the UI, Bob reads it, Alice revokes, Bob is denied', async ({
    browser,
    request,
  }) => {
    const { context: aliceCtx, page: alice } = await openUser(browser, 'alice');
    const { context: bobCtx, page: bob } = await openUser(browser, 'bob');

    try {
      const stamp = Date.now().toString(36);
      const title = `Shared secret ${stamp}`;
      const noteId = await createNoteThroughUi(
        alice,
        title,
        'contents only Bob should see after sharing',
      );
      const aliceToken = await getSessionToken(alice);
      const bobToken = await getSessionToken(bob);

      // --- Before sharing: Bob is denied, at the API and in the UI --------
      expect((await getNoteViaApi(request, bobToken, noteId)).status()).toBe(403);
      await goTo(bob, '/shared');
      await expect(bob.locator('article').filter({ hasText: title })).toHaveCount(0);
      await expect(bob.getByText('Nothing has been shared with you yet')).toBeVisible();

      // --- Alice shares through the real Share dialog --------------------
      await alice.getByRole('button', { name: 'Share' }).click();
      const dialog = alice.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByPlaceholder('recipient@example.com').fill(book.bob.email);
      await dialog.getByRole('button', { name: 'Look up' }).click();

      // The lookup candidate row shows Bob and offers the grant button.
      const grantButton = dialog.getByRole('button', { name: /Encrypt key & share/ });
      await expect(grantButton).toBeVisible();
      await grantButton.click();

      // The candidate row disappears once the grant completes, and Bob moves
      // into "People with access". (The DB is remote, so allow real latency.)
      await expect(grantButton).toBeHidden({ timeout: 30_000 });
      await expect(dialog.getByText(book.bob.email)).toBeVisible();
      await expect
        .poll(() => activeShareCount(request, aliceToken, noteId), { timeout: 30_000 })
        .toBe(1);

      await alice.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // --- Bob can now open and decrypt the shared note ------------------
      await goTo(bob, '/shared');
      const bobCard = bob.locator('article').filter({ hasText: title });
      await expect(bobCard).toHaveCount(1, { timeout: 30_000 });
      await bobCard.getByRole('button', { name: 'Open' }).click();
      await bob.waitForURL(new RegExp(`/notes/${noteId}$`));
      await expect(bob.getByText('contents only Bob should see after sharing')).toBeVisible();
      await expect(bob.getByText('Shared with you')).toBeVisible();

      // A recipient gets no Edit / Share / Delete controls.
      await expect(bob.getByRole('link', { name: 'Edit' })).toHaveCount(0);
      await expect(bob.getByRole('button', { name: 'Delete' })).toHaveCount(0);

      // API: recipient may read, and may not write.
      const asRecipient = await getNoteViaApi(request, bobToken, noteId);
      expect(asRecipient.status()).toBe(200);
      expect(((await asRecipient.json()) as { note: { role: string } }).note.role).toBe('recipient');
      expect((await updateNoteViaApi(request, bobToken, noteId)).status()).toBe(403);

      // --- Alice revokes through the UI ----------------------------------
      await alice.getByRole('button', { name: 'Share' }).click();
      const dialog2 = alice.getByRole('dialog');
      await expect(dialog2.getByText(book.bob.email)).toBeVisible();
      await dialog2.getByRole('button', { name: 'Revoke' }).click();
      await alice.getByRole('button', { name: 'Revoke access', exact: true }).click();

      // The dialog now shows the share as revoked.
      await expect(dialog2.getByText('Revoked', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => activeShareCount(request, aliceToken, noteId), { timeout: 30_000 })
        .toBe(0);
      await alice.keyboard.press('Escape');
      await expect(dialog2).toBeHidden();

      // --- Bob loses access immediately, API and UI ----------------------
      expect((await getNoteViaApi(request, bobToken, noteId)).status()).toBe(403);
      const sharedNow = await listSharedWithMeViaApi(request, bobToken);
      const ids = ((await sharedNow.json()) as { shares: { noteId: string }[] }).shares.map(
        (s) => s.noteId,
      );
      expect(ids).not.toContain(noteId);

      await goTo(bob, '/shared');
      await expect(bob.locator('article').filter({ hasText: title })).toHaveCount(0, {
        timeout: 30_000,
      });
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test("Bob cannot open Alice's private note by URL (UI shows access denied)", async ({
    browser,
    request,
  }) => {
    const { context: aliceCtx, page: alice } = await openUser(browser, 'alice');
    const { context: bobCtx, page: bob } = await openUser(browser, 'bob');

    try {
      const aliceToken = await getSessionToken(alice);
      const bobToken = await getSessionToken(bob);
      const noteId = await createNoteViaApi(request, aliceToken);

      expect((await getNoteViaApi(request, bobToken, noteId)).status()).toBe(403);

      await clientNavigate(bob, `/notes/${noteId}`);
      await expect(bob.getByRole('heading', { name: 'Access denied' })).toBeVisible({ timeout: 30_000 });
      await expect(bob.getByText(/If the owner revoked your access/)).toBeVisible();
    } finally {
      await aliceCtx.close();
      await bobCtx.close();
    }
  });

  test('"Shared by me" lists the active share and clears it after revocation', async ({
    browser,
    request,
  }) => {
    const { context: aliceCtx, page: alice } = await openUser(browser, 'alice');

    try {
      const title = `By-me ${Date.now().toString(36)}`;
      const noteId = await createNoteThroughUi(alice, title, 'shared-by-me body');
      const aliceToken = await getSessionToken(alice);
      const bobId = await lookupUserId(request, aliceToken, book.bob.email);

      const granted = await shareNoteViaApi(request, aliceToken, noteId, bobId);
      expect(granted.status()).toBe(201);

      await goTo(alice, '/shared');
      await alice.getByRole('button', { name: /Shared by me/ }).click();
      await expect(alice.getByText(book.bob.displayName).first()).toBeVisible({
        timeout: 30_000,
      });

      // Revoke through the table, which is the page's own revoke flow.
      await alice.getByRole('button', { name: 'Revoke' }).first().click();
      await alice.getByRole('button', { name: 'Revoke access', exact: true }).click();
      await expect
        .poll(() => activeShareCount(request, aliceToken, noteId), { timeout: 30_000 })
        .toBe(0);
      await expect(alice.getByText(book.bob.displayName)).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await aliceCtx.close();
    }
  });
});
