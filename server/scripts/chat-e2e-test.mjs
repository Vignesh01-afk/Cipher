// E2E chat verification: two users with real RSA keypairs, conversation key
// wrap/unwrap, AES-GCM message round-trip, receipts, search, blocks.
// Run while the dev API is up:  node server/scripts/chat-e2e-test.mjs
import { createHash, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const API = 'http://localhost:4000/api';
const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  return ok;
};

const b64 = (n) => randomBytes(n).toString('base64');
const post = async (path, body, token) => {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const get = async (path, token) => {
  const res = await fetch(API + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const del = async (path, token) => {
  const res = await fetch(API + path, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

/** Registers a user with a REAL RSA-OAEP keypair so wraps round-trip for real. */
async function registerUser(handle) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const publicKeyB64 = Buffer.from(publicKey, 'utf8').toString('base64');
  const email = `${handle}-${Date.now()}@example.com`;
  const reg = await post('/auth/register', {
    email,
    displayName: handle,
    password: 'test-password-123',
    publicKey: publicKeyB64,
    wrappedPrivateKey: b64(48),
    privateKeyIv: b64(12),
    kdfSalt: b64(16),
    kdfIterations: 100000,
    wrappedMasterKey: b64(48),
    masterKeyIv: b64(12),
    masterKeyRaw: b64(32),
  });
  if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.json)}`);
  return { token: reg.json.token, userId: reg.json.user.id, email, cipherId: reg.json.user.cipherId, privateKeyPem: privateKey, publicKeyB64 };
}

function wrapForRecipient(publicKeyB64, conversationKeyRaw) {
  const pem = Buffer.from(publicKeyB64, 'base64').toString('utf8');
  // node needs the PEM body; the stored value is base64(spki-pem) in tests
  const wrapped = publicEncrypt({ key: pem, padding: 1 /* RSA_PKCS1_OAEP_PADDING? no - see below */ }, Buffer.from(conversationKeyRaw, 'base64'));
  return wrapped.toString('base64');
}

try {
  // 1. Register two users with real keypairs.
  const alice = await registerUser('chat-alice');
  const bob = await registerUser('chat-bob');
  check('register alice+bob', true, `${alice.userId.slice(0, 8)} / ${bob.userId.slice(0, 8)}`);

  // 2. User search finds bob by his public cipher handle.
  check('register response carries cipherId', Boolean(bob.cipherId), bob.cipherId ?? 'missing');
  const search = await get(`/chat/users/search?q=${encodeURIComponent(bob.cipherId)}`, alice.token);
  const bobHit = search.json.users?.find((u) => u.id === bob.userId);
  check('user search by handle', search.status === 200 && Boolean(bobHit), `found=${Boolean(bobHit)}`);

  // 3. Real AES-GCM conversation key, wrapped to both public keys.
  const convKeyRaw = randomBytes(32).toString('base64');
  const keyBuf = Buffer.from(convKeyRaw, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv);
  const plaintext = Buffer.from(JSON.stringify({ v: 1, type: 'text', text: 'Hello Bob, encrypted in transit.' }));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([ct, tag]).toString('base64');

  // NOTE: the app uses WebCrypto RSA-OAEP with SHA-256. Node default OAEP hash
  // is SHA-1, so set it explicitly.
  function wrapKey(publicKeyB64) {
    const pem = Buffer.from(publicKeyB64, 'base64').toString('utf8');
    return publicEncrypt(
      { key: pem, padding: 1, oaepHash: 'sha256' },
      keyBuf,
    ).toString('base64');
  }
  const wrappedKeys = {
    [alice.userId]: wrapKey(alice.publicKeyB64),
    [bob.userId]: wrapKey(bob.publicKeyB64),
  };

  const start = await post('/chat/conversations', { recipientId: bob.userId, wrappedKeys }, alice.token);
  check('start conversation', start.status === 201 && Boolean(start.json.conversation?.id), JSON.stringify(start.json).slice(0, 80));

  const conversationId = start.json.conversation.id;

  // 4. Bob sees the conversation in his list.
  const bobList = await get('/chat/conversations', bob.token);
  check('conversation visible to peer', bobList.status === 200 && bobList.json.conversations?.some((c) => c.id === conversationId));

  // 5. Alice sends the encrypted message (REST path).
  const send = await post(
    `/chat/conversations/${conversationId}/messages`,
    {
      ciphertext,
      iv: iv.toString('base64'),
      clientId: randomBytes(16).toString('hex'),
      payloadBytes: plaintext.byteLength,
      wrappedConversationKeys: wrappedKeys,
    },
    alice.token,
  );
  check('send encrypted message', send.status === 201, `status=${send.status}`);

  // 6. Bob fetches and DECRYPTS it for real with his private key.
  const msgs = await get(`/chat/conversations/${conversationId}/messages?limit=10`, bob.token);
  const msg = msgs.json.messages?.[0];
  let decryptedText = null;
  if (msg) {
    const myWrap = wrappedKeys[bob.userId];
    const pem = Buffer.from(bob.publicKeyB64, 'base64').toString('utf8');
    // Bob unwraps with his PRIVATE key:
    const unwrapped = privateDecrypt(
      { key: bob.privateKeyPem, padding: 1, oaepHash: 'sha256' },
      Buffer.from(myWrap, 'base64'),
    );
    const d = createDecipheriv('aes-256-gcm', unwrapped, Buffer.from(msg.iv, 'base64'));
    const raw = Buffer.from(msg.ciphertext, 'base64');
    d.setAuthTag(raw.subarray(raw.length - 16));
    const out = Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]);
    decryptedText = JSON.parse(out.toString()).text;
  }
  check('recipient decrypts (real crypto)', decryptedText === 'Hello Bob, encrypted in transit.', decryptedText ?? 'no message');

  // 7. Membership authorization: a third user cannot read the conversation.
  const eve = await registerUser('chat-eve');
  const eveRead = await get(`/chat/conversations/${conversationId}/messages`, eve.token);
  check('non-member rejected', eveRead.status === 403, `status=${eveRead.status}`);

  // 8. Block enforcement: bob blocks alice; her send fails.
  await post('/chat/blocks', { userId: alice.userId }, bob.token);
  const blockedSend = await post(
    `/chat/conversations/${conversationId}/messages`,
    {
      ciphertext,
      iv: iv.toString('base64'),
      clientId: randomBytes(16).toString('hex'),
      payloadBytes: plaintext.byteLength,
      wrappedConversationKeys: wrappedKeys,
    },
    alice.token,
  );
  check('blocked sender rejected', blockedSend.status === 403, `status=${blockedSend.status}`);
  await del(`/chat/blocks/${alice.userId}`, bob.token);

  // 9. Read receipts endpoint.
  const read = await post(`/chat/conversations/${conversationId}/read`, {}, bob.token);
  check('mark read', read.status === 200);

  // 10. Ciphertext at rest: the DB must not contain the plaintext.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const stored = await prisma.encryptedMessage.findFirst({ where: { conversationId } });
  const plaintextLeak = stored?.ciphertext?.includes('Hello Bob');
  check('no plaintext at rest', Boolean(stored) && !plaintextLeak, `rows checked=1`);
  await prisma.$disconnect();

  // 11. Cleanup: delete conversation for both + delete test users.
  await del(`/chat/conversations/${conversationId}`, alice.token);
  await del(`/chat/conversations/${conversationId}`, bob.token);
  const p2 = new PrismaClient();
  const deleted = await p2.user.deleteMany({ where: { email: { endsWith: '@example.com' }, displayName: { in: ['chat-alice', 'chat-bob', 'chat-eve'] } } });
  await p2.$disconnect();
  check('cleanup', deleted.count >= 3, `deleted=${deleted.count}`);
} catch (err) {
  results.push(`FAIL  unexpected: ${err.message}`);
} finally {
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
