/**
 * CipherNote client-side cryptography.
 *
 * EVERYTHING in this module runs in the browser. Nothing here is sent to the
 * server except the opaque blobs it produces.
 *
 * Primitives (all from the platform Web Crypto API - no hand-rolled crypto):
 *   - PBKDF2-SHA256         : password  -> key-encryption-key (KEK)
 *   - AES-GCM-256           : note payload encryption, key wrapping
 *   - RSA-OAEP-2048/SHA-256 : wrapping a note key for a specific recipient
 *
 * Key hierarchy
 * -------------
 *   password --PBKDF2(salt, iterations)--> KEK        (never leaves memory)
 *   KEK      --AES-GCM--------------------> Master Key (wrapped, stored server-side)
 *   Master Key --AES-GCM------------------> Note Key   (wrapped per note, stored server-side)
 *   Note Key --AES-GCM--------------------> Note payload {title, content, tags}
 *
 *   Note Key --RSA-OAEP(recipient public key)--> per-recipient wrapped key
 *
 * The server holds only wrapped keys and ciphertext, so it cannot decrypt a
 * note even if its database is fully compromised.
 */

const AES_KEY_BITS = 256;
const PBKDF2_HASH = 'SHA-256';
const GCM_IV_BYTES = 12; // 96-bit nonce, the recommended size for AES-GCM
const SALT_BYTES = 16;
const RSA_MODULUS_BITS = 2048;

/** Bump when the payload/format changes; stored per note for forward evolution. */
export const ENCRYPTION_VERSION = 1;
export const NOTE_ALGORITHM = 'AES-GCM-256';
export const SHARE_KEY_ALGORITHM = 'RSA-OAEP-2048-SHA256';
export const MASTER_KEY_WRAP_ALGORITHM = 'AES-GCM-256';
export const KDF_ALGORITHM = 'PBKDF2-SHA256';

/**
 * OWASP-aligned PBKDF2 iteration count. Stored per user so accounts created
 * with an older cost can be migrated on next login.
 */
export const DEFAULT_KDF_ITERATIONS = 210_000;

// --- Binary / base64 helpers ----------------------------------------------

/**
 * Returns a plain ArrayBuffer view of the given bytes. Passing the underlying
 * buffer directly to Web Crypto keeps TypeScript happy across lib versions and
 * avoids handing over a buffer that is larger than the view.
 */
function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + CHUNK)));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Best-effort scrubbing of sensitive byte arrays. JS cannot guarantee this. */
export function wipe(bytes: Uint8Array | null | undefined): void {
  if (bytes) bytes.fill(0);
}

// --- Symmetric primitives --------------------------------------------------

/** Derives the password-based key-encryption-key. Non-extractable by design. */
export async function deriveKeyEncryptionKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', ab(textEncoder.encode(password)), 'PBKDF2', false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: ab(salt), iterations, hash: PBKDF2_HASH },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function generateAesKey(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const raw = randomBytes(AES_KEY_BITS / 8);
  const key = await importAesKey(raw, true);
  return { key, raw };
}

export async function importAesKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ab(raw), { name: 'AES-GCM' }, extractable, [
    'encrypt',
    'decrypt',
  ]);
}

/** Exports a note key's raw bytes so it can be re-wrapped for a recipient. */
export async function exportAesKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ iv: string; ciphertext: string }> {
  // A fresh random nonce per encryption operation - never reused.
  const iv = randomBytes(GCM_IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ab(iv) },
    key,
    ab(plaintext),
  );
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decryptBytes(
  key: CryptoKey,
  ciphertextBase64: string,
  ivBase64: string,
): Promise<Uint8Array> {
  // AES-GCM authenticates as it decrypts: a tampered ciphertext, IV or a wrong
  // key makes this throw rather than returning corrupted plaintext.
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ab(fromBase64(ivBase64)) },
    key,
    ab(fromBase64(ciphertextBase64)),
  );
  return new Uint8Array(plaintext);
}

