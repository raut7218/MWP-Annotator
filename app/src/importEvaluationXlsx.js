// Importer for the "evaluation" workbook shape: a single sheet whose rows are
// (Grade, LLM, LO, Question, Answer), grouped into blocks — one block per
// (learning objective × the language that LO was written in), each block
// holding one generated problem per model.
//
// The same learning objective appears twice, once in English and once in
// Māori, because both wordings were used as prompts; both are loaded, linked
// to one learning_objectives row so they can be compared later. The problems
// themselves are in te reo Māori, which is the `language` the app gates
// access on (override with --language=...).
//
// Usage:
//   node src/importEvaluationXlsx.js [path/to/evaluation.xlsx] [--language=Māori] [--sheet=NAME]
//
// Safe to re-run: rows are matched on (model, language, row_index) and only
// the source fields are refreshed — annotations are never touched.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { get, run, invalidateModelsCache } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const xlsxPath = positional[0]
  ? path.resolve(positional[0])
  : path.join(__dirname, '..', '..', 'MWPs', 'evaluation.xlsx');
const language = flag('language', 'Māori');
const sheetArg = flag('sheet', null);

// ---------------------------------------------------------------------------
// Cell reading
// ---------------------------------------------------------------------------

// Several answers in the source are fractions ("5/8", "3/4") that Excel
// silently reinterpreted as dates on entry, so the cell holds a serial number
// under a `d/m` number format. Re-applying that format gives the original text
// back exactly; without this the answers export as "46239".
function readCell(ws, r, c) {
  if (c === undefined || c === null || c < 0) return '';
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n') {
    if (cell.z && isDateFormat(cell.z)) {
      try {
        return String(XLSX.SSF.format(cell.z, cell.v)).trim();
      } catch {
        /* fall through to the plain number */
      }
    }
    return Number.isInteger(cell.v) ? String(cell.v) : String(cell.v);
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.w ?? cell.v).trim();
}

function isDateFormat(fmt) {
  if (typeof fmt !== 'string') return false;
  try {
    if (XLSX.SSF.is_date(fmt)) return true;
  } catch {
    /* older builds may not expose is_date */
  }
  // Strip quoted literals, then look for date/time tokens.
  const bare = fmt.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && !/^(general|@)$/i.test(bare.trim());
}

// ---------------------------------------------------------------------------
// Which language is this learning objective written in?
// ---------------------------------------------------------------------------
const MAORI_MARKERS = /\b(ki te|i te|o te|ngā|tētahi|tētahi|hei|mā te|whakamahi|rānei|me te|te)\b/gi;
const ENGLISH_MARKERS = /\b(the|and|of|a|to|with|use|find|by|as|in|for|is|that|from|their|when)\b/gi;

export function detectLanguage(text) {
  const t = String(text || '');
  if (!t.trim()) return '';
  const macrons = (t.match(/[āēīōūĀĒĪŌŪ]/g) || []).length;
  const mi = (t.match(MAORI_MARKERS) || []).length + macrons * 2;
  const en = (t.match(ENGLISH_MARKERS) || []).length;
  return mi > en ? 'Māori' : 'English';
}

const normalise = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Header mapping — tolerate the columns being renamed or reordered.
// ---------------------------------------------------------------------------
const COLUMN_ALIASES = {
  grade: ['grade', 'year', 'level'],
  model: ['llm', 'model', 'system', 'generator'],
  lo: ['lo', 'learning objective', 'learning_objective', 'objective'],
  question: ['question', 'mwp', 'problem', 'word problem'],
  answer: ['answer', 'solution', 'response'],
};

