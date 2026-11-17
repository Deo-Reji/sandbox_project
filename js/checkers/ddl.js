// Behavioural checks for the Database Design track.
// A problem's hidden `checks` run after the user's DDL in a fresh database with foreign keys ON.
// Check types:
//   sql_ok    {sql, msg}            statement must succeed
//   sql_fail  {sql, msg}            statement must be rejected by a constraint
//   query     {sql, equals, msg}    first cell of the result must equal `equals`
//   schema    {check, ..., msg}     structural assertion on PRAGMA output (see schemaCheck)
// Any valid design passes: table/column names are only required when the prompt states them.

function has(t, col) { return t.columns.some((c) => c.name.toLowerCase() === col.toLowerCase()); }
function findTable(schema, name) { return schema.find((t) => t.name.toLowerCase() === String(name).toLowerCase()); }
function tablesWith(schema, column) { return schema.filter((t) => has(t, column)); }
function pkCols(t) { return t.columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name.toLowerCase()); }
function sameSet(a, b) { const A = [...a].map((x) => x.toLowerCase()).sort(), B = [...b].map((x) => x.toLowerCase()).sort(); return A.length === B.length && A.every((x, i) => x === B[i]); }

export function schemaCheck(schema, chk) {
  const scope = chk.table ? [findTable(schema, chk.table)].filter(Boolean) : schema;
  switch (chk.check) {
    case 'table_exists': return !!findTable(schema, chk.table);
    case 'tables_min': return schema.length >= chk.n;
    case 'column_exists': return scope.some((t) => has(t, chk.column));
    case 'not_null': return scope.some((t) => t.columns.some((c) => c.name.toLowerCase() === chk.column.toLowerCase() && (c.notnull || c.pk > 0)));
    case 'pk': return scope.some((t) => sameSet(pkCols(t), chk.columns));
    case 'pk_min_cols': return scope.some((t) => (!chk.column || has(t, chk.column)) && pkCols(t).length >= chk.n);
    case 'unique_on': return scope.some((t) => t.indexes.some((i) => i.unique && sameSet(i.columns, chk.columns)) || sameSet(pkCols(t), chk.columns));
    case 'fk_exists': return scope.some((t) => t.foreignKeys.some((f) =>
      (!chk.to || f.table.toLowerCase() === chk.to.toLowerCase()) &&
      (!chk.column || f.from.toLowerCase() === chk.column.toLowerCase()) &&
      (!chk.onDelete || String(f.onDelete).toUpperCase() === chk.onDelete.toUpperCase())));
    case 'fk_self': return scope.some((t) => t.foreignKeys.some((f) => f.table.toLowerCase() === t.name.toLowerCase()));
    case 'index_on': return scope.some((t) => t.indexes.some((i) => i.origin === 'c' && i.columns.map((c) => c.toLowerCase()).includes(chk.column.toLowerCase())));
    case 'columns_not_together': return !schema.some((t) => chk.columns.every((c) => has(t, c)));
    case 'column_type': return scope.some((t) => t.columns.some((c) => c.name.toLowerCase() === chk.column.toLowerCase() && String(c.type).toUpperCase().includes(chk.type_like.toUpperCase())));
    case 'default_exists': return scope.some((t) => t.columns.some((c) => c.name.toLowerCase() === chk.column.toLowerCase() && c.dflt !== null && c.dflt !== undefined));
    case 'column_count_max': return scope.every((t) => !has(t, chk.column) || t.columns.length <= chk.n);
    case 'table_count_with_column': return tablesWith(schema, chk.column).length >= (chk.min ?? 1);
    default: throw new Error('Unknown schema check: ' + chk.check);
  }
}

/**
 * Run all checks. `exec(sql)` must return a promise of {columns, rows} and reject on SQL errors.
 * `introspect()` returns the schema list. Returns {pass, message, passed, total}.
 */
export async function runChecks(checks, { exec, introspect }) {
  let schema = await introspect();
  let i = 0;
  for (const chk of checks) {
    i++;
    const label = `Check ${i}/${checks.length}`;
    if (chk.type === 'sql_ok') {
      try { await exec(chk.sql); } catch (e) {
        return { pass: false, message: `${label} failed: ${chk.msg || 'this statement should have succeeded'} — but it was rejected: ${e.message}`, passed: i - 1, total: checks.length };
      }
      schema = null;
    } else if (chk.type === 'sql_fail') {
      let ok = false;
      try { await exec(chk.sql); } catch (e) { ok = true; }
      if (!ok) return { pass: false, message: `${label} failed: ${chk.msg || 'this statement should have been rejected'} — but it succeeded.`, passed: i - 1, total: checks.length };
    } else if (chk.type === 'query') {
      let r;
      try { r = await exec(chk.sql); } catch (e) {
        return { pass: false, message: `${label} failed: ${chk.msg || 'query could not run'} — ${e.message}`, passed: i - 1, total: checks.length };
      }
      const v = r.rows.length ? r.rows[0][0] : null;
      const eq = typeof chk.equals === 'number' ? Math.abs(Number(v) - chk.equals) < 1e-9 : String(v) === String(chk.equals);
      if (!eq) return { pass: false, message: `${label} failed: ${chk.msg || 'unexpected query result'} (got ${JSON.stringify(v)}).`, passed: i - 1, total: checks.length };
    } else if (chk.type === 'schema') {
      if (!schema) schema = await introspect();
      let ok;
      try { ok = schemaCheck(schema, chk); } catch (e) { return { pass: false, message: `${label} could not run: ${e.message}`, passed: i - 1, total: checks.length }; }
      if (!ok) return { pass: false, message: `${label} failed: ${chk.msg || chk.check}.`, passed: i - 1, total: checks.length };
    } else {
      return { pass: false, message: `${label}: unknown check type ${chk.type}`, passed: i - 1, total: checks.length };
    }
  }
  return { pass: true, message: `PASS — all ${checks.length} behavioural checks passed.`, passed: checks.length, total: checks.length };
}
