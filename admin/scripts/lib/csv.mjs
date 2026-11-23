// Streaming RFC 4180 CSV parser with no dependencies.
// Handles quoted fields, escaped quotes (""), commas and newlines inside quotes,
// CRLF / LF line endings and a leading UTF-8 BOM.

export async function* parseCsv(readable) {
  let field = '';
  let row = [];
  let inQuotes = false;
  let quotePending = false; // saw a quote inside a quoted field; next char decides
  let first = true;

  for await (const chunk of readable) {
    let s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (first) {
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      first = false;
    }
    const rows = [];
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (inQuotes) {
        if (quotePending) {
          quotePending = false;
          if (c === 34) { field += '"'; start = i + 1; continue; } // escaped quote
          inQuotes = false; // closing quote; fall through to unquoted handling
        } else if (c === 34) {
          field += s.slice(start, i);
          quotePending = true;
          start = i + 1;
          continue;
        } else {
          continue;
        }
      }
      if (c === 44) { // ,
        field += s.slice(start, i);
        row.push(field); field = ''; start = i + 1;
      } else if (c === 10) { // \n
        field += s.slice(start, i);
        if (field.endsWith('\r')) field = field.slice(0, -1);
        row.push(field); field = '';
        rows.push(row); row = [];
        start = i + 1;
      } else if (c === 34 && i === start && field === '') {
        inQuotes = true; start = i + 1;
      }
    }
    if (!quotePending) field += s.slice(start);
    for (const r of rows) yield r;
  }
  if (quotePending) inQuotes = false;
  if (field !== '' || row.length) {
    if (field.endsWith('\r')) field = field.slice(0, -1);
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) yield row;
  }
}
