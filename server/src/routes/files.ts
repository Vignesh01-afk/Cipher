import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { env } from '../env';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { requireNoteAccess, requireNoteOwnership } from '../lib/access';
import { ApiError, asyncHandler, parseBody } from '../lib/http';
import {
  completeFileSchema,
  createFileSchema,
  extractExtension,
  idParamSchema,
  initFileSchema,
  sanitiseFilename,
} from '../lib/schemas';
import { toSecureFileDto } from '../lib/serialize';
import { currentUserId, requireAuth } from '../middleware/auth';
import { createRateLimitStore } from '../lib/rateLimitStore';
import {
  defaultStorage,
  generateStorageKey,
  storageFor,
  type StorageDriverKind,
} from '../lib/storage';

export const filesRouter = Router();

// Files are large; a tight limiter prevents storage exhaustion via replay.
const fileUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: createRateLimitStore(),
  message: { error: 'Too many file uploads. Please wait before trying again.', code: 'RATE_LIMITED' },
});

const fileDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: createRateLimitStore(),
  message: { error: 'Too many file requests. Please wait before trying again.', code: 'RATE_LIMITED' },
});

/** Narrows the stored driver name (a plain string column) to a known backend. */
function driverOf(file: { storageDriver: string }): StorageDriverKind {
  return file.storageDriver === 'supabase' ? 'supabase' : 'local';
}

/**
 * Per-account storage ceiling.
 *
 * Checked before every write against the sum of the account's live encrypted
 * blobs, so a user cannot fill the bucket with repeated uploads. Runs before
 * any bytes are stored or any pending row is created.
 */
async function assertStorageQuota(userId: string, additionalBytes: number): Promise<void> {
  const aggregate = await prisma.secureFile.aggregate({
    where: { ownerId: userId, deletedAt: null, status: 'READY' },
    _sum: { encryptedBytes: true },
  });
  const used = aggregate._sum.encryptedBytes ?? 0;
  if (used + additionalBytes > env.maxUserStorageBytes) {
    throw ApiError.badRequest(
      'This account has reached its encrypted storage limit. Delete a file to free space.',
      'STORAGE_QUOTA_EXCEEDED',
    );
  }
}

/**
 * Resolves the caller's access to the note a file is attached to.
 *
 * Every file request funnels through the SAME gate the notes API uses
 * (`requireNoteAccess`): owner or holder of an unrevoked share. There is no
 * route that accepts a bare file id without this check - IDOR is prevented by
 * construction, not by convention.
 */
async function loadFileAccess(req: Request, fileId: string) {
  const userId = currentUserId(req);

  const file = await prisma.secureFile.findUnique({ where: { id: fileId } });
  if (!file || file.deletedAt) {
    throw ApiError.notFound('That file does not exist', 'FILE_NOT_FOUND');
  }

  try {
    await requireNoteAccess(file.noteId, userId);
  } catch (error) {
    // Record the denial in the caller's audit trail, then reject.
    if (error instanceof ApiError && error.status === 403) {
      await recordAudit({
        userId,
        action: AuditAction.FILE_ACCESS_DENIED,
        targetType: 'FILE',
        targetId: file.id,
        noteId: file.noteId,
        metadata: { filename: file.filename },
        ipAddress: requestIp(req),
      });
    }
    throw error;
  }

  return { file, userId };
}

/**
 * POST /api/files
 *
 * Stores an encrypted file blob in one request. The browser has already:
 *   1. generated a fresh per-file AES-GCM-256 key,
 *   2. encrypted the file bytes with it,
 *   3. wrapped the file key with the uploader's master key.
 * The server receives only opaque blobs and metadata.
 *
 * Only the OWNER of the note may attach files (a share is read access, not a
 * write grant); `requireNoteOwnership` enforces that before any bytes are
 * written. Very large blobs use the two-step /files/init flow instead, so the
 * payload never has to pass through a serverless request body cap.
 */
filesRouter.post(
  '/',
  requireAuth,
  fileUploadLimiter,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(createFileSchema, req.body);

    // Authorization BEFORE any bytes are written.
    await requireNoteOwnership(input.noteId, userId);
    await assertStorageQuota(userId, Math.ceil((input.ciphertext.length * 3) / 4));

    const filename = sanitiseFilename(input.filename);
    const extension = extractExtension(filename);
    const storageKey = generateStorageKey();
    const adapter = defaultStorage();

    const writtenBytes = await adapter.put(storageKey, Buffer.from(input.ciphertext, 'base64'));
    if (writtenBytes === 0) {
      await adapter.delete(storageKey);
      throw ApiError.badRequest('The uploaded file is empty', 'EMPTY_FILE');
    }

    try {
      const file = await prisma.secureFile.create({
        data: {
          ownerId: userId,
          noteId: input.noteId,
          storageKey,
          storageDriver: adapter.kind,
          status: 'READY',
          filename,
          mimeType: input.mimeType,
          encryptedBytes: writtenBytes,
          plaintextBytes: input.plaintextBytes,
          extension,
          wrappedFileKey: input.wrappedFileKey,
          fileKeyIv: input.fileKeyIv,
          wrappedForNoteKey: input.wrappedForNoteKey,
          noteKeyWrapIv: input.noteKeyWrapIv,
          fileIv: input.fileIv,
          encryptionVersion: input.encryptionVersion,
          algorithm: input.algorithm,
        },
      });

      await recordAudit({
        userId,
        action: AuditAction.FILE_CREATE,
        targetType: 'FILE',
        targetId: file.id,
        noteId: file.noteId,
        metadata: {
          filename: file.filename,
          mimeType: file.mimeType,
          encryptedBytes: file.encryptedBytes,
        },
        ipAddress: requestIp(req),
      });

      res.status(201).json({
        file: toSecureFileDto(file, { includeWrappedKey: true, includeNoteKeyWrap: true }),
      });
    } catch (error) {
      // Do not leave an orphaned blob behind if the record could not be created.
      await adapter.delete(storageKey);
      throw error;
    }
  }),
);

