/*
 * Single-pass lucide -> Phosphor migration.
 *
 * Every offset is computed against ONE snapshot of the file, then all
 * replacements are spliced in from the end backwards. That is what makes it
 * safe: earlier versions re-masked after each rename while reusing stale
 * offsets, which corrupted the import block.
 *
 *   node scripts/migrate-icons.mjs <file> [...]
 */
import fs from 'node:fs';

const PKG = '@phosphor-icons/react';
const pkg = await import(PKG);
const PHOSPHOR = new Set(Object.keys(pkg));

const RENAME = {
  Search: 'MagnifyingGlass',
  FilePlus2: 'FilePlus',
  FileX2: 'FileX',
  KeyRound: 'Key',
  Home: 'House',
  MessageCircle: 'ChatsCircle',
  MessageSquarePlus: 'ChatTeardropText',
  ScrollText: 'Scroll',
  ChevronRight: 'CaretRight',
  CheckCircle2: 'CheckCircle',
  AlertTriangle: 'Warning',
  AlertCircle: 'WarningCircle',
  AlertOctagon: 'WarningOctagon',
  MailCheck: 'EnvelopeSimple',
  Mail: 'Envelope',
  Activity: 'Pulse',
  Send: 'PaperPlaneTilt',
  Smile: 'Smiley',
  ServerOff: 'WifiSlash',
  Filter: 'Funnel',
  MoreVertical: 'DotsThreeVertical',
  UserRound: 'User',
  EyeOff: 'EyeSlash',
  Ban: 'Prohibit',
  RefreshCw: 'ArrowClockwise',
  Trash2: 'Trash',
  LogIn: 'SignIn',
  LogOut: 'SignOut',
  ShieldOff: 'ShieldSlash',
  CircleNotch: 'CircleNotch',
  Loader2: 'CircleNotch',
  Pencil: 'PencilSimple',
  PencilLine: 'PencilSimple',
  Info: 'Info',
  UploadCloud: 'CloudArrowUp',
  Settings: 'Gear',
  Share2: 'ShareNetwork',
  CheckCheck: 'Checks',
  UserRound: 'User',
  FilePlus2: 'FilePlus',
  Unlock: 'LockOpen',
  Chrome: 'Globe',
  Globe2: 'Globe',
};

/** TS utility types that share a name with a Phosphor icon (Record, ...). */
const TS_GLOBALS = new Set([
  'Record', 'Partial', 'Omit', 'Pick', 'Readonly', 'Exclude', 'Extract',
  'ReturnType', 'InstanceType', 'Parameters', 'Awaited', 'NonNullable',
  'Required', 'Promise', 'Date', 'Map', 'Set', 'Symbol', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Error', 'PropertyKey',
]);

/** Blank strings, comments and import-brace bodies; indices stay aligned. */
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

/** True when the token at idx is JSX child text rather than code. */
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
  const snap = mask(original);
  const bodySnap = mask(original, { blankImports: true });

  // ---- collect non-overlapping replacements ------------------------------
  const replacements = [];
  const seen = new Set();
  const re = /(?<![A-Za-z0-9_$])([A-Z][A-Za-z0-9_$]*)\b/g;
  let m;
  while ((m = re.exec(snap))) {
    const name = m[1];
    const target = RENAME[name];
    if (!target || target === name) continue;
    if (inJsxText(snap, m.index, name.length)) continue;
    replacements.push({ start: m.index, end: m.index + name.length, target });
    seen.add(target);
    seen.add(name);
  }
  replacements.sort((a, b) => a.start - b.start);

  let next = original;
  for (const r of replacements.reverse()) {
    next = next.slice(0, r.start) + r.target + next.slice(r.end);
  }

  // Drop any leftover lucide-react import block entirely (it is being replaced).
  next = next.replace(/import\s*\{[^}]*\}\s*from\s*'lucide-react'\s*;?\n?/g, '');

  // Names this file already imports from some other module (react-router's
  // Link, the local Spinner, ...). Never re-import those from Phosphor.
  const foreign = new Set();
  for (const fm of next.matchAll(/import\s+(?:type\s+)?(?:\{([^}]*)\}|([A-Za-z0-9_]+))\s*(?:,\s*\{[^}]*\})?\s*from\s*'([^']+)'/g)) {
    if (fm[3] === PKG) continue;
    if (fm[1]) {
      for (const raw of fm[1].split(',')) {
        const n = raw.trim().split(/\s+as\s+/)[0].trim();
        if (n) foreign.add(n);
      }
    }
    if (fm[2]) foreign.add(fm[2]);
  }

  // ---- icons referenced in the body (post-rename) ------------------------
  const bodyNext = mask(next, { blankImports: true });
  const codeNext = mask(next);
  const declared = new Set();
  for (const dm of bodyNext.matchAll(/\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g)) {
    declared.add(dm[1]);
  }
  const used = [];
  const usedSeen = new Set();
  const ure = /(?<![A-Za-z0-9_$])([A-Z][A-Za-z0-9_$]*)\b/g;
  let u;
  while ((u = ure.exec(bodyNext))) {
    const name = u[1];
    if (!PHOSPHOR.has(name)) continue;
    if (TS_GLOBALS.has(name)) continue;
    if (foreign.has(name)) continue; // already imported from another module
    if (declared.has(name)) continue; // this file declares it (component, type, ...)
    if (inJsxText(codeNext, u.index, name.length)) continue;
    if (usedSeen.has(name)) continue;
    usedSeen.add(name);
    used.push(name);
  }

  // ---- rewrite the phosphor import as one clean line ---------------------
  const IMP = /^[ \t]*import\s*\{[^}]*\}\s*from\s*'@phosphor-icons\/react'\s*;?[ \t]*$/;
  const lines = next.split('\n');
  const kept = [];
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (IMP.test(line)) continue;
    kept.push(line);
    // Only count a COMPLETE import statement: the line must end the statement.
    if (/^import\s/.test(line.trimStart()) && /['"];?\s*$/.test(line.trimEnd())) {
      lastImport = kept.length - 1;
    }
  }
  if (used.length) {
    kept.splice(lastImport + 1, 0, `import { ${used.join(', ')} } from '${PKG}';`);
  }
  next = kept.join('\n');

  if (next !== original) {
    fs.writeFileSync(file, next);
    console.log(`migrated ${file}  (${replacements.length} renames, ${used.length} icons)`);
  } else {
    console.log(`unchanged ${file}`);
  }
}
