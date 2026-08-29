// Parser for the original `combined_*.xlsx` shape: one sheet per language,
// each row carrying a JSON `response` produced by one model.
//
// Pure: takes a buffer, returns a parsed result.
import XLSX from 'xlsx';

// A meaningful chunk of these workbooks has `response` cells that are cut off
// mid-string (verified against the raw cell bytes — truncation in the source
// data, not a JSON-escaping bug). JSON.parse can't read those, but the partial
// text is still real annotator-relevant content per guideline #6 ("answer not
// generated, or only part of the answer reasoning is there -> mark as
// wrong/missing answer"), so salvage what is there rather than drop the row.
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

export function parseCombinedWorkbook(buffer, { model, sourceFile = '' } = {}) {
  if (!model) throw new Error('A model name is required for this workbook format.');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const records = [];
  const warnings = [];
  let truncated = 0;

  for (const sheetName of wb.SheetNames) {
    const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
    let rowIndex = 0;
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
        if (parseError) truncated += 1;
      }
      records.push({
        model,
        language: sheetName,
        rowIndex,
        grade,
        topic,
        question,
        answer,
        rawResponse: raw,
        parseError,
        // Rows with nothing generated at all are hidden from annotators;
        // truncated ones are shown with a warning banner.
        isComplete: grade.trim() && topic.trim() && question.trim() ? 1 : 0,
        loCode: null,
        loLanguage: null,
        loText: null,
      });
    }
  }
  if (!records.length) throw new Error('No data rows found in the workbook.');

  const hidden = records.filter((r) => !r.isComplete).length;
  if (hidden) warnings.push(`${hidden} row(s) had nothing generated and will be hidden from annotators.`);
  if (truncated) warnings.push(`${truncated} row(s) have a truncated response and will show the warning banner.`);

  return {
    format: 'combined',
    sourceFile,
    sheetNames: wb.SheetNames,
    learningObjectives: [],
    records,
    warnings,
    repairedCells: [],
  };
}
