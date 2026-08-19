# 12 — Deployment & DevOps

**Status:** Phase 4 · written 2026-08-12
**Trigger:** actually deploying, not just running locally.

---

## 1. Environments

**Two. There is no staging.**

| Environment | Where | Database | Purpose |
|---|---|---|---|
| **Local** | `wrangler dev` on the author's machine | A **Neon branch off `main`** | All development |
| **Production** | Cloudflare Workers, custom domain | Neon `main` | The real record |

**Why no staging.** A staging environment for a one-person application is something you configure,
use twice, and then let drift until it is actively misleading. What staging normally buys — a safe
place to try a schema change — is bought instead by Neon branching, which is instant, free, and
disposable.

**Neon branches carry production data**, by the author's decision (decision log, 2026-08-12). The
constraint that survives: **no database dump is ever committed.** The repo is public, and a dump is
the one way this data leaves the author's control in a single irreversible action.

**What differs between the two environments:** the database branch, the secret values, the sign-up
allowlist, and log verbosity. **Nothing else.** Same code, same migrations, same runtime.

---

## 2. Environment variables and secrets

**Nothing below is ever committed.** Production values live in Cloudflare Workers secrets
(`wrangler secret put NAME`). Local values live in `.dev.vars`, which is gitignored and must stay
that way.

| Name | Purpose | Where the value comes from |
|---|---|---|
| `DATABASE_URL` | Neon connection string | Neon dashboard — **branch-specific**, so local and production differ |
| `ANTHROPIC_API_KEY` | The generation layer | Anthropic console. **The only spending credential in the system** |
| `BETTER_AUTH_SECRET` | Session signing | Generated once per environment, 32+ random bytes |
| `BETTER_AUTH_URL` | Callback base URL | `http://localhost:8787` locally, the custom domain in production |
| `GOOGLE_CLIENT_ID` | OIDC | Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | OIDC | Google Cloud console |
| `ALLOWED_SIGNUP_EMAILS` | Invite gate (`08` §2) | Config, not a secret — but environment-specific |
| `ANTHROPIC_MODEL` | Model ID, default `claude-opus-5` | Config. Exists so the M2 bake-off needs no deploy |

**Two Google OAuth clients**, one per environment, because the redirect URIs differ. Sharing one
between local and production means a local misconfiguration can break production sign-in.

**A committed secret is the single most likely serious failure of this project** — more likely than
any attack. Mitigations: `.dev.vars` and `local/` gitignored, secret scanning enabled on the GitHub
repository, and a pre-commit hook that rejects a staged file containing a high-entropy string
matching known key prefixes.

---

## 3. Deploying

**Trigger:** a merge to `main` on GitHub. **Actor:** GitHub Actions.

```
1. Type check + lint
2. Full test suite against Docker Postgres      ← a red suite stops here
3. drizzle-kit migrate  → Neon main
4. vite build           → static assets
5. wrangler deploy      → Cloudflare Workers
6. Smoke check: GET /api/health returns 200 and reports the deployed commit SHA
```

Migrations run **before** the Worker deploys, so the new code never meets an old schema. This makes
**backward-compatible migrations mandatory**: add columns before writing to them, and never drop a
column in the same deploy that stops using it. A two-step drop (stop using, deploy, then drop) is
the rule.

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
| Bad migration | **Restore the Neon branch to a point in time before it ran**, then roll back the Worker. Neon's history window covers the free tier's retention |
| Bad *data*, schema fine | Neon point-in-time restore. This is also the answer to "I accepted the wrong proposal and Undo is gone" |
| Leaked secret | §6 |

**The rollback path is exercised once, deliberately, before M1 is called done.** A rollback
procedure that has never been run is a hypothesis.

---

## 5. Backups

| What | How | Where |
|---|---|---|
| The record | **Neon point-in-time restore**, continuous within the retention window | Neon |
| The record, off-platform | **`GET /api/export`** — the full record as JSON (S15) | Wherever the author saves it |
| Code | GitHub | |
| Secrets | **Not backed up.** All are regenerable; regenerating is safer than storing a copy | |

**The honest gap:** Neon's free-tier retention window is finite, and everything else depends on the
author remembering to export. **S15 is therefore not merely a portability feature — it is the
disaster-recovery plan**, which is an argument for pulling it earlier than M3 if the record becomes
valuable before then.

**A restore is tested once before M1 is done** — restore a branch to a point in time, confirm the
record is intact. Untested backups are not backups.

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
| `GET /api/health` | Returns 200 + commit SHA | Confirms *which build* is live — the question you ask when behaviour is unexplained |

**How the author finds out something broke:** by using the app, which is acceptable at one user and
**stops being acceptable at the first invited second user** — at which point error alerting becomes
a gate alongside the others in `08` §2.2.

---

## 8. Local development

```
1. Docker Postgres up          — for the test suite only
2. Create a Neon branch off main, put its URL in .dev.vars
3. npm run dev                 — wrangler dev + vite
4. drizzle-kit migrate         — against the branch
```

**The test suite runs against Docker Postgres with invented fixtures, never against the Neon
branch.** Development reads real data; tests never do.
