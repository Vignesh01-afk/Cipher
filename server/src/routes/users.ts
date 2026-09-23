import { Router } from 'express';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../lib/http';
import { lookupQuerySchema, normaliseEmail } from '../lib/schemas';
import { toPublicProfile } from '../lib/serialize';
import { requireAuth } from '../middleware/auth';

export const usersRouter = Router();

/**
 * GET /api/users/lookup?email=...
 *
 * Returns the minimum needed to share a note securely: the recipient's id,
 * display name and *public* key. Private key material is never exposed here.
 *
 * Known limitation (documented in the README): exact-match lookup lets any
 * authenticated user confirm whether an address is registered.
 */
usersRouter.get(
  '/lookup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = lookupQuerySchema.safeParse({ email: req.query.email });
    if (!parsed.success) {
      throw ApiError.badRequest('Provide a valid email address to look up', 'VALIDATION_ERROR', {
        field: 'email',
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: normaliseEmail(parsed.data.email) },
      select: { id: true, email: true, displayName: true, publicKey: true },
    });

    if (!user) {
      throw ApiError.notFound('No CipherNote account uses that email address', 'USER_NOT_FOUND');
    }

    res.json({ user: toPublicProfile(user) });
  }),
);
