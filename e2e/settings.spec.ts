import { test, expect, type Page } from '@playwright/test';
import { loadAccounts, storageStatePath, unlockVault } from './helpers/accounts';
import { clientNavigate } from './helpers/api';

const book = loadAccounts();

test.use({ storageState: storageStatePath('alice') });

async function currentTheme(page: Page): Promise<'dark' | 'light'> {
  return page.evaluate(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
}

test.describe('Settings and appearance', () => {
  test('the theme toggle switches the theme and it survives a full reload', async ({ page }) => {
    await unlockVault(page, book.alice.password);

    const before = await currentTheme(page);
    const storedBefore = await page.evaluate(() => localStorage.getItem('ciphernote.theme'));
    expect(['dark', 'light']).toContain(storedBefore);

    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();

    const after = await currentTheme(page);
    expect(after).not.toBe(before);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('ciphernote.theme')))
      .toBe(after);

    // A full reload re-locks the vault; the chosen theme must still apply.
    await page.goto('/dashboard');
    await page.waitForURL('**/unlock');
    expect(await currentTheme(page)).toBe(after);

    // Restore the original theme for later tests in this context.
    await page.evaluate((theme) => localStorage.setItem('ciphernote.theme', theme), before);
  });

  test('/privacy redirects into the settings privacy tab', async ({ page }) => {
    await unlockVault(page, book.alice.password);

    // /settings is the real, tabbed page now; /privacy is the legacy alias
    // that redirects into its privacy tab.
    await clientNavigate(page, '/settings');
    await page.waitForURL(/\/settings/);
    await expect(page.getByRole('heading', { name: 'Profile fields' })).toBeVisible();

    await clientNavigate(page, '/privacy');
    await page.waitForURL(/\/settings\?tab=privacy/);
    await expect(page.getByRole('switch', { name: 'Privacy Mode' })).toBeVisible();
  });

  test('privacy toggles reflect real state and persist', async ({ page }) => {
    await unlockVault(page, book.alice.password);
    await clientNavigate(page, '/privacy');

    const privacySwitch = page.getByRole('switch', { name: 'Privacy Mode' });
    // The app defaults to Privacy Mode = true; turn it off first so the
    // following assertions run against the known off state.
    await privacySwitch.click();
    await expect(privacySwitch).toHaveAttribute('aria-checked', 'false');

    // Dependent switches are disabled while Privacy Mode is off.
    const blurSwitch = page.getByRole('switch', {
      name: 'Hide content when the window loses focus',
    });
    await expect(blurSwitch).toBeDisabled();

    await privacySwitch.click();
    await expect(privacySwitch).toHaveAttribute('aria-checked', 'true');
    await expect(blurSwitch).toBeEnabled();

    // The change is persisted for the next session.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('ciphernote.privacy');
          return raw ? (JSON.parse(raw) as { privacyMode: boolean }).privacyMode : null;
        }),
      )
      .toBe(true);

    // Restore.
    await privacySwitch.click();
    await expect(privacySwitch).toHaveAttribute('aria-checked', 'false');
  });

  test('the sidebar Lock button drops the keys and asks for the password again', async ({ page }) => {
    await unlockVault(page, book.alice.password);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await page.waitForURL('**/unlock');
    await expect(page.getByRole('heading', { name: 'Your vault is locked' })).toBeVisible();
  });
});
