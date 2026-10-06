import { chromium, type FullConfig } from '@playwright/test';
import {
  buildAccounts,
  makeRunId,
  registerViaUi,
  saveAccounts,
  storageStatePath,
} from './helpers/accounts';

/**
 * Returns true when the API answered and the database responded within the
 * window. `ok` alone proves nothing about the database, so this relies on the
 * `dbOk` field /api/health now reports after probing Postgres. The 8 s timeout
 * keeps a dead database from hanging the suite.
 */
export async function apiIsHealthy(baseURL: string): Promise<{ ok: boolean; dbOk: boolean; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, dbOk: false, error: `health -> HTTP ${res.status}` };

    const body = (await res.json()) as { ok?: boolean; dbOk?: boolean };
    return { ok: true, dbOk: Boolean(body.dbOk) };
  } catch (err) {
    return { ok: false, dbOk: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Creates two throwaway accounts (Alice + Bob) through the real registration
 * UI and persists each account's browser storage (the session token) so specs
 * can start from a logged-in state without repeatedly hitting the rate-limited
 * credential endpoints.
 *
 * A fresh run id is generated every run, so runs never collide with each other
 * and no pre-existing data is touched.
 *
 * NOTE: if Neon is unreachable the API still boots (health:ok) but every
 * DB-backed route throws, so we fail fast here instead of hanging the whole
 * suite on a 60s waitForURL. See server/src/db.ts for the connection-retry
 * policy.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';
  const book = buildAccounts(makeRunId());
  const browser = await chromium.launch();

  try {
    const health = await apiIsHealthy(baseURL);
    if (!health.ok) {
      throw new Error(
        `E2E pre-flight failed (API not healthy): ${health.error}. ` +
        'Is the dev server running? (node scripts/dev.mjs)'
      );
    }
    if (!health.dbOk) {
      throw new Error(
        `E2E pre-flight failed (database unreachable): ` +
        'Neon Postgres could not be reached. The dev API still answers (health ok), ' +
        'but every DB-backed route (register/login/notes) returns 500. ' +
        'Start the database, e.g. pg_connect for Neon, or check the pooler is up.'
      );
    }

    for (const role of ['alice', 'bob', 'carol'] as const) {
      const context = await browser.newContext({ baseURL });
      try {
        const page = await context.newPage();
        await registerViaUi(page, book[role]);
        // Registration persists the session token to localStorage; capture it.
        await context.storageState({ path: storageStatePath(role) });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  saveAccounts(book);
}
