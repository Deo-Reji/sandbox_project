// Exploration engine: the messy dataset, solvable in SQL or pandas (engine selector in the view).
// problem.starter / problem.solution are objects keyed by mode: {sql: '...', pandas: '...'}.
import { makeSqlEngine } from './sql.js';
import { makePandasEngine } from './pandas.js';
import { RAW_TABLES, RAW_REF_TABLES } from '../data.js';

export function makeExplorationEngine() {
  const sql = makeSqlEngine({ id: 'exploration-sql', dbUrl: 'data/messy/messy.sqlite', label: 'SQL (messy data)' });
  const pandas = makePandasEngine({ id: 'exploration-pandas', frameset: 'raw', label: 'pandas (messy data)', tables: [...RAW_TABLES, ...RAW_REF_TABLES] });
  let mode = 'sql';
  const current = () => (mode === 'pandas' ? pandas : sql);
  return {
    id: 'exploration',
    label: 'Exploration',
    kind: 'code',
    modes: ['sql', 'pandas'],
    get mode() { return mode; },
    setMode(m) { mode = m === 'pandas' ? 'pandas' : 'sql'; },
    get language() { return current().language; },
    get sub() { return current(); },
    async init() { await sql.init(); },           // pandas is lazy-loaded when the mode is switched
    async run(code, ctx) { return current().run(code, ctx); },
    async check(problem, code) { return current().check(problem, code); },
    async schema(force) { return sql.schema(force); },
    async reset() { await current().reset(); },
    cancel() { current().cancel(); },
    pickText(obj) { return obj && typeof obj === 'object' ? (obj[mode] ?? '') : (obj ?? ''); },
  };
}

export default makeExplorationEngine();
