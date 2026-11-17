// DataLab Sandbox — application shell: tabs, sidebar, hash router, editor/grid, output, prompt, drawer.
/* global CodeMirror */
import { TRACKS, trackById, DIFFICULTIES } from './tracks.js';
import { fetchJson } from './data.js';
import { renderMarkdown } from './ui/markdown.js';
import { renderErd } from './ui/erd.js';
import { SpreadsheetGrid, escapeHtml } from './ui/grid.js';

const $ = (sel) => document.querySelector(sel);
const DISPLAY_CAP = 200;

// ----------------------------------------------------------------------------- persistence (localStorage, guarded)
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode / quota */ } },
};
const solved = store.get('datalab.solved.v1', {});
const attempts = store.get('datalab.attempts.v1', {});
const drafts = store.get('datalab.drafts.v1', {});

// ----------------------------------------------------------------------------- state
const state = {
  track: null, item: null, problem: null, problems: {}, tutorials: {},
  editor: null, grid: null, editorMode: null, lastResult: null, lastCheck: null, hintLevel: 0, busy: false,
  drawerOpen: false, mode: 'sql', modeDrafts: {},
};

// ----------------------------------------------------------------------------- boot
async function boot() {
  renderTabs();
  buildEditor();
  wireButtons();
  window.addEventListener('hashchange', route);
  await route();
}

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const t of TRACKS) {
    const a = document.createElement('a');
    a.className = 'tab';
    a.href = `#${t.id}/tutorial`;
    a.textContent = t.label;
    a.dataset.track = t.id;
    nav.appendChild(a);
  }
}

function buildEditor() {
  state.editor = CodeMirror($('#editor'), {
    value: '', mode: 'text/x-sql', lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
    lineWrapping: true, viewportMargin: 50,
    extraKeys: {
      'Ctrl-Enter': () => runCode(), 'Cmd-Enter': () => runCode(),
      Tab: (cm) => { if (cm.somethingSelected()) cm.indentSelection('add'); else cm.replaceSelection('    ', 'end'); },
      'Shift-Tab': (cm) => cm.indentSelection('subtract'),
    },
  });
  state.editor.on('change', () => {
    if (state.problem && !state.busy) {
      drafts[draftKey()] = state.editor.getValue();
      store.set('datalab.drafts.v1', drafts);
    }
  });
}

function draftKey() { return state.problem ? `${state.problem.id}:${state.track.id === 'exploration' ? state.mode : ''}` : `${state.track.id}:sandbox:${state.mode}`; }

function wireButtons() {
  $('#btn-run').addEventListener('click', () => runCode());
  $('#btn-check').addEventListener('click', () => checkAnswer());
  $('#btn-reset').addEventListener('click', () => resetCode());
  $('#btn-hint').addEventListener('click', () => showHint());
  $('#btn-solution').addEventListener('click', () => showSolution());
  $('#btn-schema').addEventListener('click', () => toggleDrawer());
  $('#drawer-close').addEventListener('click', () => toggleDrawer(false));
  $('#btn-resetdb').addEventListener('click', async () => { setStatus('Resetting…'); await state.track.engine.reset(); setStatus(''); showNote('Database reloaded from the original file.'); });
  $('#btn-cancel').addEventListener('click', () => { state.track.engine.cancel(); state.busy = false; setStatus(''); showError('Cancelled. The engine was restarted.', ''); });
  for (const b of document.querySelectorAll('.mode-btn')) b.addEventListener('click', () => setMode(b.dataset.mode));
}

// ----------------------------------------------------------------------------- routing
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [trackId, item] = h.split('/');
  return { trackId: trackById(trackId) ? trackId : TRACKS[0].id, item: item || 'tutorial' };
}

async function route() {
  const { trackId, item } = parseHash();
  const track = trackById(trackId);
  const trackChanged = state.track !== track;
  state.track = track;
  state.item = item;
  for (const a of document.querySelectorAll('.tab')) a.classList.toggle('active', a.dataset.track === trackId);
  document.body.dataset.track = trackId;
  await ensureTrackData(track);
  renderSidebar();
  toggleDrawer(false);
  if (trackChanged) { state.lastResult = null; state.lastCheck = null; }
  if (item === 'tutorial') showTutorial();
  else if (item === 'sandbox') showSandbox();
  else showProblem(item);
}

