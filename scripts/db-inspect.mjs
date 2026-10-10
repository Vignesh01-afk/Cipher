// Diagnostic: list public-schema tables, User columns, and applied migration rows.
// Reads credentials from server/.env; prints none of them.
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

const tables = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
);
console.log('tables:', tables.rows.map((r) => r.table_name).join(', '));

const cols = await client.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='User' AND table_schema='public' ORDER BY ordinal_position`,
);
console.log('User columns:', cols.rows.map((r) => r.column_name).join(', '));

const mig = await client.query(
  `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 5`,
).catch((e) => ({ rows: [{ error: String(e.message).slice(0, 120) }] }));
console.log('migration rows:', JSON.stringify(mig.rows));

await client.end();
