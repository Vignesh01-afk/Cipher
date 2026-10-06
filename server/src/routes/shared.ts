import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';
import { parsePagination } from '../lib/schemas';
import { toSharedNoteDto } from '../lib/serialize';
import { currentUserId, requireAuth } from '../middleware/auth';

export const sharedRouter = Router();

/**
 * GET /api/shared?cursor=&limit=
 *
 * Everything the current user has been given access to, newest grant first.
 * Only shares that have not been revoked are returned, so a revoked recipient
 * immediately stops seeing the note here.
 *
 * Same keyset pagination as GET /notes: `nextCursor` is the id of the last
 * share on this page, and one extra row is fetched to detect a next page.
 */
sharedRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const { cursor, limit } = parsePagination(req.query as Record<string, unknown>);

    const rows = await prisma.noteShare.findMany({
      where: { sharedWithId: userId, revokedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        note: {
          include: { owner: { select: { id: true, displayName: true, email: true } } },
        },
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const shares = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      shares: shares.map(toSharedNoteDto),
      nextCursor: hasMore ? shares[shares.length - 1]!.id : null,
    });
  }),
);
