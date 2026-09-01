# Track Record

A web application that turns a hand-maintained career record into a structured source of truth
with derived renders (résumé, 履歴書, 職務経歴書, interview stories).

**Phases 1–4 are complete. The M1 vertical tracer is built** (issue #1) — sign-in through an accepted
English résumé, every stage present and no stage elaborated past what the path needs. `docs/` remains
the source of truth; the prototype in `design/prototype/` is a visual reference only. Where they
disagree, the docs win.

Run it: `npm run db:up` (Postgres + the Neon HTTP proxy, and both databases), `npm run db:migrate:local`
on a first run, then `npm run dev:worker` and `npm run dev`. `npm test` needs the database up.
`npm run build` runs the design-token check, the type check and the client build, in that order.

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
`/Users/yutaasakura/Documents/GitHub/claude-setup-inventory/project-planning-template.md` owns the
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
