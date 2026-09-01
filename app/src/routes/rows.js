import { Router } from 'express';
import { all, get, run, allModels } from '../db.js';
import { FLAGS, FLAG_KEYS } from '../flags.js';
import { canAccessLanguage, canAccessModel, userLanguages, userModels } from '../auth.js';
import { describeModel, modelFromRef } from '../models.js';
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

// Progress is per annotator: with several people on the same model/language
// sheet, "done" means done *by you*, so everyone gets their own bar.
const flaggedExpr = FLAG_KEYS.map((k) => `a.${k} = 1`).join(' OR ');

const modelStatsSql = `
  SELECT
    r.model,
    COUNT(*)::int AS total,
    SUM(CASE WHEN a.status = 'reviewed' THEN 1 ELSE 0 END)::int AS done,
    SUM(CASE WHEN ${flaggedExpr} THEN 1 ELSE 0 END)::int AS flagged
  FROM rows_data r
  LEFT JOIN annotations a ON a.row_id = r.id AND a.user_id = $1
  WHERE r.is_complete = 1 AND ($2::text[] IS NULL OR r.language = ANY($2))
  GROUP BY r.model
  ORDER BY r.model
`;

const languageStatsSql = `
  SELECT
    r.language,
    COUNT(*)::int AS total,
    SUM(CASE WHEN a.status = 'reviewed' THEN 1 ELSE 0 END)::int AS done,
    SUM(CASE WHEN ${flaggedExpr} THEN 1 ELSE 0 END)::int AS flagged
  FROM rows_data r
  LEFT JOIN annotations a ON a.row_id = r.id AND a.user_id = $1
  WHERE r.model = $2 AND r.is_complete = 1
  GROUP BY r.language
  ORDER BY r.language
`;

const listSql = `
  SELECT r.id, r.row_index, r.grade, r.lo_language,
         COALESCE(a.status, 'pending') AS status,
         (${flaggedExpr}) AS flagged
  FROM rows_data r
  LEFT JOIN annotations a ON a.row_id = r.id AND a.user_id = $1
  WHERE r.model = $2 AND r.language = $3 AND r.is_complete = 1
  ORDER BY r.row_index ASC
`;

rowsRouter.get('/flags', (req, res) => {
  res.json({ flags: FLAGS });
});

// Resolves the :modelRef path segment to a real model name, enforcing access.
// Returns null (and sends the response) when the caller may not have it.
async function resolveModel(req, res) {
  const known = await allModels();
  const model = modelFromRef(req.params.modelRef, known);
  if (!model || !canAccessModel(req.user, model)) {
    res.status(403).json({ error: 'No access to this model' });
    return null;
  }
  return model;
}

rowsRouter.get('/models', async (req, res) => {
  const allowedModels = userModels(req.user); // null = all
  const allowedLangs = userLanguages(req.user); // null = all
  const sorted = await allModels();
  const stats = (await all(modelStatsSql, [req.user.id, allowedLangs])).filter(
    (s) => allowedModels === null || allowedModels.includes(s.model)
  );
  res.json({
    models: stats.map((s) => ({
      ...describeModel(s.model, req.user, sorted),
      total: s.total,
      done: s.done,
      flagged: s.flagged,
    })),
  });
});

rowsRouter.get('/models/:modelRef/languages', async (req, res) => {
  const model = await resolveModel(req, res);
  if (!model) return;
  const allowedLangs = userLanguages(req.user); // null = all
  const stats = (await all(languageStatsSql, [req.user.id, model])).filter(
    (s) => allowedLangs === null || allowedLangs.includes(s.language)
  );
  res.json({ languages: stats });
});

rowsRouter.get('/rows/:modelRef/:language/list', async (req, res) => {
  const model = await resolveModel(req, res);
  if (!model) return;
  const { language } = req.params;
  if (!canAccessLanguage(req.user, language)) return res.status(403).json({ error: 'No access to this language' });
  const items = (await all(listSql, [req.user.id, model, language])).map((r) => ({
    id: r.id,
    row_index: r.row_index,
    grade: r.grade,
    loLanguage: r.lo_language,
    status: r.status,
    flagged: !!r.flagged,
  }));
  res.json({ items });
});

const rowDetailSql = `
  SELECT r.*, lo.code AS lo_code, lo.ordinal AS lo_ordinal,
         a.id AS annotation_id, a.status AS annotation_status, a.comments AS annotation_comments,
         a.updated_at AS annotation_updated_at,
         ${FLAG_KEYS.map((k) => `a.${k} AS flag_${k}`).join(', ')}
  FROM rows_data r
  LEFT JOIN learning_objectives lo ON lo.id = r.lo_id
  LEFT JOIN annotations a ON a.row_id = r.id AND a.user_id = $1
  WHERE r.model = $2 AND r.language = $3 AND r.row_index = $4 AND r.is_complete = 1
`;

