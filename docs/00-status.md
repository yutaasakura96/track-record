# Project status

**Project:** track-record
**Phase:** 7 — Build
**Updated:** 2026-10-01

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
  (`docs/12` §1), with the Cloudflare account id and three of the seven Worker secrets. Production
  serves from `https://track-record.asakurayuta.workers.dev`, with no custom domain. The first
  deploy ran on 2026-09-29 and was signed into the same day, so the Cloudflare API token, the Google
  OAuth client and the sign-up allowlist are in place. #40's rollback and
  point-in-time restore rehearsals ran on 2026-10-01, and the record moved into Neon `main` the same
  day by the `pg_dump` procedure in `docs/12` §5 (decision log, that date). The monthly restore drill
  stays manual for now.
- #33, the Playwright half of the end-to-end smoke test (`docs/11-testing-plan.md` §2.9).
- **The back-catalogue import (M3)**, in order: #35 the document-level employer and the first
  portfolio, the first review to use #36's overlap flag and #37's re-grade; #38 the remaining
  portfolios; #39 all five renders regenerated. The author re-grades the 112 as they appear on the
  overlap card, and the rest from `To re-grade` on the 2026-09-04 import's Fact Review.

## Blocked

- #35 and everything after it wait on go-live, because the import lands in production (#34, #40).

## Carrying

- Nothing.

## Skipped

- What `docs/11-testing-plan.md` §4 leaves untested in v1.
