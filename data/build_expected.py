#!/usr/bin/env python3
"""
Compute the expected output of every reference solution and cache it in problems/*.json.

  python data/build_expected.py            # rewrite problems/*.json with fresh "expected" blocks
  python data/build_expected.py --check    # exit 1 if any cached expected differs from a fresh run

Rules
- SQL / Exploration-SQL run on the committed SQLite files via CPython's sqlite3 (same dialect as sql.js).
- pandas / Exploration-pandas run through js/engines/pandas_prelude.py — the exact code the browser uses.
- Exploration problems have a SQL and a pandas solution; both must produce the same table.
- Excel problems have a pandas "oracle" expression; the HyperFormula formulas are verified against it
  by the Playwright harness, so the spreadsheet result is cross-checked by an independent computation.
- Every expected result must be non-empty and identical across two runs.
Also fills example.output (the first rows of the expected result) for the prompt panel.
"""
import json
import math
import os
import sqlite3
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "js", "engines"))
from pandas_prelude import load_frames, run_user, _scalar  # noqa: E402

import pandas as pd  # noqa: E402

CHECK = "--check" in sys.argv
EXAMPLE_ROWS = 2   # shape only; never enough rows to give the answer away


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def sql_table(db_path, sql):
    con = sqlite3.connect(db_path)
    try:
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description]
        rows = [[_scalar(v) for v in r] for r in cur.fetchall()]
    finally:
        con.close()
    return {"columns": cols, "rows": rows}


def pandas_table(code, frames):
    r = run_user(code, frames)
    if r["error"]:
        raise RuntimeError(r["error"])
    if not r["has_result"]:
        raise RuntimeError("solution did not assign `result`")
    return r["table"]


