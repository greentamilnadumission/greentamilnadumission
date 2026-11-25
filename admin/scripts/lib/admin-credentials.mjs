// The head office (GTM-ADMIN) password lives apart from the department and scheme passwords.
// The builders use it to write the head office files into admin/public/admin/data/, which the
// /admin page opens. Without it the builds still run; the head office files are just skipped.
//
// Read from (first match wins):
//   1. the ADMIN_CREDENTIALS environment variable (JSON, e.g. {"GTM-ADMIN": "password"})
//   2. admin/config/admin-credentials.local.json (git-ignored, written by generate-admin-credentials.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = path.resolve(HERE, '..', '..');

export const ADMIN_OUT = path.join(ADMIN_DIR, 'public', 'admin', 'data');
export const ADMIN_CREDENTIALS_FILE = path.join(ADMIN_DIR, 'config', 'admin-credentials.local.json');

/** Returns the head office password, or null if none is configured. */
export function loadAdminPassword(adminId) {
  let raw = process.env.ADMIN_CREDENTIALS;
  if (!raw && fs.existsSync(ADMIN_CREDENTIALS_FILE)) raw = fs.readFileSync(ADMIN_CREDENTIALS_FILE, 'utf8');
  if (!raw || !raw.trim()) return null;
  const parsed = JSON.parse(raw);
  for (const [id, v] of Object.entries(parsed)) {
    if (id.trim().toUpperCase() !== adminId.toUpperCase()) continue;
    return typeof v === 'string' ? v : v.password;
  }
  return null;
}
