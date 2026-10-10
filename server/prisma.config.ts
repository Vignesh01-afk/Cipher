import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from '@prisma/config';

/**
 * Prisma 7 CLI configuration.
 *
 * Prisma 7 no longer reads `url = env("DATABASE_URL")` from the datasource
 * block in schema.prisma - the CLI takes it from here instead, and it is
 * mandatory for migration commands (`migrate deploy`, `migrate dev`, `db push`).
 *
 * This file MUST live at the package root (next to package.json): Prisma only
 * discovers `prisma.config.ts` relative to the working directory of the CLI,
 * not next to schema.prisma.
 *
 * The application runtime does not use this file: src/db.ts passes the
 * connection string to the PrismaClient constructor explicitly.
 *
 * `import 'dotenv/config'` makes `prisma ...` work with just server/.env
 * present; an explicit DATABASE_URL in the environment still wins, because
 * dotenv never overwrites variables that are already set.
 */
export default defineConfig({
  schema: path.resolve(__dirname, 'prisma', 'schema.prisma'),
  datasource: { url: env('DATABASE_URL') },
});
