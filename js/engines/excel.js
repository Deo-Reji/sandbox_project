// Excel engine: HyperFormula workbook (via js/ui/grid.js) over data/excel_extract.json.
// A problem designates answer cells; Check Answer compares their computed values with the
// expected values (cached in problems/excel.json) and requires that they contain formulas.
import { fetchJson } from '../data.js';
import { expandRange, parseA1, formatValue } from '../ui/grid.js';

export function makeExcelEngine() {
  let extract = null;
  let grid = null;

  function buildSheets(problem) {
    const sheets = {};
    for (const [name, { columns, rows }] of Object.entries(extract)) {
      sheets[name] = [columns.slice(), ...rows.map((r) => r.slice())];
    }
    const setup = (problem && problem.setup) || {};
    const answers = [(setup.answersHeader || ['label', 'value']).slice()];
    for (const row of setup.answers || []) answers.push(row.slice());
    sheets.Answers = answers;
    for (const [ref, text] of Object.entries(setup.headers || {})) {
      const a = parseA1(ref);
      const sh = sheets[a.sheet];
      while (sh.length <= a.row) sh.push([]);
      while (sh[a.row].length <= a.col) sh[a.row].push(null);
      sh[a.row][a.col] = text;
    }
    return sheets;
  }

  function answerCells(problem) {
    if (!problem || !problem.answerCells) return [];
    const refs = Array.isArray(problem.answerCells) ? problem.answerCells : [problem.answerCells];
    const out = [];
    for (const r of refs) for (const c of expandRange(r)) out.push(`${c.sheet}!${colName(c.col)}${c.row + 1}`);
    return out;
  }
  function colName(c) { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

  function cellTable(problem) {
    const cells = answerCells(problem);
    const expected = new Map((problem.expected && problem.expected.cells) || []);
    const rows = cells.map((ref) => {
      const v = grid.getValueA1(ref);
      const shown = v && typeof v === 'object' && 'error' in v ? v.error : formatValue(v, null, null);
      const f = grid.formulaA1(ref);
      return [ref, shown, f === undefined ? '' : f, expected.has(ref) ? formatValue(expected.get(ref), null, null) : ''];
    });
    return { columns: ['cell', 'your value', 'formula', 'target'], rows, total: rows.length, truncated: false };
  }

  function sameCell(exp, act, problem) {
    if (exp === null || exp === undefined) return act === null || act === undefined || act === '';
    if (typeof exp === 'number') {
      if (typeof act !== 'number') return false;
      if (problem.decimals !== undefined) return exp.toFixed(problem.decimals) === act.toFixed(problem.decimals);
      return Math.abs(exp - act) <= 1e-6 * Math.max(1, Math.abs(exp), Math.abs(act));
    }
    if (typeof exp === 'boolean') return act === exp;
    if (problem.caseInsensitive) return String(act).toLowerCase() === String(exp).toLowerCase();
    return String(act) === String(exp);
  }

  return {
    id: 'excel',
    label: 'Excel',
    kind: 'grid',
    async init() { if (!extract) extract = await fetchJson('data/excel_extract.json'); },
    attach(g) { grid = g; },
    get grid() { return grid; },
    sheetNames() { return [...Object.keys(extract), 'Answers']; },
    loadProblem(problem) {
      const sheets = buildSheets(problem);
      const cells = answerCells(problem);
      const active = cells.length ? cells[0].split('!')[0] : 'Answers';
      grid.load(sheets, { activeSheet: active });
      if (cells.length) { const a = parseA1(cells[0]); grid.select(a.row, a.col); }
    },
    /** "Run" for Excel = show the answer cells beside their targets. */
    async run(_code, ctx = {}) {
      if (!ctx.problem) return { columns: [], rows: [], note: 'Sandbox: edit any cell. Try =AVERAGE(Students!F2:F121) in Answers!B2.' };
      return cellTable(ctx.problem);
    },
    async check(problem) {
      const cells = answerCells(problem);
      const expected = new Map((problem.expected && problem.expected.cells) || []);
      const result = cellTable(problem);
      let hard = 0, wrong = 0, errs = 0, firstMsg = null;
      for (const ref of cells) {
        const v = grid.getValueA1(ref);
        if (!grid.hasFormulaA1(ref)) {
          hard++;
          if (!firstMsg) firstMsg = `${ref} must contain a formula (starting with =), not a typed value${v === null || v === '' ? ' — it is empty' : ''}.`;
          continue;
        }
        if (v && typeof v === 'object' && 'error' in v) {
          errs++;
          if (!firstMsg) firstMsg = `${ref} shows ${v.error}${v.message ? ' — ' + v.message : ''}.`;
          continue;
        }
        if (!sameCell(expected.get(ref), v, problem)) {
          wrong++;
          if (!firstMsg) firstMsg = `${ref} evaluates to ${JSON.stringify(v)} which does not match the target${problem.decimals !== undefined ? ` (compared to ${problem.decimals} decimals)` : ''}.`;
        }
      }
      if (!hard && !wrong && !errs) return { pass: true, message: `PASS — ${cells.length} answer cell(s) correct and formula-driven.`, result };
      const parts = [];
      if (hard) parts.push(`${hard} cell(s) without a formula`);
      if (errs) parts.push(`${errs} cell(s) with errors`);
      if (wrong) parts.push(`${wrong} cell(s) with the wrong value`);
      return { pass: false, message: `${parts.join(', ')} out of ${cells.length}. First problem: ${firstMsg}`, result };
    },
    /** Used by the test harness and "Show solution": write the reference formulas. */
    applySolution(problem) {
      for (const [ref, formula] of problem.solution || []) grid.setCellA1(ref, formula);
      if (problem.solutionFill) grid.fillDown(problem.solutionFill);
    },
    setCells(list) { for (const [ref, content] of list) grid.setCellA1(ref, content); },
    fillDown(range) { grid.fillDown(range); },
    async reset() {},
    cancel() {},
  };
}

export default makeExcelEngine();
