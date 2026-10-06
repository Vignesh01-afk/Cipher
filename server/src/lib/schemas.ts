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

// --- Split password authentication (authVersion 2) ---------------------------

/**
 * The authKey is the SECOND 256 bits of a 512-bit PBKDF2 derivation performed
 * in the browser. The FIRST 256 bits become the key-encryption-key and are
 * never sent. The server bcrypt-hashes this value instead of the password, so
 * the stored credential cannot be used to recompute the KEK (PBKDF2 is not
 * invertible from either half alone, and the KEK half never leaves the
 * browser).
 *
 * Base64 of 64 bytes is always exactly 88 characters (86 data chars + '==').
 */
export const authKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{86}==$/, 'Must be base64 encoding exactly 512 bits');

/**
 * Enforces "exactly one credential": the preferred `authKey` (v2) XOR the
 * legacy raw-password field (`password` / `newPassword`, v1). Applied after
 * zod strips unknown keys, so only fields this schema knows about count.
 */
function credentialFields<T extends { authKey?: string | undefined }>(schema: z.ZodType<T>) {
  return schema.refine(
    (value) => {
      const record = value as Record<string, unknown>;
      const provided = ['authKey', 'password', 'newPassword'].filter(
        (key) => typeof record[key] === 'string' && record[key] !== '',
      ).length;
      return provided === 1;
    },
    { message: 'Provide exactly one credential (authKey, or the legacy password field)' },
  );
}

// --- Authentication --------------------------------------------------------

export const registerSchema = credentialFields(
  z.object({
    email: z.string().email('Enter a valid email address').max(254),
    displayName: z.string().trim().min(1, 'Enter a display name').max(80),
    /** Preferred: split-derivation authKey (authVersion 2). */
    authKey: authKeySchema.optional(),
    /** Legacy clients sent the raw password (authVersion 1). */
    password: z.string().min(8, 'Use at least 8 characters').max(200).optional(),
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
    /** Raw master key for the server-side escrow wrap (OTP reset). Optional: older clients omit it. */
    masterKeyRaw: keyBlobSchema.optional(),
  }),
);

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = credentialFields(
  z.object({
    email: z.string().email('Enter a valid email address').max(254),
    /** Preferred: split-derivation authKey (authVersion 2 accounts). */
    authKey: authKeySchema.optional(),
    /** Legacy: raw password, accepted only for authVersion 1 accounts. */
    password: z.string().min(1, 'Enter your password').max(200).optional(),
  }),
);

export type LoginInput = z.infer<typeof loginSchema>;

/** POST /auth/prelogin - public KDF parameters needed to build a credential. */
export const preloginSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
});

export type PreloginInput = z.infer<typeof preloginSchema>;

/** POST /auth/upgrade-auth - v1 -> v2 migration, authenticated. */
export const upgradeAuthSchema = z.object({
  authKey: authKeySchema,
});

export type UpgradeAuthInput = z.infer<typeof upgradeAuthSchema>;

// --- Password recovery ------------------------------------------------------
/**
 * Recovery flow payloads. The raw recovery key NEVER crosses the wire: the
 * browser sends `recoveryVerifier`, an HKDF-SHA256 value computed locally
 * with the domain-separated info string "ciphernote-recovery-verifier". The
 * server stores a peppered, constant-time-compared hash of that verifier and
 * cannot recover the key (or any decryption key) from it.
 */
export const recoveryVerifierSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'Must be the hex recovery verifier');

/**
 * POST /auth/recovery/setup - store the recovery-wrapped master key.
 *
 * Re-authentication is required: generating (or rotating) a recovery key is a
 * persistent account-takeover primitive, so a stolen session token alone must
 * not be enough. The client sends the account's current credential alongside
 * the new key material and it is verified exactly as on login.
 */
export const recoverySetupSchema = credentialFields(
  z.object({
    kdfSalt: keyBlobSchema,
    kdfIterations: z
      .number()
      .int()
      .min(env.minKdfIterations)
      .max(env.maxKdfIterations),
    wrappedMasterKeyRecovery: keyBlobSchema,
    masterKeyRecoveryIv: ivSchema,
    /** HKDF verifier of the raw recovery key, hex - never the key itself. */
    recoveryVerifier: recoveryVerifierSchema,
    /** Current credential, re-verified before the new recovery key is stored. */
    authKey: authKeySchema.optional(),
    password: z.string().min(1, 'Enter your password').max(200).optional(),
  }),
);

