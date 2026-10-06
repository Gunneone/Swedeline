#!/usr/bin/env node
// Development server for trying the built extension in a normal browser tab:
//   /harness/<fixture>.html  a test article with the content script and an API stub
//   /popup                   the popup, with the API stub
// Run `npm run build` first. Usage: node scripts/serve.mjs [port]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] ?? 5178);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const INJECT_PAGE = `<script src="/dev/stub.js"></script><link rel="stylesheet" href="/dist/chrome/content.css"><script src="/dist/chrome/content.js"></script>`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let file;
    let transform = (s) => s;
    if (url.pathname === '/' || url.pathname === '/harness/') {
      const list = fs.readdirSync(path.join(ROOT, 'tests/fixtures')).filter((f) => f.endsWith('.html'));
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<h1>Trana harness</h1><ul>${list.map((f) => `<li><a href="/harness/${f}">${f}</a></li>`).join('')}<li><a href="/popup">popup</a></li></ul>`);
      return;
    } else if (url.pathname.startsWith('/harness/')) {
      file = path.join(ROOT, 'tests/fixtures', path.basename(url.pathname));
      transform = (s) => s.replace('</body>', `${INJECT_PAGE}</body>`);
    } else if (url.pathname === '/popup') {
      file = path.join(ROOT, 'dist/chrome/popup/popup.html');
      transform = (s) =>
        s
          .replace('<head>', '<head><base href="/dist/chrome/popup/">')
          .replace('<script src="popup.js">', '<script src="/dev/stub.js"></script><script src="popup.js">');
    } else {
      file = path.join(ROOT, path.normalize(url.pathname));
      if (!file.startsWith(ROOT)) file = '';
    }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const ext = path.extname(file);
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(ext === '.html' ? transform(body.toString()) : body);
  })
  .listen(PORT, () => console.log(`Trana harness on http://localhost:${PORT}/`));
