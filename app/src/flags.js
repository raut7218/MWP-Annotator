// Single source of truth for the annotation flag columns.
// `key` matches the sqlite column name; `excelKey` matches the original workbook header.
export const FLAGS = [
  { key: 'co_reference_issues', excelKey: 'co_reference_issues', label: 'Co-reference issues', hint: 'Pronouns / references are unclear or mismatched (e.g. "it", "he" unclear).' },
  { key: 'trivial_problem', excelKey: 'trivial_problem', label: 'Trivial problem', hint: 'Too easy / requires no real reasoning for the stated grade.' },
  { key: 'grammatical_errors', excelKey: 'grammatical_errors', label: 'Grammatical errors', hint: 'Grammar mistakes in the question text.' },
  { key: 'misspellings', excelKey: 'misspellings', label: 'Misspellings', hint: 'Spelling mistakes in the question text.' },
  { key: 'incomplete_or_poorly_phrased', excelKey: 'incomplete_or_poorly_phrased', label: 'Incomplete / poorly phrased', hint: 'Sentence is cut off, awkward, or hard to parse.' },
  { key: 'unsolvable_problem', excelKey: 'unsolvable_problem', label: 'Unsolvable problem', hint: 'Cannot be solved from the info given (e.g. mismatched entities).' },
  { key: 'unrealistic_scenario', excelKey: 'unrealistic_scenario', label: 'Unrealistic scenario', hint: 'Scenario or numbers are implausible in real life.' },
  { key: 'unit_issues', excelKey: 'unit_issues', label: 'Unit issues', hint: 'Missing, wrong, or inconsistent units.' },
  { key: 'topic_unsuitability', excelKey: 'topic_unsuitability', label: 'Topic unsuitability', hint: 'Problem does not match the stated topic.' },
  { key: 'not_satisfying_learning_objective', excelKey: 'not_satisfying_learning_objective', label: 'Not satisfying learning objective', hint: 'Does not actually test the grade-level objective.' },
  { key: 'not_a_word_problem', excelKey: 'not_a_word_problem', label: 'Not a word problem', hint: 'Not phrased as a word/story problem at all.' },
  { key: 'ambiguity', excelKey: 'ambiguity', label: 'Ambiguity', hint: 'Question could reasonably be interpreted more than one way.' },
  { key: 'not_in_country_context', excelKey: 'not_in_country_context', label: 'Not in country context', hint: 'Names, currency, or setting do not fit the target country/culture.' },
  { key: 'wrong_or_missing_answer', excelKey: 'wrong_or_missing_answer', label: 'Wrong or missing answer', hint: 'The provided answer is incorrect or absent.' },
  { key: 'irrelevant_or_additional_info', excelKey: 'irrelevant_or_additional_info', label: 'Irrelevant / additional info', hint: 'Extra info in the question that is not needed to solve it.' },
  { key: 'too_difficult', excelKey: 'too_difficult', label: 'Too difficult', hint: 'Too hard for the stated grade level.' },
  { key: 'code_mixed', excelKey: 'code-mixed', label: 'Code-mixed', hint: 'Mixes languages/scripts (e.g. English words dropped into the sentence).' },
];

export const FLAG_KEYS = FLAGS.map((f) => f.key);
