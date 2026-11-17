# Shared Python prelude for the pandas engine.
# Used verbatim by the browser worker (Pyodide) AND by data/build_expected.py (CPython),
# so the reference solutions are evaluated by exactly the same loading/serialisation rules.
import builtins
import contextlib
import io
import json
import math
import sys
import traceback

import numpy as np
import pandas as pd

pd.set_option("display.width", 160)
pd.set_option("display.max_columns", 40)


def load_frames(csv_texts, raw=False):
    """Clean tables: inferred dtypes, *_id columns with NULLs become nullable Int64.
    Raw (Exploration) tables: every column is text, '' stays '', nothing becomes NaN."""
    frames = {}
    for name, text in csv_texts.items():
        if raw:
            df = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
        else:
            df = pd.read_csv(io.StringIO(text), dtype={"section_number": str, "room_number": str})
            for c in df.columns:
                if c.endswith("_id") and df[c].isna().any():
                    df[c] = df[c].astype("Int64")
        frames[name] = df
    return frames


def _scalar(v):
    if v is None:
        return None
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(v, pd.Timestamp):
        if v.hour == 0 and v.minute == 0 and v.second == 0:
            return v.strftime("%Y-%m-%d")
        return v.isoformat()
    if isinstance(v, pd.Timedelta):
        return float(v.total_seconds() / 86400.0)
    if isinstance(v, str):
        return v
    if isinstance(v, (np.ndarray, list, tuple, set, frozenset)):
        return json.dumps([_scalar(x) for x in (sorted(v) if isinstance(v, (set, frozenset)) else v)])
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return str(v)


def to_table(obj):
    """Convert whatever the user assigned to `result` into {'columns': [...], 'rows': [[...]]}."""
    if obj is None:
        return None
    if isinstance(obj, pd.Series):
        if isinstance(obj.index, pd.RangeIndex) and obj.index.name is None:
            obj = obj.to_frame(name=obj.name if obj.name is not None else "result")
        else:
            obj = obj.reset_index()
            if obj.columns[-1] == 0:
                obj = obj.rename(columns={0: "value"})
    if isinstance(obj, pd.DataFrame):
        df = obj
        if isinstance(df.index, pd.MultiIndex) or df.index.name is not None:
            df = df.reset_index()
        cols = []
        for c in df.columns:
            if isinstance(c, tuple):
                cols.append("_".join(str(x) for x in c if str(x) != ""))
            else:
                cols.append(str(c))
        rows = [[_scalar(v) for v in row] for row in df.itertuples(index=False, name=None)]
        return {"columns": cols, "rows": rows}
    if isinstance(obj, dict):
        return {"columns": [str(k) for k in obj.keys()], "rows": [[_scalar(v) for v in obj.values()]]}
    if isinstance(obj, (list, tuple)) and obj and all(not isinstance(x, (list, tuple, dict)) for x in obj):
        return {"columns": ["result"], "rows": [[_scalar(x)] for x in obj]}
    return {"columns": ["result"], "rows": [[_scalar(obj)]]}


def _blocked(*args, **kwargs):
    raise PermissionError("File and network access are disabled in this sandbox.")


def harden():
    """Best-effort: no files, no network. This is a browser sandbox, not a security boundary."""
    builtins.open = _blocked
    for m in ("socket", "urllib", "urllib.request", "http", "http.client", "requests", "pyodide.http",
              "subprocess", "ftplib", "smtplib", "telnetlib", "xmlrpc"):
        sys.modules[m] = None


def _format_error(exc):
    tb = traceback.extract_tb(exc.__traceback__)
    user_lines = [f.lineno for f in tb if f.filename == "<your code>"]
    line = user_lines[-1] if user_lines else getattr(exc, "lineno", None)
    name = type(exc).__name__
    msg = str(exc)
    if isinstance(exc, SyntaxError):
        line = exc.lineno
        msg = exc.msg
    where = f" (line {line})" if line else ""
    return f"{name}: {msg}{where}"


def run_user(code, base_frames):
    """Execute user code in a fresh namespace. Returns a JSON-serialisable dict."""
    ns = {"pd": pd, "np": np, "__name__": "__main__", "__builtins__": builtins}
    for k, v in base_frames.items():
        ns[k] = v.copy()
    out = io.StringIO()
    err = None
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        try:
            exec(compile(code, "<your code>", "exec"), ns)
        except BaseException as e:  # noqa: BLE001 - we want to report everything, incl. SystemExit
            err = _format_error(e)
    table = None
    has_result = "result" in ns
    if err is None and has_result:
        try:
            table = to_table(ns["result"])
        except Exception as e:  # noqa: BLE001
            err = f"Could not convert `result` to a table: {type(e).__name__}: {e}"
    text = out.getvalue()
    if len(text) > 20000:
        text = text[:20000] + "\n... (output truncated)"
    return {"stdout": text, "error": err, "table": table, "has_result": has_result}
