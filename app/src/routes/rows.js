import { Router } from 'express';
import { all, get, run } from '../db.js';
import { FLAGS, FLAG_KEYS } from '../flags.js';
import { canAccessLanguage, canAccessModel, userLanguages, userModels } from '../auth.js';
import { guidelines, errorCategories, ncertExamples, ncertGrades, ncertTopics } from '../reference.js';

export const rowsRouter = Router();

rowsRouter.get('/reference/guidelines', (req, res) => {
  res.json({ guidelines });
});

rowsRouter.get('/reference/error-categories', (req, res) => {
  res.json({ errorCategories });
});

rowsRouter.get('/reference/examples/meta', (req, res) => {
  res.json({ grades: ncertGrades, topics: ncertTopics });
});

rowsRouter.get('/reference/examples', (req, res) => {
  const { grade, topic, q } = req.query;
  let items = ncertExamples;
  if (grade) items = items.filter((r) => r.grade === String(grade));
  if (topic) items = items.filter((r) => r.topic === topic);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter(
      (r) =>
        r.question.toLowerCase().includes(needle) ||
        r.topic.toLowerCase().includes(needle) ||
        r.learningObjective.toLowerCase().includes(needle)
    );
  }
  // Cap well above the current dataset size (456 rows across grades 3-5) so
  // an unfiltered "all grades" view isn't cut off mid-grade.
  res.json({ items: items.slice(0, 1000), total: items.length });
});

const flaggedExpr = FLAG_KEYS.map((k) => `${k} = 1`).join(' OR ');

const modelStatsSql = `
  SELECT
    model,
    COUNT(*)::int AS total,
    SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END)::int AS done,
    SUM(CASE WHEN ${flaggedExpr} THEN 1 ELSE 0 END)::int AS flagged
  FROM rows_data
  WHERE is_complete = 1 AND ($1::text[] IS NULL OR language = ANY($1))
  GROUP BY model
  ORDER BY model
`;

const languageStatsSql = `
  SELECT
    language,
    COUNT(*)::int AS total,
    SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END)::int AS done,
    SUM(CASE WHEN ${flaggedExpr} THEN 1 ELSE 0 END)::int AS flagged
  FROM rows_data
  WHERE model = ? AND is_complete = 1
  GROUP BY language
  ORDER BY language
`;

rowsRouter.get('/flags', (req, res) => {
  res.json({ flags: FLAGS });
});

rowsRouter.get('/models', async (req, res) => {
  const allowedModels = userModels(req.user); // null = all
  const allowedLangs = userLanguages(req.user); // null = all
  const stats = (await all(modelStatsSql, [allowedLangs])).filter(
    (s) => allowedModels === null || allowedModels.includes(s.model)
  );
  res.json({ models: stats });
});

rowsRouter.get('/models/:model/languages', async (req, res) => {
  const { model } = req.params;
  if (!canAccessModel(req.user, model)) return res.status(403).json({ error: 'No access to this model' });
  const allowedLangs = userLanguages(req.user); // null = all
  const stats = (await all(languageStatsSql, [model])).filter(
    (s) => allowedLangs === null || allowedLangs.includes(s.language)
  );
  res.json({ languages: stats });
});

const listSql = `
  SELECT id, row_index, status, (${flaggedExpr}) AS flagged
  FROM rows_data WHERE model = ? AND language = ? AND is_complete = 1 ORDER BY row_index ASC
`;

rowsRouter.get('/rows/:model/:language/list', async (req, res) => {
  const { model, language } = req.params;
  if (!canAccessModel(req.user, model)) return res.status(403).json({ error: 'No access to this model' });
  if (!canAccessLanguage(req.user, language)) return res.status(403).json({ error: 'No access to this language' });
  const items = (await all(listSql, [model, language])).map((r) => ({ ...r, flagged: !!r.flagged }));
  res.json({ items });
});

rowsRouter.get('/rows/:model/:language/:rowIndex', async (req, res) => {
  const { model, language } = req.params;
  const rowIndex = Number(req.params.rowIndex);
  if (!canAccessModel(req.user, model)) return res.status(403).json({ error: 'No access to this model' });
  if (!canAccessLanguage(req.user, language)) return res.status(403).json({ error: 'No access to this language' });
  const row = await get('SELECT * FROM rows_data WHERE model = ? AND language = ? AND row_index = ? AND is_complete = 1', [
    model,
    language,
    rowIndex,
  ]);
  if (!row) return res.status(404).json({ error: 'Row not found' });
  const totalRow = await get('SELECT COUNT(*)::int AS c FROM rows_data WHERE model = ? AND language = ? AND is_complete = 1', [
    model,
    language,
  ]);
  res.json({ row: shapeRow(row), total: totalRow.c });
});

const updateCols = [...FLAG_KEYS, 'comments', 'status', 'annotated_by', 'updated_at'];
const updateSql = `UPDATE rows_data SET ${updateCols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;

rowsRouter.put('/rows/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await get('SELECT * FROM rows_data WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'Row not found' });
  if (!canAccessModel(req.user, existing.model)) return res.status(403).json({ error: 'No access to this model' });
  if (!canAccessLanguage(req.user, existing.language)) return res.status(403).json({ error: 'No access to this language' });

  const body = req.body || {};
  const flags = body.flags || {};
  const status = body.status === 'reviewed' ? 'reviewed' : 'pending';
  const comments = typeof body.comments === 'string' ? body.comments : '';

  const values = [
    ...FLAG_KEYS.map((k) => (flags[k] ? 1 : 0)),
    comments,
    status,
    req.user.displayName || req.user.username,
    new Date().toISOString(),
    id,
  ];
  await run(updateSql, values);
  const updated = await get('SELECT * FROM rows_data WHERE id = ?', [id]);
  res.json({ row: shapeRow(updated) });
});

function shapeRow(r) {
  const flags = {};
  for (const k of FLAG_KEYS) flags[k] = !!r[k];
  return {
    id: r.id,
    model: r.model,
    language: r.language,
    rowIndex: r.row_index,
    grade: r.grade,
    topic: r.topic,
    question: r.question,
    answer: r.answer,
    parseError: !!r.parse_error,
    rawResponse: r.raw_response,
    flags,
    comments: r.comments || '',
    status: r.status,
    annotatedBy: r.annotated_by,
    updatedAt: r.updated_at,
  };
}
