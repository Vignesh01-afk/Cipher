import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  authKeySchema,
  completeFileSchema,
  createFileSchema,
  initFileSchema,
  loginSchema,
  parsePagination,
  preloginSchema,
  recoveryChallengeSchema,
  recoveryResetSchema,
  recoverySetupSchema,
  registerSchema,
  sanitiseFilename,
  upgradeAuthSchema,
} from './schemas';

/** Canonical authKey: base64 of exactly 64 bytes (512 bits) -> 88 chars. */
const VALID_AUTH_KEY = Buffer.alloc(64, 7).toString('base64');

describe('authKeySchema', () => {
  test('accepts base64 of exactly 512 bits', () => {
    assert.equal(VALID_AUTH_KEY.length, 88);
    assert.equal(authKeySchema.safeParse(VALID_AUTH_KEY).success, true);
  });

  test('rejects the wrong key length', () => {
    const short = Buffer.alloc(32, 7).toString('base64'); // 256 bits
    assert.equal(authKeySchema.safeParse(short).success, false);
    const long = Buffer.alloc(96, 7).toString('base64');
    assert.equal(authKeySchema.safeParse(long).success, false);
  });

  test('rejects base64url, whitespace and hex', () => {
    // 0xFF bytes produce '/' in standard base64; base64url swaps it for '_'.
    const base64url = Buffer.alloc(64, 0xff).toString('base64').replace(/\//g, '_');
    assert.equal(authKeySchema.safeParse(base64url).success, false);
    assert.equal(authKeySchema.safeParse(` ${VALID_AUTH_KEY} `).success, false);
    assert.equal(authKeySchema.safeParse('a'.repeat(64)).success, false);
  });
});

describe('credential schemas (authKey XOR legacy password)', () => {
  const baseUser = {
    email: 'a@example.com',
    publicKey: 'x'.repeat(64),
    wrappedPrivateKey: 'x'.repeat(64),
    privateKeyIv: 'x'.repeat(16),
    kdfSalt: 'x'.repeat(64),
    kdfIterations: 210_000,
    wrappedMasterKey: 'x'.repeat(64),
    masterKeyIv: 'x'.repeat(16),
  };

  test('login accepts authKey only', () => {
    const parsed = loginSchema.safeParse({ email: 'a@example.com', authKey: VALID_AUTH_KEY });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.authKey, VALID_AUTH_KEY);
    assert.equal(parsed.success && parsed.data.password, undefined);
  });

  test('login accepts legacy password only', () => {
    assert.equal(loginSchema.safeParse({ email: 'a@example.com', password: 'hunter2hunter2' }).success, true);
  });

  test('login rejects both credentials and no credentials', () => {
    assert.equal(
      loginSchema.safeParse({ email: 'a@example.com', authKey: VALID_AUTH_KEY, password: 'pw' }).success,
      false,
    );
    assert.equal(loginSchema.safeParse({ email: 'a@example.com' }).success, false);
  });

  test('register accepts authKey, rejects both', () => {
    assert.equal(registerSchema.safeParse({ ...baseUser, displayName: 'A', authKey: VALID_AUTH_KEY }).success, true);
    assert.equal(
      registerSchema.safeParse({
        ...baseUser,
        displayName: 'A',
        authKey: VALID_AUTH_KEY,
        password: 'longenoughpw',
      }).success,
      false,
    );
    assert.equal(registerSchema.safeParse({ ...baseUser, displayName: 'A' }).success, false);
  });

  test('upgradeAuth requires an authKey', () => {
    assert.equal(upgradeAuthSchema.safeParse({ authKey: VALID_AUTH_KEY }).success, true);
    assert.equal(upgradeAuthSchema.safeParse({}).success, false);
  });

  test('prelogin requires an email', () => {
    assert.equal(preloginSchema.safeParse({ email: 'a@example.com' }).success, true);
    assert.equal(preloginSchema.safeParse({}).success, false);
  });
});

