import XLSX from 'xlsx';
import { db } from './db.js';
import { FLAGS } from './flags.js';

const listStmt = db.prepare(
  'SELECT * FROM rows_data WHERE language = ? ORDER BY row_index ASC'
);

export function buildWorkbookForLanguages(languages) {
  const wb = XLSX.utils.book_new();
  for (const language of languages) {
    const rows = listStmt.all(language);
    const sheetRows = rows.map((r) => {
      const out = {
        grade: numericOrRaw(r.grade),
        topic: r.topic,
        response: r.raw_response,
      };
      for (const f of FLAGS) {
        out[f.excelKey] = !!r[f.key];
      }
      out.Comments = r.comments || '';
      out.status = r.status;
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, language.slice(0, 31));
  }
  return wb;
}

function numericOrRaw(v) {
  if (v === null || v === undefined || v === '') return v;
  const n = Number(v);
  return Number.isFinite(n) && String(n) === String(v).trim() ? n : v;
}

export function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
