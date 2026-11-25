#!/usr/bin/env node
// One-site build for Vercel (run from the repository root):
//   dist/                  landing page (admin/public)
//   dist/departments/      department dashboard + its encrypted data
//   dist/schemes/          scheme dashboard + its encrypted data
// The department build must succeed. The scheme build is allowed to fail (the site still deploys,
// and the scheme login just has no data until it is fixed) so one problem can't take both down.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS, '..', '..');
const DIST = path.join(REPO, 'dist');

function run(project, script) {
  console.log(`\n=== ${project}: ${script} ===`);
  return spawnSync(process.execPath, [path.join(SCRIPTS, script)], { cwd: path.join(REPO, project), stdio: 'inherit' }).status === 0;
}

if (!run('departments', 'update-local.mjs')) process.exit(1);
const schemesOk = run('schemes', 'update-scheme-local.mjs');
if (!schemesOk) console.warn('\n⚠ The scheme build failed. The site will deploy, but the scheme login has no data. See the error above.');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.cpSync(path.join(REPO, 'admin', 'public'), DIST, { recursive: true });
fs.cpSync(path.join(REPO, 'departments', 'public'), path.join(DIST, 'departments'), { recursive: true });
fs.cpSync(path.join(REPO, 'schemes', 'public'), path.join(DIST, 'schemes'), { recursive: true });
// Head office copies of both dashboards: the same code, reading only the head office data that the
// builds wrote to admin/public/admin/<departments|schemes>/data. The normal login data is left out.
copyDashboard('departments', 'admin/departments');
copyDashboard('schemes', 'admin/schemes');
console.log('\nSite assembled in dist/');

function copyDashboard(project, target) {
  const src = path.join(REPO, project, 'public');
  const dest = path.join(DIST, ...target.split('/'));
  fs.cpSync(src, dest, { recursive: true, filter: f => !(path.dirname(f) === src && path.basename(f) === 'data') });
  const index = path.join(dest, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  const from = `<base href="/${project}/">`;
  if (!html.includes(from)) fail(`${project}/public/index.html has no ${from}, so the head office copy would read the wrong data.`);
  fs.writeFileSync(index, html.replace(from, `<base href="/${target}/">`));
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