/**
 * Decrypts raw ciphertext bytes with a base64 IV. Used for file downloads,
 * where the server streams back the stored binary blob directly.
 */
export async function decryptRawBytes(
  key: CryptoKey,
  ciphertext: Uint8Array,
  ivBase64: string,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ab(fromBase64(ivBase64)) },
    key,
    ab(ciphertext),
  );
  return new Uint8Array(plaintext);
}

// --- Asymmetric primitives -------------------------------------------------

export interface GeneratedUserKeyPair {
  publicKeySpki: string;
  privateKeyPkcs8: Uint8Array;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function generateUserKeyPair(): Promise<GeneratedUserKeyPair> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: RSA_MODULUS_BITS,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: PBKDF2_HASH,
    },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair;

  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);

  return {
    publicKeySpki: toBase64(spki),
    privateKeyPkcs8: new Uint8Array(pkcs8),
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
  };
}

export async function importRecipientPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', ab(fromBase64(spkiBase64)), { name: 'RSA-OAEP', hash: PBKDF2_HASH }, true, [
    'encrypt',
  ]);
}

export async function importPrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', ab(pkcs8), { name: 'RSA-OAEP', hash: PBKDF2_HASH }, false, [
    'decrypt',
  ]);
}

/**
 * Wraps a note key for one recipient. RSA-OAEP with a 2048-bit modulus and
 * SHA-256 can carry 190 bytes, easily enough for a 32-byte AES key.
 */
export async function wrapNoteKeyForRecipient(
  recipientPublicKey: CryptoKey,
  noteKeyRaw: Uint8Array,
): Promise<string> {
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublicKey, ab(noteKeyRaw));
  return toBase64(wrapped);
}

/** Unwraps a note key with the recipient's private key (recipient side only). */
export async function unwrapNoteKeyFromOwner(
  privateKey: CryptoKey,
  wrappedKeyBase64: string,
): Promise<Uint8Array> {
  const raw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    ab(fromBase64(wrappedKeyBase64)),
  );
  return new Uint8Array(raw);
}

// --- Note payloads ---------------------------------------------------------

export interface NotePayload {
  title: string;
  content: string;
  tags: string[];
}

/**
 * The payload is stored as versioned JSON so the format can evolve without
 * breaking already-encrypted notes.
 */
export async function encryptNotePayload(
  noteKey: CryptoKey,
  payload: NotePayload,
): Promise<{ iv: string; ciphertext: string; payloadBytes: number }> {
  const serialised = textEncoder.encode(
    JSON.stringify({ v: ENCRYPTION_VERSION, ...payload }),
  );
  const { iv, ciphertext } = await encryptBytes(noteKey, serialised);
  return { iv, ciphertext, payloadBytes: serialised.byteLength };
}

export async function decryptNotePayload(
  noteKey: CryptoKey,
  ciphertextBase64: string,
  ivBase64: string,
): Promise<NotePayload> {
  const bytes = await decryptBytes(noteKey, ciphertextBase64, ivBase64);
  const parsed = JSON.parse(textDecoder.decode(bytes)) as Partial<NotePayload> & { v?: number };

  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    content: typeof parsed.content === 'string' ? parsed.content : '',
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  };
}

// --- Key material lifecycle ------------------------------------------------

/** Exactly what the server is allowed to know about a user's keys. */
export interface UserKeyMaterial {
  publicKey: string;
  wrappedPrivateKey: string;
  privateKeyIv: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKey: string;
  masterKeyIv: string;
}

/** Keys held in memory for the current session. Never persisted anywhere. */
export interface CryptoSession {
  masterKey: CryptoKey;
  privateKey: CryptoKey;
}

/**
 * Registration: generates the whole key hierarchy from the user's password.
 * The returned material is safe to send to the server; the returned session
 * stays in memory only.
 */
