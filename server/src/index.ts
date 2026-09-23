import { env } from './env';
import { prisma } from './db';
import { createApp } from './app';

/**
 * Local development entry point. The same app is served on Vercel through the
 * serverless function at the repository root (`api/index.ts`).
 */
const app = createApp();
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
