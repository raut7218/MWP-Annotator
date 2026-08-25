import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, allLanguages } from '../db.js';
import { buildWorkbookForLanguages, workbookToBuffer } from '../exportXlsx.js';

export const adminRouter = Router();

const listUsersStmt = db.prepare(
  'SELECT id, username, display_name, languages, is_admin, active, created_at FROM users ORDER BY username'
);

adminRouter.get('/users', (req, res) => {
  const users = listUsersStmt.all().map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    languages: JSON.parse(u.languages || '[]'),
    isAdmin: !!u.is_admin,
    active: !!u.active,
    createdAt: u.created_at,
  }));
  res.json({ users, availableLanguages: allLanguages() });
});

const findUserStmt = db.prepare('SELECT id FROM users WHERE username = ?');
const insertUserStmt = db.prepare(`
  INSERT INTO users (username, password_hash, display_name, languages, is_admin, active, created_at)
  VALUES (?, ?, ?, ?, ?, 1, ?)
`);

adminRouter.post('/users', (req, res) => {
  const { username, password, displayName, languages, isAdmin } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  if (findUserStmt.get(String(username).trim())) return res.status(409).json({ error: 'Username already exists' });
  const hash = bcrypt.hashSync(String(password), 10);
  insertUserStmt.run(
    String(username).trim(),
    hash,
    displayName || username,
    JSON.stringify(Array.isArray(languages) ? languages : []),
    isAdmin ? 1 : 0,
    new Date().toISOString()
  );
  res.status(201).json({ ok: true });
});

const patchFieldsStmt = {
  languages: db.prepare('UPDATE users SET languages = ? WHERE id = ?'),
  active: db.prepare('UPDATE users SET active = ? WHERE id = ?'),
  isAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  password: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  displayName: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
};

adminRouter.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  if (id === req.user.id && (body.active === false || body.isAdmin === false)) {
    return res.status(400).json({ error: 'Cannot remove your own admin/active status' });
  }
  if (body.languages !== undefined) patchFieldsStmt.languages.run(JSON.stringify(body.languages), id);
  if (body.active !== undefined) patchFieldsStmt.active.run(body.active ? 1 : 0, id);
  if (body.isAdmin !== undefined) patchFieldsStmt.isAdmin.run(body.isAdmin ? 1 : 0, id);
  if (body.displayName !== undefined) patchFieldsStmt.displayName.run(body.displayName, id);
  if (body.password) patchFieldsStmt.password.run(bcrypt.hashSync(String(body.password), 10), id);
  res.json({ ok: true });
});

adminRouter.get('/overview', (req, res) => {
  const languages = allLanguages();
  const flaggedExprStmt = db.prepare(
    `SELECT language, status, COUNT(*) as c FROM rows_data WHERE is_complete = 1 GROUP BY language, status`
  );
  const rows = flaggedExprStmt.all();
  const overview = {};
  for (const l of languages) overview[l] = { total: 0, reviewed: 0, pending: 0 };
  for (const r of rows) {
    overview[r.language].total += r.c;
    overview[r.language][r.status] = (overview[r.language][r.status] || 0) + r.c;
  }
  res.json({ overview });
});

adminRouter.get('/export/:language', (req, res) => {
  const { language } = req.params;
  const wb = buildWorkbookForLanguages([language]);
  const buf = workbookToBuffer(wb);
  res.setHeader('Content-Disposition', `attachment; filename="${language}_annotated.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

adminRouter.get('/export-all', (req, res) => {
  const languages = allLanguages();
  const wb = buildWorkbookForLanguages(languages);
  const buf = workbookToBuffer(wb);
  res.setHeader('Content-Disposition', 'attachment; filename="combined_annotated.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});
