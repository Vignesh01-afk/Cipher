/* Reports Phosphor icon names imported/used in src that don't exist in the package. */
import fs from 'node:fs';
import path from 'node:path';

const pkg = await import('@phosphor-icons/react');
const ROOT = path.resolve('src');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
  }
})(ROOT);

const missing = new Map();

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const importRe = /import\s*\{([^}]+)\}\s*from\s*'@phosphor-icons\/react'/g;
  let m;
  const imported = new Set();
  while ((m = importRe.exec(src))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      imported.add(name);
      if (!(name in pkg)) {
        if (!missing.has(name)) missing.set(name, []);
        missing.get(name).push(path.relative(process.cwd(), file));
      }
    }
  }
  // JSX usage of locally-declared components is checked by imports above.
  void imported;
}

if (missing.size === 0) {
  console.log('OK: all imported Phosphor icon names exist.');
} else {
  for (const [name, where] of missing) console.log(`MISSING  ${name}   ${where.join(', ')}`);
  process.exitCode = 1;
}
