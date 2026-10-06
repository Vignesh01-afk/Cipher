import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { burnPasswordComparison, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  test('hash/verify round-trips and rejects a different value', async () => {
    const hash = await hashPassword('Str0ng!Passw0rd');
    assert.match(hash, /^\$2[aby]\$/);
    assert.equal(await verifyPassword('Str0ng!Passw0rd', hash), true);
    assert.equal(await verifyPassword('Str0ng!Passw0rE', hash), false);
  });

  test('verifyPassword fails closed on a malformed stored hash', async () => {
    assert.equal(await verifyPassword('anything', 'not-a-bcrypt-hash'), false);
    assert.equal(await verifyPassword('anything', ''), false);
  });

  test('burnPasswordComparison resolves for any input', async () => {
    // Used when the account does not exist; it must never throw or leak.
    await burnPasswordComparison('');
    await burnPasswordComparison('a'.repeat(200));
  });
});
