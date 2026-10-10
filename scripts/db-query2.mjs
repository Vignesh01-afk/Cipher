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
  orderBy: { createdAt: 'asc' },
  select: {
    id: true,
    email: true,
    authVersion: true,
    tokenVersion: true,
    otpCodeHash: true,
    recoveryKeyHash: true,
    recoveryData: true,
    recoveryCreatedAt: true,
  },
});

const hasToken = rows.filter((r) => r.tokenVersion > 0);
console.log('total:', rows.length, 'rows_with_token_version:', hasToken.length);
for (const r of hasToken) {
  console.log(JSON.stringify({ email: r.email, tokenVersion: r.tokenVersion }));
}

const nullRecovery = rows.filter((r) => r.recoveryKeyHash === null);
const nullOtp = rows.filter((r) => r.otpCodeHash === null);
console.log('rows with recoveryKeyHash null:', nullRecovery.length);
console.log('rows with otpCodeHash null:', nullOtp.length);

// TokenVersion breakdown across every row.
const versions = {};
for (const r of rows) {
  versions[r.tokenVersion] = (versions[r.tokenVersion] || 0) + 1;
}
console.log('tokenVersion breakdown:', versions);

await c.$disconnect();
