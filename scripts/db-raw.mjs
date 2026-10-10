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

const rows = await c.$queryRaw`
  SELECT id, email, token_version, auth_version, recovery_key_hash, recovery_data, recovery_created_at, otp_code_hash, otp_created_at, updated_at
  FROM public."user"
  ORDER BY created_at
`;
console.log(JSON.stringify(rows, null, 2));

await c.$disconnect();
