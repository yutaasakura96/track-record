# 07 — API Design

**Status:** Phase 4 · written 2026-08-12
**Trigger:** a real API surface exists — the React SPA talks to a Hono API on the same Worker.

Every endpoint is listed with its milestone. **M1 needs 18 of them**; the rest are marked and are
not built yet. All example data is invented.

---

## 1. Conventions

**Base path** `/api`. **Transport** JSON over HTTPS, `Content-Type: application/json`, except the
one multipart upload and the two file downloads.

**Casing.** JSON is `camelCase`. The database is `snake_case`. Drizzle maps between them; no
endpoint leaks a database column name.

**Authentication.** Every route requires a valid Better Auth session **except** `/api/auth/*`.
This is **deny-by-default middleware**, not a per-route opt-in — a new route is protected because it
exists, not because someone remembered. There are no roles and no permission matrix
(`08-auth-and-permissions.md`).

**Ownership.** Every query filters by the session's `userId`. A record belonging to another user
returns **404, never 403** — a 403 confirms the record exists, which is an information leak.

**Dates.** Calendar fields are `YYYY-MM-01` strings; the day is always `01` and is never displayed
(`04-database-schema.md` §0). Timestamps are ISO-8601 UTC.

**Long operations.** Import and generation return **`202 Accepted`** with a resource to poll.
The client polls the resource every **1.5 s** while its status is non-terminal. Server-Sent Events
were considered and rejected for v1: polling a single-user app costs nothing and has no reconnection
semantics to get wrong.

**Listing.** Collections return `{ "items": [...] }`. Only `GET /api/facts` paginates, with an
opaque cursor: `{ "items": [...], "nextCursor": "..." | null }`. Everything else is bounded by the
size of one person's career and returns in full.

**Idempotency.** `accept`, `reject`, `dismiss` and `undo` are idempotent — repeating one returns
`200` with the same resulting state, never an error. This matters because they are one-click actions
on a screen where a double-click is likely.

---

## 2. The error format

