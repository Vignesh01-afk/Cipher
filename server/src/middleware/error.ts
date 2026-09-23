import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../lib/http';
import { env } from '../env';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `No API route matches ${req.method} ${req.path}`,
    code: 'ROUTE_NOT_FOUND',
  });
}

/**
 * The single place where errors become HTTP responses. Only explicitly
 * constructed `ApiError`s expose their message; everything else is generic so
 * that internal details (SQL, stack traces, file paths) never reach a client.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'That record already exists', code: 'CONFLICT' });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'Resource not found', code: 'NOT_FOUND' });
      return;
    }
  }

  if (!env.isProduction) {
    console.error('[api] unhandled error', error);
  } else {
    console.error('[api] unhandled error:', error instanceof Error ? error.message : 'unknown');
  }

  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
}
