// Picks a parser for a workbook and runs it.
//
// Adding support for a new sheet layout means adding a parser that returns the
// shared record shape and teaching `detectFormat` to recognise it — no schema
// change, and every caller (the CLI importers, the .sql generator) gets it.
import XLSX from 'xlsx';
import { normalise } from './cells.js';
import { parseEvaluationWorkbook } from './evaluationSheet.js';
import { parseCombinedWorkbook } from './combinedWorkbook.js';

export { parseEvaluationWorkbook, parseCombinedWorkbook };

// Parsing is deliberately free of any database import, so tools that only
// need to read a workbook (e.g. src/exportSeedSql.js) work without a
// DATABASE_URL. Writing lives in ./persist.js.

// Sniff the first sheet's header row, so a caller that does not name a format
// still gets the right parser. `--format=` overrides it.
function detectFormat(buffer) {
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
