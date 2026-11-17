// Tiny ER-diagram renderer: takes the introspection list (name, columns, foreignKeys) and returns SVG.
// Tables are laid out on a grid; foreign keys are drawn as lines with a dot at the referencing end.
import { escapeHtml } from './grid.js';

export function renderErd(schema, { maxCols = 5, boxW = 190, rowH = 15, gapX = 50, gapY = 40, compact = false } = {}) {
  if (!schema || !schema.length) return '<p class="muted">No tables yet.</p>';
  const tables = schema.map((t) => ({ ...t, shown: compact ? t.columns.slice(0, 6) : t.columns }));
  const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(tables.length * 1.4))));
  const pos = new Map();
  const colHeights = new Array(cols).fill(0);
  tables.forEach((t, i) => {
    const c = i % cols;
    const h = 24 + t.shown.length * rowH + (t.columns.length > t.shown.length ? rowH : 0) + 6;
    const x = 10 + c * (boxW + gapX);
    const y = 10 + colHeights[c];
    colHeights[c] += h + gapY;
    pos.set(t.name, { x, y, w: boxW, h });
  });
  const W = 20 + cols * (boxW + gapX) - gapX;
  const H = 20 + Math.max(...colHeights);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="erd">`];
  parts.push('<defs><marker id="erd-dot" markerWidth="6" markerHeight="6" refX="3" refY="3"><circle cx="3" cy="3" r="2.5" fill="#0528CC"/></marker></defs>');
  for (const t of tables) {
    const a = pos.get(t.name);
    for (const fk of t.foreignKeys) {
      const b = pos.get(fk.table);
      if (!b) continue;
      if (fk.table === t.name) {
        parts.push(`<path d="M${a.x + a.w} ${a.y + 12} C ${a.x + a.w + 30} ${a.y + 12}, ${a.x + a.w + 30} ${a.y + 40}, ${a.x + a.w} ${a.y + 40}" fill="none" stroke="#0528CC" stroke-width="1.5" marker-start="url(#erd-dot)"/>`);
        continue;
      }
      const [x1, y1] = [a.x + a.w / 2, a.y + a.h / 2];
      const [x2, y2] = [b.x + b.w / 2, b.y + b.h / 2];
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0528CC" stroke-width="1.2" stroke-opacity="0.55" marker-start="url(#erd-dot)"><title>${escapeHtml(t.name)}.${escapeHtml(fk.from)} → ${escapeHtml(fk.table)}.${escapeHtml(fk.to)}</title></line>`);
    }
  }
  for (const t of tables) {
    const p = pos.get(t.name);
    parts.push(`<g><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="#fff" stroke="#BE40DC" stroke-width="1.5"/>`);
    parts.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="22" rx="8" fill="#BE40DC"/><rect x="${p.x}" y="${p.y + 12}" width="${p.w}" height="10" fill="#BE40DC"/>`);
    parts.push(`<text x="${p.x + 8}" y="${p.y + 15}" font-size="12" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">${escapeHtml(t.name)}</text>`);
    const fkCols = new Set(t.foreignKeys.map((f) => f.from.toLowerCase()));
    t.shown.forEach((c, i) => {
      const y = p.y + 24 + (i + 1) * rowH - 4;
      const tag = c.pk > 0 ? 'PK' : fkCols.has(c.name.toLowerCase()) ? 'FK' : '';
      parts.push(`<text x="${p.x + 8}" y="${y}" font-size="11" font-family="ui-monospace, monospace" fill="#222">${tag ? `<tspan font-weight="700" fill="#0528CC">${tag} </tspan>` : ''}${escapeHtml(c.name)}<tspan fill="#777"> ${escapeHtml(c.type || '')}</tspan></text>`);
    });
    if (t.columns.length > t.shown.length) parts.push(`<text x="${p.x + 8}" y="${p.y + 24 + (t.shown.length + 1) * rowH - 4}" font-size="11" fill="#777" font-family="system-ui">… ${t.columns.length - t.shown.length} more</text>`);
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}
