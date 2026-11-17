// DataLab Sandbox — definition-of-done harness.
// For every problem in every track: inject the reference solution, click Check Answer, assert PASS;
// submit deliberately wrong answers and assert FAIL with a sensible message; assert results are
// non-empty, deterministic across two checks, and that SELECT * (or a whole table) does not pass.
// Also runs every tutorial example and the edge cases listed in the brief, then prints a summary table.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const TABLES = ['colleges', 'buildings', 'departments', 'rooms', 'employees', 'faculty_details', 'majors', 'minors', 'students', 'student_majors', 'terms', 'courses', 'course_prerequisites', 'sections', 'enrollments', 'student_orgs', 'org_memberships', 'housing_assignments', 'scholarships', 'financial_aid', 'tuition_payments', 'students_raw', 'employees_raw', 'enrollments_raw', 'payments_raw'];

const summary = [];
const record = (track, id, pass, wrongRejected, note = '') => summary.push({ track, id, pass, wrongRejected, note });

test.describe.configure({ mode: 'serial' });

// ----------------------------------------------------------------------------- helpers
async function openApp(page, hash = '#sql/tutorial') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/' + hash);
  await page.waitForFunction(() => window.__sandbox && window.__sandbox.state.track);
  await page.evaluate(() => window.__sandbox.ready);
  await page.evaluate(() => window.__sandbox.resetProgress());
  return errors;
}

async function gotoProblem(page, track, item, id) {
  await page.evaluate((h) => window.__sandbox.goto(h), `#${track}/${item}`);
  await page.waitForFunction((pid) => window.__sandbox.problem() && window.__sandbox.problem().id === pid, id, { timeout: 60000 });
}

async function gotoSandbox(page, track) {
  await page.evaluate((h) => window.__sandbox.goto(h), `#${track}/sandbox`);
  await page.waitForFunction((t) => location.hash === `#${t}/sandbox` && window.__sandbox.state.track.id === t && !window.__sandbox.problem(), track, { timeout: 60000 });
}

async function clickCheck(page, timeout = 240000) {
  await page.evaluate(() => { window.__sandbox.state.lastCheck = null; });
  await page.click('#btn-check');
  await page.waitForFunction(() => window.__sandbox.last().check, null, { timeout });
  const v = await page.evaluate(() => window.__sandbox.last().check);
  const banner = await page.locator('#verdict').innerText();
  expect(banner.startsWith(v.pass ? 'PASS' : 'FAIL')).toBeTruthy();
  return v;
}

async function runCode(page, code, timeout = 240000) {
  await page.evaluate((c) => { window.__sandbox.state.lastResult = null; window.__sandbox.setCode(c); }, code);
  await page.evaluate(() => window.__sandbox.run());
  await page.waitForFunction(() => window.__sandbox.last().result, null, { timeout });
  return page.evaluate(() => window.__sandbox.last().result);
}

function firstTable(code) {
  const ids = code.match(/\b[a-z_]+\b/g) || [];
  return ids.find((w) => TABLES.includes(w)) || 'students';
}

function sqlWrongVariants(p, sol) {
  const n = p.expected.rows.length;
  const cols = p.expected.columns;
  const v = [];
  if (n > 1) v.push({ name: 'off-by-one rows', code: `SELECT * FROM (${sol}) LIMIT ${n - 1}`, re: /row count/i });
  if (cols.length > 1) v.push({ name: 'missing column', code: `SELECT ${cols.slice(0, -1).map((c) => `"${c}"`).join(', ')} FROM (${sol})`, re: /column/i });
  if (p.orderMatters && n > 1) v.push({ name: 'wrong order', code: `SELECT * FROM (${sol}) ORDER BY 1 DESC, 2 DESC`, re: /order|does not match|differ/i });
  v.push({ name: 'SELECT *', code: `SELECT * FROM ${firstTable(sol)}`, re: /column|row count/i });
  return v;
}

