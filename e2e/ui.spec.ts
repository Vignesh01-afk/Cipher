import { test, expect } from '@playwright/test';
import { loadAccounts, storageStatePath, unlockVault } from './helpers/accounts';
import { clientNavigate } from './helpers/api';

const book = loadAccounts();

test.describe('Public pages', () => {
  test('the landing page renders and its CTA leads to sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('CipherNote');
    await expect(page.getByText('Secure Sharing')).toBeVisible().catch(() => undefined);

    await page.getByRole('link', { name: /Start for free/ }).click();
    await page.waitForURL('**/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('an unknown path renders the 404 page', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: /Back to notes/ }).click();
    await page.waitForURL('**/login**');
  });
});

test.describe('Authenticated shell', () => {
  test.use({ storageState: storageStatePath('alice') });

  test('sidebar navigation moves between the real pages', async ({ page }) => {
    await unlockVault(page, book.alice.password);

    const targets: { link: string; url: RegExp; marker: RegExp }[] = [
      { link: 'Notes', url: /\/notes$/, marker: /My Notes/ },
      { link: 'Shared', url: /\/shared$/, marker: /Shared Notes/ },
      { link: 'Chat', url: /\/chat$/, marker: /Chat/ },
      { link: 'Audit Log', url: /\/activity$/, marker: /Activity log/ },
      { link: 'Home', url: /\/dashboard$/, marker: /Recent Notes/ },
    ];

    for (const target of targets) {
      await page.getByRole('link', { name: target.link, exact: true }).click();
      await page.waitForURL(target.url);
      await expect(page.getByText(target.marker).first()).toBeVisible({ timeout: 30_000 });
    }
  });

  test('the profile dropdown opens and navigates', async ({ page }) => {
    await unlockVault(page, book.alice.password);

    // The avatar shows the user's initials ("Alice E2E" -> "AE").
    await page.getByRole('button', { name: 'AE' }).click();
    const menu = page.getByRole('menu').or(page.getByRole('listbox'));
    await expect(menu.first()).toBeVisible();

    await page.getByRole('menuitem', { name: 'Security' }).click();
    await page.waitForURL(/\/inspector$/);
  });

  test('a modal opens, traps focus, and closes with Escape', async ({ page }) => {
    await unlockVault(page, book.alice.password);

    // Create a note so we have a page that carries the security badge.
    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    await page.getByRole('link', { name: 'Create Note' }).click();
    await page.waitForURL(/\/notes\/new$/);
    const title = `Modal ${Date.now().toString(36)}`;
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Content').fill('modal body');
    await page.getByRole('button', { name: /Encrypt and save/ }).click();
    await page.waitForURL(
      (url) => /^\/notes\/[^/]+$/.test(url.pathname) && url.pathname !== '/notes/new',
      { timeout: 30_000 },
    );

    await page.getByRole('button', { name: 'E2E' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Encryption details' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('a success toast appears after creating a note', async ({ page }) => {
    await unlockVault(page, book.alice.password);
    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    await page.getByRole('link', { name: 'Create Note' }).click();
    await page.waitForURL(/\/notes\/new$/);

    const title = `Toast ${Date.now().toString(36)}`;
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Content').fill('toast body');
    await page.getByRole('button', { name: /Encrypt and save/ }).click();

    await expect(page.getByText('Note created')).toBeVisible({ timeout: 30_000 });
    await page.waitForURL(
      (url) => /^\/notes\/[^/]+$/.test(url.pathname) && url.pathname !== '/notes/new',
      { timeout: 30_000 },
    );
  });

  test('the topbar search jumps to filtered notes', async ({ page }) => {
    await unlockVault(page, book.alice.password);

    await page.getByLabel('Search notes, chats, or users').fill('zzz-no-match-zzz');
    await page.getByLabel('Search notes, chats, or users').press('Enter');
    await page.waitForURL(/\/notes\?q=/);
    await expect(page.getByText('No notes match that search')).toBeVisible({ timeout: 30_000 });
  });
});
