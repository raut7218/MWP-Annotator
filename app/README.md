# MWP Annotator

A small web app for annotating AI-generated math word problems, one problem
at a time, with per-model and per-language login so each annotator only sees
the model/language combination they're assigned to.

Instead of scrolling a giant spreadsheet, annotators get one problem per
screen (question, answer, and all 17 issue checkboxes visible at once, no
scrolling), a progress bar, a colored row-navigator to jump around, filters
(All / Pending / Reviewed / Flagged), and keyboard shortcuts for fast review.

## How it works

- Every problem is stored with the model that generated it, the language it
  is written in, its grade, and the learning objective it was generated from.
  Problems are keyed by (model, language, row number).
- **Annotations are per annotator.** Two (or five) people can be assigned the
  same model/language sheet and each keeps their own flags, comments and
  review status — nobody overwrites anybody. Each annotator sees their own
  progress bar, and a row someone else has already reviewed shows a quiet
  note saying so (never *what* they said).
- Annotators log in and only see the model(s)/language(s) their account is
  assigned to. If they have more than one of either, they pick a model first,
  then a language, from a picker screen.
- Every save is written straight to the database, so nothing is lost between
  sessions and multiple annotators can work at the same time.
- Admins can create/manage user accounts (which models/languages they can
  see, and whether they can see model names), watch progress per annotator
  per model/language, and export the annotated data to `.xlsx` at any time.
- Rows where nothing was generated at all (blank cells, or an empty `{}`
  response) are automatically skipped — they're never shown to annotators and
  don't count toward progress totals. Rows whose content is present but
  truncated or a failed generation ARE shown, with whatever text could be
  salvaged plus a warning banner asking the annotator to flag it (wrong/
  missing answer, incomplete/poorly phrased) rather than skip it, per the
  annotation guidelines. Every row is still included as-is in admin exports
  either way, so no source data is ever lost.
- The sidebar has a "Reference" section (Guidelines / Error categories /
  Example questions (NCERT)) that opens the full reference material in a new
  tab. Clicking the ⓘ next to a specific issue checkbox instead shows just
  that one error category's definition and example inline in the sidebar,
  without leaving the row you're annotating. Source content lives in
  `app/reference/` (`guidelines.json`, `error_categories.json`,
  `ncert_examples.csv`) if you need to edit it.

## The model is a hidden field

Which LLM generated a problem is recorded on every row — that's what makes
per-model analysis possible, and it is always present in exports. Whether an
*annotator* is shown it is a per-account switch (Admin panel → Users → "Sees
model"; or `"canSeeModel": false` in `users.seed.json`).

When it is off, the blinding is real rather than cosmetic: the browser never
receives the model name at all. Models are addressed over the API by an
opaque ref (an HMAC of the name, keyed by `MODEL_REF_SECRET`, falling back to
`SESSION_SECRET`), so the name is not in any URL, response body, or
localStorage key. The annotator sees neutral positional labels instead —
"Set 1", "Set 2", … — which are stable across sessions and give nothing away.
Admins always see real names.

## First-time setup

Requires a Postgres database. Set `DATABASE_URL` to its connection string
(e.g. `postgres://user:pass@host:5432/dbname`) before running any command
below. TLS is enabled automatically for hosted databases and off for
localhost/`127.0.0.1`; override with `?sslmode=disable` or `PGSSLMODE`.

```bash
cd app
npm install
export DATABASE_URL="postgres://user:pass@host:5432/dbname"
```

### Loading data: generate a .sql file (no credentials needed)

The workbooks are gitignored, and a hosted database (Neon, Render) has no
shell to run an importer in — so the usual route is to parse the workbook
locally and run the resulting SQL in Neon's SQL editor (or psql, or pgAdmin).
Nothing has to be given a connection string.

```bash
npm run seed-sql -- --out=evaluation_seed.sql
node src/exportSeedSql.js path/to/file.xlsx --out=seed.sql --language=Māori
```

This needs no `DATABASE_URL` — the parsers carry no database dependency, which
is why `src/importers/persist.js` is separate from the rest of
`src/importers/`. The generated file upserts every row, so it is safe to run
twice, and it never touches the `annotations` table. It assumes the schema
already exists, i.e. the app has been started against that database once.

### Importing the te reo Māori evaluation workbook (CLI)

`MWPs/evaluation.xlsx` has a single sheet of `Grade | LLM | LO | Question |
Answer` rows, blocked by learning objective. Each learning objective appears
twice — once worded in English, once in Māori — because both wordings were
used as prompts; both are loaded and linked to one learning objective, and
each problem records which wording produced it.

```bash
npm run import-evaluation                                     # defaults to ../MWPs/evaluation.xlsx
node src/importEvaluationXlsx.js path/to/file.xlsx --language=Māori --sheet=initial
```

`--language` is the language the *problems* are written in (default `Māori`);
it is the dimension access is gated on. The LO wording language is detected
per row and stored separately, and annotators can filter by it in the
sidebar.

Two quirks of the source workbook are handled on import: `Grade` and `LLM`
are filled down through their blocks, and answers that are fractions
("5/8", "3/4") which Excel silently stored as dates are converted back to
the original text rather than exported as "46239".

### Importing a `combined_*.xlsx` workbook (CLI)

One sheet per language, each row a JSON `response`:

```bash
npm run import                                    # ../combined_qwen.xlsx, model "qwen"
node src/importXlsx.js path/to/combined_llama.xlsx llama
```

If you omit the model name it's inferred from the filename (stripping a
leading `combined_`).

