import { chromium, type FullConfig } from '@playwright/test';
import {
  buildAccounts,
  makeRunId,
  registerViaUi,
  saveAccounts,
  storageStatePath,
} from './helpers/accounts';

/**
 * Creates two throwaway accounts (Alice + Bob) through the real registration
 * UI and persists each account's browser storage (the session token) so specs
 * can start from a logged-in state without repeatedly hitting the rate-limited
 * credential endpoints.
 *
 * A fresh run id is generated every run, so runs never collide with each other
 * and no pre-existing data is touched.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';
  const book = buildAccounts(makeRunId());
  const browser = await chromium.launch();

  try {
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
