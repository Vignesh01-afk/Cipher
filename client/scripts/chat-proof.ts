/**
 * Chat proof harness (FIX 8 / FIX 9 / FIX 10) - stand-in API via Playwright
 * route interception plus a stand-in Socket.IO server on :4000 (the client
 * connects to the server root directly in dev). No real backend needed.
 *
 * Flow: real key material is generated in Node, the vault is unlocked through
 * the real UI (local WebCrypto), one conversation with a real RSA-wrapped
 * conversation key is served, and the thread is opened.
 *
 * Checks:
 *   FIX 8 - composer boxes at 1440x900 and 390x844: attach / emoji / textarea /
 *           send all within 12px of each other in y, and textarea width >= 50%
 *           of the composer card width.
 *   FIX 9 - text under the contact name must not match /^c[a-z0-9]{20,}$/ and
 *           must not contain the conversation id or message id; contrast of
 *           the subtitle on the SELECTED row is printed and asserted >= 4.5.
 *   FIX 10 - typing event -> "Typing" count 1; partner message -> 0; 5s with
 *           no new typing event -> 0; plus typing again -> 1 and auto-clears
 *           to 0 within ~5s of quiet.
 *
 * Run:  cd client && npx tsx scripts/chat-proof.ts     (Vite dev server on 5173)
 * Exit code 1 if any expectation is missed.
 */
import { createRequire } from 'node:module';
import { chromium, type Locator } from '@playwright/test';

import { createUserKeyMaterial, generateUserKeyPair } from '../src/lib/crypto';
import { createConversationKey, encryptChatMessage, wrapConversationKeyForMembers } from '../src/lib/chatCrypto';

const BASE = process.env.PROOF_BASE_URL ?? 'http://localhost:5173';
const PASSWORD = 'Proof-vault-password-9';

const MY_ID = 'proof-user-0001';
const PEER_ID = 'proof-user-0002';
// cuid-shaped ids (>= 21 chars) so a leaked id would match the FIX 9 regex.
const CONV_ID = 'cmvbufbt9000bg07dpqqqqqqqq';
const SEED_MSG_ID = 'cmvbufbt9000bg07dpzzzzzzzz';
const LIVE_MSG_ID = 'cmvbufbt9000bg07dpyyyyyyyy';

interface Row {
  label: string;
  expected: string;
  actual: string;
}
const rows: Row[] = [];
const notes: string[] = [];

function check(label: string, expected: string, actual: string): void {
  rows.push({ label, expected, actual });
  if (expected !== actual) notes.push(`${label}: expected ${expected}, got ${actual}`);
}

function checkBool(label: string, ok: boolean, detail: string): void {
  rows.push({ label, expected: 'PASS', actual: ok ? 'PASS' : `FAIL (${detail})` });
  if (!ok) notes.push(`${label}: ${detail}`);
}

