// CLI wrapper around the combined-workbook parser (one sheet per language,
// each row a JSON `response`). The same code backs the admin panel's
// "Import workbook" upload.
//
// Usage: node src/importXlsx.js [path/to/workbook.xlsx] [modelName]
// If modelName is omitted it's inferred from the filename (e.g.
// "combined_qwen.xlsx" -> "qwen").
//
// Safe to re-run: rows are matched on (model, language, row_index) and only
// the source fields are refreshed — annotations are never touched.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCombinedWorkbook, persistParsed, summarise } from './importers/index.js';
import { FLAG_KEYS } from './flags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const xlsxPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '..', 'combined_qwen.xlsx');

function inferModelFromFilename(p) {
  const base = path.basename(p, path.extname(p));
  return base.replace(/^combined[_-]?/i, '') || base;
}

const model = (process.argv[3] ? String(process.argv[3]).trim() : '') || inferModelFromFilename(xlsxPath);

async function main() {
  console.log('Reading workbook:', xlsxPath);
  console.log('Model:', model);
  const parsed = parseCombinedWorkbook(fs.readFileSync(xlsxPath), {
    model,
    sourceFile: path.basename(xlsxPath),
  });
  const s = summarise(parsed);
  for (const [language, n] of Object.entries(s.byLanguage)) {
    const usable = parsed.records.filter((r) => r.language === language && r.isComplete).length;
    console.log(`  ${language}: ${n} rows with content, ${usable} usable (complete) for annotation`);
  }
  for (const w of s.warnings) console.log(`  ! ${w}`);

  const { inserted, updated } = await persistParsed(parsed);
  console.log(`Done. Inserted ${inserted} new rows, refreshed ${updated} existing rows.`);
  console.log('Flag columns tracked:', FLAG_KEYS.join(', '));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message || err);
    process.exit(1);
  }
);
