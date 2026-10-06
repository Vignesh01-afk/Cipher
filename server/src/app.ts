import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env';
import { prisma } from './db';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import { createRateLimitStore } from './lib/rateLimitStore';

/**
 * The Express app, factored out of `index.ts` so that both the local
 * development entry point (`index.ts`) and the Vercel serverless function
 * (`api/index.ts` at the repository root) can mount the same API.
 */
export function createApp(): express.Express {
  const app = express();

  // Behind a reverse proxy in production this makes req.ip reflect the client.
  // Vercel routes requests through its own edge proxies, so this is required
  // for rate limiting to key on the real client IP. `req.ip` (not the raw
  // X-Forwarded-For header) is the only client address the app trusts.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      // Requests without an Origin header (same-origin fetches, curl,
      // server-to-server) are allowed. Cross-origin browsers must match
      // CLIENT_ORIGIN (comma-separated). The deployed app is same-origin, so
      // the browser never enforces this; it only matters for external clients.
      origin: (requestOrigin, callback) => {
        if (!requestOrigin) {
          callback(null, true);
          return;
        }
        const allowed = env.clientOrigin.split(',').map((value) => value.trim());
        callback(null, allowed.includes(requestOrigin));
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );

  // `ok` only proves the process is up. `dbOk` probes the database so callers
  // (deploy checks, the E2E pre-flight) can tell "API up" from "API can serve".
  // The response stays 200 either way so the process is never marked unhealthy
  // just because a managed Postgres scaled to zero. Registered before the
  // limiter so health checks never consume a client's quota.
  app.get('/api/health', async (_req, res) => {
    let dbOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    res.json({
      ok: true,
      dbOk,
      service: 'ciphernote-api',
      encryption: {
        noteCipher: 'AES-GCM-256',
        ownerKeyWrap: 'AES-GCM-256 (master key)',
        shareKeyWrap: 'RSA-OAEP-2048/SHA-256',
        passwordKdf: 'PBKDF2-SHA256',
      },
      serverStoresPlaintext: false,
      time: new Date().toISOString(),
    });
  });

  // A coarse ceiling for the whole API; the credential endpoints add their own
  // much tighter limiters on top of this. The limiter runs BEFORE any body
  // parser so an oversized or slow request is rejected without being buffered.
  // Counters live in Upstash when configured, so the limit holds across
  // serverless instances; otherwise express-rate-limit's in-memory store is
  // used (single instance / local dev).
  const sharedStore = createRateLimitStore();
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: sharedStore,
      message: { error: 'Too many requests, slow down.', code: 'RATE_LIMITED' },
    }),
  );

  // Per-path body ceilings, mounted from largest to smallest. A parser that
  // sees an already-parsed body (`req._body`) is a no-op, so the wider parsers
  // must be registered first for their paths to win over the 100 kb default.
  app.use('/api/files', express.json({ limit: env.maxFileUploadBodyBytes }));
  app.use('/api/notes', express.json({ limit: env.notesBodyLimit }));
  app.use('/api', express.json({ limit: env.jsonBodyLimit }));

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