async function ensureTrackData(track) {
  if (!state.problems[track.id]) state.problems[track.id] = await fetchJson(track.problems);
  if (!state.tutorials[track.id]) state.tutorials[track.id] = await fetchJson(track.tutorial);
}

function problemsOf(track) { return state.problems[track.id] || []; }

function itemKeyOf(p, index) {
  if (state.track.itemStyle === 'challenge') return `challenge-${index + 1}`;
  return `${p.difficulty}-${p.number ?? (index % 5) + 1}`;
}

function findProblem(item) {
  const list = problemsOf(state.track);
  if (state.track.itemStyle === 'challenge') {
    const n = parseInt((item.match(/challenge-(\d+)/) || [])[1], 10);
    return list[n - 1] || null;
  }
  const m = item.match(/^(easy|medium|hard)-(\d+)$/);
  if (!m) return null;
  return list.filter((p) => p.difficulty === m[1])[+m[2] - 1] || null;
}

// ----------------------------------------------------------------------------- sidebar
function renderSidebar() {
  const side = $('#sidebar');
  const list = problemsOf(state.track);
  const parts = [];
  parts.push(`<a class="pill pill-tutorial ${state.item === 'tutorial' ? 'current' : ''}" href="#${state.track.id}/tutorial">Tutorial</a>`);
  parts.push(`<a class="pill pill-sandbox ${state.item === 'sandbox' ? 'current' : ''}" href="#${state.track.id}/sandbox">Sandbox</a>`);
  if (state.track.itemStyle === 'challenge') {
    parts.push('<div class="side-head">Challenges</div>');
    list.forEach((p, i) => {
      const key = `challenge-${i + 1}`;
      parts.push(`<a class="pill pill-problem ${state.item === key ? 'current' : ''}" href="#${state.track.id}/${key}" title="${escapeHtml(p.title)}">${solved[p.id] ? '✓ ' : ''}${i + 1}. ${escapeHtml(p.title)}</a>`);
    });
  } else {
    for (const d of DIFFICULTIES) {
      const items = list.filter((p) => p.difficulty === d.key);
      if (!items.length) continue;
      parts.push(`<div class="side-head">${d.label}</div>`);
      items.forEach((p, i) => {
        const key = `${d.key}-${i + 1}`;
        parts.push(`<a class="pill pill-problem ${state.item === key ? 'current' : ''}" href="#${state.track.id}/${key}" title="${escapeHtml(p.title)}">${solved[p.id] ? '✓ ' : ''}${d.short} ${i + 1}</a>`);
      });
    }
  }
  side.innerHTML = parts.join('');
}

// ----------------------------------------------------------------------------- views
function showView(name) {
  $('#view-work').hidden = name !== 'work';
  $('#view-tutorial').hidden = name !== 'tutorial';
}

function engineKind() { return state.track.engine.kind; }

function setEditorKind(kind, problem) {
  const code = $('#editor'), gridHost = $('#grid'), mc = $('#mc');
  code.hidden = kind !== 'code';
  gridHost.hidden = kind !== 'grid';
  mc.hidden = kind !== 'mc';
  if (kind === 'grid') {
    if (!state.grid) { state.grid = new SpreadsheetGrid(gridHost, { onChange: () => { if (state.problem) refreshExcelOutput(); } }); state.track.engine.attach(state.grid); }
  }
  if (kind === 'mc') {
    mc.innerHTML = `<div class="mc-q">${renderMarkdown(problem.question_md || '')}</div>` + problem.options.map((o, i) => `<label class="mc-opt"><input type="radio" name="mc" value="${i}"> <span>${escapeHtml(o)}</span></label>`).join('');
  }
  if (kind === 'code') setTimeout(() => state.editor.refresh(), 0);
}

function languageFor() {
  const eng = state.track.engine;
  const lang = eng.language || 'sql';
  return lang === 'python' ? 'python' : 'text/x-sql';
}

