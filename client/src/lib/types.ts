/**
 * Shared API-facing types. These mirror `server/src/lib/serialize.ts`.
 */

export interface KeyMaterial {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  publicKey: string;
  wrappedPrivateKey: string;
  privateKeyIv: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKey: string;
  masterKeyIv: string;
}

export interface PublicProfile {
  id: string;
  email: string;
  displayName: string;
  publicKey: string;
}

export interface ShareDto {
  id: string;
  noteId: string;
  sharedWithId: string;
  recipient: { id: string; displayName: string; email: string };
  keyAlgorithm: string;
  createdAt: string;
  revokedAt: string | null;
  isActive: boolean;
  wrappedKey?: string;
}

export interface NoteDto {
  id: string;
  ownerId: string;
  owner: { id: string; displayName: string; email: string };
  ciphertext: string;
  iv: string;
  encryptionVersion: number;
  algorithm: string;
  payloadBytes: number;
  wrappedNoteKey: string | null;
  noteKeyIv: string | null;
  createdAt: string;
  updatedAt: string;
  role: 'owner' | 'recipient';
  wrappedKey: string | null;
  keyAlgorithm: string | null;
  shares: ShareDto[];
}

export interface SharedNoteDto {
  shareId: string;
  noteId: string;
  grantedAt: string;
  keyAlgorithm: string;
  wrappedKey: string;
  owner: { id: string; displayName: string; email: string };
  ciphertext: string;
  iv: string;
  encryptionVersion: number;
  algorithm: string;
  payloadBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  noteId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: KeyMaterial;
}

/** Response of POST /auth/recovery/challenge (see server routes/auth.ts). */
export interface RecoveryChallengeResponse {
  displayName: string;
  wrappedMasterKeyRecovery: string;
  masterKeyRecoveryIv: string;
  recoveryKdfSalt: string;
  recoveryKdfIterations: number;
  privateKeyIv: string;
  wrappedPrivateKey: string;
}

export interface ApiErrorPayload {
  error: string;
  code: string;
  details?: unknown;
}

export interface SecureFileDto {
  id: string;
  noteId: string;
  ownerId: string;
  filename: string;
  mimeType: string;
  extension: string | null;
  encryptedBytes: number;
  plaintextBytes: number;
  /** IV of the file ciphertext itself. */
  fileIv: string;
  encryptionVersion: number;
  algorithm: string;
  createdAt: string;
  /** Present for the owner: the file key wrapped with their master key. */
  wrappedFileKey?: string;
  fileKeyIv?: string;
  /** Present for every participant: the file key wrapped with the note key. */
  wrappedForNoteKey?: string;
  noteKeyWrapIv?: string;
}
