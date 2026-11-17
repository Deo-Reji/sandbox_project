#!/usr/bin/env python3
"""
Deterministic generator for the fictional "Saint Louis University" dataset.

Standard library only. Fixed seed. Produces:
  data/clean/*.csv          one CSV per table (NULL = empty field)
  data/schema.sql           DDL with real PRIMARY KEY / FOREIGN KEY constraints
  data/university.sqlite    prebuilt SQLite database (FKs enforced while loading)
  data/excel_extract.json   smaller per-sheet extracts for the Excel track
  docs/schema.md            schema documentation (Mermaid ER diagram)

All people, places and numbers are fictional.
"""
import csv
import json
import os
import random
import sqlite3
from datetime import date, timedelta

SEED = 42
HERE = os.path.dirname(os.path.abspath(__file__))
CLEAN = os.path.join(HERE, "clean")
ROOT = os.path.dirname(HERE)
rng = random.Random(SEED)

# ---------------------------------------------------------------- name pools
FIRST_NAMES = """Aiden Amara Amelia Andre Anika Asha Ava Benjamin Bianca Caleb Camila Carter Chloe
Daniel Darius David Deja Diego Elena Eli Elijah Emma Ethan Evelyn Fatima Felix Gabriel Grace Hannah
Harper Henry Imani Isaac Isabella Jack Jada Jamal James Jasmine Javier Jonah Jordan Josephine Julia
Kai Kenji Kiara Leah Leo Liam Lucas Luis Luna Maya Mia Miguel Mila Nadia Naomi Nathan Nia Noah
Olivia Omar Owen Priya Quinn Rahul Riley Rosa Ruby Samuel Santiago Sara Sofia Sophia Tariq Theo
Tomas Valeria Victor Wei Willa Xavier Yara Yusuf Zara Zoe""".split()
LAST_NAMES = """Abbott Adeyemi Alvarez Anderson Baker Bennett Brooks Campbell Carter Chen Clark Cole
Cruz Dawson Delgado Diaz Edwards Ellis Evans Flores Foster Garcia Gomez Green Gupta Hall Hayes
Hernandez Hoffman Howard Hughes Ibrahim Jackson Jenkins Johnson Jones Kelly Khan Kim King Lee Lewis
Lopez Martin Martinez Mitchell Moore Morgan Murphy Nakamura Nelson Nguyen Okafor Ortiz Owens Park
Patel Perez Peterson Price Ramirez Reed Reyes Rivera Roberts Robinson Rossi Ruiz Sanders Santos
Schmidt Scott Shah Silva Singh Smith Stewart Sullivan Taylor Thomas Torres Turner Walker Wang Ward
Watson White Williams Wilson Wright Young Zhang""".split()

STATES = (["MO"] * 40 + ["IL"] * 22 + ["KS"] * 5 + ["TX"] * 5 + ["CA"] * 4 + ["WI"] * 3 +
          ["MN"] * 3 + ["IN"] * 3 + ["OH"] * 3 + ["TN"] * 2 + ["NY"] * 2 + ["CO"] * 2 +
          ["IA", "KY", "AR", "GA", "FL", "MI", "NE", "OK"])
CITIES = {
    "MO": ["St. Louis", "Kansas City", "Columbia", "Springfield", "Chesterfield", "Kirkwood"],
    "IL": ["Chicago", "Belleville", "Edwardsville", "Naperville", "Peoria"],
    "KS": ["Overland Park", "Wichita"], "TX": ["Dallas", "Houston", "Austin"],
    "CA": ["San Diego", "Sacramento"], "WI": ["Milwaukee", "Madison"], "MN": ["Minneapolis"],
    "IN": ["Indianapolis"], "OH": ["Cincinnati", "Columbus"], "TN": ["Nashville", "Memphis"],
    "NY": ["Buffalo"], "CO": ["Denver"], "IA": ["Des Moines"], "KY": ["Louisville"],
    "AR": ["Little Rock"], "GA": ["Atlanta"], "FL": ["Tampa"], "MI": ["Detroit"],
    "NE": ["Omaha"], "OK": ["Tulsa"],
}


# ---------------------------------------------------------------- helpers
def pick_name(used):
    while True:
        f, l = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
        if (f, l) not in used:
            used.add((f, l))
            return f, l


def email(first, last, n, domain):
    return f"{first.lower()}.{last.lower()}{n}@{domain}"


def rdate(y0, y1):
    d0, d1 = date(y0, 1, 1), date(y1, 12, 31)
    return d0 + timedelta(days=rng.randint(0, (d1 - d0).days))


def iso(d):
    return d.isoformat() if d else None


# ---------------------------------------------------------------- colleges / buildings / departments
colleges = [
    (1, "College of Arts and Sciences", "CAS", 1818),
    (2, "School of Business", "BUS", 1910),
    (3, "School of Science and Engineering", "SSE", 1928),
    (4, "School of Nursing and Health Sciences", "NHS", 1928),
]

buildings = [
    # id, name, abbr, address, year_built, type
    (1, "DuBourg Hall", "DUB", "221 N Grand Blvd", 1888, "admin"),
    (2, "Ritter Hall", "RIT", "220 N Grand Blvd", 1938, "academic"),
    (3, "Macelwane Hall", "MAC", "3507 Laclede Ave", 1960, "academic"),
    (4, "Monsanto Hall", "MON", "3507 Laclede Ave", 1965, "academic"),
    (5, "Cook Hall", "COO", "3674 Lindell Blvd", 2001, "academic"),
    (6, "McDonnell Douglas Hall", "MDH", "3450 Lindell Blvd", 1991, "academic"),
    (7, "Morrissey Hall", "MOR", "3700 Lindell Blvd", 2009, "academic"),
    (8, "Interdisciplinary Science Building", "ISB", "3400 Lindell Blvd", 2020, "academic"),
    (9, "Pius XII Memorial Library", "LIB", "3650 Lindell Blvd", 1959, "academic"),
    (10, "Griesedieck Hall", "GRI", "3630 West Pine Mall", 1964, "residence"),
    (11, "Reinert Hall", "REI", "3601 Olive St", 1974, "residence"),
    (12, "Spring Hall", "SPR", "3701 Laclede Ave", 2017, "residence"),
    (13, "Marguerite Hall", "MAR", "3520 Laclede Ave", 1965, "residence"),
    (14, "Fusz Hall", "FUS", "3700 West Pine Mall", 1965, "residence"),
    (15, "Trudy Busch Valentine Hall", "TBV", "3525 Caroline St", 1972, "academic"),
    (16, "Student Center", "STC", "20 N Grand Blvd", 2008, "admin"),
]

