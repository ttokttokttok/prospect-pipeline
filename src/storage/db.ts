import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  params TEXT NOT NULL,
  progress TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS companies (
  domain TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  linkedin TEXT,
  fit_score INTEGER,
  why TEXT,
  first_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  linkedin_url TEXT PRIMARY KEY,
  company_domain TEXT,
  name TEXT,
  title TEXT,
  twitter TEXT,
  work_email TEXT,
  personal_email TEXT,
  phone TEXT,
  last_enriched_at TEXT
);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_linkedin_url TEXT NOT NULL,
  source TEXT NOT NULL,
  content TEXT,
  url TEXT,
  fetched_at TEXT NOT NULL
);
`;

export function openDb(path = process.env.PROSPECT_DB_PATH ?? "./prospect.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export type Db = ReturnType<typeof openDb>;
