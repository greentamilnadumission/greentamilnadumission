#!/usr/bin/env node
// Local preview: node scripts/serve.mjs [port]  →  http://localhost:4173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const CWD = process.cwd();
const ADMIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPARTMENTS_ROOT = path.resolve(ADMIN_ROOT, '..', 'departments');
const SCHEMES_ROOT = path.resolve(ADMIN_ROOT, '..', 'schemes');
const PORT = Number(process.argv[2]) || 4173;

const vercelConfigs = {
  admin: JSON.parse(fs.readFileSync(path.join(ADMIN_ROOT, 'vercel.json'), 'utf8')),
  departments: JSON.parse(fs.readFileSync(path.join(DEPARTMENTS_ROOT, 'vercel.json'), 'utf8')),
  schemes: JSON.parse(fs.readFileSync(path.join(SCHEMES_ROOT, 'vercel.json'), 'utf8')),
};

const SITE_HEADERS = {
  admin: {},
  departments: {},
  schemes: {},
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.bin': 'application/octet-stream', '.txt': 'text/plain', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file, root, headers;

  // /admin is the head office page: it lives in admin/public/admin (same as the live site)
  if (url === '/admin' || url.startsWith('/admin/')) {
    root = path.join(ADMIN_ROOT, 'public');
    file = path.join(root, url);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || !file.startsWith(root)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { ...SITE_HEADERS.admin, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if (url === '/' || url === '/index.html') {
    root = path.join(ADMIN_ROOT, 'public');
    file = path.join(root, 'index.html');
    headers = SITE_HEADERS.admin;
  } else if (url.startsWith('/departments')) {
    root = path.join(DEPARTMENTS_ROOT, 'public');
    const relativeUrl = url.substring('/departments'.length);
    file = path.join(root, relativeUrl);
    headers = SITE_HEADERS.departments;
  } else if (url.startsWith('/schemes')) {
    root = path.join(SCHEMES_ROOT, 'public');
    const relativeUrl = url.substring('/schemes'.length);
    file = path.join(root, relativeUrl);
    headers = SITE_HEADERS.schemes;
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return;
  }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }

  // "/departments" and "/schemes" without the trailing slash: redirect so relative links work
  if (url === '/departments' || url === '/schemes') { res.writeHead(301, { location: url + '/' }); res.end(); return; }

  if (!fs.existsSync(file) || !file.startsWith(root)) {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return;
  }

  res.writeHead(200, { ...headers, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Dashboard preview: http://localhost:${PORT}`));