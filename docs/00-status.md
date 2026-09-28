# Project status

**Project:** track-record
**Phase:** 7 — Build
**Updated:** 2026-09-28

## Done

- Planning: `docs/01`–`13`, ADRs in `docs/adr/`, decisions in `docs/06-decision-log.md`.
- Build issues through #28 closed (`gh issue list --state closed`).
- CI: `.github/workflows/ci.yml` runs lint, typecheck and the full suite against docker-compose
  Postgres and the Neon HTTP proxy.

## Next

Planned 2026-09-28 (`docs/06-decision-log.md`, that date). Every issue below is drafted and labelled
`needs-triage`, awaiting the author's confirmation; none is `ready-for-agent` yet.

- **Go-live.** #34 deploys production on every merge to `main`, once the owner has provisioned it
  (Neon project, custom domain, Google OAuth client, Actions and Worker secrets). #40 then rehearses
  rollback and point-in-time restore on the empty production project and moves the record in by
  `pg_dump`. M1's exit criteria in `docs/12` §4–5 stay open until #40 closes.
- #33, the Playwright half of the end-to-end smoke test (`docs/11-testing-plan.md` §2.9).
- **The back-catalogue import (M3)**, in order: #35 document-level employer and the first
  portfolio, #36 overlap flags on the Fact Review card, #37 re-grading the 112 agent-graded facts,
  #38 the remaining portfolios, #39 all five renders regenerated.

## Blocked

- #35–#39 wait on go-live: the import lands in production (#34, #40).
- #35 and #36 each open with a question for the author (`docs/04` §3.12).

## Carrying

- Nothing.

## Skipped

- What `docs/11-testing-plan.md` §4 leaves untested in v1.
