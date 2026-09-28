# 12 — Deployment & DevOps

**Status:** Phase 4 · written 2026-08-12
**Scope:** deployment and local development.

---

## 1. Environments

**Two. There is no staging.**

| Environment | Where | Database | Purpose |
|---|---|---|---|
| **Local** | `wrangler dev` on the author's machine | Docker Postgres `track_record_dev` through the local Neon HTTP proxy; a separate Neon development branch is optional | Development |
| **Production** | Cloudflare Workers, on its `workers.dev` address | Neon `main` | The real record |

> **Status, 2026-09-28: production is not provisioned, and the real record is in the local
> `track_record_dev`**, where it has been since 2026-09-04. It moves to Neon `main` by `pg_dump`
> (§5), after the rehearsals in §4 have run on the empty production project. Until then that local
> database is the only copy, and the separation in §8 is what protects it.
>
> **Provisioning began 2026-09-28.** The Neon project `track-record` exists, empty, in
> `aws-ap-southeast-1` on Postgres 17 (`docs/13` §8), with one database, `track_record`, on branch
> `main`. The GitHub Environment `production` holds its `DATABASE_URL`, and `main` is protected: a PR
> is required, `ci` must pass, and force pushes are blocked, for admins too. Production serves from
> **`https://track-record.asakurayuta.workers.dev`**, not a custom domain (decision log,
> 2026-09-28); the account's workers.dev subdomain `asakurayuta` was registered the same day. The
> `production` Environment also holds `CLOUDFLARE_ACCOUNT_ID`, and the Worker has `DATABASE_URL`,
> `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`; setting them created an empty placeholder Worker, which
> the first deploy replaces. Still the owner's: `CLOUDFLARE_API_TOKEN`, the production Google OAuth
> client, `ANTHROPIC_API_KEY` and `ALLOWED_SIGNUP_EMAILS`. Nothing has deployed.

**Why no staging.** A staging environment for a one-person application is something you configure,
use twice, and then let drift until it is actively misleading. What staging normally buys — a safe
place to try a schema change — is bought instead by Neon branching, which is instant, free, and
disposable.

**Neon branches carry production data**, by the author's decision (decision log, 2026-08-12). The
constraint that survives: **no database dump is ever committed.** The repo is public, and a dump is
the one way this data leaves the author's control in a single irreversible action.

**What differs between the two environments:** the database, the secret values, the sign-up
allowlist, and log verbosity. **Nothing else.** Same code, same migrations, same runtime.

---

## 2. Environment variables and secrets

**Nothing below is ever committed.** Production values live in Cloudflare Workers secrets
(`wrangler secret put NAME`). Local values live in `.dev.vars`, which is gitignored and must stay
that way.

| Name | Purpose | Where the value comes from |
|---|---|---|
| `DATABASE_URL` | Database connection string | Local Docker Postgres for the standard development setup (`.dev.vars.example`); Neon dashboard for production or an optional development branch |
| `ANTHROPIC_API_KEY` | The generation layer | Anthropic console. **The only spending credential in the system** |
| `BETTER_AUTH_SECRET` | Session signing | Generated once per environment, 32+ random bytes |
| `BETTER_AUTH_URL` | Callback base URL | `http://localhost:8787` locally, `https://track-record.asakurayuta.workers.dev` in production |
| `GOOGLE_CLIENT_ID` | OIDC | Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | OIDC | Google Cloud console |
| `ALLOWED_SIGNUP_EMAILS` | Invite gate (`08` §2) | Config, not a secret — but environment-specific |
| `ANTHROPIC_MODEL` | Model ID, default `claude-opus-5` | Config. Exists so a model change needs no deploy |

