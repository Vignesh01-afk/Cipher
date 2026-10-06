import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db';
import { ApiError } from '../lib/http';
import { verifySessionToken } from '../lib/jwt';

/** Extracts a bearer token from the Authorization header. */
function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Rejects any request without a valid session token and attaches the resolved
 * user id to the request. Every protected route in the app is behind this.
 *
 * The token is not trusted on its own: the user's current `tokenVersion` is
 * loaded and compared against the `tv` claim, so logging out (or resetting a
 * password) instantly invalidates tokens that were already minted. This costs
 * one indexed primary-key read per authenticated request, which is the price
 * of revocable sessions.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readBearerToken(req);
  if (!token) {
    next(ApiError.unauthorized('Authentication required', 'UNAUTHORIZED'));
    return;
  }

  let payload: { sub: string; email: string; tv: number };
  try {
    payload = verifySessionToken(token);
  } catch (error) {
    next(error);
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { tokenVersion: true },
    });
    if (!user) {
      next(ApiError.unauthorized('This account no longer exists', 'ACCOUNT_MISSING'));
      return;
    }
    if ((user.tokenVersion ?? 0) !== (payload.tv ?? 0)) {
      next(ApiError.unauthorized('Your session has ended. Sign in again.', 'SESSION_REVOKED'));
      return;
    }
  } catch (error) {
    next(error);
    return;
  }

  req.userId = payload.sub;
  req.userEmail = payload.email;
  next();
}

/** Convenience accessor for handlers running behind `requireAuth`. */
export function currentUserId(req: Request): string {
  if (!req.userId) {
    // Defensive: reaching here means the route was not mounted behind requireAuth.
    throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
  }
  return req.userId;
}