export async function createUserKeyMaterial(
  password: string,
): Promise<{ material: UserKeyMaterial; session: CryptoSession }> {
  const salt = randomBytes(SALT_BYTES);
  const iterations = DEFAULT_KDF_ITERATIONS;

  const kek = await deriveKeyEncryptionKey(password, salt, iterations);

  const { key: masterKey, raw: masterKeyRaw } = await generateAesKey();
  const wrappedMaster = await encryptBytes(kek, masterKeyRaw);
  wipe(masterKeyRaw);

  const { publicKeySpki, privateKeyPkcs8, privateKey } = await generateUserKeyPair();
  const wrappedPrivate = await encryptBytes(masterKey, privateKeyPkcs8);
  wipe(privateKeyPkcs8);

  return {
    material: {
      publicKey: publicKeySpki,
      wrappedPrivateKey: wrappedPrivate.ciphertext,
      privateKeyIv: wrappedPrivate.iv,
      kdfSalt: toBase64(salt),
      kdfIterations: iterations,
      wrappedMasterKey: wrappedMaster.ciphertext,
      masterKeyIv: wrappedMaster.iv,
    },
    session: { masterKey, privateKey },
  };
}

export class KeyUnlockError extends Error {
  constructor(message = 'Unable to unlock your encryption keys with that password.') {
    super(message);
    this.name = 'KeyUnlockError';
  }
}

/**
 * Login / unlock: re-derives the KEK from the password and unwraps the master
 * key and private key that the server has been holding (encrypted) for us.
 *
 * The server never learns the password-derived key, so a wrong password fails
 * here rather than on the server.
 */
export async function unlockUserKeyMaterial(
  password: string,
  material: UserKeyMaterial,
): Promise<CryptoSession> {
  const kek = await deriveKeyEncryptionKey(password, fromBase64(material.kdfSalt), material.kdfIterations);

  let masterKeyRaw: Uint8Array;
  try {
    masterKeyRaw = await decryptBytes(kek, material.wrappedMasterKey, material.masterKeyIv);
  } catch {
    throw new KeyUnlockError();
  }

  const masterKey = await importAesKey(masterKeyRaw, false);
  wipe(masterKeyRaw);

  let privateKeyPkcs8: Uint8Array;
  try {
    privateKeyPkcs8 = await decryptBytes(masterKey, material.wrappedPrivateKey, material.privateKeyIv);
  } catch {
    throw new KeyUnlockError(
      'Your master key was recovered but the private key could not be unwrapped. The stored key material looks damaged.',
    );
  }

  const privateKey = await importPrivateKey(privateKeyPkcs8);
  wipe(privateKeyPkcs8);

  return { masterKey, privateKey };
}

/** Wraps a note key with the owner's master key so it can be stored server-side. */
export async function wrapNoteKeyForStorage(
  masterKey: CryptoKey,
  noteKeyRaw: Uint8Array,
): Promise<{ wrappedNoteKey: string; noteKeyIv: string }> {
  const wrapped = await encryptBytes(masterKey, noteKeyRaw);
  return { wrappedNoteKey: wrapped.ciphertext, noteKeyIv: wrapped.iv };
}

/** Recovers a note key from the copy wrapped with the owner's master key. */
export async function unwrapNoteKeyFromStorage(
  masterKey: CryptoKey,
  wrappedNoteKey: string,
  noteKeyIv: string,
): Promise<CryptoKey> {
  const raw = await decryptBytes(masterKey, wrappedNoteKey, noteKeyIv);
  const key = await importAesKey(raw, true);
  wipe(raw);
  return key;
}

// --- Password recovery (zero-knowledge) -------------------------------------

