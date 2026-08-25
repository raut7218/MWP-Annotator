// One-time script: copies rows_data + users from the old local SQLite file
// (app/data/app.db) into the Postgres database pointed to by DATABASE_URL.
// Only needed if you already had annotators working against the SQLite
// version of this app and want to carry that progress over. Safe to re-run:
// upserts by the same unique keys as the schema (language+row_index, username).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { run } from './db.js';
import { FLAG_KEYS } from './flags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'data', 'app.db');

console.log('Reading SQLite database:', sqlitePath);
const sqlite = new DatabaseSync(sqlitePath);

const rows = sqlite.prepare('SELECT * FROM rows_data').all();
const users = sqlite.prepare('SELECT * FROM users').all();
sqlite.close();

const flagColsList = FLAG_KEYS.join(', ');
const flagPlaceholders = FLAG_KEYS.map(() => '?').join(', ');
const flagUpdates = FLAG_KEYS.map((k) => `${k} = EXCLUDED.${k}`).join(', ');

for (const r of rows) {
  await run(
    `INSERT INTO rows_data
       (language, row_index, grade, topic, question, answer, raw_response, parse_error, is_complete,
        ${flagColsList}, comments, status, annotated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${flagPlaceholders}, ?, ?, ?, ?)
     ON CONFLICT (language, row_index) DO UPDATE SET
       ${flagUpdates},
       comments = EXCLUDED.comments,
       status = EXCLUDED.status,
       annotated_by = EXCLUDED.annotated_by,
       updated_at = EXCLUDED.updated_at`,
    [
      r.language, r.row_index, r.grade, r.topic, r.question, r.answer, r.raw_response, r.parse_error, r.is_complete,
      ...FLAG_KEYS.map((k) => r[k]),
      r.comments, r.status, r.annotated_by, r.updated_at,
    ]
  );
}

for (const u of users) {
  await run(
    `INSERT INTO users (username, password_hash, display_name, languages, is_admin, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       display_name = EXCLUDED.display_name,
       languages = EXCLUDED.languages,
       is_admin = EXCLUDED.is_admin,
       active = EXCLUDED.active`,
    [u.username, u.password_hash, u.display_name, u.languages, u.is_admin, u.active, u.created_at]
  );
}

console.log(`Migrated ${rows.length} rows and ${users.length} users to Postgres.`);
process.exit(0);