function setMode(mode) {
  if (state.track.id !== 'exploration') return;
  if (state.problem || state.item === 'sandbox') { state.modeDrafts[draftKey()] = state.editor.getValue(); }
  state.track.engine.setMode(mode);
  state.mode = mode;
  for (const b of document.querySelectorAll('.mode-btn')) b.classList.toggle('active', b.dataset.mode === mode);
  state.editor.setOption('mode', languageFor());
  const text = state.modeDrafts[draftKey()] ?? drafts[draftKey()] ?? (state.problem ? state.track.engine.pickText(state.problem.starter) : sandboxStarter());
  state.busy = true; state.editor.setValue(text); state.busy = false;
  if (mode === 'pandas') warmPandas();
  clearOutput();
}

function sandboxStarter() {
  const t = state.tutorials[state.track.id];
  return (t && t.sandbox_starter && (typeof t.sandbox_starter === 'object' ? t.sandbox_starter[state.mode] : t.sandbox_starter)) || '';
}

function warmPandas() {
  const eng = state.track.engine;
  const sub = eng.sub || eng;
  if (!sub.init || sub.id.indexOf('pandas') < 0) return;
  sub.onProgress = (stage) => { if (stage !== 'ready') setStatus(stage); else setStatus(''); };
  if (sub.stage === 'idle') { setStatus('Loading Python… ~10–20 s the first time'); }
  sub.init().then(() => setStatus('')).catch((e) => showError('Python failed to load: ' + e.message, 'Check your internet connection; Pyodide is fetched from jsDelivr.'));
}

function applyModeUI() {
  const isExpl = state.track.id === 'exploration';
  $('#mode-switch').hidden = !isExpl;
  if (isExpl) { state.track.engine.setMode(state.mode); for (const b of document.querySelectorAll('.mode-btn')) b.classList.toggle('active', b.dataset.mode === state.mode); }
  $('#btn-schema').hidden = false;
  $('#btn-resetdb').hidden = !(state.item === 'sandbox' && (state.track.id === 'sql' || state.track.id === 'exploration' || state.track.id === 'dbdesign'));
}

function showProblem(item) {
  const p = findProblem(item);
  if (!p) { location.hash = `#${state.track.id}/tutorial`; return; }
  state.problem = p;
  state.hintLevel = 0;
  showView('work');
  applyModeUI();
  const kind = p.kind === 'mc' ? 'mc' : engineKind();
  setEditorKind(kind, p);
  document.title = `${p.title} · DataLab Sandbox`;
  $('#panel-title').textContent = kind === 'grid' ? 'Workbook' : 'Code Terminal';
  $('#problem-title').innerHTML = `<span class="diff diff-${p.difficulty}">${p.difficulty}</span> ${escapeHtml(p.title)} <span class="tags">${(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span>`;
  $('#prompt').innerHTML = renderMarkdown(p.prompt_md) + renderExample(p) + (p.constraints_md ? `<h4>Constraints</h4>${renderMarkdown(p.constraints_md)}` : '');
  $('#btn-check').hidden = false;
  $('#btn-hint').hidden = !(p.hints && p.hints.length);
  $('#btn-solution').hidden = false;
  $('#btn-reset').hidden = kind === 'mc';
  $('#btn-run').hidden = kind === 'mc';
  $('#btn-solution').disabled = !(attempts[p.id] > 0);
  $('#hint-box').hidden = true;
  $('#hint-box').innerHTML = '';
  clearOutput();
  if (kind === 'code') {
    state.editor.setOption('mode', languageFor());
    const text = drafts[draftKey()] ?? state.track.engine.pickText?.(p.starter) ?? p.starter ?? '';
    state.busy = true; state.editor.setValue(text); state.busy = false;
    state.editor.focus();
  } else if (kind === 'grid') {
    state.track.engine.init().then(() => { state.track.engine.loadProblem(p); refreshExcelOutput(); });
  }
  if (state.track.id === 'pandas' || (state.track.id === 'exploration' && state.mode === 'pandas')) warmPandas();
  if (state.track.id === 'sql' || state.track.id === 'dbdesign' || state.track.id === 'exploration') state.track.engine.init().catch((e) => showError(e.message, ''));
}

