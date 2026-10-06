import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';

/**
 * Throwaway E2E accounts + session helpers.
 *
 * CipherNote is zero-knowledge: vault keys live in memory only, so EVERY full
 * page load starts in the `locked` state and asks for the password. The
 * password re-derives the KEK locally with PBKDF2 - that is a browser-only
 * operation and hits NO rate-limited endpoint. Only register/login hit the
 * credential rate limiter, so we do those once per run and reuse the stored
 * session token afterwards.
 */

export interface TestAccount {
  email: string;
  password: string;
  displayName: string;
}

export type Role = 'alice' | 'bob' | 'carol';

export interface AccountBook {
  runId: string;
  createdAt: string;
  alice: TestAccount;
  bob: TestAccount;
  carol: TestAccount;
}

export const STATE_DIR = path.resolve(process.cwd(), '.e2e-state');
const STATE_FILE = path.join(STATE_DIR, 'accounts.json');

/** Shared password for the throwaway accounts (overridable by env). */
export const PASSWORD = process.env.E2E_ACCOUNT_PASSWORD ?? 'C1pher!Note#E2E-2026';

export function makeRunId(): string {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

export function buildAccounts(runId: string): AccountBook {
  return {
    runId,
    createdAt: new Date().toISOString(),
    // Display names embed the per-run id so accounts never collide with the
    // many throwaway users left in the shared dev database by earlier runs and
    // scripts ("Browser Bob", "audit-bob User", ...). Without this, a contact
    // search for a common name can miss this run's account entirely.
    alice: {
      email: `e2e.alice.${runId}@ciphernote.test`,
      password: PASSWORD,
      displayName: `Alice E2E ${runId}`,
    },
    bob: {
      email: `e2e.bob.${runId}@ciphernote.test`,
      password: PASSWORD,
      displayName: `Bob E2E ${runId}`,
    },
    carol: {
      email: `e2e.carol.${runId}@ciphernote.test`,
      password: PASSWORD,
      displayName: `Carol E2E ${runId}`,
    },
  };
}

export function saveAccounts(book: AccountBook): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(book, null, 2));
}

export function loadAccounts(): AccountBook {
  if (!existsSync(STATE_FILE)) {
    throw new Error(`E2E accounts are missing (${STATE_FILE}). global-setup should have created them.`);
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as AccountBook;
}

/** Saved browser storage (session token) for a role, written by global-setup. */
export function storageStatePath(role: Role): string {
  return path.join(STATE_DIR, `${role}.json`);
}

/**
 * Reads a role's Bearer token straight out of its saved storageState, so
 * API-only specs (authorization / IDOR) do not need to launch a browser.
 */
export function tokenFromStorageState(role: Role): string {
  const raw = JSON.parse(readFileSync(storageStatePath(role), 'utf8')) as {
    origins?: { localStorage?: { name: string; value: string }[] }[];
  };
  for (const origin of raw.origins ?? []) {
    const entry = origin.localStorage?.find((item) => item.name === 'ciphernote.session.token');
    if (entry?.value) return entry.value;
  }
  throw new Error(`No session token found in the storage state for ${role}.`);
}

/**
 * Registers an account through the real UI.
 *
 * NOTE: CipherNote registration never returns a recovery key from the server
 * (see server/src/routes/auth.ts POST /api/auth/register), so the client only
 * lands on `/recovery-key` when a key was generated. This harness tolerates
 * both outcomes: if no key is generated the registration lands on `/dashboard`
 * directly, and we skip the recovery-key handoff.
 */
export async function registerViaUi(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(account.displayName);
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Confirm password').fill(account.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create Account' }).click();

  // Key generation + registration run in the browser, so allow generous time.
  // Registration may or may not produce a recovery key; wait for either.
  await Promise.race([
    page.waitForURL('**/recovery-key', { timeout: 60_000 }),
    page.waitForURL('**/dashboard', { timeout: 60_000 }),
  ]);
  if (page.url().includes('/recovery-key')) {
    await page.getByRole('button', { name: /I saved it/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 30_000 });
  }
}

/** Logs in through the real UI (hits the credential rate limiter). */
export async function loginViaUi(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
}

/**
 * Opens the app with a stored session and unlocks the vault with the password.
 *
 * With a saved storageState the token is present but the in-memory keys are
 * not, so the route guard sends a locked session to /unlock. Filling the
 * password there performs the local PBKDF2 derivation (no network auth call).
 */
export async function unlockVault(page: Page, password: string = PASSWORD): Promise<void> {
  // /unlock is the locked-session route; RequireLockedSession bounces an
  // already-unlocked session to /dashboard and an anonymous one to /login.
  await page.goto('/unlock');

  // If the bounce already landed us on a live app page, the vault is unlocked
  // for this session; nothing to do.
  if (page.url().startsWith('/dashboard') || page.url().startsWith('/notes') ||
      page.url().startsWith('/chat') || page.url().startsWith('/shared') ||
      page.url().startsWith('/activity') || page.url().startsWith('/privacy') ||
      page.url().startsWith('/inspector')) {
    await page.waitForURL('/**', { timeout: 15_000 });
    return;
  }

  const passwordField = page.getByLabel('Password', { exact: true });
  try {
    await passwordField.waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    // Not locked (already unlocked, or no usable session) - nothing to do.
    return;
  }

  await passwordField.fill(password);
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 }); Activities/Export/Privacy/Lock.
}

/** Reads the Bearer token the app stored for its session. */
export async function getSessionToken(page: Page): Promise<string> {
  const token = await page.evaluate(
    () =>
      localStorage.getItem('ciphernote.session.token') ??
      sessionStorage.getItem('ciphernote.session.token'),
  );
  if (!token) throw new Error('No session token found in browser storage.');
  return token;
}

/** Registers an account in its own isolated browser context. */
export async function registerInFreshContext(browser: Browser, account: TestAccount): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await registerViaUi(page, account);
  } finally {
    await context.close();
  }
}
