# Project status

**Project:** track-record
**Phase:** 7 — Build
**Updated:** 2026-09-24

## Done

- Planning: `docs/01`–`13`, ADRs in `docs/adr/`, decisions in `docs/06-decision-log.md`.
- Build issues through #28 closed (`gh issue list --state closed`).
- CI: `.github/workflows/ci.yml` runs lint, typecheck and the full suite against docker-compose
  Postgres and the Neon HTTP proxy.

## Next

- The Playwright half of the end-to-end smoke test (`docs/11-testing-plan.md` §2.9, not built).

## Blocked

- Nothing.

## Carrying

- #25: the local Neon HTTP proxy wedges; cause unknown. Capture and restart steps are in `CLAUDE.md`.

## Skipped

- What `docs/11-testing-plan.md` §4 leaves untested in v1.
