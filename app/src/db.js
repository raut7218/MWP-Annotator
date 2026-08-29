import pg from 'pg';
import { FLAG_KEYS } from './flags.js';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required (Postgres connection string)');
}

// Hosted Postgres (Render, Supabase, ...) requires TLS with a certificate we
// do not pin; a local database generally has no TLS at all. Decide from the
// URL rather than assuming, so `127.0.0.1`, a unix socket, or an explicit
// `?sslmode=disable` all work as written.
function shouldUseSsl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  const mode = parsed.searchParams.get('sslmode') || process.env.PGSSLMODE;
  if (mode) return !['disable', 'allow'].includes(mode.toLowerCase());
  const host = parsed.hostname;
  return !(!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('/'));
}

export const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
});

// Prepared-statement-style call sites elsewhere use `?` placeholders (carried
// over from the previous SQLite driver); translate to Postgres's $1, $2, ...
// Never put a literal `?` inside a string literal in SQL passed through here.
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

async function columnExists(table, column) {
  const r = await get(
    `SELECT 1 AS x FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return !!r;
}

// ---------------------------------------------------------------------------
// Schema
//
// Three concerns are kept in separate tables so that adding models, languages,
// learning objectives or annotators never requires reshaping the others:
//
//   learning_objectives / learning_objective_texts
//       One LO per grade-and-ordinal, with its wording stored once per
//       language (English, Māori, ...). Adding a third language is one row,
//       not a schema change.
//   rows_data
//       The generated problem itself — immutable source content, keyed by
//       (model, language, row_index).
//   annotations
//       One row per (problem, annotator). This is what allows two (or five)
//       annotators to independently review the same model/language sheet;
//       annotations used to be columns on rows_data, which capped it at one
//       annotator per problem and made "who said this" unanswerable.
// ---------------------------------------------------------------------------

await pool.query(`
  CREATE TABLE IF NOT EXISTS learning_objectives (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    grade TEXT NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 1
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS learning_objective_texts (
    id SERIAL PRIMARY KEY,
    lo_id INTEGER NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    text TEXT NOT NULL,
    UNIQUE(lo_id, language)
  );
`);

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
    lo_id INTEGER REFERENCES learning_objectives(id) ON DELETE SET NULL,
    lo_language TEXT,
    learning_objective TEXT,
    source_file TEXT,
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

// Migration for databases created before learning objectives were modelled.
await pool.query(`ALTER TABLE rows_data ADD COLUMN IF NOT EXISTS lo_id INTEGER REFERENCES learning_objectives(id) ON DELETE SET NULL;`);
await pool.query(`ALTER TABLE rows_data ADD COLUMN IF NOT EXISTS lo_language TEXT;`);
await pool.query(`ALTER TABLE rows_data ADD COLUMN IF NOT EXISTS learning_objective TEXT;`);
await pool.query(`ALTER TABLE rows_data ADD COLUMN IF NOT EXISTS source_file TEXT;`);

await pool.query('CREATE INDEX IF NOT EXISTS idx_rows_model_lang ON rows_data(model, language);');
await pool.query('CREATE INDEX IF NOT EXISTS idx_rows_lo ON rows_data(lo_id);');

await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    languages TEXT NOT NULL DEFAULT '[]',
    models TEXT NOT NULL DEFAULT '[]',
    is_admin INTEGER NOT NULL DEFAULT 0,
    can_see_model INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  );
`);

await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS models TEXT NOT NULL DEFAULT '[]';`);
// Whether this annotator is shown which LLM generated a problem. Admins can
// switch it off per user so annotation stays blind to the model.
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_see_model INTEGER NOT NULL DEFAULT 1;`);

const annotationFlagCols = FLAG_KEYS.map((k) => `${k} INTEGER NOT NULL DEFAULT 0`).join(',\n    ');

await pool.query(`
  CREATE TABLE IF NOT EXISTS annotations (
    id SERIAL PRIMARY KEY,
    row_id INTEGER NOT NULL REFERENCES rows_data(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ${annotationFlagCols},
    comments TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(row_id, user_id)
  );
`);

// Flag columns are generated from flags.js, so a new error category added
// there lands on existing databases too.
for (const key of FLAG_KEYS) {
  await pool.query(`ALTER TABLE annotations ADD COLUMN IF NOT EXISTS ${key} INTEGER NOT NULL DEFAULT 0;`);
}

await pool.query('CREATE INDEX IF NOT EXISTS idx_annotations_row ON annotations(row_id);');
await pool.query('CREATE INDEX IF NOT EXISTS idx_annotations_user ON annotations(user_id);');

// ---------------------------------------------------------------------------
// One-time migration: annotations used to live as columns on rows_data, with
// the annotator recorded only as a free-text name. Move each of those into the
// annotations table (attributed to the matching user account), then drop the
// old columns so there is a single place a saved annotation can live.
// ---------------------------------------------------------------------------
if (await columnExists('rows_data', 'status')) {
  const legacyCols = [...FLAG_KEYS, 'comments', 'status', 'annotated_by', 'updated_at'];
  const legacyWhere = `status = 'reviewed' OR COALESCE(comments, '') <> '' OR ${FLAG_KEYS.map((k) => `${k} = 1`).join(' OR ')}`;
  const legacy = await all(
    `SELECT id, ${legacyCols.join(', ')} FROM rows_data WHERE ${legacyWhere}`
  );

  let migrated = 0;
  let placeholders = 0;
  for (const r of legacy) {
    const name = (r.annotated_by || '').trim();
    let user = name
      ? await get('SELECT id FROM users WHERE display_name = ? OR username = ? ORDER BY id LIMIT 1', [name, name])
      : null;
    if (!user) {
      // Keep the annotation rather than discard it: park it on an inactive
      // placeholder account named after whoever the old row said made it.
      const username = name ? `legacy:${name}` : 'legacy:unknown';
      user = await get('SELECT id FROM users WHERE username = ?', [username]);
      if (!user) {
        user = await get(
          `INSERT INTO users (username, password_hash, display_name, languages, models, is_admin, can_see_model, active, created_at)
           VALUES (?, '!', ?, '[]', '[]', 0, 1, 0, ?) RETURNING id`,
          [username, name || 'Unknown (legacy)', new Date().toISOString()]
        );
        placeholders += 1;
      }
    }
    const flagValues = FLAG_KEYS.map((k) => (r[k] ? 1 : 0));
    await run(
      `INSERT INTO annotations (row_id, user_id, ${FLAG_KEYS.join(', ')}, comments, status, created_at, updated_at)
       VALUES (?, ?, ${FLAG_KEYS.map(() => '?').join(', ')}, ?, ?, ?, ?)
       ON CONFLICT (row_id, user_id) DO NOTHING`,
      [
        r.id,
        user.id,
        ...flagValues,
        r.comments || '',
        r.status === 'reviewed' ? 'reviewed' : 'pending',
        r.updated_at || new Date().toISOString(),
        r.updated_at || new Date().toISOString(),
      ]
    );
    migrated += 1;
  }

  for (const col of legacyCols) {
    await pool.query(`ALTER TABLE rows_data DROP COLUMN IF EXISTS ${col};`);
  }
  console.log(
    `[db] Migrated ${migrated} legacy annotation(s) off rows_data into the annotations table` +
      (placeholders ? ` (created ${placeholders} inactive placeholder account(s) for unrecognised annotator names)` : '')
  );
}

export async function allLanguages() {
  const rows = await all('SELECT DISTINCT language FROM rows_data ORDER BY language');
  return rows.map((r) => r.language);
}

// The model list is read on nearly every request (to resolve opaque model
// refs), but only changes when a workbook is imported — memoise it briefly.
let modelsCache = { at: 0, value: null };
const MODELS_TTL_MS = 30_000;

export async function allModels() {
  if (modelsCache.value && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.value;
  const rows = await all('SELECT DISTINCT model FROM rows_data ORDER BY model');
  modelsCache = { at: Date.now(), value: rows.map((r) => r.model) };
  return modelsCache.value;
}

export function invalidateModelsCache() {
  modelsCache = { at: 0, value: null };
}
