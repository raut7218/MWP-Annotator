# MWP Annotator

A web app for reviewing and annotating machine-generated math word problems
(MWPs) across six languages — Sinhala, Tamil, Punjabi, Odia, Marathi, and
Hindi — one problem at a time, with per-language logins so each annotator
only sees the language they're assigned to.

## Repository layout

- **`app/`** — the Node.js/Express + Postgres web application. This is
  where all the code lives. See [app/README.md](app/README.md) for setup,
  usage, and deployment instructions.
- **`Annotation_Guidlines/`** — source guideline documents used to define
  the annotation task and error categories: the annotation guidelines, the
  error category definitions/examples, and NCERT reference example
  questions. These are imported into the app (`app/reference/`) and shown
  to annotators via the in-app "📚 Reference" button.
- **`combined_qwen.xlsx`** — the source workbook of generated math word
  problems (one sheet per language) that gets imported into the app's
  Postgres database for annotation.

## Getting started

The app requires a Postgres database. See [app/README.md](app/README.md)
for full setup instructions, including importing the source workbook,
seeding annotator accounts, running the server, and exporting annotated
results.

Quick start:

```bash
cd app
npm install
export DATABASE_URL="postgres://user:pass@host:5432/dbname"
npm run import
npm run seed
npm start
```
