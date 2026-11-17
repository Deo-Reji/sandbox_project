// Lightweight spreadsheet grid on top of HyperFormula (vendored, GPL v3 key).
// Features: sheet tabs, A1 headers, click/double-click to edit, formula bar, keyboard navigation,
// shift-selection, Ctrl+D / "Fill down" (relative references adjust via HyperFormula copy/paste).
/* global HyperFormula */

export function colLetter(c) {
  let s = '';
  c += 1;
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
export function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
/** 'Students!B2' -> {sheet:'Students', row:1, col:1}; 'B2' -> {sheet:null,...} */
export function parseA1(ref) {
  const m = String(ref).trim().match(/^(?:'?([^'!]+)'?!)?\$?([A-Za-z]+)\$?(\d+)$/);
  if (!m) throw new Error('Bad cell reference: ' + ref);
  return { sheet: m[1] || null, col: colIndex(m[2]), row: parseInt(m[3], 10) - 1 };
}
/** 'Students!J2:J121' -> [{sheet,row,col}, ...] in row-major order */
export function expandRange(ref) {
  const m = String(ref).trim().match(/^(?:'?([^'!]+)'?!)?([A-Za-z]+\d+)(?::([A-Za-z]+\d+))?$/);
  if (!m) throw new Error('Bad range: ' + ref);
  const a = parseA1(m[2]), b = m[3] ? parseA1(m[3]) : a;
  const out = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) out.push({ sheet: m[1] || null, row: r, col: c });
  }
  return out;
}
export function toA1(sheet, row, col) { return `${sheet ? sheet + '!' : ''}${colLetter(col)}${row + 1}`; }

const HF_CONFIG = { licenseKey: 'gpl-v3', dateFormats: ['YYYY-MM-DD'], useArrayArithmetic: true, useColumnIndex: true, precisionRounding: 10 };

export class SpreadsheetGrid {
  constructor(container, { onChange = null, readOnlySheets = [] } = {}) {
    this.container = container;
    this.onChange = onChange;
    this.readOnlySheets = new Set(readOnlySheets);
    this.hf = null;
    this.sheetNames = [];
    this.active = null;
    this.sel = { r0: 0, c0: 0, r1: 0, c1: 0, anchorR: 0, anchorC: 0 };
    this.editing = null;
    this._build();
  }

