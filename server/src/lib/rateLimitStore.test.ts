import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitStore, hashKeyPart } from './rateLimitStore';

describe('createRateLimitStore', () => {
  test('falls back to the in-memory store when Upstash is not configured', () => {
    // No UPSTASH_REDIS_REST_URL/TOKEN in the test environment.
    assert.equal(createRateLimitStore(), undefined);
  });
});

describe('hashKeyPart', () => {
  test('is deterministic and normalises case/whitespace', () => {
    assert.equal(hashKeyPart('User@Example.com '), hashKeyPart('user@example.com'));
    assert.notEqual(hashKeyPart('a@example.com'), hashKeyPart('b@example.com'));
  });

  test('does not leak the original value and stays short', () => {
    const email = 'someone@example.com';
    const hashed = hashKeyPart(email);
    assert.equal(hashed.includes('@'), false);
    assert.equal(hashed.includes('someone'), false);
    assert.equal(hashed.length, 32);
    assert.match(hashed, /^[a-f0-9]+$/);
  });
});
