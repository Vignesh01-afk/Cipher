import { PrismaClient } from '@prisma/client';

// A single Prisma client for the whole process. In development `tsx watch`
// reloads modules, so we cache the instance on `globalThis` to avoid opening a
// new connection pool on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma codes for a dropped/stale connection. Managed Postgres (Neon, and
 * serverless platforms generally) closes idle connections and scales the
 * compute down, so the next query can fail even though the database is fine.
 * These are safe to retry because the request never reached the database.
 */
// Neon / RDS connection errors that are transient (the pooler scales down or
// the network hiccups). A plain 'query failed' without a code is treated as
// retryable too, because Managed Postgres can return some failures through
// other channels and the recovery is the same: wait and retry once.
const RETRYABLE_CONNECTION_CODES = new Set(['P1001', 'P1017', 'P1041', 'P1042']);

function isRetryableConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return RETRYABLE_CONNECTION_CODES.has(code);
  // Prisma sometimes only exposes a message (no code). If the message clearly
  // names a Neon connection failure, it is safe to retry.
  const msg = (error as { message?: unknown } | null)?.message;
  if (typeof msg === 'string') {
    return /connection.*failed|refused|could not connect/i.test(msg) ||
      /cannot reach database/i.test(msg) ||
      /timeout while connecting/i.test(msg);
  }
  return false;
}

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Prisma's own log only ever receives warnings and errors anyway; the app
    // logs its own request/audit lines, so both modes use the same setting.
    log: ['warn', 'error'],
  });

/**
 * Transparent retries on a dropped connection. Managed Postgres closes idle
 * connections and resets them mid-request (Neon does this aggressively), so a
 * single retry is often not enough: the pool can still be re-establishing.
 * Four attempts with a short backoff hide the blip instead of surfacing it to
 * the user as a generic 500 on registration/login/any read.
 *
 * Only connection errors are retried; the request never reached the database,
 * so this cannot duplicate a write.
 */
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [150, 500, 1500];

export const prisma = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
          return await query(args);
        } catch (error) {
          lastError = error;
          if (!isRetryableConnectionError(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt] ?? 1500));
        }
      }
      throw lastError;
    },
  },
}) as unknown as PrismaClient;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