def norm(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def same_value(a, b, decimals=None, tol=1e-6):
    a, b = norm(a), norm(b)
    if a is None or b is None:
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if decimals is not None:
            return f"{a:.{decimals}f}" == f"{b:.{decimals}f}"
        return abs(a - b) <= tol * max(1, abs(a), abs(b))
    return str(a) == str(b)


def row_key(row, decimals):
    out = []
    for v in row:
        v = norm(v)
        if v is None:
            out.append("\0")
        elif isinstance(v, (int, float)):
            out.append("n" + f"{v:.{6 if decimals is None else decimals}f}")
        else:
            out.append("s" + str(v))
    return "\1".join(out)


def same_table(a, b, order_matters=False, decimals=None):
    if [c.lower() for c in a["columns"]] != [c.lower() for c in b["columns"]]:
        return False, f"columns {a['columns']} != {b['columns']}"
    if len(a["rows"]) != len(b["rows"]):
        return False, f"row count {len(a['rows'])} != {len(b['rows'])}"
    ra, rb = a["rows"], b["rows"]
    if not order_matters:
        ra = sorted(ra, key=lambda r: row_key(r, decimals))
        rb = sorted(rb, key=lambda r: row_key(r, decimals))
    for i, (x, y) in enumerate(zip(ra, rb)):
        for j, (p, q) in enumerate(zip(x, y)):
            if not same_value(p, q, decimals):
                return False, f"row {i} col {a['columns'][j]}: {p!r} != {q!r}"
    return True, ""


def example_output(table):
    n = len(table["rows"])
    rows = table["rows"][:EXAMPLE_ROWS] if n > 3 else []   # tiny results: show the columns only
    return {"columns": table["columns"], "rows": rows, "total": n}


def datedif_y(d1, d2):
    a, b = date.fromisoformat(str(d1)[:10]), date.fromisoformat(str(d2)[:10])
    return b.year - a.year - (1 if (b.month, b.day) < (a.month, a.day) else 0)


def main():
    problems_dir = os.path.join(ROOT, "problems")
    clean_dir = os.path.join(ROOT, "data", "clean")
    messy_dir = os.path.join(ROOT, "data", "messy")
    uni_db = os.path.join(ROOT, "data", "university.sqlite")
    messy_db = os.path.join(messy_dir, "messy.sqlite")

    clean_frames = load_frames({f[:-4]: read(os.path.join(clean_dir, f)) for f in sorted(os.listdir(clean_dir)) if f.endswith(".csv")})
    raw_frames = load_frames({n: read(os.path.join(messy_dir, n + ".csv")) for n in ["students_raw", "employees_raw", "enrollments_raw", "payments_raw"]}, raw=True)
    ref_frames = load_frames({n: read(os.path.join(clean_dir, n + ".csv")) for n in ["students", "employees", "sections", "departments", "terms", "courses"]})
    expl_frames = {**raw_frames, **ref_frames}
    extract = json.loads(read(os.path.join(ROOT, "data", "excel_extract.json")))
    X = {name: pd.DataFrame(sheet["rows"], columns=sheet["columns"]) for name, sheet in extract.items()}

    def fill(sheet, col, fn):
        df = X[sheet]
        return [[f"{sheet}!{col}{i + 2}", _scalar(fn(r))] for i, r in enumerate(df.itertuples(index=False))]

    changed = 0
    failures = 0
    for track in ["sql", "pandas", "exploration", "excel"]:
        path = os.path.join(problems_dir, track + ".json")
        problems = json.loads(read(path))
        for p in problems:
            decimals = p.get("decimals")
            try:
                if track == "sql":
                    exp = sql_table(uni_db, p["solution"])
                    again = sql_table(uni_db, p["solution"])
                elif track == "pandas":
                    exp = pandas_table(p["solution"], clean_frames)
                    again = pandas_table(p["solution"], clean_frames)
                elif track == "exploration":
                    exp = sql_table(messy_db, p["solution"]["sql"])
                    again = sql_table(messy_db, p["solution"]["sql"])
                    pdt = pandas_table(p["solution"]["pandas"], expl_frames)
                    ok, why = same_table(exp, pdt, p.get("orderMatters", False), decimals)
                    if not ok:
                        raise RuntimeError(f"SQL and pandas solutions disagree: {why}")
                else:  # excel
                    ns = {"X": X, "fill": fill, "datedif_y": datedif_y, "pd": pd}
                    exec(p["oracle"], ns)
                    cells = [[ref, _scalar(v)] for ref, v in ns["cells"]]
                    ns2 = {"X": X, "fill": fill, "datedif_y": datedif_y, "pd": pd}
                    exec(p["oracle"], ns2)
                    cells2 = [[ref, _scalar(v)] for ref, v in ns2["cells"]]
                    exp = {"cells": cells}
                    again = {"cells": cells2}
                    if not cells:
                        raise RuntimeError("oracle produced no cells")
                    if json.dumps(cells) != json.dumps(cells2):
                        raise RuntimeError("oracle is not deterministic")
                    p.setdefault("example", {}).pop("output", None)   # targets are shown in the output pane instead
                    if json.dumps(p.get("expected")) != json.dumps(exp):
                        changed += 1
                        p["expected"] = exp
                    print(f"  ok  {p['id']:22s} {len(cells)} cell(s)")
                    continue
                if not exp["rows"] or not exp["columns"]:
                    raise RuntimeError("expected result is empty")
                ok, why = same_table(exp, again, True, decimals)
                if not ok:
                    raise RuntimeError("solution is not deterministic: " + why)
                p.setdefault("example", {})["output"] = example_output(exp)
                if json.dumps(p.get("expected")) != json.dumps(exp):
                    changed += 1
                    p["expected"] = exp
                print(f"  ok  {p['id']:22s} {len(exp['rows']):5d} rows x {len(exp['columns'])} cols")
            except Exception as e:  # noqa: BLE001
                failures += 1
                print(f"  FAIL {p['id']}: {e}")
        if not CHECK:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(problems, fh, indent=2, ensure_ascii=False)
                fh.write("\n")
    print(f"\n{changed} expected block(s) {'out of date' if CHECK else 'updated'}, {failures} failure(s)")
    if failures or (CHECK and changed):
        sys.exit(1)


if __name__ == "__main__":
    main()