# departments: id, college_id, name, code, building_id, size_class
departments = [
    (1, 1, "Biology", "BIOL", 3, "huge"),
    (2, 1, "Chemistry", "CHEM", 4, "large"),
    (3, 1, "English", "ENGL", 7, "medium"),
    (4, 1, "History", "HIST", 7, "medium"),
    (5, 1, "Mathematics and Statistics", "MATH", 2, "large"),
    (6, 1, "Philosophy", "PHIL", 7, "small"),
    (7, 1, "Psychology", "PSY", 2, "large"),
    (8, 1, "Sociology and Anthropology", "SOC", 2, "small"),
    (9, 1, "Political Science", "POLS", 7, "medium"),
    (10, 1, "Theological Studies", "THEO", 7, "medium"),
    (11, 1, "Classics", "CLAS", 7, "tiny"),
    (12, 1, "Communication", "CMM", 2, "medium"),
    (13, 1, "Fine and Performing Arts", "FPA", 5, "medium"),
    (14, 2, "Accounting", "ACCT", 5, "medium"),
    (15, 2, "Finance", "FIN", 5, "medium"),
    (16, 2, "Marketing", "MKT", 5, "medium"),
    (17, 2, "Management", "MGT", 5, "medium"),
    (18, 3, "Computer Science", "CSCI", 8, "huge"),
    (19, 3, "Aerospace and Mechanical Engineering", "AME", 6, "large"),
    (20, 3, "Physics", "PHYS", 3, "small"),
    (21, 4, "Nursing", "NURS", 15, "large"),
    (22, 4, "Health Sciences", "HSCI", 15, "medium"),
    (23, 1, "Interdisciplinary Studies", "IDS", None, "none"),   # no employees, courses never offered
    (24, 3, "Data Science Institute", "DSCI", None, "none"),     # no employees yet (planned)
]
SIZE_FACULTY = {"huge": 14, "large": 9, "medium": 5, "small": 3, "tiny": 2, "none": 0}

# ---------------------------------------------------------------- rooms
rooms = []
rid = 0
for b in buildings:
    bid, _, abbr, _, _, btype = b
    if btype == "academic":
        n = rng.randint(6, 12)
        for i in range(n):
            rid += 1
            rtype = rng.choice(["lecture", "lecture", "seminar", "lab"])
            cap = {"lecture": rng.choice([30, 40, 45, 60, 80, 120]),
                   "seminar": rng.choice([12, 15, 18, 20]),
                   "lab": rng.choice([20, 24, 28])}[rtype]
            rooms.append((rid, bid, f"{rng.randint(1, 4)}{i + 1:02d}", cap, rtype))
    elif btype == "residence":
        for i in range(rng.randint(40, 60)):
            rid += 1
            rooms.append((rid, bid, f"{rng.randint(1, 8)}{i + 1:02d}", 2, "dorm"))
    else:
        for i in range(rng.randint(3, 6)):
            rid += 1
            rooms.append((rid, bid, f"{rng.randint(1, 3)}{i + 1:02d}", rng.choice([4, 6, 10]), "office"))
academic_rooms = [r for r in rooms if r[4] in ("lecture", "seminar", "lab")]
dorm_rooms_by_building = {}
for r in rooms:
    if r[4] == "dorm":
        dorm_rooms_by_building.setdefault(r[1], []).append(r)

# ---------------------------------------------------------------- employees
# Org tree: President(1) -> Provost(2) -> Dean(3) -> Chair(4) -> Faculty/Staff(5)
employees = []       # dicts
faculty_details = []
used_names = set()
emp_id = 0


def add_emp(first, last, title, dept, manager, salary, hire, etype, status="active"):
    global emp_id
    emp_id += 1
    employees.append(dict(employee_id=emp_id, first_name=first, last_name=last,
                          email=email(first, last, emp_id, "slu-fictional.edu"), title=title,
                          department_id=dept, manager_id=manager, salary=salary,
                          hire_date=iso(hire), employee_type=etype, status=status))
    return emp_id


f, l = pick_name(used_names)
president = add_emp(f, l, "President", None, None, 412000, date(2014, 7, 1), "staff")
f, l = pick_name(used_names)
provost = add_emp(f, l, "Provost", None, president, 298000, date(2016, 8, 15), "staff")
f, l = pick_name(used_names)
cfo = add_emp(f, l, "Chief Financial Officer", None, president, 265000, date(2018, 1, 7), "staff")
f, l = pick_name(used_names)
cio = add_emp(f, l, "Chief Information Officer", None, provost, 221000, date(2019, 3, 4), "staff")
dean_of = {}
for cid, cname, abbr, _ in colleges:
    f, l = pick_name(used_names)
    dean_of[cid] = add_emp(f, l, f"Dean, {cname}", None, provost,
                           rng.choice([198000, 205000, 212000, 205000]), rdate(2012, 2021), "faculty")
    faculty_details.append(dict(employee_id=dean_of[cid], rank="Professor", tenure_status="tenured",
                                office_room_id=None, phd_year=rng.randint(1988, 2004)))

RANKS = [("Professor", "tenured", (128000, 165000)),
         ("Associate Professor", "tenured", (96000, 118000)),
         ("Assistant Professor", "tenure-track", (78000, 92000)),
         ("Lecturer", "non-tenure", (58000, 72000)),
         ("Adjunct Instructor", "non-tenure", (36000, 48000))]
