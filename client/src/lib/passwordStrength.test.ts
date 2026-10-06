import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PASSWORD_LENGTH,
  assessPassword,
  passwordPolicyError,
} from './passwordStrength';

describe('passwordPolicyError', () => {
  test('rejects passwords shorter than the minimum', () => {
    assert.equal(passwordPolicyError('Short1!'), 'Use at least 10 characters.');
    assert.ok(passwordPolicyError('a'.repeat(MIN_PASSWORD_LENGTH - 1)) !== null);
  });

  test('rejects passwords on the breach list regardless of shape', () => {
    // Would otherwise score well: length + mixed case + digit + symbol.
    assert.match(passwordPolicyError('Password123') ?? '', /breach list/);
    assert.match(passwordPolicyError('P@ssw0rd123') ?? '', /breach list/);
    assert.match(passwordPolicyError('CipherNote') ?? '', /breach list/);
  });

  test('rejects a Weak score even when it is not a known password', () => {
    assert.match(passwordPolicyError('abcdefghij') ?? '', /too weak/);
  });

  test('accepts a long, mixed password', () => {
    assert.equal(passwordPolicyError('Str0ng!Passw0rd'), null);
  });
});

describe('assessPassword', () => {
  test('scores a strong password highly', () => {
    const result = assessPassword('Str0ng!Passw0rd');
    assert.ok(result.score >= 4);
    assert.equal(result.tone, 'emerald');
  });

  test('treats a breach-list password as Weak', () => {
    const result = assessPassword('password123');
    assert.equal(result.label, 'Weak');
    assert.equal(result.tone, 'rose');
  });

  test('normalises Unicode so visually identical passwords score the same', () => {
    const composed = 'Café!12345';
    const decomposed = 'Cafe\u0301!12345';
    assert.notEqual(composed, decomposed);
    assert.deepEqual(assessPassword(composed), assessPassword(decomposed));
    assert.equal(
      passwordPolicyError(composed) === null,
      passwordPolicyError(decomposed) === null,
    );
  });
});
