# MWP Annotator

A web app for reviewing and annotating machine-generated math word problems
(MWPs), one problem at a time, with per-model and per-language logins so each
annotator only sees the model/language combination they're assigned to.

Two source datasets are supported side by side without mixing:

- **`combined_qwen.xlsx`** — one sheet per language (Sinhala, Tamil, Punjabi,
  Odia, Marathi, Hindi), each row a JSON `response` from one model.
- **`MWPs/evaluation.xlsx`** — te reo Māori problems generated from six
  learning objectives (two per grade, grades 3–5) by five LLMs. Each learning
  objective was given to the models twice, once worded in English and once in
  Māori, so both wordings are loaded and every problem records which one
  produced it.

## Repository layout

- **`app/`** — the Node.js/Express + Postgres web application. This is
  where all the code lives. See [app/README.md](app/README.md) for setup,
  usage, and deployment instructions.
- **`Annotation_Guidlines/`** — source guideline documents used to define
  the annotation task and error categories: the annotation guidelines, the
  error category definitions/examples, and NCERT reference example
  questions. These are imported into the app (`app/reference/`) and shown
  to annotators via the in-app "📚 Reference" button.
- **`MWPs/`, `combined_qwen.xlsx`** — the source workbooks of generated math
  word problems that get imported into the app's Postgres database. These are
  gitignored: keep them alongside the checkout, don't commit them.

## Getting started

The app requires a Postgres database. See [app/README.md](app/README.md)
for full setup instructions, including importing a source workbook,
seeding annotator accounts, running the server, and exporting annotated
results.

Quick start:

```bash
cd app
npm install
export DATABASE_URL="postgres://user:pass@host:5432/dbname"
npm run seed
npm start
```

Starting the server creates the tables but loads no problems. To load them,
generate a `.sql` file from the workbook and run it in your database console
(Neon's SQL editor, psql, pgAdmin) — no connection string has to be shared:

```bash
npm run seed-sql -- --out=evaluation_seed.sql
```

Until a workbook is loaded the admin panel lists no languages or models. See
[app/README.md](app/README.md) for the CLI importers, if you have shell access
to the database instead.
