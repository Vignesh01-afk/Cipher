import { existsSync } from 'node:fs';

/**
 * Resolves the Chrome/Chromium binary the headless scripts should drive.
 *
 * `CHROME_PATH` (or `CHROME_BIN`) wins, so CI and non-standard installs work;
 * otherwise the usual platform locations are probed. Every browser script
 * imports this instead of hard-coding a Windows path.
 */
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : undefined,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((candidate) => Boolean(candidate));

export function resolveChromePath() {
  const found = CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      'Could not find a Chrome/Chromium binary. Set CHROME_PATH to its absolute path.',
    );
  }
  return found;
}

/**
 * A password that satisfies the vault policy (>=10 chars, mixed case, digit,
 * symbol, not on the breach list) for scripts that register through the UI and
 * therefore hit the client-side gate.
 */
export const SCRIPT_PASSWORD = process.env.CIPHER_SCRIPT_PASSWORD ?? 'C1pher!Note#Dev-2026';
