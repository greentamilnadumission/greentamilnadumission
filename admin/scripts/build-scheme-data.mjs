#!/usr/bin/env node
// Builds the encrypted per-scheme data files for the dashboard.
//
//   node scripts/build-scheme-data.mjs --input merged.csv.gz [--out public/data] [--credentials config/scheme-credentials.local.json]
//
// Passwords come from the SCHEME_CREDENTIALS environment variable (JSON: {"GTM-SCHEME-1": "password", ...})
// or from the --credentials file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { parseCsv } from './lib/csv.mjs';
import * as C from './lib/clean.mjs';
import { loadAdminPassword, ADMIN_OUT } from './lib/admin-credentials.mjs';

const ROOT = process.cwd(); // the project folder (departments/ or schemes/) the command is run from
const args = parseArgs(process.argv.slice(2));
const INPUT = args.input || 'merged.csv.gz';
const OUT = path.resolve(args.out || path.join(ROOT, 'public', 'data'));
const REPORT_DIR = path.resolve(args.report || path.join(ROOT, 'build-report'));
const PBKDF2_ITERATIONS = 310000;
const MAGIC = Buffer.from('GTM1');
const EARLIEST_MONTH = 202104; // the first financial year in the data starts April 2021; earlier dates are typos
const TODAY = new Date().getFullYear() * 10000 + (new Date().getMonth() + 1) * 100 + new Date().getDate(); // future dates are typos too

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'schemes.json'), 'utf8'));
const credentials = loadCredentials();
// The head office password is kept apart from the scheme logins (see lib/admin-credentials.mjs).
const ADMIN_SCOPE = 'scheme';
const adminPassword = loadAdminPassword(config.admin.id);
if (adminPassword) credentials[`${config.admin.id}|${ADMIN_SCOPE}`] = adminPassword;
else console.warn(`No ADMIN_CREDENTIALS: the head office (${config.admin.id}) scheme file is not built.`);

const schemeById = new Map(config.schemes.map(s => [s.id, s]));

const missingCreds = config.schemes.map(s => s.id).filter(id => !credentials[id]);
if (missingCreds.length) fail(`No password for: ${missingCreds.join(', ')}.\nRun "npm run scheme-credentials" or set SCHEME_CREDENTIALS.`);

const DIMS = ['scheme', 'district', 'area', 'village', 'species', 'land', 'year', 'org', 'date'];
const dicts = Object.fromEntries(DIMS.filter(d => d !== 'date').map(d => [d, new Map()]));
function code(dim, value) {
  const m = dicts[dim];
  const v = value || '';
  let c = m.get(v);
  if (c === undefined) { c = m.size; m.set(v, c); }
  return c;
}
const pointRows = [];
const details = new Map();
const PREFERRED_COLUMNS = ['Village', 'Taluk', 'Block', 'Species', 'Seedlings', 'Owner', 'Farmer Name', 'Mobile',
  'Incharge Name', 'Contact Name', 'Stakeholder Name', 'Officer Name', 'Officer Mobile', 'User Name', 'User Email',
  'Address', 'Date', 'Time', 'Planted Date', 'Reported At', 'Year', 'Land Type', 'Land parcel area', 'Total Area',
  'Survey No', 'Bag Type', 'Scheme', 'Species Tamil', 'Gov Department Type', 'Department Type', 'Department',
  'Division', 'Range', 'District', 'Latitude', 'Longitude', 'Report ID', 'Report Type', 'ID', 'Verification Status',
  'Status', 'User Type'];
let headerNames = [];
const loginKeys = new Map();
const groupRows = new Map();

const stats = {
  read: 0, kept: 0, seedlings: 0,
  excluded: { noScheme: 0, zeroSeedlings: 0, noDistrict: 0 },
  yearFixed: 0, badDates: 0, unknownScheme: new Map(), unknownDistrict: new Map(),
};

const t0 = Date.now();
const input = fs.createReadStream(INPUT);
const stream = INPUT.endsWith('.gz') ? input.pipe(zlib.createGunzip()) : input;
stream.setEncoding('utf8');

let col = null;
for await (const row of parseCsv(stream)) {
  if (!col) { col = indexHeader(row); headerNames = row.map(h => C.clean(h)); continue; }
  stats.read++;
  processRow(row);
}
if (!col) fail('Input file is empty.');

