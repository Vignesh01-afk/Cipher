/*
 * Second-pass icon cleanup.
 *
 *  1. masks strings + comments so renames never touch user-facing text
 *  2. finds PascalCase identifiers that are neither imported nor declared
 *  3. maps known lucide leftovers to Phosphor names
 *  4. makes sure every remaining icon name is imported from @phosphor-icons/react
 *
 * Run with: node scripts/fix-icons.mjs [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const PKG = '@phosphor-icons/react';

const pkg = await import(PKG);
const PHOSPHOR = new Set(Object.keys(pkg));

/** lucide name -> Phosphor name (only for names still left in the source). */
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
  BanCircle: 'Prohibit',
  RefreshCw: 'ArrowClockwise',
  Trash2: 'Trash',
  LogIn: 'SignIn',
  LogOut: 'SignOut',
  ShieldOff: 'ShieldSlash',
  ShieldCheck: 'ShieldCheck',
  Lock: 'Lock',
  Loader2: 'CircleNotch',
  MoreHorizontal: 'DotsThree',
  Info: 'Info',
  Pencil: 'PencilSimple',
  PencilLine: 'PencilSimple',
  Trash2: 'Trash',
};

const GLOBALS = new Set([
  'React', 'JSX', 'Record', 'Promise', 'Error', 'Math', 'Date', 'JSON', 'String',
  'Number', 'Boolean', 'Object', 'Array', 'Map', 'Set', 'WeakMap', 'Promise',
  'Window', 'Document', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent',
  'ChangeEvent', 'FormEvent', 'TouchEvent', 'DragEvent', 'UIEvent', 'AnimationEvent',
  'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLDivElement',
  'HTMLButtonElement', 'HTMLAnchorElement', 'SVGElement', 'Node', 'Response',
  'Request', 'AbortController', 'URL', 'URLSearchParams', 'FormData', 'Headers',
  'Buffer', 'ComponentType', 'ReactElement', 'ReactNode', 'CSSProperties',
  'RefObject', 'MutableRefObject', 'Dispatch', 'SetStateAction', 'EffectCallback',
  'DependencyList',  'PointerEvent', 'ClipboardEvent', 'WheelEvent', 'CryptoKey', 'IDBDatabase',
  'AudioContext', 'RTCPeerConnection', 'Storage', 'FileReader', 'Blob', 'File',
  'MediaStream', 'MediaDevices', 'DisplayMediaStreamOptions', 'Partial', 'Omit',
  'Pick', 'Exclude', 'Extract', 'ReturnType', 'InstanceType', 'Parameters',
  'Readonly', 'Awaited', 'NonNullable', 'Iterable', 'AsyncGenerator',
  'InputHTMLAttributes', 'ButtonHTMLAttributes', 'TextHTMLAttributes',
  'HTMLAttributes', 'CSSProperties', 'Provider', 'CryptoKey', 'Notification',
]);

/** Replace string/comment bodies with spaces so indices stay aligned. */
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

function collect(list, re, src, group = 1) {
  let m;
  while ((m = re.exec(src))) {
    for (const raw of m[group].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) list.add(name);
    }
  }
}

const ROOT = path.resolve('src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
  }
})(ROOT);

