// Planting records page: every record of the signed-in department for one district (or all
// districts), with names and phone numbers, filters, paging and export.
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const PHONE_COL = /mobile|phone/i;
  const EMAIL_COL = /e-?mail/i;
  const NUM_COL = /^(seedlings|land parcel area|total area|latitude|longitude)$/i;
  const HIDE_COL = new Set(['district']);           // replaced by the cleaned district name
  const ALL = 'all';
  // meta fields written by the build: department, taluk/block, species, land type, year, "lat,lon", "yyyy-mm-dd"
  const FILTERS = [
    { key: 'dept', meta: 0, sel: '#rp-filter-dept', all: 'All departments' },
    { key: 'area', meta: 1, sel: '#rp-filter-area', all: 'All taluks and blocks' },
    { key: 'year', meta: 4, sel: '#rp-filter-year', all: 'All plantation years' },
    { key: 'species', meta: 2, sel: '#rp-filter-species', all: 'All species' },
    { key: 'land', meta: 3, sel: '#rp-filter-land', all: 'All land types' },
  ];

  const state = {
    summary: null,
    district: ALL,
    files: [],         // [{ district, columns, rows, meta }]
    colMap: [],        // per file: union column → file column (or -1)
    columns: [],       // union of column names, display order
    fileOf: null, rowOf: null, n: 0,
    shownCols: [],     // union column indexes with any value
    filters: { dept: '', area: '', year: '', species: '', land: '' },
    from: '', to: '',  // planting date range, "yyyy-mm-dd"
    undated: 0,
    query: '',
    searchText: null,
    idx: [],
    page: 0,
    pageSize: 100,
  };

  // ======================================================================

  document.addEventListener('DOMContentLoaded', async () => {
    if (!window.Vault || !Vault.supported()) {
      document.body.innerHTML = '<p class="rp-fatal">This browser can\'t open the dashboard. Use a recent version of Chrome, Edge, Firefox or Safari.</p>';
      return;
    }
    busy('Opening the planting records…');
    let summary;
    try {
      summary = await Vault.resume();
    } catch (e) {
      busy(false);
      document.body.innerHTML = '<p class="rp-fatal">Couldn\'t reach the dashboard server. Check your connection and reload the page.</p>';
      return;
    }
    if (!summary) {
      // Not signed in in this tab: sign in on the dashboard, then come back here.
      location.replace(`index.html?next=${encodeURIComponent(`records.html${location.search}`)}`);
      return;
    }
    state.summary = summary;
    setupPage();
    await openDistrict(state.district);
  });

  function setupPage() {
    const s = state.summary;
    $('#rp-view').hidden = false;
    $('#rp-dept').textContent = s.title;
    $('#rp-updated').textContent = `${s.updatedFrom === 'build' ? 'Data built' : 'Data updated'} ${Fmt.updated(s.updated)}`;
    $('#rp-dept-wrap').hidden = !s.allDepartments;

    const params = new URLSearchParams(location.search);
    const districts = s.dict.district.filter(Boolean).sort((a, b) => a.localeCompare(b));
    const wanted = params.get('district');
    state.district = wanted && districts.includes(wanted) ? wanted : ALL;
    for (const f of FILTERS) state.filters[f.key] = params.get(f.key) || '';
    const isDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
    state.from = isDate(params.get('from'));
    state.to = isDate(params.get('to'));
    state.query = params.get('q') || '';
    $('#rp-search').value = state.query;

    const sel = $('#rp-district');
    sel.appendChild(new Option('All districts', ALL));
    for (const d of districts) sel.appendChild(new Option(d, d));
    sel.value = state.district;

    sel.addEventListener('change', () => {
      for (const f of FILTERS) if (f.key !== 'dept') state.filters[f.key] = ''; // taluks belong to a district
      openDistrict(sel.value);
    });
    for (const f of FILTERS) {
      $(f.sel).addEventListener('change', e => { state.filters[f.key] = e.target.value; state.page = 0; refresh(); });
    }
    const onDate = () => {
      let from = $('#rp-from').value, to = $('#rp-to').value;
      if (from && to && from > to) [from, to] = [to, from];
      state.from = from; state.to = to; state.page = 0;
      refresh();
    };
    $('#rp-from').addEventListener('change', onDate);
    $('#rp-to').addEventListener('change', onDate);
    let t = null;
    $('#rp-search').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = e.target.value; state.page = 0; refresh(); }, 250);
    });
    $('#rp-clear').addEventListener('click', () => {
      for (const f of FILTERS) state.filters[f.key] = '';
      state.from = ''; state.to = '';
      state.query = ''; $('#rp-search').value = ''; state.page = 0;
      refresh();
    });
    $('#rp-page-size').addEventListener('change', e => { state.pageSize = Number(e.target.value); state.page = 0; drawTable(); });
    $('#rp-pager').addEventListener('click', e => {
      const b = e.target.closest('button[data-page]');
      if (!b) return;
      const pages = pageCount();
      state.page = { first: 0, prev: state.page - 1, next: state.page + 1, last: pages - 1 }[b.dataset.page];
      drawTable();
      $('#rp-table-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const openRow = e => {
      if (e.target.closest('a')) return; // phone and email links work as links
      const tr = e.target.closest('tr[data-k]');
      if (tr) showRecord(Number(tr.dataset.k), Number(tr.dataset.sno));
    };
    $('#rp-table tbody').addEventListener('click', openRow);
    $('#rp-table tbody').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); openRow(e); } });
    $('#rp-dialog-close').addEventListener('click', () => $('#rp-dialog').close());
    $('#rp-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    $('#rp-export').addEventListener('click', exportCsv);
    $('#rp-sign-out').addEventListener('click', () => { Vault.signOut(); location.href = 'index.html'; });
  }

  // ======================================================================
  // Loading
  // ======================================================================

  async function openDistrict(name) {
    const s = state.summary;
    const names = name === ALL ? s.dict.district.filter(Boolean) : [name];
    state.district = name;
    $('#rp-district').value = name;
    $('#rp-title').textContent = name === ALL ? 'Planting records: all districts' : `Planting records: ${name} district`;
    document.title = `${name === ALL ? 'All districts' : name} planting records | GTM Dashboard`;

    const label = name === ALL ? `Loading planting records for ${names.length} districts…` : `Loading the planting records for ${name}…`;
    busy(label);
    const files = new Array(names.length);
    let done = 0, failed = null, next = 0;
    async function worker() {
      while (next < names.length && !failed) {
        const k = next++;
        try {
          files[k] = await Vault.loadDistrict(names[k]);
          files[k].district = files[k].district || names[k];
        } catch (e) { failed = e; }
        done++;
        if (names.length > 1) $('#loading-text').textContent = `Loading planting records: ${done} of ${names.length} districts…`;
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, names.length) }, worker));
    busy(false);
    if (failed) {
      if (failed.kind === 'credentials' && failed.status === 404 && names.length === 1) {
        showEmpty(`There are no planting records for ${name}.`);
      } else {
        showEmpty(failed.kind === 'stale'
          ? 'The data was updated after you signed in. Sign out and sign in again to see the latest records.'
          : 'Couldn\'t load the records. Check your connection and reload the page.');
      }
      return;
    }
    combine(files.filter(Boolean));
    state.page = 0;
    refresh();
  }

  /** Puts the district files side by side without copying rows. */
  function combine(files) {
    const columns = [];
    const seen = new Map();
    for (const f of files) {
      let prev = -1;
      for (const c of f.columns) {
        if (HIDE_COL.has(c.toLowerCase())) continue;
        if (seen.has(c)) { prev = columns.indexOf(c); continue; }
        columns.splice(prev + 1, 0, c);
        prev = prev + 1;
        seen.set(c, true);
      }
    }
    columns.unshift('District');
    state.columns = columns;
    state.colMap = files.map(f => columns.map(c => (c === 'District' ? -2 : f.columns.indexOf(c))));
    state.files = files;
    const n = files.reduce((a, f) => a + f.rows.length, 0);
    state.fileOf = new Int32Array(n);
    state.rowOf = new Int32Array(n);
    let k = 0;
    files.forEach((f, fi) => { for (let i = 0; i < f.rows.length; i++) { state.fileOf[k] = fi; state.rowOf[k] = i; k++; } });
    state.n = n;
    state.searchText = null;
  }

  /** Columns with a value in at least one of the records currently selected. A column that
   *  nobody filled in for this selection (say, Farmer name for office reports) is hidden;
   *  if even one record has it, the column shows and the rest stay blank. */
  function computeShownCols() {
    const idx = state.idx;
    state.shownCols = state.columns.map((_, u) => u).filter(u => {
      if (u === 0) return true; // District
      for (let i = 0; i < idx.length; i++) { const v = value(idx[i], u); if (v && v !== '00:00:00') return true; }
      return false;
    });
  }

  function value(k, u) {
    const f = state.fileOf[k];
    const j = state.colMap[f][u];
    if (j === -2) return state.files[f].district;
    return j < 0 ? '' : state.files[f].rows[state.rowOf[k]][j];
  }

  function meta(k) { return state.files[state.fileOf[k]].meta[state.rowOf[k]]; }

  // ======================================================================
  // Filtering and drawing
  // ======================================================================

  function refresh() {
    applyFilters();
    computeShownCols();
    fillFilterOptions();
    drawSummary();
    drawTable();
    syncUrl();
  }

  /** 1 = inside the date range (or no range set), 0 = outside it, -1 = no planting date while a range is set. */
  function dateCheck(m) {
    if (!state.from && !state.to) return 1;
    const d = m[6] || '';
    if (!d) return -1;
    return (state.from && d < state.from) || (state.to && d > state.to) ? 0 : 1;
  }

  function applyFilters() {
    const active = FILTERS.filter(f => state.filters[f.key]);
    const q = state.query.trim().toLowerCase();
    if (q && !state.searchText) {
      state.searchText = new Array(state.n);
      for (let k = 0; k < state.n; k++) {
        const f = state.files[state.fileOf[k]];
        state.searchText[k] = `${f.district} ${f.rows[state.rowOf[k]].join(' ')}`.toLowerCase();
      }
    }
    const idx = [];
    let undated = 0;
    for (let k = 0; k < state.n; k++) {
      const m = meta(k);
      let ok = true;
      for (const f of active) if (m[f.meta] !== state.filters[f.key]) { ok = false; break; }
      if (ok && q && !state.searchText[k].includes(q)) ok = false;
      if (ok) {
        const dc = dateCheck(m);
        if (dc === -1) { undated++; ok = false; } else if (dc === 0) ok = false;
      }
      if (ok) idx.push(k);
    }
    state.idx = idx;
    state.undated = undated;
    $('#rp-clear').hidden = !active.length && !q && !state.from && !state.to;
    drawDates();
  }

  /** Each filter lists the values present when the other filters are applied. */
  function fillFilterOptions() {
    for (const f of FILTERS) {
      if (f.key === 'dept' && !state.summary.allDepartments) continue;
      const others = FILTERS.filter(o => o !== f && state.filters[o.key]);
      const counts = new Map();
      for (let k = 0; k < state.n; k++) {
        const m = meta(k);
        let ok = true;
        for (const o of others) if (m[o.meta] !== state.filters[o.key]) { ok = false; break; }
        if (ok && dateCheck(m) !== 1) ok = false;
        if (ok) counts.set(m[f.meta], (counts.get(m[f.meta]) || 0) + 1);
      }
      const sel = $(f.sel);
      const current = state.filters[f.key];
      if (current && !counts.has(current)) counts.set(current, 0);
      sel.innerHTML = '';
      sel.appendChild(new Option(f.all, ''));
      [...counts.keys()].sort((a, b) => (a || '~').localeCompare(b || '~')).forEach(v =>
        sel.appendChild(new Option(v || 'Not specified', v)));
      sel.value = current;
      sel.classList.toggle('is-active', !!current);
    }
  }

  function drawDates() {
    let min = '', max = '';
    for (const f of state.files) for (const m of f.meta) { const d = m[6]; if (d) { if (!min || d < min) min = d; if (d > max) max = d; } }
    const fromEl = $('#rp-from'), toEl = $('#rp-to');
    fromEl.value = state.from; toEl.value = state.to;
    fromEl.min = toEl.min = min; fromEl.max = toEl.max = max;
    if (state.to) fromEl.max = state.to;
    if (state.from) toEl.min = state.from;
    fromEl.classList.toggle('is-active', !!state.from); toEl.classList.toggle('is-active', !!state.to);
    const note = $('#rp-date-note');
    note.hidden = !state.undated;
    if (state.undated) note.textContent = `${Fmt.int(state.undated)} records have no planting date (only a plantation year), so they are left out while a date range is set.`;
  }

  function drawSummary() {
    const seedCol = state.columns.findIndex(c => c.toLowerCase() === 'seedlings');
    const phoneCols = state.columns.map((c, u) => (PHONE_COL.test(c) ? u : -1)).filter(u => u >= 0);
    let seedlings = 0, withPhone = 0, withGps = 0;
    for (const k of state.idx) {
      if (seedCol >= 0) seedlings += Number(value(k, seedCol)) || 0;
      if (phoneCols.some(u => value(k, u))) withPhone++;
      if (meta(k)[5]) withGps++;
    }
    const boxes = [
      { lead: true, label: 'Planting records', value: Fmt.int(state.idx.length), note: state.idx.length === state.n ? 'All records for this selection' : `Out of ${Fmt.int(state.n)} loaded` },
      { label: 'Seedlings', value: Fmt.words(seedlings), note: `${Fmt.int(seedlings)} in total` },
      { label: 'With a phone number', value: Fmt.int(withPhone), note: 'Officer or farmer mobile given' },
      { label: 'With a GPS location', value: Fmt.int(withGps), note: 'Can be shown on a map' },
    ];
    $('#rp-kpis').innerHTML = boxes.map(b =>
      `<div class="kpi${b.lead ? ' kpi-lead' : ''}"><p class="kpi-label">${b.label}</p><p class="kpi-value">${b.value}</p><p class="kpi-note">${b.note}</p></div>`).join('');
  }

  function pageCount() { return Math.max(1, Math.ceil(state.idx.length / state.pageSize)); }

  function cellHtml(column, v) {
    if (!v || v === '00:00:00') return '';
    const e = Fmt.escape(v);
    if (PHONE_COL.test(column) && /^\+?\d[\d\s-]{5,}$/.test(v)) return `<a href="tel:${e.replace(/[\s-]/g, '')}">${e}</a>`;
    if (EMAIL_COL.test(column) && v.includes('@')) return `<a href="mailto:${e}">${e}</a>`;
    return e;
  }

  function drawTable() {
    const total = state.idx.length;
    const pages = pageCount();
    state.page = Math.min(Math.max(0, state.page), pages - 1);
    const start = state.page * state.pageSize;
    const slice = state.idx.slice(start, start + state.pageSize);
    const cols = state.shownCols;

    $('#rp-table-title').textContent = total
      ? `Records ${Fmt.int(start + 1)} to ${Fmt.int(start + slice.length)} of ${Fmt.int(total)}`
      : 'Records';
    $('#rp-table thead').innerHTML = `<tr><th scope="col" class="num sno">S.No.</th>${cols.map(u =>
      `<th scope="col" class="${NUM_COL.test(state.columns[u]) ? 'num' : ''}">${Fmt.escape(Fmt.columnLabel(state.columns[u]))}</th>`).join('')}</tr>`;
    $('#rp-table tbody').innerHTML = slice.map((k, i) =>
      `<tr class="is-link" tabindex="0" data-k="${k}" data-sno="${start + i + 1}"><td class="num sno">${start + i + 1}</td>${cols.map(u =>
        `<td class="${NUM_COL.test(state.columns[u]) ? 'num' : ''}">${cellHtml(state.columns[u], value(k, u))}</td>`).join('')}</tr>`).join('');

    const empty = $('#rp-empty');
    empty.hidden = total > 0;
    $('#rp-scroll').hidden = total === 0;
    if (!total) empty.textContent = state.n ? 'No records match. Clear the search or a filter.' : 'There are no planting records for this selection.';
    $('#rp-range').textContent = `Page ${Fmt.int(state.page + 1)} of ${Fmt.int(pages)}`;
    const pager = $('#rp-pager');
    pager.hidden = total <= state.pageSize;
    pager.querySelector('[data-page="first"]').disabled = state.page === 0;
    pager.querySelector('[data-page="prev"]').disabled = state.page === 0;
    pager.querySelector('[data-page="next"]').disabled = state.page >= pages - 1;
    pager.querySelector('[data-page="last"]').disabled = state.page >= pages - 1;
    $('#rp-export').disabled = total === 0;
  }

  function showEmpty(msg) {
    state.files = []; state.n = 0; state.idx = []; state.columns = []; state.shownCols = [];
    $('#rp-kpis').innerHTML = '';
    $('#rp-table thead').innerHTML = ''; $('#rp-table tbody').innerHTML = '';
    $('#rp-scroll').hidden = true; $('#rp-pager').hidden = true;
    const empty = $('#rp-empty'); empty.textContent = msg; empty.hidden = false;
    $('#rp-export').disabled = true;
  }

  function showRecord(k, sno) {
    const items = state.columns.map((c, u) => [c, value(k, u)]).filter(([, v]) => v && v !== '00:00:00');
    const geo = meta(k)[5];
    let mapLink = '';
    if (geo) {
      const [la, lo] = geo.split(',').map(v => (Number(v) / 1e5).toFixed(5));
      mapLink = `<p class="record-map-link"><a href="https://www.google.com/maps?q=${la},${lo}" target="_blank" rel="noopener">Open this location in Google Maps</a></p>`;
    }
    $('#rp-dialog-title').textContent = `Planting record, S.No. ${Fmt.int(sno)}`;
    $('#rp-dialog-body').innerHTML = `<div class="record-card"><dl>${items.map(([c, v]) =>
      `<dt>${Fmt.escape(Fmt.columnLabel(c))}</dt><dd>${cellHtml(c, v)}</dd>`).join('')}</dl></div>${mapLink}`;
    $('#rp-dialog').showModal();
  }

  // ======================================================================
  // Export and URL
  // ======================================================================

  function exportCsv() {
    const cols = state.shownCols;
    const q = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['S.No.', ...cols.map(u => Fmt.columnLabel(state.columns[u]))].map(q).join(',')];
    state.idx.forEach((k, i) => {
      lines.push([i + 1, ...cols.map(u => { const v = value(k, u); return v === '00:00:00' ? '' : v; })].map(q).join(','));
    });
    const base = `${state.summary.login}-${state.district === ALL ? 'all-districts' : state.district}-planting-records-${new Date().toISOString().slice(0, 10)}`;
    const name = `${base}.csv`.toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function syncUrl() {
    const p = new URLSearchParams();
    p.set('district', state.district);
    for (const f of FILTERS) if (state.filters[f.key]) p.set(f.key, state.filters[f.key]);
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.query.trim()) p.set('q', state.query.trim());
    history.replaceState(null, '', `records.html?${p}`);
  }

  // ======================================================================

  let busyTimer = null, busyTick = null;
  function busy(text) {
    const el = $('#loading');
    clearTimeout(busyTimer); clearInterval(busyTick);
    if (!text) { el.hidden = true; return; }
    $('#loading-text').textContent = text;
    const started = Date.now();
    const elapsed = $('#loading-elapsed');
    elapsed.textContent = '';
    busyTick = setInterval(() => {
      const sec = Math.round((Date.now() - started) / 1000);
      elapsed.textContent = sec >= 3 ? `Waiting ${sec} seconds…` : '';
    }, 1000);
    el.hidden = false;
  }
})();