Both importers are safe to re-run at any time to pick up new rows: they match
on (model, language, row number), refresh only the source columns, and never
touch annotations already saved. The CLI importers and the `.sql` generator
share the same parsers (`src/importers/`), so they behave identically.

**A restart does not load data.** Booting the app creates and migrates the
tables but imports nothing, so until a workbook has been imported the admin
panel shows no languages or models — `SELECT DISTINCT language FROM rows_data`
on an empty table is empty. If the language you expect is missing, that is
almost always what happened.

### Accounts

Edit `app/users.seed.json` (see `users.seed.example.json`), then:

```bash
npm run seed      # creates/updates accounts from users.seed.json
npm start         # starts the server on http://localhost:3000
```

Share `http://<your-machine-ip>:3000` with your annotators (or deploy it to
any small server/VM — it's a plain Node process, no build step needed).

If you previously ran this app against the old local SQLite file
(`app/data/app.db`) and want to carry over existing annotator progress,
run `npm run migrate-to-pg` once (with `DATABASE_URL` set).

### Clearing a sheet

Admin panel → **Delete imported data** removes one model/language when a sheet
was loaded wrongly. It deletes the problems *and every annotation on them*, so
it asks for the current row count back as confirmation.

## Managing access per model and language

Each user has a `languages` list (e.g. `["Māori"]`), a `models` list (e.g.
`["LLM1","LLM2"]`), or `["*"]` in either for admins/reviewers who should see
everything on that dimension. Access is the intersection of the two — a user
only sees a model/language combination if both lists allow it. Set this in
`users.seed.json` + `npm run seed`, or from the Admin panel in the browser
(Users section → Edit models / Edit languages / Sees model / Create user).

To double-annotate a sheet, give two accounts the same model and language.
They will not see each other's answers.

## Exporting results

Log in as an admin → Admin panel → "Export annotated data". You can export
one model/language combination at a time or everything as a single workbook.

Each sheet has **one row per (problem × annotator)**, so a double-annotated
sheet exports both takes side by side:

| column | meaning |
| --- | --- |
| `model`, `language`, `row_index` | which problem, and which model made it (always exported, even for blinded annotators) |
| `grade`, `lo_code`, `lo_language`, `learning_objective` | the objective it was generated from, and the wording used |
| `topic`, `question`, `answer` | the problem itself |
| `annotator`, `annotator_username` | who made this annotation (blank if nobody has yet) |
| 17 flag columns, `Comments` | what they flagged |
| `status`, `annotated_at` | pending/reviewed, and when |
| `response` | the untouched source cell, for workbooks that had one |

## Database schema

Four tables, deliberately kept apart so adding models, languages, learning
objectives or annotators never requires reshaping the others:

- **`learning_objectives`** (`code`, `grade`, `ordinal`) and
  **`learning_objective_texts`** (`lo_id`, `language`, `text`) — one objective,
  its wording stored once per language. A third language is one extra row, not
  a schema change.
- **`rows_data`** — the generated problem: model, language, row number, grade,
  topic, question, answer, raw response, and a link to the learning objective
  plus the language its wording was in.
- **`annotations`** — one row per (problem, annotator), unique on
  `(row_id, user_id)`, holding the 17 flags, comments and status. Flag columns
  are generated from `src/flags.js`, so adding an error category there adds the
  column on next boot.
- **`users`** — accounts, their model/language access, admin bit, and
  `can_see_model`.

Everything an annotator sees is served from these tables — questions, answers,
grades, learning objectives and their per-language wording, model and language
lists. Nothing is embedded in the HTML or JS. The only content still read from
disk is the static reference material in `app/reference/` (guidelines, error
category definitions, NCERT examples), which is identical across deployments
and versioned in git.

Schema changes are applied on boot by `src/db.js` and are idempotent, so
deploying is just restarting the process. Databases from before this change
kept annotations as columns on `rows_data` with the annotator as a free-text
name; those are migrated into `annotations` automatically on first boot
(matched to the account whose username or display name they name — an
unrecognised name is preserved on an inactive `legacy:<name>` placeholder
account rather than dropped), after which the old columns are removed.

## Notes

- Sessions are stored in Postgres (via `connect-pg-simple`), so logins
  survive server restarts as long as `SESSION_SECRET` is set to a fixed
  value. Set `MODEL_REF_SECRET` too if you rely on model blinding and want
  refs stable across restarts. Every save is persisted immediately to
  Postgres either way, so no annotation data is ever lost even if a session
  drops.
- Set `DATABASE_URL` (and `SESSION_SECRET`) in your hosting platform's
  environment variables. On Render's free plan, remember the web service
  itself has no persistent disk and spins down after 15 minutes idle — that's
  fine here since all state lives in Postgres, not on local disk.
