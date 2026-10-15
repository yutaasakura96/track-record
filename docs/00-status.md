# Project status

**Project:** track-record
**Phase:** 7 — Build
**Updated:** 2026-10-11

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
  OAuth client and the sign-up allowlist are in place. The production `ANTHROPIC_API_KEY` is set
  (verified 2026-10-01 by listing the Worker's secret names; no value was read). The author
  confirmed the Anthropic spend alert set on 2026-10-02. #40's rollback and
  point-in-time restore rehearsals ran on 2026-10-01, and the record moved into Neon `main` the same
  day by the `pg_dump` procedure in `docs/12` §5 (decision log, that date). The monthly restore drill
  stays manual for now.
- #33, the Playwright half of the end-to-end smoke test (`docs/11-testing-plan.md` §2.9).
- **The back-catalogue import (M3)**, in order: #35 the document-level employer and the first
  portfolio (the code half is built, decision log 2026-10-02; the import, its review and the
  measurement are the owner's, in production after the merge), the first review to use #36's
  overlap flag and #37's re-grade; #38 the remaining portfolios; #39 all five renders regenerated.
  The author re-grades the 112 as they appear on the overlap card, and the rest from
  `To re-grade` on the 2026-09-04 import's Fact Review.

- **#57, built 2026-10-08** (decision log, that date): facts are accepted and graded by the
  importer and flagged instead of reviewed one by one, with `Explain this`, the master document and
  tailored résumés. This changes the M3 steps above: a portfolio imported from now on needs no
  review, and the candidates already waiting are sorted from Home in one press. The owner's part is
  that press in production, and reading the Flagged list when they want to.
- **#59, built 2026-10-10** (decision log, that date): Home's documents are two tabs, English and
  日本語, each led by that language's master document. Nothing is owed by the owner.
- **#60, Applications, specified 2026-10-11** (#69; decision log, that date): job applications
  come into scope. `CONTEXT.md`, `02` §3a and S20 to S24, and `10` Screens 12 to 15 are written, and
  the reviewed prototype is `docs/prototype/applications-prototype.html`. #70 builds the list,
  application page and status steps. **#71 and #72, built 2026-10-12**: documents and sent copies
  (`04` §3.17, `07` §9c), plus interview entries and their status changes (`04` §3.15, `07` §9b).
  **#73, built 2026-10-12**: a pasted posting is read by a fifth model function into a company, a
  position and key requirements to check before saving (`03` §4, `07` §9b, `10` Screen 13).
  **#74, built 2026-10-12**: a link to a recording kept elsewhere on an interview entry, opened in
  a new tab and removable for good (`04` §3.16, `07` §9b). No file is stored.
  **#81, built 2026-10-14**: a saved interview entry can be corrected and deleted (`04` §3.15,
  `07` §9b, `09` Flow 12b; decision log, that date).
  **#76, built 2026-10-15**: an audio recording uploaded to an interview entry, up to 90 MB,
  streamed through the Worker to the private R2 bucket `track-record-recordings`, played in the
  page with seeking, downloaded, and removable for good (`04` §3.16, `07` §9b, `09` Flow 13b,
  `13` §1; decision log, that date, for the measured proof and the limits). The owner created the
  bucket on 2026-10-13; the binding is in `wrangler.toml`. The rest of #75 to #77 follow in the
  order their `Depends on` lines give; each writes its own part of `04`, `07` and `09`.

## Blocked

- Nothing.

## Carrying

- Nothing.

## Skipped

- What `docs/11-testing-plan.md` §4 leaves untested in v1.
