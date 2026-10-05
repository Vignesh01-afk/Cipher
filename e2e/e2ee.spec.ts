import { test, expect, type Page } from '@playwright/test';
import { getSessionToken, loadAccounts, storageStatePath, unlockVault } from './helpers/accounts';

const book = loadAccounts();

test.use({ storageState: storageStatePath('alice') });

async function createNoteThroughUi(page: Page, title: string, content: string): Promise<void> {
  await page.getByRole('link', { name: 'Notes', exact: true }).click();
  await page.waitForURL(/\/notes$/);
  await page.getByRole('link', { name: 'Create Note' }).click();
  await page.waitForURL(/\/notes\/new$/);
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Content').fill(content);
  await page.getByRole('button', { name: /Encrypt and save/ }).click();
  await page.waitForURL(
    (url) => /^\/notes\/[^/]+$/.test(url.pathname) && url.pathname !== '/notes/new',
    { timeout: 30_000 },
  );
}

test.describe('End-to-end encryption evidence', () => {
  test('the create request carries ciphertext only, and plaintext stays in the browser', async ({
    page,
    request,
  }) => {
    const secret = `E2EE-SECRET-${Date.now().toString(36)}`;
    const title = `secret note ${secret}`;

    const consoleLines: string[] = [];
    page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

    // Capture exactly what the browser sends to the notes endpoint.
    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/api/notes', async (route) => {
      if (route.request().method() === 'POST') {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      }
      await route.continue();
    });

    await unlockVault(page, book.alice.password);
    await createNoteThroughUi(page, title, `body containing ${secret}`);

    // 1. The POST really happened, and it carried base64 ciphertext...
    expect(capturedBody).not.toBeNull();
    const body = capturedBody as unknown as Record<string, unknown>;
    expect(typeof body.ciphertext).toBe('string');
    expect(typeof body.iv).toBe('string');
    expect(typeof body.wrappedNoteKey).toBe('string');

    // 2. ...and none of the plaintext.
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain(secret);
    expect(serializedBody).not.toContain('body containing');
    expect(Object.keys(body)).not.toContain('title');
    expect(Object.keys(body)).not.toContain('content');
    expect(Object.keys(body)).not.toContain('tags');

    // 3. Nothing secret is left in browser storage.
    const storage = await page.evaluate(() =>
      Object.fromEntries(Object.entries(localStorage)) as Record<string, string>,
    );
    const serializedStorage = JSON.stringify(storage);
    expect(serializedStorage).not.toContain(secret);
    expect(Object.keys(storage)).toContain('ciphernote.session.token');
    for (const key of Object.keys(storage)) {
      expect(key).not.toMatch(/master|privateKey|noteKey|wrapped/i);
    }

    // 4. Plaintext never reaches the console.
    expect(consoleLines.join('\n')).not.toContain(secret);

    // 5. The API's own response is ciphertext, not plaintext.
    const token = await getSessionToken(page);
    const list = await request.get('/api/notes', { headers: { Authorization: `Bearer ${token}` } });
    expect(list.status()).toBe(200);
    const raw = await list.text();
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('body containing');
    expect(raw).toContain('ciphertext');
    expect(raw).toContain('wrappedNoteKey');

    // 6. The server explicitly reports that it stores no plaintext.
    const health = await request.get('/api/health');
    const healthBody = (await health.json()) as { serverStoresPlaintext: boolean };
    expect(healthBody.serverStoresPlaintext).toBe(false);
  });

  test('a single note GET exposes no plaintext fields', async ({ page, request }) => {
    const secret = `GET-SECRET-${Date.now().toString(36)}`;
    await unlockVault(page, book.alice.password);
    await createNoteThroughUi(page, `get ${secret}`, `content ${secret}`);

    const token = await getSessionToken(page);
    const list = await request.get('/api/notes', { headers: { Authorization: `Bearer ${token}` } });
    const { notes } = (await list.json()) as { notes: { id: string; ciphertext: string }[] };
    const created = notes.find((note) => note.ciphertext.length > 0);
    expect(created).toBeTruthy();

    const single = await request.get(`/api/notes/${created!.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = await single.text();
    expect(raw).not.toContain(secret);

    const parsed = JSON.parse(raw) as { note: Record<string, unknown> };
    expect(parsed.note).not.toHaveProperty('title');
    expect(parsed.note).not.toHaveProperty('content');
    expect(parsed.note).not.toHaveProperty('tags');
    expect(parsed.note).toHaveProperty('ciphertext');
    expect(parsed.note).toHaveProperty('wrappedNoteKey');
  });
});
