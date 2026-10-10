/* Second pass: after the imports were rewritten, the old lucide identifiers
 * still appear in JSX tags and in `icon={...}` / `icon: ...` positions.
 * Rewriting them here (and nowhere else) keeps prose such as "Search runs
 * locally" intact. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));

const map = {};
const codemod = fs.readFileSync(path.join(ROOT, 'scripts', 'codemod.mjs'), 'utf8');
const block = codemod.match(/const ICON_MAP = \{([\s\S]*?)\n\};/)[1];
for (const line of block.split('\n')) {
  const m = line.match(/^\s*(\w+):\s*'([^']+)'/);
  if (m && m[1] !== m[2]) map[m[1]] = m[2];
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let changedFiles = 0;
let replacements = 0;

for (const file of walk(path.join(ROOT, 'src'))) {
  let text = fs.readFileSync(file, 'utf8');
  const before = text;
  for (const [from, to] of Object.entries(map)) {
    const rules = [
      [new RegExp(`<${from}(?=[\\s/>])`, 'g'), `<${to}`],
      [new RegExp(`</${from}>`, 'g'), `</${to}>`],
      [new RegExp(`\\{${from}\\}`, 'g'), `{${to}}`],
      [new RegExp(`icon:\\s*${from}\\b`, 'g'), `icon: ${to}`],
      [new RegExp(`icon=\\{\\s*${from}\\s*\\}`, 'g'), `icon={${to}}`],
    ];
    for (const [rx, rep] of rules) {
      text = text.replace(rx, () => {
        replacements += 1;
        return rep;
      });
    }
  }
  if (text !== before) {
    fs.writeFileSync(file, text, 'utf8');
    changedFiles += 1;
  }
}

console.log(`icon pass 2: ${changedFiles} files, ${replacements} replacements`);
