/*
 * Normalises the @phosphor-icons/react import in a file: removes every
 * phosphor import statement and writes exactly one containing the icon
 * names actually referenced in the file body.
 *
 *   node scripts/repair-imports.mjs <file> [<file> ...]
 */
import fs from 'node:fs';

const PKG = '@phosphor-icons/react';
const pkg = await import(PKG);
const PHOSPHOR = new Set(Object.keys(pkg));

const IMP_RE = /^[ \t]*import\s*\{[^}]*\}\s*from\s*'@phosphor-icons\/react'\s*;?[ \t]*$/;

/** Blank out string literals, comments and whole import lines (indices preserved). */
function mask(src, { blankImports = false } = {}) {
  const out = src.split('');
  const blank = (i) => {
    if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (c2 === '//') {
      while (i < src.length && src[i] !== '\n') blank(i++);
    } else if (c2 === '/*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) blank(i++);
      blank(i); blank(i + 1); i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      blank(i++);
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') blank(i++);
        if (i < src.length) blank(i++);
      }
      if (i < src.length) blank(i++);
    } else if (blankImports && /^import\s/.test(src.slice(i))) {
      while (i < src.length && src[i] !== '\n') blank(i++);
    } else {
      i++;
    }
  }
  return out.join('');
}

/** True when the identifier at `idx` sits in JSX text rather than code. */
function inJsxText(src, idx, len) {
  const prev1 = idx > 0 ? src[idx - 1] : '';
  const next1 = src[idx + len] ?? '';
  const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
  if (prev1 === '<') return false;
  if (isWord(prev1) || isWord(next1)) return false;
  let k = idx - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  const pn = k >= 0 ? src[k] : '';
  let j = idx + len;
  while (j < src.length && /\s/.test(src[j])) j++;
  const nn = j < src.length ? src[j] : '';
  return pn === '>' || nn === '<';
}

for (const file of process.argv.slice(2)) {
  const original = fs.readFileSync(file, 'utf8');
  const bodyMasked = mask(original, { blankImports: true });
  const codeMasked = mask(original);

  // names this file already gets from somewhere else (react-router's Link, etc.)
  const foreign = new Set();
  for (const line of original.split('\n')) {
    const im = /^import\s+(?:type\s+)?(?:\{([^}]*)\}|([A-Za-z0-9_]+))/i.exec(line);
    if (!im) continue;
    if (/@phosphor-icons\/react/.test(line)) continue;
    if (im[1]) {
      for (const raw of im[1].split(',')) {
        const n = raw.trim().split(/\s+as\s+/)[0].trim();
        if (n) foreign.add(n);
      }
    } else if (im[2]) {
      foreign.add(im[2]);
    }
  }
  const declared = new Set();
  for (const dm of bodyMasked.matchAll(/\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g)) {
    declared.add(dm[1]);
  }

  const used = [];
  const seen = new Set();
  const re = /(?<![A-Za-z0-9_$])([A-Z][A-Za-z0-9_$]*)\b/g;
  let m;
  while ((m = re.exec(bodyMasked))) {
    const name = m[1];
    if (!PHOSPHOR.has(name)) continue;
    if (foreign.has(name) || declared.has(name)) continue;
    if (inJsxText(codeMasked, m.index, name.length)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    used.push(name);
  }

  const lines = original.split('\n');
  const keptLines = [];
  let lastImport = -1;
  const dropPhos = new RegExp('^' + IMP_RE.source.replace(/\\s\*\?, '?/g, '\\s*\\s*$') + '$');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // use a safe anchor-anchored test on the actual line
    const stripped = line.trimEnd();
    if (/^import\s*\{/.test(stripped) && /'@phosphor-icons\/react'/.test(stripped)) {
      continue;
    }
    keptLines.push(line);
    if (/^import\s/.test(stripped)) lastImport = keptLines.length - 1;
  }

  if (lastImport === -1) {
    keptLines.unshift(`import { ${used.join(', ')} } from '${PKG}';`);
  } else {
    keptLines.splice(lastImport + 1, 0, `import { ${used.join(', ')} } from '${PKG}';`);
  }

  const next = keptLines.join('\n');
  if (next !== original) {
    fs.writeFileSync(file, next);
    console.log(`repaired  ${file} (${used.length} icons)`);
  } else {
    console.log(`ok        ${file}`);
  }
}
