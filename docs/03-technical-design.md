# 03 — Technical Design & Architecture

**Status:** Phase 4 · written 2026-08-12
**Source of truth for:** stack, runtime topology, the model seam, the pipelines, the security baseline.
**Companions:** `04-database-schema.md` (data), `07-api-design.md` (endpoints), `13-infrastructure-security.md` (defence in depth).
Every decision below has a matching entry in `06-decision-log.md` explaining what was rejected and why.

---

## 1. The stack

| Layer | Choice | One-line reason |
|---|---|---|
| Runtime | **Cloudflare Workers** (paid, $5/mo) | Flat cost forever; Workflows solves the import pipeline |
| API | **Hono** | Native to Workers, no adapter layer |
| Client | **React + Vite**, served as Workers static assets | Three screens, no public surface, nothing to server-render |
| Styling | **Tailwind v4** — `@theme` generated from `05-design-system.md` | In v4 tokens *are* utilities, so the design system stays the single source |
| Components | **shadcn/ui**, selectively, restyled to doc 05 on add | Copied into the repo and owned, not a runtime dependency |
| Client server-state | **TanStack Query** | Caching, refetch, mutation lifecycle |
| Client UI-state | **Zustand** | Selection, filters, highlighted change — never server data |
| Database | **Neon Postgres** (free tier) | Scale-to-zero, branching, no forced unpause |
| ORM | **Drizzle** | Readable SQL migrations; schema file mirrors doc 04 |
| Auth | **Better Auth** + Google OIDC | Supplies the `user` table PRD §1 requires |
| Long-running work | **Cloudflare Workflows** | Billed only while executing; waiting on the model is free |
| Model | **Anthropic `claude-opus-5`** | Behind a two-function seam |
| Japanese segmentation | **BudouX** | 文節-scale phrases, ~15 KB, no dictionary |
| Diffing | **jsdiff `diffArrays`** | Myers, at token granularity |
| `.docx` | **`docx`** (résumé, 職務経歴書) · **`docxtemplater`** (履歴書) | Documents are built; forms are filled |

**Not used, deliberately:** object storage (the whole corpus is ~2.4 MB), a staging environment,
a vector database, Next.js, Cloudflare Access, any hyperscaler.

---

## 2. Architecture

```
                    ┌──────────────────────────────┐
   Browser ───────► │  Cloudflare Worker            │
   (React SPA)      │  ├── static assets (the SPA)  │
                    │  ├── Hono API                 │
                    │  │    └── Better Auth routes  │
                    │  └── Workflow bindings        │
                    └───────┬───────────┬───────────┘
                            │           │
                 ┌──────────▼──┐   ┌────▼─────────────────┐
                 │ Neon        │   │ Cloudflare Workflows │
                 │ Postgres    │   │  import pipeline     │
                 │ (HTTP)      │   │  render pipeline     │
                 └─────────────┘   └────┬─────────────────┘
                            ▲           │
                            └───────────┤
                                        ▼
                              ┌──────────────────┐
                              │ Anthropic API    │
                              │ claude-opus-5    │
                              └──────────────────┘
                        Google OIDC ──► Better Auth (sign-in only)
```

**Deployable units: one.** A single Worker carries the SPA, the API and the Workflow definitions.
There are no servers, no containers, no cron jobs, and nothing stateful outside Neon.

**Third-party dependencies and what happens when each is down:**

| Service | If it is down |
|---|---|
| **Neon** | The app is unusable. Read paths fail with a stated reason; no data is lost. Acceptable — this is a personal tool, not a service with an SLA |
| **Anthropic** | Import and generation fail with a retryable error. **Stored records and stored render versions are untouched and remain readable.** Everything except creating new content still works |
| **Google OIDC** | Existing sessions continue. New sign-ins fail |
| **Cloudflare** | Everything is down. No mitigation is planned or warranted |

---

## 3. Repository layout