const MIN_ROWS = Number(args['min-rows'] || 1000);
if (stats.kept < MIN_ROWS) fail(`Only ${stats.kept} rows survived the filters (minimum ${MIN_ROWS}). The export may be broken, so nothing was written.`);

const FINAL_OUT = OUT;
const TMP_OUT = `${FINAL_OUT}.tmp`;
fs.rmSync(TMP_OUT, { recursive: true, force: true });
fs.mkdirSync(TMP_OUT, { recursive: true });

const allRows = [...pointRows, ...groupRows.values()];
const dictArrays = Object.fromEntries(Object.entries(dicts).map(([k, m]) => [k, [...m.keys()]]));
const schemeNames = dictArrays.scheme.map(id => schemeById.get(id)?.name || 'Unknown Scheme');
const built = new Date().toISOString();
const sourceUpdated = parseTime(args['source-updated'] || process.env.SOURCE_UPDATED);
const updated = sourceUpdated || built;
const updatedFrom = sourceUpdated ? 'release' : 'build';
const sourceNote = args.note || '';

const summary = [];
const targets = config.schemes.map(s => ({ id: s.id, name: s.name, filter: s.id }));
if (adminPassword) targets.unshift({ id: config.admin.id, name: config.admin.name, filter: null, admin: true });

for (const t of targets) {
  const schemeCode = t.filter ? dicts.scheme.get(t.filter) : null;
  const rows = t.filter ? (schemeCode === undefined ? [] : allRows.filter(r => r[0] === schemeCode)) : allRows;
  const payload = buildPayload(t, rows);
  const json = Buffer.from(JSON.stringify(payload));
  const gz = zlib.gzipSync(json, { level: 9 });
  // The head office file goes to admin/public/admin/data (keyed "GTM-ADMIN|scheme"), not to the scheme site.
  const keyId = t.admin ? `${t.id}|${ADMIN_SCOPE}` : t.id;
  const outDir = t.admin ? ADMIN_OUT : TMP_OUT;
  const enc = encrypt(gz, keyId);
  const file = fileNameFor(keyId);
  if (t.admin) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, file), enc);
  const seed = rows.reduce((a, r) => a + r[9], 0);
  const recs = rows.reduce((a, r) => a + r[10], 0);

  let detailBytes = 0, detailFiles = 0;
  const byDistrict = new Map();
  for (const [schemeId, districts] of details) {
    if (t.filter && schemeId !== t.filter) continue;
    for (const [district, list] of districts) {
      if (!byDistrict.has(district)) byDistrict.set(district, []);
      byDistrict.get(district).push(...list);
    }
  }
  // The head office page shows totals only, so it gets no record files.
  for (const [district, list] of (t.admin ? new Map() : byDistrict)) {
    const dz = zlib.gzipSync(Buffer.from(JSON.stringify(detailPayload(district, list))), { level: 9 });
    const denc = encrypt(dz, t.id);
    fs.writeFileSync(path.join(TMP_OUT, fileNameFor(`${t.id}|${district}`)), denc);
    detailBytes += denc.length; detailFiles++;
  }
  summary.push({ id: t.id, name: t.name, records: recs, seedlings: seed, file, kb: Math.round(enc.length / 1024),
    recordFiles: detailFiles, recordKb: Math.round(detailBytes / 1024) });
}

fs.writeFileSync(path.join(TMP_OUT, 'version.json'), JSON.stringify({ updated, updatedFrom }) + '\n');
fs.rmSync(FINAL_OUT, { recursive: true, force: true });
fs.renameSync(TMP_OUT, FINAL_OUT);

