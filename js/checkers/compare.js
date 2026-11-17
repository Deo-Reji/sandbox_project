// Result-table comparison shared by the SQL, pandas and Exploration tracks.
//
// compareResults(expected, actual, opts) -> { pass, message, details }
//   expected / actual: { columns: [...], rows: [[...], ...] }
//   opts.orderMatters: rows must appear in the same order (prompt required ORDER BY)
//   opts.tolerance:    float tolerance (default 1e-6); opts.decimals overrides with rounding
//
// Rules (from the brief):
//   - column names match case-insensitively; column ORDER matters
//   - row order matters only when orderMatters; otherwise compare as a multiset
//   - floats within tolerance; integer 3 == float 3.0
//   - NULL / None / NaN are equal to each other
//   - extra / missing columns fail with a clear message
//   - messages never print expected values

const NUM_RE = /^-?\d+(\.\d+)?$/;

export function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Uint8Array) return `<blob ${v.length}>`;
  if (typeof v === 'string') {
    if (v === 'NaN' || v === 'nan' || v === 'None') return null;
    return v;
  }
  return String(v);
}

function sameValue(a, b, tol, decimals) {
  a = normalizeValue(a);
  b = normalizeValue(b);
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') {
    if (decimals !== undefined) return a.toFixed(decimals) === b.toFixed(decimals);
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  // numeric strings vs numbers (e.g. SQLite returning '3.5' as TEXT after CAST)
  if (typeof a === 'number' && typeof b === 'string' && NUM_RE.test(b.trim())) return sameValue(a, Number(b), tol, decimals);
  if (typeof b === 'number' && typeof a === 'string' && NUM_RE.test(a.trim())) return sameValue(Number(a), b, tol, decimals);
  return a === b;
}

function rowKey(row, decimals) {
  return row.map((v) => {
    v = normalizeValue(v);
    if (v === null) return '\u0000';
    if (typeof v === 'number') return 'n' + v.toFixed(decimals === undefined ? 6 : decimals);
    if (typeof v === 'string' && NUM_RE.test(v.trim())) return 'n' + Number(v).toFixed(decimals === undefined ? 6 : decimals);
    return 's' + v;
  }).join('\u0001');
}

function sortedCopy(rows, decimals) {
  return rows.map((r) => ({ r, k: rowKey(r, decimals) })).sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0)).map((x) => x.r);
}

export function compareResults(expected, actual, opts = {}) {
  const tol = opts.tolerance ?? 1e-6;
  const decimals = opts.decimals;
  if (!actual || !Array.isArray(actual.columns)) {
    return { pass: false, message: 'No result to check. Run your code and make sure it produces a table (SQL: a SELECT; pandas: assign a DataFrame to `result`).' };
  }
  const expCols = expected.columns.map((c) => String(c).toLowerCase());
  const actCols = actual.columns.map((c) => String(c).toLowerCase());
  if (expCols.length !== actCols.length || expCols.some((c, i) => c !== actCols[i])) {
    const missing = expCols.filter((c) => !actCols.includes(c));
    const extra = actCols.filter((c) => !expCols.includes(c));
    let why;
    if (missing.length && extra.length) why = `Missing column(s): ${missing.join(', ')}. Unexpected column(s): ${extra.join(', ')}.`;
    else if (missing.length) why = `Missing column(s): ${missing.join(', ')}.`;
    else if (extra.length) why = `Unexpected column(s): ${extra.join(', ')}.`;
    else why = `Columns are right but in the wrong order. Expected order: ${expCols.join(', ')}.`;
    return { pass: false, message: `Wrong columns. ${why} Your columns: [${actual.columns.join(', ')}]. Expected ${expCols.length} column(s): [${expCols.join(', ')}].` };
  }
  if (expected.rows.length !== actual.rows.length) {
    return { pass: false, message: `Wrong row count: expected ${expected.rows.length} row(s), got ${actual.rows.length}.` };
  }
  const n = expected.rows.length;
  const firstDiff = (E, A) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < expCols.length; j++) {
        if (!sameValue(E[i][j], A[i][j], tol, decimals)) return { i, j };
      }
    }
    return null;
  };
  if (opts.orderMatters) {
    const d = firstDiff(expected.rows, actual.rows);
    if (!d) return { pass: true, message: `PASS — ${n} row(s), ${expCols.length} column(s), order verified.` };
    // was it only the order?
    const d2 = firstDiff(sortedCopy(expected.rows, decimals), sortedCopy(actual.rows, decimals));
    if (!d2) return { pass: false, message: `The rows are all correct, but the order is wrong (first difference at row ${d.i + 1}). This problem requires a specific ORDER BY / sort.` };
    return { pass: false, message: `Row ${d.i + 1} does not match in column "${actual.columns[d.j]}". Your row ${d.i + 1}: [${fmtRow(actual.rows[d.i])}].`, details: { row: d.i, col: d.j } };
  }
  const E = sortedCopy(expected.rows, decimals);
  const A = sortedCopy(actual.rows, decimals);
  const d = firstDiff(E, A);
  if (!d) return { pass: true, message: `PASS — ${n} row(s), ${expCols.length} column(s).` };
  return { pass: false, message: `Rows differ (compared as a set, sorted). First mismatch in column "${actual.columns[d.j]}" at sorted position ${d.i + 1}. Your row there: [${fmtRow(A[d.i])}].`, details: { row: d.i, col: d.j } };
}

export function fmtRow(row) {
  return row.map((v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(+v.toFixed(6)) : JSON.stringify(v))).join(', ');
}
