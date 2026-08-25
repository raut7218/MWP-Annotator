# MWP Annotator

A small web app for annotating the math word problems in `combined_qwen.xlsx`,
one problem at a time, with per-language login so each annotator only sees
the language they're assigned to.

Instead of scrolling a giant spreadsheet, annotators get one problem per
screen (question, answer, and all 17 issue checkboxes visible at once, no
scrolling), a progress bar, a colored row-navigator to jump around, filters
(All / Pending / Reviewed / Flagged), and keyboard shortcuts for fast review.

## How it works

- The source workbook has 6 sheets (Sinhala, Tamil, Punjabi, Odia, Marathi,
  Hindi). Each sheet is imported into a Postgres database (connect via the
  `DATABASE_URL` env var) — one row per problem.
- Annotators log in and only see the language(s) their account is assigned.
- Every save is written straight to the database, so nothing is lost between
  sessions and multiple annotators can work at the same time.
- Admins can create/manage user accounts (and which languages they can see),
  watch progress per language, and export the annotated data back to `.xlsx`
  at any time (same columns as the original, plus a `status` column).
- Rows where nothing was generated at all (blank cells, or an empty `{}`
  response) are automatically skipped — they're never shown to annotators and
  don't count toward progress totals. A separate, larger group of rows have a
  `response` cell that's genuinely cut off in the source workbook (verified
  against the raw cell bytes — e.g. Odia had 31 of its 53 rows truncated
  mid-sentence). Those ARE shown to annotators, with whatever partial
  question/answer text could be salvaged plus a warning banner asking them to
  flag it (wrong/missing answer, incomplete/poorly phrased) rather than skip
  it, per the annotation guidelines. Every row is still included as-is in
  admin exports either way, so no source data is ever lost.
- A "📚 Reference" button is embedded on every page (annotate + admin). It
  opens the Annotation Guidelines, the Error Category definitions/examples
  (also reachable per-flag via the ⓘ next to each checkbox), and a searchable
  table of NCERT example questions (filter by grade/topic, e.g. "what does a
  correct grade 3 division problem look like") — all without leaving the
  current row. Source content lives in `app/reference/` (`guidelines.json`,
  `error_categories.json`, `ncert_examples.csv`) if you need to edit it.

## First-time setup

Requires a Postgres database. Set `DATABASE_URL` to its connection string
(e.g. `postgres://user:pass@host:5432/dbname`) before running any command
below.

```bash
cd app
npm install
export DATABASE_URL="postgres://user:pass@host:5432/dbname"
npm run import   # loads combined_qwen.xlsx into Postgres
```

If you previously ran this app against the old local SQLite file
(`app/data/app.db`) and want to carry over existing annotator progress,
run `npm run migrate-to-pg` once (with `DATABASE_URL` set) before or after
`npm run import` — it's an upsert, safe either order.

Edit `app/users.seed.json` to set real usernames/passwords per language (an
`admin` account plus one account per language are pre-filled with placeholder
passwords — change them before sharing the app). Then:

```bash
npm run seed      # creates/updates accounts from users.seed.json
npm start         # starts the server on http://localhost:3000
```

Share `http://<your-machine-ip>:3000` with your annotators (or deploy it to
any small server/VM — it's a plain Node process, no build step needed).

Re-run `npm run import` any time to pick up new rows added to the workbook —
it's safe to re-run: it only refreshes the question/answer/topic/grade
columns and never touches annotations already saved. Re-run `npm run seed`
any time you edit `users.seed.json` to add/update accounts (you can also
manage users from the in-app Admin panel once logged in as an admin).

## Managing access per language

Each user has a `languages` list (e.g. `["Hindi"]`), or `["*"]` for
admins/reviewers who should see everything. This can be set either in
`users.seed.json` + `npm run seed`, or from the Admin panel in the browser
(Users section → Edit languages / Create user).

## Exporting results

Log in as an admin → Admin panel → "Export annotated data". You can export
one language at a time or all languages as a single workbook (same shape as
`combined_qwen.xlsx`, with the flags/Comments filled in from what annotators
entered, plus a `status` column showing pending/reviewed).

## Notes

- Sessions are stored in Postgres (via `connect-pg-simple`), so logins
  survive server restarts as long as `SESSION_SECRET` is set to a fixed
  value. Every save is persisted immediately to Postgres either way, so no
  annotation data is ever lost even if a session drops.
- Set `DATABASE_URL` (and `SESSION_SECRET`) in your hosting platform's
  environment variables. On Render's free plan, remember the web service
  itself has no persistent disk and spins down after 15 minutes idle — that's
  fine here since all state now lives in Postgres, not on local disk.
