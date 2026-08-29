// Writing a parsed workbook into Postgres. Kept apart from the parsers so
// that reading a workbook never requires a database connection.
import { get, run, invalidateModelsCache } from '../db.js';

// Writes a parsed workbook. Matches rows on (model, language, row_index) and
// refreshes only the source columns, so re-importing never disturbs
// annotations already saved against those rows.
export async function persistParsed(parsed) {
  const loIdByCode = new Map();
  for (const lo of parsed.learningObjectives) {
    let existing = await get('SELECT id FROM learning_objectives WHERE code = ?', [lo.code]);
    if (!existing) {
      existing = await get('INSERT INTO learning_objectives (code, grade, ordinal) VALUES (?, ?, ?) RETURNING id', [
        lo.code,
        lo.grade,
        lo.ordinal,
      ]);
    } else {
      await run('UPDATE learning_objectives SET grade = ?, ordinal = ? WHERE id = ?', [lo.grade, lo.ordinal, existing.id]);
    }
    loIdByCode.set(lo.code, existing.id);
    for (const t of lo.texts) {
      await run(
        `INSERT INTO learning_objective_texts (lo_id, language, text) VALUES (?, ?, ?)
         ON CONFLICT (lo_id, language) DO UPDATE SET text = EXCLUDED.text`,
        [existing.id, t.language, t.text]
      );
    }
  }

  let inserted = 0;
  let updated = 0;
  for (const rec of parsed.records) {
    const loId = rec.loCode ? loIdByCode.get(rec.loCode) ?? null : null;
    const values = [
      rec.grade,
      rec.topic,
      rec.question,
      rec.answer,
      rec.rawResponse,
      rec.parseError,
      rec.isComplete,
      loId,
      rec.loLanguage,
      rec.loText,
      parsed.sourceFile,
    ];
    const existing = await get('SELECT id FROM rows_data WHERE model = ? AND language = ? AND row_index = ?', [
      rec.model,
      rec.language,
      rec.rowIndex,
    ]);
    if (existing) {
      await run(
        `UPDATE rows_data SET grade = ?, topic = ?, question = ?, answer = ?, raw_response = ?, parse_error = ?,
                is_complete = ?, lo_id = ?, lo_language = ?, learning_objective = ?, source_file = ?
         WHERE id = ?`,
        [...values, existing.id]
      );
      updated += 1;
    } else {
      await run(
        `INSERT INTO rows_data (model, language, row_index, grade, topic, question, answer, raw_response, parse_error,
                                is_complete, lo_id, lo_language, learning_objective, source_file)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rec.model, rec.language, rec.rowIndex, ...values]
      );
      inserted += 1;
    }
  }

  invalidateModelsCache();
  return { inserted, updated, learningObjectives: parsed.learningObjectives.length };
}
