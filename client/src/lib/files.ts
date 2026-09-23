import { API_BASE_URL, ApiError, getAuthToken } from './api';
import {
  decryptBytes,
  decryptRawBytes,
  encryptBytes,
  exportAesKey,
  generateAesKey,
  importAesKey,
  wrapNoteKeyForStorage,
  wipe,
  type CryptoSession,
} from './crypto';
import type { SecureFileDto } from './types';

/**
 * Secure file sharing - client side.
 *
 * Flow (reuses the existing note key hierarchy, so no second crypto system):
 *
 *   1. A fresh AES-GCM-256 key is generated for every file.
 *   2. The file bytes are encrypted in the browser with that key.
 *   3a. Owner wrap: the file key is wrapped with the uploader's master key.
 *   3b. Recipient wrap: the file key is wrapped with the note key the
 *       recipient already holds (post-import it behaves like any AES key).
 *   4. Only ciphertext + wrapped key are uploaded; the server cannot decrypt.
 *
 * Downloads go through the authorised /files/:id/content route and are
 * decrypted in memory. No plaintext touches localStorage or disk; object URLs
 * created for previews must be revoked by the UI when done.
 */

/** Cap mirrors the server's MAX_FILE_BYTES default (25 MiB ciphertext). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const FILE_ENCRYPTION_VERSION = 1;
export const FILE_ALGORITHM = 'AES-GCM-256';

export class FileTooLargeError extends Error {
  constructor() {
    super('Files up to 25 MB can be sent. Choose a smaller file.');
    this.name = 'FileTooLargeError';
  }
}

export interface PreparedUpload {
  file: File;
  encrypted: { ciphertext: string; iv: string };
  wrappedFileKey: string;
  fileKeyIv: string;
  plaintextBytes: number;
  /** Raw file key, used to re-wrap for recipients when sharing the note. */
  fileKeyRaw: Uint8Array;
}

/** Encrypts a file locally with a fresh per-file key. */
export async function encryptFileForUpload(file: File, masterKey: CryptoKey): Promise<PreparedUpload> {
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError();
  if (file.size === 0) throw new Error('That file is empty.');

  const plaintext = new Uint8Array(await file.arrayBuffer());
  try {
    const { key, raw } = await generateAesKey();
    const encrypted = await encryptBytes(key, plaintext);
    // Wrap the raw file key with the owner's master key - the same
    // construction used for note keys.
    const { wrappedNoteKey, noteKeyIv } = await wrapNoteKeyForStorage(masterKey, raw);

    return {
      file,
      encrypted,
      wrappedFileKey: wrappedNoteKey,
      fileKeyIv: noteKeyIv,
      plaintextBytes: file.size,
      fileKeyRaw: raw,
    };
  } finally {
    plaintext.fill(0); // best-effort scrub; JS cannot guarantee this
  }
}

/** Payload for POST /api/files. */
export interface FileUploadPayload {
  noteId: string;
  filename: string;
  mimeType: string;
  plaintextBytes: number;
  ciphertext: string;
  /** IV of the file ciphertext itself. */
  fileIv: string;
  encryptionVersion: number;
  algorithm: string;
  wrappedFileKey: string;
  fileKeyIv: string;
  /** Same file key wrapped with the note key (recipient access). */
  wrappedForNoteKey?: string;
  noteKeyWrapIv?: string;
}

export function buildFileUploadPayload(prepared: PreparedUpload, noteId: string): FileUploadPayload {
  return {
    noteId,
    filename: prepared.file.name,
    mimeType: prepared.file.type || 'application/octet-stream',
    plaintextBytes: prepared.plaintextBytes,
    ciphertext: prepared.encrypted.ciphertext,
    fileIv: prepared.encrypted.iv,
    encryptionVersion: FILE_ENCRYPTION_VERSION,
    algorithm: FILE_ALGORITHM,
    wrappedFileKey: prepared.wrappedFileKey,
    fileKeyIv: prepared.fileKeyIv,
  };
}

/**
 * A file DTO plus the note key needed to unwrap it on the recipient path.
 * The note key never leaves memory; it only lets the client unwrap the
 * note-key-wrapped copy of the file key.
 */
export type SecureFileWithNoteKey = SecureFileDto;

/**
 * Uploads with progress via XMLHttpRequest (fetch cannot report upload
 * progress without request streams, which lack cross-browser support).
 */
