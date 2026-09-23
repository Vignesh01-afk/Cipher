import { Router, type Request } from 'express';
import { prisma } from '../db';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { hasRevokedShare, requireNoteAccess, requireNoteOwnership, type NoteAccess } from '../lib/access';
import { ApiError, asyncHandler, parseBody } from '../lib/http';
import { createNoteSchema, createShareSchema, updateNoteSchema } from '../lib/schemas';
import { noteInclude, toNoteDto, toShareDto } from '../lib/serialize';
import { currentUserId, requireAuth } from '../middleware/auth';

export const notesRouter = Router();

/**
 * Resolves the caller's access to the note in `req.params.id`.
 *
 * If access is denied because a share was revoked, we record that attempt in
 * the caller's audit trail before rejecting - so the demo flow "Alice revokes
 * Bob, Bob is denied, and the denial is logged" is fully observable.
 */
async function loadAccess(req: Request): Promise<NoteAccess> {
  const userId = currentUserId(req);
  const noteId = req.params.id;

  try {
    return await requireNoteAccess(noteId, userId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOTE_ACCESS_DENIED') {
      const wasRevoked = await hasRevokedShare(noteId, userId);
      await recordAudit({
        userId,
        action: AuditAction.ACCESS_DENIED,
        targetType: 'NOTE',
        targetId: noteId,
        noteId,
        metadata: { reason: wasRevoked ? 'REVOKED_SHARE' : 'NO_ACTIVE_SHARE' },
        ipAddress: requestIp(req),
      });
    }
    throw error;
  }
}

/**
 * GET /api/notes
 *
 * The owner's own notes. Ciphertext only - the browser decrypts and then
 * performs search locally.
 */
notesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const notes = await prisma.note.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      include: noteInclude,
    });

    res.json({
      notes: notes.map((note) =>
        toNoteDto(note, { role: 'owner', includeShares: true }),
      ),
    });
  }),
);

/**
 * POST /api/notes
 *
 * Stores an opaque AES-GCM blob together with the note key wrapped to the
 * owner's master key. The server cannot read the title, body or tags.
 */
notesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(createNoteSchema, req.body);

    const note = await prisma.note.create({
      data: {
        ownerId: userId,
        ciphertext: input.ciphertext,
        iv: input.iv,
        encryptionVersion: input.encryptionVersion,
        algorithm: input.algorithm,
        payloadBytes: input.payloadBytes,
        wrappedNoteKey: input.wrappedNoteKey,
        noteKeyIv: input.noteKeyIv,
      },
      include: noteInclude,
    });

    await recordAudit({
      userId,
      action: AuditAction.NOTE_CREATE,
      targetType: 'NOTE',
      targetId: note.id,
      noteId: note.id,
      metadata: {
        encryptionVersion: note.encryptionVersion,
        algorithm: note.algorithm,
        payloadBytes: note.payloadBytes,
      },
      ipAddress: requestIp(req),
    });

    res.status(201).json({ note: toNoteDto(note, { role: 'owner', includeShares: true }) });
  }),
);

/** GET /api/notes/:id - owner or an unrevoked share holder. */
notesRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await loadAccess(req);

    const note = await prisma.note.findUnique({
      where: { id: access.note.id },
      include: noteInclude,
    });
    if (!note) {
      throw ApiError.notFound('That note does not exist', 'NOTE_NOT_FOUND');
    }

    res.json({
      note: toNoteDto(note, {
        role: access.role,
        wrappedKey: access.share?.wrappedKey ?? null,
        keyAlgorithm: access.share?.keyAlgorithm ?? null,
        includeShares: access.role === 'owner',
      }),
    });
  }),
);

/** PATCH /api/notes/:id - owner only. Ciphertext is replaced wholesale. */
notesRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(updateNoteSchema, req.body);
    await requireNoteOwnership(req.params.id, userId);

    const note = await prisma.note.update({
      where: { id: req.params.id },
      data: {
        ...(input.ciphertext !== undefined ? { ciphertext: input.ciphertext } : {}),
        ...(input.iv !== undefined ? { iv: input.iv } : {}),
        ...(input.encryptionVersion !== undefined
          ? { encryptionVersion: input.encryptionVersion }
          : {}),
        ...(input.payloadBytes !== undefined ? { payloadBytes: input.payloadBytes } : {}),
        ...(input.wrappedNoteKey !== undefined ? { wrappedNoteKey: input.wrappedNoteKey } : {}),
        ...(input.noteKeyIv !== undefined ? { noteKeyIv: input.noteKeyIv } : {}),
      },
      include: noteInclude,
    });

    await recordAudit({
      userId,
      action: AuditAction.NOTE_UPDATE,
      targetType: 'NOTE',
      targetId: note.id,
      noteId: note.id,
      metadata: {
        encryptionVersion: note.encryptionVersion,
        payloadBytes: note.payloadBytes,
        keyRotated: input.wrappedNoteKey !== undefined,
      },
      ipAddress: requestIp(req),
    });

    res.json({ note: toNoteDto(note, { role: 'owner', includeShares: true }) });
  }),
);

