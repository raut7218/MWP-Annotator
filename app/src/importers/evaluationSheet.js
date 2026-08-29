// Parser for the "evaluation" workbook shape: a single sheet whose rows are
// (Grade, LLM, LO, Question, Answer), grouped into blocks — one block per
// (learning objective × the language that LO was written in), each block
// holding one generated problem per model.
//
// The same learning objective appears twice, once in English and once in
// Māori, because both wordings were used as prompts; both are kept and linked
// to one learning objective. The problems themselves are in te reo Māori,
// which is the `language` the app gates access on.
//
// Pure: takes a buffer, returns a parsed result. Nothing here touches the
// database, so the CLI and the admin upload share it.
import XLSX from 'xlsx';
import { readCell, normalise, tidyGrade, isNonAnswer, detectLanguage } from './cells.js';

// Tolerate the columns being renamed or reordered.
const COLUMN_ALIASES = {
  grade: ['grade', 'year', 'level'],
  model: ['llm', 'model', 'system', 'generator'],
  lo: ['lo', 'learning objective', 'learning_objective', 'objective'],
  question: ['question', 'mwp', 'problem', 'word problem'],
  answer: ['answer', 'solution', 'response'],
};

export function mapHeaders(ws, range) {
  const found = {};
  const seen = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const raw = normalise(readCell(ws, range.s.r, c));
    if (!raw) continue;
    seen.push(raw);
    const header = raw.toLowerCase();
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (found[key] === undefined && aliases.includes(header)) found[key] = c;
    }
  }
  return { found, seen };
}

// Blocks arrive as e.g. [LO1 Māori, LO1 English, LO2 Māori, LO2 English]. A
// wording we have already seen resolves to its own LO; a new wording joins the
// most recent LO of that grade if that LO has nothing in this language yet,
// otherwise it starts a new one. That works whichever language comes first.
function buildLearningObjectives(records) {
  const perGrade = new Map();
  const assignment = new Map();

  for (const rec of records) {
    if (!rec.loText) continue;
    const key = `${rec.grade}::${rec.loText}`;
    if (assignment.has(key)) continue;
    if (!perGrade.has(rec.grade)) perGrade.set(rec.grade, []);
    const los = perGrade.get(rec.grade);
    const latest = los[los.length - 1];
    let lo;
    if (latest && !latest.texts.has(rec.loLanguage)) {
      lo = latest;
    } else {
      lo = {
        code: `G${rec.grade || '?'}-LO${los.length + 1}`,
        grade: rec.grade,
        ordinal: los.length + 1,
        texts: new Map(),
      };
      los.push(lo);
    }
    lo.texts.set(rec.loLanguage, rec.loText);
    assignment.set(key, lo);
  }
  return { assignment, all: [...perGrade.values()].flat() };
}

export function parseEvaluationWorkbook(buffer, { language = 'Māori', sheet = null, sourceFile = '' } = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellNF: true, cellDates: false });
  const sheetName = sheet || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
  const range = XLSX.utils.decode_range(ws['!ref']);

  const { found: cols, seen } = mapHeaders(ws, range);
  const missing = ['model', 'lo', 'question'].filter((k) => cols[k] === undefined);
  if (missing.length) {
    throw new Error(
      `Could not find column(s) ${missing.join(', ')} in the header row. Saw: ${seen.join(' | ') || '(no headers)'}`
    );
  }

  const warnings = [];
  const repaired = [];

  // Read the rows, filling Grade down through its merged block.
  let grade = '';
  const rows = [];
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const rawGrade = readCell(ws, r, cols.grade);
    if (rawGrade) grade = tidyGrade(rawGrade);
    const model = normalise(readCell(ws, r, cols.model));
    const loText = normalise(readCell(ws, r, cols.lo));
    const question = readCell(ws, r, cols.question, repaired).trim();
    const answer = readCell(ws, r, cols.answer, repaired).trim();
    if (!model && !loText && !question) continue; // blank separator row
    rows.push({ grade, model, loText, loLanguage: detectLanguage(loText), question, answer });
  }
  if (!rows.length) throw new Error('No data rows found in the sheet.');

  const { assignment, all: learningObjectives } = buildLearningObjectives(rows);

  const rowIndexByModel = new Map();
  const records = [];
  let noModel = 0;
  for (const rec of rows) {
    if (!rec.model) {
      noModel += 1;
      continue;
    }
    const rowIndex = (rowIndexByModel.get(rec.model) || 0) + 1;
    rowIndexByModel.set(rec.model, rowIndex);
    const lo = assignment.get(`${rec.grade}::${rec.loText}`);
    // A model that produced nothing usable is still loaded so the annotator
    // can flag it (per the guidelines) rather than have it vanish.
    const generationFailed = isNonAnswer(rec.question) || isNonAnswer(rec.answer);
    records.push({
      model: rec.model,
      language,
      rowIndex,
      grade: rec.grade,
      topic: '',
      question: rec.question,
      answer: rec.answer,
      rawResponse: null,
      parseError: generationFailed ? 1 : 0,
      isComplete: rec.question ? 1 : 0,
      loCode: lo ? lo.code : null,
      loLanguage: rec.loLanguage,
      loText: rec.loText,
    });
  }
  if (noModel) warnings.push(`${noModel} row(s) had no model and were ignored.`);

  const incomplete = records.filter((r) => !r.isComplete).length;
  if (incomplete) warnings.push(`${incomplete} row(s) had no question and will be hidden from annotators.`);
  const failed = records.filter((r) => r.parseError).length;
  if (failed) warnings.push(`${failed} row(s) look like a failed generation and will show the warning banner.`);
  if (repaired.length) {
    warnings.push(
      `${repaired.length} answer cell(s) were stored by Excel as dates and have been recovered as fractions ` +
        `(e.g. ${repaired[0].from} -> "${repaired[0].to}").`
    );
  }
  for (const lo of learningObjectives) {
    if (lo.texts.size < 2) {
      warnings.push(`${lo.code} has wording in only one language (${[...lo.texts.keys()].join(', ') || 'none'}).`);
    }
  }

  return {
    format: 'evaluation',
    sourceFile,
    sheetName,
    sheetNames: wb.SheetNames,
    learningObjectives: learningObjectives.map((lo) => ({
      code: lo.code,
      grade: lo.grade,
      ordinal: lo.ordinal,
      texts: [...lo.texts].map(([lang, text]) => ({ language: lang, text })),
    })),
    records,
    warnings,
    repairedCells: repaired,
  };
}
