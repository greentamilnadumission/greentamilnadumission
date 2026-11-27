// Green Tamil Nadu Mission — department dashboard.
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const NOT_SPECIFIED = 'Not specified';
  // Column order in the data file. Dimension columns are dictionary codes.
  const DIM = { dept: 'dept', district: 'district', area: 'area', village: 'village', species: 'species', land: 'land', year: 'year', org: 'org' };
  const FILTER_DIMS = ['dept', 'district', 'area', 'species', 'land', 'year'];

  const state = {
    data: null,
    n: 0,
    c: {},          // typed column arrays
    dict: {},
    label: {},      // dictionary values with blanks replaced by "Not specified"
    filters: { dept: -1, district: -1, area: -1, species: -1, land: -1, year: -1 },
    ledgerSort: 'value',
    ledgerQuery: '',
    tableSort: { key: 'seedlings', dir: -1 },
    tableQuery: '',
    agg: null,
    charts: {},
    map: null,
    dots: null,
    mapDirty: true,
    mapPoints: null,
    colors: {},
    recordCache: new Map(),  // district name → full records (for map pop-ups)
    range: { from: 0, to: 0 }, // planting date range as yyyymmdd (0 = open)
  };
  const VIEW_KEY = 'gtm-dashboard-view';
  const LEDGER_KEY = 'gtm-ledger-open';
  // On the head office page, the side menu opens one department with ?dept=<name>, or everything with ?all=1.
  const HEAD_OFFICE = location.pathname.startsWith('/admin/');
  const HEAD_PARAMS = new URLSearchParams(location.search);

  // ======================================================================
  // Start-up and sign-in
  // ======================================================================

  document.addEventListener('DOMContentLoaded', async () => {
    drawLoginArt();
    wireLogin();
    if (!window.Vault || !Vault.supported()) {
      showLogin('This browser can\'t open the dashboard. Use a recent version of Chrome, Edge, Firefox or Safari.');
      $('#login-submit').disabled = true;
      return;
    }
    busy('Opening your department\'s data…');
    try {
      const data = await Vault.resume();
      busy(false);
      if (data && goNext()) return;
      if (data) start(data); else showLogin();
    } catch (e) {
      busy(false);
      showLogin('Couldn\'t reach the dashboard server. Check your connection and reload the page.');
    }
  });

  function wireLogin() {
    const form = $('#login-form');
    const toggle = $('#toggle-password');
    toggle.addEventListener('click', () => {
      const input = $('#login-password');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(show));
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const id = $('#login-id').value.trim();
      const pw = $('#login-password').value;
      const err = $('#login-error');
      err.hidden = true;
      if (!id || !pw) { showError('Enter your login ID and password.'); return; }
      const btn = $('#login-submit');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      busy('Checking your login and opening your data…');
      try {
        const data = await Vault.signIn(id, pw);
        $('#login-password').value = '';
        if (goNext()) return;
        busy(false);
        start(data);
      } catch (e) {
        busy(false);
        console.error(e);
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
        showError(e.kind === 'network'
          ? 'Couldn\'t reach the dashboard server. Check your connection and try again.'
          : e.status === 404 && local
            ? 'No data file was found for this login ID. On your own computer, run "npm run build:data" first so the public/data folder exists, or check the login ID.'
            : e instanceof Vault.VaultError
              ? 'That login ID and password don\'t match. Check both and try again.'
              : `The dashboard couldn't open its data: ${e && e.message ? e.message : e}`);
        $('#login-password').select();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });
  }

  /** After sign-in, return to the records page if that's where the person was going. */
  function goNext() {
    const next = new URLSearchParams(location.search).get('next');
    if (next && /^records\.html(\?|$)/.test(next)) { location.replace(next); return true; }
    if (next) history.replaceState(null, '', location.pathname);
    return false;
  }

  function showError(msg) { const err = $('#login-error'); err.textContent = msg; err.hidden = false; }

  function showLogin(msg) {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    if (msg) showError(msg);
    $('#login-id').focus();
  }

  /** Full-screen loading message. busy(text) shows it, busy(false) hides it.
   *  With { delay } it only appears if the work takes longer than that, to avoid a flash. */
  let busyTimer = null, busyTick = null;
  function busy(text, opts = {}) {
    const el = $('#loading');
    clearTimeout(busyTimer); clearInterval(busyTick);
    if (!text) { el.hidden = true; return; }
    const show = () => {
      $('#loading-text').textContent = text;
      const started = Date.now();
      const elapsed = $('#loading-elapsed');
      elapsed.textContent = '';
      busyTick = setInterval(() => {
        const sec = Math.round((Date.now() - started) / 1000);
        elapsed.textContent = sec >= 3 ? `Waiting ${sec} seconds…` : '';
      }, 1000);
      el.hidden = false;
    };
    if (opts.delay) busyTimer = setTimeout(show, opts.delay); else show();
  }

  function drawLoginArt() {
    const svg = $('#login-art-svg');
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    // A nursery bed: rows of seedlings, a few already marked in turmeric.
    let seed = 7;
    const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let row = 0; row < 13; row++) {
      for (let col = 0; col < 9; col++) {
        const x = 24 + col * 44 + (row % 2 ? 22 : 0);
        const y = 30 + row * 40;
        const s = 0.7 + rand() * 0.6;
        const g = document.createElementNS(NS, 'path');
        g.setAttribute('d', 'M0 10V-2M0 1c-5 0-8-3-8-9 6 0 8 3 8 9Zm0-2c0-5 3-8 8-8 0 6-3 8-8 8Z');
        g.setAttribute('transform', `translate(${x} ${y}) scale(${s.toFixed(2)})`);
        g.setAttribute('class', rand() > 0.93 ? 'seedling lit' : 'seedling');
        svg.appendChild(g);
      }
    }
  }

  // ======================================================================
  // Data
  // ======================================================================

  function start(data) {
    state.data = data;
    const cols = data.cols;
    state.n = cols.seedlings.length;
    const I32 = a => Int32Array.from(a);
    state.c = {
      dept: I32(cols.dept), district: I32(cols.district), area: I32(cols.area), village: I32(cols.village),
      species: I32(cols.species), land: I32(cols.land), year: I32(cols.year), org: I32(cols.org),
      date: I32(cols.date || cols.month.map(m => m * 100)), seedlings: Float64Array.from(cols.seedlings), records: I32(cols.records),
      lat: I32(cols.lat), lon: I32(cols.lon),
    };
    state.dict = data.dict;
    let dMin = 0, dMax = 0;
    for (const v of state.c.date) if (v) { if (!dMin || v < dMin) dMin = v; if (v > dMax) dMax = v; }
    state.dateMin = dMin; state.dateMax = dMax;
    for (const k of Object.keys(data.dict)) state.label[k] = data.dict[k].map(v => v || NOT_SPECIFIED);

    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    $('#dept-title').textContent = data.title;
    $('#updated-at').textContent = `${data.updatedFrom === 'build' ? 'Data built' : 'Data updated'} ${Fmt.updated(data.updated)}`;
    if (data.note) $('#updated-at').title = `Source export: ${data.note}`;
    document.title = `${data.title} | GTM Dashboard`;
    $('#dept-filter-wrap').hidden = !data.allDepartments;

    readColors();
    setupCharts();
    wireApp();
    if (HEAD_OFFICE) pickFromMenu(); else restoreView();
    setLedgerOpen(readLedgerOpen());
    trackFilterHeight();
    setupMapWhenVisible();
    render();
  }

  // ---------- remember the view (filters) for this tab, so "Back to dashboard" returns to it ----------

  function saveView() {
    const { filters, dict } = state;
    const view = {};
    for (const d of FILTER_DIMS) if (filters[d] >= 0) view[d] = dict[d][filters[d]];
    if (state.range.from) view.from = state.range.from;
    if (state.range.to) view.to = state.range.to;
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* not essential */ }
  }

  /** Head office only: applies the department chosen in the side menu (?dept=<name>). ?all=1 shows every department. */
  function pickFromMenu() {
    const name = HEAD_PARAMS.get('dept');
    if (!name) return;
    const code = state.dict.dept.indexOf(name);
    if (code >= 0) state.filters.dept = code;
  }

  function restoreView() {
    let view = null;
    try { view = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null'); } catch (e) { view = null; }
    if (!view) return;
    for (const d of FILTER_DIMS) {
      if (!(d in view)) continue;
      const code = state.dict[d].indexOf(view[d]);
      if (code >= 0) state.filters[d] = code;
    }
    state.range = { from: Number(view.from) || 0, to: Number(view.to) || 0 };
  }

  // ---------- district list: open / closed ----------

  function readLedgerOpen() {
    try { return localStorage.getItem(LEDGER_KEY) !== 'false'; } catch (e) { return true; }
  }

  function setLedgerOpen(open) {
    $('#layout').classList.toggle('ledger-closed', !open);
    $('#ledger').hidden = !open;
    $('#toggle-ledger').setAttribute('aria-expanded', String(open));
    $('#toggle-ledger-text').textContent = open ? 'Hide districts' : 'Show districts';
    try { localStorage.setItem(LEDGER_KEY, String(open)); } catch (e) { /* not essential */ }
    if (state.map) setTimeout(() => state.map.invalidateSize(), 50);
    for (const ch of Object.values(state.charts)) ch.resize();
  }

  /** One pass over all rows. Rows that fail exactly one filter still count toward that filter's
   *  own breakdown, so a chart keeps showing the alternatives to the value you picked. */
  function aggregate() {
    const { c, n, dict, filters } = state;
    const active = FILTER_DIMS.filter(d => filters[d] >= 0).map(d => ({ d, col: c[d], v: filters[d] }));
    const facet = {};
    for (const d of FILTER_DIMS) facet[d] = new Float64Array(dict[d].length);

    const months = new Map();
    const areasSeen = new Set();
    const { from, to } = state.range;
    const rangeOn = from > 0 || to > 0;
    let undated = 0;
    const perDistrict = new Map();   // district → {records, seedlings, geo, villages:Set, areas:Set}
    const perVillage = new Map();    // (area, village) → {records, seedlings, geo}
    const points = [];
    let seedlings = 0, records = 0, geoRecords = 0;
    const districtSelected = filters.district >= 0;

    for (let i = 0; i < n; i++) {
      const dt = c.date[i];
      if (rangeOn && dt && ((from && dt < from) || (to && dt > to))) continue;
      let fails = 0, failDim = null;
      for (let k = 0; k < active.length; k++) {
        if (active[k].col[i] !== active[k].v) { fails++; failDim = active[k].d; if (fails > 1) break; }
      }
      if (fails > 1) continue;
      if (rangeOn && !dt) { if (!fails) undated += c.records[i]; continue; } // no planting date: can't place it in the range
      const s = c.seedlings[i];
      if (fails === 1) { facet[failDim][c[failDim][i]] += s; continue; }

      for (const d of FILTER_DIMS) facet[d][c[d][i]] += s;
      const r = c.records[i];
      const geo = c.lat[i] !== 0;
      seedlings += s; records += r;
      if (geo) { geoRecords += r; points.push(i); }
      const m = Math.floor(dt / 100);
      if (m) months.set(m, (months.get(m) || 0) + r);
      if (dict.area[c.area[i]]) areasSeen.add(c.district[i] * 1e6 + c.area[i]);

      if (districtSelected) {
        const key = c.area[i] * 1e6 + c.village[i];
        let v = perVillage.get(key);
        if (!v) perVillage.set(key, v = { area: c.area[i], village: c.village[i], records: 0, seedlings: 0, geo: 0, species: new Map() });
        v.records += r; v.seedlings += s; if (geo) v.geo += r;
        v.species.set(c.species[i], (v.species.get(c.species[i]) || 0) + s);
      } else {
        let dd = perDistrict.get(c.district[i]);
        if (!dd) perDistrict.set(c.district[i], dd = { district: c.district[i], records: 0, seedlings: 0, geo: 0, villages: new Set(), areas: new Set() });
        dd.records += r; dd.seedlings += s; if (geo) dd.geo += r;
        if (dict.village[c.village[i]]) dd.villages.add(c.village[i]);
        if (dict.area[c.area[i]]) dd.areas.add(c.area[i]);
      }
    }
    const speciesCount = facet.species.reduce((a, v, i) => a + (v > 0 && dict.species[i] ? 1 : 0), 0);
    const districtCount = facet.district.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
    return { facet, months, undated, areas: areasSeen.size, perDistrict, perVillage, points,
      seedlings, records, geoRecords, speciesCount, districtCount };
  }

  // ======================================================================
  // Rendering
  // ======================================================================

  function render() {
    state.agg = aggregate();
    renderFilters();
    renderLedger();
    renderOverview();
    renderCharts();
    renderTable();
    state.mapDirty = true;
    renderMap();
    saveView();
  }

  function renderFilters() {
    const { dict, label, filters, agg } = state;
    // Year chips
    const years = dict.year.map((y, i) => ({ y, i })).filter(o => o.y).sort((a, b) => a.y.localeCompare(b.y));
    const chips = $('#year-chips');
    chips.innerHTML = '';
    const mk = (text, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-pressed', String(filters.year === idx));
      b.addEventListener('click', () => setFilter('year', idx));
      chips.appendChild(b);
    };
    mk('All years', -1);
    for (const o of years) mk(o.y, o.i);

    fillSelect('#filter-area', 'area', 'All taluks and blocks', agg.facet.area);
    fillSelect('#filter-species', 'species', 'All species', agg.facet.species);
    fillSelect('#filter-land', 'land', 'All land types', agg.facet.land);
    if (state.data.allDepartments) fillSelect('#filter-dept', 'dept', 'All departments', agg.facet.dept);

    const any = FILTER_DIMS.some(d => filters[d] >= 0) || state.range.from || state.range.to;
    $('#clear-filters').hidden = !any;
    const fromEl = $('#filter-from'), toEl = $('#filter-to');
    fromEl.value = Fmt.iso(state.range.from); toEl.value = Fmt.iso(state.range.to);
    fromEl.min = toEl.min = Fmt.iso(state.dateMin); fromEl.max = toEl.max = Fmt.iso(state.dateMax);
    if (state.range.to) fromEl.max = Fmt.iso(state.range.to);
    if (state.range.from) toEl.min = Fmt.iso(state.range.from);
    fromEl.classList.toggle('is-active', !!state.range.from); toEl.classList.toggle('is-active', !!state.range.to);

    function fillSelect(sel, dim, allText, facetValues) {
      const el = $(sel);
      const opts = label[dim].map((name, i) => ({ name, i, v: facetValues[i] }))
        .filter(o => o.v > 0 || o.i === filters[dim])
        .sort((a, b) => a.name.localeCompare(b.name));
      el.innerHTML = '';
      el.appendChild(new Option(allText, '-1'));
      for (const o of opts) el.appendChild(new Option(o.name, String(o.i)));
      el.value = String(filters[dim]);
      el.classList.toggle('is-active', filters[dim] >= 0);
    }
  }

  function renderLedger() {
    const { label, filters, agg } = state;
    const list = $('#ledger-list');
    const values = agg.facet.district;
    const max = Math.max(1, ...values);
    let rows = label.district.map((name, i) => ({ name, i, v: values[i] }));
    rows.sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
    const rank = new Map(rows.map((r, k) => [r.i, r.v > 0 ? k + 1 : '']));
    if (state.ledgerSort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    const q = state.ledgerQuery.trim().toLowerCase();
    if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q));

    const total = values.reduce((a, b) => a + b, 0);
    const html = [];
    if (!q) {
      html.push(`<li class="ledger-all"><button type="button" class="ledger-row" data-district="-1" aria-pressed="${filters.district < 0}">
        <span class="ledger-rank"></span><span class="ledger-name">All districts</span>
        <span class="ledger-value">${Fmt.short(total)}</span></button></li>`);
    }
    for (const r of rows) {
      const pct = (r.v / max) * 100;
      html.push(`<li><button type="button" class="ledger-row${r.v > 0 ? '' : ' is-zero'}" data-district="${r.i}" aria-pressed="${filters.district === r.i}"
        aria-label="${Fmt.escape(r.name)}, ${Fmt.words(r.v)} seedlings">
        <span class="ledger-rank">${rank.get(r.i)}</span>
        <span class="ledger-name">${Fmt.escape(r.name)}</span>
        <span class="ledger-value">${Fmt.short(r.v)}</span>
        <span class="ledger-bar" aria-hidden="true"><span style="width:${pct.toFixed(1)}%"></span></span>
      </button></li>`);
    }
    if (!rows.length) html.push('<li class="table-note" style="padding:0 1rem">No district matches that name.</li>');
    list.innerHTML = html.join('');
  }

  function renderOverview() {
    const { data, label, filters, agg } = state;
    const districtName = filters.district >= 0 ? label.district[filters.district] : null;
    $('#overview-title').textContent = districtName ? `${districtName} district` : 'All districts';

    const parts = [];
    if (data.allDepartments) parts.push(filters.dept >= 0 ? label.dept[filters.dept] : 'All departments');
    parts.push(filters.year >= 0 ? `Plantation year ${label.year[filters.year]}` : 'All plantation years');
    if (filters.area >= 0) parts.push(`Taluk / block: ${label.area[filters.area]}`);
    if (filters.species >= 0) parts.push(`Species: ${label.species[filters.species]}`);
    if (filters.land >= 0) parts.push(`Land type: ${label.land[filters.land]}`);
    const { from, to } = state.range;
    if (from || to) parts.push(from && to ? `Planted ${Fmt.date(from)} to ${Fmt.date(to)}` : from ? `Planted from ${Fmt.date(from)}` : `Planted up to ${Fmt.date(to)}`);
    const note = $('#date-help');
    note.hidden = !((from || to) && agg.undated);
    if (!note.hidden) note.textContent = `${Fmt.int(agg.undated)} planting records have no planting date (only a plantation year), so they are left out while a date range is set.`;
    const sentence = parts.map((t, i) => (i > 0 && /^(All|Planted) /.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t)).join(', ');
    $('#overview-sub').textContent = sentence + (districtName ? '.' : '. Select a district to see its details.');

    const link = $('#open-records');
    link.href = recordsUrl();
    link.textContent = districtName
      ? `View ${districtName} planting records with contact details`
      : 'View planting records with contact details';

    const empty = $('#overview-empty');
    if (!agg.records) {
      empty.textContent = state.n
        ? 'No plantings match these filters. Clear a filter to see more.'
        : `No plantings have been recorded for ${data.title} yet.`;
      empty.hidden = false;
      $('#kpis').innerHTML = '';
      return;
    }
    empty.hidden = true;

    const boxes = [
      { lead: true, icon: 'seedling', label: 'Seedlings planted', value: Fmt.words(agg.seedlings), note: `${Fmt.int(agg.seedlings)} seedlings in total` },
      { icon: 'records', label: 'Planting records', value: Fmt.int(agg.records), note: 'Entries reported from the field' },
      districtName
        ? { icon: 'pin', label: 'Taluks and blocks', value: Fmt.int(agg.areas), note: `With plantings in ${districtName}` }
        : { icon: 'pin', label: 'Districts', value: Fmt.int(agg.districtCount), note: 'With at least one planting' },
      { icon: 'leaf', label: 'Species planted', value: Fmt.int(agg.speciesCount), note: 'Different kinds of trees' },
    ];
    $('#kpis').innerHTML = boxes.map(b =>
      `<div class="kpi${b.lead ? ' kpi-lead' : ''}"><span class="kpi-icon" aria-hidden="true">${ICONS[b.icon]}</span><p class="kpi-label">${b.label}</p><p class="kpi-value">${b.value}</p><p class="kpi-note">${b.note}</p></div>`).join('');
  }

  const ICONS = {
    seedling: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-9M12 12c-4.5 0-7-2.8-7-7.5 4.7 0 7 2.6 7 7.5Zm0-2c0-4.2 2.3-6.5 7-6.5 0 4.6-2.4 6.5-7 6.5Z"/></svg>',
    records: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-8 5-13.5 14-14-.3 9-5.8 14-14 14Zm0 0 7-7"/></svg>',
  };

  /** Link to the planting records page for the current selection. */
  function recordsUrl(extra) {
    const { filters, dict } = state;
    const q = new URLSearchParams();
    q.set('district', filters.district >= 0 ? dict.district[filters.district] : 'all');
    for (const d of ['year', 'area', 'species', 'land', 'dept']) if (filters[d] >= 0) q.set(d, dict[d][filters[d]]);
    if (state.range.from) q.set('from', Fmt.iso(state.range.from));
    if (state.range.to) q.set('to', Fmt.iso(state.range.to));
    if (extra) for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return `records.html?${q}`;
  }

  // ---------- charts ----------

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = name => cs.getPropertyValue(name).trim();
    state.colors = { leaf: v('--leaf'), leafDeep: v('--leaf-deep'), leafSoft: v('--leaf-soft'), turmeric: v('--turmeric'), ink: v('--ink'),
      ink2: v('--ink-2'), ink3: v('--ink-3'), line: v('--line'), surface: v('--surface') };
    if (window.Chart) {
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      Chart.defaults.font.size = window.matchMedia('(max-width: 600px)').matches ? 14 : 13;
      Chart.defaults.color = state.colors.ink;
      Chart.defaults.borderColor = state.colors.line;
    }
  }

  const PALETTE = {
    year: ['#5bb37a', '#17633e'],     // forest green
    area: ['#38b2c4', '#0b5f73'],     // peacock blue
    species: ['#8cc63f', '#3c7a1e'],  // leaf green
    land: ['#c99a6b', '#7a4b26'],     // earth
  };
  const PICKED = '#e0a419';            // turmeric: the bar you selected

  /** Gradient bars; once a bar is selected, the others fade so the choice stands out. */
  function barFill(chart, pal, horizontal) {
    return ctx => {
      const e = chart.$entries?.[ctx.dataIndex];
      const sel = chart.$selected;
      if (e && sel >= 0) return e.code === sel ? PICKED : `${pal[0]}55`;
      const area = ctx.chart.chartArea;
      if (!area) return pal[1];
      const g = horizontal
        ? ctx.chart.ctx.createLinearGradient(area.left, 0, area.right, 0)
        : ctx.chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
      g.addColorStop(0, pal[0]);
      g.addColorStop(1, pal[1]);
      return g;
    };
  }

  function setupCharts() {
    if (!window.Chart) return;
    state.charts.year = barChart('#chart-year', false, 'year', PALETTE.year);
    state.charts.area = barChart('#chart-area', true, 'area', PALETTE.area);
    state.charts.species = barChart('#chart-species', true, 'species', PALETTE.species);
    state.charts.land = barChart('#chart-land', true, 'land', PALETTE.land);
    state.charts.month = new Chart($('#chart-month'), {
      type: 'line',
      data: { labels: [], datasets: [{ data: [], borderColor: '#0e7490', fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 8, borderWidth: 2.5,
        backgroundColor: ctx => {
          const a = ctx.chart.chartArea;
          if (!a) return 'rgba(14,116,144,0.15)';
          const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, 'rgba(56,178,196,0.45)');
          g.addColorStop(1, 'rgba(56,178,196,0.03)');
          return g;
        } }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${Fmt.int(ctx.parsed.y)} planting records` } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
          y: { beginAtZero: true, ticks: { precision: 0, callback: v => Fmt.short(v) }, grid: { color: state.colors.line } },
        },
      },
    });
  }

  function barChart(sel, horizontal, dim, palette) {
    const valueAxis = horizontal ? 'x' : 'y';
    const catAxis = horizontal ? 'y' : 'x';
    const chart = new Chart($(sel), {
      type: 'bar',
      data: { labels: [], datasets: [{ data: [], borderRadius: 5, borderSkipped: false, maxBarThickness: horizontal ? 30 : 64 }] },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: items => chart.$full?.[items[0].dataIndex] ?? items[0].label, label: ctx => `${Fmt.words(ctx.parsed[valueAxis])} seedlings` } },
        },
        scales: {
          [valueAxis]: { beginAtZero: true, ticks: { precision: 0, callback: v => Fmt.short(v) }, grid: { color: state.colors.line } },
          [catAxis]: { grid: { display: false }, ticks: { autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 28 ? `${l.slice(0, 27)}…` : l; } } },
        },
        onClick: (ev, els) => {
          if (!els.length) return;
          const code = chart.$codes?.[els[0].index];
          const d = chart.$dim;
          if (d && code !== undefined) setFilter(d, state.filters[d] === code ? -1 : code);
        },
        onHover: (ev, els) => { ev.native.target.style.cursor = els.length && chart.$dim ? 'pointer' : 'default'; },
      },
    });
    chart.$dim = dim;
    chart.data.datasets[0].backgroundColor = barFill(chart, palette || PALETTE.year, horizontal);
    return chart;
  }

  function setBars(chart, entries, dim, selected) {
    if (!chart) return;
    const { colors } = state;
    chart.$dim = dim;
    chart.$codes = entries.map(e => e.code);
    chart.$full = entries.map(e => e.name);
    chart.data.labels = entries.map(e => e.name);
    chart.data.datasets[0].data = entries.map(e => e.v);
    chart.$entries = entries;
    chart.$selected = selected;
    chart.canvas.setAttribute('aria-label', entries.slice(0, 5).map(e => `${e.name}: ${Fmt.words(e.v)}`).join('; '));
    chart.update();
  }

  function top(values, labels, limit, keep) {
    const out = [];
    for (let i = 0; i < values.length; i++) if (values[i] > 0 || i === keep) out.push({ code: i, name: labels[i], v: values[i] });
    out.sort((a, b) => b.v - a.v);
    if (limit && out.length > limit) {
      const head = out.slice(0, limit);
      if (keep >= 0 && !head.some(e => e.code === keep)) head[limit - 1] = out.find(e => e.code === keep);
      return head;
    }
    return out;
  }

  function renderCharts() {
    const { agg, label, filters, data, charts } = state;
    if (!window.Chart) return;

    const years = label.year.map((name, code) => ({ code, name, v: agg.facet.year[code] }))
      .filter(e => e.v > 0 || e.code === filters.year).sort((a, b) => a.name.localeCompare(b.name));
    setBars(charts.year, years, 'year', filters.year);

    setBars(charts.area, top(agg.facet.area, label.area, 5, filters.area), 'area', filters.area);
    $('#area-title').textContent = filters.district >= 0
      ? `Taluks and blocks in ${label.district[filters.district]}` : 'Taluks and blocks';
    setBars(charts.species, top(agg.facet.species, label.species, 5, filters.species), 'species', filters.species);
    setBars(charts.land, top(agg.facet.land, label.land, 8, filters.land), 'land', filters.land);



    // Monthly series with gaps filled
    const keys = [...agg.months.keys()].sort((a, b) => a - b);
    const labels = [], vals = [];
    if (keys.length) {
      let y = Math.floor(keys[0] / 100), m = keys[0] % 100;
      const end = keys[keys.length - 1];
      while (y * 100 + m <= end) {
        const k = y * 100 + m;
        labels.push(Fmt.month(k)); vals.push(agg.months.get(k) || 0);
        if (++m > 12) { m = 1; y++; }
      }
    }
    charts.month.data.labels = labels;
    charts.month.data.datasets[0].data = vals;
    charts.month.update();
    $('#chart-month-empty').hidden = keys.length > 0;
  }

  // ---------- table ----------

  function tableModel() {
    const { agg, label, filters } = state;
    if (filters.district >= 0) {
      const rows = [...agg.perVillage.values()].map(v => {
        let best = -1, bestV = -1;
        for (const [sp, s] of v.species) if (s > bestV && state.dict.species[sp]) { best = sp; bestV = s; }
        return { village: label.village[v.village], area: label.area[v.area], records: v.records, seedlings: v.seedlings,
          geo: v.geo, topSpecies: best >= 0 ? label.species[best] : NOT_SPECIFIED };
      });
      return {
        title: `Villages in ${label.district[filters.district]}`,
        columns: [
          { key: 'village', label: 'Village' }, { key: 'area', label: 'Taluk / block' },
          { key: 'topSpecies', label: 'Main species' },
          { key: 'records', label: 'Planting records', num: true, fmt: Fmt.int },
          { key: 'seedlings', label: 'Seedlings', num: true, fmt: Fmt.int },
        ],
        rows,
        link: row => { location.href = recordsUrl({ q: row.village === NOT_SPECIFIED ? '' : row.village }); },
      };
    }
    const rows = [...agg.perDistrict.values()].map(d => ({
      code: d.district, district: label.district[d.district], records: d.records, seedlings: d.seedlings,
      villages: d.villages.size, areas: d.areas.size, geo: d.geo,
    }));
    return {
      title: 'Districts',
      columns: [
        { key: 'district', label: 'District' },
        { key: 'areas', label: 'Taluks / blocks', num: true, fmt: Fmt.int },
        { key: 'villages', label: 'Villages', num: true, fmt: Fmt.int },
        { key: 'records', label: 'Planting records', num: true, fmt: Fmt.int },
        { key: 'seedlings', label: 'Seedlings', num: true, fmt: Fmt.int },
      ],
      rows,
      link: row => setFilter('district', row.code),
    };
  }

  const TABLE_LIMIT = 300;

  function renderTable() {
    const model = tableModel();
    state.tableModel = model;
    if (!model.columns.some(c => c.key === state.tableSort.key)) state.tableSort = { key: 'seedlings', dir: -1 };
    const { key, dir } = state.tableSort;
    const q = state.tableQuery.trim().toLowerCase();
    let rows = model.rows;
    if (q) rows = rows.filter(r => model.columns.some(c => !c.num && String(r[c.key]).toLowerCase().includes(q)));
    rows = rows.slice().sort((a, b) => {
      const x = a[key], y = b[key];
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });

    $('#table-title').textContent = model.title;
    $('#table-sub').textContent = state.filters.district < 0 ? 'Select a district to open it.' : 'Select a village to open its planting records.';
    const thead = $('#data-table thead');
    thead.innerHTML = `<tr><th scope="col" class="num sno">S.No.</th>${model.columns.map(c => `<th scope="col" class="${c.num ? 'num' : ''}" aria-sort="${c.key === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-key="${c.key}">${c.label}</button></th>`).join('')}</tr>`;
    const shown = rows.slice(0, TABLE_LIMIT);
    $('#data-table tbody').innerHTML = shown.map((r, i) =>
      `<tr${model.link ? ` class="is-link" tabindex="0" data-row="${i}"` : ''}><td class="num sno">${i + 1}</td>${model.columns.map(c =>
        `<td class="${c.num ? 'num' : ''}">${Fmt.escape(c.fmt ? c.fmt(r[c.key]) : r[c.key])}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${model.columns.length + 1}">No rows match.</td></tr>`;
    state.tableShown = shown;
    $('#table-note').textContent = rows.length > TABLE_LIMIT
      ? `Showing the top ${Fmt.int(TABLE_LIMIT)} of ${Fmt.int(rows.length)} rows. Download CSV to get all of them.`
      : `${Fmt.plural(rows.length, 'row', 'rows')}.`;
  }

  // ---------- full records, for map pop-ups ----------

  const PHONE_COL = /mobile|phone/i;
  const EMAIL_COL = /e-?mail/i;

  /** Loads (once) the full records of a district and indexes them by map location. */
  function loadRecords(name) {
    const cache = state.recordCache;
    if (!cache.has(name)) {
      const p = Vault.loadDistrict(name).then(d => {
        d.byPoint = new Map();
        d.meta.forEach((m, i) => {
          if (!m[5]) return;
          const list = d.byPoint.get(m[5]);
          if (list) list.push(i); else d.byPoint.set(m[5], [i]);
        });
        return d;
      });
      p.catch(() => cache.delete(name));
      cache.set(name, p);
    }
    return cache.get(name);
  }

  function recordError(e) {
    if (e && e.kind === 'stale') return 'The data was updated after you signed in. Reload the page to see the latest records.';
    if (e && e.kind === 'network') return 'Couldn\'t load the full record. Check your connection and try again.';
    return 'Couldn\'t open the full record. Reload the page and try again.';
  }

  function cellHtml(column, value) {
    if (!value) return '';
    const e = Fmt.escape(value);
    if (PHONE_COL.test(column) && /^\+?\d[\d\s-]{5,}$/.test(value)) return `<a href="tel:${e.replace(/[\s-]/g, '')}">${e}</a>`;
    if (EMAIL_COL.test(column) && value.includes('@')) return `<a href="mailto:${e}">${e}</a>`;
    return e;
  }

  function recordHtml(d, i) {
    const get = name => { const j = d.columns.findIndex(c => c.toLowerCase() === name); return j >= 0 ? d.rows[i][j] : ''; };
    const seedlings = get('seedlings');
    const place = [get('village'), get('taluk') || get('block')].filter(Boolean).join(', ');
    const items = d.columns.map((c, j) => [Fmt.columnLabel(c), d.rows[i][j], c]).filter(([, v]) => v !== '' && v !== '00:00:00');
    return `<div class="record-card"><p class="record-title"><strong>${seedlings ? `${Fmt.escape(seedlings)} seedlings` : 'Planting record'}</strong>` +
      `${place ? `<br>${Fmt.escape(place)}` : ''}</p><dl>${items.map(([l, v, c]) => `<dt>${Fmt.escape(l)}</dt><dd>${cellHtml(c, v)}</dd>`).join('')}</dl></div>`;
  }

  // ---------- map ----------

  function setupMapWhenVisible() {
    const el = $('#map');
    const init = () => {
      if (state.map || !window.L) return;
      state.map = L.map(el, { preferCanvas: true, minZoom: 6, maxZoom: 17, zoomSnap: 0.5 }).setView([10.9, 78.4], 7);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        // OpenStreetMap's tile policy requires a Referer. The site sends none by default (privacy),
        // so map tiles alone send the site's origin — never the page address or filters.
        referrerPolicy: 'strict-origin-when-cross-origin',
      }).addTo(state.map);
      state.dots = new L.DotLayer({ color: state.colors.leafDeep, stroke: state.colors.surface, highlight: state.colors.turmeric, onPick: showPoint }).addTo(state.map);
      state.mapDirty = true;
      renderMap();
    };
    state.initMap = init;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { init(); io.disconnect(); }
      }, { rootMargin: '300px' });
      io.observe(el);
    } else init();
  }

  function renderMap() {
    const { agg, c } = state;
    const total = agg.records, geo = agg.geoRecords;
    $('#map-sub').textContent = total
      ? `${Fmt.int(agg.points.length)} geotagged locations. ${geo < total ? `${Fmt.int(total - geo)} of ${Fmt.int(total)} planting records have no coordinates and aren't on the map. ` : ''}Select a dot for details.`
      : 'No plantings match these filters.';
    if (!state.map || !state.mapDirty) return;
    state.mapDirty = false;
    const pts = agg.points;
    const lat = new Float64Array(pts.length), lon = new Float64Array(pts.length);
    for (let k = 0; k < pts.length; k++) {
      const i = pts[k];
      lat[k] = c.lat[i] / 1e5; lon[k] = c.lon[i] / 1e5;
    }
    state.mapPoints = pts;
    state.map.closePopup();
    state.dots.setHighlight(null);
    state.dots.setPoints(lat, lon);
    if (state.filters.district >= 0 && pts.length) {
      // Zoom to where most plantings are; a few mistyped coordinates shouldn't zoom the map out.
      const [la0, la1] = spread(lat), [lo0, lo1] = spread(lon);
      state.map.fitBounds([[la0, lo0], [la1, lo1]], { padding: [16, 16], maxZoom: 15 });
    } else if (state.filters.district < 0 && state.lastFitDistrict !== -1) {
      state.map.setView([10.9, 78.4], 7);
    }
    state.lastFitDistrict = state.filters.district;
  }

  /** 2nd–98th percentile range, so stray points don't decide the zoom. */
  function spread(values) {
    const v = Float64Array.from(values).sort();
    if (v.length < 20) return [v[0], v[v.length - 1]];
    return [v[Math.floor(v.length * 0.02)], v[Math.ceil(v.length * 0.98) - 1]];
  }

  async function showPoint(k, latlng) {
    const i = state.mapPoints[k];
    const { c } = state;
    const district = state.dict.district[c.district[i]];
    const summary = pointSummary(i);
    const map = state.map;
    if (map.getZoom() < 14) map.setView(latlng, 14);
    state.dots.setHighlight(latlng);
    const popup = L.popup({ maxWidth: 380, minWidth: 260, className: 'record-popup', autoPanPadding: [24, 24] })
      .setLatLng(latlng).setContent(`${summary}<p class="popup-note">Loading the full record…</p>`).openOn(map);
    try {
      const d = await loadRecords(district);
      const deptName = state.dict.dept[c.dept[i]];
      const hits = (d.byPoint.get(`${c.lat[i]},${c.lon[i]}`) || []).filter(j => d.meta[j][0] === deptName);
      if (!hits.length) { popup.setContent(summary); return; }
      popup.setContent(hits.slice(0, 3).map(j => recordHtml(d, j)).join('<hr>') +
        (hits.length > 3 ? `<p class="popup-note">${Fmt.int(hits.length - 3)} more records at this location are on the planting records page.</p>` : ''));
    } catch (e) {
      popup.setContent(`${summary}<p class="popup-note">${recordError(e)}</p>`);
    }
  }

  function pointSummary(i) {
    const { c, label, data } = state;
    const rows = [
      ['Taluk / block', label.area[c.area[i]]],
      ['Village', label.village[c.village[i]]],
      ['Species', label.species[c.species[i]]],
      ['Land type', label.land[c.land[i]]],
      ['Plantation year', label.year[c.year[i]]],
      c.date[i] ? ['Planting date', Fmt.date(c.date[i])] : null,
      data.allDepartments ? ['Department', label.dept[c.dept[i]]] : null,
    ].filter(Boolean);
    return `<div class="record-card"><p class="record-title"><strong>${Fmt.int(c.seedlings[i])} seedlings</strong><br>${Fmt.escape(label.district[c.district[i]])} district</p><dl>` +
      rows.map(([k2, v]) => `<dt>${k2}</dt><dd>${Fmt.escape(v)}</dd>`).join('') + '</dl></div>';
  }

  // ======================================================================
  // Interaction
  // ======================================================================

  function setFilter(dim, value) {
    if (state.filters[dim] === value) return;
    state.filters[dim] = value;
    if (dim === 'district') state.filters.area = -1; // taluks belong to a district
    render();
  }

  function wireApp() {
    $('#ledger-list').addEventListener('click', e => {
      const b = e.target.closest('[data-district]');
      if (!b) return;
      const d = Number(b.dataset.district);
      setFilter('district', d === state.filters.district ? -1 : d);
    });
    document.querySelectorAll('.ledger-sort button').forEach(b => b.addEventListener('click', () => {
      state.ledgerSort = b.dataset.sort;
      document.querySelectorAll('.ledger-sort button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderLedger();
    }));
    $('#ledger-search').addEventListener('input', e => { state.ledgerQuery = e.target.value; renderLedger(); });

    for (const [sel, dim] of [['#filter-area', 'area'], ['#filter-species', 'species'], ['#filter-land', 'land'], ['#filter-dept', 'dept']]) {
      $(sel).addEventListener('change', e => setFilter(dim, Number(e.target.value)));
    }
    $('#clear-filters').addEventListener('click', () => {
      for (const d of FILTER_DIMS) state.filters[d] = -1;
      state.range = { from: 0, to: 0 };
      render();
    });
    const onDate = () => {
      let from = Fmt.ymd($('#filter-from').value), to = Fmt.ymd($('#filter-to').value);
      if (from && to && from > to) [from, to] = [to, from];
      state.range = { from, to };
      render();
    };
    $('#filter-from').addEventListener('change', onDate);
    $('#filter-to').addEventListener('change', onDate);

    $('#data-table thead').addEventListener('click', e => {
      const b = e.target.closest('button[data-key]');
      if (!b) return;
      const key = b.dataset.key;
      const col = state.tableModel.columns.find(c => c.key === key);
      state.tableSort = state.tableSort.key === key ? { key, dir: -state.tableSort.dir } : { key, dir: col.num ? -1 : 1 };
      renderTable();
    });
    const openRow = e => {
      const tr = e.target.closest('tr[data-row]');
      if (tr && state.tableModel.link) state.tableModel.link(state.tableShown[Number(tr.dataset.row)]);
    };
    $('#data-table tbody').addEventListener('click', openRow);
    $('#data-table tbody').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(e); } });
    $('#table-search').addEventListener('input', e => { state.tableQuery = e.target.value; renderTable(); });

    $('#toggle-ledger').addEventListener('click', () => setLedgerOpen($('#ledger').hidden));
    $('#close-ledger').addEventListener('click', () => { setLedgerOpen(false); $('#toggle-ledger').focus(); });

    $('#download-csv').addEventListener('click', downloadCsv);
    $('#refresh-data').addEventListener('click', refreshData);
    $('#sign-out').addEventListener('click', () => { Vault.signOut(); location.reload(); });

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => {
      readColors();
      for (const ch of Object.values(state.charts)) {
        for (const ax of Object.values(ch.options.scales || {})) if (ax.grid?.color) ax.grid.color = state.colors.line;
      }
      if (state.dots) state.dots.setColors(state.colors.leafDeep, state.colors.surface, state.colors.turmeric);
      renderCharts();
    };
    if (mq.addEventListener) mq.addEventListener('change', onTheme);
  }

  /** Loads newly published data, if any, without signing out. Filters are kept (saved per tab). */
  async function refreshData() {
    const btn = $('#refresh-data');
    btn.disabled = true;
    busy('Checking for new data…');
    let latest = null;
    try {
      const res = await fetch('data/version.json', { cache: 'no-store' });
      if (res.ok) latest = (await res.json()).updated;
    } catch (e) {
      busy(false); btn.disabled = false;
      toast('Couldn\'t check for new data. Check your connection and try again.');
      return;
    }
    if (latest && new Date(latest).getTime() === new Date(state.data.updated).getTime()) {
      busy(false); btn.disabled = false;
      toast(`You have the latest data (updated ${Fmt.updated(latest)}). New uploads appear here within about an hour.`);
      return;
    }
    busy('Loading the new data…');
    saveView();
    location.reload(); // re-opens the newest files with the same sign-in
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }

  function trackFilterHeight() {
    const f = $('.filters');
    const set = () => document.documentElement.style.setProperty('--filters-h', `${f.offsetHeight}px`);
    set();
    if ('ResizeObserver' in window) new ResizeObserver(set).observe(f);
  }

  function downloadCsv() {
    const { c, n, label, filters, data } = state;
    const active = FILTER_DIMS.filter(d => filters[d] >= 0);
    const q = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const out = ['S.No.,Department,District,Taluk / block,Village,Species,Land type,Plantation year,Planting date,Planting records,Seedlings,Latitude,Longitude'];
    let sno = 0;
    for (let i = 0; i < n; i++) {
      let ok = true;
      for (const d of active) if (c[d][i] !== filters[d]) { ok = false; break; }
      if (ok && inRangeOff(c.date[i])) ok = false;
      if (!ok) continue;
      out.push([
        ++sno, label.dept[c.dept[i]], label.district[c.district[i]], label.area[c.area[i]], label.village[c.village[i]],
        label.species[c.species[i]], label.land[c.land[i]], label.year[c.year[i]],
        c.date[i] ? Fmt.date(c.date[i]) : '', c.records[i], c.seedlings[i],
        c.lat[i] ? (c.lat[i] / 1e5).toFixed(5) : '', c.lon[i] ? (c.lon[i] / 1e5).toFixed(5) : '',
      ].map(q).join(','));
    }
    saveCsv(out, `${data.login}-${filters.district >= 0 ? label.district[filters.district] : 'all-districts'}-summary`);
  }

  /** True when a date range is set and this planting date is outside it (or missing). */
  function inRangeOff(dt) {
    const { from, to } = state.range;
    if (!from && !to) return false;
    return !dt || (from && dt < from) || (to && dt > to);
  }

  function saveCsv(lines, base) {
    const name = `${base}-${new Date().toISOString().slice(0, 10)}.csv`.toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
})();