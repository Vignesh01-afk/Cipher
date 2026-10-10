/*
 * One-shot codemod for the design-system swap.
 *
 *   1. rewrites lucide-react imports to @phosphor-icons/react (name mapped)
 *   2. strips every banned Tailwind primitive (gradients, shadows, blur,
 *      oversized radii, animations, hover transforms, pure white fills)
 *   3. removes em dashes and emoji from source
 *
 * Run with: node scripts/codemod.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');

const ICON_MAP = {
  Activity: 'Pulse',
  AlertCircle: 'WarningCircle',
  AlertOctagon: 'WarningOctagon',
  AlertTriangle: 'Warning',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Ban: 'Prohibit',
  Bell: 'Bell',
  Camera: 'Camera',
  Check: 'Check',
  CheckCheck: 'Checks',
  CheckCircle2: 'CheckCircle',
  ChevronDown: 'CaretDown',
  Clock: 'Clock',
  Compass: 'Compass',
  Copy: 'Copy',
  Eye: 'Eye',
  EyeOff: 'EyeSlash',
  File: 'File',
  FilePlus2: 'FilePlus',
  FileText: 'FileText',
  FileX2: 'FileX',
  Film: 'FilmSlate',
  FolderOpen: 'FolderOpen',
  Home: 'House',
  Image: 'Image',
  Info: 'Info',
  KeyRound: 'Key',
  Link: 'Link',
  Loader2: 'CircleNotch',
  Lock: 'Lock',
  LogIn: 'SignIn',
  LogOut: 'SignOut',
  Mail: 'Envelope',
  MessageSquare: 'ChatCircle',
  MonitorX: 'Monitor',
  Moon: 'Moon',
  Music: 'MusicNote',
  RefreshCw: 'ArrowClockwise',
  Save: 'FloppyDisk',
  Search: 'MagnifyingGlass',
  Server: 'HardDrives',
  Settings: 'Gear',
  Share2: 'ShareNetwork',
  Shield: 'Shield',
  ShieldAlert: 'ShieldWarning',
  ShieldCheck: 'ShieldCheck',
  ShieldOff: 'ShieldSlash',
  Sparkles: 'Star',
  Sun: 'Sun',
  Tag: 'Tag',
  Timer: 'Timer',
  Trash2: 'Trash',
  Unlock: 'LockOpen',
  UploadCloud: 'CloudArrowUp',
  User: 'User',
  UserCheck: 'UserCheck',
  UserPlus: 'UserPlus',
  Users: 'Users',
  Wallet: 'Wallet',
  Waves: 'Waves',
  X: 'X',
  XCircle: 'XCircle',
};

const COLOR_WORDS = [
  'brand', 'violet', 'pink', 'orange', 'emerald', 'amber', 'cyan', 'teal',
  'slate', 'stone', 'rose', 'accent', 'danger', 'paper', 'surface', 'line',
  'ink', 'muted', 'white', 'black', 'indigo', 'fuchsia', 'lime', 'sky',
];

const stats = { icons: 0, tokens: 0, dashes: 0, emoji: 0, files: 0 };

function relativeIconsImport(file) {
  const from = path.dirname(file);
  let rel = path.relative(from, path.join(SRC, 'lib', 'icons')).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function rewriteIcons(text, file) {
  const re = /import\s*\{([\s\S]*?)\}\s*from\s*'lucide-react';/g;
  let any = false;
  const out = text.replace(re, (whole, inner) => {
    any = true;
    stats.icons += 1;
    const specifiers = inner.split(',').map((s) => s.trim()).filter(Boolean);
    const names = [];
    let needsIconComponent = false;
    for (const spec of specifiers) {
      const isType = /^type\s+/.test(spec);
      const bare = spec.replace(/^type\s+/, '').trim();
      const parts = bare.split(/\s+as\s+/).map((s) => s.trim());
      const orig = parts[0];
      const alias = parts[1];
      if (orig === 'LucideIcon') {
        needsIconComponent = true;
        continue;
      }
      const mapped = ICON_MAP[orig] ?? orig;
      const emitted = alias && alias !== mapped ? `${mapped} as ${alias}` : mapped;
      names.push(isType ? `type ${emitted}` : emitted);
    }
    const lines = [];
    if (names.length) lines.push(`import { ${names.join(', ')} } from '@phosphor-icons/react';`);
    if (needsIconComponent) {
      lines.push(`import type { IconComponent } from '${relativeIconsImport(file)}';`);
    }
    return lines.join('\n');
  });
  return { out, changed: any };
}

function stripTokens(text, file) {
  let out = text;
  const before = out;

  // Gradient primitives, including gradient-clipped text.
  out = out.replace(/\bbg-gradient-to-\S+/g, '');
  for (const c of COLOR_WORDS) {
    out = out.replace(new RegExp(`\\bfrom-${c}(-[\\w\\[\\]\\/.]+)?`, 'g'), '');
    out = out.replace(new RegExp(`\\bvia-${c}(-[\\w\\[\\]\\/.]+)?`, 'g'), '');
    out = out.replace(new RegExp(`\\bto-${c}(-[\\w\\[\\]\\/.]+)?`, 'g'), '');
  }
  out = out.replace(/\bfrom-\[[^\]]*\]/g, '');
  out = out.replace(/\bvia-\[[^\]]*\]/g, '');
  out = out.replace(/\bto-\[[^\]]*\]/g, '');
  out = out.replace(/\bbg-clip-text\b/g, '');
  out = out.replace(/\btext-transparent\b/g, '');

  // Shadows, blur, animation, hover transforms.
  out = out.replace(/\bshadow-(\[[^\]]*\]|\S+)/g, '');
  out = out.replace(/\bbackdrop-blur-\S+/g, '');
  out = out.replace(/\bbackdrop-blur\b/g, '');
  out = out.replace(/\banimate-\S+/g, '');
  out = out.replace(/\bhover:scale-\S+/g, '');
  out = out.replace(/\bhover:scale\b/g, '');
  out = out.replace(/\bhover:-translate-\S+/g, '');
  out = out.replace(/\bactive:scale-\S+/g, '');
  out = out.replace(/\bactive:scale\b/g, '');

  // Motion on hover.
  out = out.replace(/\btransition-all\b/g, '');
  out = out.replace(/\btransition-\S+/g, '');
  out = out.replace(/\btransition\b/g, '');
  out = out.replace(/\bduration-\d+/g, '');

  // Radii above 6px.
  out = out.replace(/\brounded-(3xl|2xl|xl|lg)\b/g, 'rounded-md');
  // Fully round is reserved for avatars.
  if (!/Avatar\.tsx$/.test(file)) {
    out = out.replace(/\brounded-full\b/g, 'rounded-md');
  }

  // Pure white page fills.
  out = out.replace(/\bbg-white\b/g, 'bg-surface');
  out = out.replace(/#FFFFFF/gi, '#FAF8F3');

  if (out !== before) stats.tokens += 1;
  return out;
}

function stripProse(text) {
  let out = text;
  if (out.includes('\u2014')) {
    out = out.replace(/\s*\u2014\s*/g, ', ');
    stats.dashes += 1;
  }
  const emojiRe = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
  const stripped = out.replace(emojiRe, '');
  if (stripped !== out) {
    stats.emoji += 1;
    out = stripped;
  }
  return out;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|css|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

for (const file of walk(SRC)) {
  const original = fs.readFileSync(file, 'utf8');
  let next = original;
  if (/lucide-react|LucideIcon/.test(next)) {
    next = rewriteIcons(next, file).out;
    next = next.replace(/\bLucideIcon\b/g, 'IconComponent');
  }
  next = stripTokens(next, file);
  next = stripProse(next);
  if (next !== original) {
    fs.writeFileSync(file, next, 'utf8');
    stats.files += 1;
  }
}

console.log(
  `codemod: ${stats.files} files, ${stats.icons} icon imports, ` +
    `${stats.tokens} token files, ${stats.dashes} dash files, ${stats.emoji} emoji files`,
);
