// Head office dashboard. The side menu switches between the Departments and Schemes dashboards,
// which are the same pages the department and scheme sites use (served under /admin/).
//
// Signing in here once fills in each dashboard's own sign-in form (same page, same origin) with the
// head office login. The password is kept only in this page's memory and is forgotten on sign-out.
(function () {
  'use strict';
  const LOGIN_ID = 'GTM-ADMIN';
  const DASHBOARDS = {
    dept: { frame: '#frame-dept', src: '/admin/departments/' },
    scheme: { frame: '#frame-scheme', src: '/admin/schemes/' },
  };
  // The side menu lists, and opens, one department or scheme; the dashboards read the choice from the URL.
  const SUB = {
    dept: { list: '#sub-dept', param: 'dept', select: 'filter-dept' },
    scheme: { list: '#sub-scheme', param: 'scheme', select: 'filter-scheme' },
  };
  const SIGN_IN_TIMEOUT_MS = 180000; // the data can take 20 to 30 seconds on a slow connection
  const $ = sel => document.querySelector(sel);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let password = null;
  const signedIn = new Set();

  document.addEventListener('DOMContentLoaded', () => {
    $('#login-form').addEventListener('submit', ev => {
      ev.preventDefault();
      const pw = $('#login-password').value;
      $('#login-error').hidden = true;
      if (!pw) { showError('Enter the head office password.'); return; }
      password = pw;
      $('#login-password').value = '';
      $('#login-view').hidden = true;
      $('#app-view').hidden = false;
      openPick('dept', null);
    });

    document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => openPick(b.dataset.section, null)));

    for (const [key, d] of Object.entries(DASHBOARDS)) {
      $(d.frame).addEventListener('load', () => onFrameLoad(key));
    }

    $('#sign-out').addEventListener('click', () => {
      password = null;
      signedIn.clear();
      try { sessionStorage.clear(); } catch (e) { /* ignore */ }
      location.reload();
    });
  });

  function show(key) {
    for (const [k, other] of Object.entries(DASHBOARDS)) $(other.frame).hidden = k !== key;
    document.querySelectorAll('.nav').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.section === key)));
  }

  /** Shows one dashboard, for everything (name = null) or for one department or scheme from the side menu. */
  function openPick(key, name) {
    show(key);
    const frame = $(DASHBOARDS[key].frame);
    const url = name === null ? `${DASHBOARDS[key].src}?all=1` : `${DASHBOARDS[key].src}?${SUB[key].param}=${encodeURIComponent(name)}`;
    if (frame.getAttribute('src') !== url) frame.src = url;
    document.querySelectorAll(`${SUB[key].list} button`).forEach(b =>
      b.setAttribute('aria-current', String((name || '') === b.dataset.name)));
  }

  /** Fills one side menu with "All" plus every department or scheme in that dashboard's own dropdown. */
  function buildMenu(key, doc) {
    const list = $(SUB[key].list);
    const select = doc.getElementById(SUB[key].select);
    if (!select || list.childElementCount) return;
    const add = (text, name) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.dataset.name = name;
      b.addEventListener('click', () => openPick(key, name === '' ? null : name));
      li.appendChild(b);
      list.appendChild(li);
    };
    add(key === 'dept' ? 'All departments' : 'All schemes', '');
    const names = [...select.options].slice(1).map(o => o.textContent.trim()).filter(n => n && n !== 'Not specified');
    for (const n of names) add(n, n);
  }

  async function onFrameLoad(key) {
    const frame = $(DASHBOARDS[key].frame);
    const doc = frame.contentDocument;
    if (!doc || !doc.getElementById('login-form')) return; // not a dashboard page
    // The dashboards' own sign-out would bring back their login form, so it is hidden here.
    const style = doc.createElement('style');
    style.textContent = '#sign-out, #rp-sign-out { display: none !important; }';
    doc.head.appendChild(style);
    if (!password || signedIn.has(key)) return;
    await signInDashboard(key, frame, doc);
  }

  /** Fills the dashboard's sign-in form with the head office login and waits for the result. */
  async function signInDashboard(key, frame, doc) {
    const started = Date.now();
    let submitted = false;
    while (Date.now() - started < SIGN_IN_TIMEOUT_MS) {
      if (frame.contentDocument !== doc) return; // the frame moved on to another page
      const app = doc.getElementById('app-view');
      if (app && !app.hidden) { signedIn.add(key); buildMenu(key, doc); return; }
      const err = doc.getElementById('login-error');
      if (submitted && err && !err.hidden) { failed(err.textContent); return; }
      const loginView = doc.getElementById('login-view');
      if (!submitted && loginView && !loginView.hidden) {
        doc.getElementById('login-id').value = LOGIN_ID;
        doc.getElementById('login-password').value = password;
        submitted = true;
        doc.getElementById('login-form').requestSubmit();
      }
      await sleep(250);
    }
  }

  /** The dashboard could not open with this password (or failed while opening): show its message here and ask again. */
  function failed(message) {
    password = null;
    signedIn.clear();
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    showError(message || 'That password doesn\'t match. Check the head office login ID and password and try again.');
    $('#login-password').focus();
  }

  function showError(msg) {
    const err = $('#login-error');
    err.textContent = msg;
    err.hidden = false;
  }
})();