  _build() {
    const c = this.container;
    c.classList.add('xl');
    c.innerHTML = `
      <div class="xl-bar">
        <div class="xl-ref" title="Selected cell">A1</div>
        <div class="xl-fx">fx</div>
        <input class="xl-input" spellcheck="false" placeholder="Type a value or =FORMULA, press Enter">
        <button class="xl-btn xl-fill" title="Copy the top row of the selection down over the rest (Ctrl+D)">Fill down</button>
      </div>
      <div class="xl-scroll"><table class="xl-table"><thead></thead><tbody></tbody></table></div>
      <div class="xl-tabs"></div>`;
    this.refEl = c.querySelector('.xl-ref');
    this.input = c.querySelector('.xl-input');
    this.scroll = c.querySelector('.xl-scroll');
    this.table = c.querySelector('.xl-table');
    this.tabs = c.querySelector('.xl-tabs');
    c.querySelector('.xl-fill').addEventListener('click', () => this.fillDown());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.commit(this.input.value); this.move(1, 0); }
      else if (e.key === 'Escape') { this.cancelEdit(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.commit(this.input.value); this.move(0, 1); }
    });
    this.input.addEventListener('focus', () => { this.editing = { ...this.sel }; });
    this.input.addEventListener('input', () => { if (this.editing) this._mirror(this.input.value); });
    this.scroll.addEventListener('mousedown', (e) => {
      const td = e.target.closest('td[data-r]');
      if (!td) return;
      const r = +td.dataset.r, c = +td.dataset.c;
      if (this.editing && (this.editing.r0 !== r || this.editing.c0 !== c) && this.input.value.startsWith('=') && document.activeElement === this.input) {
        // clicking a cell while typing a formula inserts its reference
        e.preventDefault();
        const ref = `${this.active !== this.editing.sheet ? this.active + '!' : ''}${colLetter(c)}${r + 1}`;
        const pos = this.input.selectionStart;
        this.input.value = this.input.value.slice(0, pos) + ref + this.input.value.slice(this.input.selectionEnd);
        this.input.setSelectionRange(pos + ref.length, pos + ref.length);
        this._mirror(this.input.value);
        return;
      }
      if (this.editing) this.commit(this.input.value);
      if (e.shiftKey) this.extendTo(r, c); else this.select(r, c);
    });
    this.scroll.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td[data-r]');
      if (!td) return;
      this.select(+td.dataset.r, +td.dataset.c);
      this.beginEdit();
    });
    this.scroll.addEventListener('keydown', (e) => this._key(e));
    this.scroll.tabIndex = 0;
  }

  /** sheets: {name: [[header...], [row...], ...]} */
  load(sheets, { activeSheet = null, readOnlySheets = null } = {}) {
    if (this.hf) this.hf.destroy();
    this.hf = HyperFormula.buildFromSheets(sheets, HF_CONFIG);
    try { this.hf.addNamedExpression('TRUE', '=TRUE()'); this.hf.addNamedExpression('FALSE', '=FALSE()'); } catch (e) { /* already present */ }
    this.sheetNames = Object.keys(sheets);
    if (readOnlySheets) this.readOnlySheets = new Set(readOnlySheets);
    this.editing = null;
    this._renderTabs();
    this.showSheet(activeSheet || this.sheetNames[0]);
  }

  destroy() { if (this.hf) this.hf.destroy(); this.hf = null; }

  sheetId(name) {
    const id = this.hf.getSheetId(name);
    if (id === undefined) throw new Error(`No sheet named "${name}". Sheets: ${this.sheetNames.join(', ')}`);
    return id;
  }

  _renderTabs() {
    this.tabs.innerHTML = '';
    for (const name of this.sheetNames) {
      const b = document.createElement('button');
      b.className = 'xl-tab';
      b.textContent = name;
      b.dataset.sheet = name;
      b.addEventListener('click', () => this.showSheet(name));
      this.tabs.appendChild(b);
    }
  }

  showSheet(name) {
    if (this.editing) this.commit(this.input.value);
    this.active = name;
    for (const b of this.tabs.querySelectorAll('.xl-tab')) b.classList.toggle('active', b.dataset.sheet === name);
    this._renderSheet();
    this.select(0, 0);
  }

  _dims() {
    const d = this.hf.getSheetDimensions(this.sheetId(this.active));
    return { rows: Math.max(d.height + 25, 30), cols: Math.max(d.width + 3, 8) };
  }

  _renderSheet() {
    const { rows, cols } = this._dims();
    const thead = this.table.querySelector('thead');
    const tbody = this.table.querySelector('tbody');
    let h = '<tr><th class="xl-corner"></th>';
    for (let c = 0; c < cols; c++) h += `<th>${colLetter(c)}</th>`;
    thead.innerHTML = h + '</tr>';
    const parts = [];
    for (let r = 0; r < rows; r++) {
      let row = `<tr><th>${r + 1}</th>`;
      for (let c = 0; c < cols; c++) row += `<td data-r="${r}" data-c="${c}"${r === 0 ? ' class="xl-head"' : ''}>${this._display(r, c)}</td>`;
      parts.push(row + '</tr>');
    }
    tbody.innerHTML = parts.join('');
    this.rows = rows; this.cols = cols;
  }

  _display(r, c) {
    const addr = { sheet: this.sheetId(this.active), row: r, col: c };
    const v = this.hf.getCellValue(addr);
    return escapeHtml(formatValue(v, this.hf.getCellValueDetailedType(addr), this.hf));
  }

  _td(r, c) { return this.table.querySelector(`td[data-r="${r}"][data-c="${c}"]`); }

  _refresh(changes) {
    const sid = this.sheetId(this.active);
    let needFull = false;
    for (const ch of changes || []) {
      if (!ch.address || ch.address.sheet !== sid) continue;
      const td = this._td(ch.address.row, ch.address.col);
      if (!td) { needFull = true; break; }
      td.innerHTML = this._display(ch.address.row, ch.address.col);
    }
    if (needFull) this._renderSheet();
  }

  select(r, c) {
    r = Math.max(0, Math.min(r, this.rows - 1)); c = Math.max(0, Math.min(c, this.cols - 1));
    this.sel = { r0: r, c0: c, r1: r, c1: c, anchorR: r, anchorC: c };
    this._paintSel();
    this._syncBar();
  }
  extendTo(r, c) {
    const { anchorR, anchorC } = this.sel;
    this.sel = { r0: Math.min(anchorR, r), c0: Math.min(anchorC, c), r1: Math.max(anchorR, r), c1: Math.max(anchorC, c), anchorR, anchorC };
    this._paintSel();
    this.refEl.textContent = `${colLetter(this.sel.c0)}${this.sel.r0 + 1}:${colLetter(this.sel.c1)}${this.sel.r1 + 1}`;
  }
  _paintSel() {
    for (const el of this.table.querySelectorAll('td.sel, td.cur')) el.classList.remove('sel', 'cur');
    const { r0, c0, r1, c1, anchorR, anchorC } = this.sel;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const td = this._td(r, c); if (td) td.classList.add('sel'); }
    const cur = this._td(anchorR, anchorC);
    if (cur) { cur.classList.add('cur'); cur.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  _syncBar() {
    const { anchorR: r, anchorC: c } = this.sel;
    this.refEl.textContent = `${colLetter(c)}${r + 1}`;
    this.input.value = this.getContent(this.active, r, c);
    this.editing = null;
  }

  /** Serialized content of a cell: the formula text if any, else the raw value as text. */
  getContent(sheet, r, c) {
    const addr = { sheet: this.sheetId(sheet), row: r, col: c };
    const f = this.hf.getCellFormula(addr);
    if (f !== undefined) return f;
    const v = this.hf.getCellValue(addr);
    if (v === null || v === undefined) return '';
    if (this.hf.getCellValueDetailedType(addr) === 'NUMBER_DATE') return formatValue(v, 'NUMBER_DATE', this.hf);
    return String(v);
  }

  beginEdit() {
    if (this.readOnlySheets.has(this.active)) return;
    this.editing = { ...this.sel, sheet: this.active };
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }
  _mirror(text) {
    if (!this.editing) return;
    const td = this._td(this.editing.anchorR, this.editing.anchorC);
    if (td) td.textContent = text;
  }
  cancelEdit() {
    this.editing = null;
    this._syncBar();
    const { anchorR: r, anchorC: c } = this.sel;
    const td = this._td(r, c); if (td) td.innerHTML = this._display(r, c);
    this.scroll.focus();
  }
  commit(text) {
    const ed = this.editing || { ...this.sel, sheet: this.active };
    this.editing = null;
    if (this.readOnlySheets.has(ed.sheet)) { this._syncBar(); return; }
    this.setCell(ed.sheet, ed.anchorR, ed.anchorC, text);
    this.scroll.focus();
    this._syncBar();
  }

  /** Programmatic write. content: '' clears, '=..' formula, otherwise value (numbers auto-parsed). */
  setCell(sheet, r, c, content) {
    const addr = { sheet: this.sheetId(sheet), row: r, col: c };
    const value = content === '' || content === null || content === undefined ? null : content;
    const changes = this.hf.setCellContents(addr, [[value]]);
    if (sheet === this.active) {
      if (r >= this.rows - 1 || c >= this.cols - 1) this._renderSheet(); else this._refresh(changes);
    }
    if (this.onChange) this.onChange();
  }
  setCellA1(ref, content) {
    const a = parseA1(ref);
    this.setCell(a.sheet || this.active, a.row, a.col, content);
  }
  /** Value of a cell: number/string/boolean/null, or {error, message} for formula errors. */
  getValueA1(ref) {
    const a = parseA1(ref);
    const addr = { sheet: this.sheetId(a.sheet || this.active), row: a.row, col: a.col };
    const v = this.hf.getCellValue(addr);
    if (v && typeof v === 'object' && 'value' in v) return { error: v.value, message: v.message };
    return v === undefined ? null : v;
  }
  hasFormulaA1(ref) {
    const a = parseA1(ref);
    return this.hf.doesCellHaveFormula({ sheet: this.sheetId(a.sheet || this.active), row: a.row, col: a.col });
  }
  formulaA1(ref) {
    const a = parseA1(ref);
    return this.hf.getCellFormula({ sheet: this.sheetId(a.sheet || this.active), row: a.row, col: a.col });
  }

  /** Copy the top row of the current selection to every other selected row (relative refs adjust). */
  fillDown(range = null) {
    let sel = this.sel, sheet = this.active;
    if (range) {
      const cells = expandRange(range);
      const first = cells[0], last = cells[cells.length - 1];
      sheet = first.sheet || this.active;
      sel = { r0: first.row, c0: first.col, r1: last.row, c1: last.col };
    }
    if (sel.r1 <= sel.r0) return;
    if (this.readOnlySheets.has(sheet)) return;
    const sid = this.sheetId(sheet);
    this.hf.copy({ start: { sheet: sid, row: sel.r0, col: sel.c0 }, end: { sheet: sid, row: sel.r0, col: sel.c1 } });
    let changes = [];
    for (let r = sel.r0 + 1; r <= sel.r1; r++) changes = changes.concat(this.hf.paste({ sheet: sid, row: r, col: sel.c0 }));
    if (sheet === this.active) this._refresh(changes);
    if (this.onChange) this.onChange();
  }

  move(dr, dc) {
    const r = this.sel.anchorR + dr, c = this.sel.anchorC + dc;
    this.select(r, c);
    this.scroll.focus();
  }

  _key(e) {
    if (this.editing && document.activeElement === this.input) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      const dr = k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0;
      const dc = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
      if (e.shiftKey) {
        const r = Math.max(0, Math.min(this.rows - 1, (this.sel.r1 === this.sel.anchorR ? this.sel.r0 : this.sel.r1) + dr));
        const c = Math.max(0, Math.min(this.cols - 1, (this.sel.c1 === this.sel.anchorC ? this.sel.c0 : this.sel.c1) + dc));
        this.extendTo(r, c);
      } else this.move(dr, dc);
    } else if (k === 'Enter' || k === 'F2') { e.preventDefault(); this.beginEdit(); }
    else if (k === 'Tab') { e.preventDefault(); this.move(0, e.shiftKey ? -1 : 1); }
    else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (this.readOnlySheets.has(this.active)) return;
      for (let r = this.sel.r0; r <= this.sel.r1; r++) for (let c = this.sel.c0; c <= this.sel.c1; c++) this.setCell(this.active, r, c, '');
      this._syncBar();
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') { e.preventDefault(); this.fillDown(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (this.readOnlySheets.has(this.active)) return;
      e.preventDefault();
      this.editing = { ...this.sel, sheet: this.active };
      this.input.value = k;
      this.input.focus();
      this._mirror(k);
    }
  }
}

export function formatValue(v, detailedType, hf) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'value' in v) return String(v.value);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (detailedType === 'NUMBER_DATE' && hf) {
      const d = hf.numberToDate(v);
      return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    }
    return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  }
  return String(v);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
