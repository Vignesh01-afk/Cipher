import type { NextFunction, Request, Response } from 'express';
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
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearerToken(req);
  if (!token) {
    next(ApiError.unauthorized('Authentication required', 'UNAUTHORIZED'));
    return;
  }

  try {
    const payload = verifySessionToken(token);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch (error) {
    next(error);
  }
}

/** Convenience accessor for handlers running behind `requireAuth`. */
export function currentUserId(req: Request): string {
  if (!req.userId) {
    // Defensive: reaching here means the route was not mounted behind requireAuth.
    throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
  }
  return req.userId;
}
