# 11 — Testing Plan

**Status:** Phase 4 · written 2026-08-12
**Trigger:** long-term maintenance expected — the brief calls this a permanent system of record
intended to grow over years.

**The governing principle: test what fails *silently*.** A misaligned button is visible the moment
you look at it. A leaked private fact, a fabricated number, a 履歴書 missing a conventional field,
and one user's record shown to another all look completely normal. Those are what a machine has to
check, because a human cannot.

**All fixtures are invented.** Nothing is sampled from `local/` — `AGENTS.md` requires this, and a
test fixture containing a real client name would be committed to a public repo forever.

---

## 1. Tooling

| Layer | Tool |
|---|---|
| Unit and integration | **Vitest** |
| API integration | Vitest against the Hono app, with a real Postgres |
| Server-side tests | **`@cloudflare/vitest-pool-workers`** — runs tests *inside* the Workers runtime via Miniflare, with bindings and isolated per-test-file storage |
| Test database | **`track_record_test`, the suite's own** — Docker Postgres + a Neon HTTP proxy, see below |
| Client screens | **A second Vitest project, `client`**: jsdom, React Testing Library and user-event. The real router mounts over a memory history and `fetch` is stubbed and recorded (`tests/client/harness.tsx`). No database. Fact Review, Diff Review, Version History, Version Edit, Documents, Your record, Overview and Skills, so far |
| Model calls | **Always stubbed.** No test ever calls Anthropic |
| Sign-in | **A local OIDC issuer run as a fixture** (`tests/helpers/oidc-issuer.ts`, wired to the suite by `tests/helpers/oidc.ts`). Better Auth's own path runs end to end; there is no authentication bypass in `src/server` |
| Coverage target | **None.** A percentage would be gamed; the must-have list below is the target |

**Why a real Postgres and not an in-memory fake:** the isolation guarantee this project depends on
is enforced by SQL. A fake that does not run the query proves nothing about the query.

**Why Docker Postgres alone is not enough.** The application speaks to Postgres over **Neon's HTTP
protocol**, which plain Postgres does not implement. Local and CI runs therefore need **Neon Local**
(the official Docker image) or the community `local-neon-http-proxy` Compose file in front of
Postgres. Without it, every database test fails at connection time — this was found during
verification, not during the build.

**Every run starts from nothing.** `tests/global-setup.ts` drops `public`, recreates it, and applies
the committed migrations in order — so a migration that does not apply cleanly fails the suite there
rather than in an unrelated assertion later.

**Why the suite has a database of its own.** That drop is total, and for a while it landed on the
database the dev worker was using: three times during the 2026-09-01 walk, running the suite
destroyed the signed-in session, the profile, the imported documents and the accepted render
versions (issue #4). The docker-compose Postgres now holds three databases: `track_record_dev`, which
`.dev.vars` points at, `track_record_test`, which is the suite's alone, and `track_record_e2e`, the
browser smoke test's (§2.9). `npm run db:up` creates whichever is missing. One proxy serves all three: its `PG_CONNECTION_STRING` is an *auth* backend, and
the database each query runs against comes from the connection string the client sends.

**Two guards make that real rather than assumed** (`tests/database-guard.ts`). Before the suite
connects, it refuses to run if `TEST_DATABASE_URL` names `track_record_dev`, or names the same
database on the same server as a dev `DATABASE_URL` — read from `.dev.vars` and from the
environment, since a shell can export one in front of `wrangler dev`. After it connects, it asks
`current_database()` and refuses if the answer is not the database it aimed at: the URL says where a
query was sent, the proxy decides where it lands. Both failures are silent and total without a
guard, which is what makes a cheap check worth having. The browser smoke test's setup (§2.9) runs
both guards on `E2E_DATABASE_URL`, aimed at `track_record_e2e`.

**The guards fail closed.** A `TEST_DATABASE_URL` that cannot be parsed, or a `DATABASE_URL` that is
set but unreadable, is a refusal rather than a shrug — a drop cannot be undone, and the run nobody
could explain is the one to stop. The single silence is a dev URL that is genuinely absent, which is
CI, where there is nothing to lose.

---

## 2. Must have automated tests

These block the build. Each one guards a failure that is invisible.

### 2.1 Isolation — every query filters by `user_id`

**The single most important test in the project**, and the only one whose absence would be a
security defect rather than a bug.

```
Given two users, each with employers, projects, facts, renders and imports
When user A calls every read endpoint the API exposes
Then no response contains any record belonging to user B
And requesting user B's record by its ID returns 404 — never 403, never 200
```

Plus a **route-enumeration test**: read the project's own route registry (a module-level array
populated by the registration wrapper — *not* Hono's undocumented `app.routes`, see
`08-auth-and-permissions.md` §4), call each route without a session, and fail if any returns anything
other than `401`. **A newly added unprotected endpoint breaks the build rather than shipping.** This
is what makes deny-by-default real rather than aspirational.

