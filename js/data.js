// Dataset manifest: which CSVs exist. Everything in the app (SQL, pandas, Excel, Exploration)
// derives from data/clean/*.csv produced by data/generate.py.
export const CLEAN_TABLES = [
  'colleges', 'buildings', 'departments', 'rooms', 'employees', 'faculty_details', 'majors', 'minors',
  'students', 'student_majors', 'terms', 'courses', 'course_prerequisites', 'sections', 'enrollments',
  'student_orgs', 'org_memberships', 'housing_assignments', 'scholarships', 'financial_aid', 'tuition_payments',
];
export const RAW_TABLES = ['students_raw', 'employees_raw', 'enrollments_raw', 'payments_raw'];
// clean reference tables also available on the Exploration tab (for orphan checks etc.)
export const RAW_REF_TABLES = ['students', 'employees', 'sections', 'departments', 'terms', 'courses'];

export const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';

const textCache = new Map();
export async function fetchText(url) {
  if (textCache.has(url)) return textCache.get(url);
  const p = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not load ${url} (${r.status}). Serve the folder over HTTP (python -m http.server); file:// will not work.`);
    return r.text();
  });
  textCache.set(url, p);
  p.catch(() => textCache.delete(url));
  return p;
}

export async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

export async function loadCsvSet(names, dir) {
  const out = {};
  await Promise.all(names.map(async (n) => { out[n] = await fetchText(`${dir}/${n}.csv`); }));
  return out;
}
