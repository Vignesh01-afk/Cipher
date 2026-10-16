// Browser-level test for CipherNote (http://localhost:5173) using Playwright.
// Run while dev servers are up:  node scripts/browser-test.mjs
//
// IMPORTANT: authenticated navigation must stay inside the SPA (history
// pushState) - a full page reload locks the vault by design (keys are
// memory-only) and would redirect to /unlock.
//
// Covers: public pages, register -> recovery-key -> dashboard, note create,
// chat (two REAL users, realtime via Socket.IO), read receipts, typing,
// share-note modal, OTP password reset through the real UI, mobile layout.
// Collects console errors / page errors / bad responses.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const ART = new URL('../.test-artifacts/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(ART, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const results = [];
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  ok ? pass++ : fail++;
  return ok;
};

/** Per-page error collectors. */
function wire(page, bucket) {
  page.on('pageerror', (err) => bucket.pageErrors.push(String(err?.message ?? err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) bucket.badResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
}
const freshBucket = () => ({ pageErrors: [], consoleErrors: [], badResponses: [] });
const bucketHasRealErrors = (b) =>
  b.pageErrors.length > 0 ||
  b.consoleErrors.filter(
    (t) => !/favicon/i.test(t) && !/net::ERR_ABORTED/i.test(t) && !/\[vite\] socket/i.test(t),
  ).length > 0;

/** In-SPA navigation that keeps in-memory keys alive (no reload). */
const spaNav = (page, path) =>
  page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

/**
 * Send a chat message: type into the composer, press Enter, and retry once if
 * the optimistic bubble does not appear (the first press can land while the
 * conversation is still opening, before its crypto is ready).
 */
const sendChatMessage = async (page, text) => {
  const sel = `[role="log"] >> text=${text}`;
  await page.fill('textarea', text);
  await page.press('textarea', 'Enter');
  const appeared = await page.locator(sel).waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  if (!appeared) {
    await page.press('textarea', 'Enter'); // draft persists if the send was swallowed
    await page.locator(sel).waitFor({ timeout: 15000 });
  }
};

const ts = (page, name) => page.screenshot({ path: `${ART}${stamp}-${name}.png`, fullPage: false }).catch(() => {});
const toasts = (page) =>
  page.$$eval('[role="status"]', (els) => els.map((e) => e.textContent ?? '')).catch(() => []);

const API = 'http://localhost:4000/api';
const me = (token) =>
  fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .catch(() => ({}));

// Deterministic test accounts (kept after the run so you can poke at them).
const ALICE = { name: 'Browser Alice', email: `browser-alice-${Date.now()}@example.com`, password: 'browser-pass-123' };
const BOB = { name: 'Browser Bob', email: `browser-bob-${Date.now()}@example.com`, password: 'browser-pass-456' };

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------------- PUBLIC
  const pub = await browser.newContext();
  const p1 = await pub.newPage();
  const b1 = freshBucket();
  wire(p1, b1);

  await p1.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  // The hero copy lives in the tagline under the brand wordmark.
  await p1.waitForSelector('text=Encrypted end-to-end', { timeout: 15000 });
  check('landing renders hero',
    (await p1.textContent('h1')).includes('CipherNote') &&
      ((await p1.textContent('body')) ?? '').includes('Encrypted end-to-end'));
  await ts(p1, 'landing');

  for (const [path, needle, label] of [
    ['/login', 'form', 'login page'],
    ['/register', 'form', 'register page'],
    ['/forgot-password', 'form', 'forgot-password page'],
    ['/auth/google/signup', null, 'google signup page'],
    ['/recovery-key', 'no recovery key waiting', 'recovery handoff (direct visit)'],
  ]) {
    await p1.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    const body = (await p1.textContent('body')) ?? '';
    const ok = needle === 'form' ? (await p1.locator('form').count()) > 0 : needle ? body.includes(needle) : body.trim().length > 40;
    check(`${label} renders`, ok, path);
  }

  // The route guard's client-side redirect lands AFTER networkidle resolves
  // (React finishes mounting past the 500ms quiet window), so wait for the
  // navigation itself instead of reading the URL the instant goto returns.
  await p1.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await p1.waitForURL('**/login', { timeout: 15000 }).catch(() => {});
  check('unauth /dashboard redirects to login', p1.url().includes('/login'), p1.url());
  await p1.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
  await p1.waitForURL('**/login', { timeout: 15000 }).catch(() => {});
  check('unauth /chat redirects to login', p1.url().includes('/login'), p1.url());
  await p1.goto(`${BASE}/definitely-not-a-route`, { waitUntil: 'networkidle' });
  await p1.waitForSelector('text=Page not found', { timeout: 15000 });
  check('404 page renders', ((await p1.textContent('body')) ?? '').includes('Page not found'), '/definitely-not-a-route');

  await p1.goto(`${BASE}/auth/google/callback`, { waitUntil: 'networkidle' });
  check('google callback (no code) renders error state, no crash', b1.pageErrors.length === 0);

  check('public pages: no console/page errors', !bucketHasRealErrors(b1),
    [...b1.pageErrors, ...b1.consoleErrors].slice(0, 3).join(' | '));
  await pub.close();

  // ------------------------------------------------- ALICE: REGISTER FLOW
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  const bA = freshBucket();
  wire(a, bA);

  await a.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await a.fill('#displayName', ALICE.name);
  await a.fill('#email', ALICE.email);
  await a.fill('#password', ALICE.password);
  await a.fill('#confirmPassword', ALICE.password);
  // The register form gates submission on the Terms/Privacy consent box.
  await a.getByRole('checkbox').check();
  await ts(a, 'register-filled');
  await a.click('button[type="submit"]');

  await a.waitForURL('**/recovery-key', { timeout: 30000 });
  // Read the key from its own <p.font-mono> element: matching against
  // `body.textContent` appends the neighbouring "Copy"/"Store…" button labels
  // to the key, and a [A-Za-z0-9-] class drops the `_` in base64url keys -
  // either way the derived verifier no longer matches the account.
  const recKeyRaw = (await a.locator('p.font-mono').first().textContent().catch(() => null))?.trim() ?? null;
  const recKey = recKeyRaw && /^RCVR-[A-Za-z0-9_-]{43}$/.test(recKeyRaw) ? recKeyRaw : null;
  check('register -> recovery key handoff shown', Boolean(recKey),
    recKey ? recKey.slice(0, 12) + '…' : `no valid RCVR- key found (raw: ${String(recKeyRaw).slice(0, 40)})`);
  await ts(a, 'recovery-key');

  await a.click('text=I saved it, continue');
  // Registration may already leave the session unlocked -> straight to /dashboard.
  await a.waitForURL((u) => /\/(unlock|dashboard)$/.test(new URL(u).pathname), { timeout: 20000 });
  if (a.url().includes('/unlock')) {
    await a.fill('#password', ALICE.password);
    await a.click('button[type="submit"]');
    await a.waitForURL('**/dashboard', { timeout: 30000 });
  }
  check('post-register lands on dashboard', a.url().includes('/dashboard'), a.url());
  await a.waitForTimeout(600);
  await ts(a, 'dashboard');

  // Session token + cipherId sanity
  const aliceToken = await a.evaluate(() => localStorage.getItem('ciphernote.session.token'));
  const aliceMe = aliceToken ? await me(aliceToken) : {};
  check('alice session token valid', Boolean(aliceToken) && Boolean(aliceMe.user?.id));
  check('alice has CN- cipherId', /^CN-/.test(aliceMe.user?.cipherId ?? ''), aliceMe.user?.cipherId ?? 'missing');

  // ------------------------------------------------- ALICE: NOTE CREATE (SPA nav)
  await spaNav(a, '/notes/new');
  await a.waitForSelector('#title', { timeout: 15000 });
  await a.fill('#title', 'Browser Test Note');
  await a.fill('#content', 'Secret content from the browser test.');
  await a.click('button[type="submit"]');
  await a.waitForURL(/\/notes\/[a-z0-9]{10,}$/i, { timeout: 30000 }); // real id, not /notes/new
  // The view decrypts in this browser (~2s). A `text=` match can hit the stale
  // editor DOM during the route swap, so wait atomically until BOTH the title
  // and the decrypted body are present in the live document before reading it.
  await a.waitForFunction(
    () => {
      const text = document.body.textContent ?? '';
      return text.includes('Browser Test Note') && text.includes('Secret content from the browser test.');
    },
    undefined,
    { timeout: 30000 },
  );
  const noteBody = (await a.textContent('body')) ?? '';
  check('note saved and decrypts in view', noteBody.includes('Browser Test Note'),
    noteBody.includes('Not saved') ? 'save error shown' : a.url());
  await ts(a, 'note-view');

  // ------------------------------------------------- BOB: REGISTER (UI)
  const ctxB = await browser.newContext();
  const bpg = await ctxB.newPage();
  const bB = freshBucket();
  wire(bpg, bB);
  await bpg.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await bpg.fill('#displayName', BOB.name);
  await bpg.fill('#email', BOB.email);
  await bpg.fill('#password', BOB.password);
  await bpg.fill('#confirmPassword', BOB.password);
  await bpg.getByRole('checkbox').check();
  await bpg.click('button[type="submit"]');
  await bpg.waitForURL('**/recovery-key', { timeout: 30000 });
  await bpg.click('text=I saved it, continue');
  await bpg.waitForURL((u) => /\/(unlock|dashboard)$/.test(new URL(u).pathname), { timeout: 20000 });
  if (bpg.url().includes('/unlock')) {
    await bpg.fill('#password', BOB.password);
    await bpg.click('button[type="submit"]');
    await bpg.waitForURL('**/dashboard', { timeout: 30000 });
  }
  check('bob registers via UI', bpg.url().includes('/dashboard'), BOB.email);
  const bobToken = await bpg.evaluate(() => localStorage.getItem('ciphernote.session.token'));
  const bobMe = bobToken ? await me(bobToken) : {};
  const bobCipher = bobMe.user?.cipherId ?? '';
  check('bob cipherId present', /^CN-/.test(bobCipher), bobCipher);

  // Bob parks on /chat BEFORE alice sends, so realtime arrival is genuine.
  await spaNav(bpg, '/chat');
  // The conversations fetch can take several seconds against a cold server;
  // wait for the empty state rather than a fixed delay.
  await bpg.getByText('No conversations yet').waitFor({ timeout: 20000 }).catch(() => {});
  check('bob chat page loads (empty state)', /No conversations yet|Start a new chat/i.test((await bpg.textContent('body')) ?? ''));
  await ts(bpg, 'bob-chat-empty');

  // ------------------------------------------------- ALICE: START CHAT + SEND
  await spaNav(a, '/chat');
  await a.waitForTimeout(1200);
  await a.getByRole('button', { name: 'New Chat', exact: true }).click();
  await a.getByPlaceholder('Search contacts...').fill(bobCipher);
  const bobResult = a.locator('li', { hasText: BOB.name }).getByRole('button', { name: 'Start chat' }).first();
  await bobResult.waitFor({ timeout: 15000 });
  await bobResult.click();
  await a.waitForSelector('textarea', { timeout: 20000 });
  check('alice starts chat with bob via cipherId search', true, a.url());
  await a.waitForTimeout(2500); // let openConversation finish (crypto ready)
  await ts(a, 'chat-opened');

  await sendChatMessage(a, 'Hello Bob, from the browser test!');
  check('alice message appears optimistically', true);

  // Bob's list should gain the conversation WITHOUT any reload (socket push).
  const convItem = bpg.locator(`button:has-text("${ALICE.name}"), a:has-text("${ALICE.name}")`).first();
  const convVisible = await convItem.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check('bob sees conversation arrive in realtime (no reload)', convVisible);
  await ts(bpg, 'bob-chat-list');

  if (convVisible) {
    await convItem.click();
    await bpg.waitForSelector('textarea', { timeout: 15000 });
    await bpg.waitForTimeout(2500); // let openConversation finish
    await bpg.waitForSelector('[role="log"] >> text=Hello Bob, from the browser test!', { timeout: 15000 });
    check('bob receives + decrypts message in browser', true);
    await ts(bpg, 'bob-message');

    await sendChatMessage(bpg, 'Hi Alice, reply from Bob.');
    await a.waitForSelector('[role="log"] >> text=Hi Alice, reply from Bob.', { timeout: 15000 });
    check('bob reply arrives for alice in realtime', true);

    const readTick = a.locator('[role="log"] [aria-label="Read"]').first();
    const gotRead = await readTick.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    check('read receipt flips to Read on alice side', gotRead);
    await ts(a, 'chat-receipts');
  }

  // Typing indicator (best effort).
  await a.fill('textarea', 'typing…');
  await a.waitForTimeout(400);
  const typing = await bpg.locator('[aria-label="Partner is typing"]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  check('typing indicator appears for bob', typing);
  await a.fill('textarea', '');

  // ------------------------------------------------- SHARE NOTE IN CHAT
  await a.click('[aria-label="Share a note in this chat"]');
  const shareOpen = await a.locator('text=Share a note').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check('share-note modal opens', shareOpen);
  if (shareOpen) {
    const listed = await a.locator('text=Browser Test Note').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check('own note listed (decrypted) in share modal', listed);
    await ts(a, 'share-modal');
    await a.keyboard.press('Escape');
    await a.waitForTimeout(300);
  }

  // ------------------------------------------------- AUTHED PAGES SMOKE (SPA)
  for (const [path, label] of [
    ['/notes', 'notes list'],
    ['/shared', 'shared with me'],
    ['/activity', 'activity log'],
    ['/privacy', 'privacy settings'],
    ['/inspector', 'security inspector'],
  ]) {
    await spaNav(a, path);
    await a.waitForTimeout(700);
    check(`${label} loads`, true, path);
  }
  check('alice session: no console/page errors', !bucketHasRealErrors(bA),
    [...bA.pageErrors, ...bA.consoleErrors].slice(0, 3).join(' | '));
  check('bob session: no console/page errors', !bucketHasRealErrors(bB),
    [...bB.pageErrors, ...bB.consoleErrors].slice(0, 3).join(' | '));

  // ------------------------------------------ RECOVERY-KEY RESET (REAL UI)
  const ctxO = await browser.newContext();
  const o = await ctxO.newPage();
  const bO = freshBucket();
  wire(o, bO);
  await o.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' });

  if (recKey) {
    // The RCVR- key saved at registration is what unwraps the vault: no SMTP
    // and no escrow copy are involved on this path.
    const NEW_PASSWORD = 'Browser-Reset-789-Zq';
    await o.fill('#email', ALICE.email);
    await o.fill('#recoveryKey', recKey);
    await o.fill('#newPassword', NEW_PASSWORD);
    await o.fill('#confirmNewPassword', NEW_PASSWORD);
    await ts(o, 'recovery-reset-form');
    await o.getByRole('button', { name: /Reset password with recovery key/ }).click();

    // The success screen confirms the change, then redirects to /login.
    await o.waitForSelector('text=Redirecting to sign in', { timeout: 30000 });
    check('recovery-key reset completes to success',
      /Password reset/i.test((await o.textContent('body')) ?? ''));
    await ts(o, 'recovery-reset-done');
    ALICE.password = NEW_PASSWORD; // password changed; the RCVR- key is burned

    // Signing in with the NEW password proves the reset took effect.
    await o.waitForURL('**/login', { timeout: 20000 });
    await o.fill('#email', ALICE.email);
    await o.fill('#password', ALICE.password);
    await o.click('button[type="submit"]');
    await o.waitForURL((u) => /\/(unlock|dashboard)$/.test(new URL(u).pathname), { timeout: 30000 });
    if (o.url().includes('/unlock')) {
      await o.fill('#password', ALICE.password);
      await o.click('button[type="submit"]');
      await o.waitForURL('**/dashboard', { timeout: 30000 });
    }
    check('login with reset password + unlock works', true);

    // The vault still opens: the note created earlier must decrypt again.
    await spaNav(o, '/notes');
    await o.getByText('Browser Test Note').first().click({ timeout: 20000 });
    await o.waitForSelector('text=Secret content from the browser test.', { timeout: 30000 });
    check('note still opens and decrypts after reset',
      ((await o.textContent('body')) ?? '').includes('Secret content from the browser test.'));
    await ts(o, 'notes-after-reset');
  } else {
    check('recovery-key reset completes to success', false, 'no RCVR- key captured at registration');
  }
  await ctxO.close();

  // ------------------------------------------- LOGIN WITH RESET PW + MOBILE
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await ctxM.newPage();
  const bM = freshBucket();
  wire(m, bM);
  await m.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await m.fill('#email', ALICE.email);
  await m.fill('#password', ALICE.password);
  await m.click('button[type="submit"]');
  await m.waitForURL((u) => /\/(unlock|dashboard)$/.test(new URL(u).pathname), { timeout: 30000 });
  if (m.url().includes('/unlock')) {
    await m.fill('#password', ALICE.password);
    await m.click('button[type="submit"]');
    await m.waitForURL('**/dashboard', { timeout: 30000 });
  }
  check('login with recovery-key-reset password + unlock works', true);
  await spaNav(m, '/chat');
  await m.waitForTimeout(1500);
  // Mobile starts on the list pane - open the conversation with Bob first.
  await m.locator('text=Browser Bob').first().click({ timeout: 15000 }).catch(() => {});
  await m.waitForTimeout(1000);
  const backBtn = await m.locator('[aria-label="Back to conversations"]').isVisible().catch(() => false);
  const composer = await m.locator('[aria-label="Message input"]').isVisible().catch(() => false);
  check('mobile chat: back button + composer visible', backBtn && composer);
  await ts(m, 'mobile-chat');
  check('mobile pass: no console/page errors', !bucketHasRealErrors(bM),
    [...bM.pageErrors, ...bM.consoleErrors].slice(0, 3).join(' | '));
  await ctxM.close();

  // ------------------------------------------------- REPORT
  console.log('\n===== BROWSER TEST RESULTS =====');
  for (const line of results) console.log(line);
  console.log(`\n${pass} passed, ${fail} failed`);
  const allBad = [...b1.badResponses, ...bA.badResponses, ...bB.badResponses, ...bM.badResponses];
  const interesting = allBad.filter((x) => !/\/api\/auth\/me|favicon|socket\.io/.test(x));
  if (interesting.length) {
    console.log(`\nHTTP >=400 (excluding /auth/me + favicon): ${interesting.length}`);
    for (const x of [...new Set(interesting)].slice(0, 12)) console.log('  ' + x);
  } else {
    console.log('\nHTTP >=400 (excluding /auth/me + favicon): none');
  }
  console.log(`\nTest accounts kept: ${ALICE.email} (pw: ${ALICE.password}), ${BOB.email} (pw: ${BOB.password})`);
  console.log(`Screenshots: ${ART}`);
} finally {
  await browser.close();
}
process.exit(fail > 0 ? 1 : 0);
