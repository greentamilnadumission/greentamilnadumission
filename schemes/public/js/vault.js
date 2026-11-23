// Fetches a department's encrypted data file and opens it with the department's password.
//
// File layout (written by scripts/build-data.mjs):
//   "GTM1" | PBKDF2 iterations (uint32 BE) | salt (16) | IV (12) | AES-256-GCM ciphertext + tag
// The plaintext is gzip-compressed JSON. A wrong password fails GCM authentication, so the
// browser never sees any data without the right login.
(function () {
  'use strict';
  const MAGIC = new TextEncoder().encode('GTM1');
  const SESSION_KEY = 'gtm-scheme-session';

  class VaultError extends Error {
    constructor(kind, message) { super(message || kind); this.kind = kind; }
  }

  function supported() {
    return !!(window.crypto && crypto.subtle && window.DecompressionStream && window.TextEncoder);
  }

  function normaliseId(id) { return String(id || '').trim().toUpperCase(); }

  async function fileName(id) {
    const bytes = new TextEncoder().encode(`gtm:${normaliseId(id)}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('').slice(0, 32) + '.bin';
  }

  async function fetchFile(id) {
    let res;
    try {
      res = await fetch(`data/${await fileName(id)}`, { cache: 'no-cache' });
    } catch (e) {
      throw new VaultError('network');
    }
    if (res.status === 404 || res.status === 403) {
      const err = new VaultError('credentials');
      err.status = res.status;
      throw err;
    }
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

  async function deriveKey(password, salt, iterations) {
    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      material, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }

  async function open(file, key) {
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: file.iv, additionalData: MAGIC }, key, file.ciphertext);
    } catch (e) {
      throw new VaultError('credentials');
    }
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  let current = null; // { id, key, salt } of the signed-in login

  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  function remember(id, rawKey, salt) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, k: b64(rawKey), s: b64(salt) }));
    } catch (e) { /* storage blocked: the person will sign in again after a reload */ }
  }

  window.Vault = {
    VaultError,
    supported,

    async signIn(id, password) {
      id = normaliseId(id);
      const file = await fetchFile(id);
      const key = await deriveKey(password, file.salt, file.iterations);
      const data = await open(file, key);
      current = { id, key, salt: b64(file.salt) };
      remember(id, await crypto.subtle.exportKey('raw', key), file.salt);
      return data;
    },

    /** Re-opens the data after a page reload in the same tab, without asking for the password again. */
    async resume() {
      let saved;
      try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { saved = null; }
      if (!saved) return null;
      try {
        const file = await fetchFile(saved.id);
        if (b64(file.salt) !== saved.s) { this.signOut(); return null; } // data was rebuilt since
        const key = await crypto.subtle.importKey('raw', unb64(saved.k), 'AES-GCM', false, ['decrypt']);
        const data = await open(file, key);
        current = { id: saved.id, key, salt: saved.s };
        return data;
      } catch (e) {
        if (e.kind === 'credentials') this.signOut();
        if (e.kind === 'network') throw e;
        return null;
      }
    },

    /** Full planting records (every export column) for one district of the signed-in login. */
    async loadDistrict(district) {
      if (!current) throw new VaultError('credentials');
      const file = await fetchFile(`${current.id}|${district}`);
      if (b64(file.salt) !== current.salt) throw new VaultError('stale'); // data was rebuilt since sign-in
      return open(file, current.key);
    },

    signOut() {
      current = null;
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    },
  };
})();
