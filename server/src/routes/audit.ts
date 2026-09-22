import { Router } from 'express';
import { prisma } from '../db';
import { AUDIT_ACTION_VALUES } from '../lib/audit';
import { ApiError, asyncHandler } from '../lib/http';
import { toAuditLogDto } from '../lib/serialize';
import { currentUserId, requireAuth } from '../middleware/auth';

export const auditRouter = Router();

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

/**
 * GET /api/audit?action=NOTE_SHARE&limit=100
 *
 * Returns the *caller's own* audit trail. There is deliberately no endpoint
 * that exposes another user's activity, and no log line ever contains note
 * plaintext (see AuditMetadata in lib/audit.ts).
 */
auditRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);

    const actionParam = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    if (actionParam && !AUDIT_ACTION_VALUES.includes(actionParam)) {
      throw ApiError.badRequest('Unknown audit action filter', 'VALIDATION_ERROR', {
        field: 'action',
        allowed: AUDIT_ACTION_VALUES,
      });
    }

    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const logs = await prisma.auditLog.findMany({
      where: { userId, ...(actionParam ? { action: actionParam } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({ logs: logs.map(toAuditLogDto), limit });
  }),
);