function mapHeaders(ws, range) {
  const found = {};
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const header = normalise(readCell(ws, range.s.r, c)).toLowerCase();
    if (!header) continue;
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (found[key] === undefined && aliases.includes(header)) found[key] = c;
    }
  }
  const missing = ['model', 'lo', 'question'].filter((k) => found[k] === undefined);
  if (missing.length) {
    throw new Error(
      `Could not find column(s) ${missing.join(', ')} in the header row. Saw: ` +
        Array.from({ length: range.e.c - range.s.c + 1 }, (_, i) => readCell(ws, range.s.r, range.s.c + i))
          .filter(Boolean)
          .join(' | ')
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Learning objectives: pair up the English and Māori wording of the same LO.
//
// Blocks arrive as e.g. [LO1 Māori, LO1 English, LO2 Māori, LO2 English]. A
// wording we have already seen resolves to its own LO; a new wording joins the
// most recent LO of that grade if that LO has nothing in this language yet,
// otherwise it starts a new one. That works whichever language comes first.
// ---------------------------------------------------------------------------
function buildLearningObjectives(blocks) {
  const perGrade = new Map(); // grade -> [{ code, grade, ordinal, texts: Map(lang -> text) }]
  const assignment = new Map(); // `${grade}::${loText}` -> lo

  for (const b of blocks) {
    const key = `${b.grade}::${b.loText}`;
    if (assignment.has(key)) continue;
    if (!perGrade.has(b.grade)) perGrade.set(b.grade, []);
    const los = perGrade.get(b.grade);
    const latest = los[los.length - 1];
    let lo;
    if (latest && !latest.texts.has(b.loLanguage)) {
      lo = latest;
    } else {
      lo = { code: `G${b.grade || '?'}-LO${los.length + 1}`, grade: b.grade, ordinal: los.length + 1, texts: new Map() };
      los.push(lo);
    }
    lo.texts.set(b.loLanguage, b.loText);
    assignment.set(key, lo);
  }
  return { assignment, all: [...perGrade.values()].flat() };
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('Reading workbook:', xlsxPath);
  const buf = fs.readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { type: 'buffer', cellNF: true, cellDates: false });
  const sheetName = sheetArg || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cols = mapHeaders(ws, range);
  console.log(`Sheet: ${sheetName} · language: ${language}`);

  // Pass 1 — read the rows, forward-filling Grade down its merged block.
  let grade = '';
  const records = [];
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const rawGrade = readCell(ws, r, cols.grade);
    if (rawGrade) grade = tidyGrade(rawGrade);
    const model = normalise(readCell(ws, r, cols.model));
    const loText = normalise(readCell(ws, r, cols.lo));
    const question = readCell(ws, r, cols.question).trim();
    const answer = readCell(ws, r, cols.answer).trim();
    if (!model && !loText && !question) continue; // blank separator row
    records.push({ grade, model, loText, loLanguage: detectLanguage(loText), question, answer });
  }
  if (!records.length) throw new Error('No data rows found in the sheet.');

  // Pass 2 — learning objectives, then persist them.
  const { assignment, all: los } = buildLearningObjectives(records);
  const loIdByCode = new Map();
  for (const lo of los) {
    let existing = await get('SELECT id FROM learning_objectives WHERE code = ?', [lo.code]);
    if (!existing) {
      existing = await get(
        'INSERT INTO learning_objectives (code, grade, ordinal) VALUES (?, ?, ?) RETURNING id',
        [lo.code, lo.grade, lo.ordinal]
      );
    } else {
      await run('UPDATE learning_objectives SET grade = ?, ordinal = ? WHERE id = ?', [lo.grade, lo.ordinal, existing.id]);
    }
    loIdByCode.set(lo.code, existing.id);
    for (const [lang, text] of lo.texts) {
      await run(
        `INSERT INTO learning_objective_texts (lo_id, language, text) VALUES (?, ?, ?)
         ON CONFLICT (lo_id, language) DO UPDATE SET text = EXCLUDED.text`,
        [existing.id, lang, text]
      );
    }
  }
  console.log(
    `Learning objectives: ${los.length} (${los.map((l) => `${l.code}[${[...l.texts.keys()].join('+')}]`).join(', ')})`
  );

  // Pass 3 — the problems themselves, numbered per model.
  const sourceFile = path.basename(xlsxPath);
  const rowIndexByModel = new Map();
  let inserted = 0;
  let updated = 0;
  let noModel = 0;
  let noQuestion = 0;
  const perModel = new Map();

  for (const rec of records) {
    if (!rec.model) {
      noModel += 1;
      continue;
    }
    const rowIndex = (rowIndexByModel.get(rec.model) || 0) + 1;
    rowIndexByModel.set(rec.model, rowIndex);

    const lo = assignment.get(`${rec.grade}::${rec.loText}`);
    const loId = lo ? loIdByCode.get(lo.code) : null;
    // A model that produced nothing usable still gets loaded so the annotator
    // can flag it (per the guidelines) rather than have it vanish.
    const generationFailed = isNonAnswer(rec.question) || isNonAnswer(rec.answer);
    const isComplete = rec.question ? 1 : 0;
    if (!isComplete) noQuestion += 1;

    const existing = await get('SELECT id FROM rows_data WHERE model = ? AND language = ? AND row_index = ?', [
      rec.model,
      language,
      rowIndex,
    ]);
    const values = [
      rec.grade,
      '',
      rec.question,
      rec.answer,
      null,
      generationFailed ? 1 : 0,
      isComplete,
      loId,
      rec.loLanguage,
      rec.loText,
      sourceFile,
    ];
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
        [rec.model, language, rowIndex, ...values]
      );
      inserted += 1;
    }
    perModel.set(rec.model, (perModel.get(rec.model) || 0) + 1);
  }

  invalidateModelsCache();
  for (const [model, n] of [...perModel].sort()) console.log(`  ${model}: ${n} problems`);
  console.log(
    `Done. Inserted ${inserted} new rows, refreshed ${updated} existing rows` +
      (noQuestion ? `, ${noQuestion} row(s) had no question and are hidden from annotators` : '') +
      (noModel ? `, ${noModel} row(s) had no model and were ignored` : '') +
      '.'
  );
}

function tidyGrade(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(v).trim();
}

function isNonAnswer(v) {
  // Tolerates the typos that show up in these cells, e.g. "no putput".
  return /^\s*(no\s*\w*put\w*|n\/a|none|error)\s*$/i.test(String(v || ''));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message || err);
    process.exit(1);
  }
);