rowsRouter.get('/rows/:modelRef/:language/:rowIndex', async (req, res) => {
  const model = await resolveModel(req, res);
  if (!model) return;
  const { language } = req.params;
  const rowIndex = Number(req.params.rowIndex);
  if (!canAccessLanguage(req.user, language)) return res.status(403).json({ error: 'No access to this language' });
  const row = await get(rowDetailSql, [req.user.id, model, language, rowIndex]);
  if (!row) return res.status(404).json({ error: 'Row not found' });
  const totalRow = await get(
    'SELECT COUNT(*)::int AS c FROM rows_data WHERE model = ? AND language = ? AND is_complete = 1',
    [model, language]
  );
  // How many other people have already reviewed this same problem — useful
  // context when a sheet is double-annotated, and it never reveals what they
  // said.
  const others = await get(
    `SELECT COUNT(*)::int AS c FROM annotations WHERE row_id = ? AND user_id <> ? AND status = 'reviewed'`,
    [row.id, req.user.id]
  );
  const sorted = await allModels();
  res.json({ row: shapeRow(row, req.user, sorted), total: totalRow.c, otherAnnotators: others.c });
});

const upsertSql = `
  INSERT INTO annotations (row_id, user_id, ${FLAG_KEYS.join(', ')}, comments, status, created_at, updated_at)
  VALUES (?, ?, ${FLAG_KEYS.map(() => '?').join(', ')}, ?, ?, now(), now())
  ON CONFLICT (row_id, user_id) DO UPDATE SET
    ${FLAG_KEYS.map((k) => `${k} = EXCLUDED.${k}`).join(',\n    ')},
    comments = EXCLUDED.comments,
    status = EXCLUDED.status,
    updated_at = now()
`;

// Saves *this* annotator's take on a problem. Two annotators saving the same
// problem write two rows, neither overwriting the other.
rowsRouter.put('/annotations/:rowId', async (req, res) => {
  const rowId = Number(req.params.rowId);
  const existing = await get('SELECT * FROM rows_data WHERE id = ?', [rowId]);
  if (!existing) return res.status(404).json({ error: 'Row not found' });
  if (!canAccessModel(req.user, existing.model)) return res.status(403).json({ error: 'No access to this model' });
  if (!canAccessLanguage(req.user, existing.language)) return res.status(403).json({ error: 'No access to this language' });

  const body = req.body || {};
  const flags = body.flags || {};
  const status = body.status === 'reviewed' ? 'reviewed' : 'pending';
  const comments = typeof body.comments === 'string' ? body.comments : '';

  await run(upsertSql, [
    rowId,
    req.user.id,
    ...FLAG_KEYS.map((k) => (flags[k] ? 1 : 0)),
    comments,
    status,
  ]);

  const sorted = await allModels();
  const updated = await get(rowDetailSql, [req.user.id, existing.model, existing.language, existing.row_index]);
  res.json({ row: shapeRow(updated, req.user, sorted) });
});

// Wipes this annotator's take on a problem entirely — flags, comments, and
// the reviewed status all go away, leaving the row exactly as if it had
// never been touched. Only ever touches the caller's own annotation.
rowsRouter.delete('/annotations/:rowId', async (req, res) => {
  const rowId = Number(req.params.rowId);
  const existing = await get('SELECT * FROM rows_data WHERE id = ?', [rowId]);
  if (!existing) return res.status(404).json({ error: 'Row not found' });
  if (!canAccessModel(req.user, existing.model)) return res.status(403).json({ error: 'No access to this model' });
  if (!canAccessLanguage(req.user, existing.language)) return res.status(403).json({ error: 'No access to this language' });

  await run('DELETE FROM annotations WHERE row_id = ? AND user_id = ?', [rowId, req.user.id]);

  const sorted = await allModels();
  const updated = await get(rowDetailSql, [req.user.id, existing.model, existing.language, existing.row_index]);
  res.json({ row: shapeRow(updated, req.user, sorted) });
});

function shapeRow(r, user, allModelsSorted) {
  const flags = {};
  for (const k of FLAG_KEYS) flags[k] = !!r[`flag_${k}`];
  return {
    id: r.id,
    model: describeModel(r.model, user, allModelsSorted),
    language: r.language,
    rowIndex: r.row_index,
    grade: r.grade,
    topic: r.topic,
    learningObjective: r.learning_objective || '',
    loLanguage: r.lo_language || '',
    loCode: r.lo_code || '',
    question: r.question,
    answer: r.answer,
    parseError: !!r.parse_error,
    rawResponse: r.raw_response,
    flags,
    comments: r.annotation_comments || '',
    status: r.annotation_status || 'pending',
    annotatedBy: r.annotation_id ? user.displayName || user.username : null,
    updatedAt: r.annotation_updated_at,
  };
}