/** Format shown to the user: a checkable prefix plus 32 random bytes. */
export function generateRecoveryKey(): string {
  return `RCVR-${toBase64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/**
 * Derives a KEK from the recovery key. Same PBKDF2 construction as the
 * password path but with its own salt, stored separately on the account.
 */
export async function deriveRecoveryKek(
  recoveryKey: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  return deriveKeyEncryptionKey(recoveryKey, salt, iterations);
}

/** Salted SHA-256 of the raw recovery key (hex). Sent instead of the key. */
export async function recoveryKeyDigest(recoveryKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ab(textEncoder.encode(recoveryKey)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Registration-time recovery setup: re-wraps the master key under a KEK
 * derived from the recovery key. Everything stays in this browser; only the
 * wrapped blob and derivation parameters are uploaded.
 */
export async function buildRecoverySetup(
  recoveryKey: string,
  masterKey: CryptoKey,
): Promise<{
  recoveryKey: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKeyRecovery: string;
  masterKeyRecoveryIv: string;
  recoveryKeyHash: string;
}> {
  const salt = randomBytes(16);
  const iterations = DEFAULT_KDF_ITERATIONS;
  const kek = await deriveRecoveryKek(recoveryKey, salt, iterations);

  // Re-export the master key raw bytes so they can be wrapped again.
  const masterKeyRaw = await exportAesKey(masterKey);
  const wrapped = await encryptBytes(kek, masterKeyRaw);
  wipe(masterKeyRaw);

  return {
    recoveryKey,
    kdfSalt: toBase64(salt),
    kdfIterations: iterations,
    wrappedMasterKeyRecovery: wrapped.ciphertext,
    masterKeyRecoveryIv: wrapped.iv,
    recoveryKeyHash: await recoveryKeyDigest(recoveryKey),
  };
}

/**
 * Forgot-password flow, step 1 (in the browser): unwrap the master key with
 * the recovery KEK. Returns raw master key bytes for the re-wrap step.
 */
export async function unwrapMasterKeyWithRecoveryKey(
  recoveryKey: string,
  material: {
    wrappedMasterKeyRecovery: string;
    masterKeyRecoveryIv: string;
    recoveryKdfSalt: string;
    recoveryKdfIterations: number;
  },
): Promise<Uint8Array> {
  const kek = await deriveRecoveryKek(recoveryKey, fromBase64(material.recoveryKdfSalt), material.recoveryKdfIterations);
  return decryptBytes(kek, material.wrappedMasterKeyRecovery, material.masterKeyRecoveryIv);
}

/**
 * Forgot-password flow, step 2: rebuild the whole key hierarchy under a NEW
 * password without the server ever seeing a key. The master key raw bytes
 * become the new password's wrapped master key; the private key is re-wrapped
 * under the (unchanged) master key with a fresh nonce.
 */
export async function buildResetMaterial(
  newPassword: string,
  masterKeyRaw: Uint8Array,
  privateKeyPkcs8: Uint8Array,
): Promise<{
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKey: string;
  masterKeyIv: string;
  wrappedPrivateKey: string;
  privateKeyIv: string;
  masterKey: CryptoKey;
}> {
  const salt = randomBytes(16);
  const iterations = DEFAULT_KDF_ITERATIONS;
  const kek = await deriveKeyEncryptionKey(newPassword, salt, iterations);

  const wrappedMaster = await encryptBytes(kek, masterKeyRaw);
  const masterKey = await importAesKey(masterKeyRaw, false);

  const wrappedPrivate = await encryptBytes(masterKey, privateKeyPkcs8);

  return {
    kdfSalt: toBase64(salt),
    kdfIterations: iterations,
    wrappedMasterKey: wrappedMaster.ciphertext,
    masterKeyIv: wrappedMaster.iv,
    wrappedPrivateKey: wrappedPrivate.ciphertext,
    privateKeyIv: wrappedPrivate.iv,
    masterKey,
  };
}

/** Feature-detects the Web Crypto APIs we depend on (they require a secure context). */
export function isWebCryptoAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.crypto !== 'undefined' &&
    typeof window.crypto.subtle !== 'undefined'
  );
}
