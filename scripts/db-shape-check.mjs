// Prints only the SHAPE of stored recovery hashes (length, separator style),
// never the values themselves, so we can tell if they are compatible with the
// current `recoveryVerifier` format.
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

const shape = await client.query(
  `SELECT length("recoveryKeyHash") AS len,
          ("recoveryKeyHash" LIKE '%:%') AS has_colon,
          ("recoveryKeyHash" ~ '^[a-f0-9]{64}$') AS pure_hex64,
          count(*) AS n
     FROM "User"
    WHERE "recoveryKeyHash" IS NOT NULL
    GROUP BY 1, 2, 3
    ORDER BY n DESC`,
);
console.log('recoveryKeyHash shapes:', JSON.stringify(shape.rows));

await client.end();