export type RecoverySetupInput = z.infer<typeof recoverySetupSchema>;

/** POST /auth/recovery/challenge - verify a recovery key without resetting. */
export const recoveryChallengeSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  /** HKDF verifier computed in the browser; the raw key never crosses the wire. */
  recoveryVerifier: recoveryVerifierSchema,
});

export type RecoveryChallengeInput = z.infer<typeof recoveryChallengeSchema>;

/** POST /auth/recovery/reset - the actual password reset. */
export const recoveryResetSchema = credentialFields(
  z.object({
    email: z.string().email('Enter a valid email address').max(254),
    recoveryVerifier: recoveryVerifierSchema,
    /** Preferred: split-derivation authKey for the NEW password (authVersion 2). */
    authKey: authKeySchema.optional(),
    /** Legacy clients sent the raw new password (authVersion 1). */
    newPassword: z.string().min(8, 'Use at least 8 characters').max(200).optional(),
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
    /** Raw master key so the server can refresh its escrow copy. Optional for compatibility. */
    masterKeyRaw: keyBlobSchema.optional(),
  }),
);

export type RecoveryResetInput = z.infer<typeof recoveryResetSchema>;

// --- Email OTP password reset -----------------------------------------------

export const otpRequestSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
});

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{6,12}$/, 'Enter the numeric code from the email'),
});

export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

/** Completes the reset: a short-lived signed token authorises it. */
export const otpResetSchema = credentialFields(
  z.object({
    resetToken: z.string().min(10).max(1024),
    /** Preferred: split-derivation authKey for the NEW password (authVersion 2). */
    authKey: authKeySchema.optional(),
    /** Legacy clients sent the raw new password (authVersion 1). */
    newPassword: z.string().min(8, 'Use at least 8 characters').max(200).optional(),
    /** Fresh KDF params + password wrap built client-side from the recovered master key. */
    kdfSalt: keyBlobSchema,
    kdfIterations: z
      .number()
      .int()
      .min(env.minKdfIterations)
      .max(env.maxKdfIterations),
    wrappedMasterKey: keyBlobSchema,
    masterKeyIv: ivSchema,
    // wrappedPrivateKey is NOT part of this request: the private key is wrapped
    // with the master key, which the OTP flow does not change, so the stored
    // wrap remains valid.
  }),
);

export type OtpResetInput = z.infer<typeof otpResetSchema>;

// --- Google OAuth ------------------------------------------------------------

export const googleAuthSchema = z.object({
  /** Authorization code from the Google redirect (preferred). */
  code: z.string().min(10).max(2048).optional(),
  /** A Google ID token, when the client uses GIS token flow. */
  credential: z.string().min(10).max(4096).optional(),
  /** CSRF state created by GET /auth/google/url. */
  state: z.string().min(8).max(512).optional(),
});

export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

/**
 * Completing sign-up with a Google-verified identity. The signupToken is the
 * short-lived JWT the /auth/google endpoint returned; the rest matches the
 * classic register payload (all key material is generated in the browser).
 */
export const googleRegisterSchema = credentialFields(
  z.object({
    signupToken: z.string().min(20).max(2048),
    displayName: z.string().trim().min(1, 'Enter a display name').max(80),
    /** Preferred: split-derivation authKey (authVersion 2). */
    authKey: authKeySchema.optional(),
    /** Legacy clients sent the raw password (authVersion 1). */
    password: z.string().min(8, 'Use at least 8 characters').max(200).optional(),
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
    /** Raw master key for the server-side escrow wrap (OTP reset). */
    masterKeyRaw: keyBlobSchema.optional(),
  }),
);

export type GoogleRegisterInput = z.infer<typeof googleRegisterSchema>;

// --- Chat --------------------------------------------------------------------
// The server only ever sees ciphertext + wrapped key material. Ciphertext
// size limits keep abuse hard; 64 KiB covers generous messages (and the
// embedded share-card metadata) several times over.