```
/
├── CLAUDE.md
├── CONTEXT.md                  # domain glossary (lazily created)
├── docs/                       # 01–13, adr/, agents/, specs/
├── design/prototype/           # visual reference only
├── local/                      # gitignored — the author's real documents
├── templates/
│   └── rirekisho.blank.docx    # 履歴書 grid, every value stripped
├── src/
│   ├── client/                 # React SPA
│   │   ├── screens/            # fact-review, diff-review, overview
│   │   ├── components/
│   │   ├── components/ui/      # shadcn — owned, restyled to doc 05
│   │   ├── stores/             # Zustand — UI state only
│   │   └── theme.css           # @theme — generated from 05-design-system.md
│   ├── server/
│   │   ├── index.ts            # Hono app, deny-by-default middleware
│   │   ├── routes/
│   │   ├── auth.ts             # Better Auth config
│   │   └── db/                 # Drizzle schema + migrations
│   ├── model/                  # THE SEAM — the only code that knows a model exists
│   │   ├── extract.ts
│   │   ├── generate.ts
│   │   └── providers/anthropic.ts
│   ├── pipeline/               # Workflow definitions
│   ├── render/                 # docx builders, markdown builder
│   ├── diff/                   # paragraph alignment + token diff
│   └── segment/                # BudouX wrapper
├── tests/
└── wrangler.toml
```

---

## 4. The model seam

The application touches a model in **exactly two places**. Nothing outside `src/model/` imports an
SDK or knows a provider name.

```ts
extractFacts(sourceText: string, ctx: ExtractionContext): Promise<CandidateFact[]>
generateRender(facts: Fact[], spec: RenderSpec): Promise<RenderContent>
```

Swapping providers is a config value plus one adapter file. This is what makes the M2 bake-off
(Opus 5 vs Kimi K3 vs GPT-5.6 Terra) cheap enough to actually run.

### 4.1 Extraction contract — quote anchoring

The extractor is a **strict-schema tool call**. The model calls `propose_fact` once per candidate.
One required field is `quote`: the **verbatim** span from the source that supports the claim.

The application then locates that quote in the stored source text **by exact string match** to
derive its character offset and line number. **If the quote is not found verbatim, the candidate is
discarded before the author ever sees it.**

This inverts the trust relationship. The app does not trust a model-reported offset; it requires a
string that must already exist in a document it holds, and checks. PRD §8's *"the model invents a
plausible fact absent from the source"* becomes mechanically impossible for Measured facts rather
than merely contained by the Generated default.

> **Why not the Citations API.** Anthropic's Citations feature returns `cited_text` with exact
> character offsets and would be the natural fit — but it is documented as **incompatible with
> structured outputs** (a 400 error). Extraction needs a strict schema. Quote anchoring is
> stronger anyway, and is provider-portable.

Every candidate arrives with provenance **Generated** and disclosure set by the scrub rules (§7).
Promotion is always a deliberate act by the author.

### 4.2 Generation contract

`generateRender` returns **structured content**, never a file and never a prose blob:

```ts
type RenderContent = {
  sections: { key: string; heading: string; blocks: Block[] }[]
}
type Block = { kind: 'paragraph' | 'bullet' | 'row'; text: string; factIds: string[] }
```

`factIds` is what makes S6 traceability and the diff screen's rationale bar possible. A block with
no `factIds` is legal only for headings and for the fixed scaffolding of 履歴書.

**Facts are sent plainly; register is applied by the spec.** The same fact renders as an
action-verb bullet in the English résumé and in the flat factual voice 職務経歴書 expects. That is
a prompt difference, not a data difference.

**Never sent to the model:** source documents during *generation* (only during extraction), and any
fact whose disclosure is **Private**. Private facts are filtered before the request is built, not
after the response returns.

---

## 5. The import pipeline

Runs as a Cloudflare Workflow. Each numbered step is a durable checkpoint: a redeploy or a crash
resumes rather than restarts, and a failed step retries without redoing the others.

```
1. Store upload            → source_document + source_document_version (full text retained)
2. Extract text            → plain text, stamped with `extractor_version` (§5.1)
3. Diff against previous   → if a prior version exists, compute changed + added passages
                             (unchanged passages are NEVER re-sent to the model)
4. Chunk changed regions   → chunks sized for progress reporting, not for context limits
5. For each chunk          → extractFacts()  ── retried independently
6. Verify quotes           → exact string match into stored text; unmatched candidates discarded
7. Scrub                   → shape-based Private defaults (§7)
8. Deduplicate             → drop candidates whose (quote, claim) hash matches an already-judged fact
9. Persist candidates      → progress becomes visible in the fact rail as each chunk lands
```

**Step 3 is the answer to PRD §8's re-import row** — all three clauses at once. Accepted facts are
not duplicated, only genuinely new content is proposed, and rejected facts stay rejected, without
the app ever reasoning about fact identity. A 15%-changed document costs roughly 15% of a fresh
extraction.

**Zero facts extracted is a failure, not an empty success** (PRD §7). The document is retained and
the author can retry or capture manually.