RANK_WEIGHTS = [3, 4, 4, 3, 2]
chair_of = {}
faculty_by_dept = {}
office_rooms = [r for r in rooms if r[4] == "office"] + [r for r in rooms if r[4] == "seminar"]
for d in departments:
    did, cid, dname, code, bid, size = d
    n = SIZE_FACULTY[size]
    faculty_by_dept[did] = []
    if n == 0:
        continue
    f, l = pick_name(used_names)
    chair_salary = rng.choice([142000, 148000, 155000, 148000, 162000])
    chair = add_emp(f, l, "Department Chair", did, dean_of[cid], chair_salary, rdate(2005, 2019), "faculty")
    chair_of[did] = chair
    faculty_details.append(dict(employee_id=chair, rank="Professor", tenure_status="tenured",
                                office_room_id=rng.choice(office_rooms)[0], phd_year=rng.randint(1990, 2008)))
    faculty_by_dept[did].append(chair)
    for i in range(n - 1):
        rank, tenure, (lo, hi) = rng.choices(RANKS, RANK_WEIGHTS)[0]
        salary = round(rng.randint(lo, hi) / 1000) * 1000      # rounding -> salary ties
        f, l = pick_name(used_names)
        hire = rdate(2004, 2024) if rank != "Professor" else rdate(1998, 2014)
        eid = add_emp(f, l, rank, did, chair, salary, hire, "faculty")
        faculty_details.append(dict(employee_id=eid, rank=rank, tenure_status=tenure,
                                    office_room_id=rng.choice(office_rooms)[0] if rng.random() < 0.85 else None,
                                    phd_year=rng.randint(1992, 2022) if rank != "Adjunct Instructor" else None))
        faculty_by_dept[did].append(eid)
    # one department staff member for medium+ departments
    if size in ("huge", "large", "medium"):
        f, l = pick_name(used_names)
        add_emp(f, l, "Administrative Assistant", did, chair, rng.choice([42000, 44000, 46000, 44000]),
                rdate(2008, 2024), "staff")

# central staff under CIO / CFO / Provost
for title, mgr, sal in [("IT Support Specialist", cio, 58000), ("IT Support Specialist", cio, 58000),
                        ("Systems Administrator", cio, 84000), ("Database Administrator", cio, 91000),
                        ("Bursar", cfo, 97000), ("Payroll Specialist", cfo, 56000),
                        ("Financial Aid Counselor", cfo, 52000), ("Financial Aid Counselor", cfo, 52000),
                        ("Registrar", provost, 88000), ("Admissions Counselor", provost, 49000),
                        ("Admissions Counselor", provost, 49000), ("Librarian", provost, 61000),
                        ("Librarian", provost, 64000), ("Residence Life Coordinator", provost, 47000)]:
    f, l = pick_name(used_names)
    add_emp(f, l, title, None, mgr, sal, rdate(2010, 2024), "staff")

# a few former employees (status) — still referenced by old sections
for e in rng.sample([e for e in employees if e["employee_type"] == "faculty" and e["title"] != "Department Chair"], 4):
    e["status"] = "retired" if rng.random() < 0.5 else "left"

# planted: ties for the highest and third-highest salary inside Biology (non-chair faculty)
bio = [e for e in employees if e["department_id"] == 1 and e["employee_type"] == "faculty" and e["title"] != "Department Chair"]
bio.sort(key=lambda e: -e["salary"])
bio[1]["salary"] = bio[0]["salary"]
bio[3]["salary"] = bio[2]["salary"]
fd_by_id = {fd["employee_id"]: fd for fd in faculty_details}
for e in bio[:2]:
    e["title"] = "Professor"
    fd_by_id[e["employee_id"]]["rank"], fd_by_id[e["employee_id"]]["tenure_status"] = "Professor", "tenured"
# departments 23 / 24 have no employees at all; chair_id NULL there.

dept_rows = [dict(department_id=d[0], college_id=d[1], name=d[2], code=d[3], building_id=d[4],
                  chair_id=chair_of.get(d[0])) for d in departments]
college_rows = [dict(college_id=c[0], name=c[1], abbreviation=c[2], founded_year=c[3], dean_id=dean_of[c[0]]) for c in colleges]

# ---------------------------------------------------------------- majors / minors
MAJOR_DEFS = {  # dept -> list of (name, degree, credits)
    1: [("Biology", "BS", 120), ("Neuroscience", "BS", 122)],
    2: [("Chemistry", "BS", 120), ("Biochemistry", "BS", 124)],
    3: [("English", "BA", 120)], 4: [("History", "BA", 120)],
    5: [("Mathematics", "BS", 120), ("Statistics", "BS", 120)],
    6: [("Philosophy", "BA", 120)], 7: [("Psychology", "BA", 120), ("Psychology", "BS", 122)],
    8: [("Sociology", "BA", 120)], 9: [("Political Science", "BA", 120)],
    10: [("Theological Studies", "BA", 120)], 11: [("Classics", "BA", 120)],
    12: [("Communication", "BA", 120)], 13: [("Studio Art", "BFA", 128), ("Music", "BA", 120)],
    14: [("Accounting", "BSBA", 120)], 15: [("Finance", "BSBA", 120)],
    16: [("Marketing", "BSBA", 120)], 17: [("Management", "BSBA", 120)],
    18: [("Computer Science", "BS", 120), ("Computer Science", "BA", 120)],
    19: [("Mechanical Engineering", "BS", 128), ("Aerospace Engineering", "BS", 128)],
    20: [("Physics", "BS", 120)], 21: [("Nursing", "BSN", 128)],
    22: [("Health Sciences", "BS", 120), ("Public Health", "BS", 120)],
    23: [("Interdisciplinary Studies", "BA", 120)],
}
majors = []
mid = 0
for did in sorted(MAJOR_DEFS):
    for name, degree, credits in MAJOR_DEFS[did]:
        mid += 1
        majors.append(dict(major_id=mid, department_id=did, name=name, degree=degree, total_credits=credits))
minors = []
for i, (did, name) in enumerate([(5, "Mathematics"), (18, "Computer Science"), (3, "Creative Writing"),
                                 (6, "Ethics"), (9, "Public Policy"), (12, "Film Studies"),
                                 (16, "Marketing"), (7, "Psychology"), (20, "Astronomy"), (4, "Public History")], 1):
    minors.append(dict(minor_id=i, department_id=did, name=name))

