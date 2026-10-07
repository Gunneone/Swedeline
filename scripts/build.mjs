#!/usr/bin/env node
// Builds the extension for Chrome and Firefox from one source tree:
//   dist/chrome/   (background service worker)
//   dist/firefox/  (background event page, gecko settings)
// Usage: node scripts/build.mjs [chrome|firefox] [--watch]

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const targets = args.filter((a) => !a.startsWith('--'));
const browsers = targets.length ? targets : ['chrome', 'firefox'];
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const FIREFOX_ID = 'swedeline@swedeline-extension';

function manifestFor(browser) {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.base.json'), 'utf8'));
  m.version = pkg.version;
  if (browser === 'chrome') {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '121';
  } else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        id: FIREFOX_ID,
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '142.0' },
    };
  }
  return m;
}

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, filter);
    else if (filter(entry.name)) fs.copyFileSync(src, dst);
  }
}

function copyStatic(out, browser) {
  copyDir(path.join(SRC, '_locales'), path.join(out, '_locales'));
  copyDir(path.join(SRC, 'icons'), path.join(out, 'icons'), (f) => !f.includes('256'));
  fs.mkdirSync(path.join(out, 'dict'), { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, 'dict'))) {
    if (f.endsWith('.json')) fs.copyFileSync(path.join(SRC, 'dict', f), path.join(out, 'dict', f));
  }
  fs.mkdirSync(path.join(out, 'popup'), { recursive: true });
  for (const f of ['popup.html', 'popup.css']) fs.copyFileSync(path.join(SRC, 'popup', f), path.join(out, 'popup', f));
  fs.copyFileSync(path.join(SRC, 'content', 'content.css'), path.join(out, 'content.css'));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifestFor(browser), null, 2) + '\n');
}

function buildOptions(out) {
  return {
    entryPoints: {
      background: path.join(SRC, 'background', 'index.ts'),
      content: path.join(SRC, 'content', 'index.ts'),
      'popup/popup': path.join(SRC, 'popup', 'popup.ts'),
    },
    outdir: out,
    bundle: true,
    format: 'iife',
    target: ['chrome121', 'firefox140'],
    minify: false,
    sourcemap: watch ? 'inline' : false,
    logLevel: 'warning',
    legalComments: 'none',
  };
}

for (const browser of browsers) {
  const out = path.join(ROOT, 'dist', browser);
  fs.rmSync(out, { recursive: true, force: true });
  copyStatic(out, browser);
  if (watch) {
    const ctx = await esbuild.context(buildOptions(out));
    await ctx.watch();
    fs.watch(SRC, { recursive: true }, (_event, file) => {
      if (file && !file.endsWith('.ts')) copyStatic(out, browser);
    });
    console.log(`watching ${path.relative(ROOT, out)}`);
  } else {
    await esbuild.build(buildOptions(out));
    console.log(`built ${path.relative(ROOT, out)}`);
  }
}