function renderExample(p) {
  if (!p.example) return '';
  const ex = p.example;
  let html = '<h4>Example</h4>';
  if (ex.input_md) html += renderMarkdown(ex.input_md);
  if (ex.output && ex.output.columns) {
    const n = ex.output.total;
    if (ex.output.rows.length) {
      html += `<p class="muted">Expected output shape (first ${ex.output.rows.length} of ${n} rows):</p>` + tableHtml(ex.output.columns, ex.output.rows);
    } else {
      html += `<p class="muted">Expected output: ${n} row${n === 1 ? '' : 's'} with these columns (values hidden so the example does not give the answer away):</p>` + tableHtml(ex.output.columns, [ex.output.columns.map(() => '…')]);
    }
  } else if (ex.output_md) html += renderMarkdown(ex.output_md);
  return html;
}

function showSandbox() {
  state.problem = null;
  showView('work');
  applyModeUI();
  const kind = engineKind();
  setEditorKind(kind, null);
  document.title = `${state.track.label} sandbox · DataLab Sandbox`;
  $('#panel-title').textContent = kind === 'grid' ? 'Workbook' : 'Code Terminal';
  $('#problem-title').textContent = `${state.track.label} Sandbox`;
  const t = state.tutorials[state.track.id];
  $('#prompt').innerHTML = renderMarkdown((t && t.sandbox_md) || 'Free play on the full dataset. Nothing is graded here.');
  $('#btn-check').hidden = true;
  $('#btn-hint').hidden = true;
  $('#btn-solution').hidden = true;
  $('#btn-reset').hidden = false;
  $('#btn-run').hidden = false;
  $('#hint-box').hidden = true;
  clearOutput();
  if (kind === 'code') {
    state.editor.setOption('mode', languageFor());
    state.busy = true; state.editor.setValue(drafts[draftKey()] ?? state.pendingSnippet ?? sandboxStarter()); state.busy = false;
    state.editor.focus();
  } else if (kind === 'grid') {
    state.track.engine.init().then(() => {
      state.track.engine.loadProblem({ setup: { answers: [['Try a formula →', state.pendingSnippet || '']] }, answerCells: 'Answers!B2' });
      state.grid.showSheet('Answers');
      state.grid.select(1, 1);
      showNote('Sandbox workbook: all sheets are editable. Nothing is graded.');
    });
  }
  if (state.pendingSnippet && kind === 'code') { const snip = state.pendingSnippet; state.pendingSnippet = null; state.busy = true; state.editor.setValue(snip); state.busy = false; runCode(); }
  state.pendingSnippet = null;
  if (state.track.id === 'pandas' || (state.track.id === 'exploration' && state.mode === 'pandas')) warmPandas();
  if (state.track.id === 'sql' || state.track.id === 'dbdesign' || state.track.id === 'exploration') state.track.engine.init().catch((e) => showError(e.message, ''));
}

function showTutorial() {
  state.problem = null;
  showView('tutorial');
  const t = state.tutorials[state.track.id];
  document.title = `${state.track.label} tutorial · DataLab Sandbox`;
  const parts = [`<h2>${escapeHtml(t.title)}</h2>`, renderMarkdown(t.intro_md || '')];
  if (t.sections && t.sections.length) {
    parts.push('<nav class="toc">' + t.sections.map((s, i) => `<a href="#${state.track.id}/tutorial" data-sec="${i}">${escapeHtml(s.heading)}</a>`).join(' · ') + '</nav>');
  }
  (t.sections || []).forEach((s, si) => {
    parts.push(`<section class="tut-section" id="sec-${si}"><h3>${escapeHtml(s.heading)}</h3>${renderMarkdown(s.body_md || '')}`);
    (s.examples || []).forEach((ex, ei) => {
      const code = typeof ex.code === 'object' ? ex.code[state.mode] ?? ex.code.sql : ex.code;
      parts.push(`<div class="example"><div class="example-head"><span>${escapeHtml(ex.label || 'Example')}</span><button class="btn btn-small try" data-sec="${si}" data-ex="${ei}">Try in sandbox ▸</button></div><pre class="md-code"><code>${escapeHtml(code)}</code></pre>${ex.note_md ? `<div class="example-note">${renderMarkdown(ex.note_md)}</div>` : ''}</div>`);
    });
    parts.push('</section>');
  });
  const view = $('#view-tutorial');
  view.innerHTML = parts.join('\n');
  view.scrollTop = 0;
  for (const b of view.querySelectorAll('button.try')) {
    b.addEventListener('click', () => {
      const ex = t.sections[+b.dataset.sec].examples[+b.dataset.ex];
      if (typeof ex.code === 'object' && ex.mode) { state.mode = ex.mode; }
      else if (typeof ex.code === 'object') { state.mode = ex.code.sql !== undefined && state.mode !== 'pandas' ? 'sql' : state.mode; }
      state.pendingSnippet = typeof ex.code === 'object' ? ex.code[state.mode] ?? ex.code.sql : ex.code;
      if (state.track.id === 'exploration' && ex.mode) state.mode = ex.mode;
      delete drafts[`${state.track.id}:sandbox:${state.mode}`];
      if (location.hash === `#${state.track.id}/sandbox`) showSandbox(); else location.hash = `#${state.track.id}/sandbox`;
    });
  }
  for (const a of view.querySelectorAll('nav.toc a')) a.addEventListener('click', (e) => { e.preventDefault(); view.querySelector(`#sec-${a.dataset.sec}`).scrollIntoView({ behavior: 'smooth' }); });
}

