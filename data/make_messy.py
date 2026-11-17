#!/usr/bin/env python3
"""
Derive the Exploration tab's messy tables from the clean CSVs, deterministically.

Reads  data/clean/{students,employees,enrollments,tuition_payments}.csv
Writes data/messy/{students_raw,employees_raw,enrollments_raw,payments_raw}.csv
       data/messy/defects_manifest.json   (hidden ground truth used by build_expected.py)

Every value in the messy CSVs is text, exactly as a raw export would arrive.
Standard library only, fixed seed.
"""
import csv
import json
import os
import random
from datetime import date

SEED = 7
HERE = os.path.dirname(os.path.abspath(__file__))
CLEAN = os.path.join(HERE, "clean")
MESSY = os.path.join(HERE, "messy")
rng = random.Random(SEED)
manifest = {"seed": SEED, "tables": {}}


def read(name):
    with open(os.path.join(CLEAN, f"{name}.csv"), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def write(name, rows, cols):
    os.makedirs(MESSY, exist_ok=True)
    with open(os.path.join(MESSY, f"{name}.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c, "") for c in cols])


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def mixed_date(iso, p=0.3):
    """Return the ISO date, or (with probability p) one of several other formats."""
    if not iso or rng.random() > p:
        return iso
    d = date.fromisoformat(iso)
    return rng.choice([f"{d.month:02d}/{d.day:02d}/{d.year}", f"{d.month}/{d.day}/{d.year}",
                       f"{MONTHS[d.month - 1]} {d.day}, {d.year}", f"{d.day:02d}-{MONTHS[d.month - 1]}-{d.year}",
                       f"{d.year}/{d.month:02d}/{d.day:02d}"])


def money(v, p=0.35):
    if rng.random() > p:
        return v
    x = float(v)
    return rng.choice([f"${x:,.2f}", f"{x:,.2f}", f"$ {x:.0f}", f"{x:.2f} USD"])


STATE_VARIANTS = {"MO": ["Missouri", "mo", "mo.", " MO", "MO ", "Mo"], "IL": ["Illinois", "il", "IL ", "Ill."],
                  "KS": ["Kansas", "ks"], "TX": ["Texas", "tx"], "CA": ["California", "ca"],
                  "WI": ["Wisconsin"], "MN": ["Minnesota"], "IN": ["Indiana"], "OH": ["Ohio"], "TN": ["Tennessee"]}
STATUS_VARIANTS = {"active": ["Active", "ACTIVE", "active ", " active", "act."],
                   "graduated": ["Graduated", "GRADUATED", "grad"], "withdrawn": ["Withdrawn", "withdrew"],
                   "leave": ["Leave", "on leave", "LEAVE"]}
PLACEHOLDERS = ["", "N/A", "unknown", "-1", "9999", "TBD", "null", "NULL", "?"]


def messy_case(s):
    return rng.choice([s.upper(), s.lower(), f" {s}", f"{s} ", f"  {s}", s.title()])


# ================================================================ students_raw
students = read("students")
cols = ["student_id", "first_name", "last_name", "email", "birth_date", "home_state", "home_city",
        "enrollment_year", "gpa", "advisor_id", "status"]
rows = [dict(r) for r in students]
m = {"source_rows": len(rows)}

# GPA: true NULLs stay '' (empty); add placeholders and impossible values
gpa_missing_ids = {r["student_id"] for r in rows if r["gpa"] == ""}
gpa_placeholder_ids = set()
for r in rng.sample([r for r in rows if r["gpa"] != ""], 38):
    r["gpa"] = rng.choice(["", "N/A", "-1", "unknown", "", "-1", "N/A"])
    gpa_placeholder_ids.add(r["student_id"])
gpa_missing_ids |= gpa_placeholder_ids
impossible_gpa = rng.sample([r for r in rows if r["gpa"] not in ("", "N/A", "-1", "unknown")], 4)
for r, v in zip(impossible_gpa, ["7.2", "5.5", "4.8", "12"]):
    r["gpa"] = v
m["gpa_missing_or_placeholder"] = len(gpa_missing_ids)
m["gpa_impossible_over_4"] = len(impossible_gpa)
m["gpa_impossible_ids"] = sorted(int(r["student_id"]) for r in impossible_gpa)

# birth_date: mixed formats + impossible years
for r in rows:
    r["birth_date"] = mixed_date(r["birth_date"], 0.3)
bad_birth = rng.sample(rows, 3)
for r, v in zip(bad_birth, ["2090-04-12", "1899-01-01", "2091-11-30"]):
    r["birth_date"] = v
m["birth_year_impossible"] = len(bad_birth)

# home_state: variants, casing and whitespace
state_messed = 0
for r in rows:
    if r["home_state"] in STATE_VARIANTS and rng.random() < 0.35:
        r["home_state"] = rng.choice(STATE_VARIANTS[r["home_state"]])
        state_messed += 1
m["home_state_nonstandard_values"] = state_messed
# status labels
for r in rows:
    if rng.random() < 0.3:
        r["status"] = rng.choice(STATUS_VARIANTS[r["status"]])
# names: casing/whitespace
for r in rows:
    if rng.random() < 0.15:
        r["first_name"] = messy_case(r["first_name"])
    if rng.random() < 0.15:
        r["last_name"] = messy_case(r["last_name"])
# advisor: orphans + placeholder
orphan_adv = rng.sample([r for r in rows if r["advisor_id"] != ""], 9)
for r in orphan_adv:
    r["advisor_id"] = rng.choice(["9999", "8888", "777", "9999"])
m["advisor_orphans"] = len(orphan_adv)
for r in rng.sample([r for r in rows if r["advisor_id"] != "" and r not in orphan_adv], 6):
    r["advisor_id"] = rng.choice(["TBD", "N/A", "unknown"])
# duplicates: exact copies and near duplicates (same person, different casing/whitespace, same id)
exact_dups = [dict(r) for r in rng.sample(rows, 6)]
near_src = rng.sample([r for r in rows if r not in exact_dups], 8)
near_dups = []
for r in near_src:
    d = dict(r)
    d["first_name"] = messy_case(r["first_name"].strip())
    d["last_name"] = messy_case(r["last_name"].strip())
    d["email"] = r["email"].upper() if rng.random() < 0.5 else " " + r["email"]
    near_dups.append(d)
m["exact_duplicate_extra_rows"] = len(exact_dups)
m["near_duplicate_groups"] = len(near_dups)
m["duplicate_student_ids"] = sorted({int(r["student_id"]) for r in exact_dups + near_dups})
# column shift in a few rows: home_city missing -> everything after shifts left, last column empty
shifted = rng.sample([r for r in rows if r not in exact_dups and r not in near_src], 4)
for r in shifted:
    vals = [r[c] for c in cols]
    i = cols.index("home_city")
    vals = vals[:i] + vals[i + 1:] + [""]
    for c, v in zip(cols, vals):
        r[c] = v
m["shifted_rows"] = len(shifted)
m["shifted_student_ids"] = sorted(int(r["student_id"]) for r in shifted)
all_rows = rows + exact_dups + near_dups
rng.shuffle(all_rows)
m["total_rows"] = len(all_rows)
m["distinct_student_ids"] = len({r["student_id"] for r in all_rows})
# ground truth for "standardize state": count per canonical state over DISTINCT student_id, excluding shifted rows
canon = {}
seen_ids = set()
for r in all_rows:
    if r["student_id"] in seen_ids or int(r["student_id"]) in m["shifted_student_ids"]:
        continue
    seen_ids.add(r["student_id"])
    s = r["home_state"].strip().rstrip(".").upper()
    full = {"MISSOURI": "MO", "ILLINOIS": "IL", "ILL": "IL", "KANSAS": "KS", "TEXAS": "TX", "CALIFORNIA": "CA",
            "WISCONSIN": "WI", "MINNESOTA": "MN", "INDIANA": "IN", "OHIO": "OH", "TENNESSEE": "TN"}
    s = full.get(s, s)
    canon[s] = canon.get(s, 0) + 1
m["students_per_canonical_state"] = dict(sorted(canon.items()))
write("students_raw", all_rows, cols)
manifest["tables"]["students_raw"] = m

# ================================================================ employees_raw
emps = read("employees")
cols = ["employee_id", "first_name", "last_name", "email", "title", "department_id", "manager_id", "salary",
        "hire_date", "employee_type", "status"]
rows = [dict(r) for r in emps]
m = {"source_rows": len(rows)}
text_salary = 0
for r in rows:
    v = money(r["salary"], 0.35)
    if v != r["salary"]:
        text_salary += 1
    r["salary"] = v
m["salary_stored_as_text"] = text_salary
sal_missing = rng.sample(rows, 7)
for r in sal_missing:
    r["salary"] = rng.choice(["", "N/A", "-1", "unknown"])
m["salary_missing_or_placeholder"] = len(sal_missing)
m["salary_true_total"] = sum(int(e["salary"]) for e in emps if e["employee_id"] not in {r["employee_id"] for r in sal_missing})
for r in rows:
    r["hire_date"] = mixed_date(r["hire_date"], 0.3)
    if rng.random() < 0.2:
        r["title"] = messy_case(r["title"])
    if rng.random() < 0.15:
        r["employee_type"] = rng.choice(["Faculty", "FACULTY", "fac", "Staff", "STAFF"]) if rng.random() < 0.5 else r["employee_type"]
orphan_dept = rng.sample([r for r in rows if r["department_id"] != ""], 5)
for r in orphan_dept:
    r["department_id"] = rng.choice(["99", "100", "-1"])
m["department_orphans"] = len(orphan_dept)
m["department_orphan_ids"] = sorted(int(r["employee_id"]) for r in orphan_dept)
tbd_mgr = rng.sample([r for r in rows if r["manager_id"] != ""], 4)
for r in tbd_mgr:
    r["manager_id"] = rng.choice(["TBD", "N/A"])
m["manager_placeholder"] = len(tbd_mgr)
dups = [dict(r) for r in rng.sample(rows, 5)]
m["exact_duplicate_extra_rows"] = len(dups)
all_rows = rows + dups
rng.shuffle(all_rows)
m["total_rows"] = len(all_rows)
write("employees_raw", all_rows, cols)
manifest["tables"]["employees_raw"] = m

# ================================================================ enrollments_raw
enr = read("enrollments")
sections = read("sections")
valid_sections = {s["section_id"] for s in sections}
cols = ["enrollment_id", "student_id", "section_id", "enrolled_on", "status", "grade", "grade_points"]
sub = rng.sample(enr, 1500)
sub.sort(key=lambda r: int(r["enrollment_id"]))
rows = [dict(r) for r in sub]
m = {"source_rows": len(rows)}
orphans = rng.sample(rows, 12)
for r in orphans:
    r["section_id"] = str(rng.choice([99999, 88888, 70001, 70002]))
m["section_orphans"] = len(orphans)
m["section_orphan_enrollment_ids"] = sorted(int(r["enrollment_id"]) for r in orphans)
GRADE_VARIANTS = {"A": ["a", "A ", " A"], "A-": ["a-", "A- "], "B+": ["b+", "B plus"], "B": ["b", " B"],
                  "B-": ["b-"], "C+": ["c+"], "C": ["c", "C "], "C-": ["c-"], "D": ["d"], "F": ["f", "F "], "W": ["w"]}
grade_messed = 0
for r in rows:
    if r["grade"] in GRADE_VARIANTS and rng.random() < 0.25:
        r["grade"] = rng.choice(GRADE_VARIANTS[r["grade"]])
        grade_messed += 1
    r["enrolled_on"] = mixed_date(r["enrolled_on"], 0.3)
    if rng.random() < 0.2:
        r["status"] = messy_case(r["status"])
m["grade_nonstandard_values"] = grade_messed
gp_ph = rng.sample([r for r in rows if r["grade_points"] != ""], 20)
for r in gp_ph:
    r["grade_points"] = rng.choice(["N/A", "-1", "", "null"])
m["grade_points_placeholder"] = len(gp_ph)
dups = [dict(r) for r in rng.sample(rows, 15)]
m["exact_duplicate_extra_rows"] = len(dups)
all_rows = rows + dups
rng.shuffle(all_rows)
m["total_rows"] = len(all_rows)
# ground truth: count of A grades (any casing/whitespace) over distinct enrollment_id
seen, a_count = set(), 0
for r in all_rows:
    if r["enrollment_id"] in seen:
        continue
    seen.add(r["enrollment_id"])
    if r["grade"].strip().upper() == "A":
        a_count += 1
m["distinct_enrollments_with_grade_A"] = a_count
write("enrollments_raw", all_rows, cols)
manifest["tables"]["enrollments_raw"] = m

# ================================================================ payments_raw
pay = read("tuition_payments")
students_ids = {s["student_id"] for s in students}
cols = ["payment_id", "student_id", "term_id", "amount", "paid_on", "method", "status"]
sub = rng.sample(pay, 1200)
sub.sort(key=lambda r: int(r["payment_id"]))
rows = [dict(r) for r in sub]
m = {"source_rows": len(rows)}
text_amount = 0
for r in rows:
    v = money(r["amount"], 0.4)
    if v != r["amount"]:
        text_amount += 1
    r["amount"] = v
    r["paid_on"] = mixed_date(r["paid_on"], 0.3)
    if rng.random() < 0.2:
        r["status"] = messy_case(r["status"])
    if rng.random() < 0.15:
        r["method"] = messy_case(r["method"])
m["amount_stored_as_text"] = text_amount
neg = rng.sample(rows, 6)
for r in neg:
    r["amount"] = "-" + r["amount"].replace("$", "").replace(",", "").replace(" USD", "").strip()
m["negative_amounts"] = len(neg)
ph = rng.sample([r for r in rows if r not in neg], 8)
for r in ph:
    r["amount"] = rng.choice(["", "N/A", "9999", "TBD"])
m["amount_missing_or_placeholder"] = len(ph)
orph = rng.sample(rows, 7)
for r in orph:
    r["student_id"] = str(rng.choice([99901, 99902, 42, 1]))
m["student_orphans"] = len(orph)
dups = [dict(r) for r in rng.sample(rows, 10)]
m["exact_duplicate_extra_rows"] = len(dups)
all_rows = rows + dups
rng.shuffle(all_rows)
m["total_rows"] = len(all_rows)
# ground truth: sum of valid positive amounts over distinct payment_id, status posted (any casing)
seen, total = set(), 0.0
for r in all_rows:
    if r["payment_id"] in seen:
        continue
    seen.add(r["payment_id"])
    raw = r["amount"].replace("$", "").replace(",", "").replace("USD", "").strip()
    try:
        x = float(raw)
    except ValueError:
        continue
    if x <= 0 or raw == "9999":
        continue
    if r["status"].strip().lower() == "posted":
        total += x
m["posted_amount_total_clean"] = round(total, 2)
write("payments_raw", all_rows, cols)
manifest["tables"]["payments_raw"] = m

with open(os.path.join(MESSY, "defects_manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2)
for t, mm in manifest["tables"].items():
    print(t, {k: v for k, v in mm.items() if not isinstance(v, (list, dict))})
