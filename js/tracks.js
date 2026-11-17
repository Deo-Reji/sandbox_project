// Track registry. Adding a track = one entry here + problems/<id>.json + tutorials/<id>.json + an engine module
// that implements { init(), run(code, ctx), check(problem, input) }.
import sqlEngine from './engines/sql.js';
import pandasEngine from './engines/pandas.js';
import excelEngine from './engines/excel.js';
import dbdesignEngine from './engines/dbdesign.js';
import explorationEngine from './engines/exploration.js';

export const TRACKS = [
  { id: 'sql', label: 'SQL', engine: sqlEngine, problems: 'problems/sql.json', tutorial: 'tutorials/sql.json', schemaSource: 'sql', itemStyle: 'difficulty' },
  { id: 'pandas', label: 'Pandas', engine: pandasEngine, problems: 'problems/pandas.json', tutorial: 'tutorials/pandas.json', schemaSource: 'sql', itemStyle: 'difficulty' },
  { id: 'excel', label: 'Excel', engine: excelEngine, problems: 'problems/excel.json', tutorial: 'tutorials/excel.json', schemaSource: 'excel', itemStyle: 'difficulty' },
  { id: 'dbdesign', label: 'Database Design', engine: dbdesignEngine, problems: 'problems/dbdesign.json', tutorial: 'tutorials/dbdesign.json', schemaSource: 'dbdesign', itemStyle: 'difficulty' },
  { id: 'exploration', label: 'Exploration', engine: explorationEngine, problems: 'problems/exploration.json', tutorial: 'tutorials/exploration.json', schemaSource: 'exploration', itemStyle: 'challenge' },
];

export function trackById(id) { return TRACKS.find((t) => t.id === id); }

export const DIFFICULTIES = [
  { key: 'easy', label: 'Easy', short: 'Easy' },
  { key: 'medium', label: 'Medium', short: 'Med' },
  { key: 'hard', label: 'Hard', short: 'Hard' },
];