# ---------------------------------------------------------------- terms (term_id is chronological)
terms = []
tid = 0
for year in (2022, 2023, 2024):
    tid += 1
    terms.append(dict(term_id=tid, name=f"Fall {year}", year=year, season="Fall",
                      start_date=f"{year}-08-24", end_date=f"{year}-12-15"))
    tid += 1
    terms.append(dict(term_id=tid, name=f"Spring {year + 1}", year=year + 1, season="Spring",
                      start_date=f"{year + 1}-01-16", end_date=f"{year + 1}-05-12"))
CURRENT_TERM = 6
TERM_START = {t["term_id"]: date.fromisoformat(t["start_date"]) for t in terms}

# ---------------------------------------------------------------- courses
COURSE_TITLES = {
    "BIOL": ["Principles of Biology I", "Principles of Biology II", "Cell Biology", "Genetics", "Ecology",
             "Microbiology", "Human Anatomy", "Human Physiology", "Evolution", "Immunology",
             "Developmental Biology", "Neurobiology", "Molecular Biology", "Biology Senior Seminar"],
    "CHEM": ["General Chemistry I", "General Chemistry II", "Organic Chemistry I", "Organic Chemistry II",
             "Analytical Chemistry", "Physical Chemistry", "Biochemistry", "Inorganic Chemistry"],
    "ENGL": ["Introduction to Literature", "Academic Writing", "Shakespeare", "American Novel",
             "Creative Writing Workshop", "Modern Poetry"],
    "HIST": ["World History I", "World History II", "History of St. Louis", "US Civil War", "Modern Europe"],
    "MATH": ["College Algebra", "Calculus I", "Calculus II", "Calculus III", "Linear Algebra",
             "Differential Equations", "Probability", "Mathematical Statistics", "Real Analysis",
             "Introduction to Proofs"],
    "PHIL": ["Introduction to Philosophy", "Ethics", "Logic", "Philosophy of Mind"],
    "PSY": ["General Psychology", "Research Methods", "Cognitive Psychology", "Abnormal Psychology",
            "Developmental Psychology", "Social Psychology", "Statistics for Psychology"],
    "SOC": ["Introduction to Sociology", "Cultural Anthropology", "Urban Sociology"],
    "POLS": ["American Government", "Comparative Politics", "International Relations", "Constitutional Law"],
    "THEO": ["Theological Foundations", "World Religions", "Ethics and Society", "Scripture"],
    "CLAS": ["Latin I", "Greek Mythology", "Roman History"],
    "CMM": ["Public Speaking", "Media and Society", "Journalism", "Strategic Communication"],
    "FPA": ["Drawing I", "Music Theory", "Art History", "Studio Painting", "University Choir"],
    "ACCT": ["Financial Accounting", "Managerial Accounting", "Intermediate Accounting", "Auditing", "Taxation"],
    "FIN": ["Principles of Finance", "Investments", "Corporate Finance", "Financial Markets"],
    "MKT": ["Principles of Marketing", "Consumer Behavior", "Digital Marketing", "Marketing Research"],
    "MGT": ["Principles of Management", "Organizational Behavior", "Operations Management", "Strategic Management"],
    "CSCI": ["Introduction to Computer Science", "Object-Oriented Programming", "Data Structures",
             "Discrete Mathematics", "Computer Architecture", "Algorithms", "Databases",
             "Operating Systems", "Software Engineering", "Machine Learning", "Computer Networks",
             "Artificial Intelligence", "Compilers", "Senior Capstone"],
    "AME": ["Statics", "Dynamics", "Thermodynamics", "Fluid Mechanics", "Materials Science",
            "Aerodynamics", "Machine Design", "Propulsion"],
    "PHYS": ["Physics I", "Physics II", "Modern Physics", "Quantum Mechanics"],
    "NURS": ["Foundations of Nursing", "Pharmacology", "Adult Health Nursing", "Pediatric Nursing",
             "Mental Health Nursing", "Community Health", "Nursing Leadership"],
    "HSCI": ["Introduction to Health Sciences", "Epidemiology", "Health Policy", "Global Health", "Nutrition"],
    "IDS": ["Interdisciplinary Inquiry", "Capstone Project"],
    "DSCI": ["Introduction to Data Science", "Data Visualization"],
}
dept_by_code = {d[3]: d[0] for d in departments}
courses = []
course_by_code = {}
cid_ = 0
for code in [d[3] for d in departments]:
    titles = COURSE_TITLES[code]
    n = len(titles)
    for i, title in enumerate(titles):
        cid_ += 1
        level = 1000 if i < max(2, n // 4) else 2000 if i < n // 2 else 3000 if i < (3 * n) // 4 else 4000
        num = level + 100 * rng.randint(0, 8) + 10 * rng.randint(0, 9)
        while f"{code} {num}" in course_by_code:
            num += 10
        credits = 4 if code in ("BIOL", "CHEM", "PHYS", "CSCI", "MATH") and i < 4 and rng.random() < 0.6 else \
            1 if title in ("University Choir",) else 3
        row = dict(course_id=cid_, department_id=dept_by_code[code], course_code=f"{code} {num}",
                   title=title, credits=credits, level=level)
        courses.append(row)
        course_by_code[row["course_code"]] = row
assert len(courses) >= 120, len(courses)
courses_by_dept = {}
for c in courses:
    courses_by_dept.setdefault(c["department_id"], []).append(c)


def by_title(title):
    return next(c for c in courses if c["title"] == title)


# prerequisite chains (multi-level, 4 deep for CS and Math)
prereqs = []
CHAINS = [
    ["Introduction to Computer Science", "Object-Oriented Programming", "Data Structures", "Algorithms", "Compilers"],
    ["Data Structures", "Databases"], ["Data Structures", "Operating Systems"], ["Algorithms", "Machine Learning"],
    ["Software Engineering", "Senior Capstone"], ["Data Structures", "Software Engineering"],
    ["College Algebra", "Calculus I", "Calculus II", "Calculus III", "Differential Equations"],
    ["Calculus II", "Linear Algebra"], ["Calculus II", "Probability", "Mathematical Statistics"],
    ["Introduction to Proofs", "Real Analysis"], ["Calculus I", "Introduction to Proofs"],
    ["Principles of Biology I", "Principles of Biology II", "Cell Biology", "Molecular Biology"],
    ["Principles of Biology II", "Genetics"], ["Genetics", "Evolution"], ["Cell Biology", "Immunology"],
    ["General Chemistry I", "General Chemistry II", "Organic Chemistry I", "Organic Chemistry II", "Biochemistry"],
    ["Physics I", "Physics II", "Modern Physics", "Quantum Mechanics"],
    ["Financial Accounting", "Managerial Accounting", "Intermediate Accounting", "Auditing"],
    ["Principles of Finance", "Investments"], ["Principles of Finance", "Corporate Finance"],
    ["Principles of Marketing", "Consumer Behavior"], ["Principles of Management", "Organizational Behavior"],
    ["Foundations of Nursing", "Pharmacology", "Adult Health Nursing", "Nursing Leadership"],
    ["General Psychology", "Research Methods", "Cognitive Psychology"],
    ["General Psychology", "Abnormal Psychology"], ["Statics", "Dynamics", "Machine Design"],
    ["Thermodynamics", "Fluid Mechanics", "Aerodynamics", "Propulsion"],
    ["Latin I", "Roman History"], ["Interdisciplinary Inquiry", "Capstone Project"],
]
# cross-department prereqs
EXTRA = [("Machine Learning", "Linear Algebra", "C"), ("Discrete Mathematics", "College Algebra", "C"),
         ("Algorithms", "Discrete Mathematics", "C"), ("Statics", "Calculus I", "C"),
         ("Thermodynamics", "Physics I", "C"), ("Physics I", "Calculus I", "C-"),
         ("Biochemistry", "Principles of Biology I", "C")]
seen = set()
for chain in CHAINS:
    for a, b in zip(chain, chain[1:]):
        key = (by_title(b)["course_id"], by_title(a)["course_id"])
        if key not in seen:
            seen.add(key)
            prereqs.append(dict(course_id=key[0], prereq_course_id=key[1], min_grade=rng.choice(["C", "C", "C-", "B-"])))
for c, p, g in EXTRA:
    key = (by_title(c)["course_id"], by_title(p)["course_id"])
    if key not in seen:
        seen.add(key)
        prereqs.append(dict(course_id=key[0], prereq_course_id=key[1], min_grade=g))
prereqs.sort(key=lambda p: (p["course_id"], p["prereq_course_id"]))

# courses never offered: everything in IDS/DSCI + a handful of 4000-level courses
never_offered = {c["course_id"] for c in courses if c["department_id"] in (23, 24)}
for c in rng.sample([c for c in courses if c["level"] == 4000 and c["department_id"] not in (23, 24)], 9):
    never_offered.add(c["course_id"])

# ---------------------------------------------------------------- sections
sections = []
sid = 0
TIMES = [("08:00", "08:50"), ("09:00", "09:50"), ("10:00", "10:50"), ("11:00", "11:50"), ("12:00", "12:50"),
         ("13:10", "14:00"), ("14:10", "15:00"), ("15:10", "16:00"), ("09:30", "10:45"), ("11:00", "12:15"),
         ("12:45", "14:00"), ("14:15", "15:30")]
offerable = [c for c in courses if c["course_id"] not in never_offered]
sections_by_term = {}
for t in terms:
    tid = t["term_id"]
    # most 1000/2000-level courses run every term; upper-level alternate
    offered = [c for c in offerable if c["level"] <= 2000 or (c["course_id"] + tid) % 2 == 0]
    for c in offered:
        dept_size = next(d[5] for d in departments if d[0] == c["department_id"])
        n_sec = 1
        if c["level"] == 1000 and dept_size in ("huge", "large"):
            n_sec = rng.choice([2, 2, 3])
        elif c["level"] == 1000 and dept_size == "medium":
            n_sec = rng.choice([1, 2])
        for s in range(1, n_sec + 1):
            sid += 1
            fac = faculty_by_dept.get(c["department_id"], [])
            instr = rng.choice(fac) if fac and rng.random() < 0.93 else None
            room = rng.choice(academic_rooms)
            if c["level"] >= 3000 and rng.random() < 0.5:
                room = rng.choice([r for r in academic_rooms if r[4] == "seminar"])
            cap = min(room[3], rng.choice([18, 20, 24, 25, 30, 30, 35, 40, 60]) if c["level"] <= 2000 else rng.choice([12, 15, 18, 20, 25]))
            days = rng.choice(["MWF", "MWF", "TR", "TR", "MW", "F"])
            st, en = rng.choice(TIMES[:8] if days == "MWF" else TIMES[8:])
            sections.append(dict(section_id=sid, course_id=c["course_id"], term_id=tid, instructor_id=instr,
                                 room_id=room[0], section_number=f"{s:02d}", meeting_days=days,
                                 start_time=st, end_time=en, capacity=cap))
            sections_by_term.setdefault(tid, []).append(sections[-1])

# ---------------------------------------------------------------- students
students = []
student_majors = []
N_STUDENTS = 500
advisors_all = [e for e in employees if e["employee_type"] == "faculty" and e["title"] != "Department Chair"]
major_weights = []
for m in majors:
    size = next(d[5] for d in departments if d[0] == m["department_id"])
    major_weights.append({"huge": 10, "large": 6, "medium": 3, "small": 1.5, "tiny": 0.6, "none": 0.4}[size])
for i in range(1, N_STUDENTS + 1):
    f, l = pick_name(used_names) if rng.random() < 0.97 else (rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES))
    enroll_year = rng.choices([2019, 2020, 2021, 2022, 2023, 2024], [3, 8, 14, 22, 26, 27])[0]
    state = rng.choice(STATES)
    birth = rdate(enroll_year - 19, enroll_year - 17)
    if enroll_year <= 2020:
        status = rng.choices(["graduated", "active", "withdrawn"], [70, 20, 10])[0]
    elif enroll_year == 2021:
        status = rng.choices(["active", "graduated", "withdrawn", "leave"], [60, 25, 10, 5])[0]
    else:
        status = rng.choices(["active", "withdrawn", "leave"], [88, 7, 5])[0]
    gpa = None
    if enroll_year < 2024 or rng.random() < 0.5:
        gpa = rng.gauss(3.12, 0.42)
        if gpa > 3.95:
            gpa = rng.uniform(3.70, 3.96)       # keep the very top sparse; ties are planted below
        gpa = round(max(1.6, gpa), 2)
    advisor = rng.choice(advisors_all)["employee_id"] if rng.random() < 0.9 else None
    students.append(dict(student_id=1000 + i, first_name=f, last_name=l,
                         email=email(f, l, 1000 + i, "students.slu-fictional.edu"), birth_date=iso(birth),
                         home_state=state, home_city=rng.choice(CITIES[state]), enrollment_year=enroll_year,
                         gpa=gpa, advisor_id=advisor, status=status))
    # majors: ~8% undeclared, ~12% double majors
    r = rng.random()
    if r < 0.08:
        pass
    else:
        m1 = rng.choices(majors, major_weights)[0]
        declared = date(enroll_year, rng.choice([8, 9, 10]), rng.randint(1, 28))
        student_majors.append(dict(student_id=1000 + i, major_id=m1["major_id"], is_primary=1, declared_on=iso(declared)))
        if r > 0.88:
            m2 = rng.choices(majors, major_weights)[0]
            while m2["major_id"] == m1["major_id"]:
                m2 = rng.choices(majors, major_weights)[0]
            student_majors.append(dict(student_id=1000 + i, major_id=m2["major_id"], is_primary=0,
                                       declared_on=iso(declared + timedelta(days=rng.randint(120, 700)))))