One shape, everywhere:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Date of birth is required to generate a 履歴書.",
    "details": { "fields": ["dateOfBirth"] }
  }
}
```

`message` is shown to the author verbatim, so it is written for a human. `code` is what the client
switches on. `details` is optional and shape-varies by code.

| Code | Status | Meaning |
|---|---|---|
| `unauthenticated` | 401 | No valid session |
| `not_found` | 404 | Does not exist, **or** belongs to another user |
| `validation_failed` | 422 | Zod rejected the body. `details.fields` names the offenders |
| `conflict` | 409 | The action contradicts current state — deleting an employer with facts, accepting an already-decided proposal |
| `precondition_failed` | 428 | The action is legal but blocked by missing data — 履歴書 with no date of birth. `details.fields` names what is missing |
| `upstream_unavailable` | 503 | Anthropic or Neon is unreachable. **Always retryable, and nothing was mutated** |
| `internal` | 500 | Unhandled. Logged with an ID that is returned in `message` |

**No error body ever contains source text, a fact claim, or render content** — that would put record
content into client logs and browser history (`03-technical-design.md` §7).

---

## 3. Auth · M1

Mounted by Better Auth; not hand-written.

| Method | Path | Purpose |
|---|---|---|
| `*` | `/api/auth/*` | Better Auth handler — Google OIDC start, callback, sign-out |
| `GET` | `/api/auth/session` | Current session, or `401` |

**Sign-up is allowlisted.** A Google identity outside the allowlist completes OIDC and is then
rejected with `403 forbidden` — the only 403 in the API.

---

## 4. Record · profile and entities

| Method | Path | M | Notes |
|---|---|---|---|
| `GET` | `/api/profile` | M1 | `404` when no profile exists — the client redirects to the profile form (PRD §7) |
| `PUT` | `/api/profile` | M1 | Full replace. Creates on first call |
| `GET` | `/api/employers` | M1 | Reverse chronological |
| `POST` | `/api/employers` | M1 | |
| `PATCH` | `/api/employers/:id` | M1 | |
| `DELETE` | `/api/employers/:id` | M2 | `409 conflict` when facts, roles or projects reference it |
| `GET` `POST` `PATCH` `DELETE` | `/api/roles[/:id]` | M2 | `employerId` required |
| `GET` `POST` `PATCH` | `/api/projects[/:id]` | M1 | `employerId` **nullable** — independent projects |
| `GET` `POST` `PATCH` `DELETE` | `/api/educations[/:id]` | M2 | |
| `GET` `POST` `PATCH` `DELETE` | `/api/certifications[/:id]` | M2 | |

**`GET /api/profile` → 200**

```json
{
  "id": "prf_9Xk2",
  "familyNameKanji": "青木", "givenNameKanji": "陽介",
  "familyNameKana": "あおき", "givenNameKana": "ようすけ",
  "nameLatin": "Yosuke Aoki",
  "dateOfBirth": "1994-11-01",
  "gender": null,
  "phone": "080-0000-0000",
  "email": "yosuke@example.invalid",
  "postalCode": "150-0001",
  "address": "東京都渋谷区神宮前0-0-0",
  "addressKana": "とうきょうと しぶやく じんぐうまえ",
  "contactSameAsAddress": true,
  "hasPhoto": true
}
```

> **`photo` is never inlined.** The response reports `hasPhoto`; the image is fetched from
> `GET /api/profile/photo`. Base64 in a JSON body would put the author's face in every cache and
> log of that response.

**`POST /api/employers` → 201**

```json
{
  "nameJa": "株式会社アオゾラ物流",
  "nameLatin": "Aozora Logistics K.K.",
  "industryJa": "運輸業",
  "businessDescription": "中堅の国内向け物流事業者。",
  "capitalYen": 50000000,
  "headcount": 320,
  "employmentType": "full_time",
  "startedOn": "2022-04-01",
  "endedOn": "2024-09-01",
  "leavingReasonJa": "一身上の都合により"
}
```

**`capitalYen` is yen, not 万円.** Formatting happens at render time.

**`DELETE /api/employers/:id` → 409**

```json
{
  "error": {
    "code": "conflict",
    "message": "This employer has 14 facts, 2 roles and 3 projects attached. Reassign them before deleting.",
    "details": { "facts": 14, "roles": 2, "projects": 3 }
  }
}
```

Facts are never silently orphaned (PRD §8).

---

## 5. Imports · M1

**`POST /api/imports` — `multipart/form-data`** · fields: `file`, `projectId` (optional),
`sourceDocumentId` (optional — supplying it makes this a **re-import**, a new version of an existing
document). → **`202 Accepted`**

```json
{
  "importId": "imp_4Tz8",
  "sourceDocumentId": "doc_Ln3",
  "versionNo": 2,
  "status": "queued",
  "isReimport": true
}
```

Rejected before any work starts: unsupported type (`422`), or over the size limit (`422`).
Accepted types: `.docx`, `.pdf`, `.md`, `.txt`.

**`GET /api/imports/:id` → 200** — the polling target. Drives the progress bar and the incremental
appearance of cards in the fact rail.

```json
{
  "importId": "imp_4Tz8",
  "status": "extracting",
  "chunksTotal": 12,
  "chunksDone": 7,
  "candidatesExtracted": 23,
  "candidatesDiscarded": 2,
  "wordCount": 6142,
  "changedRegionShare": 0.15,
  "error": null
}
```

- `status` ∈ `queued` · `extracting` · `ready` · `failed`
- **`candidatesDiscarded`** counts candidates whose `quote` was not found verbatim in the source.
  Reported as a number and never as content — the author sees that the guard fired, not what it
  caught.
- **`changedRegionShare`** is the fraction of the document that changed since the previous version;
  `null` on a first import. This is what makes a re-import cheap (`03-technical-design.md` §5).

**Failure → 200 with `status: "failed"`** — *not* an HTTP error. The import resource exists and is
retained.

```json
{
  "status": "failed",
  "error": {
    "code": "no_facts_extracted",
    "message": "No facts could be extracted from this document."
  }
}
```

PRD §7 requires this be reported as a **failure of extraction with the document retained**, never as
an empty success.

| Method | Path | M | Notes |
|---|---|---|---|
| `POST` | `/api/imports/:id/retry` | M1 | Re-runs from the first failed step. The document is not re-uploaded |
| `POST` | `/api/imports/:id/finish` | M1 | Ends the review. Backs both `Finish review` (header) and `Add N facts to record` (footer) — **one action, two affordances** |
| `GET` | `/api/imports` | M2 | The import list screen |
| `GET` | `/api/source-documents/:id/versions/:n/text` | M1 | The source pane. Plain text with stable line numbering — **the only endpoint that returns source content, and it is never used by generation** |

---

## 6. Facts · M1

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/facts` | Filters: `importId`, `status`, `employerId`, `projectId`. Paginated |
| `PATCH` | `/api/facts/:id` | Edit `claim`, `provenance`, `disclosure`. Commits on blur in the UI |
| `POST` | `/api/facts/:id/accept` | |
| `POST` | `/api/facts/:id/reject` | |
| `POST` | `/api/facts/:id/undo` | Returns the fact to `candidate` |

**`GET /api/facts?importId=imp_4Tz8` → 200**

```json
{
  "items": [
    {
      "id": "fct_M4x8",
      "claim": "Reduced nightly batch runtime from 6 hours to 90 minutes",
      "provenance": "measured",
      "disclosure": "public",
      "status": "candidate",
      "evidence": {
        "sourceDocumentVersionId": "sdv_7Yh1",
        "lineNumber": 79,
        "quoteStart": 4820,
        "quoteEnd": 4849
      },
      "technologies": ["PostgreSQL", "Airflow", "Python"],
      "isClientIdentifying": false
    },
    {
      "id": "fct_Z0b2",
      "claim": "Improved system performance by approximately 30%",
      "provenance": "generated",
      "disclosure": "public",
      "status": "candidate",
      "evidence": null,
      "technologies": [],
      "isClientIdentifying": false
    }
  ],
  "nextCursor": null
}
```

- **`evidence` is `null` for Generated facts** with no verbatim support. The card renders the dashed
  amber treatment and the promotion warning from it.
- **No confidence score is returned.** Not omitted from the UI — **not present in the API**, so it
  cannot be rendered by accident (decision log, 2026-08-12).
- **`quote` text is not returned.** The client already has the source text and the offsets, so
  sending the quote again would duplicate record content into another response.

**`POST /api/facts/:id/accept` → 200.** Accepting a **Generated** fact **succeeds** — it is accepted, flagged, and is excluded at render time. The block lives at render time, not review time.

**`PATCH /api/facts/:id` → 422** when a `measured` provenance is set on a fact with no evidence:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "A Measured fact needs a passage in the source that proves it.",
    "details": { "fields": ["provenance"] }
  }
}
```

---

## 7. Renders · M1 for the English résumé

| Method | Path | M | Notes |
|---|---|---|---|
| `GET` | `/api/renders` | M1 | All five, with status. Backs the overview's Documents section |
| `POST` | `/api/renders/:kind/generate` | M1 | → `202` + `proposalId` |
| `GET` | `/api/proposals/:id` | M1 | Poll target, then the proposal itself |
| `GET` | `/api/proposals/:id/diff` | M1 | The split view. **Computed server-side** |
| `POST` | `/api/proposals/:id/accept` | M1 | → new version |
| `POST` | `/api/proposals/:id/dismiss` | M1 | Retained as dismissed; the stored version is byte-identical |
| `GET` | `/api/renders/:kind/download` | M1 | `?format=docx\|md&versionId=` — **assembled on demand, never stored** |
| `GET` | `/api/renders/:kind/versions` | M2 | Accepted versions **and** dismissed proposals, visibly distinct |
| `POST` | `/api/renders/:kind/versions/:id/restore` | M2 | Creates a **new** version; history is never erased |

`:kind` ∈ `english_resume` · `rirekisho` · `shokumu_keirekisho` · `career_story_en` ·
`career_story_ja`.

**`GET /api/renders` → 200**

```json
{
  "items": [
    { "kind": "english_resume", "language": "en", "currentVersionNo": 4,
      "generatedAt": "2026-08-09T02:11:00Z", "status": "stale", "newFactsSince": 3,
      "pendingProposalId": null },
    { "kind": "rirekisho", "language": "ja", "currentVersionNo": null,
      "generatedAt": null, "status": "never_generated", "newFactsSince": null,
      "pendingProposalId": null }
  ]
}
```

`status` ∈ `never_generated` · `up_to_date` · `stale` · `proposal_pending`.
**`never_generated` is distinct from `up_to_date`** (PRD §7).

**`POST /api/renders/rirekisho/generate` → 428** when the profile is incomplete:

```json
{
  "error": {
    "code": "precondition_failed",
    "message": "A 履歴書 cannot be generated without a date of birth and a current address.",
    "details": { "fields": ["dateOfBirth", "address", "addressKana"] }
  }
}
```

Generation is **blocked**, and the missing fields are **named** (PRD §8). An unexplained employment
gap by contrast produces a **warning** on the resulting proposal, not a block.

**`GET /api/proposals/:id` → 200**

```json
{
  "id": "prp_2Wq5",
  "renderKind": "english_resume",
  "status": "pending",
  "basedOnVersionNo": 4,
  "proposedVersionNo": 5,
  "generatedAt": "2026-08-12T09:40:00Z",
  "reason": "Regenerated after 3 new facts entered your record",
  "warnings": [],
  "withheld": { "privateFactCount": 6 }
}
```

**`withheld.privateFactCount` is a count and nothing else.** The footer states that something was
withheld, never what.

**`GET /api/proposals/:id/diff` → 200** — the exact structure the split view renders. Two passes
have already run server-side: paragraphs aligned, then tokens diffed
(`03-technical-design.md` §6.1).

```json
{
  "additions": 4,
  "removals": 1,
  "changes": [
    {
      "changeId": "chg_1",
      "sectionKey": "experience",
      "currentBlockId": "blk_88",
      "proposedBlockId": "blk_91",
      "tokens": [
        { "op": "equal", "text": "Reduced nightly batch runtime from " },
        { "op": "remove", "text": "6 hours to 3 hours" },
        { "op": "add", "text": "6 hours to 90 minutes" }
      ],
      "rationale": {
        "kind": "from_facts",
        "text": "From 1 measured fact · aozora-batch.md, L79",
        "factIds": ["fct_M4x8"]
      }
    },
    {
      "changeId": "chg_2",
      "sectionKey": "experience",
      "currentBlockId": "blk_90",
      "proposedBlockId": null,
      "tokens": [{ "op": "remove", "text": "Improved system performance by ~30%" }],
      "rationale": {
        "kind": "removed_unverified",
        "text": "Removed — the supporting fact is unverified (Generated) and is never rendered",
        "factIds": ["fct_Z0b2"]
      }
    }
  ]
}
```

- `op` ∈ `equal` · `add` · `remove`. For Japanese renders, each token is a **BudouX phrase**; for
  English, a word or punctuation run.
- `rationale.kind` ∈ `from_facts` · `removed_no_support` · `removed_unverified` ·
  `from_restricted`.
- **A change with no `rationale` is a defect**, not a tolerable gap
  (`10-screen-specifications.md`).

**`POST /api/proposals/:id/accept` → 200.** All-or-nothing; there is **no per-change accept
endpoint**, deliberately (decision log, 2026-08-12).

```json
{ "renderKind": "english_resume", "newVersionNo": 5, "acceptedAt": "2026-08-12T09:52:00Z" }
```

Accepting an already-decided proposal → `409 conflict`.

**`GET /api/renders/english_resume/download?format=docx` → 200** ·
`Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` ·
`Content-Disposition: attachment; filename="resume-2026-08-12.docx"`.
Assembled from stored `RenderContent` on each request. Failure → `500` with `code: "render_failed"`;
**the stored version is untouched.**

---

## 8. Overview · M1

**`GET /api/overview` → 200** — one request backs the whole home screen.

```json
{
  "lastImportAt": "2026-08-12T08:02:00Z",
  "activeImport": null,
  "tiles": {
    "employers": { "count": 4, "note": "2 current, 2 past" },
    "roles":     { "count": 6, "note": null },
    "projects":  { "count": 9, "note": "4 with measured outcomes" },
    "credentials": { "count": 12, "note": "1 expires Mar 2027" }
  },
  "factsByProvenance": { "measured": 41, "attested": 66, "generated": 7 },
  "isEmpty": false
}
```

`tiles.credentials` sums `educations` and `certifications` — the split is storage, not interface.
`factsByProvenance.generated` being non-zero is what turns the overview's Generated row amber with
its `Review N →` action.

---

## 9. Later milestones

| Method | Path | M | Notes |
|---|---|---|---|
| `GET` `PUT` | `/api/skills/curation` | M2 | Derived candidates from `facts.technologies` ∪ `certifications.technologies`; author selects and orders. Stale skills flagged, never removed |
| `GET` `PUT` | `/api/render-inclusions` | M2 | Per-render inclusion. 履歴書 defaults to everything |
| `POST` | `/api/capture` | M3 | Free text in, a short interrogation, **Attested** facts out |
| `GET` | `/api/export` | M3 | Whole record as JSON — every entity, provenance, disclosure and evidence pointer (S15) |

---

## 10. What has no endpoint, deliberately

| Not built | Why |
|---|---|
| Per-change accept on a proposal | Accepting 9 of 11 changes leaves the document not matching the record — the exact drift this project exists to remove |
| Bulk promotion out of Private | PRD §5: promotion is never bulk and never silent |
| Any endpoint returning a source document as a file | Source documents never render, export, or appear in any output (PRD §6.1) |
| A confidence score on a fact | Not in the API at all, so it cannot leak into the UI |
| User, role or sharing management | One user, no roles, no sharing |
