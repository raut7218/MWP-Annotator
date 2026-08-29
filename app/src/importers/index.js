// Picks a parser for an uploaded workbook, runs it, and writes the result.
//
// Adding support for a new sheet layout means adding a parser that returns the
// shape below and teaching `detectFormat` to recognise it — no schema change,
// and the admin upload page picks it up for free.
import XLSX from 'xlsx';
import { get, run, invalidateModelsCache } from '../db.js';
import { normalise } from './cells.js';
import { parseEvaluationWorkbook } from './evaluationSheet.js';
import { parseCombinedWorkbook } from './combinedWorkbook.js';

export { parseEvaluationWorkbook, parseCombinedWorkbook };

export const FORMATS = [
  { id: 'evaluation', label: 'Evaluation sheet (Grade | LLM | LO | Question | Answer)' },
  { id: 'combined', label: 'Combined workbook (one sheet per language, JSON response)' },
];

// Sniff the first sheet's header row. Explicit beats clever: the admin page
// shows what was detected and lets you override it before anything is written.
export function detectFormat(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', sheetRows: 1 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws['!ref']) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    if (cell && cell.v != null) headers.push(normalise(cell.v).toLowerCase());
  }
  if (headers.includes('response')) return 'combined';
  if (headers.includes('question') && (headers.includes('llm') || headers.includes('model'))) return 'evaluation';
  return null;
}

export function parseWorkbook(buffer, { format, language, sheet, model, sourceFile }) {
  const chosen = format || detectFormat(buffer);
  if (chosen === 'evaluation') return parseEvaluationWorkbook(buffer, { language, sheet, sourceFile });
  if (chosen === 'combined') return parseCombinedWorkbook(buffer, { model, sourceFile });
  throw new Error(
    'Could not recognise this workbook. Expected either a "response" column, or "Question" plus "LLM"/"Model".'
  );
}

// What the admin sees before committing, and what the CLI prints.
export function summarise(parsed) {
  const count = (key) => {
    const out = {};
    for (const r of parsed.records) {
      const k = r[key] ?? '(none)';
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  };
  return {
    format: parsed.format,
    sourceFile: parsed.sourceFile,
    sheetName: parsed.sheetName || null,
    sheetNames: parsed.sheetNames,
    totalRows: parsed.records.length,
    hiddenRows: parsed.records.filter((r) => !r.isComplete).length,
    flaggedRows: parsed.records.filter((r) => r.parseError).length,
    byModel: count('model'),
    byLanguage: count('language'),
    byLoLanguage: parsed.learningObjectives.length ? count('loLanguage') : {},
    learningObjectives: parsed.learningObjectives.map((lo) => ({
      code: lo.code,
      grade: lo.grade,
      languages: lo.texts.map((t) => t.language),
      preview: lo.texts[0] ? lo.texts[0].text.slice(0, 120) : '',
    })),
    repairedCells: parsed.repairedCells.length,
    warnings: parsed.warnings,
    sample: parsed.records.slice(0, 5).map((r) => ({
      model: r.model,
      language: r.language,
      rowIndex: r.rowIndex,
      grade: r.grade,
      loCode: r.loCode,
      loLanguage: r.loLanguage,
      question: (r.question || '').slice(0, 140),
      answer: (r.answer || '').slice(0, 60),
    })),
  };
}

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
