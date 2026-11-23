#!/usr/bin/env node
// Vercel "Ignored Build Step" (vercel.json → ignoreCommand).
// Exit 0 = skip this build, exit 1 = build.
//
// The hourly "Refresh live data" commit only exists to wake Vercel up. For those commits we skip
// the build when the live site already shows the latest gtm-data export. Every other commit, and
// any doubt at all (no token, network error, unreadable answer), builds as normal.

const REPO = process.env.GTM_DATA_REPO || 'greentamilnadumission/gtm-data';
const API = process.env.GTM_API_BASE || 'https://api.github.com';
const build = why => { console.log(`Building: ${why}`); process.exit(1); };
const skip = why => { console.log(`Skipping the build: ${why}`); process.exit(0); };

const message = (process.env.VERCEL_GIT_COMMIT_MESSAGE || '').trim();
if (message !== 'Refresh live data') build(`commit "${message || 'unknown'}" is not an hourly refresh.`);

const token = (process.env.GTM_DATA_TOKEN || '').trim();
const site = process.env.LIVE_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
if (!token) build('GTM_DATA_TOKEN is not set, so the release time cannot be checked.');
if (!site) build('the live site address is not known.');

try {
  const res = await fetch(`${API}/repos/${REPO}/releases/tags/latest-export`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gtm-dashboard' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) build(`GitHub answered ${res.status} for the release.`);
  const asset = ((await res.json()).assets || []).find(a => a.name === 'merged.csv.gz');
  if (!asset) build('the release has no merged.csv.gz.');
  const latest = new Date(asset.updated_at).toISOString();

  const live = await fetch(`${site}${process.env.LIVE_VERSION_PATH || '/departments/data/version.json'}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!live.ok) build(`the live site has no version.json yet (${live.status}).`);
  const liveUpdated = new Date((await live.json()).updated).toISOString();

  if (liveUpdated === latest) skip(`the live site already has the export uploaded at ${latest}.`);
  build(`new export uploaded at ${latest} (live site has ${liveUpdated}).`);
} catch (e) {
  build(`could not compare (${e.message}).`);
}
