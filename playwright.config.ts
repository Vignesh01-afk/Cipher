import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for CipherNote end-to-end tests.
 *
 * Ports come from the real project config, never hardcoded guesses:
 *  - client/src/../../client/vite.config.ts  -> Vite dev server on 5173
 *  - server/src/env.ts                       -> Express API on 4000
 *  - client/vite.config.ts proxies `/api` -> http://localhost:4000
 *
 * So every test talks to ONE origin (http://localhost:5173) exactly like a
 * browser would, and `/api/*` is transparently proxied to the API.
 *
 * `webServer` runs the project's own `npm run dev` (scripts/dev.mjs), which
 * starts BOTH the API and the web client. If the stack is already running it
 * is reused instead of started twice.
 */

const CLIENT_PORT = 5173;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${CLIENT_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // The suite runs against one shared database with real (throwaway) accounts,
  // so tests must not race each other on the same resources.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Registration derives a PBKDF2 key (210k iterations) and an RSA-2048 key
  // pair in the browser, so first paint of an authenticated flow is slow.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'node scripts/dev.mjs',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