async function countVisible(loc: Locator): Promise<number> {
  const total = await loc.count();
  let visible = 0;
  for (let i = 0; i < total; i += 1) {
    const el = loc.nth(i);
    const box = await el.boundingBox();
    if (!box) continue;
    const display = await el.evaluate((node) => getComputedStyle(node).display);
    if (display !== 'none') visible += 1;
  }
  return visible;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * WCAG contrast between the element's text color and its EFFECTIVE background.
 * The in-browser step only collects the background layers from the element up
 * to the first opaque ancestor (no nested functions inside evaluate:
 * esbuild's __name helper is unavailable there). Compositing (including
 * oklab() layers that Chromium reports) and the ratio run on the Node side.
 */
async function contrastOf(loc: Locator): Promise<{ ratio: number; color: string; bg: string }> {
  const { color, layers } = await loc.evaluate((node) => {
    const collected: string[] = [];
    let cur: HTMLElement | null = node;
    while (cur && collected.length < 12) {
      const value = getComputedStyle(cur).backgroundColor;
      collected.push(value);
      const parts = value.replace(/rgba?\(|\)/g, '').split(/[,/]/);
      const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
      if (alpha === 1) break;
      cur = cur.parentElement;
    }
    return { color: getComputedStyle(node).color, layers: collected };
  });

  interface RGBA { r: number; g: number; b: number; a: number }
  const parse = (value: string): RGBA => {
    if (value.startsWith('oklab')) {
      const nums = value.slice(value.indexOf('(') + 1, value.indexOf(')')).split(/[\s/]+/).map(Number);
      const [L, a, b] = [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
      const alpha = nums.length > 3 && !Number.isNaN(nums[3]) ? nums[3] : 1;
      const l2 = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m2 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s2 = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      const rr = 4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2;
      const gg = -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2;
      const bb = -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2;
      const clamp01 = (v: number): number => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));
      return { r: clamp01(rr) * 255, g: clamp01(gg) * 255, b: clamp01(bb) * 255, a: alpha };
    }
    const nums = value.replace(/rgba?\(|\)/g, '').split(',').map((p) => parseFloat(p.trim()));
    return { r: nums[0] ?? 0, g: nums[1] ?? 0, b: nums[2] ?? 0, a: nums.length > 3 && !Number.isNaN(nums[3]) ? nums[3] : 1 };
  };
  const composite = (top: RGBA, bottom: RGBA): RGBA => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const lum = (rgb: RGBA): number => {
    const chan = (c: number): number => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
  };

  // Bottom-up: start from the last (opaque) layer, composite the ones above it.
  const parsed = layers.map(parse);
  let effective = parsed[parsed.length - 1] ?? { r: 0, g: 0, b: 0, a: 1 };
  for (let i = parsed.length - 2; i >= 0; i -= 1) effective = composite(parsed[i], effective);
  const text = parse(color);
  const l1 = lum(text);
  const l2 = lum(effective);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const round = (v: number): string => String(Math.round(v));
  const bgLabel = `rgb(${round(effective.r)}, ${round(effective.g)}, ${round(effective.b)}) [layers: ${layers.join(' over ')}]`;
  return { ratio: Math.round(ratio * 100) / 100, color, bg: bgLabel };
}

