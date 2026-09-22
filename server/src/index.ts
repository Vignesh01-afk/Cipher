import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env';
import { prisma } from './db';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';

const app = express();

// Behind a reverse proxy in production this makes req.ip reflect the client.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet());
app.use(
  cors({
    origin: env.clientOrigin.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: env.jsonBodyLimit }));

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

const server = app.listen(env.port, () => {
  console.log(`[ciphernote] API listening on http://localhost:${env.port}`);
  console.log(`[ciphernote] CORS origin(s): ${env.clientOrigin}`);
  console.log('[ciphernote] The server stores ciphertext only - it holds no note keys.');
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[ciphernote] ${signal} received, shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  // Do not hang forever if a connection refuses to close.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
