/**
 * Starts scripts/dev.mjs (API + web client) fully detached from this shell,
 * with all output appended to a log file, then exits immediately.
 *
 * Useful on Windows where closing the terminal would otherwise take the dev
 * servers down with it. Stop the servers with:
 *   netstat -ano | findstr :4000   (and :5173) -> taskkill /PID <pid> /T /F
 */
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logPath = process.env.CIPHER_DEV_LOG ?? join(tmpdir(), 'cipher-dev.log');

const out = openSync(logPath, 'a');
const child = spawn(process.execPath, [join(root, 'scripts', 'dev.mjs')], {
  cwd: root,
  detached: true,
  stdio: ['ignore', out, out],
  windowsHide: true,
});
child.unref();

console.log(`Detached CipherNote dev process (pid ${child.pid}).`);
console.log(`Log file: ${logPath}`);
console.log('  api -> http://localhost:4000');
console.log('  web -> http://localhost:5173');
