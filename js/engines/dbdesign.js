// Database Design engine: an EMPTY SQLite database the user builds with DDL.
// Run  = rebuild from scratch, show the resulting tables + ER diagram.
// Check = rebuild, then run the problem's hidden behavioural checks (js/checkers/ddl.js).
import { SqlClient, friendlySqlError } from './sqlclient.js';
import { runChecks } from '../checkers/ddl.js';

export function makeDbDesignEngine() {
  const client = new SqlClient({ dbUrl: null, pragmas: ['PRAGMA foreign_keys = ON'], timeoutMs: 15000, label: 'DDL' });
  let lastSchema = [];

  async function fresh() {
    await client.reset();
    await client.exec('PRAGMA foreign_keys = ON');
  }

  function summarize(schema) {
    const rows = schema.map((t) => [
      t.name,
      t.columns.map((c) => `${c.name} ${c.type || ''}${c.notnull ? ' NOT NULL' : ''}`.trim()).join(', '),
      t.columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name).join(', ') || '—',
      t.foreignKeys.map((f) => `${f.from} → ${f.table}(${f.to})${f.onDelete && f.onDelete !== 'NO ACTION' ? ' ON DELETE ' + f.onDelete : ''}`).join('; ') || '—',
      t.rowCount,
    ]);
    return { columns: ['table', 'columns', 'primary key', 'foreign keys', 'rows'], rows, total: rows.length, schema };
  }

  return {
    id: 'dbdesign',
    label: 'Database Design',
    kind: 'code',
    language: 'sql',
    async init() { await client.init(); },
    async run(code) {
      if (!code || !code.trim()) return { error: 'Nothing to run. Write some DDL first.', hint: 'The editor is empty.' };
      await fresh();
      let last = null;
      try {
        last = await client.exec(code);
      } catch (e) {
        const f = friendlySqlError(e.message);
        if (/TIMEOUT/.test(e.message)) client.ready = null;
        return { error: f.raw, hint: f.hint };
      }
      lastSchema = await client.introspect();
      const summary = summarize(lastSchema);
      if (last && last.columns && last.columns.length) {
        // the script ended with a query: show its rows, keep the schema for the diagram
        return { columns: last.columns, rows: last.rows, total: last.total, schema: lastSchema, note: `${lastSchema.length} table(s) in your database.` };
      }
      return { ...summary, note: lastSchema.length ? `${lastSchema.length} table(s) created.` : 'No tables were created.' };
    },
    async check(problem, code) {
      if (problem.kind === 'mc') {
        const idx = Number(code);
        if (!Number.isInteger(idx) || idx < 0) return { pass: false, message: 'Pick one of the options first.' };
        return idx === problem.answer
          ? { pass: true, message: 'PASS — correct. ' + (problem.explanation || '') }
          : { pass: false, message: 'FAIL — that is not the best answer. ' + (problem.hints && problem.hints[0] ? 'Hint: ' + problem.hints[0] : '') };
      }
      if (!code || !code.trim()) return { pass: false, message: 'The editor is empty. Write your CREATE TABLE statements first.' };
      await fresh();
      try { await client.exec(code); } catch (e) {
        const f = friendlySqlError(e.message);
        return { pass: false, message: 'Your DDL did not run: ' + (f.hint || f.raw), result: { error: f.raw, hint: f.hint } };
      }
      lastSchema = await client.introspect();
      if (!lastSchema.length) return { pass: false, message: 'Your script ran but created no tables.', result: summarize(lastSchema) };
      const verdict = await runChecks(problem.checks || [], {
        exec: (sql) => client.exec(sql),
        introspect: () => client.introspect(),
      });
      const after = await client.introspect();
      return { ...verdict, result: { ...summarize(after), note: `${verdict.passed}/${verdict.total} checks passed.` } };
    },
    lastSchema: () => lastSchema,
    async reset() { await fresh(); lastSchema = []; },
    cancel() { client._kill(); },
  };
}

export default makeDbDesignEngine();