export const chatCiphertextSchema = z
  .string()
  .min(1)
  .max(64 * 1024)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64 encoded');

/** POST /users/search - find users by @username or CN-XXXXXX cipher id. */
export const userSearchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, 'Enter at least 2 characters')
    .max(64, 'Search text is too long'),
});

export type UserSearchInput = z.infer<typeof userSearchSchema>;

/** POST /chat/conversations - start (or reuse) a 1:1 conversation. */
export const startConversationSchema = z
  .object({
    /** Recipient user id (from search). */
    recipientId: z.string().min(1).max(64).optional(),
    /** Optional note context (conversation started from a shared note). */
    contextNoteId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => Boolean(v.recipientId), { message: 'recipientId is required' });

export type StartConversationInput = z.infer<typeof startConversationSchema>;

/**
 * POST /chat/conversations/:id/messages - send one encrypted message.
 * `wrappedConversationKeys` is keyed by member user id: the sender wraps the
 * fresh per-conversation AES key with each member's public key (including
 * their own) so every member - and only members - can unwrap it.
 */
export const sendChatMessageSchema = z.object({
  ciphertext: chatCiphertextSchema,
  iv: ivSchema,
  clientId: z.string().min(8).max(64),
  payloadBytes: z.number().int().min(1).max(128 * 1024),
  /**
   * Optional: sending a message must never require a re-wrap. Wraps shipped
   * with a send are a key-rotation convenience (e.g. a member was missing a
   * copy); every member already has a wrap from conversation creation.
   */
  wrappedConversationKeys: z
    .record(z.string().min(32).max(1024))
    .refine((keys) => Object.keys(keys).length >= 1 && Object.keys(keys).length <= 16, {
      message: 'Provide between 1 and 16 wrapped conversation keys',
    })
    .optional(),
  /** Audit hint only (the payload itself is opaque): a note-share card. */
  kind: z.literal('note-share').optional(),
  /** Note referenced by a note-share card (audit metadata, never content). */
  noteId: z.string().min(1).max(64).optional(),
});

export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const paginationSchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50),
});

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
 * Fields common to both upload paths (single-shot and two-step). Everything
 * here is either metadata or opaque key material; the server can decrypt none
 * of it.
 */
const fileFields = {
  noteId: z.string().min(1).max(64),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(255).regex(/^[\w.+-]+\/[\w.+-]+$/, 'Must look like a MIME type'),
  plaintextBytes: z.number().int().min(0).max(2_000_000_000),
  /** IV of the file ciphertext itself; the key-wrap IVs are separate fields. */
  fileIv: ivSchema,
  encryptionVersion: z.number().int().min(1).max(100).default(1),
  algorithm: z.string().max(64).default('AES-GCM-256'),
  wrappedFileKey: keyBlobSchema,
  fileKeyIv: ivSchema,
  wrappedForNoteKey: keyBlobSchema,
  noteKeyWrapIv: ivSchema,
};

/**
 * Single-shot upload payload. The ciphertext cap mirrors the storage limit;
 * the body parser ceiling is configured separately in env.ts.
 */
export const createFileSchema = z
  .object({
    ...fileFields,
    ciphertext: ciphertextSchema.max(48_000_000),
  })
  .refine(
    (value) => Math.ceil((value.ciphertext.length * 3) / 4) <= env.maxFileBytes,
    { message: 'The encrypted file is too large' },
  );

export type CreateFileInput = z.infer<typeof createFileSchema>;

/**
 * POST /files/init - begins a direct (browser -> storage) upload. The size is
 * declared up front so the quota can be enforced before any bytes move; the
 * object is only registered by POST /files/complete once it actually exists.
 */
export const initFileSchema = z.object({
  ...fileFields,
  encryptedBytes: z.number().int().min(1).max(env.maxFileBytes),
});

export type InitFileInput = z.infer<typeof initFileSchema>;

/** POST /files/complete - finalises a pending direct upload. */
export const completeFileSchema = z.object({
  fileId: z.string().min(1).max(64),
});

export type CompleteFileInput = z.infer<typeof completeFileSchema>;
