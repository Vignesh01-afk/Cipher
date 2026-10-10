/*
 * Concern: JSX element return types.
 *
 * Rewrites `: JSX.Element` return annotations to a bare `: ReactElement`, then
 * makes sure the file has `import type { ReactElement } from 'react';`.
 *
 * Only `JSX.Element` is touched. The ~40 pre-existing `React.ReactElement`
 * annotations compile fine and are left alone.
 *
 * React 19 dropped the global `JSX` namespace, so `JSX.Element` no longer
 * resolves. The rest of the codebase already spells this `ReactElement`, so
 * these call sites converge on the same spelling.
 *
 * Replacements are collected against ONE snapshot and spliced back-to-front,
 * so offsets never go stale.
 *
 *   node scripts/codemod-jsx-element.mjs <file> [...]
 */
import fs from 'node:fs';

const IMPORT_LINE = "import type { ReactElement } from 'react';";

/** Blank string literals and comments so indices stay aligned with the source. */
function mask(src) {
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
    } else {
      i++;
    }
  }
  return out.join('');
}

for (const file of process.argv.slice(2)) {
  const original = fs.readFileSync(file, 'utf8');
  const snap = mask(original);

  // --- collect replacements against the snapshot ---------------------------
  const replacements = [];
  const re = /(?<![A-Za-z0-9_$.])(JSX\.Element)\b/g;
  let m;
  while ((m = re.exec(snap))) {
    replacements.push({ start: m.index, end: m.index + m[1].length, target: 'ReactElement' });
  }

  let next = original;
  for (const r of replacements.reverse()) {
    next = next.slice(0, r.start) + r.target + next.slice(r.end);
  }

  if (!replacements.length) {
    console.log(`unchanged ${file}`);
    continue;
  }

  // --- ensure the type import exists --------------------------------------
  let importAdded = false;
  if (!/import\s+type\s*\{[^}]*\bReactElement\b[^}]*\}\s*from\s*'react'/.test(next)) {
    const lines = next.split('\n');
    // Merge into an existing `import type { ... } from 'react';` if there is one.
    const typeImportIdx = lines.findIndex(
      (l) => /^import\s+type\s*\{/.test(l.trimStart()) && /from\s*'react'/.test(l),
    );
    if (typeImportIdx !== -1) {
      lines[typeImportIdx] = lines[typeImportIdx].replace(
        /import\s+type\s*\{/,
        'import type { ReactElement,',
      );
    } else {
      // Insert after the last COMPLETE import statement. A multi-line
      // `import type {` opening line starts with `import` but does not end the
      // statement, so require the line to also terminate it.
      let last = -1;
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trimStart();
        if (!/^import\s/.test(t)) continue;
        if (/['"];?\s*$/.test(lines[i].trimEnd())) last = i;
      }
      lines.splice(last + 1, 0, IMPORT_LINE);
    }
    next = lines.join('\n');
    importAdded = true;
  }

  fs.writeFileSync(file, next);
  console.log(
    `fixed ${file}  (${replacements.length} annotation${replacements.length === 1 ? '' : 's'}, import ${importAdded ? 'added' : 'merged'})`,
  );
}
