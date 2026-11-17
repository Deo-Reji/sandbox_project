// Classic Web Worker hosting one sql.js (SQLite WASM) database.
// Messages in:  {id, type:'init', dbBytes?, pragmas?} | {id, type:'exec', sql, maxRows?} | {id, type:'introspect'}
// Messages out: {id, ok, ...}
// Running SQL off the main thread lets the page terminate a runaway query (e.g. an unbounded recursive CTE).
/* global importScripts, initSqlJs */
importScripts(new URL('../../vendor/sqljs/sql-wasm.js', self.location.href).href);

let SQL = null;
let db = null;

async function init(msg) {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: (f) => new URL('../../vendor/sqljs/' + f, self.location.href).href });
  }
  if (db) db.close();
  db = msg.dbBytes ? new SQL.Database(new Uint8Array(msg.dbBytes)) : new SQL.Database();
  for (const p of msg.pragmas || []) db.run(p);
}

function execAll(sql, maxRows) {
  // Returns the LAST result set produced by the script (like most SQL consoles).
  const results = db.exec(sql);
  if (!results.length) return { columns: [], rows: [], total: 0, statementsRun: true };
  const last = results[results.length - 1];
  const total = last.values.length;
  const rows = maxRows && total > maxRows ? last.values.slice(0, maxRows) : last.values;
  return { columns: last.columns, rows, total, truncated: !!(maxRows && total > maxRows) };
}

function introspect() {
  const tables = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const out = [];
  if (!tables.length) return out;
  for (const [name, sql] of tables[0].values) {
    const cols = db.exec(`PRAGMA table_info("${name}")`)[0]?.values || [];
    const fks = db.exec(`PRAGMA foreign_key_list("${name}")`)[0]?.values || [];
    const idx = db.exec(`PRAGMA index_list("${name}")`)[0]?.values || [];
    const indexes = idx.map((i) => ({
      name: i[1], unique: !!i[2], origin: i[3],
      columns: (db.exec(`PRAGMA index_info("${i[1]}")`)[0]?.values || []).map((c) => c[2]),
    }));
    const count = db.exec(`SELECT COUNT(*) FROM "${name}"`)[0].values[0][0];
    const preview = db.exec(`SELECT * FROM "${name}" LIMIT 10`);
    out.push({
      name, sql, rowCount: count,
      columns: cols.map((c) => ({ cid: c[0], name: c[1], type: c[2], notnull: !!c[3], dflt: c[4], pk: c[5] })),
      foreignKeys: fks.map((f) => ({ id: f[0], seq: f[1], table: f[2], from: f[3], to: f[4], onUpdate: f[5], onDelete: f[6] })),
      indexes,
      preview: preview.length ? { columns: preview[0].columns, rows: preview[0].values } : { columns: cols.map((c) => c[1]), rows: [] },
    });
  }
  return out;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      await init(msg);
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'exec') {
      self.postMessage({ id: msg.id, ok: true, result: execAll(msg.sql, msg.maxRows) });
    } else if (msg.type === 'introspect') {
      self.postMessage({ id: msg.id, ok: true, result: introspect() });
    } else {
      self.postMessage({ id: msg.id, ok: false, error: 'unknown message type ' + msg.type });
    }
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
