# 11 — Testing Plan

**Status:** Phase 4 · written 2026-08-12
**Trigger:** long-term maintenance expected — the brief calls this a permanent system of record
intended to grow over years.

**The governing principle: test what fails *silently*.** A misaligned button is visible the moment
you look at it. A leaked private fact, a fabricated number, a 履歴書 missing a conventional field,
and one user's record shown to another all look completely normal. Those are what a machine has to
check, because a human cannot.

**All fixtures are invented.** Nothing is sampled from `local/` — `CLAUDE.md` requires this, and a
test fixture containing a real client name would be committed to a public repo forever.

---

## 1. Tooling

| Layer | Tool |
|---|---|
| Unit and integration | **Vitest** |
| API integration | Vitest against the Hono app, with a real Postgres |
| Server-side tests | **`@cloudflare/vitest-pool-workers`** — runs tests *inside* the Workers runtime via Miniflare, with bindings and isolated per-test-file storage |
| Test database | **`track_record_test`, the suite's own** — Docker Postgres + a Neon HTTP proxy, see below |
| Model calls | **Always stubbed.** No test ever calls Anthropic |
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
versions (issue #4). The docker-compose Postgres now holds two databases: `track_record_dev`, which
`.dev.vars` points at, and `track_record_test`, which is the suite's alone. `npm run db:up` creates
whichever is missing. One proxy serves both: its `PG_CONNECTION_STRING` is an *auth* backend, and
the database each query runs against comes from the connection string the client sends.

**Two guards make that real rather than assumed** (`tests/database-guard.ts`). Before the suite
connects, it refuses to run if `TEST_DATABASE_URL` names `track_record_dev`, or names the same
database on the same server as a dev `DATABASE_URL` — read from `.dev.vars` and from the
environment, since a shell can export one in front of `wrangler dev`. After it connects, it asks
`current_database()` and refuses if the answer is not the database it aimed at: the URL says where a
query was sent, the proxy decides where it lands. Both failures are silent and total without a
guard, which is what makes a cheap check worth having.

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

### 2.9 One end-to-end smoke test — the critical path

**Playwright. One test, one happy path, in CI.** It exists to catch **wiring breakage**, which every
other test in this plan is blind to: auth middleware misconfigured, static assets not served, a route
not mounted, the download endpoint returning HTML instead of a file. All of those pass unit and API
tests and fail the instant the app is opened.

```
Sign in (stubbed OIDC)
  → import a fixture document
  → wait for extraction to finish (stubbed model)
  → accept one fact
  → generate the English résumé
  → accept the proposal
  → download the .docx
Assert: the response is a valid zip with the .docx MIME type and a non-trivial byte length
```

**Deliberately not extended beyond this.** A broad E2E suite at three screens and one developer rots
faster than it catches anything. If a second smoke path is ever justified it will be 履歴書
generation, because that render can fail in ways the résumé cannot.

> **Status, 2026-08-30: the Playwright half is not built.** `tests/smoke.test.ts` walks the whole
> path above through the real Hono application, with only the session resolver and the model seam
> stubbed — so *a route not mounted*, *auth middleware misconfigured*, *the download endpoint
> returning HTML instead of a file* and *the path breaking between stages* all fail it today.
> **Not covered: static assets not served, and the SPA failing to mount.** Both are on §3 until the
> gap closes. The reason it is open, and the shape of the fix — an OIDC issuer run as a fixture,
> rather than a sign-in bypass living in shippable code — are in the decision log, 2026-08-30.

---

## 3. Tested manually, from a written checklist

Run before each milestone is called done.

| # | Check | Why not automated |
|---|---|---|
| 1 | **Open every generated `.docx` in real Microsoft Word.** Not LibreOffice, not a preview | PRD §8 rates an unopenable render as severe as data loss. No library can assert "Word will open this" |
| 2 | **履歴書 printed to A4** — grid alignment, photo cell, no row splitting across pages | Layout fidelity is visual |
| 3 | 職務経歴書 register reads as native Japanese business writing, not translated English | A judgment call |
| 4 | Career stories: EN and JA chapters correspond one-to-one | Structure is asserted; equivalence is not |
| 5 | Fact-review scroll sync in both directions; selected mark lands ~34% from the top | Interaction feel |
| 6 | Design-system conformance: no off-scale spacing, no new colours, mixed font stack on every Japanese surface | Visual |
| 7 | Full keyboard pass through fact review | Interaction |
| 8 | **The application loads**: static assets served, the SPA mounts, sign-in reachable | Standing in for the unbuilt half of §2.9 |

**Checklist item 1 is a release blocker.** If it fails, nothing ships.

**Items 5, 6 and 7 may be driven by an agent** — Claude Code's browser tooling can open the app,
interact with it and report what it sees, which is faster and more consistent than the author doing
it by hand. This is **exploratory verification, not testing**: it is non-deterministic, it costs
tokens per run, and it does not run in CI. It replaces part of the manual pass; it replaces nothing
in §2. Items 1–4 stay human — they are judgement calls about a document a person will read.

---

## 4. Deliberately untested in v1

| Not tested | Why acceptable |
|---|---|
| Model output *quality* | Not assertable. This is what M1's by-eye comparison and the M2 bake-off are for |
| A broad end-to-end suite | One smoke test exists (§2.9). Beyond that, E2E suites rot fastest and catch least at three screens and one developer |
| Visual regression / screenshot diffing | One developer, three screens, dark theme only. The setup cost exceeds the bugs it would catch |
| Load and performance | One user. Revisit at the first invited second user |
| Better Auth internals | Testing a maintained library's own behaviour. **Our allowlist and session middleware are tested; their implementation is not** |
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