writeReport();
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nRead ${fmt(stats.read)} rows, kept ${fmt(stats.kept)} (${fmt(stats.seedlings)} seedlings) in ${secs}s.`);
console.log('Excluded:', stats.excluded);
if (stats.unknownScheme.size) console.warn('WARNING unknown Scheme values:', Object.fromEntries(stats.unknownScheme));
if (stats.unknownDistrict.size) console.warn('WARNING unknown districts (rows dropped):', Object.fromEntries(stats.unknownDistrict));
console.table(summary.map(s => ({ id: s.id, records: s.records, seedlings: s.seedlings, kb: s.kb, recordFiles: s.recordFiles, recordKb: s.recordKb })));

function processRow(r) {
  const schemeName = C.clean(r[col.scheme]);
  if (!schemeName) { stats.excluded.noScheme++; return; }

  const scheme = config.schemes.find(s => s.name === schemeName);
  if (!scheme) { bump(stats.unknownScheme, schemeName); stats.excluded.noScheme++; return; }
  const schemeId = scheme.id;

  const seedlings = C.num(r[col.seedlings]);
  if (!(seedlings > 0)) { stats.excluded.zeroSeedlings++; return; }

  const rawDistrict = r[col.district];
  const district = C.district(rawDistrict);
  if (!district) {
    if (C.clean(rawDistrict)) bump(stats.unknownDistrict, C.clean(rawDistrict));
    stats.excluded.noDistrict++;
    return;
  }

  let date = C.parseDate(r[col.date]);
  const ymd = date ? date.y * 10000 + date.m * 100 + date.d : 0;
  if (date && (date.y * 100 + date.m < EARLIEST_MONTH || ymd > TODAY)) { stats.badDates++; date = null; }
  let year = C.clean(r[col.year]);
  const ym = /^(\d{4})-(\d{4})$/.exec(year);
  if (!ym || +ym[1] > C.currentFyStart()) {
    if (date) { year = C.financialYear(date); stats.yearFixed++; }
    else if (!ym) year = '';
  }

  const area = C.titleCase(r[col.taluk]) || C.titleCase(col.block >= 0 ? r[col.block] : '');
  const village = C.titleCase(r[col.village]);
  const lat = C.num(r[col.lat]);
  const lon = C.num(r[col.lon]);
  const geo = lat >= 8 && lat <= 13.6 && lon >= 76 && lon <= 80.5;

  const codes = [
    code('scheme', schemeId),
    code('district', district),
    code('area', area),
    code('village', village),
    code('species', C.species(r[col.species])),
    code('land', C.landType(r[col.land])),
    code('year', year),
    code('org', C.clean(r[col.stakeholder])),
    date ? ymd : 0,
  ];
  stats.kept++;
  stats.seedlings += seedlings;

  if (!details.has(schemeId)) details.set(schemeId, new Map());
  const dd = details.get(schemeId);
  if (!dd.has(district)) dd.set(district, []);
  dd.get(district).push({
    v: r.map(cell),
    m: [schemeName, area, C.species(r[col.species]), C.landType(r[col.land]), year,
      geo ? `${Math.round(lat * 1e5)},${Math.round(lon * 1e5)}` : '',
      date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : ''],
  });

  if (geo) {
    pointRows.push([...codes, seedlings, 1, Math.round(lat * 1e5), Math.round(lon * 1e5)]);
  } else {
    const k = codes.join(',');
    const g = groupRows.get(k);
    if (g) { g[9] += seedlings; g[10] += 1; }
    else groupRows.set(k, [...codes, seedlings, 1, 0, 0]);
  }
}

function buildPayload(target, rows) {
  const used = DIMS.slice(0, 8).map(() => new Map());
  const remapped = rows.map(r => {
    const out = r.slice();
    for (let i = 0; i < 8; i++) {
      const m = used[i];
      let c = m.get(r[i]);
      if (c === undefined) { c = m.size; m.set(r[i], c); }
      out[i] = c;
    }
    return out;
  });
  const dict = {};
  DIMS.slice(0, 8).forEach((dim, i) => {
    const source = dim === 'scheme' ? schemeNames : dictArrays[dim];
    dict[dim] = [...used[i].keys()].map(c => source[c]);
  });
  const cols = {};
  const names = ['scheme', 'district', 'area', 'village', 'species', 'land', 'year', 'org', 'date', 'seedlings', 'records', 'lat', 'lon'];
  names.forEach((n, i) => { cols[n] = remapped.map(r => r[i]); });
  return {
    v: 1,
    login: target.id,
    title: target.name,
    allSchemes: !target.filter,
    updated,
    updatedFrom,
    built,
    note: sourceNote,
    dict,
    cols,
  };
}

function cell(v) {
  const t = C.clean(v);
  return /^-?\d+\.0+$/.test(t) ? t.replace(/\.0+$/, '') : t;
}

function detailPayload(district, list) {
  const used = headerNames.map((_, i) => list.some(x => x.v[i] !== ''));
  const order = [];
  for (const name of PREFERRED_COLUMNS) {
    const i = headerNames.findIndex(h => C.key(h) === C.key(name));
    if (i >= 0 && used[i] && !order.includes(i)) order.push(i);
  }
  headerNames.forEach((_, i) => { if (used[i] && !order.includes(i)) order.push(i); });
  return {
    v: 1,
    district,
    columns: order.map(i => headerNames[i]),
    rows: list.map(x => order.map(i => x.v[i])),
    meta: list.map(x => x.m),
  };
}

function keyFor(id) {
  let k = loginKeys.get(id);
  if (!k) {
    const salt = crypto.createHash('sha256').update(`gtm-salt-v1:${id}`).digest().subarray(0, 16);
    k = { salt, key: crypto.pbkdf2Sync(credentials[id].normalize('NFKC'), salt, PBKDF2_ITERATIONS, 32, 'sha256') };
    loginKeys.set(id, k);
  }
  return k;
}

function encrypt(plain, id) {
  const { salt, key } = keyFor(id);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const iter = Buffer.alloc(4); iter.writeUInt32BE(PBKDF2_ITERATIONS);
  return Buffer.concat([MAGIC, iter, salt, iv, ct]);
}

function fileNameFor(id) {
  return crypto.createHash('sha256').update(`gtm:${id.trim().toUpperCase()}`).digest('hex').slice(0, 32) + '.bin';
}

function indexHeader(header) {
  const idx = new Map(header.map((h, i) => [C.key(h), i]));
  const need = {
    scheme: 'Scheme',
    stakeholder: 'Stakeholder Name', contact: 'Contact Name', officer: 'Officer Name',
    district: 'District', taluk: 'Taluk', village: 'Village', species: 'Species', land: 'Land Type',
    seedlings: 'Seedlings', lat: 'Latitude', lon: 'Longitude', year: 'Year', date: 'Date',
  };
  const out = {};
  const missing = [];
  for (const [k, name] of Object.entries(need)) {
    const i = idx.get(C.key(name));
    if (i === undefined) missing.push(name); else out[k] = i;
  }
  if (missing.length) fail(`Input is missing columns: ${missing.join(', ')}`);
  out.block = idx.get('block') ?? -1;
  return out;
}

function writeReport() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'summary.json'), JSON.stringify({
    updated, updatedFrom, built, input: path.basename(INPUT), read: stats.read, kept: stats.kept, seedlings: stats.seedlings,
    excluded: stats.excluded, yearFixed: stats.yearFixed, datesIgnored: stats.badDates,
    unknownScheme: Object.fromEntries(stats.unknownScheme),
    unknownDistrict: Object.fromEntries(stats.unknownDistrict),
    schemes: summary,
  }, null, 2));
}

function loadCredentials() {
  let raw = process.env.SCHEME_CREDENTIALS;
  if (!raw) {
    const file = path.resolve(args.credentials || path.join(ROOT, 'config', 'scheme-credentials.local.json'));
    if (!fs.existsSync(file)) {
      if (process.env.VERCEL) fail('SCHEME_CREDENTIALS is not set. In Vercel, open the project → Settings → Environment Variables, add SCHEME_CREDENTIALS (the contents of config/scheme-credentials.local.json), then redeploy.');
      fail(`No credentials. Set SCHEME_CREDENTIALS or create ${path.relative(process.cwd(), file)} with "npm run scheme-credentials".`);
    }
    raw = fs.readFileSync(file, 'utf8');
  }
  const parsed = JSON.parse(raw);
  const out = {};
  for (const [id, v] of Object.entries(parsed)) out[id.trim().toUpperCase()] = typeof v === 'string' ? v : v.password;
  return out;
}

function parseTime(v) {
  if (!v || v === true) return null;
  const t = new Date(String(v).trim());
  if (Number.isNaN(t.getTime())) fail(`--source-updated "${v}" is not a valid date and time.`);
  return t.toISOString();
}

function bump(map, k) { map.set(k, (map.get(k) || 0) + 1); }
function fmt(n) { return n.toLocaleString('en-IN'); }
function fail(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }
function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1]?.startsWith('--') ? true : a[++i];
  return o;
}