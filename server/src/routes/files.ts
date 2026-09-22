import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { env } from '../env';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { requireNoteAccess } from '../lib/access';
import { ApiError, asyncHandler, parseBody } from '../lib/http';
import {
  createFileSchema,
  extractExtension,
  idParamSchema,
  sanitiseFilename,
} from '../lib/schemas';
import { toSecureFileDto } from '../lib/serialize';
import { currentUserId, requireAuth } from '../middleware/auth';
import { deleteBlob, generateStorageKey, readBlob, writeBlob } from '../lib/storage';

export const filesRouter = Router();

// Files are large; a tight limiter prevents storage exhaustion via replay.
const fileUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many file uploads. Please wait before trying again.', code: 'RATE_LIMITED' },
});

const fileDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many file requests. Please wait before trying again.', code: 'RATE_LIMITED' },
});

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
 * Stores an encrypted file blob. The browser has already:
 *   1. generated a fresh per-file AES-GCM-256 key,
 *   2. encrypted the file bytes with it,
 *   3. wrapped the file key with the uploader's master key.
 * The server receives only opaque blobs and metadata, and validates that the
 * uploader can access the target note.
 */
filesRouter.post(
  '/',
  requireAuth,
  fileUploadLimiter,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(createFileSchema, req.body);

    // Authorization BEFORE any bytes are written: the uploader must be able to
    // read the note they are attaching to.
    await requireNoteAccess(input.noteId, userId);

    const filename = sanitiseFilename(input.filename);
    const extension = extractExtension(filename);
    const storageKey = generateStorageKey();

    const writtenBytes = await writeBlob(storageKey, input.ciphertext);
    if (writtenBytes === 0) {
      await deleteBlob(storageKey);
      throw ApiError.badRequest('The uploaded file is empty', 'EMPTY_FILE');
    }

    try {
      const file = await prisma.secureFile.create({
        data: {
          ownerId: userId,
          noteId: input.noteId,
          storageKey,
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
      await deleteBlob(storageKey);
      throw error;
    }
  }),
);

/**
 * GET /api/files?noteId=...
 *
 * Lists files attached to one note. The caller must be able to read the note;
 * the wrapped key is only included for the owner (recipients receive their
 * copy via their own share flow - see the client file module).
 */
filesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const noteId = typeof req.query.noteId === 'string' ? req.query.noteId.trim() : '';
    if (!noteId || noteId.length > 64) {
      throw ApiError.badRequest('A noteId query parameter is required', 'VALIDATION_ERROR');
    }

    await requireNoteAccess(noteId, userId);

    const files = await prisma.secureFile.findMany({
      where: { noteId, deletedAt: null },
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
 * Streams the encrypted blob back to an authorised caller. The client decrypts
 * with the per-file key it unwraps locally. Responses are marked no-store so
 * no browser or intermediary cache keeps a copy.
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

    const blob = await readBlob(file.storageKey);
    if (blob.byteLength !== file.encryptedBytes) {
      // Storage drifted from the database - fail closed rather than serving
      // something the client cannot authenticate.
      throw ApiError.internal('Stored file is incomplete', 'FILE_STORAGE_MISMATCH');
    }

    await recordAudit({
      userId: currentUserId(req),
      action: AuditAction.FILE_DOWNLOAD,
      targetType: 'FILE',
      targetId: file.id,
      noteId: file.noteId,
      metadata: { filename: file.filename, bytes: blob.byteLength },
      ipAddress: requestIp(req),
    });

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
 * Only the uploader (owner) may delete a file. The blob is removed from
 * storage immediately; the row is kept for the audit trail.
 */
filesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { file, userId } = await loadFileAccess(req, req.params.id);
    if (file.ownerId !== userId) {
      throw ApiError.forbidden('Only the user who uploaded this file can delete it', 'NOT_FILE_OWNER');
    }

    await deleteBlob(file.storageKey);
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

// Re-exported so app.ts can raise the JSON body ceiling for uploads only.
export const maxFileUploadBodyBytes = env.maxFileUploadBodyBytes;