# planted GPA ties at the top
top = sorted([s for s in students if s["gpa"] is not None], key=lambda s: -s["gpa"])
for s in top[:3]:
    s["gpa"] = 4.0
for s in top[3:6]:
    s["gpa"] = 3.98
student_by_id = {s["student_id"]: s for s in students}
primary_major = {}
major_dept = {m["major_id"]: m["department_id"] for m in majors}
for sm in student_majors:
    if sm["is_primary"]:
        primary_major[sm["student_id"]] = sm["major_id"]

# ---------------------------------------------------------------- enrollments
enrollments = []
eid_ = 0
GRADES = [("A", 4.0, 22), ("A-", 3.7, 14), ("B+", 3.3, 14), ("B", 3.0, 16), ("B-", 2.7, 9), ("C+", 2.3, 7),
          ("C", 2.0, 7), ("C-", 1.7, 3), ("D", 1.0, 3), ("F", 0.0, 3)]
section_counts = {s["section_id"]: 0 for s in sections}
leave_students = set(rng.sample([s["student_id"] for s in students if s["enrollment_year"] <= 2022], 45))
for s in students:
    sidn = s["student_id"]
    first_term = max(1, 2 * (s["enrollment_year"] - 2022) + 1)
    if s["status"] == "graduated":
        last_term = rng.choice([2, 4, 4, 5]) if s["enrollment_year"] <= 2020 else rng.choice([5, 6])
    elif s["status"] == "withdrawn":
        last_term = rng.randint(first_term, 5)
    elif s["status"] == "leave":
        last_term = 5
    else:
        last_term = CURRENT_TERM
    if first_term > last_term:
        continue
    active_terms = list(range(first_term, last_term + 1))
    if sidn in leave_students and len(active_terms) >= 4:
        gap = rng.choice(active_terms[1:-1])
        active_terms.remove(gap)                       # gaps for gaps-and-islands problems
    dept = major_dept.get(primary_major.get(sidn))
    for tid in active_terms:
        pool = sections_by_term[tid]
        own = [x for x in pool if dept is not None and courses[x["course_id"] - 1]["department_id"] == dept]
        other = [x for x in pool if x not in own]
        k = rng.choice([3, 4, 4, 4, 5])
        chosen = []
        if own:
            chosen += rng.sample(own, min(len(own), rng.randint(1, min(3, k))))
        chosen += rng.sample(other, k - len(chosen))
        seen_courses = set()
        for sec in chosen:
            if sec["course_id"] in seen_courses:
                continue
            seen_courses.add(sec["course_id"])
            eid_ += 1
            enrolled_on = TERM_START[tid] - timedelta(days=rng.randint(5, 110))
            if tid == CURRENT_TERM:
                status, grade, pts = "enrolled", None, None
            else:
                r = rng.random()
                if r < 0.06:
                    status, grade, pts = "dropped", None, None
                elif r < 0.08:
                    status, grade, pts = "withdrawn", "W", None
                else:
                    g = rng.choices(GRADES, [w for _, _, w in GRADES])[0]
                    status, grade, pts = "completed", g[0], g[1]
            enrollments.append(dict(enrollment_id=eid_, student_id=sidn, section_id=sec["section_id"],
                                    enrolled_on=iso(enrolled_on), status=status, grade=grade, grade_points=pts))
            section_counts[sec["section_id"]] += 1