describe('recovery schemas never carry the raw recovery key', () => {
  const VERIFIER = 'ab'.repeat(32);

  test('setup requires the verifier and drops any raw recoveryKey field', () => {
    const parsed = recoverySetupSchema.safeParse({
      kdfSalt: 'x'.repeat(64),
      kdfIterations: 210_000,
      wrappedMasterKeyRecovery: 'x'.repeat(64),
      masterKeyRecoveryIv: 'x'.repeat(16),
      recoveryVerifier: VERIFIER,
      // Re-authentication is mandatory for recovery setup.
      authKey: VALID_AUTH_KEY,
      // A legacy client that still sends the raw key: it must not survive
      // validation (zod strips unknown keys rather than persisting them).
      recoveryKey: 'RCVR-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && 'recoveryKey' in parsed.data, false);
  });

  test('setup requires re-authentication (exactly one credential)', () => {
    const base = {
      kdfSalt: 'x'.repeat(64),
      kdfIterations: 210_000,
      wrappedMasterKeyRecovery: 'x'.repeat(64),
      masterKeyRecoveryIv: 'x'.repeat(16),
      recoveryVerifier: VERIFIER,
    };
    assert.equal(recoverySetupSchema.safeParse(base).success, false);
    assert.equal(recoverySetupSchema.safeParse({ ...base, authKey: VALID_AUTH_KEY }).success, true);
    assert.equal(recoverySetupSchema.safeParse({ ...base, password: 'current-password' }).success, true);
    assert.equal(
      recoverySetupSchema.safeParse({ ...base, authKey: VALID_AUTH_KEY, password: 'current-password' }).success,
      false,
    );
  });

  test('setup rejects a payload with only a raw recovery key', () => {
    const parsed = recoverySetupSchema.safeParse({
      kdfSalt: 'x'.repeat(64),
      kdfIterations: 210_000,
      wrappedMasterKeyRecovery: 'x'.repeat(64),
      masterKeyRecoveryIv: 'x'.repeat(16),
      recoveryKey: 'RCVR-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    assert.equal(parsed.success, false);
  });

  test('setup rejects a payload with two credentials', () => {
    const parsed = recoverySetupSchema.safeParse({
      kdfSalt: 'x'.repeat(64),
      kdfIterations: 210_000,
      wrappedMasterKeyRecovery: 'x'.repeat(64),
      masterKeyRecoveryIv: 'x'.repeat(16),
      recoveryVerifier: VERIFIER,
      authKey: VALID_AUTH_KEY,
      password: 'current-password',
    });
    assert.equal(parsed.success, false);
  });

  test('challenge requires email + verifier', () => {
    assert.equal(recoveryChallengeSchema.safeParse({ email: 'a@example.com', recoveryVerifier: VERIFIER }).success, true);
    assert.equal(recoveryChallengeSchema.safeParse({ email: 'a@example.com', recoveryKey: 'RCVR-x' }).success, false);
  });

  test('reset requires the verifier plus exactly one credential', () => {
    const base = {
      email: 'a@example.com',
      recoveryVerifier: VERIFIER,
      kdfSalt: 'x'.repeat(64),
      kdfIterations: 210_000,
      wrappedMasterKey: 'x'.repeat(64),
      masterKeyIv: 'x'.repeat(16),
    };
    assert.equal(recoveryResetSchema.safeParse({ ...base, authKey: VALID_AUTH_KEY }).success, true);
    assert.equal(recoveryResetSchema.safeParse({ ...base, newPassword: 'longenoughpw' }).success, true);
    assert.equal(
      recoveryResetSchema.safeParse({ ...base, authKey: VALID_AUTH_KEY, newPassword: 'longenoughpw' }).success,
      false,
    );
    assert.equal(recoveryResetSchema.safeParse(base).success, false);
  });

  test('a malformed verifier is rejected', () => {
    const base = {
      email: 'a@example.com',
      kdfSalt: 'x'.repeat(64),
      kdfIterations: 210_000,
      wrappedMasterKey: 'x'.repeat(64),
      masterKeyIv: 'x'.repeat(16),
      authKey: VALID_AUTH_KEY,
    };
    assert.equal(recoveryResetSchema.safeParse({ ...base, recoveryVerifier: 'not-hex' }).success, false);
    assert.equal(recoveryResetSchema.safeParse({ ...base, recoveryVerifier: 'AB'.repeat(32) }).success, false);
  });
});

describe('parsePagination', () => {
  test('defaults to 50 rows with no cursor', () => {
    assert.deepEqual(parsePagination({}), { cursor: null, limit: 50 });
  });

  test('reads a numeric limit and clamps it to 1..100', () => {
    assert.equal(parsePagination({ limit: '10' }).limit, 10);
    assert.equal(parsePagination({ limit: '0' }).limit, 1);
    assert.equal(parsePagination({ limit: '-5' }).limit, 1);
    assert.equal(parsePagination({ limit: '5000' }).limit, 100);
  });

  test('falls back to the default for a non-numeric limit', () => {
    assert.equal(parsePagination({ limit: 'abc' }).limit, 50);
    assert.equal(parsePagination({ limit: '' }).limit, 50);
  });

  test('trims a cursor and drops empty or oversized values', () => {
    assert.equal(parsePagination({ cursor: ' clx123 ' }).cursor, 'clx123');
    assert.equal(parsePagination({ cursor: '' }).cursor, null);
    assert.equal(parsePagination({ cursor: 'x'.repeat(65) }).cursor, null);
  });
});

describe('file upload schemas (single-shot vs two-step)', () => {
  const fileBase = {
    noteId: 'note1',
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    plaintextBytes: 1024,
    fileIv: Buffer.alloc(12, 1).toString('base64'),
    wrappedFileKey: 'x'.repeat(64),
    fileKeyIv: Buffer.alloc(12, 2).toString('base64'),
    wrappedForNoteKey: 'x'.repeat(64),
    noteKeyWrapIv: Buffer.alloc(12, 3).toString('base64'),
  };

  test('createFileSchema needs the ciphertext', () => {
    assert.equal(createFileSchema.safeParse(fileBase).success, false);
    assert.equal(
      createFileSchema.safeParse({ ...fileBase, ciphertext: Buffer.alloc(64, 9).toString('base64') }).success,
      true,
    );
  });

  test('initFileSchema needs the declared encrypted size instead', () => {
    assert.equal(initFileSchema.safeParse(fileBase).success, false);
    assert.equal(initFileSchema.safeParse({ ...fileBase, encryptedBytes: 4096 }).success, true);
  });

  test('initFileSchema rejects zero and out-of-range sizes', () => {
    assert.equal(initFileSchema.safeParse({ ...fileBase, encryptedBytes: 0 }).success, false);
    assert.equal(
      initFileSchema.safeParse({ ...fileBase, encryptedBytes: 26 * 1024 * 1024 }).success,
      false,
    );
  });

  test('completeFileSchema requires a file id', () => {
    assert.equal(completeFileSchema.safeParse({ fileId: 'file1' }).success, true);
    assert.equal(completeFileSchema.safeParse({}).success, false);
  });
});

describe('sanitiseFilename', () => {
  test('strips path traversal', () => {
    assert.equal(sanitiseFilename('../../etc/passwd'), 'etcpasswd');
    assert.equal(sanitiseFilename('..\\..\\windows\\system32'), 'windowssystem32');
  });

  test('keeps ordinary names and never returns empty', () => {
    assert.equal(sanitiseFilename('notes final.pdf'), 'notes final.pdf');
    assert.equal(sanitiseFilename('...'), 'file');
  });
});
