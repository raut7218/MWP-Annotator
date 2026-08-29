import XLSX from 'xlsx';
import { all } from './db.js';
import { FLAGS, FLAG_KEYS } from './flags.js';

// One output row per (problem × annotator), so a sheet that two people
// annotated exports both takes side by side, each labelled with who made it.
// Problems nobody has picked up yet still appear once, with a blank annotator.
const exportSql = `
  SELECT
    r.model, r.language, r.row_index, r.grade, r.topic,
    r.question, r.answer, r.raw_response,
    r.parse_error, r.is_complete, r.lo_language, r.learning_objective,
    lo.code AS lo_code,
    u.username AS annotator_username,
    u.display_name AS annotator_name,
    a.status AS annotation_status,
    a.comments AS annotation_comments,
    a.updated_at AS annotation_updated_at,
    ${FLAG_KEYS.map((k) => `a.${k} AS flag_${k}`).join(',\n    ')}
  FROM rows_data r
  LEFT JOIN learning_objectives lo ON lo.id = r.lo_id
  LEFT JOIN annotations a ON a.row_id = r.id
  LEFT JOIN users u ON u.id = a.user_id
  WHERE r.model = $1 AND r.language = $2
  ORDER BY r.row_index ASC, u.username ASC NULLS FIRST
`;

export async function buildWorkbookForModelLanguages(pairs) {
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const { model, language } of pairs) {
    const rows = await all(exportSql, [model, language]);
    const sheetRows = rows.map((r) => {
      const out = {
        // The model is a hidden field in the UI (annotators may be blinded to
        // it) but it is always exported — that is the whole point of recording
        // it: per-model analysis downstream.
        model: r.model,
        language: r.language,
        row_index: r.row_index,
        grade: numericOrRaw(r.grade),
        lo_code: r.lo_code || '',
        lo_language: r.lo_language || '',
        learning_objective: r.learning_objective || '',
        topic: r.topic || '',
        question: r.question || '',
        answer: r.answer || '',
        annotator: r.annotator_name || r.annotator_username || '',
        annotator_username: r.annotator_username || '',
      };
      for (const f of FLAGS) {
        out[f.excelKey] = !!r[`flag_${f.key}`];
      }
      out.Comments = r.annotation_comments || '';
      out.status = r.annotation_status || 'pending';
      out.annotated_at = r.annotation_updated_at ? new Date(r.annotation_updated_at).toISOString() : '';
      // Keep the untouched source cell for the workbooks that had one (the
      // JSON `response` column); blank for sources with plain question/answer
      // columns.
      out.response = r.raw_response || '';
      return out;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), uniqueSheetName(`${model}_${language}`, used));
  }
  return wb;
}

// Excel sheet names are capped at 31 chars and must be unique within a
// workbook; long model/language pairs can otherwise collide once truncated.
function uniqueSheetName(base, used) {
  const clean = base.replace(/[\\/?*[\]:]/g, '-');
  let name = clean.slice(0, 31);
  let n = 2;
  while (used.has(name)) {
    const suffix = `~${n++}`;
    name = clean.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

function numericOrRaw(v) {
  if (v === null || v === undefined || v === '') return v;
  const n = Number(v);
  return Number.isFinite(n) && String(n) === String(v).trim() ? n : v;
}

export function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
