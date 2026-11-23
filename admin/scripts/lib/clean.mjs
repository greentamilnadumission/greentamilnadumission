// Normalisation helpers for the GTM export.

// The 38 districts of Tamil Nadu (display names) and the spellings seen in the data.
export const DISTRICTS = {
  'Ariyalur': [], 'Chengalpattu': ['CHENGALPET'], 'Chennai': [], 'Coimbatore': [], 'Cuddalore': [],
  'Dharmapuri': [], 'Dindigul': [], 'Erode': [], 'Kallakurichi': ['KALLAKURUCHI'],
  'Kancheepuram': ['KANCHIPURAM', 'KANCHEEPURAM'], 'Kanyakumari': ['KANNIYAKUMARI'], 'Karur': [],
  'Krishnagiri': [], 'Madurai': [], 'Mayiladuthurai': [], 'Nagapattinam': [], 'Namakkal': [],
  'Nilgiris': ['THE NILGIRIS'], 'Perambalur': [], 'Pudukkottai': ['PUDUKOTTAI'],
  'Ramanathapuram': ['RAMNAD'], 'Ranipet': [], 'Salem': [], 'Sivaganga': ['SIVAGANGAI'],
  'Tenkasi': [], 'Thanjavur': [], 'Theni': [], 'Thoothukudi': ['TUTICORIN'],
  'Tiruchirappalli': ['TRICHY', 'TIRUCHIRAPALLI'], 'Tirunelveli': ['THIRUNELVELI'],
  'Tirupattur': ['THIRUPATHUR', 'TIRUPATHUR'], 'Tiruppur': ['THIRUPPUR'],
  'Tiruvallur': ['THIRUVALLUR'], 'Tiruvannamalai': ['THIRUVANNAMALAI'], 'Tiruvarur': ['THIRUVARUR'],
  'Vellore': [], 'Villupuram': ['VILUPPURAM'], 'Virudhunagar': [],
};

const districtLookup = new Map();
for (const [name, aliases] of Object.entries(DISTRICTS)) {
  districtLookup.set(key(name), name);
  for (const a of aliases) districtLookup.set(key(a), name);
}

const SPECIES_ALIASES = new Map([
  ['mahagony', 'Mahogany'],
]);

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/** Lowercase, drop punctuation and collapse whitespace — used for matching only. */
export function key(s) {
  return String(s ?? '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function clean(s) {
  if (s == null) return '';
  return String(s).replace(/&(amp|lt|gt|quot|#39|apos);/g, m => ENTITIES[m]).replace(/\s+/g, ' ').trim();
}

/** "VEDASANDUR" / "vedasandur" → "Vedasandur". */
export function titleCase(s) {
  const t = clean(s);
  if (!t) return '';
  return t.toLowerCase().replace(/(^|[\s(\/.\-,])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

export function district(raw) {
  const k = key(raw);
  if (!k) return null;
  return districtLookup.get(k) ?? null;
}

export function species(raw) {
  const t = clean(raw);
  if (!t) return '';
  const alias = SPECIES_ALIASES.get(t.toLowerCase());
  return alias ?? titleCase(t);
}

export function landType(raw) {
  const t = clean(raw);
  if (!t) return '';
  if (t === '4') return 'Farm land (Agriculture code 4)';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase().replace(/\bgovt\b/, 'Govt');
}

/** Parse the many date shapes an export can produce. Returns {y, m, d} or null. */
export function parseDate(raw) {
  const t = clean(raw);
  if (!t) return null;
  let y, m, d;
  let r;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(t))) { y = +r[3]; m = +r[2]; d = +r[1]; } // dd/mm/yyyy (India)
  else if (/^\d{5}(\.\d+)?$/.test(t)) { // Excel serial date
    const x = new Date(Math.round((+t - 25569) * 86400000));
    y = x.getUTCFullYear(); m = x.getUTCMonth() + 1; d = x.getUTCDate();
  } else return null;
  const now = new Date();
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2018 || y > now.getFullYear() + 1) return null;
  return { y, m, d };
}

/** Financial year (April–March) label for a date, e.g. 2026-11 → "2026-2027". */
export function financialYear(d) {
  const start = d.m >= 4 ? d.y : d.y - 1;
  return `${start}-${start + 1}`;
}

export function currentFyStart() {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

export function num(raw) {
  const t = clean(raw).replace(/,/g, '');
  if (!t) return NaN;
  return Number(t);
}
