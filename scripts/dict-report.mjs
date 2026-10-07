#!/usr/bin/env node
// Shows which words Swedeline would replace in a text, to review dictionary quality.
// Every candidate is listed (not just the ones the density setting would pick).
//
//   node scripts/dict-report.mjs                    all fixture articles
//   node scripts/dict-report.mjs en some-file.txt   your own text (or HTML)

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Bundle the content-script modules for Node so the report uses the exact same logic.
const { outputFiles } = await esbuild.build({
  stdin: {
    contents: `export { tokenize } from './src/content/tokenizer';
               export { findCandidates, lookupKey } from './src/content/selector';
               export { detectLanguage } from './src/content/langdetect';`,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { tokenize, findCandidates, detectLanguage } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const toText = (s) =>
  s.replace(/<(title|script|style|h\d|nav|header|footer|pre|label|button)[^]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');

const [langArg, fileArg] = process.argv.slice(2);
const inputs = fileArg
  ? [[langArg, fileArg]]
  : fs.readdirSync(path.join(ROOT, 'tests/fixtures'))
      .filter((f) => /^(en|de|fr|es)-/.test(f))
      .map((f) => [f.slice(0, 2), path.join(ROOT, 'tests/fixtures', f)]);

for (const [lang, file] of inputs) {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/dict', `${lang}.json`), 'utf8')).w;
  const text = toText(fs.readFileSync(file, 'utf8')).replace(/\s+/g, ' ');
  const tokens = tokenize(text, lang);
  const candidates = findCandidates(tokens, lang, (k) => dict[k]);
  console.log(`\n${path.basename(file)}  (${lang}, detected ${detectLanguage(text).lang}, ${tokens.length} words, ${candidates.length} candidates)`);
  for (const c of candidates) {
    const [shown, lemma, gender, , flags] = c.entry;
    const context = text.slice(Math.max(0, c.token.start - 30), c.token.end + 20).trim();
    console.log(`  ${c.token.text.padEnd(14)} → ${(gender ? gender + ' ' : '') + lemma}${shown !== lemma ? ` (${shown})` : ''}${flags.includes('d') ? '  [needs noun context]' : ''}`);
    console.log(`  ${''.padEnd(14)}   …${context}…`);
  }
}
