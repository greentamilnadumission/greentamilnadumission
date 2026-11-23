// Number and date formatting in Indian conventions (lakh, crore).
(function () {
  'use strict';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function trim(x, digits) {
    return Number(x.toFixed(digits)).toLocaleString('en-IN', { maximumFractionDigits: digits });
  }

  // Clear headings for the columns of the field-app export.
  const COLUMN_LABELS = {
    'farmer name': 'Farmer name', 'mobile': 'Farmer mobile', 'owner': 'Owner name',
    'incharge name': 'In-charge name', 'contact name': 'Contact person / office',
    'stakeholder name': 'Organisation (as reported)', 'officer name': 'Officer name', 'officer mobile': 'Officer mobile',
    'user name': 'Reported by', 'user email': 'Reporter email', 'user type': 'Reporter type',
    'date': 'Planting date', 'time': 'Time', 'planted date': 'Planted date', 'reported at': 'Reported at',
    'year': 'Plantation year', 'land type': 'Land type', 'land parcel area': 'Land parcel area',
    'total area': 'Total area', 'survey no': 'Survey number', 'bag type': 'Bag type',
    'species tamil': 'Species (Tamil)', 'gov department type': 'Government department (as reported)',
    'department type': 'Department type', 'department': 'Source', 'report id': 'Report ID',
    'report type': 'Report type', 'verification status': 'Verification status', 'id': 'Record ID',
  };

  window.Fmt = {
    columnLabel(name) { return COLUMN_LABELS[String(name).trim().toLowerCase()] || name; },

    int(n) { return Math.round(n || 0).toLocaleString('en-IN'); },

    /** 21733717 → "2.17 crore", 465000 → "4.65 lakh", 8200 → "8,200" */
    words(n) {
      n = n || 0;
      if (n >= 1e7) return `${trim(n / 1e7, n >= 1e9 ? 0 : 2)} crore`;
      if (n >= 1e5) return `${trim(n / 1e5, 2)} lakh`;
      return Math.round(n).toLocaleString('en-IN');
    },

    /** Short form for axes and the district ledger: 2.17 Cr, 4.6 L, 8.2K */
    short(n) {
      n = n || 0;
      if (n >= 1e7) return `${trim(n / 1e7, 2)} Cr`;
      if (n >= 1e5) return `${trim(n / 1e5, 1)} L`;
      if (n >= 1e3) return `${trim(n / 1e3, 1)}K`;
      return String(Math.round(n));
    },

    /** 20241102 → "02 Nov 2024" */
    date(ymd) { return `${String(ymd % 100).padStart(2, '0')} ${MONTHS[(Math.floor(ymd / 100) % 100) - 1]} ${Math.floor(ymd / 10000)}`; },

    /** "2024-11-02" ⇄ 20241102 */
    ymd(iso) { return iso ? Number(String(iso).replace(/-/g, '')) : 0; },
    iso(ymd) { return ymd ? `${Math.floor(ymd / 10000)}-${String(Math.floor(ymd / 100) % 100).padStart(2, '0')}-${String(ymd % 100).padStart(2, '0')}` : ''; },

    /** 202411 → "Nov 2024" */
    month(ym) { return `${MONTHS[(ym % 100) - 1]} ${Math.floor(ym / 100)}`; },

    updated(iso) {
      try {
        return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
      } catch (e) { return iso; }
    },

    plural(n, one, many) { return `${Fmt.int(n)} ${n === 1 ? one : many}`; },

    escape(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
  };
})();
