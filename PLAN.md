# PLAN.md — DataLab Sandbox v1

A static practice sandbox (SQL, pandas, Excel, Database Design, Exploration) on one
fictional dataset: "Saint Louis University" (fictional). Served from GitHub Pages, no backend.

## Stack

| Concern      | Choice                                                        |
|--------------|---------------------------------------------------------------|
| SQL          | sql.js 1.16.0 (SQLite 3.x WASM), vendored in `/vendor/sqljs`  |
| pandas       | Pyodide 0.28.3 from jsDelivr (pandas 2.3.1, numpy 2.2.5), lazy‑loaded in a Web Worker |
| Excel        | HyperFormula 3.5.0 (`licenseKey: 'gpl-v3'`), vendored, behind a custom grid |
| Editor       | CodeMirror 5.65.21 (sql + python modes), vendored             |
| UI           | Plain HTML/CSS/ES modules, relative paths, `.nojekyll`        |
| Data gen     | Python 3 standard library only (`data/generate.py`, `data/make_messy.py`) |
| Expected     | `data/build_expected.py` runs every reference solution (sqlite3 / pandas) and caches results into `/problems/*.json` |
| Tests        | Playwright (Chromium) in `/tests`, run by GitHub Actions on push |

## Repo structure

```
index.html            app shell
css/app.css           wireframe colours and layout
js/app.js             router (hash), view swapping, sidebar, localStorage progress
js/ui/*.js            editor, output pane, prompt pane, schema drawer, spreadsheet grid, ER diagram
js/engines/*.js       sql.js, pyodide (+ worker), hyperformula, dbdesign  — each exports { init, run, check }
js/checkers/*.js      result-table comparison, DDL behavioural checks, excel cell checks
vendor/               sql.js, HyperFormula, CodeMirror
data/                 generate.py, make_messy.py, build_expected.py, clean/*.csv, messy/*.csv,
                      schema.sql, university.sqlite, excel_extract.json, defects_manifest.json
problems/             sql.json pandas.json excel.json dbdesign.json exploration.json
tutorials/            sql.json pandas.json excel.json dbdesign.json exploration.json
tests/                playwright.config.js, sandbox.spec.js (the "definition of done" harness)
docs/schema.md        schema documentation + ER diagram (SVG)
.github/workflows     ci.yml → runs the Playwright harness
```

## Engine interface

```js
export default {
  id: 'sql',
  async init(ctx),                 // load WASM / CSVs; idempotent, cached
  async run(code, ctx),            // -> { columns, rows, truncated, total, stdout, error }
  async check(problem, userInput), // -> { pass, message, details }
}
```
The shell never knows what a track does; it only loads `problems/<track>.json`,
`tutorials/<track>.json`, and the engine named in the track config (`js/tracks.js`).
Adding a Machine Learning track later = one engine module + two JSON files + one entry in `tracks.js`.

## Build order (one commit per stage)

1. **Scaffold**: PLAN.md, DECISIONS.md, vendor libs, `.nojekyll`, `.gitignore`.
2. **Dataset**: `generate.py` → 21 CSVs + `schema.sql` + `university.sqlite`; `make_messy.py` → messy CSVs + `defects_manifest.json`; `docs/schema.md`.
3. **Engines**: sql.js engine, pyodide worker engine (timeout/cancel), HyperFormula engine + grid, dbdesign engine, result comparator.
4. **UI shell**: wireframe layout, tabs, sidebar, hash router, editor, output, prompt, schema drawer, ER diagram, hints/solution/reset, progress.
5. **Problems + tutorials**: 15 SQL, 15 pandas, 15 Excel, 15 DB design, 12 Exploration; `build_expected.py` caches expected outputs.
6. **Verification**: Playwright harness (reference passes, wrong answer fails, SELECT * fails, tutorials run, edge cases), GitHub Actions workflow, README, final report.
