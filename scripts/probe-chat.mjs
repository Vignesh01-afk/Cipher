// Probe 3: WebSocket frames + DOM mutation timeline around the Enter key send.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:4000/api';
const me = (token) => fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => ({}));
const spaNav = (page, path) =>
  page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);

const browser = await chromium.launch();
const ctxP = await browser.newContext();
const p = await ctxP.newPage();
const t0 = Date.now();
const rel = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
p.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'debug' || t === 'warning') console.log(rel(), `[console.${t}]`, m.text().slice(0, 220));
});

p.on('websocket', (ws) => {
  console.log(rel(), '[ws open]', ws.url());
  ws.on('framesent', (f) => {
    const s = typeof f.payload === 'string' ? f.payload : '';
    if (s.includes('chat:send')) console.log(rel(), '[ws SENT]', s.slice(0, 200));
  });
  ws.on('framereceived', (f) => {
    const s = typeof f.payload === 'string' ? f.payload : `<binary ${f.payload?.byteLength}>`;
    if (s === '2' || s === '3' || s === '41') return; // pings/pongs/disconnect
    console.log(rel(), '[ws RECV]', s.slice(0, 180));
  });
});

async function registerViaUi(page, name, email, password) {
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.fill('#displayName', name);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.fill('#confirmPassword', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/recovery-key', { timeout: 30000 });
  await page.click('text=I saved it - continue');
  await page.waitForURL((u) => /\/(unlock|dashboard)$/.test(new URL(u).pathname), { timeout: 20000 });
  if (page.url().includes('/unlock')) {
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 30000 });
  }
  return page.evaluate(() => localStorage.getItem('ciphernote.session.token'));
}

const stamp = Date.now();
const tokenP = await registerViaUi(p, 'Probe P3', `probe3-p-${stamp}@example.com`, 'probe-pass-123');
const ctxQ = await browser.newContext();
const q = await ctxQ.newPage();
const tokenQ = await registerViaUi(q, 'Probe Q3', `probe3-q-${stamp}@example.com`, 'probe-pass-456');
const meQ = await me(tokenQ);

// DOM mutation log on the message list.
await p.evaluate(() => {
  window.__mutations = [];
  const record = (why) => {
    const log = document.querySelector('[role="log"]');
    window.__mutations.push(`${why} :: log="${log ? log.innerText.replace(/\n/g, ' ').slice(0, 120) : '<none>'}"`);
  };
  window.__armObserver = () => {
    const target = document.querySelector('[role="log"]');
    if (!target || window.__obs) return;
    window.__obs = new MutationObserver(() => record('mutation'));
    window.__obs.observe(target, { childList: true, subtree: true, characterData: true });
  };
});

await spaNav(p, '/chat');
await p.waitForTimeout(1200);
await p.click('[aria-label="Start a new chat"]');
await p.getByPlaceholder('Search @username or CN-XXXXXX').fill(meQ.user.cipherId);
const msgBtn = p.locator('li', { hasText: 'Probe Q3' }).getByRole('button', { name: 'Message' }).first();
await msgBtn.waitFor({ timeout: 15000 });
await msgBtn.click();
await p.waitForSelector('#chat-composer', { timeout: 20000 });
await p.waitForTimeout(2000);
await p.evaluate(() => window.__armObserver());

// Sample DOM state on a timer (immune to MutationObserver quirks).
const samples = [];
const sampler = setInterval(() => {
  p.evaluate(() => {
    const log = document.querySelector('[role="log"]');
    return log ? log.innerText.replace(/\n/g, ' ').slice(0, 80) : '<no log>';
  }).then((t) => {
    if (samples[samples.length - 1] !== t) samples.push(`${rel()} ${t}`);
  }).catch(() => undefined);
}, 150);

await p.click('#chat-composer');
await p.keyboard.type('hi', { delay: 60 });
await p.waitForTimeout(400);
console.log(rel(), '>>> pressing Enter');
await p.keyboard.press('Enter');
await p.waitForTimeout(4000);
clearInterval(sampler);

console.log('\n===== DOM SAMPLES =====');
for (const s of samples) console.log(' ', s);

const timeline = await p.evaluate(() => window.__mutations);
console.log('\n===== DOM MUTATION TIMELINE =====');
for (const m of timeline) console.log(' ', m);

const sockState = await p.evaluate(() => {
  return new Promise((resolve) => {
    // Best-effort: read the socket's connection flag via a probe emit.
    resolve('see ws logs above');
  });
});
console.log('\nsocket state:', sockState);

// Ground truth: what does the server actually have stored for this conversation?
const convId = (await p.evaluate(() => localStorage.getItem('ciphernote.session.token')))
  ? await p.evaluate(async () => {
      const token = localStorage.getItem('ciphernote.session.token');
      const list = await fetch('http://localhost:4000/api/chat/conversations', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      return list.conversations?.[0]?.id ?? null;
    })
  : null;
if (convId) {
  const msgs = await fetch(`http://localhost:4000/api/chat/conversations/${convId}/messages?limit=10`, { headers: { Authorization: `Bearer ${tokenP}` } }).then((r) => r.json());
  console.log(`\n===== REST: stored messages in ${convId} =====`);
  console.log(JSON.stringify(msgs.messages?.map((m) => ({ id: m.id.slice(-6), clientId: m.clientId?.slice(0, 8), sender: m.senderId.slice(-6) })), null, 1));
}
await browser.close();
