#!/usr/bin/env node
// Checks the English translations (see apps/mail/lib/i18n.ts and apps/server/src/lib/i18n.ts):
//   1. every t('…') / tp(n, '…', '…') key has an English entry;
//   2. no French text is left outside t() in user-facing code (heuristic: accented words).
// Usage: node scripts/i18n-check.mjs [--strict] [path-filter]
//   --strict also fails on (2). A path filter limits the report to matching files.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const filter = args.find((a) => !a.startsWith('--'));

const SIDES = [
  { name: 'ui', dirs: ['apps/mail/app', 'apps/mail/components', 'apps/mail/lib', 'apps/mail/hooks'], dict: 'apps/mail/lib/locales/en' },
  { name: 'engine', dirs: ['apps/server/src'], dict: 'apps/server/src/lib/locales/en' },
];
// Code that is never shown to people: AI prompts and model-facing text stay French on purpose.
const SKIP = [/\/locales\//, /\.test\.tsx?$/, /apps\/server\/src\/ai\/(prompts|prompt-config|prompt-lab|jev|atomic|benchmarks)\.ts$/];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'build') return [];
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

// A string literal: '…', "…" or `…` (template literals without ${} only, for keys).
const LITERAL = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\$]|\\.)*\``;
const CALL = new RegExp(String.raw`\b(t|tp)\(\s*(?:([^,()]+?),\s*)?(${LITERAL})(?:\s*,\s*(${LITERAL}))?`, 'g');
const unquote = (s) => s.slice(1, -1).replace(/\\(['"`\\])/g, '$1');
const FRENCH = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊÎÔÛ]/;

let missing = 0;
let leftovers = 0;
for (const side of SIDES) {
  // Keys, and the same key translated two ways in two files (the last file loaded would win).
  const keys = new Map();
  for (const f of walk(join(ROOT, side.dict))) {
    for (const m of readFileSync(f, 'utf8').matchAll(new RegExp(String.raw`^\s*(${LITERAL})\s*:\s*(${LITERAL})`, 'gm'))) {
      const [key, value] = [unquote(m[1]), unquote(m[2])];
      const seen = keys.get(key);
      if (seen && seen.value !== value) {
        missing++;
        console.log(`conflict ${relative(ROOT, f)}  ${JSON.stringify(key)}: ${JSON.stringify(value)} vs ${JSON.stringify(seen.value)} (${seen.file})`);
      }
      keys.set(key, { value, file: relative(ROOT, f) });
    }
  }

  for (const file of side.dirs.flatMap((d) => walk(join(ROOT, d)))) {
    const rel = relative(ROOT, file);
    if (SKIP.some((re) => re.test(rel)) || (filter && !rel.includes(filter))) continue;
    const src = readFileSync(file, 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const used = [];
    for (const m of code.matchAll(CALL)) {
      if (m[1] === 't' && m[2]) continue; // t(x, …) with a non-literal first argument
      used.push(unquote(m[3]));
      if (m[1] === 'tp' && m[4]) used.push(unquote(m[4]));
    }
    for (const key of used) {
      if (!keys.has(key)) {
        missing++;
        console.log(`missing  ${rel}  ${JSON.stringify(key)}`);
      }
    }
    // French left outside t(): accented literals that are not keys of a t() call on the same line.
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(new RegExp(LITERAL, 'g'))) {
        const text = unquote(m[0]);
        if (!FRENCH.test(text)) continue;
        const before = line.slice(0, m.index);
        if (/\b(t|tp)\(\s*$/.test(before) || /\btp\(.*,\s*$/.test(before)) continue;
        leftovers++;
        if (strict || filter) console.log(`french   ${rel}:${i + 1}  ${text.slice(0, 80)}`);
      }
      // JSX text between tags.
      for (const m of line.matchAll(/>([^<>{}]*[àâçéèêëîïôûùüÿœÀÉ][^<>{}]*)</g)) {
        leftovers++;
        if (strict || filter) console.log(`french   ${rel}:${i + 1}  ${m[1].trim().slice(0, 80)}`);
      }
    });
  }
}
console.log(`\n${missing} missing or conflicting translation(s), ${leftovers} French literal(s) outside t()`);
process.exit(missing > 0 || (strict && leftovers > 0) ? 1 : 0);
