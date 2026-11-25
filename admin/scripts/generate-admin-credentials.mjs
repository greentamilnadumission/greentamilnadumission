#!/usr/bin/env node
// Creates the head office (GTM-ADMIN) password on its own, apart from the department and scheme logins.
// Writes admin/config/admin-credentials.local.json (for the build on this computer) and a CSV line to hand
// over. The password is kept unless you pass --reset.
//
//   node ../admin/scripts/generate-admin-credentials.mjs            (or: npm run admin-credentials, from departments/ or schemes/)
//   node ../admin/scripts/generate-admin-credentials.mjs --reset
//
// Paste the file's JSON into the ADMIN_CREDENTIALS environment variable on Vercel (root project).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { ADMIN_CREDENTIALS_FILE } from './lib/admin-credentials.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.resolve(here, '..', '..', 'departments', 'config', 'departments.json'), 'utf8'));
const { id, name } = config.admin;
const file = ADMIN_CREDENTIALS_FILE;
const csvFile = file.replace(/\.json$/, '.csv');

const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const reset = process.argv.includes('--reset');

// Same style as the other logins: no look-alike characters, 3 groups of 5.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function password() {
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return groups.join('-');
}

const keep = existing[id] && !reset;
const pw = keep ? (typeof existing[id] === 'string' ? existing[id] : existing[id].password) : password();

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ [id]: pw }, null, 2) + '\n', { mode: 0o600 });
fs.writeFileSync(csvFile, ['Office,Login ID,Password', `"${name}",${id},${pw}`].join('\n') + '\n', { mode: 0o600 });

console.log(keep ? 'Kept the existing head office password.' : 'Created a new head office password.');
console.log(`Saved: ${path.relative(process.cwd(), file)} and ${path.relative(process.cwd(), csvFile)} (both git-ignored).`);
console.log('\nPaste the JSON below into the Vercel variable ADMIN_CREDENTIALS (root project):\n');
console.log(JSON.stringify({ [id]: pw }));
