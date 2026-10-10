// One-off diagnostic: does the Neon database itself answer when we bypass the
// broken local resolver (dial the IP, keep TLS SNI/hostname)? Reads credentials
// from server/.env but prints NONE of them - only pass/fail + non-secret info.
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envText = fs.readFileSync(path.join(root, 'server', '.env'), 'utf8');
const m = envText.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) {
  console.log('NO_DATABASE_URL');
  process.exit(2);
}
const url = new URL(m[1]);
const host = url.hostname;
const user = decodeURIComponent(url.username);
const pass = decodeURIComponent(url.password);
const dbname = url.pathname.replace(/^\//, '') || 'neondb';
const ip = process.argv[2];
if (!ip) {
  console.log('usage: node scripts/db-direct-check.mjs <ip>');
  process.exit(2);
}

// Minimal Postgres wire-protocol startup + cleartext-password auth + SELECT 1.
function startupMessage() {
  const params = `user\0${user}\0database\0${dbname}\0\0`;
  const body = Buffer.concat([Buffer.from([0, 3, 0, 0]), Buffer.from(params, 'utf8')]);
  const len = Buffer.alloc(4);
  len.writeInt32BE(body.length + 4);
  return Buffer.concat([len, body]);
}

const socket = net.connect({ host: ip, port: 5432 });
let buf = Buffer.alloc(0);
let phase = 'connect';
const timer = setTimeout(() => {
  console.log(`TIMEOUT in phase=${phase}`);
  process.exit(3);
}, 15_000);

socket.on('connect', () => {
  phase = 'tls-upgrade';
  socket.write(Buffer.from([0x00])); // SSLRequest
});

socket.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  if (phase === 'tls-upgrade') {
    if (buf[0] !== 0x53 /* 'S' */) {
      console.log(`TLS_REFUSED byte=0x${buf[0]?.toString(16)}`);
      process.exit(4);
    }
    buf = buf.subarray(1);
    phase = 'tls';
    const secure = tls.connect(
      { socket, servername: host, rejectUnauthorized: false },
      () => {
        phase = 'startup';
        secure.write(startupMessage());
      },
    );
    secure.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      drain(secure);
    });
    secure.on('error', (e) => {
      console.log(`TLS_FAIL ${e.code ?? e.message}`);
      process.exit(5);
    });
    return;
  }
  drain(socket);
});

function drain(stream) {
  for (;;) {
    if (buf.length < 5) return;
    const type = String.fromCharCode(buf[0]);
    const len = buf.readInt32BE(1);
    if (buf.length < len + 1) return;
    const payload = buf.subarray(5, len + 1);
    buf = buf.subarray(len + 1);

    if (type === 'R') { // Authentication
      const code = payload.readInt32BE(0);
      if (code === 0) continue;
      if (code === 3) { // cleartext password
        const pw = Buffer.from(`p\0${Buffer.byteLength(pass) + 4}\0${pass}\0`);
        stream.write(pw);
        continue;
      }
      console.log(`AUTH_METHOD_UNSUPPORTED code=${code}`);
      process.exit(6);
    }
    if (type === 'E') { // ErrorResponse
      const fields = payload.toString('utf8').split('\0');
      const detail = fields.filter((f) => /^[SVMC]$/.test(f[0])).map((f) => f.slice(1)).join(' | ');
      console.log(`PG_ERROR ${detail}`);
      process.exit(7);
    }
    if (type === 'Z') { // ReadyForQuery -> authenticated
      console.log(`AUTH_OK ip=${ip} host=${host} db=${dbname}`);
      // SELECT 1
      const q = 'SELECT 1';
      const body = Buffer.concat([Buffer.from(`Q\0${q}\0\0`, 'utf8')]);
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(body.length + 4);
      stream.write(Buffer.concat([lenBuf, body]));
      phase = 'query';
      continue;
    }
    if (type === 'T' && phase === 'query') continue; // RowDescription
    if (type === 'D' && phase === 'query') { // DataRow
      const colLen = payload.readInt32BE(0);
      const value = payload.subarray(4, 4 + colLen).toString('utf8');
      console.log(`SELECT_1_OK value=${value}`);
      clearTimeout(timer);
      process.exit(0);
    }
  }
}

socket.on('error', (e) => {
  console.log(`TCP_FAIL ${e.code ?? e.message}`);
  process.exit(8);
});
