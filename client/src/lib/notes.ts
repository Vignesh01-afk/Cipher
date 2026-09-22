import {
  decryptNotePayload,
  exportAesKey,
  importAesKey,
  importRecipientPublicKey,
  unwrapNoteKeyFromOwner,
  unwrapNoteKeyFromStorage,
  wrapNoteKeyForRecipient,
  type CryptoSession,
  type NotePayload,
} from './crypto';
import type { NoteDto, ShareDto, SharedNoteDto } from './types';

/**
 * A note after it has been decrypted in the browser. The plaintext fields in
 * this object exist only in memory; they are never sent or persisted.
 */
export interface DecryptedNote extends NotePayload {
  id: string;
  ownerId: string;
  owner: { id: string; displayName: string; email: string };
  role: 'owner' | 'recipient';
  encryptionVersion: number;
  algorithm: string;
  iv: string;
  ciphertext: string;
  payloadBytes: number;
  createdAt: string;
  updatedAt: string;
  shares: ShareDto[];
  /** In-memory only, used to re-wrap the note key when sharing. */
  noteKey: CryptoKey;
  /** Present on notes shared with the current user. */
  grantedAt?: string;
}

export interface DecryptionResult<T> {
  notes: T[];
  failedNoteIds: string[];
}

/** Decrypts one of the current user's own notes using the master key. */
export async function decryptOwnNote(note: NoteDto, session: CryptoSession): Promise<DecryptedNote> {
  if (!note.wrappedNoteKey || !note.noteKeyIv) {
    throw new Error('This note is missing its wrapped key material and cannot be decrypted.');
  }

  const noteKey = await unwrapNoteKeyFromStorage(session.masterKey, note.wrappedNoteKey, note.noteKeyIv);
  const payload = await decryptNotePayload(noteKey, note.ciphertext, note.iv);

  return {
    ...payload,
    id: note.id,
    ownerId: note.ownerId,
    owner: note.owner,
    role: 'owner',
    encryptionVersion: note.encryptionVersion,
    algorithm: note.algorithm,
    iv: note.iv,
    ciphertext: note.ciphertext,
    payloadBytes: note.payloadBytes,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    shares: note.shares,
    noteKey,
  };
}

/** Decrypts a note a different user shared with us, using our private key. */
export async function decryptSharedNote(
  share: SharedNoteDto,
  session: CryptoSession,
): Promise<DecryptedNote> {
  const noteKeyRaw = await unwrapNoteKeyFromOwner(session.privateKey, share.wrappedKey);
  const noteKey = await importAesKey(noteKeyRaw, true);
  const payload = await decryptNotePayload(noteKey, share.ciphertext, share.iv);

  return {
    ...payload,
    id: share.noteId,
    ownerId: share.owner.id,
    owner: share.owner,
    role: 'recipient',
    encryptionVersion: share.encryptionVersion,
    algorithm: share.algorithm,
    iv: share.iv,
    ciphertext: share.ciphertext,
    payloadBytes: share.payloadBytes,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    shares: [],
    noteKey,
    grantedAt: share.grantedAt,
  };
}

/**
 * Decrypts a batch, tolerating individual failures (for example a note whose
 * ciphertext was tampered with). The caller can surface the failed ids instead
 * of losing the whole list.
 */
export async function decryptOwnNotes(
  notes: NoteDto[],
  session: CryptoSession,
): Promise<DecryptionResult<DecryptedNote>> {
  const decrypted: DecryptedNote[] = [];
  const failedNoteIds: string[] = [];

  for (const note of notes) {
    try {
      decrypted.push(await decryptOwnNote(note, session));
    } catch {
      failedNoteIds.push(note.id);
    }
  }

  return { notes: decrypted, failedNoteIds };
}

export async function decryptSharedNotes(
  shares: SharedNoteDto[],
  session: CryptoSession,
): Promise<DecryptionResult<DecryptedNote>> {
  const decrypted: DecryptedNote[] = [];
  const failedNoteIds: string[] = [];

  for (const share of shares) {
    try {
      decrypted.push(await decryptSharedNote(share, session));
    } catch {
      failedNoteIds.push(share.noteId);
    }
  }

  return { notes: decrypted, failedNoteIds };
}

/**
 * Wraps a note key for a recipient. The note key never leaves the browser in
 * the clear: only the RSA-OAEP output is sent to the server.
 */
export async function buildWrappedKeyForRecipient(
  note: DecryptedNote,
  recipientPublicKeySpki: string,
): Promise<string> {
  const noteKeyRaw = await exportAesKey(note.noteKey);
  const recipientKey = await importRecipientPublicKey(recipientPublicKeySpki);
  return wrapNoteKeyForRecipient(recipientKey, noteKeyRaw);
}

/**
 * LOCAL search. Runs entirely on already-decrypted notes in the browser.
 *
 * There is deliberately no server-side search endpoint: the server only holds
 * ciphertext, and searching it would leak query terms and note metadata.
 */
export interface SearchFilters {
  query: string;
  tag?: string | null;
  role?: 'owner' | 'recipient' | null;
}

export function filterNotes<T extends DecryptedNote>(notes: T[], filters: SearchFilters): T[] {
  const needle = filters.query.trim().toLowerCase();

  return notes.filter((note) => {
    if (filters.tag && !note.tags.includes(filters.tag)) return false;
    if (filters.role && note.role !== filters.role) return false;
    if (!needle) return true;

    return (
      note.title.toLowerCase().includes(needle) ||
      note.content.toLowerCase().includes(needle) ||
      note.tags.some((tag) => tag.toLowerCase().includes(needle))
    );
  });
}

/** Every unique tag across the supplied notes, alphabetically sorted. */
export function collectTags(notes: DecryptedNote[]): string[] {
  const tags = new Set<string>();
  for (const note of notes) {
    for (const tag of note.tags) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/** Plain-text preview used on note cards. */
export function notePreview(content: string, maxLength = 180): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

export function countWords(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function sortNotesByUpdated(notes: DecryptedNote[]): DecryptedNote[] {
  return [...notes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}
