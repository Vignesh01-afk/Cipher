/*
 * Concern: class-string normalisation.
 *
 *   1. Strips banned primitives from `className="..."` attribute strings:
 *        bg-gradient-*, from-*, via-*, to-*,
 *        shadow-*, backdrop-blur-*, animate-*,
 *        hover:scale-*, hover:-translate-*, active:scale-*,
 *        pulse, transition-* (replaced by the flat classes now in index.css).
 *   2. Normalises oversized radii to rounded-md, except on avatar inputs.
 *   3. Remaps legacy colour aliases (orange/brand/violet/rose/amber/pink/emerald/teal)
 *      to the new token ramp (accent / danger).
 *
 * Only `className` attribute strings are touched. Other string literals (labels,
 * help text, etc.) and template literals outside className are left alone.
 *
 * Also removed: transition-* / duration-* / delay-* / motion-* / prefers-*
 * tokens (the new flat classes in index.css + the .btn/.card/.input/.badge
 * .nav-link rules now own the only transitions the UI uses).
 *
 * Replacements are computed against ONE snapshot of the file and spliced
 * back-to-front, so offsets never go stale.
 *
 *   node scripts/stage2-migrate.mjs <file> [...]
 */
import fs from 'node:fs';

const LEGACY_COLOURS = new Map([
  ['orange', 'accent'],
  ['brand', 'accent'],
  ['violet', 'accent'],
  ['rose', 'danger'],
  ['amber', 'danger'],
  ['pink', 'danger'],
  ['emerald', 'accent'],
  ['teal', 'accent'],
]);

/**
 * Find every `className="..."` attribute string in `src`.
 * Returns array of { start, end } (character offsets in the original,
 * end is exclusive and points just past the closing quote).
 */
function findClassNames(src) {
  const spans = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (c2 === '//') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c2 === '/*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      // Is this a className attribute? Look backwards for `className=` with
      // only optional whitespace and (in JSX) `:` possible.
      let j = i - 1;
      while (j >= 0 && (src[j] === ' ' || src[j] === '\n' || src[j] === '=' || src[j] === ':' || src[j] === '{' || src[j] === ')' || src[j] === ',')) j--;
      if (j >= 0 && src.slice(j, i).trim().toLowerCase() === 'classname') {
        const start = i;
        const quote = c;
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === '\\') i++;
          if (i < src.length) i++;
        }
        const end = i; // position just past closing quote
        spans.push({ start, end });
      }
      if (i < src.length) i++;
    } else {
      i++;
    }
  }
  return spans;
}

/**
 * Rewrite the *inner* text of one className string (between the quotes).
 * Returns a new inner string. Tokens are split on whitespace and each is
 * rewritten by the rules below.
 */
function rewriteClassNameInner(inner) {
  // avatar hint: rounded-full on an avatar input stays.
  const hasAvatarHint = /h-8\s+w-8|h-9\s+w-9|h-10\s+w-10|h-12\s+w-12|ring-2.*ring-accent|ring-2.*ring-brand|ring-2.*ring-violet|ring-2.*ring-rose|ring-2.*ring-amber|ring-2.*ring-pink|ring-2.*ring-emerald|ring-2.*ring-teal|ring-2.*ring-orange|h-10.*text-white|h-9.*text-white|h-8.*text-white|text-white.*h-10|text-white.*h-9|text-white.*h-8|h-\d+\s+w-\d+\s+text-white|text-white.*h-\d+/.test(inner);
  return inner
    .split(/\s+/)
    .map((tok) => rewriteToken(tok, hasAvatarHint))
    .filter(Boolean)
    .join(' ');
}

function rewriteToken(tok, avatarHint) {
  if (isBanned(tok)) return '';
  if (isRadiusOversized(tok)) {
    if (avatarHint && tok === 'rounded-full') return tok; // keep avatar
    return 'rounded-md';
  }
  return remapColour(tok);
}

const BANNED_PREFIX = new Set([
  'bg-gradient-', 'from-', 'via-', 'to-', 'shadow-', 'backdrop-blur-',
  'animate-', 'hover:scale-', 'hover:-translate-', 'active:scale-',
]);

