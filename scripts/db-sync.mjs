// One-off schema sync: brings the dev database in line with prisma/schema.prisma
// WITHOUT dropping data. Equivalent to `prisma db push`, except the legacy
// `User.recoveryKeyHash` column is RENAMED to `recoveryVerifier` instead of
// dropped: all 132 stored values are already the exact `salt:sha256(salt||v)`
// format that server/src/routes/auth.ts reads and writes today, so renaming
// preserves every account's recovery key. Safe to re-run (idempotent).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(path.join(root, 'server', 'package.json'))('pg');
const envText = fs.readFileSync(path.join(root, 'server', '.env'), 'utf8');
const m = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
const u = new URL(m[1]);
const endpoint = u.hostname.split('-pooler')[0];
const url =
  'postgresql://' + encodeURIComponent(decodeURIComponent(u.username)) + ':' +
  encodeURIComponent(decodeURIComponent(u.password)) +
  '@3.18.239.121:5432' + u.pathname +
  '?uselibpqcompat=true&sslmode=require&options=' +
  encodeURIComponent('endpoint=' + endpoint);

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 12000 });
await client.connect();

async function columnExists(table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rowCount > 0;
}

// 1. SecureFile: additive columns from the schema.
if (!(await columnExists('SecureFile', 'status'))) {
  await client.query(`ALTER TABLE "SecureFile" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'READY'`);
  console.log('added SecureFile.status');
}
if (!(await columnExists('SecureFile', 'storageDriver'))) {
  await client.query(`ALTER TABLE "SecureFile" ADD COLUMN "storageDriver" TEXT NOT NULL DEFAULT 'local'`);
  console.log('added SecureFile.storageDriver');
}

// 2. User: legacy verifier column is a pure rename (same salt:hash format).
if ((await columnExists('User', 'recoveryKeyHash')) && !(await columnExists('User', 'recoveryVerifier'))) {
  await client.query(`ALTER TABLE "User" RENAME COLUMN "recoveryKeyHash" TO "recoveryVerifier"`);
  console.log('renamed User.recoveryKeyHash -> User.recoveryVerifier (data preserved)');
}

// 3. User: additive credential columns.
if (!(await columnExists('User', 'authVersion'))) {
  await client.query(`ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 1`);
  console.log('added User.authVersion');
}
if (!(await columnExists('User', 'tokenVersion'))) {
  await client.query(`ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0`);
  console.log('added User.tokenVersion');
}

const cols = await client.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name='User' AND table_schema='public' ORDER BY ordinal_position`,
);
console.log('User columns now:', cols.rows.map((r) => r.column_name).join(', '));

await client.end();
