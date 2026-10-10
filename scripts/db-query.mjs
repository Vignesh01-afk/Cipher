import fs from 'node:fs';

import { PrismaClient } from '../server/node_modules/.prisma/client/index.js';
import { PrismaPg } from '../server/node_modules/@prisma/adapter-pg/dist/index.js';
const Adp = PrismaPg;
const env = fs.readFileSync(new URL('../server/.env', import.meta.url), 'utf8');
const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
const u = new URL(m[1]);
const endpoint = u.hostname.split('-pooler')[0];
const adp = new Adp({
  connectionString: `postgresql://${encodeURIComponent(
    decodeURIComponent(u.username),
  )}:${encodeURIComponent(decodeURIComponent(u.password))}@3.18.239.121:5432${u.pathname}?uselibpqcompat=true&sslmode=require&options=${encodeURIComponent('endpoint=' + endpoint)}`,
  max: 1,
});
const c = new PrismaClient({ adapter: adp });

const rows = await c.user.findMany({
  where: { email: { startsWith: 'e2e.' } },
  orderBy: { createdAt: 'asc' },
  select: { email: true, authVersion: true, tokenVersion: true, createdAt: true },
});
const hasRevoked = rows.filter((r) => r.tokenVersion > 0);
console.log('total:', rows.length, 'revoked:', hasRevoked.length);
for (const r of hasRevoked) console.log(JSON.stringify(r));

await c.$disconnect();
