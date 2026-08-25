// One-time (or re-runnable) import: reads combined_qwen.xlsx and loads every
// sheet (= language) into the rows_data table. Safe to re-run: existing rows
// are matched by (language, row_index) and only the source fields are
// refreshed — annotator-entered flags/comments/status are left untouched.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { db } from './db.js';
import { FLAG_KEYS } from './flags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const xlsxPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '..', 'combined_qwen.xlsx');

console.log('Reading workbook:', xlsxPath);
const buf = fs.readFileSync(xlsxPath);
const wb = XLSX.read(buf, { type: 'buffer' });

// A meaningful chunk of the source workbook has `response` cells that are
// cut off mid-string (verified against the raw cell bytes — this is
// truncation in the source data, not a JSON-escaping bug). JSON.parse can't
// read those, but the partial text is still real annotator-relevant content
// per guideline #6 ("answer not generated, or only part of the answer
// reasoning is there -> mark as wrong/missing answer"), so we salvage
// whatever question/answer text is present via regex instead of discarding
// the row.
function unescapeJsonish(s) {
  return s.replace(/\\(.)/g, (_, c) => ({ '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r' }[c] ?? c));
}

function extractQA(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      question: parsed.question != null ? String(parsed.question) : '',
      answer: parsed.answer != null ? String(parsed.answer) : '',
      ok: true,
    };
  } catch {
    const qMatch = raw.match(/"question"\s*:\s*"((?:\\.|[^"\\])*)"?/s);
    const aMatch = raw.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)"?/s);
    return {
      question: qMatch ? unescapeJsonish(qMatch[1]) : '',
      answer: aMatch ? unescapeJsonish(aMatch[1]) : '',
      ok: false,
    };
  }
}

const selectExisting = db.prepare(
  'SELECT id FROM rows_data WHERE language = ? AND row_index = ?'
);
const insertStmt = db.prepare(`
  INSERT INTO rows_data (language, row_index, grade, topic, question, answer, raw_response, parse_error, is_complete)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateSourceStmt = db.prepare(`
  UPDATE rows_data SET grade = ?, topic = ?, question = ?, answer = ?, raw_response = ?, parse_error = ?, is_complete = ?
  WHERE language = ? AND row_index = ?
`);

let totalInserted = 0;
let totalUpdated = 0;

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(ws, { defval: null });
  let rowIndex = 0;
  let completeCount = 0;
  for (const row of json) {
    rowIndex += 1;
    const grade = row.grade != null ? String(row.grade) : '';
    const topic = row.topic != null ? String(row.topic) : '';
    const raw = row.response != null ? String(row.response) : '';
    let question = '';
    let answer = '';
    let parseError = 0;
    if (raw) {
      const result = extractQA(raw);
      question = result.question;
      answer = result.answer;
      parseError = result.ok ? 0 : 1;
    }

    // Skip rows where nothing was generated at all (blank cells, or a fully
    // empty {} response) — there is genuinely nothing to annotate. Rows with
    // a truncated/malformed response ARE still shown (with a warning banner)
    // as long as some question text could be salvaged, since annotators are
    // expected to flag those (wrong/missing answer, incomplete/poorly
    // phrased) rather than have them silently disappear.
    const isComplete = grade.trim() && topic.trim() && question.trim() ? 1 : 0;

    const existing = selectExisting.get(sheetName, rowIndex);
    if (existing) {
      updateSourceStmt.run(grade, topic, question, answer, raw, parseError, isComplete, sheetName, rowIndex);
      totalUpdated += 1;
    } else {
      insertStmt.run(sheetName, rowIndex, grade, topic, question, answer, raw, parseError, isComplete);
      totalInserted += 1;
    }
    if (isComplete) completeCount += 1;
  }
  console.log(`  ${sheetName}: ${json.length} rows with content, ${completeCount} usable (complete) for annotation`);
}

console.log(`Done. Inserted ${totalInserted} new rows, refreshed ${totalUpdated} existing rows.`);
console.log('Flag columns tracked:', FLAG_KEYS.join(', '));
