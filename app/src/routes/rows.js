import { Router } from 'express';
import { db } from '../db.js';
import { FLAGS, FLAG_KEYS } from '../flags.js';
import { canAccessLanguage, userLanguages } from '../auth.js';
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
  res.json({ items: items.slice(0, 300), total: items.length });
});

const flaggedExpr = FLAG_KEYS.map((k) => `${k} = 1`).join(' OR ');

const languageStatsStmt = db.prepare(`
  SELECT
    language,
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS done,
    SUM(CASE WHEN ${flaggedExpr} THEN 1 ELSE 0 END) AS flagged
  FROM rows_data
  WHERE is_complete = 1
  GROUP BY language
  ORDER BY language
`);

rowsRouter.get('/flags', (req, res) => {
  res.json({ flags: FLAGS });
});

rowsRouter.get('/languages', (req, res) => {
  const allowed = userLanguages(req.user); // null = all
  const stats = languageStatsStmt.all().filter((s) => allowed === null || allowed.includes(s.language));
  res.json({ languages: stats });
});

const listStmt = db.prepare(`
  SELECT id, row_index, status, (${flaggedExpr}) AS flagged
  FROM rows_data WHERE language = ? AND is_complete = 1 ORDER BY row_index ASC
`);

rowsRouter.get('/rows/:language/list', (req, res) => {
  const { language } = req.params;
  if (!canAccessLanguage(req.user, language)) return res.status(403).json({ error: 'No access to this language' });
  const items = listStmt.all(language).map((r) => ({ ...r, flagged: !!r.flagged }));
  res.json({ items });
});

const detailStmt = db.prepare('SELECT * FROM rows_data WHERE language = ? AND row_index = ? AND is_complete = 1');
const totalStmt = db.prepare('SELECT COUNT(*) AS c FROM rows_data WHERE language = ? AND is_complete = 1');

rowsRouter.get('/rows/:language/:rowIndex', (req, res) => {
  const { language } = req.params;
  const rowIndex = Number(req.params.rowIndex);
  if (!canAccessLanguage(req.user, language)) return res.status(403).json({ error: 'No access to this language' });
  const row = detailStmt.get(language, rowIndex);
  if (!row) return res.status(404).json({ error: 'Row not found' });
  const totalRow = totalStmt.get(language);
  res.json({ row: shapeRow(row), total: totalRow.c });
});

const byIdStmt = db.prepare('SELECT * FROM rows_data WHERE id = ?');
const updateCols = [...FLAG_KEYS, 'comments', 'status', 'annotated_by', 'updated_at'];
const updateStmt = db.prepare(
  `UPDATE rows_data SET ${updateCols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
);

rowsRouter.put('/rows/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = byIdStmt.get(id);
  if (!existing) return res.status(404).json({ error: 'Row not found' });
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
  updateStmt.run(...values);
  const updated = byIdStmt.get(id);
  res.json({ row: shapeRow(updated) });
});

function shapeRow(r) {
  const flags = {};
  for (const k of FLAG_KEYS) flags[k] = !!r[k];
  return {
    id: r.id,
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
