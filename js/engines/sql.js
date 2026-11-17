// SQL practice engine: sql.js over the prebuilt university.sqlite, running in a worker.
import { SqlClient, isReadOnlyScript, friendlySqlError } from './sqlclient.js';
import { compareResults } from '../checkers/compare.js';

export const DISPLAY_ROW_CAP = 200;

export function makeSqlEngine({ id = 'sql', dbUrl = 'data/university.sqlite', label = 'SQL' } = {}) {
  const client = new SqlClient({ dbUrl, pragmas: ['PRAGMA foreign_keys = ON'], timeoutMs: 15000, label });
  let schemaCache = null;

  async function runRaw(code, { maxRows = null, readOnly = false } = {}) {
    if (!code || !code.trim()) return { error: 'Nothing to run. Write a query first.', hint: 'The editor is empty.' };
    if (readOnly && !isReadOnlyScript(code)) {
      return { error: 'Only SELECT / WITH ... SELECT statements are allowed in graded problems.', hint: 'Use the Sandbox if you want to try INSERT/UPDATE/CREATE.' };
    }
    try {
      const r = await client.exec(code, { maxRows });
      return r;
    } catch (e) {
      const f = friendlySqlError(e.message);
      if (/TIMEOUT/.test(e.message)) client.ready = null;
      return { error: f.raw, hint: f.hint };
    }
  }

  return {
    id,
    label,
    kind: 'code',
    language: 'sql',
    async init() { await client.init(); },
    async run(code, ctx = {}) {
      const r = await runRaw(code, { maxRows: DISPLAY_ROW_CAP, readOnly: !!ctx.graded });
      if (!r.error && ctx.sandbox) schemaCache = null; // DDL may have changed things
      return r;
    },
    async check(problem, code) {
      const r = await runRaw(code, { readOnly: true });
      if (r.error) return { pass: false, message: 'Your query did not run: ' + r.error + (r.hint ? ' — ' + r.hint : ''), result: r };
      const cmp = compareResults(problem.expected, r, { orderMatters: !!problem.orderMatters, decimals: problem.decimals });
      return { ...cmp, result: { ...r, rows: r.rows.slice(0, DISPLAY_ROW_CAP), truncated: r.rows.length > DISPLAY_ROW_CAP } };
    },
    async schema(force = false) {
      if (!schemaCache || force) schemaCache = await client.introspect();
      return schemaCache;
    },
    async reset() { schemaCache = null; await client.reset(); },
    cancel() { client._kill(); },
  };
}

export default makeSqlEngine();