/**
 * POST /api/files/init
 *
 * Step 1 of the direct upload used for large files: validate + authorise +
 * reserve quota, create a PENDING row, and hand the browser a short-lived
 * presigned PUT. The blob then goes straight to storage, never through the
 * API, which keeps it under serverless request-size limits. Only backends
 * that support direct uploads can serve this route; clients fall back to the
 * single-shot POST /files when it answers DIRECT_UPLOAD_UNAVAILABLE.
 */
filesRouter.post(
  '/init',
  requireAuth,
  fileUploadLimiter,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(initFileSchema, req.body);

    await requireNoteOwnership(input.noteId, userId);
    await assertStorageQuota(userId, input.encryptedBytes);

    const adapter = defaultStorage();
    if (!adapter.supportsDirectUpload) {
      throw ApiError.badRequest(
        'Direct uploads are not available on this deployment. Use the single-request upload.',
        'DIRECT_UPLOAD_UNAVAILABLE',
      );
    }

    const filename = sanitiseFilename(input.filename);
    const extension = extractExtension(filename);
    const storageKey = generateStorageKey();

    const target = await adapter.createUploadTarget(storageKey);
    if (!target) {
      throw ApiError.internal('Could not create an upload target', 'UPLOAD_TARGET_FAILED');
    }

    const file = await prisma.secureFile.create({
      data: {
        ownerId: userId,
        noteId: input.noteId,
        storageKey,
        storageDriver: adapter.kind,
        status: 'PENDING',
        filename,
        mimeType: input.mimeType,
        // Declared size; /complete verifies it against the stored object.
        encryptedBytes: input.encryptedBytes,
        plaintextBytes: input.plaintextBytes,
        extension,
        wrappedFileKey: input.wrappedFileKey,
        fileKeyIv: input.fileKeyIv,
        wrappedForNoteKey: input.wrappedForNoteKey,
        noteKeyWrapIv: input.noteKeyWrapIv,
        fileIv: input.fileIv,
        encryptionVersion: input.encryptionVersion,
        algorithm: input.algorithm,
      },
    });

    res.status(201).json({
      file: toSecureFileDto(file, { includeWrappedKey: true, includeNoteKeyWrap: true }),
      upload: { mode: 'direct', url: target.url, headers: target.headers },
    });
  }),
);

/**
 * POST /api/files/complete
 *
 * Step 2: confirm the object landed in storage, check its size against the
 * declared metadata, and flip the row to READY. A missing or truncated object
 * is rejected (and removed) so a half-finished upload can never be downloaded.
 */
filesRouter.post(
  '/complete',
  requireAuth,
  fileUploadLimiter,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(completeFileSchema, req.body);

    const file = await prisma.secureFile.findUnique({ where: { id: input.fileId } });
    if (!file || file.deletedAt) {
      throw ApiError.notFound('That file does not exist', 'FILE_NOT_FOUND');
    }
    if (file.ownerId !== userId) {
      throw ApiError.forbidden('Only the uploader can complete this upload', 'NOT_FILE_OWNER');
    }
    await requireNoteOwnership(file.noteId, userId);

    const adapter = storageFor(driverOf(file));
    const object = await adapter.head(file.storageKey);
    if (!object) {
      throw ApiError.badRequest('The upload was not received. Try again.', 'UPLOAD_INCOMPLETE');
    }
    if (object.bytes !== file.encryptedBytes) {
      await adapter.delete(file.storageKey);
      throw ApiError.badRequest(
        'The upload was truncated. Try again.',
        'UPLOAD_SIZE_MISMATCH',
      );
    }

    const updated = await prisma.secureFile.update({
      where: { id: file.id },
      data: { status: 'READY' },
    });

    await recordAudit({
      userId,
      action: AuditAction.FILE_CREATE,
      targetType: 'FILE',
      targetId: updated.id,
      noteId: updated.noteId,
      metadata: {
        filename: updated.filename,
        mimeType: updated.mimeType,
        encryptedBytes: updated.encryptedBytes,
        direct: true,
      },
      ipAddress: requestIp(req),
    });

    res.json({
      file: toSecureFileDto(updated, { includeWrappedKey: true, includeNoteKeyWrap: true }),
    });
  }),
);

