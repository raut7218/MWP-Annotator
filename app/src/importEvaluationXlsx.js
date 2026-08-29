// CLI wrapper around the evaluation-sheet parser. The same code backs the
// admin panel's "Import workbook" upload, so both stay in step.
//
// Usage:
//   node src/importEvaluationXlsx.js [path/to/evaluation.xlsx] [--language=Māori] [--sheet=NAME]
//
// Safe to re-run: rows are matched on (model, language, row_index) and only
// the source fields are refreshed — annotations are never touched.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEvaluationWorkbook, persistParsed, summarise } from './importers/index.js';

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

async function main() {
  console.log('Reading workbook:', xlsxPath);
  const parsed = parseEvaluationWorkbook(fs.readFileSync(xlsxPath), {
    language: flag('language', 'Māori'),
    sheet: flag('sheet', null),
    sourceFile: path.basename(xlsxPath),
  });
  const s = summarise(parsed);
  console.log(`Sheet: ${s.sheetName} · ${s.totalRows} problems`);
  console.log(
    `Learning objectives: ${s.learningObjectives.length} ` +
      `(${s.learningObjectives.map((l) => `${l.code}[${l.languages.join('+')}]`).join(', ')})`
  );
  for (const [model, n] of Object.entries(s.byModel)) console.log(`  ${model}: ${n} problems`);
  for (const w of s.warnings) console.log(`  ! ${w}`);

  const { inserted, updated } = await persistParsed(parsed);
  console.log(`Done. Inserted ${inserted} new rows, refreshed ${updated} existing rows.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message || err);
    process.exit(1);
  }
);