async function main(): Promise<void> {
  // --- stand-in Socket.IO server on :4000 -----------------------------------
  const nodeRequire = createRequire(import.meta.url);
  const { Server } = nodeRequire('../../server/node_modules/socket.io') as {
    Server: new (
      port: number,
      opts: unknown,
    ) => {
      on(event: string, cb: (socket: unknown) => void): void;
      emit(event: string, payload: unknown): void;
      close(): void;
    };
  };
  const io = new Server(4000, { cors: { origin: '*' }, transports: ['websocket', 'polling'] });
  let socketConnected = false;
  io.on('connection', () => {
    socketConnected = true;
  });

  // --- real crypto material (used by the app, never edited) -----------------
  const { material } = await createUserKeyMaterial(PASSWORD);
  const peerKeys = await generateUserKeyPair();
  const conv = await createConversationKey();
  const wraps = await wrapConversationKeyForMembers(conv.conversationKeyRaw, {
    [MY_ID]: material.publicKey,
    [PEER_ID]: peerKeys.publicKeySpki,
  });

  const now = Date.now();
  const lastActivityIso = new Date(now - 5 * 60_000).toISOString();
  const createdIso = new Date(now - 24 * 60 * 60_000).toISOString();

  const peerUser = {
    id: PEER_ID,
    displayName: 'Proof Partner',
    cipherId: 'CN-PROOF02',
    username: 'prooffriend',
    publicKey: peerKeys.publicKeySpki,
  };
  const standInUser = {
    id: MY_ID,
    email: 'proof@example.test',
    displayName: 'Proof User',
    createdAt: createdIso,
    cipherId: 'CN-PROOF01',
    username: null,
    ...material,
  };

  const seedEnv = await encryptChatMessage(conv.key, {
    v: 1,
    type: 'text',
    text: 'Hello from the stand-in partner',
  });
  const seedMessage = {
    id: SEED_MSG_ID,
    conversationId: CONV_ID,
    senderId: PEER_ID,
    ciphertext: seedEnv.ciphertext,
    iv: seedEnv.iv,
    algorithm: 'AES-GCM-256',
    encryptionVersion: 1,
    payloadBytes: seedEnv.payloadBytes,
    clientId: SEED_MSG_ID,
    deliveredAt: null,
    readAt: null,
    createdAt: lastActivityIso,
  };

  const conversationDto = {
    id: CONV_ID,
    contextNoteId: null,
    createdAt: createdIso,
    updatedAt: lastActivityIso,
    lastReadAt: createdIso,
    wrappedConversationKey: wraps[MY_ID],
    keyAlgorithm: 'RSA-OAEP-2048-SHA256',
    participants: [
      { id: MY_ID, displayName: standInUser.displayName, cipherId: standInUser.cipherId, username: null },
      { id: PEER_ID, displayName: peerUser.displayName, cipherId: peerUser.cipherId, username: peerUser.username },
    ],
    lastMessage: {
      id: SEED_MSG_ID,
      senderId: PEER_ID,
      createdAt: lastActivityIso,
      readAt: null,
      deliveredAt: null,
      hasPayload: true,
    },
    unreadCount: 0,
  };

  const conversationDetail = {
    id: CONV_ID,
    contextNoteId: null,
    createdAt: createdIso,
    members: [
      {
        user: { id: MY_ID, displayName: standInUser.displayName, cipherId: standInUser.cipherId, username: null },
        wrappedConversationKey: wraps[MY_ID],
        keyAlgorithm: 'RSA-OAEP-2048-SHA256',
        lastReadAt: createdIso,
      },
      {
        user: { id: PEER_ID, displayName: peerUser.displayName, cipherId: peerUser.cipherId, username: peerUser.username },
        wrappedConversationKey: wraps[PEER_ID],
        keyAlgorithm: 'RSA-OAEP-2048-SHA256',
        lastReadAt: null,
      },
    ],
  };

  // --- browser + stand-in API ----------------------------------------------
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ciphernote.session.token', 'proof-session-token');
    } catch {
      /* storage unavailable */
    }
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160));
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 160)}`));

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    let payload: unknown;
    if (url.pathname.endsWith('/auth/me')) {
      payload = { user: standInUser };
    } else if (url.pathname.endsWith('/chat/users/search')) {
      payload = { users: [peerUser] };
    } else if (url.pathname.endsWith('/messages')) {
      payload = method === 'POST' ? { message: seedMessage } : { messages: [seedMessage], nextCursor: null };
    } else if (url.pathname.endsWith('/read') || url.pathname.endsWith('/hide')) {
      payload = {};
    } else if (url.pathname.endsWith('/chat/conversations')) {
      payload = { conversations: [conversationDto] };
    } else if (/\/chat\/conversations\/[^/]+$/.test(url.pathname)) {
      payload = { conversation: conversationDetail };
    } else if (method === 'GET') {
      if (/\/notes$/.test(url.pathname)) payload = { notes: [], nextCursor: null };
      else if (url.pathname.includes('/shared')) payload = { shares: [], nextCursor: null };
      else if (url.pathname.includes('/audit')) payload = [];
      else payload = {};
    } else {
      payload = {};
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  // --- unlock through the real UI ------------------------------------------
  await page.goto(`${BASE}/unlock`, { waitUntil: 'load', timeout: 45_000 });
  const pwField = page.getByLabel('Password', { exact: true });
  await pwField.waitFor({ state: 'visible', timeout: 30_000 });
  await pwField.fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });

  // SPA navigation to /chat (a reload would drop the in-memory keys).
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, '/chat');

  const convBtn = page
    .locator('button')
    .filter({ has: page.locator('p.text-ink') })
    .filter({ hasText: 'Proof Partner' })
    .first();
  await convBtn.waitFor({ state: 'visible', timeout: 20_000 });
  const subtitle = convBtn.locator('p.text-xs');

  // --- FIX 9: subtitle text under the contact name --------------------------
  const subtitleText = ((await subtitle.textContent()) ?? '').trim();
  const btnText = ((await convBtn.textContent()) ?? '').trim();
  const idLike = /^c[a-z0-9]{20,}$/.test(subtitleText);
  console.log(`\n[FIX 9] subtitle under contact name = ${JSON.stringify(subtitleText)}`);
  console.log(`[FIX 9] conversation id contains: ${btnText.includes(CONV_ID)} | message id contains: ${btnText.includes(SEED_MSG_ID)}`);
  // The required assertion, plus a stricter id-FRAGMENT check: the buggy code
  // slices the message id to 18 chars, which is below the 21-char regex
  // minimum, so an 16+ char id fragment also counts as "showing an id".
  const idFragment = /^c[a-z0-9]{16,}$/.test(subtitleText);
  check('FIX 9 subtitle not id-like (/^c[a-z0-9]{20,}$/)', 'false', String(idLike));
  check('FIX 9 subtitle not an id fragment (/^c[a-z0-9]{16,}$/)', 'false', String(idFragment));
  checkBool('FIX 9 list row never shows conversation id', !btnText.includes(CONV_ID), `row text: ${JSON.stringify(btnText)}`);
  checkBool('FIX 9 list row never shows message id', !btnText.includes(SEED_MSG_ID), `row text: ${JSON.stringify(btnText)}`);
  checkBool('FIX 9 subtitle non-empty', subtitleText.length > 0, 'subtitle is empty');

  // --- open the conversation ------------------------------------------------
  await convBtn.click();
  const textarea = page.locator('textarea[aria-label="Message input"]');
  await textarea.waitFor({ state: 'visible', timeout: 15_000 });
  // Placeholder flips once the wrapped conversation key has been unwrapped.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('textarea[aria-label="Message input"]') as HTMLTextAreaElement | null;
        return !!el && el.placeholder === 'Type a message...';
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => notes.push('FIX 8 conversation key did not unlock (placeholder never became "Type a message...")'));
  await page.getByText('Hello from the stand-in partner').waitFor({ state: 'visible', timeout: 15_000 });

  // FIX 9 continued: contrast of the subtitle on the SELECTED row.
  const selectedRow = convBtn;
  const rowClass = await selectedRow.getAttribute('class');
  const selBg = await selectedRow.evaluate((node) => getComputedStyle(node).backgroundColor);
  const contrast = await contrastOf(subtitle);
  console.log(`[FIX 9] selected row classes = ${rowClass}`);
  console.log(`[FIX 9] selected row bg = ${selBg}; subtitle color = ${contrast.color}; contrast = ${contrast.ratio}:1 (expect >= 4.5)`);
  checkBool('FIX 9 subtitle readable on selected row (contrast >= 4.5)', contrast.ratio >= 4.5, `contrast ${contrast.ratio}:1`);

  // --- FIX 8: composer geometry --------------------------------------------
  const attach = page.locator('button[aria-label="Attach file"]');
  const emoji = page.locator('button[aria-label="Emoji"]');
  const send = page.locator('button[aria-label="Send message"]');
  const composerCard = page.locator('div.card', { has: page.locator('button[aria-label="Send message"]') }).last();

  async function fix8(vp: string): Promise<void> {
    const boxAttach = await attach.boundingBox();
    const boxEmoji = await emoji.boundingBox();
    const boxTextarea = await textarea.boundingBox();
    const boxSend = await send.boundingBox();
    const cardBox = await composerCard.boundingBox();
    const shape = (b: { x: number; y: number; width: number; height: number } | null): string =>
      b ? `x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} w=${b.width.toFixed(1)} h=${b.height.toFixed(1)}` : 'NOT VISIBLE';
    console.log(`\n[FIX 8 ${vp}]`);
    console.log(`  attach button : ${shape(boxAttach)}`);
    console.log(`  emoji button  : ${shape(boxEmoji)}`);
    console.log(`  textarea      : ${shape(boxTextarea)}`);
    console.log(`  send button   : ${shape(boxSend)}`);
    // Diagnostics: display/flex-direction of the composer's ancestor chain.
    const chain = await textarea.evaluate((node) => {
      const out: string[] = [];
      let el: HTMLElement | null = node.parentElement;
      for (let i = 0; el && i < 3; i += 1, el = el.parentElement) {
        const cs = getComputedStyle(el);
        out.push(`${el.tagName.toLowerCase()}.[${el.className.toString().slice(0, 60)}] display=${cs.display} flex-direction=${cs.flexDirection}`);
      }
      return out;
    });
    for (const line of chain) console.log(`  ancestor: ${line}`);

    if (!boxAttach || !boxEmoji || !boxTextarea || !boxSend || !cardBox) {
      checkBool(`FIX 8 ${vp} all four composer controls visible`, false, 'missing bounding box');
      return;
    }
    const tops = [boxAttach.y, boxEmoji.y, boxTextarea.y, boxSend.y];
    const spread = Math.max(...tops) - Math.min(...tops);
    console.log(`  y-spread across the four controls = ${spread.toFixed(1)}px (expect <= 12)`);
    console.log(`  textarea width = ${boxTextarea.width.toFixed(1)}px; composer card width = ${cardBox.width.toFixed(1)}px (expect textarea >= 50%)`);
    checkBool(`FIX 8 ${vp} controls share one row (y-spread <= 12px)`, spread <= 12, `y-spread ${spread.toFixed(1)}px`);
    checkBool(`FIX 8 ${vp} textarea >= 50% of composer width`, boxTextarea.width >= 0.5 * cardBox.width, `${boxTextarea.width.toFixed(1)}px of ${cardBox.width.toFixed(1)}px`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  await fix8('1440x900');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await fix8('390x844');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  // --- FIX 10: typing indicator lifecycle -----------------------------------
  for (let i = 0; i < 30 && !socketConnected; i += 1) await sleep(200);
  checkBool('FIX 10 socket connected to stand-in server', socketConnected, 'socket never connected to :4000');

  const typingLoc = page.locator('[aria-label="Partner is typing"]');

  io.emit('chat:typing', { conversationId: CONV_ID, userId: PEER_ID, typing: true });
  await typingLoc.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
  const typingBefore = await countVisible(typingLoc);
  console.log(`\n[FIX 10] Typing elements after typing event            = ${typingBefore} (expect 1)`);

  const liveEnv = await encryptChatMessage(conv.key, { v: 1, type: 'text', text: 'Live partner message' });
  const liveIso = new Date().toISOString();
  io.emit('chat:message', {
    id: LIVE_MSG_ID,
    conversationId: CONV_ID,
    senderId: PEER_ID,
    ciphertext: liveEnv.ciphertext,
    iv: liveEnv.iv,
    algorithm: 'AES-GCM-256',
    encryptionVersion: 1,
    payloadBytes: liveEnv.payloadBytes,
    clientId: LIVE_MSG_ID,
    deliveredAt: null,
    readAt: null,
    createdAt: liveIso,
  });
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Partner is typing"]') === null,
    undefined,
    { timeout: 8000 },
  ).catch(() => undefined);
  const typingAfter = await countVisible(typingLoc);
  console.log(`[FIX 10] Typing elements after partner message        = ${typingAfter} (expect 0)`);

  await page.waitForTimeout(5000);
  const typingAfter5 = await countVisible(typingLoc);
  console.log(`[FIX 10] Typing elements after 5s with no typing evt  = ${typingAfter5} (expect 0)`);

  // Auto-clear: a typing event with no follow-up must vanish after ~4s.
  io.emit('chat:typing', { conversationId: CONV_ID, userId: PEER_ID, typing: true });
  await typingLoc.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
  const typingAgain = await countVisible(typingLoc);
  await page.waitForTimeout(5000);
  const typingIdle = await countVisible(typingLoc);
  console.log(`[FIX 10] Typing elements, second event                 = ${typingAgain} (expect 1)`);
  console.log(`[FIX 10] Typing elements after 5s quiet (auto-clear)   = ${typingIdle} (expect 0)`);

  check('FIX 10 Typing count after typing event', '1', String(typingBefore));
  check('FIX 10 Typing count after partner message', '0', String(typingAfter));
  check('FIX 10 Typing count 5s after message', '0', String(typingAfter5));
  check('FIX 10 Typing count on second typing event', '1', String(typingAgain));
  check('FIX 10 Typing auto-clears after idle', '0', String(typingIdle));

  if (consoleErrors.length > 0) {
    console.log(`\nconsole errors (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 10)) console.log(`  - ${e}`);
  }

  await context.close();
  await browser.close();
  io.close();

  console.log('\n===== EXPECTED vs ACTUAL =====');
  for (const r of rows) {
    const ok = r.expected === r.actual ? 'OK  ' : 'FAIL';
    console.log(`${ok} ${r.label.padEnd(52)} expected=${r.expected} actual=${r.actual}`);
  }
  if (notes.length > 0) {
    console.log('\nProblems:');
    for (const n of notes) console.log(`  - ${n}`);
    process.exit(1);
  }
  console.log('\nALL EXPECTATIONS MET.');
  process.exit(0);
}

main().catch((err) => {
  console.error('chat-proof crashed:', err);
  process.exit(2);
});