/**
 * GET /api/files?noteId=... | ?scope=all
 *
 * With `noteId`: files attached to one note. The caller must be able to read
 * the note; the wrapped key is only included for the owner (recipients receive
 * their copy via their own share flow - see the client file module).
 *
 * With `scope=all`: every file the caller uploaded, across all their notes -
 * what the "Secure files" page lists. Only the uploader's own master-key wrap
 * is returned, which is exactly what that page needs.
 */
filesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const scope = typeof req.query.scope === 'string' ? req.query.scope.trim() : '';

    if (scope === 'all') {
      const owned = await prisma.secureFile.findMany({
        where: { ownerId: userId, deletedAt: null, status: 'READY' },
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        files: owned.map((file) =>
          toSecureFileDto(file, { includeWrappedKey: true, includeNoteKeyWrap: true }),
        ),
      });
      return;
    }

    const noteId = typeof req.query.noteId === 'string' ? req.query.noteId.trim() : '';
    if (!noteId || noteId.length > 64) {
      throw ApiError.badRequest('A noteId query parameter is required', 'VALIDATION_ERROR');
    }

    await requireNoteAccess(noteId, userId);

    const files = await prisma.secureFile.findMany({
      where: { noteId, deletedAt: null, status: 'READY' },
      orderBy: { createdAt: 'desc' },
    });

    const access = await prisma.note.findUnique({ where: { id: noteId }, select: { ownerId: true } });
    const isOwner = access?.ownerId === userId;

    // Both authorised callers (owner and share recipients) can unwrap the file
    // key via the note key, so the note-key-wrapped copy is included for all
    // of them. The master-key-wrapped copy stays owner-only.
    res.json({
      files: files.map((file) =>
        toSecureFileDto(file, { includeWrappedKey: isOwner, includeNoteKeyWrap: true }),
      ),
    });
  }),
);

/**
 * GET /api/files/:id/content
 *
 * Returns the encrypted blob to an authorised caller. The client decrypts with
 * the per-file key it unwraps locally.
 *
 * A backend that supports signed URLs answers with a 302 to one valid for
 * `SIGNED_URL_TTL_SECONDS` (60s) instead of proxying the bytes, so a large
 * download never has to pass through the API function. The redirect target is
 * still ciphertext, and the authorisation + audit happen here first.
 */
filesRouter.get(
  '/:id/content',
  requireAuth,
  fileDownloadLimiter,
  asyncHandler(async (req, res) => {
    const { file } = await loadFileAccess(req, req.params.id);
    if (!idParamSchema.safeParse(req.params.id).success) {
      throw ApiError.badRequest('Invalid file id', 'VALIDATION_ERROR');
    }

    const adapter = storageFor(driverOf(file));

    await recordAudit({
      userId: currentUserId(req),
      action: AuditAction.FILE_DOWNLOAD,
      targetType: 'FILE',
      targetId: file.id,
      noteId: file.noteId,
      metadata: { filename: file.filename, bytes: file.encryptedBytes, signed: adapter.supportsDirectUpload },
      ipAddress: requestIp(req),
    });

    const signedUrl = await adapter.createDownloadUrl(file.storageKey, env.signedUrlTtlSeconds);
    if (signedUrl) {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, signedUrl);
      return;
    }

    const blob = await adapter.get(file.storageKey);
    if (blob.byteLength !== file.encryptedBytes) {
      // Storage drifted from the database - fail closed rather than serving
      // something the client cannot authenticate.
      throw ApiError.internal('Stored file is incomplete', 'FILE_STORAGE_MISMATCH');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(blob.byteLength));
    res.setHeader('Content-Disposition', `attachment; filename="${file.id}.bin"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(blob);
  }),
);

/** GET /api/files/:id - metadata for one file (authorised callers only). */
filesRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { file, userId } = await loadFileAccess(req, req.params.id);
    const note = await prisma.note.findUnique({ where: { id: file.noteId }, select: { ownerId: true } });
    const isOwner = note?.ownerId === userId;
    res.json({
      file: toSecureFileDto(file, { includeWrappedKey: isOwner, includeNoteKeyWrap: true }),
    });
  }),
);

/**
 * DELETE /api/files/:id - soft delete.
 *
 * The uploader can always remove their own upload; the note OWNER can also
 * remove any file attached to their note (they control the note's contents).
 * A share recipient has neither right. The blob is removed from storage
 * immediately; the row is kept for the audit trail.
 */
filesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { file, userId } = await loadFileAccess(req, req.params.id);
    if (file.ownerId !== userId) {
      await requireNoteOwnership(file.noteId, userId);
    }

    await storageFor(driverOf(file)).delete(file.storageKey);
    await prisma.secureFile.update({
      where: { id: file.id },
      data: { deletedAt: new Date() },
    });

    await recordAudit({
      userId,
      action: AuditAction.FILE_DELETE,
      targetType: 'FILE',
      targetId: file.id,
      noteId: file.noteId,
      metadata: { filename: file.filename },
      ipAddress: requestIp(req),
    });

    res.status(204).send();
  }),
);
