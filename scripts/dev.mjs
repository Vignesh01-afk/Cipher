/**
 * Starts the API and the web client together.
 *
 * This deliberately has no third-party dependencies (no `concurrently`), so
 * `npm run dev` works as soon as `server/` and `client/` are installed - there
 * is no root `node_modules` to forget about.
 *
 * Output from both processes is streamed with a coloured prefix, and the whole
 * process tree is torn down on Ctrl+C.
 */

import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';

const TARGETS = [
  {
    name: 'api',
    label: '\x1b[36m[api]\x1b[0m',
    command: 'npm --prefix server run dev',
  },
  {
    name: 'web',
    label: '\x1b[35m[web]\x1b[0m',
    command: 'npm --prefix client run dev',
  },
];

const children = [];
let shuttingDown = false;

/** Streams a child's output line by line with a prefix. */
function pipeLines(stream, label, sink) {
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    // Keep the last (possibly incomplete) fragment for the next chunk.
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) sink.write(`${label} ${line}\n`);
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0) sink.write(`${label} ${buffer}\n`);
  });
}

/**
 * Kills a child and everything it spawned. On Windows a plain `.kill()` only
 * terminates the shell, leaving the real server process orphaned, so the whole
 * tree is killed with taskkill instead.
 */
function killTree(child) {
  if (!child.pid || child.killed) return;

  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (reason) process.stdout.write(`\n${reason}\n`);
  for (const child of children) killTree(child);

  // Give the children a moment to exit cleanly before we bail out.
  setTimeout(() => process.exit(0), 500).unref();
}

for (const target of TARGETS) {
  const child = spawn(target.command, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  children.push(child);
  pipeLines(child.stdout, target.label, process.stdout);
  pipeLines(child.stderr, target.label, process.stderr);

  child.on('error', (error) => {
    process.stderr.write(`${target.label} failed to start: ${error.message}\n`);
  });

  child.on('exit', (code) => {
    if (shuttingDown) return;
    // One side dying is almost always a real problem (port in use, schema not
    // applied), so stop the other side too rather than pretending all is well.
    shutdown(`${target.label} exited with code ${code ?? 0}. Shutting down the other process.`);
  });
}

process.on('SIGINT', () => shutdown('Stopping CipherNote…'));
process.on('SIGTERM', () => shutdown('Stopping CipherNote…'));

process.stdout.write('Starting CipherNote:\n  api -> http://localhost:4000\n  web -> http://localhost:5173\n\n');
