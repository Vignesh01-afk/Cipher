import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';
import { toSharedNoteDto } from '../lib/serialize';
import { currentUserId, requireAuth } from '../middleware/auth';

export const sharedRouter = Router();

/**
 * GET /api/shared
 *
 * Everything the current user has been given access to. Only shares that have
 * not been revoked are returned, so a revoked recipient immediately stops
 * seeing the note here.
 */
sharedRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);

    const shares = await prisma.noteShare.findMany({
      where: { sharedWithId: userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        note: {
          include: { owner: { select: { id: true, displayName: true, email: true } } },
        },
      },
    });

    res.json({ shares: shares.map(toSharedNoteDto) });
  }),
);
