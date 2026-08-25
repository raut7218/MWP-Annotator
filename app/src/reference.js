import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const refDir = path.join(__dirname, '..', 'reference');

export const guidelines = JSON.parse(fs.readFileSync(path.join(refDir, 'guidelines.json'), 'utf-8'));
export const errorCategories = JSON.parse(fs.readFileSync(path.join(refDir, 'error_categories.json'), 'utf-8'));

const csvText = fs.readFileSync(path.join(refDir, 'ncert_examples.csv'), 'utf-8');
const wb = XLSX.read(csvText, { type: 'string' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rawExamples = XLSX.utils.sheet_to_json(sheet, { defval: '' });

export const ncertExamples = rawExamples
  .map((r, i) => ({
    id: i + 1,
    grade: String(r.Grade ?? '').trim(),
    topic: String(r.Topic ?? '').trim(),
    learningObjective: String(r['Learning Objective'] ?? '').trim(),
    question: String(r['English question'] ?? '').trim(),
    answer: String(r['Answer_english'] ?? '').trim(),
  }))
  .filter((r) => r.question);

export const ncertGrades = [...new Set(ncertExamples.map((r) => r.grade))].sort();
export const ncertTopics = [...new Set(ncertExamples.map((r) => r.topic))].sort();
