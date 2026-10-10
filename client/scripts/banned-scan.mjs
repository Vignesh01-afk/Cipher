import fs from 'node:fs';
import path from 'node:path';

const bad = [
  'lucide-react',
  '@phosphor',
  'Inter,',
  'Inter;',
  'Geist',
  'Space Grotesk',
  'spacegrotesk',
  'bg-gradient',
  'from-',
  'via-',
  'to-',
  'shadow-',
  'backdrop-blur',
  'rounded-2xl',
  'rounded-3xl',
  'hover:scale',
  'hover:-translate',
  'animate-',
  '#FFFFFF',
  'bg-white',
  '\u2014',
];

const out = [];
const walk = (p) => {
  let entries;
  try { entries = fs.readdirSync(p, { withFileTypes: true }); }
  catch { return; }
  for (const f of entries) {
    const pp = p + '/' + f.name;
    if (f.isDirectory()) {
      if (/node_modules|\.git|dist|build/.test(pp)) continue;
      walk(pp);
    } else if (!/\.(ts|tsx|css|html|json|mjs)$/i.test(f.name)) continue;
    let t;
    try { t = fs.readFileSync(pp, 'utf8'); }
    catch { continue; }
    for (const s of bad) {
      const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const c = (t.match(re) || []).length;
      if (c) out.push(pp + ' :: ' + s + ' :: ' + c);
    }
  }
};

walk('src');
walk('.');
out.sort();
out.forEach((o) => console.log(o));
console.log('TOTAL', out.length);
