// Shared cell reading for the workbook parsers.
import XLSX from 'xlsx';

// Several answers in the source workbooks are fractions ("5/8", "3/4") that
// Excel silently reinterpreted as dates on entry, so the cell holds a serial
// number under a `d/m` number format. Re-applying that format gives the
// original text back exactly; without this they load as "46239".
export function readCell(ws, r, c, repaired) {
  if (c === undefined || c === null || c < 0) return '';
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n') {
    if (cell.z && isDateFormat(cell.z)) {
      try {
        const text = String(XLSX.SSF.format(cell.z, cell.v)).trim();
        if (repaired) repaired.push({ cell: XLSX.utils.encode_cell({ r, c }), from: cell.v, to: text });
        return text;
      } catch {
        /* fall through to the plain number */
      }
    }
    return Number.isInteger(cell.v) ? String(cell.v) : String(cell.v);
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.w ?? cell.v).trim();
}

export function isDateFormat(fmt) {
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

export const normalise = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function tidyGrade(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(v).trim();
}

// A generation that failed outright. Tolerates the typos that show up in
// these cells, e.g. "no putput".
export function isNonAnswer(v) {
  return /^\s*(no\s*\w*put\w*|n\/a|none|error)\s*$/i.test(String(v || ''));
}

// Which language is this text written in? Used for the learning-objective
// wording, which arrives in English and Māori with no column saying which.
const MAORI_MARKERS = /\b(ki te|i te|o te|ngā|tētahi|hei|mā te|whakamahi|rānei|me te|te)\b/gi;
const ENGLISH_MARKERS = /\b(the|and|of|a|to|with|use|find|by|as|in|for|is|that|from|their|when)\b/gi;

export function detectLanguage(text) {
  const t = String(text || '');
  if (!t.trim()) return '';
  const macrons = (t.match(/[āēīōūĀĒĪŌŪ]/g) || []).length;
  const mi = (t.match(MAORI_MARKERS) || []).length + macrons * 2;
  const en = (t.match(ENGLISH_MARKERS) || []).length;
  return mi > en ? 'Māori' : 'English';
}