# planted: a few sections exactly at capacity and a few over capacity (waitlist overflow)
for sec in sections:
    n = section_counts[sec["section_id"]]
    if n == 0:
        continue
    if sec["section_id"] % 17 == 0:
        sec["capacity"] = n                 # exactly full
    elif sec["section_id"] % 23 == 0 and n > 5:
        sec["capacity"] = n - rng.randint(1, 3)   # over capacity
    elif sec["capacity"] < n:
        sec["capacity"] = n + rng.randint(0, 6)
sections_sorted = sorted(sections, key=lambda s: s["section_id"])

# ---------------------------------------------------------------- student orgs / memberships
ORGS = [("Student Government Association", "governance"), ("Biology Club", "academic"), ("Chess Club", "hobby"),
        ("Women in Computing", "academic"), ("Debate Society", "academic"), ("Hispanic Student Union", "cultural"),
        ("Black Student Alliance", "cultural"), ("Campus Ministry", "service"), ("Habitat for Humanity", "service"),
        ("Investment Club", "academic"), ("Robotics Team", "academic"), ("Ultimate Frisbee", "sports"),
        ("Club Soccer", "sports"), ("Jazz Ensemble", "arts"), ("Theatre Guild", "arts"), ("Pre-Med Society", "academic"),
        ("Nursing Student Association", "academic"), ("Philosophy Circle", "academic"), ("Photography Club", "hobby"),
        ("Esports Club", "hobby"), ("International Student Association", "cultural"), ("Outdoor Adventure Club", "hobby"),
        ("Model United Nations", "academic"), ("Engineering Society", "academic"), ("Running Club", "sports")]
