import fs from 'node:fs';
import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { PrismaPg } from '../server/node_modules/@prisma/adapter-pg/dist/index.js';

const Adp = PrismaPg;

const env = fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8');
const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
const u = new URL(m[1]);
const endpoint = u.hostname.split('-pooler')[0];

const adapter = new Adp({
  connectionString: `postgresql://${encodeURIComponent(
    decodeURIComponent(u.username),
  )}:${encodeURIComponent(decodeURIComponent(u.password))}@3.18.239.121:5432${u.pathname}?uselibpqcompat=true&sslmode=require&options=${encodeURIComponent('endpoint=' + endpoint)}`,
  max: 1,
});

const client = new PrismaClient({ adapter });
await client.$connect();

try {
  const rows = await client.$queryRaw`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name
  `;
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error('query failed:', e.message);
} finally {
  await client.$disconnect();
}
