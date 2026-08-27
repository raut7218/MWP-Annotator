import pg from 'pg';
import { FLAG_KEYS } from './flags.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required (Postgres connection string)');
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
});

// Prepared-statement-style call sites elsewhere use `?` placeholders (carried
// over from the previous SQLite driver); translate to Postgres's $1, $2, ...
function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function all(sql, params = []) {
  const res = await pool.query(toPositional(sql), params);
  return res.rows;
}

export async function get(sql, params = []) {
  const res = await pool.query(toPositional(sql), params);
  return res.rows[0];
}

export async function run(sql, params = []) {
  return pool.query(toPositional(sql), params);
}

const flagCols = FLAG_KEYS.map((k) => `${k} INTEGER NOT NULL DEFAULT 0`).join(',\n    ');

await pool.query(`
  CREATE TABLE IF NOT EXISTS rows_data (
    id SERIAL PRIMARY KEY,
    model TEXT NOT NULL DEFAULT 'qwen',
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
    UNIQUE(model, language, row_index)
  );
`);

// Migration for databases created before the `model` dimension existed:
// add the column (existing rows default to 'qwen', the only model imported
// so far) and swap the old (language, row_index) uniqueness for
// (model, language, row_index).
await pool.query(`ALTER TABLE rows_data ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'qwen';`);
await pool.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'rows_data_model_language_row_index_key'
    ) THEN
      ALTER TABLE rows_data DROP CONSTRAINT IF EXISTS rows_data_language_row_index_key;
      ALTER TABLE rows_data ADD CONSTRAINT rows_data_model_language_row_index_key UNIQUE (model, language, row_index);
    END IF;
  END $$;
`);

await pool.query('CREATE INDEX IF NOT EXISTS idx_rows_model_lang ON rows_data(model, language);');

await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    languages TEXT NOT NULL DEFAULT '[]',
    models TEXT NOT NULL DEFAULT '[]',
    is_admin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  );
`);

await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS models TEXT NOT NULL DEFAULT '[]';`);

export async function allLanguages() {
  const rows = await all('SELECT DISTINCT language FROM rows_data ORDER BY language');
  return rows.map((r) => r.language);
}

export async function allModels() {
  const rows = await all('SELECT DISTINCT model FROM rows_data ORDER BY model');
  return rows.map((r) => r.model);
}
