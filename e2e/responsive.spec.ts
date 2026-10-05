import { test, expect, type Page } from '@playwright/test';
import { loadAccounts, storageStatePath, unlockVault } from './helpers/accounts';

const book = loadAccounts();

const VIEWPORTS = [
  { name: 'desktop-1366x768', width: 1366, height: 768 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'mobile-375x812', width: 375, height: 812 },
  { name: 'mobile-390x844', width: 390, height: 844 },
];

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} must not scroll horizontally`).toBeLessThanOrEqual(2);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Public page @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('landing page renders without horizontal scrolling', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: /Start for free/ })).toBeVisible();
      await expectNoHorizontalOverflow(page, `landing ${viewport.name}`);
    });

    test('login page renders without horizontal scrolling', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      await expectNoHorizontalOverflow(page, `login ${viewport.name}`);
    });
  });

  test.describe(`Authenticated app @ ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      storageState: storageStatePath('alice'),
    });

    test('navigation works and pages do not overflow', async ({ page }) => {
      await unlockVault(page, book.alice.password);
      await expectNoHorizontalOverflow(page, `dashboard ${viewport.name}`);

      const isMobile = viewport.width < 1024;

      if (isMobile) {
        // The sidebar is off-canvas; the hamburger reveals it.
        await page.getByRole('button', { name: 'Open navigation' }).click();
      }

      const notesLink = page.getByRole('link', { name: 'Notes', exact: true });
      await expect(notesLink).toBeVisible();
      await notesLink.click();
      await page.waitForURL(/\/notes$/);
      await expectNoHorizontalOverflow(page, `notes ${viewport.name}`);

      if (viewport.width < 768) {
        // The mobile bottom navigation is always available.
        const bottomNav = page.getByRole('navigation', { name: 'Mobile primary' });
        await expect(bottomNav).toBeVisible();
        await bottomNav.getByRole('button', { name: 'Go to Chat' }).click();
        await page.waitForURL(/\/chat$/);
        await expectNoHorizontalOverflow(page, `chat ${viewport.name}`);
      }
    });
  });
}
