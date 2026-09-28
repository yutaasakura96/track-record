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

Planned 2026-09-28 (`docs/06-decision-log.md`, that date). The author confirmed #35–#40 the same day,
and they are labelled `ready-for-agent`; #33 and #34 keep their labels. Steps only the owner can take
are marked as the owner's in each issue.

- **Go-live.** #34 deploys production on every merge to `main`. The Neon project, the `production`
  Environment with `DATABASE_URL`, and protection on `main` were provisioned on 2026-09-28
  (`docs/12` §1). Still the owner's: the Cloudflare zone and token, the Google OAuth client, and the
  Worker secrets. #40 then rehearses
  rollback and point-in-time restore on the empty production project and moves the record in by
  `pg_dump`. M1's exit criteria in `docs/12` §4–5 stay open until #40 closes.
- #33, the Playwright half of the end-to-end smoke test (`docs/11-testing-plan.md` §2.9).
- **The back-catalogue import (M3)**, in order: #37 re-grading the 112 agent-graded facts, which
  waits on nothing open; #35 the document-level employer and the first portfolio, the first review
  to use #36's overlap flag and #37's re-grade; #38 the remaining portfolios; #39 all five renders
  regenerated.

## Blocked

- #35 and everything after it wait on go-live, because the import lands in production (#34, #40).
  #35 also waits on #37.

## Carrying

- Nothing.

## Skipped

- What `docs/11-testing-plan.md` §4 leaves untested in v1.