let changedAny = false;
const unresolved = [];

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const masked = mask(original);
  let code = original;

  const imported = new Set();
  collect(imported, /import\s+([A-Za-z0-9_]+)\s*(?:,|\n)/g, masked);
  collect(imported, /import\s*\{([^}]*)\}/g, masked);
  collect(imported, /import\s+type\s*\{([^}]*)\}/g, masked);

  const declared = new Set();
  collect(declared, /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g, masked);
  collect(declared, /\b(?:const|let|var)\s*\{([^}]*)\}/g, masked);
  collect(declared, /\bfunction\s*\*\s*([A-Za-z0-9_]+)/g, masked);

  // identifiers actually used in code
  const used = new Set();
  let m;
  const useRe = /(?<![A-Za-z0-9_$])([A-Z][A-Za-z0-9_$]*)\b/g;
  while ((m = useRe.exec(masked))) used.add(m[1]);

  const undeclared = [...used].filter((n) => {
    if (declared.has(n) || GLOBALS.has(n)) return false;
    if (RENAME[n] || PHOSPHOR.has(n)) return true;
    return !imported.has(n); // imported from elsewhere, not ours to touch
  });

  // JSX element tags actually rendered in this file (components, not text)
  const tags = new Set();
  let t;
  const tagRe = /<\s*([A-Z][A-Za-z0-9_]*)/g;
  while ((t = tagRe.exec(masked))) tags.add(t[1]);

  const localChanges = [];

  for (const name of undeclared) {
    const target = RENAME[name] ?? (PHOSPHOR.has(name) ? name : null);
    if (!target) {
      unresolved.push(`${path.relative(process.cwd(), file)}: ${name}`);
      continue;
    }
    if (name !== target) {
      const re = new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`, 'g');
      const hits = [];
      let r;
      while ((r = re.exec(masked))) {
        const idx = r.index;
        const prev1 = idx > 0 ? masked[idx - 1] : '';
        const next1 = masked[idx + name.length] ?? '';
        const isWordChar = (c) => /[A-Za-z0-9_$]/.test(c);
        let skip = false;
        if (prev1 !== '<') {
          if (isWordChar(prev1) || isWordChar(next1)) {
            skip = true; // part of a longer word
          } else {
            let k = idx - 1;
            while (k >= 0 && /\s/.test(masked[k])) k--;
            const pn = k >= 0 ? masked[k] : '';
            let j = idx + name.length;
            while (j < masked.length && /\s/.test(masked[j])) j++;
            const nn = j < masked.length ? masked[j] : '';
            if (pn === '>' || nn === '<') skip = true; // JSX text
          }
        }
        if (!skip) hits.push(idx);
      }
      if (!hits.length) continue;
      const out = code;
      // report every occurrence so JSX text can be spot-checked
      for (const idx of hits) {
        const line = out.slice(0, idx).split('\n').length;
        const snippet = out.split('\n')[line - 1].trim().slice(0, 110);
        if (!APPLY) console.log(`        ~ ${name} @ line ${line}: ${snippet}`);
      }
      let next = out;
      for (const idx of hits.reverse()) {
        next = next.slice(0, idx) + target + next.slice(idx + name.length);
      }
      code = next;
      localChanges.push(`${name} -> ${target} (${hits.length}x)`);
    }
  }

  // recompute imports and make sure every phosphor name used is imported
  if (localChanges.length) {
    const masked2 = mask(code);
    const imp = new Set();
    collect(imp, /import\s+([A-Za-z0-9_]+)\s*(?:,|\n)/g, masked2);
    collect(imp, /import\s*\{([^}]*)\}/g, masked2);
    const declared2 = new Set();
    collect(declared2, /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g, masked2);
    collect(declared2, /\b(?:const|let|var)\s*\{([^}]*)\}/g, masked2);
    const tags2 = new Set();
    let t2;
    const tagRe2 = /<\s*([A-Z][A-Za-z0-9_]*)/g;
    while ((t2 = tagRe2.exec(masked2))) tags2.add(t2[1]);
    const used2 = new Set();
    const useRe2 = /(?<![A-Za-z0-9_$])([A-Z][A-Za-z0-9_$]*)\b/g;
    let u;
    while ((u = useRe2.exec(masked2))) used2.add(u[1]);

    const need = [...used2].filter(
      (n) =>
        PHOSPHOR.has(n) &&
        !imp.has(n) &&
        !declared2.has(n) &&
        !GLOBALS.has(n) &&
        (tags2.has(n) || Object.values(RENAME).includes(n)),
    );
    const impRe = /import\s*\{([^}]*)\}\s*from\s*'@phosphor-icons\/react'/;

    if (need.length) {
      const found = impRe.exec(code);
      if (found) {
        const existing = found[1].split(',').map((s) => s.trim()).filter(Boolean);
        const merged = [...existing];
        for (const n of need) if (!merged.includes(n)) merged.push(n);
        code = code.replace(impRe, `import { ${merged.join(', ')} } from '${PKG}'`);
        localChanges.push(`+ import { ${need.join(', ')} }`);
      } else {
        // insert a fresh import after the last import line
        const lines = code.split('\n');
        let last = -1;
        for (let i = 0; i < lines.length; i++) {
          if (/^import\s/.test(lines[i])) last = i;
        }
        lines.splice(last + 1, 0, `import { ${need.join(', ')} } from '${PKG}';`);
        code = lines.join('\n');
        localChanges.push(`+ new import { ${need.join(', ')} }`);
      }
    }

    // dedupe phosphor import specifiers
    code = code.replace(impRe, (_full, names) => {
      const seen = new Set();
      const keep = [];
      for (const raw of names.split(',')) {
        const t = raw.trim();
        if (!t) continue;
        const key = t.split(/\s+as\s+/)[0].trim();
        if (seen.has(key)) continue;
        seen.add(key);
        keep.push(t);
      }
      return `import { ${keep.join(', ')} } from '${PKG}'`;
    });
  }

  if (code !== original) {
    changedAny = true;
    console.log(`${APPLY ? 'fixed' : 'would fix'}  ${path.relative(process.cwd(), file)}`);
    for (const c of localChanges) console.log(`        ${c}`);
    if (APPLY) fs.writeFileSync(file, code);
  }
}

if (unresolved.length) {
  console.log('\nUNRESOLVED (not an icon, needs a manual look):');
  for (const u of unresolved) console.log(`  ${u}`);
}
if (!changedAny) console.log('No changes needed.');