### 5.1 Turning an uploaded file into text

| Format | How | Milestone |
|---|---|---|
| `.md`, `.txt` | `await file.text()` — **no library** | **M1** |
| `.docx` | Unzip with `fflate`, read `word/document.xml`, walk `w:p` elements into paragraphs. ~50 lines, no Node dependencies | M2 |
| `.pdf` | **Deferred, possibly permanently.** `unpdf` if ever needed | — |

**M1 needs `.md` and `.txt` only.** The author's case studies are Markdown, produced by a standing
prompt inside each work repository. Supporting four formats in M1 would mean carrying three Workers
compatibility risks for a document type M1 never sees.

**`.docx` is parsed directly rather than through `mammoth`.** The decisive reason is not dependency
weight: parsing OOXML ourselves means **we control paragraph boundaries**, and paragraph boundaries
are what line numbering is built on. A library that changes its paragraph handling in a minor
release would silently move every line number in the record. This approach was verified against the
author's real 履歴書 and 職務経歴書 during Phase 4.

> ### The rule that prevents a silent corruption bug
>
> **Fact quote offsets index into `extracted_text`.** If the extractor ever changes how it emits
> paragraphs or whitespace, every stored offset points somewhere subtly wrong — and nothing surfaces
> the problem, because the offsets still resolve to *some* text.
>
> Therefore: `source_document_versions.extractor_version` is stored alongside the text, and
> **an existing version is never re-extracted in place.** A parser upgrade produces a **new**
> document version with fresh offsets; the old version keeps the text its facts were verified
> against. This is not optional and it is asserted by test.

---

## 6. The render pipeline

```
generate → RenderContent → stored as a PROPOSAL (never as the current version)
         → diff(current, proposed) → split-view review
         → accept  → new version, dated, retained forever
         → reject  → dismissed proposal, retained but NOT in version history
```

Accept is **all-or-nothing** (decision log, 2026-08-12). `.docx` is assembled from the stored
`RenderContent` **on download**, never stored. Markdown is generated from the same structure for
on-screen reading.

### 6.1 The diff engine

Two passes, because one pass is unreadable:

1. **Align paragraphs** between the current and proposed versions by similarity, not by position.
   Unmatched blocks are genuine additions or removals. Without this, a single inserted sentence
   shifts everything after it and the whole document reads as changed.
2. **Diff tokens inside each matched pair** using jsdiff `diffArrays` — Myers, the same algorithm
   git uses, at word granularity instead of line granularity.

**Tokens:** words and punctuation for English; **BudouX phrases** for Japanese.

Verified end to end on the author's real 職務経歴書 prose:

```
ベンダー依存の既存システムを[+イベント駆動型の]内製プラットフォームへ置き換える
DX推進に従事し、レイテンシを[-40%削減しました。][+55%削減しました。]
```

Marks land on phrase spans. A changed figure is one phrase replaced, not a scatter of characters.

**Every change must carry a rationale** (`10-screen-specifications.md`): the `factIds` on each block
resolve to the facts and source passages behind it. A change with no explanation is a defect.

---

## 7. Confidentiality enforcement points

Confidentiality is enforced in **four** places, deliberately redundantly.

| # | Point | Rule |
|---|---|---|
| 1 | **Ingestion scrub** | GUIDs, IP addresses, email addresses, employee numbers and personal names other than the author's are marked **Private** by default, without asking |
| 2 | **Generation input** | Private facts are filtered out **before the request is built**. They never leave the database |
| 3 | **Render output** | Generated-provenance facts are excluded at render time. A Generated fact may be *accepted* into the record; the block lives here |
| 4 | **Logs** | **Server logs never contain source text, fact claims, or render content.** Log IDs and counts only |

Point 4 exists because logs are otherwise a second, un-governed copy of NDA-bound client material
sitting in Cloudflare's log retention.

**Source documents never render, export, or appear in any output** (PRD §6.1). They exist to prove
facts.

**The author's own PII** — home address, phone, date of birth — is a **per-render field rule**, not
a disclosure tier. It populates 履歴書 and appears in no other render. This is enforced in the
render spec, not by fact disclosure.

---

## 8. Security baseline

