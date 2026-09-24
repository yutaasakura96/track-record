# Track Record

A web application that turns a hand-maintained career record into a structured source of truth
with derived renders (résumé, 履歴書, 職務経歴書, interview stories).

**Phases 1–4 are complete. The M1 vertical tracer is built** (issue #1) — sign-in through an accepted
English résumé, every stage present and no stage elaborated past what the path needs. `docs/` remains
the source of truth; the prototype in `design/prototype/` is a visual reference only. Where they
disagree, the docs win.

Run it: `npm run db:up` (Postgres + the Neon HTTP proxy, and both databases), `npm run db:migrate:local`
on a first run, then `npm run dev:worker` and `npm run dev`. `npm test` needs the database up; the client screen tests
alone (`npx vitest run --project client`) do not.
`npm run build` runs the design-token check, the type check and the client build, in that order.
`npm run measure -- --latest` prints the experience-section figures every register decision in the
decision log is argued against — count, mean length, share carrying a number. **Do not rebuild it
by hand**; that is what it is committed for, and it prints numbers and never render text.
`npm run check:attribution -- --latest` is the second instrument: it checks a render's facts against
the record — unknown fact ids, unfiled facts used under an employer, facts under a heading naming a
different employer — and exits non-zero on a finding. It prints ids and counts and never render
text, and it is not to be rebuilt by hand either.

**A stalled run has two signatures, and only one is the proxy.** Read the failed-test durations
before touching anything.

- **Durations far above 30,000ms** (900,000ms is typical), timeouts only, no assertion failures:
  the machine slept mid-run. `tests/sleep-watch.ts` says so in the output, at the moment of waking
  and again at the end. Confirm with `pmset -g log | grep -E ' (Sleep|DarkWake|Wake) ' | tail` and
  rerun with the machine awake. Nothing needs restarting; the proxy is healthy.
- **The suite stops in three seconds naming the proxy, or failures sit at about 30,000ms with the
  proxy-watch "has not answered" line in the output**: the proxy is not answering. Run
  `npm run capture:proxy`, **then** `docker restart track-record-neon-proxy-1` — the restart erases
  the evidence. The capture is gitignored; read it before attaching it anywhere. The dev worker
  prints the same steps when a query and a `select 1` probe after it both go unanswered
  (`src/server/db/proxy-watch.ts`).

Every stall recorded before 2026-09-25 was the first kind (issue #25, decision log 2026-09-25). The
20 idle backends on `track_record_test` are the proxy's normal resting state, not a full pool.

**Development and the suite have separate databases** — `track_record_dev` and `track_record_test`.
The suite drops and rebuilds `public` on every run, and sharing one database meant `npm test`
destroyed the dev session, profile, documents and renders. Two guards in `tests/database-guard.ts`
keep them apart; do not point `.dev.vars` at `track_record_test` to get around one.

Read in this order: `docs/01-project-brief.md` and `docs/02-product-requirements.md` (what this is),
then `docs/03-technical-design.md` and `docs/04-database-schema.md` (how it is built).
`docs/05-design-system.md` and `docs/10-screen-specifications.md` are the interface contract.
`docs/06-decision-log.md` answers "why is it like this?" and is **append-only** — never edit an
existing entry; supersede it with a new one. `docs/00-kickoff.md` was the pre-planning scaffold and
survives only in git history.

## The downstream repo, and what both ended up building

**`yutaasakura96/suburi` consumes what this repo renders** — it reads a 履歴書, a 職務経歴書 or an
English CV as the document an interview answer is scored against. Nothing connects them in code and
nothing should. This section exists because the two repos keep arriving at the same problems
independently, and one of them has already been solved better on each side.

| | Here | Suburi |
| --- | --- | --- |
| Verbatim anchoring | `src/pipeline/quote.ts` — `indexOf`, first occurrence, exact | `lib/cv/spans.ts` — every occurrence, nearest the model's start hint, plus grapheme and document-boundary rules |
| Same-assertion matching | `src/pipeline/dedupe.ts` — `NFKC` + whitespace + lowercase, hashed, permanent | whitespace collapse only |
| Section coverage | `src/pipeline/chunk.ts`, ~2,400 characters on paragraph boundaries | one call for the whole document |

- **Our dedupe normalisation is the better one**, and Suburi has an issue open to adopt it. Keep the
  split `dedupe.ts` states: anchoring decides whether a quote is *real* and is exact; normalisation
  decides whether two candidates are the *same claim* and is deliberately forgiving.
- **Our chunking prevents a failure Suburi had to build a counter for** — a whole section returning
  no claims at all, with every other signal reporting healthy. A model reading 2,400 characters has
  nowhere to skip to. Worth remembering the next time chunking looks like it is only about the
  progress bar.
- **Our extraction prompt carries a risk Suburi has now removed from its own.** "A sentence carrying
  two distinct outcomes is two calls" has no counterpart rule against stopping at a 連用形 or a
  participial hinge, and Suburi measured 63 Japanese and 68 English claims that did exactly that. It
  hurts less here, because `claim` and `quote` are separate columns and the quote only has to
  support the claim — but a fragment behind the `L79` chip is still a worse citation than a whole
  sentence. Not filed as an issue; noted for whoever next touches `src/model/extract.ts`.

**One seam to watch:** a 履歴書 this repo renders carries a 学歴・職歴 table, and reading a `.docx`
table back correctly is a thing Suburi had to fix specifically. If the round trip is ever exercised,
test it with a real table rather than prose.

## Stack (decided 2026-08-12 — see the decision log)

Cloudflare Workers (paid) · Hono API · React + Vite SPA · TanStack Router + Query · Zustand ·
Tailwind v4 + shadcn/ui · Neon Postgres · Drizzle · Better Auth with
Google OIDC · Cloudflare Workflows for the import pipeline · Anthropic `claude-opus-5` behind a
two-function seam · BudouX for Japanese segmentation · jsdiff for diffing · `docx` and
`docxtemplater` for Word output.

**Rules that are easy to break and expensive to fix:**

- **Every query filters by `user_id`.** No exceptions. Asserted by test.
- **Deny-by-default routing.** Auth middleware covers every route except the auth callbacks.
- **A fact's `quote` must exist verbatim in its source document**, verified by exact string match.
  Candidates that fail are discarded before they reach the database.
- **Generated-provenance and Private-disclosure facts never reach a render.** The block is at
  render time, not review time.
- **Logs never contain source text, fact claims, or render content.**
- **No secret and no database dump is ever committed.** This repo is public.
- **Calendar columns are month precision** — `date` with the day pinned to `01`, never rendered.
- **Every design value comes from `@theme`, generated from `docs/05-design-system.md`.** Arbitrary
  Tailwind values (`p-[13px]`, `text-[#fff]`) and raw colour literals are banned by
  `scripts/check-design-tokens.mjs`, which `npm run lint` runs — they are how the forbidden list dies.
- **Every route is registered through `routes(app)`** in `src/server/http/registry.ts`. A route added
  any other way is invisible to the enumeration test, which is the only thing making deny-by-default
  real rather than aspirational.
- **A source document version is never re-extracted in place.** Fact quote offsets index into its
  text; a parser upgrade creates a new version.
- **Google OAuth requests `openid email profile` and nothing else.** Never a Gmail, Drive or
  Calendar scope. Release blocker, not a hardening task.
- **Nothing is ever deleted** — render versions, source documents and rejected facts are permanent.
  This is correct for one user and becomes wrong at the second: account deletion that actually
  deletes is a gate before the second invite (`08` §6, `13` §8).

**Document ownership — do not violate this.**
`/Users/yutaasakura/Documents/GitHub/claude-agentic-setup/project-planning-template.md` owns the
structure of `docs/01`–`06` and any Tier 2 files it triggers. The `mattpocock-skills` pack supplies
the interview *engine* only; anything it generates (specs, `CONTEXT.md`, ADRs) belongs under
`docs/specs/`, never at `docs/` root. Do not let a second, competing document set grow alongside
the planning template's.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## local/ — read it, never quote it

`local/` holds the author's real career documents. It is gitignored and must stay that way.
Read it freely: understanding the current workflow and the render formats is the point of
having it here.

**Do not copy specifics out of it into any committed file** — `docs/`, code, tests, fixtures,
commit messages or PR descriptions. It contains the author's home address, phone number and
date of birth; NDA-bound client material; names of individuals at client and vendor companies;
and internal network addresses.

Describe structure, not content. "The 職務経歴書 lists each employer with a business-description
paragraph and bulleted technical outcomes" is committable. The employer's internal system
inventory is not.

Test fixtures and seed data must be invented, never sampled from `local/`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
