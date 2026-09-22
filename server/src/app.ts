import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';

/**
 * The Express app, factored out of `index.ts` so that both the local
 * development entry point (`index.ts`) and the Vercel serverless function
 * (`api/index.ts` at the repository root) can mount the same API.
 */
export function createApp(): express.Express {
  const app = express();

  // Behind a reverse proxy in production this makes req.ip reflect the client.
  // Vercel routes requests through its own edge proxies, so this is required
  // for rate limiting to key on the real client IP.
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
  // One parser only: stacking a second json parser for /api/files consumed
  // the stream twice and corrupted large upload bodies.
  app.use(express.json({ limit: env.maxFileUploadBodyBytes }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
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
  // much tighter limiter on top of this.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests, slow down.', code: 'RATE_LIMITED' },
    }),
  );

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