**The deploy job's own secrets** live in the GitHub Environment `production`, not with the Worker:
`DATABASE_URL` for the migrate step, and `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for
`wrangler deploy` (§3). Only `main` may deploy to that environment, so a workflow run on any other
branch cannot read them.

**Two Google OAuth clients**, one per environment, because the redirect URIs differ. Sharing one
between local and production means a local misconfiguration can break production sign-in.

**A committed secret is the single most likely serious failure of this project** — more likely than
any attack. Mitigations: `.dev.vars` and `local/` gitignored, secret scanning enabled on the GitHub
repository, and a pre-commit hook that rejects a staged file containing a high-entropy string
matching known key prefixes.

> **Status, 2026-09-28: the pre-commit hook is not in this repository.** `core.hooksPath` points at
> a machine-level hooks directory, and whether it rejects key prefixes is **unverified**. GitHub
> secret scanning and push protection are enabled on the repository.

---

## 3. Deploying

**Trigger:** a merge to `main` on GitHub. **Actor:** GitHub Actions.

```
1. Type check + lint
2. Full test suite against Docker Postgres      ← a red suite stops here
3. drizzle-kit migrate  → Neon main
4. vite build           → static assets
5. wrangler deploy      → Cloudflare Workers
6. Smoke check: GET / serves the SPA shell carrying the deployed commit SHA,
   and an /api/* route answers 401 without a session
```

**There is no health route** (decision log, 2026-09-28). The build bakes the commit SHA into the SPA
shell, and step 6 compares it with the commit the job deployed. The `401` proves the Worker and the
auth middleware are live behind the assets. A public `/api/health` would be a second exception to
deny-by-default (`07` §1), which allows `/api/auth/*` and nothing else. The check does not prove the
database answers; step 3 is what touches Neon.

Migrations run **before** the Worker deploys, so the new code never meets an old schema. This makes
**backward-compatible migrations mandatory**: add columns before writing to them, and never drop a
column in the same deploy that stops using it. A two-step drop (stop using, deploy, then drop) is
the rule.

**Built 2026-09-28 (#34).** The `deploy` job in `.github/workflows/ci.yml` runs on a push to `main`
after the `ci` job has passed on the same commit; steps 1–2 are that job, which also builds and
bundles on every branch. A PR into `main` runs `ci` only. The job reads its secrets from the GitHub
Environment `production`, which only `main` may deploy to: `DATABASE_URL` (Neon `main`, the direct
connection), `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Deploys queue rather than cancel,
so a migration is never interrupted. `wrangler deploy --message` records the commit SHA on the
version, which is what `wrangler rollback` lists.

The shell carries the SHA as `<meta name="build-sha">` (`vite.config.ts`, `scripts/build-sha.ts`).
The smoke check is `scripts/smoke-check.ts`: it requests `/`, the module script `/` loads, and
`GET /api/overview`, and it fails unless the shell names the deployed commit, the script is served as
JavaScript, and the API answers its own `401` error shape. It retries for five minutes, because a
new version takes a moment to reach every edge location. It checks the URL the deploy itself
reported: the deploy step sets `WRANGLER_OUTPUT_FILE_PATH`, Wrangler writes the `workers.dev`
address it deployed to into that file, and a deploy that reports no URL fails the check. After a
manual deploy, `npx tsx scripts/smoke-check.ts --origin <url>` checks the same things; `-dirty` on
the SHA marks a build from uncommitted changes.

**Manual deploys are permitted** (`wrangler deploy` from the author's machine) because this is a
personal project and being locked out of your own tool by a CI outage is worse than the discipline
is worth. But CI is the default path, and a manual deploy that skips the tests is a decision, not a
habit.

---

## 4. Rolling back

**Written before the first deploy, deliberately.**

| Situation | Action |
|---|---|
| Bad code, schema unchanged | `wrangler rollback` — Cloudflare keeps previous versions. **Seconds** |
| Bad code, schema changed **compatibly** | Same. The old code still works against the new schema, which is why compatibility is mandatory |
| Bad migration | **Restore `main` to a point in time before it ran**, then roll back the Worker. ⚠️ **The free-tier window is 6 hours** — see §5 |
| Bad *data*, schema fine | Neon point-in-time restore. This is also the answer to "I accepted the wrong proposal and Undo is gone" |
| Leaked secret | §6 |

**The rollback path is exercised once, deliberately, before M1 is called done.** A rollback
procedure that has never been run is a hypothesis.

> **Status, 2026-08-30: NOT YET REHEARSED.** It cannot be: `wrangler rollback` needs a real
> deployment and a Neon point-in-time restore needs a real Neon project, and neither exists yet.
> This is the one M1 exit criterion still open — the restore drill in §5 is built and passing.
> **Rehearse it immediately after the first deploy**, on a dev branch, before any real record
> exists to lose.
>
> **Superseded 2026-09-28 on where and when.** A real record now exists, in the local database (§1),
> and dev branches have no point-in-time restore (§5). Both rehearsals run **on the fresh production
> project, after the first deploy and before the record moves in**, as their own owner-run issue,
> separate from the deploy automation. Until they have run, this M1 exit criterion is still open.

---

## 5. Backups

| What | How | Where |
|---|---|---|
| The record | **Neon point-in-time restore — a 6-hour window on the Free plan**, capped at 1 GB of change history. Root branches only; dev branches have none | Neon |
| The record, off-platform | **`GET /api/export`** — the full record as JSON (S15) | Wherever the author saves it |
| Code | GitHub | |
| Secrets | **Not backed up.** All are regenerable; regenerating is safer than storing a copy | |

**The honest gap, now measured rather than assumed.** Verification against Neon's own documentation
found the Free plan's restore window is **six hours**, not the open-ended window this document
originally implied. That covers *"I just ran a bad migration"*. It does **not** cover *"I noticed on
Wednesday that Monday's deploy corrupted something."*

**Resolved 2026-08-12: stay on the free plan, and `GET /api/export` (S15) becomes the backup.**
S15 is promoted from `SHOULD` · M3 to `MUST` · **M1**. Rejected: automating the export off-platform
(reintroduces the object storage `03` deliberately removed) and upgrading Neon to Launch for a
7-day window at real monthly cost.

**What this means in practice, stated plainly:** the six-hour window covers a mistake you notice
immediately. Anything older is recovered from your most recent export — so **the export is only
worth what your habit of running it is worth.** Automating it is the first thing to revisit if the
record ever starts feeling irreplaceable.

**A restore is tested once before M1 is done** — restore a branch to a point in time, confirm the
record is intact. Untested backups are not backups.

**And then monthly — the restore drill.** Decided 2026-08-29. A scheduled job loads
the most recent `GET /api/export` output into a scratch database and asserts row counts per table
and referential integrity across every foreign key. It fails loudly. This is what converts the
six-hour window from a risk that is *accepted* into one that is *tested*: the export is the only
recovery path for anything older than six hours, and an export that has never been restored is a
belief, not a backup. **Passing the drill once is an M1 exit criterion**, alongside the rollback
rehearsal in §4.

**Built and passed, 2026-08-30.** `npm run restore:drill -- --export <file>` creates a scratch
database, applies the committed migrations, loads the export, and asserts per-table row counts,
every foreign key, and the Measured-facts-carry-evidence invariant. It runs through `psql` rather
than the application's own driver, deliberately: a restore must not depend on the application being
able to run.

> **Status, 2026-09-28: the drill is manual, and stays manual for now.** No scheduled job runs it. It
> needs an export file taken from the author's signed-in session, so a scheduled job could not run
> it as described above. Automating it is revisited once the record has moved into production
> (decision log, 2026-09-28).

> **What an export cannot restore, and why that is correct.** Source documents never render, export,
> or appear in any output (PRD §6.1), so `extracted_text` and `original_bytes` are not in the file.
> Versions restore as **evidence stubs** — `import_status = 'failed'` with a stated reason — and the
> drill reports how many. **The evidence pointers survive**: every fact keeps its quote, its offsets
> and its line number, so re-importing the original file restores the evidence and the quotes can be
> re-verified against it. The author holds those originals; they are what the corpus is.
>
> Stated plainly: an export restores **the record**, not the documents the record was read from.

**Moving the record into production (decided 2026-09-28).** Because an export does not carry the
source documents, it is not how the record reaches production. The record moves once, by
`pg_dump` of the local `track_record_dev`, restored into Neon `main`. It is the only lossless path.

- **Order:** after the first deploy and after both rehearsals in §4, so the only copy of the record
  is never the one a rehearsal restores.
- **The dump is made outside the repository and is never committed.** It is deleted once the
  restore has been checked. It holds the author's PII and NDA-bound material, like `DATABASE_URL`
  itself (§6).
- **The owner runs it**, because it needs the production `DATABASE_URL`. The procedure is below
  (written 2026-09-28, #34).

**The move, step by step.** The deploy job has already migrated Neon `main`, so the dump carries
**data only** and lands in the schema the job built. The alternative, a full dump restored over an
empty database, would leave Neon without the `drizzle` migration journal, and the next deploy would
try to create every table again.

1. **Preconditions.** The first deploy has run and #40's rehearsals are done. Production holds no
   rows: only the author will sign in, and not before step 5. `ALLOWED_SIGNUP_EMAILS` in production
   names the author.
2. **Freeze and export.** Stop using the local app. Take a `GET /api/export` from it, as a copy that
   does not depend on this procedure.
3. **Same schema on both sides.** Local migrations are applied by `npm run db:migrate:local`, which
   keeps no journal, so compare the schemas themselves. Each command writes to a file outside the
   repository, and the diff must be empty. It ignores `pg_dump`'s version comments and its
   per-dump `\restrict` key, which differ on every run:

   ```sh
   docker compose exec -T postgres pg_dump -U postgres -d track_record_dev --schema-only --schema=public --no-owner --no-privileges > ~/tr-move/local-schema.sql
   pg_dump "$(neon connection-string main --project-id <project> --database-name track_record)" --schema-only --schema=public --no-owner --no-privileges > ~/tr-move/prod-schema.sql
   diff -I '^--' -I '^\\' ~/tr-move/local-schema.sql ~/tr-move/prod-schema.sql
   ```

   A difference means a migration is missing on one side. Stop and apply it there, never by hand-editing
   either schema. Use `pg_dump` 17 or newer, because Neon runs 17 (`docs/13` §8).
4. **Dump the data.** Leave out the two tables that hold only short-lived rows: sessions signed by the
   local secret, and pending OAuth verifications.

   ```sh
   docker compose exec -T postgres pg_dump -U postgres -d track_record_dev --data-only --schema=public --no-owner --no-privileges --exclude-table-data=sessions --exclude-table-data=verifications > ~/tr-move/record.sql
   ```

   `pg_dump` writes the tables in foreign-key order, which works because the schema has no foreign-key
   cycle (checked 2026-09-28). If a later migration adds one, `pg_dump` warns about it, and this step
   needs revisiting before it runs.
5. **Restore in one transaction:**
   `psql "$(neon connection-string main --project-id <project> --database-name track_record)" --single-transaction -v ON_ERROR_STOP=1 -f ~/tr-move/record.sql`.
   Any error rolls back the whole restore and leaves production empty. A second run fails on the first
   duplicate key and changes nothing.

   Steps 3–6 were rehearsed on 2026-09-28 with invented rows in every table, from a disposable
   Postgres 17 migrated the way `db:migrate:local` does it into a Neon branch migrated the way the
   deploy job does it. The schemas matched, and every count matched except the two excluded tables.
6. **Check it.** Run the row count below against both databases and compare the two outputs. Every
   table must match except `sessions` and `verifications`. Then sign in to production. Google's
   subject identifier is the same for every OAuth client of one Google account, so the moved `accounts`
   row finds the moved user. The Overview's counts must match the local app's.

   ```sql
   select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::int as row_count
   from information_schema.tables where table_schema = 'public' order by 1;
   ```

7. **Clean up.** Delete `~/tr-move/`, take the first `GET /api/export` from production, and from then
   on stop using the local record (§1).

---

## 6. Incident: a leaked key

First three steps, written now rather than during the fire.

1. **Revoke first, investigate second.** Rotate the key in the provider's console — Anthropic,
   Google, Neon — before working out how it leaked. A revoked key costs an outage; a live leaked key
   costs money or data.
2. **Set the new value** with `wrangler secret put` and redeploy.
3. **Then** determine the exposure: check git history (`git log -S`), rewrite history if it was
   committed, and check the provider's usage dashboard for calls you did not make.

**If `ANTHROPIC_API_KEY` leaks**, the damage is financial and potentially large. **If `DATABASE_URL`
leaks, the damage is the record itself** — the author's PII and NDA-bound client material — and that
is the one incident with a consequence that cannot be undone by rotating anything.

---

## 7. Monitoring

Proportionate: this is a single-user application, and the author is the only person who will ever
notice an outage. Alerting on uptime would be alerting the person already using it.

| Signal | Where | Why it earns its place |
|---|---|---|
| **Anthropic spend** | Provider dashboard, **with a billing alert set** | The only uncapped cost. Also the first sign of a leaked key |
| Worker errors and CPU time | Cloudflare dashboard | CPU headroom for `.docx` assembly is an open question (`03` §11) |
| Failed Workflow instances | Cloudflare Workflows dashboard | A silently failing import is invisible from inside the app |
| Neon storage and compute hours | Neon dashboard | Free-tier ceiling |
| The commit SHA in the SPA shell | `GET /` (§3 step 6) | Confirms *which build* is live — the question you ask when behaviour is unexplained. Not a route: deny-by-default allows none (decision log, 2026-09-28) |

**How the author finds out something broke:** by using the app, which is acceptable at one user and
**stops being acceptable at the first invited second user** — at which point error alerting becomes
a gate alongside the others in `08` §2.2.

---

## 8. Local development

1. Copy `.dev.vars.example` to `.dev.vars` and fill in local values. Keep `DATABASE_URL` on
   `track_record_dev` and `BETTER_AUTH_URL` at `http://localhost:8787`. Add
   `dev-session@example.invalid` to `ALLOWED_SIGNUP_EMAILS` for browser checks without Google.
2. Run `npm run db:up` for Docker Postgres and the Neon HTTP proxy. On the first run, apply the
   committed migrations with `npm run db:migrate:local`.
3. Start the worker with `npm run dev:worker` and the SPA with `npm run dev`. `npm run db:down`
   stops the stack and keeps the `pgdata` volume. `npm run db:reset` is the only command that
   removes it, and it refuses without `-- --destroy-local-record` (`docs/06`, 2026-09-28).
4. For a signed-in browser, run `npm run dev:session` and follow its printed instructions for
   the cookie and Vite URL. The helper uses the suite's sign-in path outside the app; it requires
   the local database and does not add an application route.

The suite uses the separate `track_record_test` database, which it drops and rebuilds on every run
(`docs/11-testing-plan.md` §1). A Neon development branch is optional for ordinary development;
`npm run dev:session` requires the local database.
