// Turns a workbook into a plain .sql file you can paste into any Postgres
// console (Neon's SQL editor, psql, pgAdmin).
//
// This is the no-credentials route for loading data into a hosted database:
// the parsing happens here, the writing happens in your own SQL session, so
// no connection string has to be shared with anything.
//
// Usage:
//   node src/exportSeedSql.js [path/to/workbook.xlsx] [--out=seed.sql]
//        [--format=evaluation|combined] [--language=Māori] [--sheet=NAME] [--model=NAME]
//
// The generated file is idempotent — every statement upserts, so running it
// twice refreshes the problems rather than duplicating them, and it never
// touches annotations. It assumes the app has already created the schema
// (i.e. the server has been started against this database at least once).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWorkbook, summarise } from './importers/index.js';

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
const outPath = path.resolve(flag('out', path.join(process.cwd(), 'seed.sql')));

// Postgres string literal. Doubling single quotes is the whole of it; the
// values here are workbook text, never identifiers.
function q(v) {
  if (v === null || v === undefined || v === '') return v === '' ? "''" : 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function main() {
  const parsed = parseWorkbook(fs.readFileSync(xlsxPath), {
    format: flag('format', null),
    language: flag('language', 'Māori'),
    sheet: flag('sheet', null),
    model: flag('model', null) || path.basename(xlsxPath, path.extname(xlsxPath)).replace(/^combined[_-]?/i, ''),
    sourceFile: path.basename(xlsxPath),
  });
  const s = summarise(parsed);

  const out = [];
  out.push(`-- Generated from ${s.sourceFile}${s.sheetName ? ` (sheet "${s.sheetName}")` : ''}`);
  out.push(`-- ${s.totalRows} problems · models: ${Object.keys(s.byModel).join(', ')} · languages: ${Object.keys(s.byLanguage).join(', ')}`);
  if (s.learningObjectives.length) {
    out.push(`-- ${s.learningObjectives.length} learning objectives: ${s.learningObjectives.map((l) => `${l.code}[${l.languages.join('+')}]`).join(', ')}`);
  }
  if (s.repairedCells) out.push(`-- ${s.repairedCells} date-mangled answer cell(s) recovered as fractions`);
  for (const w of s.warnings) out.push(`-- note: ${w}`);
  out.push('--');
  out.push('-- Safe to run more than once: every statement upserts, and nothing here');
  out.push('-- touches the annotations table.');
  out.push('');
  out.push('BEGIN;');
  out.push('');

  if (parsed.learningObjectives.length) {
    out.push('-- Learning objectives, and their wording in each language.');
    for (const lo of parsed.learningObjectives) {
      out.push(
        `INSERT INTO learning_objectives (code, grade, ordinal) VALUES (${q(lo.code)}, ${q(lo.grade)}, ${lo.ordinal})\n` +
          `  ON CONFLICT (code) DO UPDATE SET grade = EXCLUDED.grade, ordinal = EXCLUDED.ordinal;`
      );
      for (const t of lo.texts) {
        out.push(
          `INSERT INTO learning_objective_texts (lo_id, language, text)\n` +
            `  SELECT id, ${q(t.language)}, ${q(t.text)} FROM learning_objectives WHERE code = ${q(lo.code)}\n` +
            `  ON CONFLICT (lo_id, language) DO UPDATE SET text = EXCLUDED.text;`
        );
      }
    }
    out.push('');
  }

  out.push('-- Problems. Matched on (model, language, row_index); re-running refreshes');
  out.push('-- the text and leaves any annotations on these rows alone.');
  for (const r of parsed.records) {
    const lo = r.loCode
      ? `(SELECT id FROM learning_objectives WHERE code = ${q(r.loCode)})`
      : 'NULL';
    out.push(
      `INSERT INTO rows_data (model, language, row_index, grade, topic, question, answer, raw_response,\n` +
        `                       parse_error, is_complete, lo_id, lo_language, learning_objective, source_file)\n` +
        `VALUES (${q(r.model)}, ${q(r.language)}, ${r.rowIndex}, ${q(r.grade)}, ${q(r.topic)}, ${q(r.question)},\n` +
        `        ${q(r.answer)}, ${q(r.rawResponse)}, ${r.parseError}, ${r.isComplete}, ${lo},\n` +
        `        ${q(r.loLanguage)}, ${q(r.loText)}, ${q(parsed.sourceFile)})\n` +
        `ON CONFLICT (model, language, row_index) DO UPDATE SET\n` +
        `  grade = EXCLUDED.grade, topic = EXCLUDED.topic, question = EXCLUDED.question,\n` +
        `  answer = EXCLUDED.answer, raw_response = EXCLUDED.raw_response,\n` +
        `  parse_error = EXCLUDED.parse_error, is_complete = EXCLUDED.is_complete,\n` +
        `  lo_id = EXCLUDED.lo_id, lo_language = EXCLUDED.lo_language,\n` +
        `  learning_objective = EXCLUDED.learning_objective, source_file = EXCLUDED.source_file;`
    );
  }

  out.push('');
  out.push('COMMIT;');
  out.push('');
  out.push('-- Check what landed:');
  out.push("-- SELECT model, language, count(*) FROM rows_data GROUP BY 1,2 ORDER BY 1,2;");
  out.push('');

  fs.writeFileSync(outPath, out.join('\n'), 'utf-8');
  console.log(`Wrote ${outPath}`);
  console.log(`  ${s.totalRows} problems, ${s.learningObjectives.length} learning objectives`);
  for (const w of s.warnings) console.log(`  ! ${w}`);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
