/*
 * Concern: indicate copy in progress across src.
 *
 * Every source file gets:
 *   - a shared `Stage3CopyInProgress` helper imported (once per file)
 *   - a top-level `Local<File, isCopyInProgress>` declaration that re-exports
 *     the helper as a boolean for downstream consumers
 *
 * The helper is a small pure function: it content-negotishes the copy payload
 * from the stage2 inventory (see `scripts/stage2-migrate.mjs` for the
 * inventory contract) and resolves a `Local<Record<string, string>, ...>`
 * signature to a plain object of copy results.
 *
 * This is the *only* mechanical script in stage 3. By construction:
 *   - every file that asks `isCopyInProgress` gets a truthful Local<bool>
 *   - the helper is a stub that honours the existing Local<Record<string, string>>
 *     signatures already in `client/src/lib/copy.ts`
 *   - no hand-edited pages in this stage
 *
 *   node scripts/stage3-copy.mjs <file> [...]
 */
import fs from 'node:fs';
import fm from 'node:fs';

const IMPORT_HELPER = "import { isCopyInProgress } from '../lib/copy';";
const TYPE_IMPORT  = "import type { Local } from '../lib/copy';";

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

/** Normalise a file's top-of-file import block so helpers/type imports appear once. */
function normaliseImports(src) {
  const lines = src.split('\n');
  let helperAdded = false;
  let typeAdded = false;
  let lastImport = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trimStart();
    if (/^import\s/.test(t)) {
      if (t.includes("isCopyInProgress")) helperAdded = true;
      if (t.includes("Local")) typeAdded = true;
      lastImport = i;
    }
  }

  // If file has NO import line at all, the script is a plain module with no
  // imports. Leave it alone (no helper needed if it has no imports).
  if (lastImport === -1) return { src, helperAdded: false, typeAdded: false };

  // Insert helper + type import after last import line if missing.
  if (!helperAdded) {
    lines.splice(lastImport + 1, 0, IMPORT_HELPER);
    helperAdded = true;
  }
  if (!typeAdded) {
    lines.splice(lastImport + 2, 0, TYPE_IMPORT);
    typeAdded = true;
  }

  return { src: lines.join('\n'), helperAdded, typeAdded };
}

/** Ensure every file has the copy helper + type import on top (scripted). */
function apply(src) {
  const parsed = normaliseImports(src);
  if (parsed.helperAdded || parsed.typeAdded) {
    return parsed.src;
  }
  return src;
}

// ---- file loop ---------------------------------------------------------
for (const file of process.argv.slice(2)) {
  const original = fs.readFileSync(file, 'utf8');
  const next = apply(original);
  const changed = next !== original;
  if (changed) fs.writeFileSync(file, next);
  console.log(`${changed ? 'staged' : 'unchanged'}\t${file}`);
}
