import type { AuditLog, Note, NoteShare, Prisma, SecureFile, User } from '@prisma/client';

/**
 * Response shapes.
 *
 * Everything returned to the browser is either public metadata or an opaque
 * blob. No serializer in this file can produce note plaintext, because the
 * server never has any.
 */

// --- User ------------------------------------------------------------------

export interface KeyMaterialResponse {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  /** Opaque blobs the browser needs in order to unlock the user's keys. */
  publicKey: string;
  wrappedPrivateKey: string;
  privateKeyIv: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKey: string;
  masterKeyIv: string;
}

/** The self-describing view of a user, returned by /auth/me and on login. */
export function toKeyMaterial(user: User): KeyMaterialResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
    publicKey: user.publicKey,
    wrappedPrivateKey: user.wrappedPrivateKey,
    privateKeyIv: user.privateKeyIv,
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
    wrappedMasterKey: user.wrappedMasterKey,
    masterKeyIv: user.masterKeyIv,
  };
}

export interface PublicProfile {
  id: string;
  email: string;
  displayName: string;
  publicKey: string;
}

/** What other registered users are allowed to see: identity + public key. */
export function toPublicProfile(user: Pick<User, 'id' | 'email' | 'displayName' | 'publicKey'>): PublicProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    publicKey: user.publicKey,
  };
}

// --- Notes -----------------------------------------------------------------

export const noteInclude = {
  owner: { select: { id: true, displayName: true, email: true } },
  shares: { include: { sharedWith: { select: { id: true, displayName: true, email: true } } } },
} satisfies Prisma.NoteInclude;

export type NoteWithRelations = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;

export interface ShareDto {
  id: string;
  noteId: string;
  sharedWithId: string;
  recipient: { id: string; displayName: string; email: string };
  keyAlgorithm: string;
  createdAt: string;
  revokedAt: string | null;
  isActive: boolean;
  /** Only the owner receives the recipient's wrapped key copy. */
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
  /** Present for recipients: the note key wrapped to their public key. */
  wrappedKey: string | null;
  keyAlgorithm: string | null;
  shares: ShareDto[];
}

export function toShareDto(
  share: NoteShare & { sharedWith: { id: string; displayName: string; email: string } },
  options: { includeWrappedKey: boolean },
): ShareDto {
  return {
    id: share.id,
    noteId: share.noteId,
    sharedWithId: share.sharedWithId,
    recipient: {
      id: share.sharedWith.id,
      displayName: share.sharedWith.displayName,
      email: share.sharedWith.email,
    },
    keyAlgorithm: share.keyAlgorithm,
    createdAt: share.createdAt.toISOString(),
    revokedAt: share.revokedAt ? share.revokedAt.toISOString() : null,
    isActive: share.revokedAt === null,
    ...(options.includeWrappedKey ? { wrappedKey: share.wrappedKey } : {}),
  };
}

export function toNoteDto(
  note: NoteWithRelations,
  access: { role: 'owner' | 'recipient'; wrappedKey?: string | null; keyAlgorithm?: string | null; includeShares: boolean },
): NoteDto {
  return {
    id: note.id,
    ownerId: note.ownerId,
    owner: { id: note.owner.id, displayName: note.owner.displayName, email: note.owner.email },
    ciphertext: note.ciphertext,
    iv: note.iv,
    encryptionVersion: note.encryptionVersion,
    algorithm: note.algorithm,
    payloadBytes: note.payloadBytes,
    wrappedNoteKey: access.role === 'owner' ? note.wrappedNoteKey : null,
    noteKeyIv: access.role === 'owner' ? note.noteKeyIv : null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    role: access.role,
    wrappedKey: access.wrappedKey ?? null,
    keyAlgorithm: access.keyAlgorithm ?? null,
    shares: access.includeShares
      ? note.shares.map((share) => toShareDto(share, { includeWrappedKey: true }))
      : [],
  };
}

// --- Shared-with-me --------------------------------------------------------

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

export function toSharedNoteDto(
  share: NoteShare & {
    note: Note & { owner: { id: string; displayName: string; email: string } };
  },
): SharedNoteDto {
  return {
    shareId: share.id,
    noteId: share.noteId,
    grantedAt: share.createdAt.toISOString(),
    keyAlgorithm: share.keyAlgorithm,
    wrappedKey: share.wrappedKey,
    owner: {
      id: share.note.owner.id,
      displayName: share.note.owner.displayName,
      email: share.note.owner.email,
    },
    ciphertext: share.note.ciphertext,
    iv: share.note.iv,
    encryptionVersion: share.note.encryptionVersion,
    algorithm: share.note.algorithm,
    payloadBytes: share.note.payloadBytes,
    createdAt: share.note.createdAt.toISOString(),
    updatedAt: share.note.updatedAt.toISOString(),
  };
}

// --- Secure files -----------------------------------------------------------

export interface SecureFileDto {
  id: string;
  noteId: string;
  ownerId: string;
  filename: string;
  mimeType: string;
  extension: string | null;
  encryptedBytes: number;
  plaintextBytes: number;
  /** IV of the file ciphertext itself (needed for decryption). */
  fileIv: string;
  encryptionVersion: number;
  algorithm: string;
  createdAt: string;
  /** Only the owner receives the wrapped file key copy. */
  wrappedFileKey?: string;
  fileKeyIv?: string;
  /** Present for note-key holders (owner + share recipients). */
  wrappedForNoteKey?: string;
  noteKeyWrapIv?: string;
}

export function toSecureFileDto(
  file: SecureFile,
  options: { includeWrappedKey: boolean; includeNoteKeyWrap?: boolean },
): SecureFileDto {
  return {
    id: file.id,
    noteId: file.noteId,
    ownerId: file.ownerId,
    filename: file.filename,
    mimeType: file.mimeType,
    extension: file.extension,
    encryptedBytes: file.encryptedBytes,
    plaintextBytes: file.plaintextBytes,
    fileIv: file.fileIv,
    encryptionVersion: file.encryptionVersion,
    algorithm: file.algorithm,
    createdAt: file.createdAt.toISOString(),
    ...(options.includeWrappedKey
      ? { wrappedFileKey: file.wrappedFileKey, fileKeyIv: file.fileKeyIv }
      : {}),
    ...(options.includeNoteKeyWrap
      ? { wrappedForNoteKey: file.wrappedForNoteKey, noteKeyWrapIv: file.noteKeyWrapIv }
      : {}),
  };
}

// --- Audit -----------------------------------------------------------------

export interface AuditLogDto {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  noteId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function toAuditLogDto(log: AuditLog): AuditLogDto {
  let metadata: Record<string, unknown> | null = null;
  if (log.metadata) {
    try {
      const parsed = JSON.parse(log.metadata);
      metadata = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      metadata = null;
    }
  }

  return {
    id: log.id,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    noteId: log.noteId,
    metadata,
    createdAt: log.createdAt.toISOString(),
  };
}
