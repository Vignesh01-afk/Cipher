import { z } from 'zod';
import { env } from '../env';

/** Canonical form of an email address used for every lookup and storage path. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// --- Reusable primitives ---------------------------------------------------

const ivSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64 encoded');

const keyBlobSchema = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64 encoded');

const ciphertextSchema = z
  .string()
  .min(1)
  .max(2_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64 encoded');

/** Note identifier as produced by Prisma's cuid(). */
export const idParamSchema = z.string().min(1).max(64);

// --- Authentication --------------------------------------------------------

export const registerSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  displayName: z.string().trim().min(1, 'Enter a display name').max(80),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  publicKey: keyBlobSchema,
  wrappedPrivateKey: keyBlobSchema,
  privateKeyIv: ivSchema,
  kdfSalt: keyBlobSchema,
  kdfIterations: z
    .number()
    .int()
    .min(env.minKdfIterations)
    .max(env.maxKdfIterations),
  wrappedMasterKey: keyBlobSchema,
  masterKeyIv: ivSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  password: z.string().min(1, 'Enter your password').max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

// --- Password recovery ------------------------------------------------------

/**
 * Recovery key. The user's browser generates a 256-bit secret and wraps the
 * master key under it; the server only ever sees the wrapped output, the
 * derivation parameters and a salted hash for verification.
 */
export const recoveryKeySchema = z
  .string()
  .regex(/^RCVR-[A-Za-z0-9_-]{43}$/, 'Malformed recovery key');

/** POST /auth/recovery/setup - store the recovery-wrapped master key. */
export const recoverySetupSchema = z.object({
  recoveryKey: recoveryKeySchema,
  kdfSalt: keyBlobSchema,
  kdfIterations: z
    .number()
    .int()
    .min(env.minKdfIterations)
    .max(env.maxKdfIterations),
  wrappedMasterKeyRecovery: keyBlobSchema,
  masterKeyRecoveryIv: ivSchema,
  /** SHA-256(salt || raw recovery key bytes), hex - never the key itself. */
  recoveryKeyHash: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a hex SHA-256 digest'),
});

export type RecoverySetupInput = z.infer<typeof recoverySetupSchema>;

/** POST /auth/recovery/challenge - verify a recovery key without resetting. */
export const recoveryChallengeSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  recoveryKey: recoveryKeySchema,
  /** Salted hash the server compares; the raw key never crosses the wire. */
  recoveryKeyHash: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a hex SHA-256 digest'),
});

export type RecoveryChallengeInput = z.infer<typeof recoveryChallengeSchema>;

/** POST /auth/recovery/reset - the actual password reset. */
export const recoveryResetSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  recoveryKey: recoveryKeySchema,
  recoveryKeyHash: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a hex SHA-256 digest'),
  /** New bcrypt-hashed password (hashed in the browser? No - bcrypt is server-side.) */
  newPassword: z.string().min(8, 'Use at least 8 characters').max(200),
  /** Fresh KDF params for the new password KEK. */
  kdfSalt: keyBlobSchema,
  kdfIterations: z
    .number()
    .int()
    .min(env.minKdfIterations)
    .max(env.maxKdfIterations),
  /** Master key re-wrapped under the NEW password-derived KEK. */
  wrappedMasterKey: keyBlobSchema,
  masterKeyIv: ivSchema,
});

export type RecoveryResetInput = z.infer<typeof recoveryResetSchema>;

// --- Notes -----------------------------------------------------------------

export const createNoteSchema = z.object({
  ciphertext: ciphertextSchema,
  iv: ivSchema,
  encryptionVersion: z.number().int().min(1).max(100).default(1),
  algorithm: z.string().max(64).default('AES-GCM-256'),
  payloadBytes: z.number().int().min(0).max(10_000_000).default(0),
  wrappedNoteKey: keyBlobSchema,
  noteKeyIv: ivSchema,
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({
    ciphertext: ciphertextSchema.optional(),
    iv: ivSchema.optional(),
    encryptionVersion: z.number().int().min(1).max(100).optional(),
    payloadBytes: z.number().int().min(0).max(10_000_000).optional(),
    wrappedNoteKey: keyBlobSchema.optional(),
    noteKeyIv: ivSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

// --- Sharing ---------------------------------------------------------------

export const createShareSchema = z.object({
  userId: z.string().min(1).max(64),
  wrappedKey: keyBlobSchema,
});

export type CreateShareInput = z.infer<typeof createShareSchema>;

export const lookupQuerySchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
});

// --- Secure files -----------------------------------------------------------

/**
 * Filename sanitisation happens server-side (defence in depth - the client
 * sanitises too, but never trust the client):
 *  - strip every path separator and parent-directory sequence,
 *  - keep only a conservative safe set of characters,
 *  - cap the length and hide extension-based tricks.
 */
export function sanitiseFilename(raw: string): string {
  const withoutPaths = raw
    .replace(/[\\/]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  const safe = withoutPaths.replace(/[^A-Za-z0-9 .,_\-()'\[\]]/g, '_').replace(/^\.+/, '');
  const trimmed = safe.slice(0, 120).trim();
  return trimmed.length > 0 ? trimmed : 'file';
}

/** Lowercase extension without the dot, e.g. "pdf". Null when absent. */
export function extractExtension(raw: string): string | null {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(raw);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Upload payload. The ciphertext cap mirrors the storage limit; the body
 * parser ceiling is configured separately in env.ts.
 */
export const createFileSchema = z
  .object({
    noteId: z.string().min(1).max(64),
    filename: z.string().min(1).max(255),
    mimeType: z.string().max(255).regex(/^[\w.+-]+\/[\w.+-]+$/, 'Must look like a MIME type'),
    plaintextBytes: z.number().int().min(0).max(2_000_000_000),
    ciphertext: ciphertextSchema.max(48_000_000),
    /** IV of the file ciphertext itself; the key-wrap IVs are separate fields. */
    fileIv: ivSchema,
    encryptionVersion: z.number().int().min(1).max(100).default(1),
    algorithm: z.string().max(64).default('AES-GCM-256'),
    wrappedFileKey: keyBlobSchema,
    fileKeyIv: ivSchema,
    wrappedForNoteKey: keyBlobSchema,
    noteKeyWrapIv: ivSchema,
  })
  .refine(
    (value) => Math.ceil((value.ciphertext.length * 3) / 4) <= env.maxFileBytes,
    { message: 'The encrypted file is too large' },
  );

export type CreateFileInput = z.infer<typeof createFileSchema>;
