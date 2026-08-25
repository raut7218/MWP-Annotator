import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FLAG_KEYS } from './flags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'app.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const flagCols = FLAG_KEYS.map((k) => `${k} INTEGER NOT NULL DEFAULT 0`).join(',\n    ');

db.exec(`
  CREATE TABLE IF NOT EXISTS rows_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    language TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    grade TEXT,
    topic TEXT,
    question TEXT,
    answer TEXT,
    raw_response TEXT,
    parse_error INTEGER NOT NULL DEFAULT 0,
    is_complete INTEGER NOT NULL DEFAULT 0,
    ${flagCols},
    comments TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    annotated_by TEXT,
    updated_at TEXT,
    UNIQUE(language, row_index)
  );

  CREATE INDEX IF NOT EXISTS idx_rows_lang ON rows_data(language);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    languages TEXT NOT NULL DEFAULT '[]',
    is_admin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  );
`);

export function allLanguages() {
  const rowsStmt = db.prepare('SELECT DISTINCT language FROM rows_data ORDER BY language');
  return rowsStmt.all().map((r) => r.language);
}
