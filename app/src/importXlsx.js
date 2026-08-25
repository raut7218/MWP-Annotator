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
      try {
        const parsed = JSON.parse(raw);
        question = parsed.question != null ? String(parsed.question) : '';
        answer = parsed.answer != null ? String(parsed.answer) : '';
      } catch {
        parseError = 1;
        question = raw;
      }
    }

    // Skip rows where the LLM produced no real question/answer (blank cells,
    // {} placeholders, or a response that failed to parse) — these are not
    // shown to annotators at all, per project guidance.
    const isComplete =
      !parseError && grade.trim() && topic.trim() && question.trim() && answer.trim() ? 1 : 0;

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
