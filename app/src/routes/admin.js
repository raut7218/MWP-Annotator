import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run, allLanguages, allModels } from '../db.js';
import { buildWorkbookForModelLanguages, workbookToBuffer } from '../exportXlsx.js';

export const adminRouter = Router();

adminRouter.get('/users', async (req, res) => {
  const rows = await all(
    'SELECT id, username, display_name, languages, models, is_admin, active, created_at FROM users ORDER BY username'
  );
  const users = rows.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    languages: JSON.parse(u.languages || '[]'),
    models: JSON.parse(u.models || '[]'),
    isAdmin: !!u.is_admin,
    active: !!u.active,
    createdAt: u.created_at,
  }));
  res.json({ users, availableLanguages: await allLanguages(), availableModels: await allModels() });
});

adminRouter.post('/users', async (req, res) => {
  const { username, password, displayName, languages, models, isAdmin } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  if (await get('SELECT id FROM users WHERE username = ?', [String(username).trim()])) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  await run(
    `INSERT INTO users (username, password_hash, display_name, languages, models, is_admin, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      String(username).trim(),
      hash,
      displayName || username,
      JSON.stringify(Array.isArray(languages) ? languages : []),
      JSON.stringify(Array.isArray(models) ? models : []),
      isAdmin ? 1 : 0,
      new Date().toISOString(),
    ]
  );
  res.status(201).json({ ok: true });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  if (id === req.user.id && (body.active === false || body.isAdmin === false)) {
    return res.status(400).json({ error: 'Cannot remove your own admin/active status' });
  }
  if (body.languages !== undefined) await run('UPDATE users SET languages = ? WHERE id = ?', [JSON.stringify(body.languages), id]);
  if (body.models !== undefined) await run('UPDATE users SET models = ? WHERE id = ?', [JSON.stringify(body.models), id]);
  if (body.active !== undefined) await run('UPDATE users SET active = ? WHERE id = ?', [body.active ? 1 : 0, id]);
  if (body.isAdmin !== undefined) await run('UPDATE users SET is_admin = ? WHERE id = ?', [body.isAdmin ? 1 : 0, id]);
  if (body.displayName !== undefined) await run('UPDATE users SET display_name = ? WHERE id = ?', [body.displayName, id]);
  if (body.password) await run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(String(body.password), 10), id]);
  res.json({ ok: true });
});

adminRouter.get('/overview', async (req, res) => {
  const rows = await all(
    `SELECT model, language, status, COUNT(*)::int as c FROM rows_data WHERE is_complete = 1 GROUP BY model, language, status`
  );
  const byKey = {};
  for (const r of rows) {
    const key = `${r.model}::${r.language}`;
    if (!byKey[key]) byKey[key] = { model: r.model, language: r.language, total: 0, reviewed: 0, pending: 0 };
    byKey[key].total += r.c;
    byKey[key][r.status] = (byKey[key][r.status] || 0) + r.c;
  }
  const overview = Object.values(byKey).sort((a, b) => a.model.localeCompare(b.model) || a.language.localeCompare(b.language));
  res.json({ overview });
});

adminRouter.get('/export/:model/:language', async (req, res) => {
  const { model, language } = req.params;
  const wb = await buildWorkbookForModelLanguages([{ model, language }]);
  const buf = workbookToBuffer(wb);
  res.setHeader('Content-Disposition', `attachment; filename="${model}_${language}_annotated.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

adminRouter.get('/export-all', async (req, res) => {
  const pairs = await all('SELECT DISTINCT model, language FROM rows_data ORDER BY model, language');
  const wb = await buildWorkbookForModelLanguages(pairs);
  const buf = workbookToBuffer(wb);
  res.setHeader('Content-Disposition', 'attachment; filename="combined_annotated.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});
