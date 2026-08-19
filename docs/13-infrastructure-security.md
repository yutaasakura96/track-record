# 13 — Infrastructure & Security

**Status:** Phase 4 · written 2026-08-12
**Trigger:** real user data — the record holds the author's PII and NDA-bound client material.

`12-deployment-devops.md` says **how** this ships. This says **what it runs on and how it is
defended.** The security baseline in `03-technical-design.md` §8 still applies; this goes deeper.

---

## 1. Deployable units

**One.** That is the headline, and it is the reason most of this document is short.

| Unit | Runs on | Stateful? | If it dies |
|---|---|---|---|
| **The Worker** — SPA assets, Hono API, Workflow definitions | Cloudflare edge | **Stateless** | Cloudflare restarts it. No state to recover |
| **Workflow instances** — one per import, one per generation | Cloudflare Workflows | **Durable** | **Resumes from its last completed step.** A crash mid-import loses one chunk, not the import. Instance state and logs retained **30 days** on the paid plan |
| **Neon Postgres** | Neon — **region recorded at provisioning; see §8** | **Stateful — the only one** | The app is unusable until it returns. Nothing is lost |

There are no containers, no VMs, no cron jobs, no queues, no cache tier, and no build servers of our
own. **The durable-execution property is doing real work here**: it is what lets a nine-step import
pipeline exist without a job queue, a retry table, or a dead-letter mechanism.

**Infrastructure as code:** `wrangler.toml`, committed. Neon is provisioned through its dashboard —
one database, one branch, no Terraform. **A Terraform module to manage two resources would be more
infrastructure than the infrastructure.** If a third stateful service ever appears, that judgement
changes.

---

## 2. Cost model

| Item | Monthly | Notes |
|---|---|---|
| Cloudflare Workers Paid | **$5.00** | 10M requests, 30M CPU-ms included. Nowhere near the limits |
| Cloudflare Workflows | **$0.00** | 500k steps included; **waiting on the model is not billed** |
| Neon | **$0.00** | Free tier: 0.5 GB, 100 CU-hours, scale-to-zero |
| Anthropic | **~$1–2** | Bursty. The whole 2.4 MB corpus extracts once for ~$3 |
| Domain | ~$1 | Amortised, already owned |
| **Total** | **≈ $6–8/month** | Flat, and does not expire after twelve months |

**What breaks first under 10× load** — meaning ten invited users, since there is no other growth
path:

1. **Anthropic spend.** Uncapped and linear in users. **The first thing to break and the only one
   with no ceiling.** This is why `08` §2.2 makes a per-user spend cap a gate on open registration.
2. **Neon storage**, 0.5 GB free. Source documents in `bytea` dominate; ten users would approach it.
   The paid tier is the answer, or object storage at that point.
3. **Neon compute**, 100 CU-hours across the account — shared with the author's other project.

**Nothing on Cloudflare breaks.** The $5 tier absorbs orders of magnitude more than this will see.

---

## 3. Networking and the trust boundary

```
        PUBLIC                         │            PRIVATE
                                       │
  the Worker's custom domain           │   Neon Postgres  (no public role beyond the app's)
  ├── /            SPA shell           │   Anthropic API  (server-side only)
  ├── /api/auth/*  unauthenticated     │   Workflow instances (no ingress)
  └── /api/*       401 without session │
                                       │
  workers.dev route: DISABLED          │
```

**`workers.dev` is disabled.** Cloudflare issues every Worker a default `*.workers.dev` address.
It is left enabled by default and it bypasses nothing in *our* auth — but it is an unnecessary
second front door on an app holding this material, and disabling it is one line in `wrangler.toml`.

**The `ANTHROPIC_API_KEY` never reaches the browser.** All model calls are server-side. A client-side
call would put a spending credential in devtools.

**DNS:** one subdomain of a domain the author already controls on Cloudflare, proxied (orange
cloud), TLS enforced, HSTS on.

**Caching:** static assets are immutable and hashed, cached at the edge indefinitely. **No API
response is cached anywhere** — every one contains record content, and an edge-cached résumé
fragment is a copy of the record outside the database.

### Rate limiting

Currently **not implemented**, and that is a defensible position at one invited user: the only person
who can authenticate is the operator, and the operator is not attacking themselves. It stops being
defensible the moment a second invite is issued, which is why it is a gate in `08` §2.2 rather than
a TODO.

**When it is built, the limits and the reasoning:**

| Endpoint | Limit | Why |
|---|---|---|
| `POST /api/imports` | 10 / hour / user | Each one is an unbounded model spend |
| `POST /api/renders/:kind/generate` | 30 / hour / user | Cheaper, but still spend |
| `/api/auth/*` | 20 / hour / IP | Credential-stuffing surface, such as it is |
| Everything else | 600 / minute / user | Generous; catches runaway client loops |

Exceeded → `429` with `Retry-After`. **A spend cap is separate from and more important than a rate
limit**: a rate limit slows an expensive user, a cap stops one.

---

## 4. Threat model

**Who would attack this, and for what.** Being honest about this matters, because the honest answer
changes the priorities.

