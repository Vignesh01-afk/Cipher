// E2E smoke test: register -> OTP request -> verify -> reset -> login.
// Usage (from server/): node scripts/otp-e2e-test.mjs
// The script starts the API server itself (detached, logging to /tmp), runs
// the flow, then kills it. Run this while `npm run dev` is NOT running.
import { spawn, execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, rmSync, openSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const IS_WIN = process.platform === 'win32';
const LOG = IS_WIN ? `${process.env.TEMP}\\cipher-e2e.log` : '/tmp/cipher-e2e.log';
const API = 'http://localhost:4000/api/auth';
const EMAIL = `smoke-${Date.now()}@example.com`;
const OLD_PW = 'first-password-123';
const NEW_PW = 'new-password-456';
const b64 = (n) => randomBytes(n).toString('base64');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const prisma = new PrismaClient();

/** Start the API detached; stdout/stderr go to LOG. Works on win + unix. */
function startServer() {
  rmSync(LOG, { force: true });
  if (IS_WIN) {
    // cmd.exe one-liner: redirect output, don't wait for the child.
    execSync(`start /b cmd /c "npx tsx src/index.ts > ${LOG} 2>&1"`, { shell: 'cmd.exe', cwd: process.cwd(), stdio: 'ignore' });
  } else {
    spawn('npx', ['tsx', 'src/index.ts'], { detached: true, stdio: ['ignore', openSync(LOG, 'a'), 'ignore'] }).unref();
  }
}

async function killServer() {
  // Match only PIDs whose state is LISTENING on :4000.
  try {
    const out = execSync(IS_WIN ? 'netstat -ano | findstr ":4000" | findstr LISTENING' : "netstat -ano | grep ':4000' | grep LISTEN")
      .toString();
    const pids = [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((p) => /^\d+$/.test(p)))];
    for (const pid of pids) {
      execSync(IS_WIN ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`);
    }
  } catch { /* port already free */ }
}

async function codeFromLog() {
  if (!existsSync(LOG)) return null;
  const m = readFileSync(LOG, 'utf8').match(/code is:?\s*(\d{6,8})/i);
  return m ? m[1] : null;
}

async function codeFromDb(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const token = await prisma.otpToken.findFirst({ where: { userId: user.id, purpose: 'PASSWORD_RESET' } });
  if (!token) return null;
  // 1e8 space + cheap hash = seconds to brute force. Test-only shortcut.
  for (let i = 0; i < 1e8; i++) {
    const code = String(i).padStart(8, '0');
    if (createHash('sha256').update(code).digest('hex') === token.codeHash) return code;
  }
  return null;
}

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

try {
  startServer();
  await wait(8000); // let tsx boot

  // 1. Register (exercises the cipherId fix)
  const reg = await post('/register', {
    email: EMAIL, displayName: 'E2E Smoke', password: OLD_PW,
    publicKey: b64(32), wrappedPrivateKey: b64(48), privateKeyIv: b64(12),
    kdfSalt: b64(16), kdfIterations: 100000,
    wrappedMasterKey: b64(48), masterKeyIv: b64(12), masterKeyRaw: b64(32),
  });
  check('register', reg.status === 201, `status=${reg.status}`);
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.json));
  const created = await prisma.user.findUnique({ where: { email: EMAIL } });
  check('cipherId generated', /^CN-[A-Z2-9]{6}$/.test(created?.cipherId ?? ''), created?.cipherId ?? 'missing');

  // 2. Request OTP code
  const req = await post('/password/request-code', { email: EMAIL });
  check('otp request', req.status === 200, `status=${req.status} ${JSON.stringify(req.json)}`);
  await wait(1500);

  // 3. Extract the code (log first, DB hash brute-force as fallback)
  let code = await codeFromLog();
  check('code from server log', Boolean(code));
  if (!code) {
    code = await codeFromDb(EMAIL);
    check('code from DB hash fallback', Boolean(code));
  }
  if (!code) throw new Error('could not obtain OTP code');
  console.error(`   code obtained: ${code}`);

  // 4. Verify code -> resetToken + escrow-unwrapped master key
  const ver = await post('/password/verify-code', { email: EMAIL, code });
  check('verify code', ver.status === 200 && Boolean(ver.json.resetToken) && Boolean(ver.json.masterKeyRaw), `status=${ver.status}`);
  if (ver.status !== 200) throw new Error(JSON.stringify(ver.json));

  // 5. Reset with new password
  const reset = await post('/password/reset', {
    resetToken: ver.json.resetToken, newPassword: NEW_PW,
    kdfSalt: b64(16), kdfIterations: 100000,
    wrappedMasterKey: b64(48), masterKeyIv: b64(12),
  });
  check('password reset', reset.status === 200, `status=${reset.status}`);

  // 6. Login with NEW password works, OLD password rejected
  const loginNew = await post('/login', { email: EMAIL, password: NEW_PW });
  check('login with new password', loginNew.status === 200, `status=${loginNew.status}`);
  const loginOld = await post('/login', { email: EMAIL, password: OLD_PW });
  check('old password rejected', loginOld.status === 401, `status=${loginOld.status}`);
} catch (err) {
  results.push(`FAIL  unexpected: ${err.message}`);
} finally {
  await killServer();
  await prisma.$disconnect();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
