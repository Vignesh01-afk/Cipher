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
const RETRYABLE_CONNECTION_CODES = new Set(['P1001', 'P1017']);

function isRetryableConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RETRYABLE_CONNECTION_CODES.has(code);
}

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
  });

/**
 * One transparent retry on a dropped connection. Without this, a Neon idle
 * disconnect surfaces to the user as a generic 500 on the very next request
 * (registration, login, any read) even though a retry would have succeeded.
 */
export const prisma = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      try {
        return await query(args);
      } catch (error) {
        if (!isRetryableConnectionError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 120));
        return query(args);
      }
    },
  },
}) as unknown as PrismaClient;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
