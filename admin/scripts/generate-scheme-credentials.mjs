#!/usr/bin/env node
// Creates config/scheme-credentials.local.json with a strong random password for every login ID,
// plus a printable CSV for handing logins to schemes. Existing passwords are kept unless
// you pass --reset <ID> (or --reset all).
//
//   npm run scheme-credentials
//   npm run scheme-credentials -- --reset GTM-SCHEME-1

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = process.cwd(); // the project folder (departments/ or schemes/) the command is run from
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'schemes.json'), 'utf8'));
const file = path.join(ROOT, 'config', 'scheme-credentials.local.json');
const csvFile = path.join(ROOT, 'config', 'scheme-credentials.local.csv');

const resetArg = process.argv.includes('--reset') ? process.argv[process.argv.indexOf('--reset') + 1] : null;
const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

// No look-alike characters (0/O, 1/l/I). 3 groups of 5 ≈ 84 bits of entropy.
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

const logins = [{ id: config.admin.id, name: config.admin.name }, ...config.schemes];
const out = {};
let created = 0;
for (const l of logins) {
  const keep = existing[l.id] && resetArg !== 'all' && resetArg !== l.id;
  out[l.id] = keep ? existing[l.id] : password();
  if (!keep) created++;
}

fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
const csv = ['Scheme,Login ID,Password', ...logins.map(l => `"${l.name}",${l.id},${out[l.id]}`)];
fs.writeFileSync(csvFile, csv.join('\n') + '\n', { mode: 0o600 });

console.log(`${created} new password(s). ${logins.length} logins in total.`);
console.log(`Saved: ${path.relative(process.cwd(), file)} and ${path.relative(process.cwd(), csvFile)} (both git-ignored).`);
console.log('\nPaste the JSON below into the GitHub secret SCHEME_CREDENTIALS:\n');
console.log(JSON.stringify(out));