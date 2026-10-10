// One-off: can the Neon DB answer at all when we dial by IP (bypassing the
// broken local resolver)? Uses the project's own `pg` driver. Prints only
// pass/fail and sanitized errors - never credentials.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `pg` is a server dependency; resolve it from the server package.
const pg = createRequire(path.join(root, 'server', 'package.json'))('pg');
const envText = fs.readFileSync(path.join(root, 'server', '.env'), 'utf8');
const m = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) {
  console.log('NO_DATABASE_URL');
  process.exit(2);
}
const url = new URL(m[1]);
const hostname = url.hostname;

const ips = process.argv.slice(2);
if (ips.length === 0) {
  console.log('usage: node scripts/db-pg-by-ip.mjs <ip> [ip...]');
  process.exit(2);
}

const sanitize = (e) =>
  `${e.code ?? ''} ${(e.message ?? String(e)).replace(/:[0-9]+/, ':***')}`.trim();

for (const ip of ips) {
  const cfg = {
    host: ip,
    port: 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '') || 'neondb',
    ssl: { rejectUnauthorized: false, servername: hostname },
    connectionTimeoutMillis: 12_000,
    query_timeout: 12_000,
  };
  const client = new pg.Client(cfg);
  const t0 = Date.now();
  try {
    await client.connect();
    const r = await client.query('SELECT 1 AS ok');
    console.log(`OK ip=${ip} select1=${r.rows[0].ok} in ${Date.now() - t0}ms`);
    await client.end();
    process.exit(0);
  } catch (e) {
    console.log(`FAIL ip=${ip} in ${Date.now() - t0}ms -> ${sanitize(e)}`);
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}
process.exit(1);
