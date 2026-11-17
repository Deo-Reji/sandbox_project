// Main-thread client for sql.worker.js. One instance = one database.
// Supports timeouts: a query that overruns is killed by terminating the worker; the
// database is rebuilt from the cached bytes on the next call.

export class SqlClient {
  constructor({ dbUrl = null, pragmas = [], timeoutMs = 15000, label = 'SQL' } = {}) {
    this.dbUrl = dbUrl;
    this.pragmas = pragmas;
    this.timeoutMs = timeoutMs;
    this.label = label;
    this.worker = null;
    this.ready = null;
    this.bytes = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async _fetchBytes() {
    if (!this.dbUrl) return null;
    if (this.bytes) return this.bytes;
    const res = await fetch(this.dbUrl);
    if (!res.ok) throw new Error(`Could not load ${this.dbUrl} (${res.status}). If you opened index.html via file://, serve the folder with "python -m http.server" instead.`);
    this.bytes = await res.arrayBuffer();
    return this.bytes;
  }

  _spawn() {
    this.worker = new Worker(new URL('./sql.worker.js', import.meta.url));
    this.worker.onmessage = (ev) => {
      const { id } = ev.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = (e) => {
      for (const [, p] of this.pending) p.reject(new Error('Worker error: ' + (e.message || e)));
      this.pending.clear();
    };
  }

  init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const bytes = await this._fetchBytes();
      this._spawn();
      // copy the buffer so the cached bytes stay reusable after transfer
      await this._send({ type: 'init', dbBytes: bytes ? bytes.slice(0) : null, pragmas: this.pragmas }, 60000);
    })();
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  _send(msg, timeoutMs) {
    const id = this.nextId++;
    msg.id = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this._kill();
        reject(new Error(`TIMEOUT: the ${this.label} query ran for more than ${Math.round(timeoutMs / 1000)} s and was cancelled. The database was reset.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage(msg);
    });
  }

  _kill() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('cancelled')); }
    this.pending.clear();
  }

  /** Cancel whatever is running and reload the pristine database. */
  async reset() {
    this._kill();
    await this.init();
  }

  async exec(sql, { maxRows = null, timeoutMs = this.timeoutMs } = {}) {
    await this.init();
    return this._send({ type: 'exec', sql, maxRows }, timeoutMs);
  }

  async introspect() {
    await this.init();
    return this._send({ type: 'introspect' }, 30000);
  }
}

/** Split a SQL script into statements (ignores ; inside quotes/comments). */
export function splitStatements(sql) {
  const out = [];
  let cur = '', i = 0, q = null;
  while (i < sql.length) {
    const ch = sql[i], nx = sql[i + 1];
    if (!q && ch === '-' && nx === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (!q && ch === '/' && nx === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue; }
    if (q) { cur += ch; if (ch === q) q = null; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; i++; continue; }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** True when every statement is a read-only SELECT / WITH ... SELECT. */
export function isReadOnlyScript(sql) {
  const stmts = splitStatements(sql);
  if (!stmts.length) return false;
  return stmts.every((s) => {
    const first = s.replace(/^\(+/, '').split(/\s+/)[0].toUpperCase();
    if (first === 'SELECT' || first === 'VALUES') return true;
    if (first === 'WITH') {
      // the final body must be a SELECT: crude but effective (no INSERT/UPDATE/DELETE/CREATE/DROP tokens outside quotes)
      const stripped = s.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
      // REPLACE(...) the function is fine; REPLACE INTO the statement is not
      return !/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|ATTACH|PRAGMA|VACUUM)\b|\bREPLACE\s+INTO\b/i.test(stripped);
    }
    return false;
  });
}

/** Plain-language explanation for common SQLite errors. */
export function friendlySqlError(msg) {
  const m = String(msg);
  let hint = '';
  let x;
  if ((x = m.match(/no such table: (\S+)/))) hint = `There is no table called "${x[1]}". Open the Schema drawer to see the table names.`;
  else if ((x = m.match(/no such column: (\S+)/))) hint = `There is no column called "${x[1]}". Check the spelling and the table alias; columns live in the Schema drawer.`;
  else if (/ambiguous column name: (\S+)/.test(m)) hint = `A column name appears in more than one joined table. Prefix it with the table name or alias (e.g. s.student_id).`;
  else if (/near "(.*?)": syntax error/.test(m)) hint = `SQL syntax error near ${m.match(/near "(.*?)"/)[1] ? '"' + m.match(/near "(.*?)"/)[1] + '"' : 'that token'}. Check for a missing comma, keyword, or parenthesis.`;
  else if (/incomplete input/.test(m)) hint = 'The statement ends too early. Did you forget to close a parenthesis or finish a clause?';
  else if (/no such function: (\S+)/.test(m)) hint = `SQLite does not have the function "${m.match(/no such function: (\S+)/)[1]}". See the SQL tutorial for SQLite equivalents (e.g. no MEDIAN, use strftime instead of YEAR).`;
  else if (/misuse of (window|aggregate) function/.test(m)) hint = 'Aggregate/window functions cannot be used there. Move it into SELECT or use a subquery/CTE.';
  else if (/GROUP BY/i.test(m)) hint = 'Check the GROUP BY clause: every non-aggregated SELECT column should appear in it.';
  else if (/TIMEOUT/.test(m)) hint = 'The query did not finish in time. A recursive CTE without a stopping condition or a huge cross join is the usual cause.';
  else if (/UNIQUE constraint failed/.test(m)) hint = 'A UNIQUE / PRIMARY KEY constraint rejected a duplicate value.';
  else if (/NOT NULL constraint failed/.test(m)) hint = 'A NOT NULL column received NULL.';
  else if (/FOREIGN KEY constraint failed/.test(m)) hint = 'A foreign key points at a row that does not exist.';
  else if (/CHECK constraint failed/.test(m)) hint = 'A CHECK constraint rejected the value.';
  return { hint, raw: m };
}
