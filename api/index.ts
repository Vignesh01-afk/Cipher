import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from '../server/dist/app';

/**
 * Vercel serverless entry point.
 *
 * The Express app is built by `tsc` into `server/dist` during the Vercel build
 * step (see vercel.json -> buildCommand), then imported here so that every
 * request to /api/* is handled by exactly the same middleware stack as the
 * local development server. The Prisma client in `server/src/db.ts` caches
 * itself on `globalThis`, so warm lambda invocations reuse the connection.
 */
const app = createApp();

export default function handler(req: VercelRequest, res: VercelResponse): void {
  app(req, res);
}
