// pandas engine: Pyodide in a worker, lazy-loaded on first use, with a hard timeout.
import { CLEAN_TABLES, RAW_TABLES, RAW_REF_TABLES, PYODIDE_BASE, fetchText, loadCsvSet } from '../data.js';
import { compareResults } from '../checkers/compare.js';
import { DISPLAY_ROW_CAP } from './sql.js';

export const PANDAS_TIMEOUT_MS = 15000;

class PandasClient {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.nextId = 1;
    this.pending = new Map();
    this.onProgress = null;
    this.stage = 'idle';
  }

  _spawn() {
    this.worker = new Worker(new URL('./pandas.worker.js', import.meta.url));
    this.worker.onmessage = (ev) => {
      if (ev.data.type === 'progress') {
        this.stage = ev.data.stage;
        if (this.onProgress) this.onProgress(ev.data.stage);
        return;
      }
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      clearTimeout(p.timer);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    this.worker.onerror = (e) => {
      for (const [, p] of this.pending) p.reject(new Error('Python worker error: ' + (e.message || e)));
      this.pending.clear();
    };
  }

  _send(msg, timeoutMs) {
    const id = this.nextId++;
    msg.id = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill();
        reject(new Error(`TIMEOUT: your code ran for more than ${Math.round(timeoutMs / 1000)} s and was stopped. Python was restarted; the next run will reload it.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage(msg);
    });
  }

  kill() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
    this.stage = 'idle';
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('cancelled')); }
    this.pending.clear();
  }

  init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      if (this.onProgress) this.onProgress('Fetching dataset…');
      const [prelude, clean, raw, ref] = await Promise.all([
        fetchText(new URL('./pandas_prelude.py', import.meta.url).href),
        loadCsvSet(CLEAN_TABLES, 'data/clean'),
        loadCsvSet(RAW_TABLES, 'data/messy'),
        loadCsvSet(RAW_REF_TABLES, 'data/clean'),
      ]);
      this._spawn();
      await this._send({ type: 'init', pyodideBase: PYODIDE_BASE, prelude, clean, raw: { raw, ref } }, 240000);
    })();
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  async exec(code, frameset = 'clean', timeoutMs = PANDAS_TIMEOUT_MS) {
    await this.init();
    return this._send({ type: 'exec', code, frameset }, timeoutMs);
  }
}

export const pandasClient = new PandasClient();

export function friendlyPyError(msg, tableNames = []) {
  const m = String(msg);
  let hint = '';
  let x;
  if ((x = m.match(/^NameError: name '(\w+)' is not defined/))) {
    hint = tableNames.includes(x[1]) ? `"${x[1]}" is not loaded in this view.` : `"${x[1]}" is not defined. Table names are preloaded as DataFrames (e.g. students, enrollments); check the Schema drawer. pd and np are also available.`;
  } else if ((x = m.match(/^KeyError: (.+?)( \(line \d+\))?$/))) {
    hint = `Column or key ${x[1]} was not found. Check the column names in the Schema drawer; after a merge, clashing names get _x / _y suffixes.`;
  } else if (/^SyntaxError/.test(m)) hint = 'Python syntax error. Check indentation, brackets and quotes.';
  else if (/^IndentationError/.test(m)) hint = 'Indentation error: lines inside a block must be indented consistently.';
  else if (/^AttributeError: 'DataFrame' object has no attribute/.test(m)) hint = 'That is not a DataFrame method or column. Column names with spaces/punctuation need df["name"] syntax.';
  else if (/^AttributeError/.test(m)) hint = 'That attribute/method does not exist on this object. Check the pandas tutorial for the right method name.';
  else if (/^MergeError/.test(m)) hint = 'The merge keys do not line up. Check on= / left_on= / right_on= and the key dtypes.';
  else if (/^ValueError: Length of values/.test(m)) hint = 'You are assigning a column whose length does not match the DataFrame.';
  else if (/^TypeError/.test(m)) hint = 'A type mismatch — e.g. comparing strings with numbers, or passing the wrong argument type.';
  else if (/^PermissionError/.test(m)) hint = 'File and network access are disabled here. Everything you need is preloaded.';
  else if (/TIMEOUT/.test(m)) hint = 'Your code did not finish in 15 s. An infinite loop or an accidental cross join is the usual cause.';
  return { hint, raw: m };
}

export function makePandasEngine({ id = 'pandas', frameset = 'clean', label = 'pandas', tables = CLEAN_TABLES } = {}) {
  async function runRaw(code) {
    if (!code || !code.trim()) return { error: 'Nothing to run. Write some code first.', hint: 'The editor is empty.' };
    try {
      const r = await pandasClient.exec(code, frameset);
      if (r.error) {
        const f = friendlyPyError(r.error, tables);
        return { error: f.raw, hint: f.hint, stdout: r.stdout };
      }
      const t = r.table || { columns: [], rows: [] };
      return { columns: t.columns, rows: t.rows, total: t.rows.length, stdout: r.stdout, hasResult: r.has_result };
    } catch (e) {
      const f = friendlyPyError(e.message, tables);
      return { error: f.raw, hint: f.hint };
    }
  }
  return {
    id,
    label,
    kind: 'code',
    language: 'python',
    frameset,
    tables,
    set onProgress(fn) { pandasClient.onProgress = fn; },
    get stage() { return pandasClient.stage; },
    async init() { await pandasClient.init(); },
    async run(code) {
      const r = await runRaw(code);
      if (r.error) return r;
      const truncated = r.rows.length > DISPLAY_ROW_CAP;
      return { ...r, rows: truncated ? r.rows.slice(0, DISPLAY_ROW_CAP) : r.rows, truncated, note: r.hasResult ? '' : 'No `result` variable was assigned. Assign your final DataFrame to `result` so it can be checked.' };
    },
    async check(problem, code) {
      const r = await runRaw(code);
      if (r.error) return { pass: false, message: 'Your code raised an error: ' + (r.hint || r.error), result: r };
      if (!r.hasResult) return { pass: false, message: 'No `result` variable found. Assign your final DataFrame to a variable named result.', result: r };
      const cmp = compareResults(problem.expected, r, { orderMatters: !!problem.orderMatters, decimals: problem.decimals });
      const truncated = r.rows.length > DISPLAY_ROW_CAP;
      return { ...cmp, result: { ...r, rows: truncated ? r.rows.slice(0, DISPLAY_ROW_CAP) : r.rows, truncated } };
    },
    async reset() { pandasClient.kill(); await pandasClient.init(); },
    cancel() { pandasClient.kill(); },
  };
}

export default makePandasEngine();
