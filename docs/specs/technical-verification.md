# Technical Verification Register

**Status:** Phase 4 · opened 2026-08-12 · **round 1 of 2 complete**

Every load-bearing technical claim in `docs/01`–`13`, checked against **primary sources** — vendor
documentation and official library docs, not comparison articles. Several Phase 4 claims came from
search-result summaries; this register is where they get confirmed or corrected.

**Status values:** ✅ verified · ❌ **refuted** (owning document amended) · ⚠️ **partly true**
(amended) · 🔬 needs a spike (no document can settle it) · ⏳ not yet checked

---

## Round 1 — the seven highest-risk claims

### 1 ⚠️ Neon free-tier point-in-time restore — **materially weaker than documented**

**Claim (`12` §4, §5):** a bad migration is recovered by restoring the Neon branch to a point in
time, and "Neon's history window covers the free tier's retention."

**Found:** [Neon plans](https://neon.com/docs/introduction/plans) —

> **Free**: No charge, **6-hour limit**, capped at 1 GB of change history
> Launch: up to 7 days · Scale: up to 30 days

And [Instant restore](https://neon.com/docs/introduction/branch-restore) —

> **Instant restore is only supported for root branches.** Child branches do not support instant
> restore.

**Consequence.** PITR exists on Free, but the window is **six hours**. It covers *"I just ran a bad
migration"*; it does **not** cover *"I noticed on Wednesday that Monday's deploy corrupted
something."* And because dev branches are children of `main`, they have no PITR at all.

**This makes `GET /api/export` (S15) the real backup**, not a portability nicety — which is an
argument for pulling it forward from M3. See the open decision at the end of this document.

**Amended:** `12` §4 and §5.

---

### 2 ✅ Neon HTTP driver — verified, with a design constraint worth stating

**Claim (`03` §1):** `@neondatabase/serverless` in HTTP mode is sufficient.

**Found:** [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) —

> **HTTP**: faster for single, non-interactive transactions … Issuing multiple queries via a single,
> non-interactive transaction is also supported.
> **WebSockets**: if you require session or **interactive transaction** support …

`sql.transaction([...])` takes an array of queries — or a non-async function returning one — with
`isolationLevel`, `readOnly` and `deferrable` options.

**Constraint this imposes, now written into `03`:** every multi-statement write must be expressible
as a **fixed sequence of statements**, not a read-then-decide-then-write loop. The two places this
matters — accepting a proposal (insert version, update `current_version_id`, mark proposal accepted)
and finishing an import — both qualify. **If a future feature genuinely needs an interactive
transaction, the driver changes to WebSockets**, and note that in Workers a WebSocket `Pool`/`Client`
**cannot outlive a single request handler**.

---

### 3 ✅ Better Auth can reject a sign-in before creating a user — **and there is a better hook than assumed**

**Claim (`08` §2):** an identity outside the allowlist is rejected and no `users` row is created.

**Found:** two mechanisms, both official.

`user.validateUserInfo` — purpose-built, and the one to use:

```ts
betterAuth({
  user: {
    validateUserInfo: ({ user, source }) => {
      if (!isAllowed(user.email)) {
        return { error: "email_not_allowed", errorDescription: "..." };
      }
    },
  },
});
```

> Enforce domain or organization validation **before creating a user or linking an account.**

`databaseHooks.user.create.before` — throw an `APIError` to block. Also available:
`disableSignUp` and `disableImplicitSignUp` per social provider.

**`validateUserInfo` is the correct hook** because it fires before *account linking* as well as
before user creation. **Amended:** `08` §2.1 now names it.

---

### 4 ✅ Cloudflare Workflows does not bill while waiting — verified verbatim, **plus a hard constraint we had missed**

**Found:** [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) —

> A Workflow that is waiting on a response to an API call, paused as a result of calling
> `step.sleep`, or otherwise idle, **does not incur CPU time.**

Billed on four dimensions: CPU time, requests, storage, steps. Subrequests from a Workflow incur no
additional request cost.

**And from [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/), three
things not previously recorded:**

| Limit | Free | Paid |
|---|---|---|
| Compute time per step | **10 ms** | 30 s default, configurable to 5 min |
| Wall-clock duration per step | Unlimited | **Unlimited** — waiting on I/O is free |
| **Max non-stream step result** | **1 MiB** | **1 MiB** |
| Instance state / log retention | 3 days | 30 days |

> **The 1 MiB step-result cap is a real design constraint.** A step must not return document text,
> extracted text, or a full render between steps. **Steps pass IDs; each step re-reads what it needs
> from Postgres.** `ReadableStream<Uint8Array>` is the documented escape hatch for larger binary
> output.

**Amended:** `03` §5.

---

### 5 ✅ Anthropic: Citations *is* incompatible with structured outputs — but the scope is narrower than assumed

**Found:** [Citations](https://platform.claude.com/docs/en/build-with-claude/citations) —

> **Citations and structured outputs are incompatible.** … If you enable citations on any
> user-provided document … and also include the **`output_config.format`** parameter … the API
> returns a 400 error.

And [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) —

> **JSON outputs** (`output_config.format`) … **Strict tool use** (`strict: true`) … You can use
> these features **independently or together**.

**The nuance.** The documented incompatibility names `output_config.format` specifically. Our
extraction contract uses **strict tool use**, not JSON outputs — so Citations and our design may in
fact be compatible. **This does not change the decision:** quote anchoring is stronger (it verifies
against a document we already hold rather than trusting a reported offset) and is
provider-portable. Recorded as a 🔬 spike only if we ever want citations as a redundant check.

**Also found, and previously unrecorded:** strict schemas have **complexity limits** — roughly 24
optional parameters combined across all strict schemas in a request, plus internal compiled-grammar
limits and a 180-second compilation timeout, returning `400 "Schema is too complex for
compilation."` Our `propose_fact` schema is small and mostly required, so this is headroom, not a
risk — **provided extraction stays one small strict tool** rather than growing into many.

---

### 5b ⚠️ Zero data retention is **not automatic** — correction to an implied claim

The structured-outputs page is labelled **"ZDR Eligible"**, which is easy to misread as "requests
using structured outputs are zero-retention."

**Found:** [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) —

> Under a ZDR arrangement, Anthropic does not store customer prompts or responses at rest after the
> API response is returned. **To request ZDR for your organization, contact the Anthropic sales
> team.** ZDR is enabled per organization.

So ZDR is an **arrangement you must request**, not a default. **Relevant to this project because the
material sent for extraction is NDA-bound.**

**Also:** Claude Fable 5 and Claude Mythos 5 are **Covered Models** requiring 30-day retention and
**cannot** use ZDR. **`claude-opus-5` is not on that list**, so ZDR remains available for our chosen
model — which is a point in favour of the model already selected.

---

### 6 ✅ Workers CPU and subrequest limits — verified, and more headroom than documented

**Found:** [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) —

| Limit | Free | Paid |
|---|---|---|
| CPU time per invocation | 10 ms | **30 s default, raisable to 5 min** via `limits.cpu_ms` |
| Subrequests per invocation | 50 | **10,000**, raisable to 10 million |
| Subrequests to internal services | 1,000 | matches configured limit |

Confirms the paid plan is required — 10 ms would not survive BudouX segmentation, token diffing or
`.docx` assembly. The 5-minute ceiling means `03` §11's CPU-headroom worry is smaller than feared,
though still 🔬 (a limit being high does not prove our code fits inside it).

---

### 7 ✅ Vitest can run inside the Workers runtime — **and this exposes a gap in the local setup**

**Found:** [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) —
Cloudflare provides a custom pool running tests *inside* the Workers runtime via Miniflare, with
isolated per-test-file storage and access to bindings.

**The gap it exposes.** The application talks to Postgres over **Neon's HTTP protocol**. A plain
Docker Postgres does not speak that protocol, so `12` §8's "Docker Postgres" is **not sufficient on
its own**.

**Found:** Neon documents the fix —

> To use the Neon serverless driver locally, you must run a local instance of Neon's proxy and
> configure it to connect to your local Postgres database.

Either [**Neon Local**](https://neon.com/docs/local/neon-local) (official Docker image, supports both
drivers and ephemeral branches) or the community `local-neon-http-proxy` Compose file.

**Amended:** `11` §1 and `12` §8.

---

## Corrections made to the canonical documents

| Document | Change |
|---|---|
| `03` §1, §5 | Neon HTTP transaction constraint; **1 MiB step-result cap — steps pass IDs, not text**; Workers CPU/subrequest figures |
| `08` §2.1 | Names `user.validateUserInfo` as the allowlist hook |
| `11` §1 | `@cloudflare/vitest-pool-workers`; Docker Postgres **+ Neon proxy** |
| `12` §4, §5 | **6-hour** free-tier restore window; PITR is root-branch only |
| `12` §8 | Neon Local in the local setup |
| `13` §2 | Workflow retention and subrequest limits |

## Still open after round 1

| # | Item | Type |
|---|---|---|
| A | Backups, given a 6-hour restore window | ✅ **Resolved 2026-08-12** — stay free; S15 export promoted to M1 |
| B | `docx` / `docxtemplater` on Workers | 🔬 spike |
| C | `.docx` assembly inside the CPU budget | 🔬 spike |
| D | Citations alongside *strict tool use* (as opposed to JSON outputs) | 🔬 spike, optional |
| E | Whether to request a ZDR arrangement from Anthropic | ✅ **Resolved 2026-08-12** — declined for now; **gated on the second user** |
| F | Round 2 — the remaining ~50 lower-stakes claims across all documents | ⏳ |

---

## Resolved decisions

**A · Backups — option 1.** Stay on Neon's free plan and accept the six-hour window. `GET
/api/export` (S15) is promoted from `SHOULD` · M3 to **`MUST` · M1** and becomes the
disaster-recovery mechanism. Rejected: automating exports off-platform (reintroduces object storage);
Neon Launch for a 7-day window (real monthly cost). **The residual risk is honest and accepted:**
anything older than six hours is recoverable only from the most recent export, so the backup is worth
exactly what the habit of running it is worth.

**E · Zero data retention — declined for now.** The record is the author's own data and the author
accepts the risk. Anthropic's standard API retention therefore applies to requests carrying
NDA-bound client material. **Requesting ZDR is a gate before the second invited user**, when the
material stops being the author's to accept risk on. `claude-opus-5` is ZDR-eligible when wanted;
Fable 5 and Mythos 5 are Covered Models that cannot use it.