function pandasWrongVariants(p, sol) {
  const n = p.expected.rows.length;
  const cols = p.expected.columns;
  const v = [];
  if (n > 1) v.push({ name: 'off-by-one rows', code: `${sol}\nresult = result.iloc[:-1]`, re: /row count/i });
  if (cols.length > 1) v.push({ name: 'missing column', code: `${sol}\nresult = result.drop(columns=[result.columns[-1]])`, re: /column/i });
  if (p.orderMatters && n > 1) v.push({ name: 'wrong order', code: `${sol}\nresult = result.iloc[::-1]`, re: /order|does not match|differ/i });
  v.push({ name: 'whole table', code: `result = ${firstTable(sol)}`, re: /column|row count/i });
  return v;
}

function stripConstraints(ddl) {
  let s = ddl;
  // remove CHECK (...) with balanced parentheses
  let idx;
  while ((idx = s.search(/\bCHECK\s*\(/i)) >= 0) {
    let i = s.indexOf('(', idx), depth = 0, j = i;
    for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')') { depth--; if (depth === 0) break; } }
    s = s.slice(0, idx) + s.slice(j + 1);
  }
  s = s.replace(/\bREFERENCES\s+\w+\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION))*/gi, '');
  s = s.replace(/\bFOREIGN\s+KEY\s*\([^)]*\)/gi, '');
  s = s.replace(/,\s*PRIMARY\s+KEY\s*\([^)]*\)/gi, '');
  s = s.replace(/,\s*UNIQUE\s*\([^)]*\)/gi, '');
  s = s.replace(/\bNOT\s+NULL\b/gi, '').replace(/\bUNIQUE\b/gi, '');
  s = s.replace(/,(\s*\))/g, '$1').replace(/,\s*,/g, ',');
  return s;
}

async function expectFail(page, name, re, applyWrong) {
  await applyWrong();
  const v = await clickCheck(page);
  const ok = !v.pass && re.test(v.message);
  if (!ok) console.log(`   !! wrong answer "${name}" was not rejected sensibly:`, v.pass, v.message);
  return ok;
}

// ----------------------------------------------------------------------------- SQL / pandas / exploration
async function codeTrack(page, track, listKey, modes) {
  const problems = readJson(`problems/${track}.json`);
  for (const [i, p] of problems.entries()) {
    const item = track === 'exploration' ? `challenge-${i + 1}` : `${p.difficulty}-${problems.filter((q) => q.difficulty === p.difficulty).indexOf(p) + 1}`;
    expect(p.expected && p.expected.rows.length, `${p.id} expected non-empty`).toBeGreaterThan(0);
    for (const mode of modes) {
      await gotoProblem(page, track, item, p.id);
      if (mode) await page.evaluate((m) => window.__sandbox.setMode(m), mode);
      const sol = mode ? p.solution[mode] : p.solution;
      const lang = mode || track;
      // reference solution passes
      await page.evaluate((c) => window.__sandbox.setCode(c), sol);
      const v1 = await clickCheck(page);
      const rows1 = await page.evaluate(() => JSON.stringify(window.__sandbox.last().result.rows));
      // deterministic across two checks
      const v2 = await clickCheck(page);
      const rows2 = await page.evaluate(() => JSON.stringify(window.__sandbox.last().result.rows));
      const pass = v1.pass && v2.pass && rows1 === rows2;
      if (!pass) console.log(`   !! ${p.id} [${lang}]`, v1.message, v2.message);
      // solved tick + show-solution enabled
      expect(await page.locator('#sidebar .pill.current').innerText()).toContain('✓');
      expect(await page.locator('#btn-solution').isDisabled()).toBe(false);
      // wrong answers are rejected
      const variants = lang === 'pandas' ? pandasWrongVariants(p, sol) : sqlWrongVariants(p, sol);
      let rejected = true;
      for (const w of variants) {
        const ok = await expectFail(page, w.name, w.re, () => page.evaluate((c) => window.__sandbox.setCode(c), w.code));
        rejected = rejected && ok;
      }
      record(mode ? `${track}/${mode}` : track, p.id, pass, rejected);
      expect(pass, `${p.id} [${lang}] reference solution must PASS`).toBe(true);
      expect(rejected, `${p.id} [${lang}] wrong answers must FAIL`).toBe(true);
    }
  }
}

