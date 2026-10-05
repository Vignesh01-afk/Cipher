import { test, expect, type Page } from '@playwright/test';
import { getSessionToken, loadAccounts, storageStatePath, unlockVault } from './helpers/accounts';
import { clientNavigate, deleteNoteViaApi } from './helpers/api';

const book = loadAccounts();

test.describe('Anonymous error handling', () => {
  test('the register form blocks mismatched passwords', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Mismatch User');
    await page.getByLabel('Email address').fill(`mismatch.${Date.now()}@ciphernote.test`);
    await page.getByLabel('Password', { exact: true }).fill('first-password-1');
    await page.getByLabel('Confirm password').fill('second-password-2');

    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeDisabled();
  });

  test('the forgot-password form refuses mismatched new passwords', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Account email').fill('someone@ciphernote.test');
    await page.getByLabel('Recovery key').fill('RCVR-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await page.getByLabel('New password', { exact: true }).fill('new-password-1');
    await page.getByLabel('Confirm new password', { exact: true }).fill('different-password-2');

    // The submit button stays disabled until the two match.
    await expect(page.getByRole('button', { name: /Reset password with recovery key/ })).toBeDisabled();
  });
});

test.describe('Authenticated error handling', () => {
  test.use({ storageState: storageStatePath('alice') });

  test('an invalid note id shows an error state, not a crash', async ({ page }) => {
    await unlockVault(page, book.alice.password);
    await clientNavigate(page, '/notes/definitely-not-a-real-note-id');

    await expect(page.getByRole('heading', { name: 'Could not open this note' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a deleted note shows an error when reopened', async ({ page, request }) => {
    await unlockVault(page, book.alice.password);

    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    await page.getByRole('link', { name: 'Create Note' }).click();
    await page.waitForURL(/\/notes\/new$/);
    await page.getByLabel('Title').fill(`Doomed ${Date.now().toString(36)}`);
    await page.getByLabel('Content').fill('will be deleted');
    await page.getByRole('button', { name: /Encrypt and save/ }).click();
    await page.waitForURL(
      (url) => /^\/notes\/[^/]+$/.test(url.pathname) && url.pathname !== '/notes/new',
      { timeout: 30_000 },
    );
    const noteId = new URL(page.url()).pathname.split('/').pop() as string;

    const token = await getSessionToken(page);
    const deleted = await deleteNoteViaApi(request, token, noteId);
    expect(deleted.status()).toBe(204);

    await clientNavigate(page, `/notes/${noteId}`);
    await expect(page.getByRole('heading', { name: 'Could not open this note' })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('a network failure on the notes API surfaces a useful error state', async ({ page }) => {
    await unlockVault(page, book.alice.password);

    await page.route('**/api/notes', (route) =>
      route.request().method() === 'GET' ? route.abort('failed') : route.continue(),
    );

    await clientNavigate(page, '/notes');
    await expect(page.getByRole('heading', { name: 'Could not load your notes' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Could not reach the CipherNote API/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
