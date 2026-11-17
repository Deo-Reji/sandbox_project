# DataLab Sandbox

A static practice sandbox for **SQL, pandas, Excel formulas, database design and messy-data exploration**, all on one fictional dataset: a university modelled on Saint Louis University. Everything runs in the browser. There is no backend, no account and no API key.

| Tab | Engine | Content |
|---|---|---|
| SQL | sql.js (SQLite 3 compiled to WebAssembly), vendored | tutorial, sandbox, 15 problems |
| Pandas | Pyodide 0.28.3 with pandas 2.3 and numpy 2.2, lazy-loaded from jsDelivr | tutorial, sandbox, 15 problems |
| Excel | HyperFormula 3.5 (GPL v3) behind a custom grid, vendored | tutorial, sandbox workbook, 15 problems |
| Database Design | sql.js on an empty database, graded by behaviour | tutorial, sandbox, 15 problems (14 DDL, 1 multiple choice) |
| Exploration | messy raw tables in SQL or pandas | data-quality guide, sandbox, 12 challenges |

> All people, places and numbers are fictional.

## Publish on GitHub Pages

1. Push this repository to GitHub (the site lives at the root of `main`).
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose branch **main** and folder **/ (root)**, then click **Save**.
5. After a minute the site is live at `https://<user>.github.io/<repo>/`.

All asset paths are relative, and `.nojekyll` stops Jekyll from skipping files.

## Run locally

`fetch()` does not work from `file://`, so serve the folder over HTTP:

```bash
python -m http.server 8000
# open http://localhost:8000/
```

The pandas tab needs internet access the first time, because Pyodide comes from jsDelivr. Everything else is vendored.

Deep links work: `#sql/medium-2`, `#pandas/tutorial`, `#exploration/challenge-4`, `#excel/sandbox`.

## Regenerate the data

```bash
python data/generate.py      # clean CSVs, schema.sql, university.sqlite, excel_extract.json, docs/schema.md
python data/make_messy.py    # messy CSVs, messy.sqlite, defects_manifest.json
pip install pandas numpy     # needed only for the next step
python data/build_expected.py   # runs every reference solution and caches "expected" in problems/*.json
```

Both generators use only the standard library and a fixed seed, so the output is identical on every run. `build_expected.py --check` exits non-zero if a cached expected result is stale.

## Run the verification harness

```bash
npm ci
npx playwright install chromium
npm test        # = npx playwright test --config tests/playwright.config.js
```

The harness starts its own static server. For every problem in every track it:

- injects the reference solution, clicks **Check Answer** and asserts PASS, twice, with identical results;
- submits wrong answers and asserts FAIL with a sensible message. These include an off-by-one row count, a missing column, a reversed order, `SELECT *` or a whole table, a hard-coded Excel value, an Excel error formula, and DDL with its constraints stripped;
- runs every tutorial example;
- covers edge cases: syntax errors, empty submissions, SQL and Python infinite loops, result truncation, non-SELECT statements in graded SQL, state reset on navigation, blocked file and network access, and deep links.

It prints a summary table and writes it to `tests/last-summary.md`. GitHub Actions runs the same job on every push (`.github/workflows/ci.yml`).

## Repository layout

```
index.html            app shell (wireframe layout)
css/app.css           colours and layout
js/app.js             tabs, sidebar, hash router, editor, output, prompt, schema drawer, hints
js/tracks.js          track registry (the only place tracks are listed)
js/engines/           sql.js, pandas.js (+ workers, shared Python prelude), excel.js, dbdesign.js, exploration.js
js/checkers/          compare.js (result tables), ddl.js (behavioural DDL checks)
js/ui/                grid.js (spreadsheet), erd.js (ER diagram SVG), markdown.js
vendor/               sql.js, HyperFormula, CodeMirror 5
data/                 generators, clean/ and messy/ CSVs, SQLite files, schema.sql
problems/             <track>.json with prompts, hints, solutions and cached expected results
tutorials/            <track>.json with function references and runnable examples
tests/                Playwright harness
docs/schema.md        schema documentation and Mermaid ER diagram
```

## Add a problem

1. Append an object to `problems/<track>.json`. The SQL and pandas format is:

   ```json
   { "id": "sql-medium-6", "track": "sql", "difficulty": "medium", "title": "...",
     "tags": ["join"], "prompt_md": "...", "example": { "input_md": "..." },
     "hints": ["...", "..."], "starter": "-- write your query\n",
     "orderMatters": false, "decimals": 2, "solution": "SELECT ..." }
   ```

   - Exploration problems use `{ "sql": "...", "pandas": "..." }` for `starter` and `solution`.
   - Excel problems use `setup`, `answerCells`, `solution` (a list of cell and formula pairs), an optional `solutionFill`, and an `oracle`: a pandas expression that computes the target values independently.
   - Database Design problems use `checks`, a list of `sql_ok`, `sql_fail`, `query` and `schema` steps (see `js/checkers/ddl.js`).
2. Run `python data/build_expected.py`. It fills in `expected` and the example output. Never type expected values by hand.
3. Run `npm test`. The new problem is picked up automatically, and the sidebar shows up to five problems per difficulty.

## Add a track (for example, machine learning principles)

A track is data plus one engine. The shell does not change.

1. Write `js/engines/<id>.js` exporting `{ id, label, kind: 'code' | 'grid', language, init(), run(code, ctx), check(problem, input), reset(), cancel() }`. A Python-based track can reuse `makePandasEngine` and add packages in `pandas.worker.js`, for example scikit-learn from Pyodide.
2. Add `problems/<id>.json` and `tutorials/<id>.json`.
3. Add one entry to `TRACKS` in `js/tracks.js`. The tab, sidebar, routing, hints, progress tracking and harness loop come for free. Add a `codeTrack(page, '<id>', ...)` call in `tests/sandbox.spec.js` to cover it.

## Licences

The vendored libraries keep their own licences. sql.js is MIT, CodeMirror 5 is MIT, and HyperFormula is used under GPL v3 (`licenseKey: 'gpl-v3'`). Pyodide (MPL 2.0) is loaded from its CDN.
