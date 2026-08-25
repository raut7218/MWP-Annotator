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
  Hindi). Each sheet is imported into a local SQLite database
  (`app/data/app.db`) — one row per problem.
- Annotators log in and only see the language(s) their account is assigned.
- Every save is written straight to the database, so nothing is lost between
  sessions and multiple annotators can work at the same time.
- Admins can create/manage user accounts (and which languages they can see),
  watch progress per language, and export the annotated data back to `.xlsx`
  at any time (same columns as the original, plus a `status` column).
- Rows with no real question/answer content (blank cells, `{}` placeholders,
  or a response that failed to parse) are automatically skipped — they're
  never shown to annotators and don't count toward progress totals. They're
  still included as-is in admin exports so no source data is lost.
- A "📚 Reference" button is embedded on every page (annotate + admin). It
  opens the Annotation Guidelines, the Error Category definitions/examples
  (also reachable per-flag via the ⓘ next to each checkbox), and a searchable
  table of NCERT example questions (filter by grade/topic, e.g. "what does a
  correct grade 3 division problem look like") — all without leaving the
  current row. Source content lives in `app/reference/` (`guidelines.json`,
  `error_categories.json`, `ncert_examples.csv`) if you need to edit it.

## First-time setup

```bash
cd app
npm install
npm run import   # loads combined_qwen.xlsx into app/data/app.db
```

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

- Sessions are cookie-based and reset if the server restarts (set the
  `SESSION_SECRET` env var to a fixed value to keep sessions alive across
  restarts). Annotators just log in again — no data is lost either way since
  every save is persisted immediately.
- The database lives at `app/data/app.db`; back it up periodically if this is
  more than a throwaway pilot.
