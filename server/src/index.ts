import { createServer } from 'node:http';
import { env } from './env';
import { prisma, onReady } from './db';
import { createApp } from './app';
import { attachSocketServer } from './socket';

/**
 * Local development entry point. The same app is served on Vercel through the
 * serverless function at the repository root (`api/index.ts`).
 */
const app = createApp();
const server = createServer(app);
const io = attachSocketServer(server);

// Surface fatal socket-layer errors without crashing the API.
io.engine.on('connection_error', (err: { code: number; message: string }) => {
  console.warn(`[ciphernote] socket connection error ${err.code}: ${err.message}`);
});

server.listen(env.port, () => {
  console.log(`[ciphernote] API listening on http://localhost:${env.port}`);
  console.log(`[ciphernote] CORS origin(s): ${env.clientOrigin}`);
  console.log('[ciphernote] Socket.IO attached - realtime chat enabled.');
  console.log('[ciphernote] The server stores ciphertext only - it holds no note keys.');
  // Warm up the database once the socket layer is up. Neon (and other managed
  // Postgres) scale compute to zero between requests, so the first real
  // request is not the one that pays for the wake-up. The warm-up retries on
  // its own (2 s, then 4 s) and never blocks startup.
  void onReady();
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
