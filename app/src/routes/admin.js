import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run, allLanguages, allModels, invalidateModelsCache } from '../db.js';
import { FLAG_KEYS } from '../flags.js';
import { buildWorkbookForModelLanguages, workbookToBuffer } from '../exportXlsx.js';

export const adminRouter = Router();

adminRouter.get('/users', async (req, res) => {
  const rows = await all(
    `SELECT u.id, u.username, u.display_name, u.languages, u.models, u.is_admin, u.can_see_model, u.active, u.created_at,
            COUNT(a.id)::int AS annotation_count
     FROM users u
     LEFT JOIN annotations a ON a.user_id = u.id AND a.status = 'reviewed'
     GROUP BY u.id
     ORDER BY u.username`
  );
  const users = rows.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    languages: JSON.parse(u.languages || '[]'),
    models: JSON.parse(u.models || '[]'),
    isAdmin: !!u.is_admin,
    canSeeModel: !!u.is_admin || !!u.can_see_model,
    active: !!u.active,
    createdAt: u.created_at,
    reviewedCount: u.annotation_count,
  }));
  res.json({ users, availableLanguages: await allLanguages(), availableModels: await allModels() });
});

adminRouter.post('/users', async (req, res) => {
  const { username, password, displayName, languages, models, isAdmin, canSeeModel } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  if (await get('SELECT id FROM users WHERE username = ?', [String(username).trim()])) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  await run(
    `INSERT INTO users (username, password_hash, display_name, languages, models, is_admin, can_see_model, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      String(username).trim(),
      hash,
      displayName || username,
      JSON.stringify(Array.isArray(languages) ? languages : []),
      JSON.stringify(Array.isArray(models) ? models : []),
      isAdmin ? 1 : 0,
      canSeeModel === false ? 0 : 1,
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
  // Whether this annotator is shown which LLM generated each problem.
  if (body.canSeeModel !== undefined) await run('UPDATE users SET can_see_model = ? WHERE id = ?', [body.canSeeModel ? 1 : 0, id]);
  if (body.displayName !== undefined) await run('UPDATE users SET display_name = ? WHERE id = ?', [body.displayName, id]);
  if (body.password) await run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(String(body.password), 10), id]);
  res.json({ ok: true });
});

const flaggedExpr = FLAG_KEYS.map((k) => `a.${k} = 1`).join(' OR ');

adminRouter.get('/overview', async (req, res) => {
  const totals = await all(
    `SELECT model, language, COUNT(*)::int AS total
     FROM rows_data WHERE is_complete = 1 GROUP BY model, language`
  );
  // Progress is per annotator now, so a sheet worked by two people shows two
  // bars rather than one ambiguous number.
  const perAnnotator = await all(
    `SELECT r.model, r.language, u.id AS user_id, u.username, u.display_name,
            SUM(CASE WHEN a.status = 'reviewed' THEN 1 ELSE 0 END)::int AS reviewed,
            SUM(CASE WHEN ${flaggedExpr} THEN 1 ELSE 0 END)::int AS flagged
     FROM annotations a
     JOIN rows_data r ON r.id = a.row_id AND r.is_complete = 1
     JOIN users u ON u.id = a.user_id
     GROUP BY r.model, r.language, u.id, u.username, u.display_name
     ORDER BY r.model, r.language, u.username`
  );

  const byKey = {};
  for (const t of totals) {
    byKey[`${t.model}::${t.language}`] = {
      model: t.model,
      language: t.language,
      total: t.total,
      annotators: [],
    };
  }
  for (const p of perAnnotator) {
    const entry = byKey[`${p.model}::${p.language}`];
    if (!entry) continue;
    entry.annotators.push({
      userId: p.user_id,
      username: p.username,
      displayName: p.display_name || p.username,
      reviewed: p.reviewed,
      flagged: p.flagged,
    });
  }
  const overview = Object.values(byKey).sort(
    (a, b) => a.model.localeCompare(b.model) || a.language.localeCompare(b.language)
  );
  res.json({ overview });
});

adminRouter.get('/export/:model/:language', async (req, res) => {
  const { model, language } = req.params;
  const wb = await buildWorkbookForModelLanguages([{ model, language }]);
  const buf = workbookToBuffer(wb);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(`${model}_${language}`)}_annotated.xlsx"`);
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

// Clearing a sheet that was imported wrongly. Deleting the rows cascades to
// their annotations, so this asks for the exact row count back as
// confirmation rather than trusting a button press.
adminRouter.delete('/data/:model/:language', async (req, res) => {
  const { model, language } = req.params;
  const counts = await get(
    `SELECT COUNT(*)::int AS rows,
            (SELECT COUNT(*)::int FROM annotations a JOIN rows_data r2 ON r2.id = a.row_id
              WHERE r2.model = ? AND r2.language = ?) AS annotations
     FROM rows_data WHERE model = ? AND language = ?`,
    [model, language, model, language]
  );
  if (!counts.rows) return res.status(404).json({ error: 'Nothing imported for that model and language' });
  if (Number(req.query.confirmRows) !== counts.rows) {
    return res.status(409).json({
      error: `Refusing to delete: expected confirmRows=${counts.rows}`,
      rows: counts.rows,
      annotations: counts.annotations,
    });
  }
  await run('DELETE FROM rows_data WHERE model = ? AND language = ?', [model, language]);
  // Learning objectives can outlive the rows that referenced them; drop the
  // ones nothing points at any more so the list does not silently grow.
  await run(
    `DELETE FROM learning_objectives lo
      WHERE NOT EXISTS (SELECT 1 FROM rows_data r WHERE r.lo_id = lo.id)`
  );
  invalidateModelsCache();
  res.json({ ok: true, deletedRows: counts.rows, deletedAnnotations: counts.annotations });
});

// Language names like "Māori" are fine in a sheet name but not in a bare
// Content-Disposition filename, which must stay ASCII.
function safeFilename(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_');
}
