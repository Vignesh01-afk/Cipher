import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveKekAndAuthKey,
  deriveKeyEncryptionKey,
  fromBase64,
  recoveryVerifier,
  toBase64,
} from './crypto';

const SALT = new Uint8Array(16).fill(9);
const ITERATIONS = 100_000; // floor of the accepted range; tests only need equivalence

describe('split password derivation (authVersion 2)', () => {
  test('the KEK half is byte-identical to the legacy 256-bit derivation', async () => {
    // PBKDF2 output is block-structured: T1||T2 for 512 bits, T1 for 256
    // bits. The whole upgrade path depends on those first 32 bytes matching,
    // so already-wrapped master keys keep unlocking after the migration.
    const legacyKek = await deriveKeyEncryptionKey('correct horse battery staple', SALT, ITERATIONS);
    const { kek, authKey } = await deriveKekAndAuthKey('correct horse battery staple', SALT, ITERATIONS);

    // The legacy KEK is non-extractable, so prove equivalence through usage:
    // anything the legacy KEK encrypts must decrypt with the split KEK.
    const plaintext = new TextEncoder().encode('wrap-me');
    const iv = new Uint8Array(12).fill(3);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, legacyKek, plaintext);
    const roundTrip = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, ciphertext);
    assert.deepEqual(new Uint8Array(roundTrip), plaintext);

    // authKey: base64 of the second 32 bytes.
    assert.equal(fromBase64(authKey).length, 32);
  });

  test('derivation is deterministic for the same inputs and differs otherwise', async () => {
    const a = await deriveKekAndAuthKey('pw-one', SALT, ITERATIONS);
    const b = await deriveKekAndAuthKey('pw-one', SALT, ITERATIONS);
    const c = await deriveKekAndAuthKey('pw-two', SALT, ITERATIONS);
    const d = await deriveKekAndAuthKey('pw-one', new Uint8Array(16).fill(8), ITERATIONS);

    assert.equal(a.authKey, b.authKey);
    assert.notEqual(a.authKey, c.authKey);
    assert.notEqual(a.authKey, d.authKey);
    assert.equal(toBase64(fromBase64(a.authKey)), a.authKey);
  });
});

describe('recoveryVerifier', () => {
  const KEY = 'RCVR-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV';

  test('is deterministic, 64 hex chars', async () => {
    const v1 = await recoveryVerifier(KEY);
    const v2 = await recoveryVerifier(KEY);
    assert.equal(v1, v2);
    assert.match(v1, /^[a-f0-9]{64}$/);
  });

  test('is domain-separated: not a plain SHA-256 of the key', async () => {
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(KEY)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    assert.notEqual(await recoveryVerifier(KEY), sha256);
  });

  test('separates distinct keys and distinct key spellings', async () => {
    assert.notEqual(await recoveryVerifier(KEY), await recoveryVerifier(`${KEY}x`));
    assert.notEqual(await recoveryVerifier(KEY), await recoveryVerifier(KEY.toLowerCase()));
  });
});
