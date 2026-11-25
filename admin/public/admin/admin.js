// Head office dashboard: opens the all-departments and all-schemes files with the head office
// login, then shows overall totals and a table for each. Nothing is saved in the browser; signing
// out (or closing the tab) forgets the data.
//
// The file format matches the department and scheme sites (see departments/public/js/vault.js):
//   "GTM1" | PBKDF2 iterations (uint32 BE) | salt (16) | IV (12) | AES-256-GCM ciphertext + tag
// The plaintext is gzip-compressed JSON.
(function () {
  'use strict';
  const MAGIC = new TextEncoder().encode('GTM1');
  const ADMIN_ID = 'GTM-ADMIN';
  const NOT_SPECIFIED = 'Not specified';
  // The head office files sit in this page's own data folder, one per scope (see scripts/build-*-data.mjs).
  const SOURCES = [
    { key: 'dept', scope: 'dept', flag: 'allDepartments' },
    { key: 'scheme', scope: 'scheme', flag: 'allSchemes' },
  ];
  const $ = sel => document.querySelector(sel);
  const fmt = n => Math.round(n).toLocaleString('en-IN');

  class VaultError extends Error {
    constructor(kind) { super(kind); this.kind = kind; }
  }

  async function fileName(id) {
    const bytes = new TextEncoder().encode(`gtm:${String(id).trim().toUpperCase()}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('').slice(0, 32) + '.bin';
  }

  async function fetchFile(dir, id) {
    let res;
    try {
      res = await fetch(`${dir}${await fileName(id)}`, { cache: 'no-cache' });
    } catch (e) {
      throw new VaultError('network');
    }
    if (res.status === 404 || res.status === 403) throw new VaultError('credentials');
    if (!res.ok) throw new VaultError('network');
    const buf = new Uint8Array(await res.arrayBuffer());
    for (let i = 0; i < 4; i++) if (buf[i] !== MAGIC[i]) throw new VaultError('credentials');
    return {
      iterations: new DataView(buf.buffer, buf.byteOffset + 4, 4).getUint32(0),
      salt: buf.slice(8, 24),
      iv: buf.slice(24, 36),
      ciphertext: buf.slice(36),
    };
  }

  async function openWithPassword(src, id, password) {
    const file = await fetchFile('data/', `${id}|${src.scope}`);
    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: file.salt, iterations: file.iterations },
      material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: file.iv, additionalData: MAGIC }, key, file.ciphertext);
    } catch (e) {
      throw new VaultError('credentials');
    }
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  /** Totals per department or scheme, most seedlings first. */
  function totals(data, dim) {
    const cols = data.cols;
    const names = data.dict[dim] || [];
    const byCode = new Map();
    for (let i = 0; i < cols.seedlings.length; i++) {
      const code = cols[dim][i];
      let row = byCode.get(code);
      if (!row) {
        row = { name: names[code] || NOT_SPECIFIED, records: 0, seedlings: 0 };
        byCode.set(code, row);
      }
      row.seedlings += cols.seedlings[i];
      row.records += cols.records[i];
    }
    return [...byCode.values()].sort((a, b) => b.seedlings - a.seedlings);
  }

  function fillTable(sel, rows, totalSeedlings) {
    const body = $(sel);
    body.replaceChildren();
    for (const r of rows) {
      const tr = document.createElement('tr');
      const share = totalSeedlings ? `${((r.seedlings / totalSeedlings) * 100).toFixed(1)}%` : '–';
      for (const [text, num] of [[r.name, false], [fmt(r.records), true], [fmt(r.seedlings), true], [share, true]]) {
        const td = document.createElement('td');
        td.textContent = text; // names come from the export: never as HTML
        if (num) td.className = 'num';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  function showDashboard(results) {
    const dept = results.dept, scheme = results.scheme;
    const deptRows = totals(dept, 'dept');
    const schemeRows = totals(scheme, 'scheme');
    const deptSeedlings = deptRows.reduce((a, r) => a + r.seedlings, 0);
    const schemeSeedlings = schemeRows.reduce((a, r) => a + r.seedlings, 0);
    $('#kpi-dept-seedlings').textContent = fmt(deptSeedlings);
    $('#kpi-scheme-seedlings').textContent = fmt(schemeSeedlings);
    $('#kpi-dept-records').textContent = fmt(deptRows.reduce((a, r) => a + r.records, 0));
    $('#kpi-scheme-records').textContent = fmt(schemeRows.reduce((a, r) => a + r.records, 0));
    fillTable('#dept-rows', deptRows, deptSeedlings);
    fillTable('#scheme-rows', schemeRows, schemeSeedlings);
    const stamp = [dept, scheme].map(d => d.updated).filter(Boolean).sort().pop();
    $('#updated').textContent = stamp ? `Data as of ${new Date(stamp).toLocaleString('en-IN')}` : '';
    $('#login-view').hidden = true;
    $('#dash').hidden = false;
  }

  function showError(msg) {
    const err = $('#login-error');
    err.textContent = msg;
    err.hidden = false;
  }

  function busy(text) {
    $('#busy-text').textContent = text;
    $('#busy').hidden = !text;
  }

  async function signIn(id, password) {
    const results = {};
    for (const src of SOURCES) {
      const data = await openWithPassword(src, id, password);
      // Only the head office file is accepted here; a scheme or department login is refused.
      if (!data[src.flag] || data.login !== ADMIN_ID) throw new VaultError('credentials');
      results[src.key] = data;
    }
    return results;
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#login-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const id = $('#login-id').value.trim();
      const pw = $('#login-password').value;
      $('#login-error').hidden = true;
      if (!id || !pw) { showError('Enter your login ID and password.'); return; }
      const btn = $('#login-submit');
      btn.disabled = true;
      busy('Checking your login and opening the head office data…');
      try {
        const results = await signIn(id, pw);
        $('#login-password').value = '';
        busy(false);
        showDashboard(results);
      } catch (e) {
        busy(false);
        showError(e.kind === 'network'
          ? 'Couldn\'t reach the dashboard server. Check your connection and try again.'
          : 'That login ID and password don\'t match. Check both and try again.');
        $('#login-password').select();
      } finally {
        btn.disabled = false;
      }
    });
    $('#sign-out').addEventListener('click', () => location.reload());
    $('#login-id').focus();
  });
})();
