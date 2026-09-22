import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';

/**
 * Private storage for encrypted file blobs.
 *
 * DESIGN RULES
 *  - Blobs live under a directory the app controls. There is no public URL,
 *    no static hosting and no bucket policy that could expose them: the only
 *    way in is `GET /api/files/:id/content`, which authenticates the caller
 *    and re-validates note access on every request.
 *  - Storage keys are generated with the OS CSPRNG and stored on the record.
 *    User input is never part of the path, so path traversal is impossible by
 *    construction; `resolveKey` additionally verifies containment.
 *  - The blob is AES-GCM ciphertext produced in the browser. This layer could
 *    not read it even with full disk access.
 */

/** Root directory for the encrypted blobs (created lazily, never indexed). */
export function storageRoot(): string {
  return path.resolve(process.cwd(), env.fileStorageDir);
}

/**
 * Generates a fresh storage key for a new blob. Format:
 *   <random base64url 32 chars>.bin
 * The key is stored on the SecureFile record and required for every read,
 * but knowing it grants nothing without API authorisation.
 */
export function generateStorageKey(): string {
  return `${randomBytes(24).toString('base64url')}.bin`;
}

/**
 * Resolves a stored key to an absolute path inside the storage root.
 *
 * The regex rejects anything containing separators, and the `relative` check
 * is defence in depth against exotic names - a resolved path that escapes the
 * root can never be read or written.
 */
export function resolveKeyPath(storageKey: string): string {
  if (!/^[A-Za-z0-9_-]+\.bin$/.test(storageKey)) {
    throw new Error('Invalid storage key');
  }
  const resolved = path.resolve(storageRoot(), storageKey);
  const relative = path.relative(storageRoot(), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

/** Writes an encrypted blob (base64 body) to private storage. */
export async function writeBlob(storageKey: string, base64Body: string): Promise<number> {
  const target = resolveKeyPath(storageKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const buffer = Buffer.from(base64Body, 'base64');
  await fs.writeFile(target, buffer, { mode: 0o600 });
  return buffer.byteLength;
}

/** Reads an encrypted blob from private storage. Throws if it is missing. */
export async function readBlob(storageKey: string): Promise<Buffer> {
  const target = resolveKeyPath(storageKey);
  return fs.readFile(target);
}

/** Removes an encrypted blob. Missing files are tolerated (idempotent delete). */
export async function deleteBlob(storageKey: string): Promise<void> {
  try {
    await fs.unlink(resolveKeyPath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** SHA-256 of the stored blob, used for integrity notices in the audit log. */
export function blobChecksum(base64Body: string): string {
  return createHash('sha256').update(Buffer.from(base64Body, 'base64')).digest('hex');
}
