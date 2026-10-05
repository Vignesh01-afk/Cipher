import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
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

  // Body-parser failures (express.json) are client errors, not server faults:
  // malformed JSON, an over-limit payload, or an unsupported charset. Without
  // this branch they fall through to the generic 500 below, which both hides
  // the real cause from the client and logs misleading "unhandled error" noise.
  if (typeof error === 'object' && error !== null) {
    const bodyError = error as { type?: unknown; status?: unknown; statusCode?: unknown };
    const type = typeof bodyError.type === 'string' ? bodyError.type : '';
    const status = typeof bodyError.status === 'number'
      ? bodyError.status
      : typeof bodyError.statusCode === 'number'
        ? bodyError.statusCode
        : 0;

    if (type === 'entity.too.large' || status === 413) {
      res.status(413).json({
        error: 'That request body is too large.',
        code: 'PAYLOAD_TOO_LARGE',
      });
      return;
    }
    if (type === 'entity.parse.failed' || (status === 400 && type.startsWith('entity.'))) {
      res.status(400).json({
        error: 'Request body is not valid JSON.',
        code: 'INVALID_JSON',
      });
      return;
    }
  }

  // Schema validation failures are client errors, not server faults.
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Request validation failed',
      code: 'VALIDATION_ERROR',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
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