export function uploadFileWithProgress(
  payload: FileUploadPayload,
  onProgress: (fraction: number) => void,
): Promise<SecureFileDto> {
  return new Promise((resolve, reject) => {
    const token = getAuthToken();
    if (!token) {
      reject(new ApiError(401, 'UNAUTHORIZED', 'Your session has expired. Sign in again.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/files`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(1, event.loaded / event.total));
    };

    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        parsed = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = parsed as { file?: SecureFileDto } | null;
        if (body?.file) {
          onProgress(1);
          resolve(body.file);
          return;
        }
        reject(new ApiError(xhr.status, 'BAD_RESPONSE', 'The server response was malformed.'));
        return;
      }
      const err = (parsed ?? {}) as { error?: string; code?: string };
      reject(
        new ApiError(
          xhr.status,
          err.code ?? 'REQUEST_FAILED',
          err.error ?? `Upload failed with status ${xhr.status}`,
        ),
      );
    };

    xhr.onerror = () => {
      reject(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the CipherNote API. Is the server running?'));
    };

    xhr.send(JSON.stringify(payload));
  });
}

/**
 * Unwraps a file key.
 *
 * Preferred path: the file key was wrapped with the NOTE key, which every
 * participant (owner and share recipients) already holds. The DTO fields for
 * that wrap are `wrappedForNoteKey` + `noteKeyWrapIv`.
 *
 * Fallback path: the owner-only copy wrapped with the master key
 * (`wrappedFileKey` + `fileKeyIv`) - used when no note key is in hand.
 *
 * Both blobs are AES-GCM, so a mismatched key fails authentication instead of
 * yielding garbage.
 */
export async function unwrapFileKey(
  file: SecureFileDto,
  session: CryptoSession,
  noteKey?: CryptoKey,
): Promise<CryptoKey> {
  if (noteKey && file.wrappedForNoteKey && file.noteKeyWrapIv) {
    return importAesKey(await decryptBytes(noteKey, file.wrappedForNoteKey, file.noteKeyWrapIv), true);
  }
  if (file.wrappedFileKey && file.fileKeyIv) {
    return importAesKey(await decryptBytes(session.masterKey, file.wrappedFileKey, file.fileKeyIv), true);
  }
  throw new Error('This file has no wrapped key material stored.');
}

/**
 * Wraps a raw file key with the note key so a share recipient can unwrap it.
 * Uses the same AES-GCM wrap primitive as every other key in the hierarchy.
 */
export async function wrapFileKeyForRecipient(
  noteKey: CryptoKey,
  fileKeyRaw: Uint8Array,
): Promise<{ wrappedFileKey: string; fileKeyIv: string }> {
  const wrapped = await encryptBytes(noteKey, fileKeyRaw);
  return { wrappedFileKey: wrapped.ciphertext, fileKeyIv: wrapped.iv };
}

/** Exports a CryptoKey file key to raw bytes (for re-wrapping on share). */
export async function exportFileKey(fileKey: CryptoKey): Promise<Uint8Array> {
  return exportAesKey(fileKey);
}

/**
 * Downloads the ciphertext through the authorised endpoint and decrypts it
 * in memory. Returns a fresh Blob; the caller creates object URLs from it and
 * MUST revoke them when done.
 */
export async function downloadAndDecryptFile(
  file: SecureFileDto,
  session: CryptoSession,
  noteKey?: CryptoKey,
): Promise<Blob> {
  const fileKey = await unwrapFileKey(file, session, noteKey);

  const response = await fetch(`${API_BASE_URL}/files/${encodeURIComponent(file.id)}/content`, {
    headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` },
  });

  if (!response.ok) {
    let message = `Download failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(response.status, 'DOWNLOAD_FAILED', message);
  }

  // The server streams back the stored binary blob (the base64 ciphertext was
  // decoded to raw bytes at upload time), so decrypt the raw bytes directly.
  const ciphertextBytes = new Uint8Array(await response.arrayBuffer());
  const plaintext = await decryptRawBytes(fileKey, ciphertextBytes, file.fileIv);

  return new Blob([plaintext as unknown as BlobPart], {
    type: file.mimeType || 'application/octet-stream',
  });
}

/** Human-readable one-line summary used in lists. */
export function fileMetaSummary(file: SecureFileDto): string {
  return `${file.mimeType}`;
}