### 2.2 Quote verification — a fact's evidence must exist

This is the mechanism that makes invented facts impossible. If it silently stops working, the facts
still *look* right.

```
Given a source document whose text is known
When the stubbed extractor returns a candidate whose quote is NOT a verbatim substring
Then the candidate is discarded before it reaches the database
And the discard is counted, and the count is reported, and the content is not

When the extractor returns a candidate whose quote IS verbatim
Then quoteStart/quoteEnd are derived, and text.substring(start, end) === quote exactly
And the derived line number matches the line the quote appears on
```

Cases: quote absent entirely · quote present but with altered whitespace · quote appearing **twice**
in the document (first occurrence wins, deterministically) · quote spanning a line break ·
full-width vs half-width digit variation in Japanese text.

### 2.3 Render gating — Generated and Private never reach output

The leak the entire confidentiality model exists to prevent.

```
Given a record containing:
  - a Measured/Public fact
  - an Attested/Restricted fact
  - a Generated/Public fact   (accepted into the record, deliberately)
  - a Measured/Private fact
When any render is generated
Then the Generated fact does not appear in the output
And the Private fact does not appear in the output
And the Private fact was never included in the request sent to the model
And the Restricted fact appears in generalised form, with the client not named
```

The third assertion matters as much as the first two: Private facts are filtered **before the
request is built**, so they never leave the database — not filtered out of the response afterwards.

Plus: **the author's PII appears in 履歴書 and in no other render.** Address, phone and date of birth
are asserted absent from the résumé, 職務経歴書 and both career stories.

### 2.4 履歴書 conventional correctness

Violations here are invisible to the author and obvious to a Japanese hiring manager.

```
Missing required field  → generation is BLOCKED with 428, and the missing fields are NAMED
Employment gap > 1 month between consecutive entries → a WARNING, not a block
学歴・職歴 ordering       → chronological ascending, 学歴 block before 職歴 block, terminated by 以上
Employer with ended_on   → produces BOTH an 入社 row and a 退社 row carrying the leaving reason
education outcome        → 'withdrawn' renders 中退, never 卒業
Age                      → 満N歳 computed against the SUBMISSION date, not today
連絡先                    → renders 同上 when contactSameAsAddress
Day precision            → the day never appears in any rendered date
```

The `withdrawn` case is a misrepresentation if it regresses, not a formatting slip.

### 2.5 Japanese diffing produces phrase-level marks

Most likely thing to regress silently when a dependency updates.

```
Given two Japanese paragraphs differing by one phrase
When the diff is computed
Then every mark spans a BudouX phrase boundary
And no mark covers a single character
And unchanged paragraphs produce zero changes

Given an inserted sentence in the middle of a document
Then paragraphs after it are still reported as UNCHANGED
   (this is the paragraph-alignment pass; without it the whole document reads as changed)
```

