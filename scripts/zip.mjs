#!/usr/bin/env node
// Packages dist/chrome and dist/firefox as store-ready zips in dist/.
// Run `npm run build` first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const webExt = path.join(ROOT, 'node_modules', '.bin', 'web-ext');

for (const browser of ['chrome', 'firefox']) {
  const source = path.join(ROOT, 'dist', browser);
  if (!fs.existsSync(path.join(source, 'manifest.json'))) throw new Error(`${source} missing: run npm run build`);
  const filename = `swedeline-${browser}-${version}.zip`;
  execFileSync(webExt, ['build', '-s', source, '-a', path.join(ROOT, 'dist'), '--filename', filename, '--overwrite-dest'], {
    stdio: 'inherit',
  });
}
