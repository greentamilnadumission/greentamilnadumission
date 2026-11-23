#!/usr/bin/env node
// Downloads the latest export from the gtm-data release and rebuilds public/data.
//
//   npm run update            — on your own computer
//   Vercel runs this as its build command on every deploy (see vercel.json), with
//   GTM_DATA_TOKEN and DEPT_CREDENTIALS set under Project → Settings → Environment Variables.
//
// The GitHub token is read from (first match wins):
//   1. the GTM_DATA_TOKEN environment variable
//   2. the file config/github-token.local.txt  (git-ignored — paste the token on one line)
// The token needs read access to the gtm-data repository (fine-grained: Contents → Read-only).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = process.cwd(); // the project folder (departments/ or schemes/)
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.GTM_DATA_REPO || 'greentamilnadumission/gtm-data';
const TAG = 'latest-export';
const ASSET = 'merged.csv.gz';
const API = process.env.GTM_API_BASE || 'https://api.github.com'; // overridable for testing
const OUTPUT = path.join(ROOT, ASSET);

const token = readToken();
const headers = {
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'gtm-dashboard-update',
};

console.log(`Checking the "${TAG}" release of ${REPO}…`);
const relRes = await fetch(`${API}/repos/${REPO}/releases/tags/${TAG}`, { headers: { ...headers, Accept: 'application/vnd.github+json' } });
if (relRes.status === 401) fail('GitHub rejected the token. It may be mistyped, expired or deleted. Create a new one and try again.');
if (relRes.status === 403) fail('GitHub refused access. Check that the token has Contents: Read-only access to gtm-data, and that it was approved by the organisation if required.');
if (relRes.status === 404) fail(`GitHub couldn't find the "${TAG}" release in ${REPO}. Either the token has no access to that repository, or the release name changed.`);
if (!relRes.ok) fail(`GitHub answered ${relRes.status} ${relRes.statusText} when reading the release.`);
const release = await relRes.json();
const asset = (release.assets || []).find(a => a.name === ASSET);
if (!asset) fail(`The "${TAG}" release has no ${ASSET} file.`);
console.log(`Found ${ASSET} (${(asset.size / 1048576).toFixed(1)} MB), uploaded ${new Date(asset.updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`);

const fileRes = await fetch(asset.url, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'follow' });
if (!fileRes.ok || !fileRes.body) fail(`Downloading ${ASSET} failed: ${fileRes.status} ${fileRes.statusText}.`);
const tmp = `${OUTPUT}.download`;
await pipeline(Readable.fromWeb(fileRes.body), fs.createWriteStream(tmp));
fs.renameSync(tmp, OUTPUT);
console.log(`Downloaded to ${path.relative(process.cwd(), OUTPUT) || ASSET}.\n`);

const note = String(release.body || '').split('\n')[0].trim();
const build = spawnSync(process.execPath, [path.join(SCRIPTS, 'build-scheme-data.mjs'), '--input', OUTPUT, '--note', note,
  '--source-updated', asset.updated_at], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
console.log('\nDone. Reload the dashboard in your browser (and sign in again) to see the new data.');

function readToken() {
  const env = (process.env.GTM_DATA_TOKEN || '').trim();
  if (env) return env;
  const file = path.join(ROOT, 'config', 'github-token.local.txt');
  if (fs.existsSync(file)) {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t) return t;
  }
  if (process.env.VERCEL) fail('GTM_DATA_TOKEN is not set. In Vercel, open the project → Settings → Environment Variables, add GTM_DATA_TOKEN (a GitHub token that can read gtm-data), then redeploy.');
  fail('No GitHub token found. Paste your token on one line into config/github-token.local.txt, or set the GTM_DATA_TOKEN environment variable, then run "npm run update" again.');
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}