### 2.6 Re-import suppresses already-judged facts

```
Given a document imported once, with some facts accepted and some rejected
When an edited version of the same document is imported
Then only changed and added passages are sent to the model
And no accepted fact is re-offered
And no rejected fact is re-offered
And an unchanged re-import extracts zero candidates and is NOT reported as a failure
```

### 2.6b A restatement is flagged, and never across an employer or a user

`tests/overlap.test.ts` over HTTP, `tests/overlap-matcher.test.ts` on the matcher alone (#36).

```
Given an accepted fact at one employer, and a candidate from another document restating it
When the candidate is read
Then it carries the accepted fact as a likely match, with its claim and document and no quote
And a match whose number differs is marked as a conflict
And a fact at another employer, or another user's fact naming this employer, is never a match
And an exact repeat is still suppressed by dedupe before it becomes a candidate
And Accept and Reject behave as they do without a flag, and a rejected match drops off the card
```

**Since 2026-10-08 (#57)** the same holds for a fact accepted on arrival: one that likely restates
another is given a `repeat` flag, and carries the pair while that flag is open. Covered in the same
file: within a version it is not flagged against its own neighbours, a dismissed flag is not raised
again, the flag is settled when the other fact is rejected or the claim or employer changes, and it
is raised late when a document is refiled under the employer that makes the pair.

### 2.6c An accepted fact is re-graded, and only that is written

`tests/regrade.test.ts` over HTTP, `tests/client/fact-review.test.tsx` on the card (#37).

```
Given an import whose facts were accepted before grades were recorded, and another user's the same
When its listing is read with status=accepted and graded=false
Then it holds exactly that import's accepted facts with no grade, and none of the other user's
When one is re-graded, to its own provenance or another
Then its provenance and grade change, and no other column of any fact does
And it leaves the listing, as a rejected one does
And re-grading a candidate or a rejected fact is refused, Measured without evidence is refused,
  and another user's fact is not found
```

### 2.6d A document is filed under an employer, and its facts read it through

`tests/document-employer.test.ts` over HTTP, `tests/client/documents.test.tsx` and
`tests/client/overview.test.tsx` on the two rows (#35).

```
Given a document imported under an employer
Then every candidate resolves to that employer, and none carries a copy of it
And the document's employer wins over its project's
And a re-import keeps the document's employer, whatever the upload names
When the document's employer changes
Then every fact reading through it follows, and a hand-set one stays, No employer included
And the change is not refused while a version extracts, as a project change is
And another user's employer is a 404, at import and at refile alike
And the fact list, the render, Version Edit and the attribution check name the same employer
And a document with no employer behaves as it did before #35
```

### 2.6e Automation never drops a fact, and never loosens who may read one

`tests/flags.test.ts` over HTTP, `tests/flag-rules.test.ts` on the rules alone, and
`tests/client/fact-review.test.tsx` on the card (#57). **This is the test of point 7 of the issue**,
and the first place to look when an import seems to have lost something.

```
Given a document whose candidates the importer grades plainly, reads as confidential, is unsure of,
  gives no grade at all, and one whose quote is not in the document
When the import finishes
Then every candidate but the last is an accepted fact, with the importer's grade, and none is waiting
And none is Public, and the confidential ones are Private, by the importer's reading or by shape
And the ungraded one is kept as Generated and flagged, not dropped
And the one with no verbatim quote is discarded and counted, as before
And every flag has a reason, and a confidential reason names the kind of identifier, never the identifier
When the next résumé is generated without any fact having been opened
Then the model is given every usable fact, the number-flagged ones included,
  and no Private and no Generated fact
```

The sort of the facts that were waiting is held to the same: every fact in a batch is accepted
unless the author ruled on it or edited it during the call, twenty-five a call, a disclosure the author set is never loosened, an unavailable model changes
nothing, and only the reader's own facts are sorted.

### 2.6f A flag is advice, and `Explain this` is the only model call

`tests/flags.test.ts`, `tests/client/flagged.test.tsx` (#57).

```
Given a record with open flags
When the list is read, any number of times
Then no model call is made, and no item carries a passage from a source document
When a flag is marked checked
Then it leaves the list and nothing about its fact changes: a Private fact is still Private
When Explain this is pressed
Then exactly one model call is made, about that flag and its fact, and the answer is stored
And a second press reads the stored answer and makes no call
And a model failure answers 503, stores nothing, and the next press tries again
And another user's flag is a 404 on every route
```

### 2.6g The master document holds everything, and is stored nowhere

`tests/master-document.test.ts`, `tests/client/master-document.test.tsx` (#57).

```
Given accepted facts that are usable, Private and Generated, a rejected fact and a waiting one
When the master document is read
Then it holds every accepted fact with its labels, under the employer it resolves to and its project
And it leaves out the rejected and the waiting, and counts the waiting
And it carries no passage from any source document, and no model call was made
When it is downloaded
Then the file is Markdown, in full, Private facts included, and says so in its first lines
And another user's record is never in either
```

**One per language** (#59), in the same two files:

```
Given a record whose employer, role, project, school and certification each have two names
When the master document is read with language=ja
Then each is called by its Japanese name, and by its only name where the record holds one
And it holds the same facts, claims and counts as the English one, and no model call was made
When it is downloaded
Then the file is named for its language, headed and dated in Japanese, and says nothing is translated
And an unknown language is the English one
```

### 2.6g-2 Home separates the two languages

`tests/client/overview.test.tsx`, `tests/client/master-document.test.tsx` (#59).

```
Given the five documents
When Home is opened
Then the English tab is open, and lists the English master document, the résumé and the career story
When 日本語 is chosen, by a press or by the arrow keys
Then it lists the 日本語 master document, 履歴書, 職務経歴書 and 職務経歴ストーリー, and the choice is kept
And the line above the rows speaks for the rows of the tab that is open
When the master document is opened from a tab
Then it is the one of that language, and its download is that language's file
```

### 2.6h A tailored résumé is the main résumé's rules with a job description

`tests/tailored.test.ts` and the prompt in `tests/prompt.test.ts` (#57). The résumé under test is
seeded with its application, as migration 0017 leaves one: since #70 no route creates one.

```
Given a named job description
When a tailored résumé is created
Then nothing is generated, and the five main documents are as they were
When it is generated
Then the model is given the job description and exactly the facts the main résumé is given
And the result is a proposal, read as a diff and accepted, with versions apart from the main résumé's
And a version asked for under another document's ref is not found
And its file is withheld once a fact it cites is made Private, as the main résumé's is
And another user's tailored résumé is not listed, and is a 404 on every route addressed by its id
```

### 2.6i An application's dates are saved, corrected and counted from

`tests/applications.test.ts`, `tests/applications-migration.test.ts` and
`tests/client/applications.test.tsx` (#70). The clock is set, so every day count is exact.

```
Given a job added by hand
Then it is at Not applied, with today as the day it was added

When a step is set
Then today is saved under it, and a step passed over has no date until one is added
When a date is corrected
Then the figures that count from it follow, and the date it replaced is kept, superseded

When nothing has changed for 14 days and it is waiting to hear back
Then it has gone quiet, and at 13 days it has not
And a step entered late, or one not waiting to hear back, is not quiet
And correcting the company or the position does not count as a change

When a move is undone
Then the standing from before it is put back whole

Given a tailored résumé made before migration 0017
When the migration runs
Then it is an application at Not applied holding its job description, and the résumé row is unchanged
And running it again adds nothing, and the down script removes only what it added

And another user's application is not listed, and is a 404 on every route addressed by its id
```

### 2.6i-2 A posting is read into a proposal, and adding a job never depends on it

`tests/applications.test.ts`, `tests/client/applications.test.tsx` and the prompt in
`tests/prompt.test.ts` (#73). The model is stubbed; the postings and the readings it answers with
are invented, in English and in 日本語 (`tests/fixtures/postings.ts`).

```
Given a job description pasted into Add a job
When Read it is pressed
Then the model is given that text and nothing else, and its company, position and requirements fill the check step
And no application exists until Save application is pressed
And what is saved is the fields as the author left them, not what was read

When the reading fails, or the server cannot be reached
Then the check step opens with the fields empty and says so, and what is typed there is saved
When the text states no company and no position
Then both fields are empty and the screen says they were not found

When the text is missing, under 40 characters or over 20,000
Then nothing is read, on the screen or by the route, and the model is not called
And what was read is held to the limits a saved application has
And going back to the text and on again reads it again, and what is read replaces the fields
And a reading that fails after one that succeeded leaves the fields empty, not the earlier reading
```

### 2.6j An interview entry keeps its questions apart, and dates skipped earlier rounds

`tests/interviews.test.ts`, `tests/interview-rules.test.ts` and `tests/client/interviews.test.tsx`
(#72). The clock is set, so every day count is exact.

```
Given an application
When an interview entry is added
Then it holds the day, the round, who it was with and how it went
And each question is a row of its own, numbered in the order given, the blank ones dropped
And an entry with neither how it went nor a question is refused, and so is a future day

When the entry is for a round later than the status
Then the status moves to that round with the entry's day, and the first-interview figure follows
And the rounds passed over have no date
And undoing the move puts the standing back and keeps the entry

When the entry is for an earlier interview round whose date was skipped on an open application
Then that date is filled with the entry's day, the current status stays put, and the figure follows
And a second entry for that round does not replace the date; Undo removes the filled date, not the entry

When the round already has a date, is not a round, or the application is closed
Then the status and its dates are left alone, and the entry still counts as a change

When the application was changed after a save read it, by a move or by a date alone
Then the save is refused as changed somewhere else, and nothing of it is written

On the screen
Then several pasted lines become several questions; a leading number, `-` or `*` is dropped only with following whitespace, while `•` and `・` are dropped with or without it
And a draft typed before the paste is saved before the pasted questions
And the question still in the field is saved with the rest, in one write
And clearing the date prevents the save and shows a message
And a move is said where a status change is said, with its Undo

And another user cannot add an entry to an application, and reads none of its entries
```

### 2.6k A recording is a link, only an http or https one, and can be removed for good

`tests/recordings.test.ts` and `tests/client/recordings.test.tsx` (#74).

```
Given an application with an interview entry
When a link is attached to the entry
Then the entry reads back the link and what it is, in the order attached, and no other entry does
And a link that is not http or https is refused and nothing is stored: no scheme, javascript:, data:, file:, ftp:, a bare https://, one with a space in it
And an entry of another application, or one that is not there, is a miss

When a recording is removed
Then its link and label are gone from the database, and the entry keeps a line with the day in Japan
And the line stays in its place among the entry's other recordings
And removing it a second time is a miss

Then attaching and removing each count as a change to the application, and neither moves the status
And no recording is in the exported record
And another user can neither attach, remove nor read one

On the screen
Then a link is drawn with its label or `Recording kept elsewhere`, its address, and Open in a new tab
And an address that is not http or https is never drawn as something to open
And a link that is not one is refused without a request, with what was typed kept
And Remove asks once in place of the row; Keep it writes nothing; Remove it makes one DELETE for that recording
### 2.6l A sent copy is the file of the day, and nothing later reaches it

`tests/application-documents.test.ts`, `tests/applications-migration.test.ts` (0020) and
`tests/client/application-resume.test.tsx` (#71). The clock is set.

```
Given an application at Not applied
Then the main résumé, 履歴書 and 職務経歴書 are offered, and one with no version cannot be ticked
And several can be on it at once, beside a tailored résumé made from its job description
And an application has one tailored résumé: asked again, it is the same one

When it moves out of Not applied, to Applied or straight to a later step
Then every document on it with a version is frozen as sent, with that day's date
And a document that cannot be frozen refuses the move, and nothing is saved

Given a sent copy
When the document gets a later version, the author's name and address change, or the record changes
Then the copy's file and its page are byte for byte what they were
And the company renamed later does not rename the copy
And no route changes a copy

When the Applied date is corrected
Then the copies that move froze follow it, and a copy from an earlier move does not
When the move is undone
Then the copies it froze are gone from every read, and a copy recorded by hand stays
When the status is moved back and forward again
Then the copies stay and the same document is not frozen twice
When a document is attached at Not applied and Undo puts back Applied or a later step
Then that document is frozen, the Undo says which, and the copies already there are left alone

When another sent copy is recorded, from Applied onward
Then each ticked document is frozen again, always, and the latest is the one most recently recorded
And it takes a document not on the application, and a tailored résumé made after Applied
And before Applied it is refused

Given tailored résumés linked by migration 0017
When migration 0020 runs
Then each is listed as a document of its application, and the down script removes only what it added

And another user's application, document or sent copy is a 404 on every route here
```

### 2.7 Failure never destroys a stored version

```
When the model is unavailable during generation
Then the current render version is byte-identical afterwards
And the error names a reason and is retryable

When the model fails on chunk 7 of 12 during import
Then chunks 1–6 keep their candidates
And retry resumes from chunk 7, not from chunk 1

When .docx assembly throws
Then the stored RenderContent is unchanged and the next download can succeed
```

### 2.8 Logs never contain record content

```
Given a run that imports a document, generates a render, and fails a model call
When the captured log output is searched
Then it contains no source text, no fact claim, no quote, and no render content
```

Otherwise the logs become a second, un-governed copy of NDA-bound material.

**Extended 2026-10-12 (#73)** to a posting read and a reading that fails: the log carries the
text's length and counts, never the company, the position or a requirement.

**Extended 2026-10-08 (#57)** to the four new sources of a log line: grading and flagging an import,
the sort, `Explain this`, and creating and generating a tailored résumé. The search also covers flag
reasons, explanations and the job description, which names a company.

### 2.9 One end-to-end smoke test — the critical path

**Playwright. One test, one happy path, in CI.** It exists to catch **wiring breakage**, which every
other test in this plan is blind to: auth middleware misconfigured, static assets not served, a route
not mounted, the download endpoint returning HTML instead of a file. All of those pass unit and API
tests and fail the instant the app is opened.

```
Sign in (stubbed OIDC)
  → import a fixture document
  → wait for extraction to finish (stubbed model)
  → accept one fact          (until 2026-10-08. Since #57 the fact arrives accepted with the
                              importer's grade: the walk reads its card and presses Done)
  → generate the English résumé
  → accept the proposal
  → download the .docx
Assert: the response is a valid zip with the .docx MIME type and a non-trivial byte length
```

**Deliberately not extended beyond this.** A broad E2E suite at three screens and one developer rots
faster than it catches anything. If a second smoke path is ever justified it will be 履歴書
generation, because that render can fail in ways the résumé cannot.

> **Status, 2026-09-02: sign-in is real; the Playwright half was not built then. It is now — see the 2026-09-30 note below.**
> `tests/smoke.test.ts` walks the whole path above through the real Hono application. **The session
> resolver is no longer stubbed** — the walk signs in through `POST /api/auth/sign-in/social`, a
> local OIDC issuer run as a fixture (`tests/helpers/oidc-issuer.ts`), Better Auth's own callback, and the
> session cookie that callback sets. Only the model seam is stubbed, as §1 requires. So *a route not
> mounted*, *auth middleware misconfigured*, *the download endpoint returning HTML instead of a
> file*, *the path breaking between stages* and now *the sign-in path itself* all fail it today.
> **Not covered: static assets not served, and the SPA failing to mount.** Both are single-request,
> browser-only failures and both stay on §3. The fixture, and what it does and does not close, are
> in the decision log — 2026-08-30 for the shape, 2026-09-02 for the build.

> **Decided 2026-09-28: how the browser half signs in** (decision log, 2026-09-28; issue #33). The
> browser clicks the sign-in button and the test asserts that the redirect goes to Google with
> exactly `openid email profile`. It then loads a Playwright storage state made by the code behind
> `npm run dev:session` and walks the rest of the path signed in. The model is stubbed through a
> test-only worker entry under `tests/`, with no Workflows binding so imports run inline, and
> nothing is added to `src/server` (§1). The test runs against the built SPA served by the Worker's
> `ASSETS` binding. Once it passes, §3 item 8 is covered by it.

> **Built 2026-09-30** (issue #33; decision log, 2026-09-30). `tests/e2e/smoke.spec.ts` under
> `playwright.config.ts`; `npm run test:e2e` locally, and a step after the build in CI. It has its own
> database, `track_record_e2e`, which `npm run db:up` creates. §3 item 8 is now covered by it.

---

## 3. Tested manually, from a written checklist

Run before each milestone is called done.

For signed-in local browser checks, follow `docs/12-deployment-devops.md` §8.

| # | Check | Why not automated |
|---|---|---|
| 1 | **Open every generated `.docx` in real Microsoft Word.** Not LibreOffice, not a preview | PRD §8 rates an unopenable render as severe as data loss. No library can assert "Word will open this" |
| 2 | **履歴書 printed to A4** — grid alignment, photo cell, no row splitting across pages | Layout fidelity is visual |
| 3 | 職務経歴書 register reads as native Japanese business writing, not translated English | A judgment call |
| 4 | Career stories: EN and JA chapters correspond one-to-one | Structure is asserted; equivalence is not |
| 5 | Fact-review scroll sync in both directions; selected mark lands ~34% from the top | Interaction feel |
| 6 | Design-system conformance: no off-scale spacing, no new colours, mixed font stack on every Japanese surface | Visual |
| 7 | Full keyboard pass through fact review | Interaction |
| 8 | **The application loads**: static assets served, the SPA mounts, the sign-in button reaches Google | Covered by the browser smoke test (§2.9) since 2026-09-30; kept as the fallback if it is ever removed. The *server's* sign-in path is now automated (§2.9); what is left here is the browser: the bundle, the SPA mount, and the button that starts the redirect |

**Checklist item 1 is a release blocker.** If it fails, nothing ships.

**Item 4 is runnable, and its structural half was run on 2026-09-13** against the first generated
pair. Both stories became `buildable` that day. The structure is not a judgement and is not read by
hand: both are generated from one computed chapter plan and a generation whose chapters do not match
it is refused (`src/render/chapters.ts`, `docs/06` 2026-09-13). The pair came back with identical
section keys in identical order, nine chapters each, block counts within one of each other in six of
the nine, and the Japanese half running 9,558 characters to the English half's 22,003, which is the
ratio the register asks for. Neither carries 貴社 or 御社; 98% of Japanese sentences end です・ます.

**What is left of item 4 is the judgement, and only the author can make it**: whether the two
chapters under one key tell the same story, and whether the Japanese one reads as Japanese rather
than as the English one translated. Read the pair side by side, chapter by chapter.

**The judgement half was run on 2026-09-19**, and item 4 is now done for the first pair. The author
read the two stories chapter by chapter and accepted both; each is version 1 of its render. The
pair read was the second generation of each story, the first of each having been superseded and
dismissed. As a reading aid, each chapter was shown with the fact ids its two halves cite: four
chapters cite identical sets, and the other five share between 35% and 74% of their facts, which is
where drift would show first if there were any. The attribution check reported nothing on either
story.

**Item 3 was run on 2026-09-12, against the second 職務経歴書 generated that day.** The register
holds: no bullet ends in です・ます, no bullet uses a first-person pronoun, 体言止め is consistent
across the experience bullets and the skills rows, and です・ます体 holds in 経歴要約 and 自己PR. It
reads as Japanese business writing rather than translated English, which is what the item asks.

Running it found two faults the automated checks did not. The first generation headed all four
employers in Latin while the record held 株式会社… for every one, and filled three 事業内容 rows the
register says to omit. Both are fixed and both are in the decision log under 2026-09-12; the second
is now caught by a fourth attribution invariant rather than by a person reading. That is the value of
a judgement item: it is the only check that reads the document as a document.

**Item 2 is runnable and has not been run.** 履歴書 became buildable on 2026-09-11, so it has
something to print. It is in the state "never been run" rather than "cannot be run yet".

The employer-name fault above did NOT reach it. The 履歴書 builds its 学歴・職歴 rows from its own
input builder in `src/server/services/rirekisho.ts`, which reads `nameJa` directly and always has;
`collectRenderInputs` supplies only the prompt behind 志望動機. So the table a reader sees was correct
in both accepted versions, and what the fix changed for this render is the employer names the
motivation prompt was shown.

**Two of these items need a browser that the Claude Code Browser pane is not.** Item 7 needs
keystrokes the pane does not deliver — a capture-phase `keydown` listener there records nothing and
focus never moves — and the pane also renders the app's minimum-width gate. Item 5 needs a window
that is genuinely in front: a tab reporting `document.visibilityState === "hidden"` does not animate
smooth scrolling, so `scrollTo({behavior: "smooth"})` is a silent no-op and a scroll that appears not
to happen proves nothing. Both want real Chrome, wider than 1280px, visible, and clicked into once
before the first key — see the 2026-09-03 decision-log entry.

**Items 5, 6 and 7 may be driven by an agent** — Claude Code's browser tooling can open the app,
interact with it and report what it sees, which is faster and more consistent than the author doing
it by hand. This is **exploratory verification, not testing**: it is non-deterministic, it costs
tokens per run, and it does not run in CI. It replaces part of the manual pass; it replaces nothing
in §2. Items 1–4 stay human — they are judgement calls about a document a person will read.

---

## 4. Deliberately untested in v1

| Not tested | Why acceptable |
|---|---|
| Model output *quality* | Not assertable. This is what the by-eye comparison against the hand-produced documents is for |
| A broad end-to-end suite | One smoke test exists (§2.9). Beyond that, E2E suites rot fastest and catch least at three screens and one developer |
| Visual regression / screenshot diffing | One developer and two themes whose contrast `npm run lint` already holds to a number (`05` §8b). The setup cost exceeds the bugs it would catch |
| Load and performance | One user. Revisit at the first invited second user |
| Better Auth internals | Testing a maintained library's own behaviour. **Our allowlist and session middleware are tested; its storage, crypto and cookie attributes are not.** Since 2026-09-02 the sign-in *path* is walked end to end against a local issuer fixture (§2.9) — that asserts our wiring through Better Auth, not Better Auth |
| Browser compatibility beyond current Chrome and Safari | Desktop only, one known user |
| `.docx` byte-level output | Brittle and meaningless. Structure is asserted; fidelity is checklist item 1 |

**One end-to-end test exists and no more** (§2.9). The flows in `09-user-flows.md` are otherwise
verified by API integration tests plus the manual checklist.

---

## 5. When tests run

| Trigger | What runs |
|---|---|
| Pre-commit | Type check, lint |
| Every push, every PR | Full suite against Docker Postgres |
| Before a milestone is called done | Full suite **plus** the §3 manual checklist |

**A failing §2 test is never skipped or marked pending to unblock a merge.** Each one guards a
failure that is invisible in production, which is precisely why it would be tempting.
