// Creates/updates user accounts from users.seed.json (gitignored, edit it
// yourself before running `npm run seed`). Safe to re-run: existing
// usernames get their password/languages/admin flag refreshed.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, '..', 'users.seed.json');

if (!fs.existsSync(seedPath)) {
  console.error(`No seed file found at ${seedPath}`);
  console.error('Create it (see users.seed.example.json) and re-run.');
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

const findStmt = db.prepare('SELECT id FROM users WHERE username = ?');
const insertStmt = db.prepare(`
  INSERT INTO users (username, password_hash, display_name, languages, is_admin, active, created_at)
  VALUES (?, ?, ?, ?, ?, 1, ?)
`);
const updateStmt = db.prepare(`
  UPDATE users SET password_hash = ?, display_name = ?, languages = ?, is_admin = ?, active = 1
  WHERE username = ?
`);

for (const u of users) {
  const hash = bcrypt.hashSync(u.password, 10);
  const languages = JSON.stringify(u.languages || []);
  const isAdmin = u.isAdmin ? 1 : 0;
  const existing = findStmt.get(u.username);
  if (existing) {
    updateStmt.run(hash, u.displayName || u.username, languages, isAdmin, u.username);
    console.log(`Updated user: ${u.username}`);
  } else {
    insertStmt.run(u.username, hash, u.displayName || u.username, languages, isAdmin, new Date().toISOString());
    console.log(`Created user: ${u.username}`);
  }
}

console.log('Done.');