student_orgs = []
for i, (name, cat) in enumerate(ORGS, 1):
    student_orgs.append(dict(org_id=i, name=name, category=cat,
                             advisor_id=rng.choice(advisors_all)["employee_id"] if rng.random() < 0.8 else None,
                             founded_year=rng.randint(1965, 2022)))
org_memberships = []
active_students = [s for s in students if s["status"] in ("active", "leave")]
for s in active_students:
    k = rng.choices([0, 1, 2, 3], [35, 40, 18, 7])[0]
    for org in rng.sample(student_orgs, k):
        org_memberships.append(dict(student_id=s["student_id"], org_id=org["org_id"],
                                    role=rng.choices(["member", "officer", "president"], [85, 12, 3])[0],
                                    joined_on=iso(rdate(max(2022, s["enrollment_year"]), 2024))))
# one president per org at most
seen_pres = set()
for m in org_memberships:
    if m["role"] == "president":
        if m["org_id"] in seen_pres:
            m["role"] = "officer"
        seen_pres.add(m["org_id"])

# ---------------------------------------------------------------- housing
housing = []
hid = 0
res_buildings = [b for b in buildings if b[5] == "residence"]
RATE = {10: 4200, 11: 4400, 12: 5100, 13: 4300, 14: 4000}
for tid in (5, 6):
    pool = [s for s in students if s["status"] in ("active", "leave") and s["enrollment_year"] >= 2022]
    for s in pool:
        if rng.random() < 0.6:
            b = rng.choice(res_buildings)
            room = rng.choice(dorm_rooms_by_building[b[0]])
            hid += 1
            housing.append(dict(assignment_id=hid, student_id=s["student_id"], building_id=b[0], room_id=room[0],
                                term_id=tid, rate=RATE[b[0]]))

