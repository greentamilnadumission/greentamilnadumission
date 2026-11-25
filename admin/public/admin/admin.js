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
      show('dept');
    });

    document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => show(b.dataset.section)));

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
    const d = DASHBOARDS[key];
    const frame = $(d.frame);
    if (!frame.getAttribute('src')) frame.src = d.src; // loads the dashboard the first time it is opened
    for (const [k, other] of Object.entries(DASHBOARDS)) $(other.frame).hidden = k !== key;
    document.querySelectorAll('.nav').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.section === key)));
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
      if (app && !app.hidden) { signedIn.add(key); return; }
      const err = doc.getElementById('login-error');
      if (submitted && err && !err.hidden) { failed(); return; }
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

  /** The password did not open this dashboard: ask for it again. */
  function failed() {
    password = null;
    signedIn.clear();
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    showError('That password doesn\'t match. Check the head office login ID and password and try again.');
    $('#login-password').focus();
  }

  function showError(msg) {
    const err = $('#login-error');
    err.textContent = msg;
    err.hidden = false;
  }
})();