// ----------------------------------------------------------------------------- output pane
function clearOutput() {
  $('#output').innerHTML = '<p class="muted">Run your code to see results here. Ctrl/Cmd+Enter runs.</p>';
  $('#verdict').hidden = true;
  $('#verdict').className = 'verdict';
  state.lastResult = null; state.lastCheck = null;
  setStatus('');
}
function setStatus(text) { $('#status').textContent = text || ''; $('#btn-cancel').hidden = !text; }

function tableHtml(columns, rows) {
  return `<div class="tbl-wrap"><table class="result"><thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td class="${v === null || v === undefined ? 'null' : typeof v === 'number' ? 'num' : ''}">${v === null || v === undefined ? 'NULL' : escapeHtml(typeof v === 'number' ? fmtNum(v) : String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function fmtNum(v) { return Number.isInteger(v) ? String(v) : String(+v.toFixed(6)); }

function renderResult(r) {
  const out = $('#output');
  const parts = [];
  if (r.stdout) parts.push(`<pre class="stdout">${escapeHtml(r.stdout)}</pre>`);
  if (r.error) {
    parts.push(`<div class="error"><div class="error-hint">${escapeHtml(r.hint || 'Something went wrong.')}</div><pre class="error-raw">${escapeHtml(r.error)}</pre></div>`);
  } else if (r.columns && r.columns.length) {
    const shown = r.rows.length > DISPLAY_CAP ? r.rows.slice(0, DISPLAY_CAP) : r.rows;
    const total = r.total ?? r.rows.length;
    parts.push(`<div class="rowcount">${total} row${total === 1 ? '' : 's'} total${(r.truncated || r.rows.length > DISPLAY_CAP) ? ` — showing the first ${DISPLAY_CAP}` : ''}</div>`);
    parts.push(tableHtml(r.columns, shown));
  } else if (!r.stdout && !r.schema) {
    parts.push('<p class="muted">The code ran but produced no table.</p>');
  }
  if (r.note) parts.push(`<p class="note">${escapeHtml(r.note)}</p>`);
  if (r.schema) parts.push(`<div class="erd-wrap">${renderErd(r.schema, { compact: false })}</div>`);
  out.innerHTML = parts.join('');
}
function showError(error, hint) { renderResult({ error, hint }); }
function showNote(note) { $('#output').innerHTML = `<p class="note">${escapeHtml(note)}</p>`; }

function showVerdict(v) {
  const el = $('#verdict');
  el.hidden = false;
  el.className = 'verdict ' + (v.pass ? 'pass' : 'fail');
  el.innerHTML = `<strong>${v.pass ? 'PASS' : 'FAIL'}</strong> <span>${escapeHtml(v.message.replace(/^(PASS|FAIL)\s*[—-]?\s*/, ''))}</span>`;
}

async function refreshExcelOutput() {
  if (!state.problem || engineKind() !== 'grid') return;
  const r = await state.track.engine.run(null, { problem: state.problem });
  state.lastResult = r;
  renderResult(r);
}

// ----------------------------------------------------------------------------- actions
function currentInput() {
  if (state.problem && state.problem.kind === 'mc') { const sel = document.querySelector('input[name="mc"]:checked'); return sel ? sel.value : ''; }
  if (engineKind() === 'grid') return null;
  return state.editor.getValue();
}

async function runCode() {
  if (state.busy) return;
  const eng = state.track.engine;
  if (engineKind() === 'grid') { await refreshExcelOutput(); return; }
  state.busy = true;
  $('#verdict').hidden = true;
  setStatus('Running…');
  try {
    const r = await eng.run(currentInput(), { graded: !!state.problem, sandbox: !state.problem, problem: state.problem });
    state.lastResult = r;
    renderResult(r);
  } catch (e) {
    showError(e.message, '');
  } finally { state.busy = false; setStatus(''); }
}

async function checkAnswer() {
  if (!state.problem || state.busy) return;
  const p = state.problem;
  const eng = state.track.engine;
  state.busy = true;
  setStatus('Checking…');
  try {
    const v = await eng.check(p, currentInput());
    state.lastCheck = v;
    attempts[p.id] = (attempts[p.id] || 0) + 1;
    store.set('datalab.attempts.v1', attempts);
    $('#btn-solution').disabled = false;
    if (v.result) { state.lastResult = v.result; renderResult(v.result); }
    showVerdict(v);
    if (v.pass && !solved[p.id]) { solved[p.id] = true; store.set('datalab.solved.v1', solved); renderSidebar(); }
  } catch (e) {
    state.lastCheck = { pass: false, message: e.message };
    showVerdict(state.lastCheck);
  } finally { state.busy = false; setStatus(''); }
}

function resetCode() {
  if (engineKind() === 'grid') { if (state.problem) state.track.engine.loadProblem(state.problem); else showSandbox(); refreshExcelOutput(); return; }
  delete drafts[draftKey()];
  delete state.modeDrafts[draftKey()];
  store.set('datalab.drafts.v1', drafts);
  const text = state.problem ? (state.track.engine.pickText ? state.track.engine.pickText(state.problem.starter) : state.problem.starter) : sandboxStarter();
  state.busy = true; state.editor.setValue(text || ''); state.busy = false;
  clearOutput();
}

function showHint() {
  const p = state.problem;
  if (!p || !p.hints) return;
  state.hintLevel = Math.min(p.hints.length, state.hintLevel + 1);
  const box = $('#hint-box');
  box.hidden = false;
  box.innerHTML = p.hints.slice(0, state.hintLevel).map((h, i) => `<div class="hint"><strong>Hint ${i + 1}:</strong> ${renderMarkdown(h)}</div>`).join('') + (state.hintLevel < p.hints.length ? '<p class="muted">Click Hint again for more.</p>' : '');
  $('#btn-hint').textContent = state.hintLevel < p.hints.length ? `Hint (${state.hintLevel}/${p.hints.length})` : 'Hints shown';
}

function showSolution() {
  const p = state.problem;
  if (!p) return;
  const box = $('#hint-box');
  box.hidden = false;
  if (p.kind === 'mc') { box.innerHTML += `<div class="solution"><strong>Answer:</strong> ${escapeHtml(p.options[p.answer])}. ${renderMarkdown(p.explanation || '')}</div>`; return; }
  if (engineKind() === 'grid') {
    box.innerHTML += `<div class="solution"><strong>Reference formulas:</strong><pre class="md-code"><code>${escapeHtml((p.solution || []).map(([c, f]) => `${c}: ${f}`).join('\n'))}${p.solutionFill ? `\n(fill down over ${p.solutionFill})` : ''}</code></pre><button class="btn btn-small" id="apply-solution">Apply to workbook</button></div>`;
    $('#apply-solution').addEventListener('click', () => { state.track.engine.applySolution(p); refreshExcelOutput(); });
    return;
  }
  const sol = state.track.engine.pickText ? state.track.engine.pickText(p.solution) : p.solution;
  box.innerHTML += `<div class="solution"><strong>Reference solution:</strong><pre class="md-code"><code>${escapeHtml(sol)}</code></pre><button class="btn btn-small" id="apply-solution">Load into editor</button></div>`;
  $('#apply-solution').addEventListener('click', () => { state.busy = true; state.editor.setValue(sol); state.busy = false; });
}

// ----------------------------------------------------------------------------- schema drawer
async function toggleDrawer(force) {
  const open = force === undefined ? !state.drawerOpen : force;
  state.drawerOpen = open;
  $('#drawer').hidden = !open;
  $('#btn-schema').classList.toggle('active', open);
  if (!open) return;
  const body = $('#drawer-body');
  body.innerHTML = '<p class="muted">Loading schema…</p>';
  try {
    const src = state.track.schemaSource;
    let schema;
    if (src === 'excel') {
      await state.track.engine.init();
      const sheets = state.grid ? state.grid.sheetNames : state.track.engine.sheetNames();
      body.innerHTML = `<p>Sheets in the workbook (headers in row 1, data from row 2):</p>` + sheets.map((s) => `<details><summary><b>${escapeHtml(s)}</b></summary><p class="muted">Switch to the sheet tab at the bottom of the workbook to browse it.</p></details>`).join('');
      return;
    }
    if (src === 'dbdesign') {
      schema = state.track.engine.lastSchema();
      if (!schema.length) { body.innerHTML = '<p class="muted">Run your DDL first; the tables you create will appear here with an ER diagram.</p>'; return; }
    } else {
      const eng = src === 'sql' ? trackById('sql').engine : state.track.engine;
      schema = await eng.schema();
    }
    const parts = [`<div class="erd-wrap">${renderErd(schema, { compact: true })}</div>`];
    for (const t of schema) {
      const fk = new Map(t.foreignKeys.map((f) => [f.from.toLowerCase(), f]));
      parts.push(`<details><summary><b>${escapeHtml(t.name)}</b> <span class="muted">${t.rowCount} rows · ${t.columns.length} cols</span></summary>
        <table class="schema"><thead><tr><th>column</th><th>type</th><th>key</th><th>null?</th></tr></thead><tbody>${t.columns.map((c) => `<tr><td><code>${escapeHtml(c.name)}</code></td><td>${escapeHtml(c.type || '')}</td><td>${c.pk > 0 ? 'PK' : fk.has(c.name.toLowerCase()) ? `FK → ${escapeHtml(fk.get(c.name.toLowerCase()).table)}.${escapeHtml(fk.get(c.name.toLowerCase()).to)}` : ''}</td><td>${c.notnull || c.pk > 0 ? 'no' : 'yes'}</td></tr>`).join('')}</tbody></table>
        <div class="muted">Preview (10 rows):</div>${tableHtml(t.preview.columns, t.preview.rows)}</details>`);
    }
    body.innerHTML = parts.join('');
  } catch (e) { body.innerHTML = `<div class="error"><div class="error-hint">Could not load the schema.</div><pre class="error-raw">${escapeHtml(e.message)}</pre></div>`; }
}

// ----------------------------------------------------------------------------- test / automation API
window.__sandbox = {
  ready: null,
  state,
  goto: async (hash) => { if (location.hash === hash) await route(); else { location.hash = hash; await new Promise((res) => { const h = () => { window.removeEventListener('hashchange', h); setTimeout(res, 0); }; window.addEventListener('hashchange', h); }); } },
  setCode: (code) => { state.busy = true; state.editor.setValue(code); state.busy = false; },
  getCode: () => state.editor.getValue(),
  run: () => runCode(),
  check: () => checkAnswer(),
  setMode: (m) => setMode(m),
  selectOption: (i) => { const el = document.querySelector(`input[name="mc"][value="${i}"]`); if (el) el.checked = true; },
  setCells: (list) => state.track.engine.setCells(list),
  fillDown: (range) => state.track.engine.fillDown(range),
  applySolution: () => state.track.engine.applySolution(state.problem),
  problem: () => state.problem,
  problems: () => state.problems,
  tutorials: () => state.tutorials,
  last: () => ({ result: state.lastResult, check: state.lastCheck }),
  engine: () => state.track.engine,
  resetProgress: () => { for (const k of Object.keys(solved)) delete solved[k]; for (const k of Object.keys(attempts)) delete attempts[k]; for (const k of Object.keys(drafts)) delete drafts[k]; store.set('datalab.solved.v1', {}); store.set('datalab.attempts.v1', {}); store.set('datalab.drafts.v1', {}); },
};
window.__sandbox.ready = boot();
