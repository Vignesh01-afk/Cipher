/*
 * design:check
 *
 * Fails the build when a banned design primitive creeps back into the client.
 * No dependencies, plain Node, exit code 1 on any violation.
 *
 *   node scripts/design-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
const ROOT = path.resolve(HERE, '..');

const EXT = /\.(ts|tsx|css|html|md)$/;

const violations = [];

function report(file, line, rule, sample) {
  violations.push({ file: path.relative(ROOT, file), line, rule, sample });
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXT.test(entry.name)) out.push(full);
  }
  return out;
}

/** Strip Tailwind variant prefixes such as `dark:`, `hover:`, `max-lg:`. */
function baseClass(token) {
  let t = token;
  for (let i = 0; i < 4; i += 1) {
    const next = t.replace(/^[a-z0-9-]+:/, '');
    if (next === t) break;
    t = next;
  }
  return t;
}

const FONT_STRINGS = [
  ['Inter', /\bInter\b/],
  ['Geist', /\bGeist\b/],
  ['Space Grotesk', /Space Grotesk/],
];

const EMOJI =
  /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u;

const BANNED_CLASS = [
  [/^bg-gradient/, 'gradient background'],
  [/^from-/, 'gradient from-stop'],
  [/^via-/, 'gradient via-stop'],
  [/^to-/, 'gradient to-stop'],
  [/^shadow-/, 'drop shadow'],
  [/^backdrop-blur/, 'backdrop blur'],
  [/^rounded-2xl/, 'radius larger than 6px'],
  [/^rounded-3xl/, 'radius larger than 6px'],
  [/^animate-/, 'animation utility'],
  [/^blur-/, 'blur'],
  [/^ring-1$/, 'glow ring'],
  [/^ring-2$/, 'glow ring'],
];

for (const file of walk(ROOT)) {
  const isAvatarFile = /avatar/i.test(path.basename(file, path.extname(file)));
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const at = index + 1;

    if (line.includes('\u2014')) report(file, at, 'em dash (U+2014)', line.trim());

    if (line.includes('lucide-react')) report(file, at, 'lucide-react import', line.trim());

    for (const [name, rx] of FONT_STRINGS) {
      if (rx.test(line)) report(file, at, `banned font "${name}"`, line.trim());
    }

    const emoji = line.match(EMOJI);
    if (emoji) report(file, at, `emoji "${emoji[0]}"`, line.trim());

    if (/#ffffff/i.test(line)) report(file, at, 'pure white #FFFFFF', line.trim());

    // Class-shaped tokens only, so prose such as "end-to-end" is not flagged.
    const tokens = line.split(/[\s"'`{}();,]+/).filter(Boolean);
    for (const raw of tokens) {
      const cls = baseClass(raw);

      if (cls === 'bg-white' || cls.startsWith('bg-white/')) {
        report(file, at, 'bg-white page fill', line.trim());
        continue;
      }

      if (raw.includes('hover:scale') || raw.includes('hover:-translate') || raw.includes('active:scale')) {
        report(file, at, 'hover transform', line.trim());
        continue;
      }

      if (cls === 'rounded-full') {
        if (isAvatarFile || /avatar/i.test(line)) continue;
        report(file, at, 'rounded-full outside avatars', line.trim());
        continue;
      }

      const hit = BANNED_CLASS.find(([rx]) => rx.test(cls));
      if (hit) report(file, at, hit[1], line.trim());
    }
  });
}

if (violations.length) {
  console.error(`design:check failed with ${violations.length} violation(s):\n`);
  const byRule = new Map();
  for (const v of violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }
  for (const [rule, list] of byRule) {
    console.error(`  ${rule} (${list.length})`);
    for (const v of list.slice(0, 12)) console.error(`    ${v.file}:${v.line}  ${v.sample}`);
    if (list.length > 12) console.error(`    ... and ${list.length - 12} more`);
    console.error('');
  }
  process.exit(1);
}

console.log('design:check passed');