/** DELETE /api/notes/:id - owner only. Shares cascade away with the note. */
notesRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const note = await requireNoteOwnership(req.params.id, userId);

    await prisma.note.delete({ where: { id: note.id } });

    // The note row is gone, so this entry keeps `targetId` only (noteId is
    // nulled by the FK's onDelete: SetNull).
    await recordAudit({
      userId,
      action: AuditAction.NOTE_DELETE,
      targetType: 'NOTE',
      targetId: note.id,
      noteId: null,
      metadata: { deletedNoteId: note.id, encryptionVersion: note.encryptionVersion },
      ipAddress: requestIp(req),
    });

    res.status(204).send();
  }),
);

/** GET /api/notes/:id/shares - owner only; includes revoked entries for history. */
notesRouter.get(
  '/:id/shares',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await requireNoteOwnership(req.params.id, userId);

    const shares = await prisma.noteShare.findMany({
      where: { noteId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: { sharedWith: { select: { id: true, displayName: true, email: true } } },
    });

    res.json({
      shares: shares.map((share) => toShareDto(share, { includeWrappedKey: true })),
    });
  }),
);

/**
 * POST /api/notes/:id/shares
 *
 * The client has already wrapped the note key with the recipient's public key;
 * the server only stores the result. Re-sharing after a revocation clears
 * `revokedAt`, restoring access.
 */
notesRouter.post(
  '/:id/shares',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(createShareSchema, req.body);
    const note = await requireNoteOwnership(req.params.id, userId);

    if (input.userId === userId) {
      throw ApiError.badRequest('You already own this note', 'CANNOT_SHARE_WITH_SELF');
    }

    const recipient = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, displayName: true, email: true },
    });
    if (!recipient) {
      throw ApiError.notFound('That recipient does not exist', 'USER_NOT_FOUND');
    }

    // Look the previous share up first so the audit entry can distinguish a
    // fresh grant from re-granting access that was revoked earlier.
    const previousShare = await prisma.noteShare.findUnique({
      where: { noteId_sharedWithId: { noteId: note.id, sharedWithId: recipient.id } },
      select: { revokedAt: true },
    });
    const restoredAfterRevocation = Boolean(previousShare?.revokedAt);

    const share = await prisma.noteShare.upsert({
      where: { noteId_sharedWithId: { noteId: note.id, sharedWithId: recipient.id } },
      create: {
        noteId: note.id,
        ownerId: userId,
        sharedWithId: recipient.id,
        wrappedKey: input.wrappedKey,
      },
      update: {
        wrappedKey: input.wrappedKey,
        revokedAt: null,
        keyAlgorithm: 'RSA-OAEP-2048-SHA256',
      },
      include: { sharedWith: { select: { id: true, displayName: true, email: true } } },
    });

    await recordAudit({
      userId,
      action: AuditAction.NOTE_SHARE,
      targetType: 'SHARE',
      targetId: share.id,
      noteId: note.id,
      metadata: {
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        keyAlgorithm: share.keyAlgorithm,
        restoredAfterRevocation,
      },
      ipAddress: requestIp(req),
    });

    res.status(201).json({ share: toShareDto(share, { includeWrappedKey: true }) });
  }),
);

/**
 * DELETE /api/notes/:id/shares/:userId
 *
 * Revocation. The share row is kept but marked `revokedAt`, which removes it
 * from every authorization check immediately. This is an access-control
 * change, not cryptographic erasure - see the README's revocation section.
 */
notesRouter.delete(
  '/:id/shares/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ownerId = currentUserId(req);
    const note = await requireNoteOwnership(req.params.id, ownerId);
    const targetUserId = req.params.userId;

    if (targetUserId === ownerId) {
      throw ApiError.badRequest('You cannot revoke your own access', 'CANNOT_REVOKE_OWNER');
    }

    const existing = await prisma.noteShare.findUnique({
      where: { noteId_sharedWithId: { noteId: note.id, sharedWithId: targetUserId } },
      include: { sharedWith: { select: { id: true, displayName: true, email: true } } },
    });

    if (!existing) {
      throw ApiError.notFound('That user does not have a share on this note', 'SHARE_NOT_FOUND');
    }
    if (existing.revokedAt) {
      throw ApiError.conflict('That share has already been revoked', 'SHARE_ALREADY_REVOKED');
    }

    const share = await prisma.noteShare.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
      include: { sharedWith: { select: { id: true, displayName: true, email: true } } },
    });

    await recordAudit({
      userId: ownerId,
      action: AuditAction.SHARE_REVOKE,
      targetType: 'SHARE',
      targetId: share.id,
      noteId: note.id,
      metadata: {
        recipientId: share.sharedWithId,
        recipientEmail: share.sharedWith.email,
        revokedAt: share.revokedAt ? share.revokedAt.toISOString() : null,
      },
      ipAddress: requestIp(req),
    });

    res.json({ share: toShareDto(share, { includeWrappedKey: true }) });
  }),
);