**Secrets.** `ANTHROPIC_API_KEY`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` live in Cloudflare Workers secrets (`wrangler secret put`). Locally they
live in `.dev.vars`, gitignored. **Never in the repo — it is public.** No database dump is ever
committed.

**Input validation.** Every request body is parsed with a Zod schema at the route boundary, server
side. Client-side validation exists for ergonomics only and is never trusted. File uploads are
checked for type and size before storage.

**Transport.** HTTPS everywhere, enforced by Cloudflare. No local-only HTTP surface is exposed.

**Sensitive data.** The record holds the author's PII and NDA-bound client material. Neon encrypts
at rest. Nothing sensitive is placed in URLs, query strings, or logs.

**Authorisation.** Deny-by-default: Hono middleware requires a valid session on **every** route
except the auth callbacks. A forgotten route fails closed. **Every query filters by `user_id`**, and
that filtering is asserted by test — not by convention.

**Sign-up is allowlisted** to the author's Google account, though the app is publicly reachable.

**Dependencies.** Renovate, weekly, grouped, auto-merging patch updates for dev dependencies only.

**The worst thing an attacker could do,** and what stops it:

> **Read the record** — obtaining the author's home address and date of birth, and NDA-bound client
> material naming systems and individuals at client companies. That is a career-level and possibly
> contractual harm, and it is the reason the confidentiality model exists.
>
> Stopped by: Google OIDC with an allowlist of one; deny-by-default routing asserted by test;
> `user_id` filtering asserted by test; secrets outside the repo; and logs that never contain
> record content. The most likely real-world failure is not an attacker — it is a **committed
> secret or a committed data dump in a public repo**, which is why that is called out twice.

---

## 9. Error handling

**The governing rule: a failure never destroys or mutates a stored version.**

| Failure | What the author sees | What is logged |
|---|---|---|
| Model unavailable / unusable response | Stated reason + retry. Current version untouched and readable | Provider, status, workflow step, chunk index. **No content** |
| Import extracts zero facts | Reported as an extraction *failure*, document retained. Retry or capture manually | Document ID, byte size, chunk count |
| Quote verification rejects a candidate | Nothing — silently discarded | Count only, per import |
| `.docx` fails to build | Download fails with a reason; stored content untouched | Render ID, builder, error |
| Database unavailable | Stated reason. No optimistic writes | Standard |
| 履歴書 missing a required field | **Generation blocked**, missing fields named | Field names |
| Employment gap detected | Warning, not a block | — |

PRD §8 rates a `.docx` that will not open in Word as **as severe as data loss**. It is treated as a
release blocker, and verified manually because no automated test can judge it.

---

## 10. The three hardest technical problems

**1 · Japanese word-level diffing — SOLVED, verified.**
Japanese has no inter-word spaces, so character diffs are unreadable and word diffs need a
segmenter. `Intl.Segmenter` over-splits unusably (`そごう` → `そご`/`う`). **BudouX** segments at
文節 scale in ~15 KB with no dictionary, and jsdiff over its tokens produces phrase-level marks.
Verified against 62 paragraphs of the author's real 職務経歴書. Residual risk: an occasional
`〜に|よる` over-split, cosmetic only.

**2 · Does a structured fact layer carry enough nuance?** — the brief's single riskiest assumption,
and not a solvable engineering problem. It is *tested*, by M1, by comparing the generated English
résumé against the hand-produced one. The mitigations built in: facts are stored plainly with
impact framing applied at render time, so one fact can render in two registers; and `RenderContent`
carries `factIds` so a weak bullet is traceable to a weak fact. **If the generated résumé is worse,
the fix is a richer fact model, not more renders.**

**3 · 履歴書 conventional correctness.** A rigid grid where an error is invisible to the author and
obvious to a Japanese hiring manager. Addressed by *filling a template rather than rebuilding the
grid*, by the field contract extracted from the real document (see `04-database-schema.md` §履歴書),
by blocking generation on missing fields, and by warning on unexplained gaps. M2.

---

## 11. Open problems and known unknowns

| # | Item | Status |
|---|---|---|
| 1 | **Cross-document numeric conflicts** — PRD §8 requires two documents asserting different numbers for the same thing to be surfaced. Needs a notion of "the same thing" across documents | **Deferred to M2.** Impossible in M1 (one document, one employer). Not half-solved now |
| 2 | **`docx` / `docxtemplater` on Workers** — neither verified on a constrained runtime; both assume Node | **Spike before M2**, ~1 hour. Fallbacks: build in the browser, or move that step to a Node-compatible runtime. Does not block M1 |
| 3 | **Workers CPU budget for `.docx` assembly and long diffs** — paid plan gives 30s CPU per request, ample on paper, unmeasured in practice | Measure during M1 |
| 4 | **Paragraph-alignment quality** on heavily restructured renders | Tune the similarity threshold against real proposals |
| 5 | **Japanese generation quality by provider** | The M2 bake-off. Ground truth already exists in `local/JAPANESE/` |

---

## 12. Deferred work register

Everything deliberately postponed, in one place, each with **the trigger that unblocks it** rather
than a vague "later". Scattered deferrals get forgotten; a register gets read.

### Deferred to M2

| # | Item | Trigger / note |
|---|---|---|
| 1 | **Cross-document numeric conflicts** — two documents asserting different numbers for the same thing | Impossible in M1 (one document, one employer). Needs a notion of "the same thing" across documents |
| 2 | **Provider bake-off** — Opus 5 vs Kimi K3 vs GPT-5.6 Terra on Japanese renders | When 職務経歴書 generation exists. Ground truth is in `local/JAPANESE/` |
| 3 | **Entity extraction / bootstrap flow** (`09` Flow 7) | Before importing the back catalogue in bulk |
| 4 | **Batch import** (`09` Flow 8) | With Flow 7 |
| 5 | **`docx` / `docxtemplater` Workers spike** | ~1 hour, before 履歴書 work starts. **Smaller than first scoped** — file *reading* no longer needs a library (§5.1), so the spike covers writing only |
| 5b | **`.docx` text extraction** via `fflate` + OOXML walk | With the bootstrap flow |
| 6 | **Skills curation** and **per-render inclusion rules** | S9 and S13 |
| 7 | **Version history UI** — accepted versions and dismissed proposals, visibly distinct | S14 |

### Deferred to M3

| # | Item | Trigger / note |
|---|---|---|
| 8 | **Quick capture** — free text in, Attested facts out | S12. The one screen that may justify a narrow mobile surface |
| 9 | **Export the whole record** (`GET /api/export`) | S15. **Also the disaster-recovery plan** (`12` §5) — an argument for pulling it earlier than M3 |

### Gated on the second invited user — build **before** issuing the invite, not after

| # | Item | Why it is a gate |
|---|---|---|
| 10 | **Per-user rate limiting** — limits specified in `13` §3 | Currently absent, and defensible only while the operator is the only account |
| 11 | **A hard per-user spend cap on model calls** | The only uncapped cost in the system. More important than the rate limit: a limit slows an expensive user, a cap stops one |
| 12 | **Account deletion that actually deletes** (`08` §6) | Directly contradicts `04` §6's "never deleted" rule, which is correct for one user and wrong for someone else's data |
| 13 | **Privacy policy, terms, sub-processor disclosure** (Anthropic, Cloudflare, Neon) | Legal obligation once a stranger stores their PII and their employer's material |
| 14 | **Error alerting** | "The author notices" stops working when someone else is affected |
| 15 | **履歴書 and 職務経歴書 become optional renders** | A purely Western career is shown two documents it cannot use |

### Deferred indefinitely, with the fallback named

| # | Item | Fallback if it becomes a problem |
|---|---|---|
| 16 | Rate-limit tuning, alerting thresholds | — |
| 17 | Broader E2E suite beyond the one smoke test | Second smoke path would be 履歴書 generation |
| 18 | Visual regression testing | Manual checklist + agent-driven verification |
| 19 | Object storage for source documents | One-table migration when `bytea` stops being appropriate |
| 19b | **`.pdf` import** | `unpdf` if a document ever exists only as PDF. The author has `.docx` for everything |
| 20 | Hyperdrive in front of Neon | Drop-in, if latency ever matters |
| 21 | Tighter `DATABASE_URL` role (DML only, DDL for migrations) | Worth doing when convenient |

**Nothing in this register is a TODO comment in code.** An item leaves this table when it ships or
when a decision-log entry retires it.

---

## 13. Scope discipline

**M1 needs only:** upload → extract → verify → review → accept facts → generate the **English
résumé** → diff → accept. One document, one employer, `.docx` out.

**Not built for M1:** 履歴書 and its template, 職務経歴書, both career stories, skills curation,
quick capture, version history UI, conflict detection, per-render inclusion rules.

**Not built at all in v1:** multi-user features, LinkedIn, the portfolio site, application tracking,
mobile layouts.

**Desktop only**, minimum 1280px — but built **fluid** (no fixed page widths, panes flex), so the
M3 quick-capture screen can ship narrow without re-laying-out the app.
