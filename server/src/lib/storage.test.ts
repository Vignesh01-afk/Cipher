import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Point the local driver at a scratch directory BEFORE the module is loaded -
// env.ts reads FILE_STORAGE_DIR at import time.
const scratchDir = path.join(os.tmpdir(), `ciphernote-storage-test-${process.pid}`);
process.env.FILE_STORAGE_DIR = scratchDir;

describe('storage keys', () => {
  test('generated keys contain no user input and cannot traverse', async () => {
    const { generateStorageKey } = await import('./storage');
    const key = generateStorageKey();
    assert.match(key, /^[A-Za-z0-9_-]+\.bin$/);
    assert.notEqual(generateStorageKey(), key);
  });

  test('resolveKeyPath rejects separators, traversal and odd extensions', async () => {
    const { resolveKeyPath } = await import('./storage');
    assert.throws(() => resolveKeyPath('../evil.bin'));
    assert.throws(() => resolveKeyPath('a/b.bin'));
    assert.throws(() => resolveKeyPath('a\\b.bin'));
    assert.throws(() => resolveKeyPath('evil.txt'));
    assert.throws(() => resolveKeyPath('..bin'));
  });
});

describe('local storage adapter', () => {
  test('round-trips a blob and reports its size', async () => {
    const { storageFor, generateStorageKey } = await import('./storage');
    const adapter = storageFor('local');
    const key = generateStorageKey();
    const body = Buffer.from('ciphertext-bytes');

    assert.equal(adapter.kind, 'local');
    assert.equal(adapter.supportsDirectUpload, false);
    assert.equal(await adapter.head(key), null);

    const written = await adapter.put(key, body);
    assert.equal(written, body.byteLength);
    assert.deepEqual(await adapter.head(key), { bytes: body.byteLength });
    assert.deepEqual(await adapter.get(key), body);

    await adapter.delete(key);
    assert.equal(await adapter.head(key), null);
  });

  test('delete is idempotent', async () => {
    const { storageFor, generateStorageKey } = await import('./storage');
    const adapter = storageFor('local');
    await adapter.delete(generateStorageKey());
    await adapter.delete(generateStorageKey());
  });
});

describe('supabase storage adapter', () => {
  test('advertises direct uploads without performing any I/O on construction', async () => {
    const { storageFor } = await import('./storage');
    const adapter = storageFor('supabase');
    assert.equal(adapter.kind, 'supabase');
    assert.equal(adapter.supportsDirectUpload, true);
  });
});

describe('storage cleanup', () => {
  test('removes the scratch directory', async () => {
    await fs.rm(scratchDir, { recursive: true, force: true });
  });
});