test('SQL problems: reference passes, wrong answers fail', async ({ page }) => {
  const errors = await openApp(page);
  await codeTrack(page, 'sql', 'sql', [null]);
  expect(errors).toEqual([]);
});

test('pandas problems: reference passes, wrong answers fail', async ({ page }) => {
  const errors = await openApp(page);
  await codeTrack(page, 'pandas', 'pandas', [null]);
  expect(errors).toEqual([]);
});

test('Exploration challenges in SQL and pandas', async ({ page }) => {
  const errors = await openApp(page);
  await codeTrack(page, 'exploration', 'exploration', ['sql', 'pandas']);
  expect(errors).toEqual([]);
});

// ----------------------------------------------------------------------------- Excel
test('Excel problems: formulas pass, hard-coded and wrong values fail', async ({ page }) => {
  const errors = await openApp(page);
  const problems = readJson('problems/excel.json');
  for (const p of problems) {
    const item = `${p.difficulty}-${problems.filter((q) => q.difficulty === p.difficulty).indexOf(p) + 1}`;
    expect(p.expected.cells.length, `${p.id} expected non-empty`).toBeGreaterThan(0);
    await gotoProblem(page, 'excel', item, p.id);
    await page.waitForFunction(() => window.__sandbox.state.grid && window.__sandbox.state.grid.hf && document.querySelectorAll('.xl-tab').length > 3);
    await page.evaluate(() => window.__sandbox.applySolution());
    const v1 = await clickCheck(page);
    const rows1 = await page.evaluate(() => JSON.stringify(window.__sandbox.last().result.rows));
    const v2 = await clickCheck(page);
    const rows2 = await page.evaluate(() => JSON.stringify(window.__sandbox.last().result.rows));
    const pass = v1.pass && v2.pass && rows1 === rows2;
    if (!pass) console.log(`   !! ${p.id}`, v1.message);
    const [firstRef, firstVal] = p.expected.cells[0];
    let rejected = true;
    // hard-coded value in an answer cell
    rejected = (await expectFail(page, 'hard-coded value', /formula/i, () => page.evaluate(([r, v]) => window.__sandbox.setCells([[r, v === '' ? "'" : String(v)]]), [firstRef, firstVal]))) && rejected;
    // wrong formula
    await page.evaluate(() => window.__sandbox.applySolution());
    rejected = (await expectFail(page, 'wrong formula', /match|wrong value|error/i, () => page.evaluate((r) => window.__sandbox.setCells([[r, '=1/3']]), firstRef))) && rejected;
    // formula evaluating to an error
    rejected = (await expectFail(page, 'error formula', /error|#/i, () => page.evaluate((r) => window.__sandbox.setCells([[r, '=NOPE(1)']]), firstRef))) && rejected;
    record('excel', p.id, pass, rejected);
    expect(pass, `${p.id} reference formulas must PASS`).toBe(true);
    expect(rejected, `${p.id} wrong answers must FAIL`).toBe(true);
  }
  expect(errors).toEqual([]);
});

// ----------------------------------------------------------------------------- Database design
test('Database design: solutions pass hidden checks, weakened schemas fail', async ({ page }) => {
  const errors = await openApp(page);
  const problems = readJson('problems/dbdesign.json');
  for (const p of problems) {
    const item = `${p.difficulty}-${problems.filter((q) => q.difficulty === p.difficulty).indexOf(p) + 1}`;
    await gotoProblem(page, 'dbdesign', item, p.id);
    let pass, rejected = true;
    if (p.kind === 'mc') {
      await page.evaluate((i) => window.__sandbox.selectOption(i), p.answer);
      pass = (await clickCheck(page)).pass;
      const wrong = p.options.findIndex((_, i) => i !== p.answer);
      rejected = await expectFail(page, 'wrong option', /not the best|FAIL/i, () => page.evaluate((i) => window.__sandbox.selectOption(i), wrong));
    } else {
      expect(p.checks.length, `${p.id} has checks`).toBeGreaterThan(2);
      await page.evaluate((c) => window.__sandbox.setCode(c), p.solution);
      const v1 = await clickCheck(page);
      const v2 = await clickCheck(page);
      pass = v1.pass && v2.pass;
      if (!pass) console.log(`   !! ${p.id}`, v1.message);
      // Run shows an ER diagram of what was built
      await runCode(page, p.solution);
      expect(await page.locator('#output svg').count()).toBeGreaterThan(0);
      rejected = (await expectFail(page, 'constraints stripped', /Check \d+|failed|no tables|did not run/i, () => page.evaluate((c) => window.__sandbox.setCode(c), stripConstraints(p.solution)))) && rejected;
      rejected = (await expectFail(page, 'unrelated table', /Check \d+|failed|no tables|did not run/i, () => page.evaluate(() => window.__sandbox.setCode('CREATE TABLE wrong (x INTEGER);')))) && rejected;
    }
    record('dbdesign', p.id, pass, rejected);
    expect(pass, `${p.id} reference DDL must PASS`).toBe(true);
    expect(rejected, `${p.id} weakened DDL must FAIL`).toBe(true);
  }
  expect(errors).toEqual([]);
});

// ----------------------------------------------------------------------------- Tutorials
test('Every tutorial example runs without error', async ({ page }) => {
  const errors = await openApp(page);
  for (const track of ['sql', 'pandas', 'excel', 'dbdesign', 'exploration']) {
    const t = readJson(`tutorials/${track}.json`);
    let n = 0;
    for (const sec of t.sections) {
      for (const ex of sec.examples || []) {
        n++;
        const modes = track === 'exploration' ? ['sql', 'pandas'] : [null];
        for (const mode of modes) {
          const code = typeof ex.code === 'object' ? ex.code[mode] : ex.code;
          if (!code) continue;
          await gotoSandbox(page, track);
          if (mode) await page.evaluate((m) => window.__sandbox.setMode(m), mode);
          if (track === 'excel') {
            await page.waitForFunction(() => window.__sandbox.state.grid && window.__sandbox.state.grid.hf);
            await page.evaluate((c) => window.__sandbox.setCells([['Answers!B2', c]]), code);
            const v = await page.evaluate(() => window.__sandbox.state.grid.getValueA1('Answers!B2'));
            const isErr = v && typeof v === 'object' && 'error' in v;
            if (isErr) console.log(`   !! excel example "${ex.label}" ->`, v);
            expect(isErr, `excel example ${ex.label}`).toBe(false);
          } else {
            const r = await runCode(page, code);
            if (ex.expectError) { expect(!!r.error, `example ${ex.label} should error`).toBe(true); continue; }
            if (r.error) console.log(`   !! ${track} example "${ex.label}" [${mode || ''}] ->`, r.error);
            expect(r.error, `${track} example ${ex.label}`).toBeFalsy();
          }
        }
      }
    }
    record('tutorial', `${track} (${n} examples)`, true, null);
  }
  // the real "Try in sandbox" button loads a snippet into the sandbox and runs it
  await page.evaluate(() => window.__sandbox.goto('#sql/tutorial'));
  await page.locator('#view-tutorial button.try').first().click();
  await page.waitForFunction(() => location.hash === '#sql/sandbox' && window.__sandbox.last().result && !window.__sandbox.last().result.error, null, { timeout: 60000 });
  expect(errors).toEqual([]);
});

// ----------------------------------------------------------------------------- Edge cases
test('Edge cases: syntax error, empty submission, timeouts, truncation, state reset', async ({ page }) => {
  const errors = await openApp(page, '#sql/sandbox');
  await gotoSandbox(page, 'sql');
  // syntax error with a plain-language hint
  let r = await runCode(page, 'SELEC 1');
  expect(r.error).toMatch(/syntax error/i);
  expect(r.hint).toMatch(/syntax/i);
  expect(await page.locator('#output .error-hint').innerText()).toMatch(/syntax/i);
  // huge result is truncated in the UI but the total is reported
  r = await runCode(page, 'SELECT * FROM enrollments');
  expect(r.total).toBeGreaterThan(200);
  expect(r.truncated).toBe(true);
  expect(await page.locator('#output .rowcount').innerText()).toMatch(/7503 rows total — showing the first 200/);
  expect(await page.locator('#output table.result tbody tr').count()).toBe(200);
  // infinite recursive CTE is cancelled and the engine recovers
  const t0 = Date.now();
  r = await runCode(page, 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT COUNT(*) FROM r', 60000);
  expect(r.error).toMatch(/TIMEOUT/);
  expect(Date.now() - t0).toBeLessThan(30000);
  r = await runCode(page, 'SELECT COUNT(*) AS n FROM students');
  expect(r.rows[0][0]).toBe(500);
  // empty submission on a graded problem
  await gotoProblem(page, 'sql', 'easy-1', 'sql-easy-1');
  await page.evaluate(() => window.__sandbox.setCode(''));
  let v = await clickCheck(page);
  expect(v.pass).toBe(false);
  expect(v.message).toMatch(/empty|Nothing to run/i);
  // non-SELECT statements are rejected in graded problems
  await page.evaluate(() => window.__sandbox.setCode("DELETE FROM students; SELECT student_id, first_name, last_name, gpa FROM students WHERE home_state='MO' AND gpa >= 3.8 ORDER BY gpa DESC, last_name, first_name"));
  v = await clickCheck(page);
  expect(v.pass).toBe(false);
  expect(v.message).toMatch(/Only SELECT/i);
  r = await runCode(page, 'SELECT COUNT(*) AS n FROM students');
  expect(r.rows[0][0]).toBe(500);
  // tab-switch state reset: editor shows the new problem's starter and output is cleared
  await gotoProblem(page, 'sql', 'easy-1', 'sql-easy-1');
  await runCode(page, 'SELECT 1 AS one');
  expect(await page.locator('#output table.result').count()).toBe(1);
  await gotoProblem(page, 'sql', 'easy-2', 'sql-easy-2');
  const starter = readJson('problems/sql.json')[1].starter;
  expect(await page.evaluate(() => window.__sandbox.getCode())).toBe(starter);
  expect(await page.locator('#output table.result').count()).toBe(0);
  expect(await page.locator('#verdict').isHidden()).toBe(true);
  // switching tracks swaps the engine and the editor language
  await gotoSandbox(page, 'pandas');
  expect(await page.evaluate(() => window.__sandbox.state.editor.getOption('mode'))).toBe('python');
  // pandas: infinite loop is cancelled, worker restarts, runs again
  const t1 = Date.now();
  r = await runCode(page, 'while True:\n    pass', 300000);
  expect(r.error).toMatch(/TIMEOUT/);
  r = await runCode(page, 'result = students.head(3)', 300000);
  expect(r.rows.length).toBe(3);
  // pandas: syntax error and missing result are explained
  r = await runCode(page, 'result = (students');
  expect(r.error).toMatch(/SyntaxError/);
  expect(r.hint).toMatch(/syntax/i);
  r = await runCode(page, 'x = 1');
  expect(r.note).toMatch(/result/);
  // pandas: file and network access are blocked
  r = await runCode(page, 'open("x.txt", "w")');
  expect(r.error).toMatch(/PermissionError/);
  r = await runCode(page, 'import urllib.request');
  expect(r.error).toMatch(/ModuleNotFoundError|ImportError/);
  // deep link lands on the right problem
  await page.goto('/#pandas/medium-3');
  await page.waitForFunction(() => window.__sandbox.problem() && window.__sandbox.problem().id === 'pandas-medium-3');
  expect(await page.locator('#problem-title').innerText()).toContain('Courses never offered');
  record('edge-cases', '9 scenarios', true, null);
  expect(errors).toEqual([]);
});

test.afterAll(async () => {
  const lines = ['| track | id | reference passes | wrong answer rejected |', '|---|---|---|---|'];
  for (const s of summary) lines.push(`| ${s.track} | ${s.id} | ${s.pass ? 'PASS' : 'FAIL'} | ${s.wrongRejected === null ? '—' : s.wrongRejected ? 'yes' : 'NO'} |`);
  const table = lines.join('\n');
  console.log('\n' + table + '\n');
  fs.writeFileSync(path.join(HERE, 'last-summary.md'), `# Verification summary (${new Date().toISOString()})\n\n${table}\n`);
});
