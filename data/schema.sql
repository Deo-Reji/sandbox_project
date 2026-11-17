-- Fictional "Saint Louis University" schema (SQLite dialect). Source of truth: data/schema_template.sql,
-- copied to data/schema.sql by data/generate.py.
PRAGMA foreign_keys = ON;

CREATE TABLE colleges (
  college_id    INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  abbreviation  TEXT NOT NULL UNIQUE,
  founded_year  INTEGER NOT NULL,
  dean_id       INTEGER REFERENCES employees(employee_id)
);
CREATE TABLE buildings (
  building_id   INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  abbreviation  TEXT NOT NULL UNIQUE,
  address       TEXT NOT NULL,
  year_built    INTEGER NOT NULL,
  building_type TEXT NOT NULL CHECK (building_type IN ('academic','residence','admin'))
);
CREATE TABLE departments (
  department_id INTEGER PRIMARY KEY,
  college_id    INTEGER NOT NULL REFERENCES colleges(college_id),
  name          TEXT NOT NULL UNIQUE,
  code          TEXT NOT NULL UNIQUE,
  building_id   INTEGER REFERENCES buildings(building_id),
  chair_id      INTEGER REFERENCES employees(employee_id)
);
CREATE TABLE rooms (
  room_id       INTEGER PRIMARY KEY,
  building_id   INTEGER NOT NULL REFERENCES buildings(building_id),
  room_number   TEXT NOT NULL,
  capacity      INTEGER NOT NULL CHECK (capacity > 0),
  room_type     TEXT NOT NULL CHECK (room_type IN ('lecture','seminar','lab','dorm','office')),
  UNIQUE (building_id, room_number)
);
CREATE TABLE employees (
  employee_id   INTEGER PRIMARY KEY,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(department_id),
  manager_id    INTEGER REFERENCES employees(employee_id),
  salary        INTEGER NOT NULL CHECK (salary > 0),
  hire_date     TEXT NOT NULL,
  employee_type TEXT NOT NULL CHECK (employee_type IN ('faculty','staff')),
  status        TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE faculty_details (
  employee_id    INTEGER PRIMARY KEY REFERENCES employees(employee_id),
  rank           TEXT NOT NULL,
  tenure_status  TEXT NOT NULL CHECK (tenure_status IN ('tenured','tenure-track','non-tenure')),
  office_room_id INTEGER REFERENCES rooms(room_id),
  phd_year       INTEGER
);
CREATE TABLE majors (
  major_id      INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(department_id),
  name          TEXT NOT NULL,
  degree        TEXT NOT NULL,
  total_credits INTEGER NOT NULL,
  UNIQUE (name, degree)
);
CREATE TABLE minors (
  minor_id      INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(department_id),
  name          TEXT NOT NULL UNIQUE
);
CREATE TABLE students (
  student_id      INTEGER PRIMARY KEY,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  birth_date      TEXT NOT NULL,
  home_state      TEXT NOT NULL,
  home_city       TEXT NOT NULL,
  enrollment_year INTEGER NOT NULL,
  gpa             REAL CHECK (gpa IS NULL OR (gpa >= 0 AND gpa <= 4.0)),
  advisor_id      INTEGER REFERENCES employees(employee_id),
  status          TEXT NOT NULL CHECK (status IN ('active','graduated','withdrawn','leave'))
);
CREATE TABLE student_majors (
  student_id   INTEGER NOT NULL REFERENCES students(student_id),
  major_id     INTEGER NOT NULL REFERENCES majors(major_id),
  is_primary   INTEGER NOT NULL CHECK (is_primary IN (0,1)),
  declared_on  TEXT NOT NULL,
  PRIMARY KEY (student_id, major_id)
);
CREATE TABLE terms (
  term_id     INTEGER PRIMARY KEY,   -- chronological: consecutive ids are consecutive terms
  name        TEXT NOT NULL UNIQUE,
  year        INTEGER NOT NULL,
  season      TEXT NOT NULL CHECK (season IN ('Fall','Spring')),
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL
);
CREATE TABLE courses (
  course_id     INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(department_id),
  course_code   TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  credits       INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 6),
  level         INTEGER NOT NULL CHECK (level IN (1000,2000,3000,4000))
);
CREATE TABLE course_prerequisites (
  course_id        INTEGER NOT NULL REFERENCES courses(course_id),
  prereq_course_id INTEGER NOT NULL REFERENCES courses(course_id),
  min_grade        TEXT NOT NULL,
  PRIMARY KEY (course_id, prereq_course_id),
  CHECK (course_id <> prereq_course_id)
);
CREATE TABLE sections (
  section_id     INTEGER PRIMARY KEY,
  course_id      INTEGER NOT NULL REFERENCES courses(course_id),
  term_id        INTEGER NOT NULL REFERENCES terms(term_id),
  instructor_id  INTEGER REFERENCES employees(employee_id),
  room_id        INTEGER REFERENCES rooms(room_id),
  section_number TEXT NOT NULL,
  meeting_days   TEXT NOT NULL,
  start_time     TEXT NOT NULL,
  end_time       TEXT NOT NULL,
  capacity       INTEGER NOT NULL CHECK (capacity > 0),
  UNIQUE (course_id, term_id, section_number)
);
CREATE TABLE enrollments (
  enrollment_id INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES students(student_id),
  section_id    INTEGER NOT NULL REFERENCES sections(section_id),
  enrolled_on   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('enrolled','completed','dropped','withdrawn')),
  grade         TEXT,
  grade_points  REAL,
  UNIQUE (student_id, section_id)
);
CREATE TABLE student_orgs (
  org_id       INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  category     TEXT NOT NULL,
  advisor_id   INTEGER REFERENCES employees(employee_id),
  founded_year INTEGER NOT NULL
);
CREATE TABLE org_memberships (
  student_id INTEGER NOT NULL REFERENCES students(student_id),
  org_id     INTEGER NOT NULL REFERENCES student_orgs(org_id),
  role       TEXT NOT NULL CHECK (role IN ('member','officer','president')),
  joined_on  TEXT NOT NULL,
  PRIMARY KEY (student_id, org_id)
);
CREATE TABLE housing_assignments (
  assignment_id INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES students(student_id),
  building_id   INTEGER NOT NULL REFERENCES buildings(building_id),
  room_id       INTEGER NOT NULL REFERENCES rooms(room_id),
  term_id       INTEGER NOT NULL REFERENCES terms(term_id),
  rate          INTEGER NOT NULL,
  UNIQUE (student_id, term_id)
);
CREATE TABLE scholarships (
  scholarship_id INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  sponsor        TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  min_gpa        REAL,
  is_need_based  INTEGER NOT NULL CHECK (is_need_based IN (0,1))
);
CREATE TABLE financial_aid (
  aid_id         INTEGER PRIMARY KEY,
  student_id     INTEGER NOT NULL REFERENCES students(student_id),
  scholarship_id INTEGER NOT NULL REFERENCES scholarships(scholarship_id),
  term_id        INTEGER NOT NULL REFERENCES terms(term_id),
  amount         INTEGER NOT NULL,
  UNIQUE (student_id, scholarship_id, term_id)
);
CREATE TABLE tuition_payments (
  payment_id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(student_id),
  term_id    INTEGER NOT NULL REFERENCES terms(term_id),
  amount     REAL NOT NULL,
  paid_on    TEXT NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('card','ach','check','loan')),
  status     TEXT NOT NULL CHECK (status IN ('posted','pending','refunded'))
);
CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_enrollments_section ON enrollments(section_id);
CREATE INDEX idx_sections_course ON sections(course_id);
CREATE INDEX idx_sections_term ON sections(term_id);
CREATE INDEX idx_employees_dept ON employees(department_id);
CREATE INDEX idx_employees_manager ON employees(manager_id);