const BANNED_EXACT = new Set([
  // motion / transitions that the new flat classes replace
  'duration-75', 'duration-100', 'duration-150', 'duration-200', 'duration-250',
  'duration-300', 'duration-350', 'duration-400', 'duration-500', 'duration-700',
  'duration-1000', 'delay-75', 'delay-100', 'delay-150', 'delay-200', 'delay-250',
  'delay-300', 'delay-350', 'delay-400', 'delay-500', 'delay-700', 'delay-1000',
  'ease-linear', 'ease-in', 'ease-out', 'ease-in-out',
  'transition', 'transition-all', 'transition-colors', 'transition-opacity',
  'transition-shadow', 'transition-transform', 'transition-[transform,opacity]',
  'transition-[transform,color,opacity]', 'transition-[width,height,opacity]',
  'transition-[transform,opacity,background-color]',
  'motion-safe', 'motion-reduce', 'prefers-reduced-motion',
  // border colours that did not come from .btn / .card / .input / .badge / .nav-link
  'border-transparent', 'border-stone-100', 'border-stone-200', 'border-stone-300',
  'border-stone-400', 'border-stone-500', 'border-stone-600', 'border-stone-700',
  'border-accent-200', 'border-accent-300', 'border-accent-400', 'border-accent-500',
  'border-danger-200', 'border-danger-300', 'border-danger-400', 'border-danger-500',
  'border-slate-200', 'border-slate-300', 'border-slate-400', 'border-slate-500',
  'border-emerald-200', 'border-emerald-300', 'border-emerald-400', 'border-emerald-500',
  'border-amber-200', 'border-amber-300', 'border-amber-400', 'border-amber-500',
  'border-rose-200', 'border-rose-300', 'border-rose-400', 'border-rose-500',
  'border-violet-200', 'border-violet-300', 'border-violet-400', 'border-violet-500',
  'border-pink-200', 'border-pink-300', 'border-pink-400', 'border-pink-500',
  'border-cyan-200', 'border-cyan-300', 'border-cyan-400', 'border-cyan-500',
  'border-indigo-200', 'border-indigo-300', 'border-indigo-400', 'border-indigo-500',
  'border-orange-200', 'border-orange-300', 'border-orange-400', 'border-orange-500',
  'border-brand-200', 'border-brand-300', 'border-brand-400', 'border-brand-500',
  'border-white/10', 'border-white/20', 'border-white/30', 'border-white/40',
  'border-white/50', 'border-white/60', 'border-white/70', 'border-white/80',

  // backgrounds that weren't chosen by the new flat classes
  'bg-transparent', 'bg-white/5', 'bg-white/10', 'bg-white/15', 'bg-white/20',
  'bg-white/30', 'bg-white/40', 'bg-white/50', 'bg-white/60', 'bg-white/70',
  'bg-white/80', 'bg-white/90', 'bg-white',
  'bg-surface/5', 'bg-surface/10', 'bg-surface/20', 'bg-surface/30', 'bg-surface/40',
  'bg-surface/50', 'bg-surface/60', 'bg-surface/70', 'bg-surface/80', 'bg-surface/90',
  'bg-surface/95', 'bg-surface',
  'bg-stone-50', 'bg-stone-100', 'bg-stone-200', 'bg-stone-300', 'bg-stone-400',
  'bg-stone-500', 'bg-stone-600', 'bg-stone-700', 'bg-stone-800', 'bg-stone-900',
  'bg-stone-950',
  'bg-accent-50', 'bg-accent-100', 'bg-accent-200', 'bg-accent-300', 'bg-accent-400',
  'bg-accent-500', 'bg-accent-600', 'bg-accent-700', 'bg-accent-800', 'bg-accent-900',
  'bg-accent-950',
  'bg-danger-50', 'bg-danger-100', 'bg-danger-200', 'bg-danger-300', 'bg-danger-400',
  'bg-danger-500', 'bg-danger-600', 'bg-danger-700', 'bg-danger-800', 'bg-danger-900',
  'bg-danger-950',
  'bg-emerald-50', 'bg-emerald-100', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-400',
  'bg-emerald-500', 'bg-emerald-600', 'bg-emerald-700', 'bg-emerald-800', 'bg-emerald-900',
  'bg-amber-50', 'bg-amber-100', 'bg-amber-200', 'bg-amber-300', 'bg-amber-400',
  'bg-amber-500', 'bg-amber-600', 'bg-amber-700', 'bg-amber-800', 'bg-amber-900',
  'bg-rose-50', 'bg-rose-100', 'bg-rose-200', 'bg-rose-300', 'bg-rose-400',
  'bg-rose-500', 'bg-rose-600', 'bg-rose-700', 'bg-rose-800', 'bg-rose-900',
  'bg-violet-50', 'bg-violet-100', 'bg-violet-200', 'bg-violet-300', 'bg-violet-400',
  'bg-violet-500', 'bg-violet-600', 'bg-violet-700', 'bg-violet-800', 'bg-violet-900',
  'bg-pink-50', 'bg-pink-100', 'bg-pink-200', 'bg-pink-300', 'bg-pink-400',
  'bg-pink-500', 'bg-pink-600', 'bg-pink-700', 'bg-pink-800', 'bg-pink-900',
  'bg-cyan-50', 'bg-cyan-100', 'bg-cyan-200', 'bg-cyan-300', 'bg-cyan-400',
  'bg-cyan-500', 'bg-cyan-600', 'bg-cyan-700', 'bg-cyan-800', 'bg-cyan-900',
  'bg-indigo-50', 'bg-indigo-100', 'bg-indigo-200', 'bg-indigo-300', 'bg-indigo-400',
  'bg-indigo-500', 'bg-indigo-600', 'bg-indigo-700', 'bg-indigo-800', 'bg-indigo-900',
  'bg-orange-50', 'bg-orange-100', 'bg-orange-200', 'bg-orange-300', 'bg-orange-400',
  'bg-orange-500', 'bg-orange-600', 'bg-orange-700', 'bg-orange-800', 'bg-orange-900',
  'bg-brand-50', 'bg-brand-100', 'bg-brand-200', 'bg-brand-300', 'bg-brand-400',
  'bg-brand-500', 'bg-brand-600', 'bg-brand-700', 'bg-brand-800', 'bg-brand-900',
  // text colours that came off the old palette
  'text-transparent', 'text-stone-50', 'text-stone-100', 'text-stone-200',
  'text-stone-300', 'text-stone-400', 'text-stone-500', 'text-stone-600',
  'text-stone-700', 'text-stone-800', 'text-stone-900', 'text-stone-950',
  'text-accent-50', 'text-accent-100', 'text-accent-200', 'text-accent-300',
  'text-accent-400', 'text-accent-600', 'text-accent-700', 'text-accent-800',
  'text-accent-900', 'text-accent-950',
  'text-danger-50', 'text-danger-100', 'text-danger-200', 'text-danger-300',
  'text-danger-400', 'text-danger-600', 'text-danger-700', 'text-danger-800',
  'text-danger-900', 'text-danger-950',
  'text-emerald-50', 'text-emerald-100', 'text-emerald-200', 'text-emerald-300',
  'text-emerald-400', 'text-emerald-600', 'text-emerald-700', 'text-emerald-800',
  'text-emerald-900', 'text-emerald-950',
  'text-amber-50', 'text-amber-100', 'text-amber-200', 'text-amber-300',
  'text-amber-400', 'text-amber-600', 'text-amber-700', 'text-amber-800',
  'text-amber-900', 'text-amber-950',
  'text-rose-50', 'text-rose-100', 'text-rose-200', 'text-rose-300',
  'text-rose-400', 'text-rose-600', 'text-rose-700', 'text-rose-800',
  'text-rose-900', 'text-rose-950',
  'text-violet-50', 'text-violet-100', 'text-violet-200', 'text-violet-300',
  'text-violet-400', 'text-violet-600', 'text-violet-700', 'text-violet-800',
  'text-violet-900', 'text-violet-950',
  'text-pink-50', 'text-pink-100', 'text-pink-200', 'text-pink-300',
  'text-pink-400', 'text-pink-600', 'text-pink-700', 'text-pink-800',
  'text-pink-900', 'text-pink-950',
  'text-cyan-50', 'text-cyan-100', 'text-cyan-200', 'text-cyan-300',
  'text-cyan-400', 'text-cyan-600', 'text-cyan-700', 'text-cyan-800',
  'text-cyan-900', 'text-cyan-950',
  'text-indigo-50', 'text-indigo-100', 'text-indigo-200', 'text-indigo-300',
  'text-indigo-400', 'text-indigo-600', 'text-indigo-700', 'text-indigo-800',
  'text-indigo-900', 'text-indigo-950',
  'text-orange-50', 'text-orange-100', 'text-orange-200', 'text-orange-300',
  'text-orange-400', 'text-orange-600', 'text-orange-700', 'text-orange-800',
  'text-orange-900', 'text-orange-950',
  'text-brand-50', 'text-brand-100', 'text-brand-200', 'text-brand-300',
  'text-brand-400', 'text-brand-600', 'text-brand-700', 'text-brand-800',
  'text-brand-900', 'text-brand-950',
  'text-white/80', 'text-white/70', 'text-white/60', 'text-white/50', 'text-white/40',
  'text-white/30', 'text-white/20', 'text-white/10', 'text-white',
  'text-stone-200/60', 'text-stone-300/60',
  'text-[#4A6CF7]', 'text-[#D946EF]', 'text-[#8B5CF6]', 'text-[#6366F1]',
  'text-[#3D55E0]', 'text-[#A3B4FF]', 'text-[#7C5CF6]', 'text-[#5A4FDB]',
  'text-[#0B6E5E]', 'text-[#4FA58F]', 'text-[#2E8B57]',
  // misc decorative visual tokens
  'ring-1', 'ring-2', 'ring-4', 'ring-8', 'ring-inset', 'ring-white/40',
  'ring-white/30', 'ring-white/20', 'ring-white/10', 'ring-white/5',
  'ring-surface/50', 'ring-surface/30', 'ring-surface/20', 'ring-surface/10',
  'ring-accent/50', 'ring-accent/30', 'ring-accent/20', 'ring-accent/10',
  'ring-amber/50', 'ring-amber/30', 'ring-amber/20', 'ring-amber/10',
  'ring-rose/50', 'ring-rose/30', 'ring-rose/20', 'ring-rose/10',
  'ring-violet/50', 'ring-violet/30', 'ring-violet/20', 'ring-violet/10',
  'ring-brand/50', 'ring-brand/30', 'ring-brand/20', 'ring-brand/10',
  'ring-emerald/50', 'ring-emerald/30', 'ring-emerald/20', 'ring-emerald/10',
  'ring-teal/50', 'ring-teal/30', 'ring-teal/20', 'ring-teal/10',
  'ring-orange/50', 'ring-orange/30', 'ring-orange/20', 'ring-orange/10',
  'ring-pink/50', 'ring-pink/30', 'ring-pink/20', 'ring-pink/10',
  'ring-stone/50', 'ring-stone/30', 'ring-stone/20', 'ring-stone/10',
  'ring-slate/50', 'ring-slate/30', 'ring-slate/20', 'ring-slate/10',
  'ring-cyan/50', 'ring-cyan/30', 'ring-cyan/20', 'ring-cyan/10',
  'ring-indigo/50', 'ring-indigo/30', 'ring-indigo/20', 'ring-indigo/10',
  'ring-danger/50', 'ring-danger/30', 'ring-danger/20', 'ring-danger/10',
  'ring-offset-2', 'ring-offset-4', 'ring-offset-8', 'ring-offset-inset',
  'ring-offset-white', 'ring-offset-stone-50', 'ring-offset-stone-100',
  'ring-offset-stone-950', 'ring-offset-danger-50', 'ring-offset-danger-900',
  'ring-offset-accent-50', 'ring-offset-accent-900',
  'ring-offset-slate-50', 'ring-offset-slate-950', 'ring-offset-emerald-50',
  'ring-offset-emerald-900', 'ring-offset-amber-50', 'ring-offset-amber-900',
  'ring-offset-rose-50', 'ring-offset-rose-900', 'ring-offset-violet-50',
  'ring-offset-violet-900', 'ring-offset-pink-50', 'ring-offset-pink-900',
  'ring-offset-cyan-50', 'ring-offset-cyan-900', 'ring-offset-indigo-50',
  'ring-offset-indigo-900', 'ring-offset-orange-50', 'ring-offset-orange-900',
  'ring-offset-brand-50', 'ring-offset-brand-900',
]);

