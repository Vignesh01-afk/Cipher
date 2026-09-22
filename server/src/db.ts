import { PrismaClient } from '@prisma/client';

// A single Prisma client for the whole process. In development `tsx watch`
// reloads modules, so we cache the instance on `globalThis` to avoid opening a
// new connection pool on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
