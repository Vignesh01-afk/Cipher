import { API_BASE_URL, ApiError, api, getAuthToken } from './api';
import {
  decryptBytes,
  decryptRawBytes,
  encryptBytes,
  exportAesKey,
  fromBase64,
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

/**
 * Above this ciphertext size the upload uses the two-step direct flow
 * (/files/init -> PUT to storage -> /files/complete) so the blob never has to
 * pass through the API function's request-body cap (4.5 MB on Vercel).
 */
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 4 * 1024 * 1024;

export const FILE_ENCRYPTION_VERSION = 1;
export const FILE_ALGORITHM = 'AES-GCM-256';

/**
 * MIME types that are safe to preview in-app.
 *
 * Images, audio and video render natively through media elements and cannot
 * execute script. PDFs are rendered in a sandboxed iframe so the browser's
 * PDF viewer (an untrusted plugin path) cannot reach the app origin.
 *
 * `application/pdf` is included for the sandboxed preview; `text/plain` is
 * NOT rendered through an iframe - it is decoded to text and shown in a
 * <pre> so there is no same-origin script execution path at all.
 */
export const PREVIEWABLE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'application/pdf',
]);

/** Any `audio/*` type renders natively in <audio> and cannot execute script. */
export const AUDIO_MIME_PREFIX = 'audio/';

/** Text-like types we will safely render as text, never as a media/iframe blob. */
export const TEXT_MIME_TYPES = new Set(['text/plain']);

/**
 * Strips any parameters (e.g. `; charset=utf-8`) and lowercases, so lookups
 * against the allowlist are exact.
 */
function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * Maps an uploader-provided MIME type to a safe preview kind.
 *
 * Uploader-controlled `file.mimeType` is never trusted to decide whether a
 * payload should render as media, iframe or text. Unknown or disallowed types
 * (including `text/html` and `image/svg+xml`) are treated as "no preview".
 */
export type SafePreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

export function safePreviewKind(mimeType: string | null | undefined): SafePreviewKind {
  const mime = baseMimeType(mimeType) || 'application/octet-stream';

  if (mime === 'application/pdf') return 'pdf';
  if (TEXT_MIME_TYPES.has(mime)) return 'text';
  if (mime.startsWith(AUDIO_MIME_PREFIX)) return 'audio';
  if (PREVIEWABLE_MIME_TYPES.has(mime)) {
    return mime.startsWith('image/') ? 'image' : 'video';
  }
  // Everything else - including text/html, image/svg+xml, image/* variants
  // outside the allowlist and any unknown type - is "no preview".
  return 'none';
}

/**
 * Blob type to use for an in-memory object URL.
 *
 * The Blob MIME is what the browser uses to choose a renderer, so it must be
 * derived from an allowlist, not from the uploader-provided `mimeType`.
 * Anything not in the allowlist becomes `application/octet-stream`, which will
 * not render as HTML/SVG/script in this origin.
 */
export function safePreviewBlobType(mimeType: string | null | undefined): string {
  const kind = safePreviewKind(mimeType);
  if (kind === 'none') return 'application/octet-stream';
  if (kind === 'text') return 'text/plain';
  // `safePreviewKind` only returns a render kind for allowlisted types, so
  // this is always one of them (parameters stripped, lowercased).
  return baseMimeType(mimeType) || 'application/octet-stream';
}

/**
 * Normalize a MIME type for storage / round-tripping.
 *
 * Used by both the upload path and the download path so the server-side
 * `mimeType` column and the Blob type are both derived from the same
 * allowlist semantics rather than raw browser input.
 */
export function normalizeFileMimeType(mimeType: string | null | undefined): string {
  const kind = safePreviewKind(mimeType);
  if (kind === 'none') return 'application/octet-stream';
  return baseMimeType(mimeType) || 'application/octet-stream';
}

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
    mimeType: normalizeFileMimeType(prepared.file.type),
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

/** Byte length of a base64 string without decoding it. */
function base64ByteLength(base64: string): number {
  if (base64.length === 0) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** PUTs the encrypted bytes straight to a presigned storage URL, with progress. */
function putToSignedUrl(
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      reject(new ApiError(xhr.status, 'UPLOAD_FAILED', `Upload failed with status ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the storage backend.'));
    // Wrap in a Blob so the body is a plain byte stream; the Content-Type we
    // set above is what the storage backend sees.
    xhr.send(new Blob([new Uint8Array(bytes)]));
  });
}

export interface FileUploadContext {
  noteId: string;
  /** The file key wrapped with the note key, for share recipients. */
  wrappedForNoteKey: string;
  noteKeyWrapIv: string;
}

/**
 * Uploads an already-encrypted file, choosing the transport by size.
 *
 * Small blobs go up in one authenticated request. Large ones use the direct
 * two-step flow; if the deployment has no direct-upload backend (local disk),
 * the server answers DIRECT_UPLOAD_UNAVAILABLE and we transparently fall back
 * to the single request - so the same client works everywhere.
 */
export async function uploadEncryptedFile(
  prepared: PreparedUpload,
  context: FileUploadContext,
  onProgress: (fraction: number) => void,
): Promise<SecureFileDto> {
  const singleShotPayload = (): FileUploadPayload => ({
    ...buildFileUploadPayload(prepared, context.noteId),
    wrappedForNoteKey: context.wrappedForNoteKey,
    noteKeyWrapIv: context.noteKeyWrapIv,
  });

  const encryptedBytes = base64ByteLength(prepared.encrypted.ciphertext);
  if (encryptedBytes <= DIRECT_UPLOAD_THRESHOLD_BYTES) {
    return uploadFileWithProgress(singleShotPayload(), onProgress);
  }

  try {
    const init = await api.initFileUpload({
      noteId: context.noteId,
      filename: prepared.file.name,
      mimeType: normalizeFileMimeType(prepared.file.type),
      plaintextBytes: prepared.plaintextBytes,
      encryptedBytes,
      fileIv: prepared.encrypted.iv,
      encryptionVersion: FILE_ENCRYPTION_VERSION,
      algorithm: FILE_ALGORITHM,
      wrappedFileKey: prepared.wrappedFileKey,
      fileKeyIv: prepared.fileKeyIv,
      wrappedForNoteKey: context.wrappedForNoteKey,
      noteKeyWrapIv: context.noteKeyWrapIv,
    });

    await putToSignedUrl(
      init.upload.url,
      init.upload.headers,
      fromBase64(prepared.encrypted.ciphertext),
      onProgress,
    );
    return await api.completeFileUpload(init.file.id);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'DIRECT_UPLOAD_UNAVAILABLE') {
      return uploadFileWithProgress(singleShotPayload(), onProgress);
    }
    throw error;
  }
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

  // SECURITY: the Blob MIME must not come from the uploader-controlled
  // `file.mimeType` - a text/html or image/svg+xml label would hand the
  // browser an executable renderer in this origin. Use the allowlisted type
  // only.
  return new Blob([plaintext as unknown as BlobPart], {
    type: safePreviewBlobType(file.mimeType),
  });
}

/** Human-readable one-line summary used in lists. */
export function fileMetaSummary(file: SecureFileDto): string {
  return `${file.mimeType}`;
}