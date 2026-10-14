import { test, expect } from '@playwright/test';
import { loadAccounts, loginViaUi, registerViaUi, storageStatePath, unlockVault } from './helpers/accounts';

const book = loadAccounts();

test.describe('Authentication', () => {
  test('register creates an account and reaches the vault', async ({ page }) => {
    const email = `e2e.register.${Date.now().toString(36)}@ciphernote.test`;

    await page.goto('/register');
    await page.getByLabel('Full name').fill('New E2E User');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('A-strong-e2e-password-1');
    await page.getByLabel('Confirm password').fill('A-strong-e2e-password-1');
    await page.getByRole('checkbox').check();

    await page.getByRole('button', { name: 'Create Account' }).click();

    // Key hierarchy is generated in the browser and the session is persisted.
    // (Registration may land on /dashboard directly; the recovery-key handoff
    // only appears when the server generated a key.)
    await Promise.race([
      page.waitForURL('**/recovery-key', { timeout: 60_000 }),
      page.waitForURL('**/dashboard', { timeout: 60_000 }),
    ]);
    if (page.url().includes('/recovery-key')) {
      await expect(page.getByRole('heading', { name: 'Save your recovery key' })).toBeVisible();
      await expect(page.getByText(/RCVR-/)).toBeVisible();
      await page.getByRole('button', { name: /I saved it/i }).click();
      await page.waitForURL('**/dashboard');
    }
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  });

  test('register rejects a duplicate email', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Duplicate Alice');
    await page.getByLabel('Email address').fill(book.alice.email);
    await page.getByLabel('Password', { exact: true }).fill('Another-e2e-password-1');
    await page.getByLabel('Confirm password').fill('Another-e2e-password-1');
    await page.getByRole('checkbox').check();

    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/register$/);
  });

  test('login succeeds with valid credentials and unlocks the vault', async ({ page }) => {
    await loginViaUi(page, book.alice);
    await expect(page).toHaveURL(/\/dashboard$/);
    // Keys are in memory, so the app reports the vault as unlocked.
    await expect(page.getByText('Vault unlocked in this tab')).toBeVisible();
  });

  test('login fails with a wrong password and shows an error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(book.alice.email);
    await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    await expect(page.getByText('Incorrect password')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('login with an unknown email is rejected', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(`nobody.${Date.now()}@ciphernote.test`);
    await page.getByLabel('Password', { exact: true }).fill('some-password-12345');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();

    await expect(page.getByText('Incorrect password')).toBeVisible({ timeout: 30_000 });
  });

  test('empty login fields keep the submit button disabled', async ({ page }) => {
    await page.goto('/login');
    const submit = page.getByRole('button', { name: 'Sign In', exact: true });
    await expect(submit).toBeDisabled();

    await page.getByLabel('Email address').fill(book.alice.email);
    await expect(submit).toBeDisabled(); // still missing a password

    await page.getByLabel('Password', { exact: true }).fill('x');
    await expect(submit).toBeEnabled();
  });

  test('protected routes redirect an anonymous visitor to /login', async ({ page }) => {
    for (const path of ['/dashboard', '/notes', '/shared', '/chat', '/privacy', '/activity']) {
      await page.goto(path);
      await page.waitForURL('**/login**');
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    }
  });

  test('logout ends the session and protected routes are blocked again', async ({ page }) => {
    // Own throwaway account, NOT the shared alice: logout bumps tokenVersion
    // server-side, which invalidates every previously issued session for that
    // user. Logging out alice here would kill her saved storage state and
    // cascade-fail every later spec that starts from it.
    const temp = {
      email: `e2e.logout.${Date.now().toString(36)}@ciphernote.test`,
      password: 'A-strong-e2e-password-1',
      displayName: `Logout E2E ${Date.now().toString(36)}`,
    };
    await registerViaUi(page, temp);
    await Promise.race([
      page.waitForURL('**/recovery-key', { timeout: 60_000 }),
      page.waitForURL('**/dashboard', { timeout: 60_000 }),
    ]);
    if (page.url().includes('/recovery-key')) {
      await page.getByRole('button', { name: /I saved it/i }).click();
      await page.waitForURL('**/dashboard');
    }
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();

    await page.waitForURL('**/login');
    const token = await page.evaluate(() => localStorage.getItem('ciphernote.session.token'));
    expect(token).toBeNull();

    await page.goto('/notes');
    await page.waitForURL('**/login**');
  });
});

test.describe('Session restore', () => {
  test.use({ storageState: storageStatePath('alice') });

  test('a page refresh keeps the session but re-locks the vault until the password is entered', async ({ page }) => {
    // Stored token + no in-memory keys -> the guard sends us to /unlock.
    await page.goto('/dashboard');
    await page.waitForURL('**/unlock');
    await expect(page.getByRole('heading', { name: 'Your vault is locked' })).toBeVisible();

    await unlockVault(page, book.alice.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Vault unlocked in this tab')).toBeVisible();
  });

  test('unlock rejects a wrong password without dropping the session', async ({ page }) => {
    await page.goto('/unlock');
    await page.getByLabel('Password', { exact: true }).waitFor({ state: 'visible' });

    await page.getByLabel('Password', { exact: true }).fill('wrong-unlock-password');
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();

    await expect(page.getByText('Unlock failed')).toBeVisible({ timeout: 30_000 });
    // The session token is still present; only the keys are missing.
    const token = await page.evaluate(() => localStorage.getItem('ciphernote.session.token'));
    expect(token).not.toBeNull();
  });
});

test.describe('Recovery-key handoff page', () => {
  test('shows a friendly fallback when there is no pending key', async ({ page }) => {
    await page.goto('/recovery-key');
    await expect(page.getByRole('heading', { name: 'Nothing to show here' })).toBeVisible();
  });
});