function isBanned(tok) {
  if (BANNED_PREFIX.has(tok)) return true;
  for (const p of BANNED_PREFIX) {
    if (tok.startsWith(p)) return true;
  }
  if (/^backdrop-blur($|\d)/.test(tok)) return true;
  if (/^animate-/.test(tok)) return true;
  if (/^shadow\[/.test(tok)) return true;
  if (/^scale-\d/.test(tok) || /^scale\[/.test(tok)) return true;
  if (/^hover:scale-\d/.test(tok)) return true;
  if (/^hover:-translate-y/.test(tok)) return true;
  if (/^active:scale-\d/.test(tok)) return true;
  if (/^hover:-translate-y-/.test(tok)) return true;
  if (/^(pulse|bounce|spin|wiggle|slow)$/.test(tok)) return true;
  return false;
}

function isRadiusOversized(tok) {
  return tok === 'rounded-2xl' || tok === 'rounded-3xl' || tok === 'rounded-xl' || tok === 'rounded-full';
}

function remapColour(tok) {
  const m = tok.match(/^(orange|brand|violet|rose|amber|pink|emerald|teal)(?:-(50|100|200|300|400|500|600|700|800|900|950))?$/);
  if (!m) return tok;
  const base = LEGACY_COLOURS.get(m[1]) ?? m[1];
  const shade = m[2];
  return shade ? base + '-' + shade : base;
}

/** Rewrite every className attribute string in `src` in place. */
function apply(src) {
  const spans = findClassNames(src);
  let next = src;
  // Splicing must go back-to-front so offsets stay stable.
  for (let i = spans.length - 1; i >= 0; i--) {
    const { start, end } = spans[i];
    const oldInner = next.slice(start + 1, end - 1); // inside quotes
    const newInner = rewriteClassNameInner(oldInner);
    if (newInner !== oldInner) {
      // replace the inner only (quotes stay)
      next = next.slice(0, start + 1) + newInner + next.slice(end - 1);
    }
  }
  return next;
}

// ---- file loop ---------------------------------------------------------
for (const file of process.argv.slice(2)) {
  const original = fs.readFileSync(file, 'utf8');
  const next = apply(original);
  const changed = next !== original;
  if (changed) fs.writeFileSync(file, next);
  console.log(`${changed ? 'migrated' : 'unchanged'}\t${file}`);
}