| Actor | Wants | Realistic? | What stops them |
|---|---|---|---|
| **Opportunistic scanner** | Any exposed database or key | **Yes — constant** | No public write surface; secrets outside the repo; deny-by-default routing |
| **Someone who wants the author's PII** | Address, phone, DOB | Low — targeted | Invite-only sign-up; ownership filtering; 401 on everything |
| **Someone who wants the *client's* material** | Systems, individuals, internal identifiers at named clients | **Low probability, highest consequence** | The whole confidentiality model — Private-by-default scrubbing, render-time gating, logs free of content |
| **API-key abuse** | Free model tokens | **Yes, if a key leaks** | Server-side only; secret scanning; billing alert |
| **The author, in error** | — | **Most likely of all** | Every gate in this repo. See below |

**The realistic threat is not an attacker.** In order of probability the three most likely bad
outcomes are:

1. **A secret or a database dump committed to a public repo** — one command, irreversible, done in a
   hurry.
2. **A confidential detail rendered into a document that gets sent to an employer**, because a fact
   was mis-classified once, months earlier.
3. **A fabricated number defended in an interview**, because it was accepted from a model without
   evidence.

Every significant control in this project — scrub-by-default, three-value provenance, render-time
gating, quote verification, gitignored `local/`, content-free logs — exists for those three, not for
a hacker. **They are all operator-error controls.** That is the correct emphasis for this project and
should not drift toward perimeter hardening as the interesting-sounding work.

---

## 5. Least privilege

| Credential | Scope | Could be tighter? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Full account API access | **Yes** — use a workspace-scoped key with its own spend limit, not the default account key |
| `DATABASE_URL` | Owner on one database | **Yes, eventually** — a role restricted to DML on application tables, with DDL reserved for migrations |
| Google OAuth client | `openid email profile` only | Already minimal. **Never request Drive, Gmail or Calendar scopes** — nothing in this product needs them |
| `CLOUDFLARE_API_TOKEN` (CI) | Edit Workers on one zone | **Yes** — scope to the single zone and Workers Scripts:Edit, never a Global API Key |
| GitHub Actions | Read repo, deploy | OIDC where possible; no long-lived personal token |

The two marked "yes" are worth doing when convenient and are not M1 blockers. **The Google scope
line is a blocker** — an over-scoped OAuth client turns a session compromise into a mailbox
compromise.

---

## 6. Audit trail

Sensitive actions are logged with **who, what and when — never the content**.

| Action | Recorded |
|---|---|
| Sign-in, sign-out, **rejected sign-up attempt** | User ID or attempted email, timestamp, IP |
| Fact accepted, rejected, or **promoted out of Private** | Fact ID, old and new values of provenance/disclosure, timestamp |
| Proposal accepted or dismissed | Render kind, version numbers, timestamp |
| Render downloaded | Render kind, version, format, timestamp |
| Import started, finished, failed | Import ID, status, counts |

**Promotion out of Private is the one worth having.** It is the single action that can turn something
unrenderable into something renderable, and if a client identifier ever reaches a document, this is
the record that answers *when did I do that, and what did I think at the time.*

Retention: Cloudflare's default log window. **No log line contains a claim, a quote, source text, or
render content** — asserted by test (`11-testing-plan.md` §2.8).

---

## 7. Incident plan

**Leaked key** → `12-deployment-devops.md` §6. Revoke first, investigate second.

**Suspected data exposure** — the record itself:

1. **Rotate `DATABASE_URL`** and revoke existing Neon roles. Invalidate all sessions by clearing the
   `sessions` table.
2. **Determine scope from the audit trail** — which records, over what window. Neon's point-in-time
   history establishes what existed when.
3. **Assess NDA obligations.** This is the step with no technical component and the largest
   consequence: client material was exposed, the author is contractually bound in respect of it, and
   the question of disclosure to the affected employer is answered by the contract, not by
   engineering judgement. **This step exists in writing precisely so it is not skipped in a panic.**

**Lost access to Cloudflare or Neon:** the record is recoverable from the most recent `GET
/api/export`, which is why S15 is disaster recovery and not just portability.

---

## 8. Compliance

Concretely, and without pretending more applies than does.

**Today — one user, who is the operator, storing their own data.** The APPI and GDPR obligations
that bind a *controller processing others' data* largely do not attach: there is no other data
subject. **The NDA obligations do attach**, and they are contractual rather than regulatory. They
are the reason for every confidentiality control in this repo.

**On the first invited second user, all of the following become real and none are optional:**

| Obligation | Concretely |
|---|---|
| Lawful basis and a privacy policy | What is collected, why, how long, who processes it — **naming Anthropic, Cloudflare and Neon as sub-processors** |
| Right of access | Already satisfied by `GET /api/export` |
| Right of erasure | **Does not exist yet.** Account deletion must actually delete — including source documents and render versions, which this schema otherwise never deletes |
| Data residency | **Record the Neon project's actual region here at provisioning time.** It was not verified when this document was written and must not be assumed. Model calls leave whatever region it is |
| Model-provider retention | **No ZDR arrangement is in place** (declined 2026-08-12 — the data is the author's own). Anthropic's standard API retention therefore applies to extraction and generation requests, which carry NDA-bound client material. **Requesting ZDR is a gate before the second invited user**, when the material stops being the author's to accept risk on |
| Breach notification | Statutory clocks apply. §7 is the procedure |

**The erasure gap is the sharpest one**, and it is a direct tension with `04-database-schema.md` §6,
which says render versions and source document versions are **never deleted**. That rule is correct
for a single-user system of record and **wrong the moment the data belongs to someone else.**
Resolving it is a gate on the second user, not a v1 task — and it is recorded here so it is
discovered now rather than after someone asks to be forgotten.