# ---------------------------------------------------------------- scholarships / aid / payments
scholarships = [
    dict(scholarship_id=1, name="Presidential Scholarship", sponsor="University", amount=12000, min_gpa=3.7, is_need_based=0),
    dict(scholarship_id=2, name="Dean's Scholarship", sponsor="University", amount=8000, min_gpa=3.4, is_need_based=0),
    dict(scholarship_id=3, name="Jesuit Mission Grant", sponsor="University", amount=5000, min_gpa=None, is_need_based=1),
    dict(scholarship_id=4, name="Missouri Bright Flight", sponsor="State of Missouri", amount=3000, min_gpa=3.0, is_need_based=0),
    dict(scholarship_id=5, name="Federal Pell Grant", sponsor="Federal", amount=3450, min_gpa=None, is_need_based=1),
    dict(scholarship_id=6, name="STEM Excellence Award", sponsor="Alumni Association", amount=2500, min_gpa=3.5, is_need_based=0),
    dict(scholarship_id=7, name="Nursing Workforce Grant", sponsor="State of Missouri", amount=4000, min_gpa=2.8, is_need_based=1),
    dict(scholarship_id=8, name="Fine Arts Talent Award", sponsor="University", amount=1500, min_gpa=None, is_need_based=0),
    dict(scholarship_id=9, name="First-Generation Scholars", sponsor="Foundation", amount=2000, min_gpa=2.5, is_need_based=1),
    dict(scholarship_id=10, name="Billiken Legacy Award", sponsor="Alumni Association", amount=1000, min_gpa=None, is_need_based=0),
]
financial_aid = []
aid_id = 0
for s in students:
    if rng.random() < 0.55:
        awards = rng.sample(scholarships, rng.choice([1, 1, 2]))
        for tid in (3, 4, 5, 6):
            if s["status"] in ("withdrawn", "graduated") and tid > 4:
                continue
            for sc in awards:
                if sc["min_gpa"] is not None and (s["gpa"] is None or s["gpa"] < sc["min_gpa"]):
                    continue
                aid_id += 1
                financial_aid.append(dict(aid_id=aid_id, student_id=s["student_id"], scholarship_id=sc["scholarship_id"],
                                          term_id=tid, amount=sc["amount"] // 2))
payments = []
pid = 0
TUITION = 24500
student_terms = {}
for e in enrollments:
    sec = sections[e["section_id"] - 1]
    student_terms.setdefault(e["student_id"], set()).add(sec["term_id"])
for sidn in sorted(student_terms):
    for tid in sorted(student_terms[sidn]):
        n_pay = rng.choice([1, 2, 2, 3])
        remaining = TUITION
        for i in range(n_pay):
            amt = remaining if i == n_pay - 1 else round(remaining * rng.choice([0.5, 0.4, 0.6]), 2)
            remaining = round(remaining - amt, 2)
            pid += 1
            paid_on = TERM_START[tid] + timedelta(days=rng.randint(-30, 60) + 30 * i)
            status = rng.choices(["posted", "posted", "posted", "pending", "refunded"], [40, 40, 10, 6, 4])[0]
            payments.append(dict(payment_id=pid, student_id=sidn, term_id=tid, amount=amt, paid_on=iso(paid_on),
                                 method=rng.choice(["card", "ach", "check", "ach", "loan"]), status=status))

# ---------------------------------------------------------------- write CSVs
TABLES = [
    ("colleges", college_rows), ("buildings", [dict(building_id=b[0], name=b[1], abbreviation=b[2], address=b[3],
                                                    year_built=b[4], building_type=b[5]) for b in buildings]),
    ("departments", dept_rows), ("rooms", [dict(room_id=r[0], building_id=r[1], room_number=r[2], capacity=r[3], room_type=r[4]) for r in rooms]),
    ("employees", employees), ("faculty_details", faculty_details), ("majors", majors), ("minors", minors),
    ("students", students), ("student_majors", student_majors), ("terms", terms), ("courses", courses),
    ("course_prerequisites", prereqs), ("sections", sections_sorted), ("enrollments", enrollments),
    ("student_orgs", student_orgs), ("org_memberships", org_memberships), ("housing_assignments", housing),
    ("scholarships", scholarships), ("financial_aid", financial_aid), ("tuition_payments", payments),
]
os.makedirs(CLEAN, exist_ok=True)
for name, rows in TABLES:
    with open(os.path.join(CLEAN, f"{name}.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if v is None else v) for k, v in r.items()})

# ---------------------------------------------------------------- schema.sql + sqlite
with open(os.path.join(HERE, "schema_template.sql"), "r", encoding="utf-8") as fh:
    SCHEMA = fh.read()
with open(os.path.join(HERE, "schema.sql"), "w", encoding="utf-8") as fh:
    fh.write(SCHEMA)

db_path = os.path.join(HERE, "university.sqlite")
if os.path.exists(db_path):
    os.remove(db_path)
con = sqlite3.connect(db_path)
con.executescript(SCHEMA)
con.execute("PRAGMA foreign_keys = ON")
con.execute("PRAGMA defer_foreign_keys = ON")   # colleges.dean_id and departments.chair_id reference employees
with con:
    for name, rows in TABLES:
        cols = list(rows[0].keys())
        con.executemany(f"INSERT INTO {name} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [tuple(r[c] for c in cols) for r in rows])
bad = con.execute("PRAGMA foreign_key_check").fetchall()
assert not bad, bad[:5]
con.execute("VACUUM")
con.close()

# ---------------------------------------------------------------- Excel extract (subset, same CSVs)
EXCEL = {}


def sheet(name, rows, cols):
    EXCEL[name] = {"columns": cols, "rows": [[r[c] for c in cols] for r in rows]}


xs = [s for s in students if s["gpa"] is not None and s["status"] == "active"][:120]
sheet("Students", xs, ["student_id", "first_name", "last_name", "home_state", "enrollment_year", "gpa", "advisor_id", "status"])
xs_ids = {s["student_id"] for s in xs}
xe = [e for e in enrollments if e["student_id"] in xs_ids and e["status"] == "completed" and e["grade_points"] is not None][:300]
sheet("Enrollments", xe, ["enrollment_id", "student_id", "section_id", "enrolled_on", "status", "grade", "grade_points"])
sec_ids = sorted({e["section_id"] for e in xe})
xsec = [s for s in sections_sorted if s["section_id"] in sec_ids]
sheet("Sections", xsec, ["section_id", "course_id", "term_id", "instructor_id", "capacity"])
sheet("Courses", courses, ["course_id", "department_id", "course_code", "title", "credits", "level"])
sheet("Departments", dept_rows, ["department_id", "college_id", "name", "code"])
xemp = [e for e in employees if e["employee_type"] == "faculty"][:100]
sheet("Employees", xemp, ["employee_id", "first_name", "last_name", "title", "department_id", "salary", "hire_date"])
sheet("Terms", terms, ["term_id", "name", "year", "season", "start_date", "end_date"])
with open(os.path.join(HERE, "excel_extract.json"), "w", encoding="utf-8") as fh:
    json.dump(EXCEL, fh, separators=(",", ":"))


# ---------------------------------------------------------------- docs/schema.md
def md_table_for(name):
    c = sqlite3.connect(db_path)
    info = c.execute(f"PRAGMA table_info({name})").fetchall()
    fks = {r[3]: (r[2], r[4]) for r in c.execute(f"PRAGMA foreign_key_list({name})").fetchall()}
    n = c.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
    c.close()
    out = [f"### {name}  ({n} rows)", "", "| column | type | key | nullable |", "|---|---|---|---|"]
    for cid, col, typ, notnull, dflt, pk in info:
        key = "PK" if pk else (f"FK → {fks[col][0]}.{fks[col][1]}" if col in fks else "")
        out.append(f"| {col} | {typ} | {key} | {'no' if notnull or pk else 'yes'} |")
    return "\n".join(out) + "\n"


mermaid = ["erDiagram"]
c = sqlite3.connect(db_path)
for name, _ in TABLES:
    for r in c.execute(f"PRAGMA foreign_key_list({name})").fetchall():
        mermaid.append(f"    {r[2]} ||--o{{ {name} : \"{r[3]}\"")
c.close()
doc = ["# Dataset schema — fictional Saint Louis University", "",
       "Generated by `data/generate.py` (seed 42). All people and numbers are fictional.", "",
       "`terms.term_id` is chronological: consecutive ids are consecutive semesters (no summer terms).",
       "`employees.manager_id` forms a 5-level tree (President → Provost → Dean → Chair → faculty/staff).",
       "`course_prerequisites` contains chains 4 deep (e.g. CSCI Intro → OOP → Data Structures → Algorithms → Compilers).", "",
       "## Planted features for the problems", "",
       "- Ties: top GPA is shared by 3 students (4.00) and 3 more share 3.98; salaries are rounded to $1,000 so departments contain ties (Biology's top salary is tied).",
       "- NULLs: ~8% of students have no major, ~10% have no advisor, 13 courses have never been offered, two departments have no employees, the President has no manager, some sections have no instructor.",
       "- Double majors: ~12% of declared students. Enrollment gaps: 45 students skipped a term.",
       "- Capacity: every section whose id is a multiple of 17 is exactly full; multiples of 23 are over capacity.",
       "- Skew: Biology and Computer Science are huge, Classics is tiny.", "",
       "## ER diagram", "", "```mermaid", *mermaid, "```", "", "## Tables", ""]
for name, _ in TABLES:
    doc.append(md_table_for(name))
os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
with open(os.path.join(ROOT, "docs", "schema.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(doc))

for name, rows in TABLES:
    print(f"{name:22s} {len(rows):6d}")
