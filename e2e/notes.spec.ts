import { test, expect, type Page } from '@playwright/test';
import { getSessionToken, loadAccounts, storageStatePath, unlockVault } from './helpers/accounts';

const book = loadAccounts();

test.use({ storageState: storageStatePath('alice') });

/**
 * IMPORTANT: CipherNote keeps vault keys in memory only, so any full page load
 * (page.goto) re-locks the vault. Every step after the initial unlock therefore
 * uses CLIENT-SIDE navigation (clicking the app's own links/buttons).
 */
async function unlockAndGoToNotes(page: Page): Promise<void> {
  await unlockVault(page, book.alice.password);
  // Wait for the Notes link in the sidebar to be visible and enabled.
  await page.getByRole('link', { name: 'Notes', exact: true }).first().waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click();
  await page.waitForURL(/\/notes$/);
}

async function backToNotes(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Notes', exact: true }).first().waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await page.getByRole('link', { name: 'Notes', exact: true }).first().click();
  await page.waitForURL(/\/notes$/);
}

async function startNewNote(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Create Note' }).click();
  await page.waitForURL(/\/notes\/new$/);
}

/** Waits for a real note VIEW route - `/notes/new` must not count as one. */
async function waitForNoteView(page: Page): Promise<string> {
  await page.waitForURL(
    (url) => /^\/notes\/[^/]+$/.test(url.pathname) && url.pathname !== '/notes/new',
    { timeout: 30_000 },
  );
  return new URL(page.url()).pathname.split('/').pop() as string;
}

async function fillAndSave(page: Page, title: string, content: string): Promise<string> {
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Content').fill(content);
  await page.getByRole('button', { name: /Encrypt and save/ }).click();
  return waitForNoteView(page);
}

async function deleteFromList(page: Page, title: string): Promise<void> {
  const search = page.getByPlaceholder(/Search title, content and tags/);
  await search.fill(title);
  const card = page.locator('article').filter({ hasText: title }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.locator('article').filter({ hasText: title })).toHaveCount(0, { timeout: 20_000 });
}

test.describe('Note lifecycle', () => {
  test('create -> read -> edit -> search -> delete', async ({ page, request }) => {
    await unlockAndGoToNotes(page);
    const stamp = Date.now().toString(36);
    const title = `Lifecycle note ${stamp}`;

    // --- Create ---------------------------------------------------------
    await startNewNote(page);
    const noteId = await fillAndSave(page, title, 'first revision body');
    expect(noteId).toBeTruthy();

    // --- Read (decrypted locally) --------------------------------------
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('first revision body')).toBeVisible();
    await expect(page.getByText('Owned by you')).toBeVisible();

    // --- Edit -----------------------------------------------------------
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.waitForURL(/\/notes\/[^/]+\/edit$/);
    // The editor decrypts the existing ciphertext into the form first.
    await expect(page.getByLabel('Content')).toHaveValue('first revision body');
    await page.getByLabel('Content').fill('second revision body');
    await page.getByRole('button', { name: /Re-encrypt and save/ }).click();
    await waitForNoteView(page);
    await expect(page.getByText('second revision body')).toBeVisible();
    await expect(page.getByText('first revision body')).toHaveCount(0);

    // --- Search (local, over decrypted content) -------------------------
    await backToNotes(page);
    const search = page.getByPlaceholder(/Search title, content and tags/);
    await search.fill(title);
    await expect(page.locator('article').filter({ hasText: title })).toHaveCount(1);

    await search.fill('second revision');
    await expect(page.locator('article').filter({ hasText: title })).toHaveCount(1);

    await search.fill('no-such-note-content-xyz');
    await expect(page.getByText('No notes match that search')).toBeVisible();

    // --- Delete ---------------------------------------------------------
    await deleteFromList(page, title);

    // The API agrees the note is really gone.
    const token = await getSessionToken(page);
    const response = await request.get(`/api/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(404);
  });

  test('refuses to save a completely empty note', async ({ page }) => {
    await unlockAndGoToNotes(page);
    await startNewNote(page);
    await page.getByRole('button', { name: /Encrypt and save/ }).click();

    await expect(page.getByText('Add a title or some content before saving.')).toBeVisible();
    await expect(page).toHaveURL(/\/notes\/new$/);
  });

  test('preserves unicode, emojis and newlines through encryption', async ({ page }) => {
    await unlockAndGoToNotes(page);
    const title = `Unicode ${Date.now().toString(36)}`;
    const content = 'Line one 你好 🔐\nLine two with emoji 🚀🎉\n\tTabbed and "quotes"';

    await startNewNote(page);
    await fillAndSave(page, title, content);

    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.locator('article').getByText('Line one 你好 🔐')).toBeVisible();
    await expect(page.locator('article').getByText('Tabbed and "quotes"')).toBeVisible();

    await backToNotes(page);
    await deleteFromList(page, title);
  });

  test('handles a very long note body', async ({ page }) => {
    await unlockAndGoToNotes(page);
    const title = `Long ${Date.now().toString(36)}`;
    const content = Array.from({ length: 250 }, (_, i) => `Paragraph ${i} - ${'x'.repeat(60)}`).join('\n');

    await startNewNote(page);
    await fillAndSave(page, title, content);

    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.locator('article').getByText('Paragraph 249', { exact: false })).toBeVisible();

    await backToNotes(page);
    await deleteFromList(page, title);
  });

  test('lists multiple notes and filters down to one', async ({ page }) => {
    await unlockAndGoToNotes(page);
    const stamp = Date.now().toString(36);
    const first = `Multi A ${stamp}`;
    const second = `Multi B ${stamp}`;

    await startNewNote(page);
    await fillAndSave(page, first, 'alpha body');
    await backToNotes(page);
    await startNewNote(page);
    await fillAndSave(page, second, 'beta body');

    await backToNotes(page);
    await expect(page.locator('article').filter({ hasText: first })).toHaveCount(1);
    await expect(page.locator('article').filter({ hasText: second })).toHaveCount(1);

    await page.getByPlaceholder(/Search title, content and tags/).fill(second);
    await expect(page.locator('article').filter({ hasText: first })).toHaveCount(0);
    await expect(page.locator('article').filter({ hasText: second })).toHaveCount(1);

    await deleteFromList(page, first);
    await deleteFromList(page, second);
  });
});
