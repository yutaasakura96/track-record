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

**There is no health route.** `12-deployment-devops.md` §3 once called for a public
`GET /api/health`. The deploy check reads the commit SHA from the SPA shell at `/` instead, and
asserts that an `/api/*` route answers `401`, so `/api/auth/*` stays the only exception (decision
log, 2026-09-28).

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
| `upstream_unavailable` | 503 | Anthropic or Neon could not complete the call, including exhausted model credits. **Always retryable, and nothing was mutated by that call**. For exhausted credits, `details.reason` is `credits_exhausted` and `message` explains the pause (`12` §9) |
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
| `PUT` | `/api/profile` | M1 | Full replace. Creates on first call. Leaves the photo as it is |
| `GET` | `/api/profile/photo` | #117 | The 履歴書's 写真, its type read from its bytes, `cache-control: private, no-store`. `404` when there is none |
| `PUT` | `/api/profile/photo` | #117 | The raw body is the image, already cropped to 3:4 in the browser; never a form. `200` + the profile. `404` with no profile; `422` (`fields: ["photo"]`) for anything that is not a structurally complete JPEG or PNG (a PNG: signature, IHDR first, an IDAT, valid chunk CRCs, nothing after IEND; a JPEG: SOI, a SOF carrying the size, an SOS, EOI at the end), not 3:4 by its header to within a pixel, under 300 × 400, or over 2 MB however the request counts it. Logged as its type, pixel size and byte count, never its bytes |
| `DELETE` | `/api/profile/photo` | #117 | Takes it off for good. `200` + the profile; removing none is not an error |
| `GET` | `/api/employers` | M1 | Reverse chronological |
| `POST` | `/api/employers` | M1 | |
| `PATCH` | `/api/employers/:id` | M1 | |
| `DELETE` | `/api/employers/:id` | M2 | `409 conflict` when facts, roles, projects or source documents reference it. A fact counts only when its employer was set on it by hand; one reading through its document is counted as the document (`04` §3.12). A delete that succeeds clears the employer's `render_inclusions` rows in the same batch |
| `GET` `POST` `PATCH` `DELETE` | `/api/roles[/:id]` | M2 | `employerId` required |
| `GET` `POST` `PATCH` `DELETE` | `/api/projects[/:id]` | M1 | `employerId` **nullable** — independent projects. `DELETE` answers `409 conflict` when facts or source documents reference it, and names the remedy: `Refile them from Documents before deleting.` (§5). A delete that succeeds clears the project's `render_inclusions` rows in the same batch |
| `GET` `POST` `PATCH` `DELETE` | `/api/educations[/:id]` | M2 | `DELETE` clears the education's `render_inclusions` rows in the same batch |
| `GET` `POST` `PATCH` `DELETE` | `/api/certifications[/:id]` | M2 | `kind` (`technical`, `language`, `other`) required on `POST`; a `PATCH` may omit it but not set it to null (`06`, 2026-10-22) |
| `GET` | `/api/career-timeline` | #113 | What Screen 4 shows beside the rows: `employers[]` `{ id, achievements, unfiled, documents }` counting the accepted facts that resolve to each (`04` §3.12), how many are filed under no project and the documents they came from; `projects[]` `{ id, achievements }`; and `gaps[]` `{ after, before, months }`, the 履歴書's own gap warning over the rows it would print, its exclusions applied. **Ids, counts and months only**, built on the read |

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
  "hasPhoto": true,
  "photoVersion": "3f9c1a7b2e04",
  "resumeHeadline": "Backend Engineer",
  "resumeCity": "Tokyo", "resumeCountry": "Japan",
  "resumePhone": null,
  "resumeLinkedinUrl": "https://linkedin.com/in/example",
  "resumeGithubUrl": null, "resumePortfolioUrl": null
}
```

> **The `resume*` fields are optional**, and blank is stored as `null`. A link needs a literal
> `http://` or `https://` prefix to count as already schemed (case-insensitive); otherwise the API
> supplies `https://`, including for a host with a port. It rejects embedded whitespace, control
> characters, a backslash, credentials before the host (which is also how `mailto:a@example.com` is
> refused) and addresses without a dotted hostname with `422` naming the field. After validation,
> it stores the trimmed text as entered, plus any supplied scheme, without URL serialization. The résumé
> prints the saved link with only `http://` or `https://` removed; `www.`, casing, path and trailing
> slash remain as entered.
> `resumePhone` is the English résumé's own number, never copied from `phone` (`04` §3.2).

> **`photo` is never inlined.** The response reports `hasPhoto`; the image is fetched from
> `GET /api/profile/photo`. Base64 in a JSON body would put the author's face in every cache and
> log of that response. `photoVersion` (null without a photo) changes whenever the photo does, and
> the client puts it on the image's address, so a page draws the new photo rather than a kept one.
> The same rule holds for a 履歴書's page: its sheet marks the 写真 cell `photo: true` and carries
> none of the image.

**`POST /api/employers` → 201**

```json
{
  "nameJa": "株式会社アオゾラ物流",
  "nameLatin": "Aozora Logistics K.K.",
  "industryJa": "運輸業",
  "city": "Yokohama",
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
    "details": { "facts": 14, "roles": 2, "projects": 3, "documents": 0 }
  }
}
```

Facts are never silently orphaned (PRD §8). When a source document is filed under the employer the
message names the control that moves it, as a project's does: `This employer has 1 document
attached. Refile them from Documents before deleting.`

---

## 5. Imports · M1

**`POST /api/imports` — `multipart/form-data`** · fields: `file`, `projectId` (optional),
`employerId` (optional), `sourceDocumentId` (optional — supplying it makes this a **re-import**, a new version of an existing
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

**The version is `queued` and waits its turn: one document is read at a time, per user** (#93,
`03` §5). Several files use one `POST /api/imports/batch` multipart request with repeated `file`
and `filing` fields in listed order. Each `filing` is JSON with optional `projectId` and `employerId`.
The server creates every accepted document and queued version in one transaction before answering
`202 Accepted` with `results` in the same order: each row has an `importId` or a refusal `reason`.
Accepted files read in listed order; one that fails stops none of the others. Each file keeps its
own size limit; a set over 20 MiB together (`MAX_BATCH_BYTES`,
`src/shared/import-file.ts`) is refused by the picker before sending, and by the server as a whole
(`422`) before anything is written. Every file of a set is written in one database request,
which carries hex-encoded `original_bytes` and JSON-encoded `extracted_text`. The server limits their
combined encoded size to 48 MiB per write, below Neon's 64 MB limit on a query over HTTP. A single
file over this budget is refused before storage; in a set, each file that would exceed the running
budget is refused on its own row and can be imported separately. The 95 MB this said before #94 was
Cloudflare's request limit and could not have been stored in one write.

Rejected before any work starts: unsupported type (`422`), over the size limit (`422`), or a file
of a supported type that cannot be read as one — a damaged `.docx`, a PDF that will not open, a PDF
with no text layer (a scan) — each `422` naming its reason. Nothing is stored and no model is called. A
re-import is also refused at **`409 conflict`** while the document's newest version is `queued` or
`extracting`: the diff baseline would still be incomplete. A `failed` newest version does not
refuse, because its text was stored before extraction. A re-import may carry a different filename
or type; the document's `filename` and `mime_type` are not changed.

**`employerId` (optional) · M3, #35.** Files the new document under an employer the session owns;
every fact extracted from it reads its employer through the document (§6, `04` §3.12). An employer
the session does not own answers `404`, as `projectId` does. Like `projectId`, it is offered only
for a new document: a re-import keeps the document's employer, which is changed afterwards through
`PATCH /api/source-documents/:id`. An `employerId` sent with a re-import is checked for ownership
and then ignored, as a `projectId` is.

**Accepted types: `.md`, `.markdown`, `.txt`, `.docx` and `.pdf`** (M1 took the first three; #94
added Word and PDF, decision log 2026-10-16). Each is stored with its real `mime_type` and its own
`extractor_version` (`plaintext-1`, `docx-1`, `pdf-1`); `original_bytes` keeps the file as uploaded.
**Size limits: 2 MiB for Markdown and plain text, 10 MiB for Word and PDF.** A Word or PDF file can
carry images and fonts the import never reads, so a document whose text is a few pages can be several
megabytes; the text is what is read, and the file is what is kept. Any other type — `.doc`, `.rtf`,
`.odt`, `.pages`, HTML, images — is refused with a reason naming the types that work
(`Markdown, plain text, Word and PDF files are supported.`); a `.doc` is also told to be saved as
`.docx`. The picker's `accept`, the copy that names the types and this refusal are built from one
list, `IMPORT_FORMATS` in `src/shared/import-file.ts`.

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
  "candidatesSuppressed": 0,
  "wordCount": 6142,
  "changedRegionShare": 0.15,
  "error": null
}
```

- `status` ∈ `queued` · `extracting` · `ready` · `failed`
- **`candidatesDiscarded`** counts candidates whose `quote` was not found verbatim in the source.
  Reported as a number and never as content — the author sees that the guard fired, not what it
  caught.
- **`candidatesSuppressed`** counts candidates dropped because they repeat a fact already in the
  record (the quote-and-claim hash guard). A count and never content. A `ready` re-import with
  `candidatesExtracted: 0` and `candidatesSuppressed > 0` is a success: everything the changed text
  says, the record already holds.
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
When the model service runs out of credits, the retryable import also has `status: "failed"`, but
`error.code` is `credits_exhausted` and `error.message` explains the pause. Other model failures
use `extraction_failed`.

| Method | Path | M | Notes |
|---|---|---|---|
| `POST` | `/api/imports/:id/retry` | M1 | Re-runs from the first failed step. The document is not re-uploaded. Only a `failed` import is requeued (#93); one waiting or being read is left as it is, and the body is its status |
| `POST` | `/api/imports/:id/finish` | M1 | Ends the review. Backs both `Finish review` (header) and `Add N facts to record` (footer) — **one action, two affordances** |
| `GET` | `/api/imports` | M2 | Screen 8, Documents. Shape below |
| `GET` | `/api/imports/summary` | M2 | The sidebar's badge alone. Shape below. **Registered before `/api/imports/:id`** |
| `PATCH` | `/api/source-documents/:id` | M1 | **Refile.** Body `{ "projectId": "prj_9f2" }`, `{ "employerId": "emp_2Kd9" }`, both, or either as `null`. Shape below |
| `GET` | `/api/source-documents/:id/versions/:n/text` | M1 | The source pane. Plain text with stable line numbering — **the only endpoint that returns source content, and it is never used by generation**. Also carries the document's `filename` and `project` (`{ id, name }` or `null`) for Fact Review's breadcrumb |

**`PATCH /api/source-documents/:id` → 200** — the document's project and its employer are the
**only** things about a source document that change after import. The body carries `projectId`,
`employerId` or both; a field left out is left as it is, and a body with neither is `422`. Each is
nullable: `null` is the answer `No project` or `No employer`, and it is the only way back to
unfiled.

```json
{
  "sourceDocumentId": "doc_Ln3",
  "project": { "id": "prj_9f2", "name": "Harbour lantern" },
  "employer": { "id": "emp_2Kd9", "name": "Aozora Logistics K.K." },
  "facts": 7,
  "employerSetByHand": 2
}
```

`project` and `employer` are where the document is filed after the change, whichever of the two the
body named. An employer's `name` is its Latin name, or its 日本語 name when it has none: the name
Screen 1's employer picker shows.

- **The document and every fact extracted from every one of its versions move together**, in one
  transaction. A fact's project has always been its document's, snapshotted at extraction; this
  keeps that rule true by letting the following happen more than once, not by giving a fact a
  project of its own. `PATCH /api/facts/:id` still takes no `projectId` (§6).
- **`facts` is the number of facts extracted from every version of the document**, all of which a
  `projectId` moves. **`employerSetByHand` is how many of them carry an employer set on their card**,
  which an `employerId` does not move: the other `facts − employerSetByHand` follow it. Counts and
  never a claim, returned whichever field the body named.
- **`employerId` · M3, #35.** It writes one row, the document's. Every fact that reads its employer
  through the document follows it, and a fact whose employer was set by hand, a hand-set
  `No employer` included, stays where it is (`04` §3.12). Nothing is copied onto the facts.
- **`404`** for a document the author does not own, and for a `projectId` or an `employerId` they
  do not own — checked in the same query that reads it, never as a bare foreign-key failure.
- **`409 conflict` while the document's newest version is `queued` or `extracting`, when the body
  carries `projectId`**, in the words `POST /api/imports` refuses a re-import in:
  `Wait for v2 to finish extracting.` A chunk that read the old project before the move and inserted
  its facts after it would leave those facts behind, filed under a project the document is no longer
  under, and nothing would say so. A body carrying only `employerId` is not refused: nothing is
  copied onto a fact, so there is no window for a chunk to fall into.

This is what makes `DELETE /api/projects/:id` (§4) a refusal with a remedy rather than a dead end.

**`GET /api/imports` → 200** — grouped by source document, because re-import acts on a document.
Documents are ordered by their newest `importedAt`, descending; versions newest first.

```json
{
  "openCandidates": 2,
  "documents": [
    {
      "sourceDocumentId": "doc_Ln3",
      "filename": "harbor-notes.md",
      "mimeType": "text/markdown",
      "project": null,
      "employer": { "id": "emp_2Kd9", "name": "Aozora Logistics K.K." },
      "lastImportedAt": "2026-09-15T02:10:00Z",
      "openCandidates": 2,
      "reimportable": true,
      "versions": [
        {
          "importId": "imp_4Tz8",
          "versionNo": 2,
          "importedAt": "2026-09-15T02:10:00Z",
          "status": "ready",
          "wordCount": 6142,
          "changedRegionShare": 0.15,
          "chunksTotal": 3,
          "chunksDone": 3,
          "extractorVersion": "plaintext-1",
          "facts": { "accepted": 12, "rejected": 3, "open": 2 },
          "error": null
        }
      ]
    }
  ]
}
```

- **No source text.** Filenames, counts and the stored `import_error` reason only. The reason is
  never a model response body (`04` §3.6b).
- **`error`** is `null` unless the version is `failed`, and then it is the same object
  `GET /api/imports/:id` returns for that version, `code` and `message` both. One shape across the
  imports resources (§2): a failed version in the listing reads
  `{ "code": "extraction_failed", "message": "…" }`, or `credits_exhausted` for a credit pause,
  never a bare string. Screen 8 shows
  `message`.
- **`facts` is counted on the read.** Nothing records that a review finished, so `open` is the
  number of that version's facts still `candidate`.
- **`employer`** is the document's own, named as `PATCH /api/source-documents/:id` names it, or
  `null`. It is never resolved through the document's project: it is what the document is filed
  under, which is what Screen 8 changes.
- **`reimportable`** is `false` exactly when the newest version is `queued` or `extracting`, the
  case `POST /api/imports` refuses at `409`. The screen disables the button from it rather than
  restating the rule.
- **`openCandidates`** at the top is the count Screen 8 shows for the whole record. The sidebar's
  badge is the same number, but it is read from `/api/imports/summary` and never from here.

**`GET /api/imports/summary` → 200** — the sidebar's badge, and nothing else.

```json
{ "openCandidates": 2, "openFlags": 14, "running": false }
```

- **`openFlags`** (#57) is the count beside `Flagged`: flags not marked checked, on facts that are
  not rejected. It is the `counts.open` of `GET /api/flags` (§6).

- The sidebar is on screen on **every** sidebar screen, so reading its one number from the listing
  meant fetching every document, every version and every fact count on Home, Record and Skills, and
  polling all of it while an import ran. This is two aggregates in one round trip.
- **`openCandidates`** is equal to the listing's top-level `openCandidates`, always. A test asserts
  the two agree through accept, reject and undo; the cheap count is not allowed to drift from the
  expensive one.
- **`running`** is `true` while any version is `queued` or `extracting` — the same condition
  `reimportable` is the negation of. It is what the sidebar's poll interval is driven from, so a
  `failed` version reports `false`: a settled failure must not poll forever.
- **Registered before `/api/imports/:id`.** `summary` is a static segment beside a sibling
  parameter, and Hono resolves those by registration order rather than by specificity. Registered
  the other way round the path is read as an import id and the sidebar gets a `404`, which is what a
  test pins.

---

## 6. Facts · M1

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/facts` | Filters: `importId`, `status`, `employerId`, `projectId`, `graded`, and `captured=true` for the facts with no document (quick capture, #95). Paginated |
| `PATCH` | `/api/facts/:id` | Edit `claim`, `provenance`, `disclosure`, `employerId`, and `month` (`YYYY-MM`, `null` clears it). Commits on blur in the UI. A changed claim rechecks number and confidential shapes; a matching shape makes the fact Private. A later disclosure-only edit is the author's deliberate choice until the claim changes again. `employerId`, `null` included, is a hand set |
| `POST` | `/api/facts/:id/accept` | Also records the grade (`graded: true`) |
| `POST` | `/api/facts/:id/reject` | |
| `POST` | `/api/facts/:id/undo` | Returns the fact to `candidate`, and clears the grade. A fact the importer accepted goes back to `accepted`, as it left it, and so does a captured one, with the author's grade it was saved with |
| `POST` | `/api/facts/:id/regrade` | `{ provenance }` on an accepted fact. M3, #37 |
| `POST` | `/api/facts/sort` | Grades, accepts and flags the facts still waiting, a batch a call. #57, below |
| `GET` | `/api/flags` | The Flagged list. `?state=checked` for the ones already marked. #57, below |
| `POST` | `/api/flags/:id/explain` | `Explain this`. **The one route here that calls the model for a flag, and only when pressed** |
| `POST` | `/api/flags/:id/check` · `/uncheck` | Takes a flag off the list, or puts it back. Idempotent |
| `POST` | `/api/capture/read` | Quick capture's `Read it`: splits typed text into claims. **Stores nothing.** #95, below |
| `POST` | `/api/capture` | Saves confirmed claims **into the record**, accepted and Attested. #95, below |

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
      "employerId": "emp_2Kd9",
      "employerSetByHand": false,
      "projectId": null,
      "month": null,
      "createdAt": "2026-09-04T03:12:44.000Z",
      "evidence": {
        "sourceDocumentVersionId": "sdv_7Yh1",
        "lineNumber": 79,
        "quoteStart": 4820,
        "quoteEnd": 4849
      },
      "technologies": ["PostgreSQL", "Airflow", "Python"],
      "isClientIdentifying": false,
      "graded": false,
      "autoAccepted": false,
      "gradedBy": null,
      "flags": [],
      "likelyMatches": [
        {
          "id": "fct_R2k7",
          "claim": "Cut the nightly batch from six hours to 80 minutes",
          "provenance": "attested",
          "graded": false,
          "document": { "importId": "sdv_3Qa0", "filename": "narrative.md", "versionNo": 1 },
          "conflict": true
        }
      ]
    },
    {
      "id": "fct_Z0b2",
      "claim": "Improved system performance by approximately 30%",
      "provenance": "generated",
      "disclosure": "public",
      "status": "candidate",
      "employerId": null,
      "employerSetByHand": true,
      "projectId": null,
      "evidence": null,
      "technologies": [],
      "isClientIdentifying": false,
      "graded": false,
      "likelyMatches": []
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
- **`employerId` is the employer the fact resolves to**: the one set on it by hand, then its
  document's, then its project's (`04` §3.12, #35). Extraction never guesses one; a fact extracted
  from a document filed under an employer reads that employer through the document. The `employerId`
  filter matches the same resolved employer.
- **`employerSetByHand`** is true once `PATCH` has set the fact's employer, and then the fact keeps
  it, `null` included, whatever later happens to its document's employer or its project's. False
  means `employerId` is read through. `PATCH` with `employerId` is the only way to set one, and
  nothing sets it back. Setting it on an accepted fact does not disturb the accept decision, which is
  what makes an already-reviewed import linkable without a re-import (issue #14). An `employerId`
  naming another user's employer answers `404`.
- **`likelyMatches` · M3, built by #36, 2026-09-28.** A candidate carries the accepted
  facts at the same employer that likely say the same thing, at most three, best first (PRD §8), so
  Screen 1 can show them on the card. Each carries the match's `id`, its `claim`, its `provenance` and `graded` (#37), the
  `document` it was extracted from (`importId`, `filename`, `versionNo`, or `null` for a fact with no source) and
  `conflict`, true when both claims carry numbers and neither's numbers contain the other's.
  **Computed on every read and stored nowhere**, by a lexical match between claims (`03` §5), so a
  match the author rejects is gone from the next response. `PATCH`, `accept`, `reject`, `undo` and `regrade`
  answer with the fact's list computed the same way. "The same employer" is the resolved
  `employerId` above, on both sides (`04` §3.12); a candidate whose employer resolves to neither has an empty list,
  as do accepted and rejected facts. Like the rest of this response it carries ids and claims, never
  `quote` text, and **no score**: how alike two claims are is not in the contract, for the reason no
  confidence is.

- **Since 2026-10-08 an import's facts arrive `accepted`** (#57). `candidate`, as in the example
  above, is the state of a fact imported before that. A new fact carries the importer's
  `provenance`, a `disclosure` of `restricted` or `private` and never `public`, `autoAccepted: true`
  and its `flags`.
- **`autoAccepted`** is true when the importer accepted the fact, at import or by the sort.
  **`gradedBy`** is `author` once the author has accepted or re-graded it, `importer` for a fact the
  importer accepted that the author has not graded, and `null` otherwise. **`graded`** is true for
  either, so `graded=false` still lists only the agent-default facts of the 2026-09-04 import.
- **`flags`** is every flag on the fact, checked ones included: `{ id, kind, reason, explanation,
  checked }`. `kind` ∈ `confidential` · `number` · `unsure` · `repeat`. `reason` is always present.
  `explanation` is `null` until `Explain this` has been pressed for that flag.
- **`likelyMatches` on an accepted fact.** It is no longer empty on everything but a candidate: an
  accepted fact whose `repeat` flag is open carries the pair too, compared against facts from other
  versions and documents. Marking the flag checked empties it.

- **`graded` · M3, #37, 2026-09-30.** True once the author has set the grade of an accepted fact:
  `accept` and `regrade` set it, `undo` clears it, `reject` leaves it (`04` §3.7). False on an
  accepted fact means its provenance is not the author's, which is the state of the 112 facts of the
  2026-09-04 import (ADR-0002). A likely match carries its own `provenance` and `graded`, so the card
  can offer the re-grade beside it. **`?importId=…&status=accepted&graded=false` is the listing of
  what is still to re-grade**, and "the 112 are re-graded" is that listing coming back empty for the
  2026-09-04 import. Any other value of `graded` is ignored, as an unknown `status` is.

**`POST /api/facts/:id/regrade` → 200** with `{ "provenance": "attested" }`: the fact, as the list
returns it, with `graded: true`. It writes the provenance and the grade and **nothing else**: not
the status, the claim, the disclosure, the employer or `resolved_at`. The provenance may be the one
the fact already has; confirming the default is a re-grade. `409 conflict` on a candidate or a
rejected fact (a candidate is graded on its card and accepted), `422` for Measured without evidence
as `PATCH` answers, and `404` for another user's fact.

**`POST /api/facts/sort` → 200** with `{ "importId": "sdv_…" }` or `{}` for every document (#57):

```json
{ "sorted": 25, "flagged": 9, "remaining": 1060 }
```

One call takes up to **twenty-five** waiting facts, oldest first, and makes **one** model call to
grade them (`03` §4). Each fact in the batch is then accepted with that grade and flagged by the
rules an import applies; one the model returned no grade for, or an incomplete one, is accepted as
Generated and flagged. None is rejected. A fact the author accepted, rejected or edited while the
model was answering is left as the author put it, with no flag written, and an edited one still
waits: `sorted` counts only the facts this call accepted, so it can be `0` with `remaining` above
it. The client asks again until `remaining` is `0`, and stops with a failure line after three calls
in a row that sorted nothing. `flagged` counts facts, not flags. A disclosure the author already set is
kept, except that a fact read as confidential becomes Private. `503 upstream_unavailable` when the
model does not answer, with nothing changed; facts sorted by earlier calls stay sorted. Only the
session's own candidates are read, and another user's `importId` sorts nothing.

**`GET /api/flags` → 200**

```json
{
  "counts": { "open": 14, "checked": 3 },
  "items": [
    {
      "id": "flg_8Hq2",
      "kind": "number",
      "reason": "It states a number the passage it was read from does not. Check where the number came from.",
      "explanation": null,
      "checked": false,
      "fact": {
        "id": "fct_M4x8",
        "claim": "Reduced nightly batch runtime from 6 hours to 90 minutes",
        "provenance": "measured",
        "disclosure": "restricted",
        "lineNumber": 79,
        "importId": "sdv_7Yh1",
        "filename": "portfolio.md"
      }
    }
  ]
}
```

- The open flags, or with `?state=checked` the checked ones; `counts` is both either way. Ordered
  `confidential`, `unsure`, `repeat`, `number`, newest first within a kind.
- **Reading it calls no model.** Two queries in one batch.
- `fact.importId` and `fact.filename` are where the fact is opened (`/imports/:importId?fact=:id`),
  `null` for a fact with no source document. No `quote` text, as everywhere else.
- A rejected fact's flags are left off the list and out of the counts; undoing the rejection brings
  them back.

**`POST /api/flags/:id/explain` → 200** with the flag, its `explanation` filled. **One model call,
made because the author pressed the button.** The call is given the flag's kind and reason and the
fact's claim, quote, provenance and disclosure. The answer and its token counts are stored on the
flag, so a second press, a reload and the fact's own card all read the stored text and call nothing.
`503 upstream_unavailable` when the model does not answer, has no credits or returns nothing usable;
nothing is stored, and the next press tries again. `404` for a flag that is not the session's.

**`POST /api/flags/:id/check`** and **`/uncheck` → 200** with the flag. They stamp or clear
`checked_at` and change nothing about the fact: a checked `confidential` flag leaves the fact
Private. Repeating either is the same answer.

**`PATCH /api/facts/:id` → 404** when `employerId` names an employer the session does not own — the
same answer a missing employer gets, because a `403` would confirm it exists.

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

### Quick capture · #95

Work that left no document, typed in a sentence or two (`09` Flow 6, `06` 2026-10-16).

**`POST /api/capture/read`** takes `{ text, today? }`: up to 2,000 characters, and the author's own
month as `YYYY-MM` so `last month` is read where they are (the server's month when absent). **One
model call, and nothing stored.** The call is given the text, the month, and the session's
employers and projects by id and name only. **200** `{ claims: [{ claim, month, employerId,
projectId, technologies, missing }] }`, where `month` is `YYYY-MM` or `null`, at most one of
`employerId` and `projectId` is set, and `missing` lists what the text does not say, from `when`,
`employer`, `change` and `proof`. An id the session does not own is dropped and its question asked.
An empty `claims` is a text that makes no claim. **`503 upstream_unavailable`** when the model does
not answer; the screen then opens the plain form with the text kept, as it does for an empty list.

**`POST /api/capture`** takes `{ claims: [{ claim, month, employerId?, projectId?, technologies? }] }`,
one to eight. **201** `{ items }`, each fact as `GET /api/facts` returns it. Every fact is written
`accepted`, `attested`, graded by the author (`graded_at` stamped, `auto_accepted_at` null), with no
source document version, no quote and no offsets, and `occurred_on` the month given. Disclosure is
`restricted`, and `private` with a `confidential` flag when the claim has a confidential shape; no
`number` flag is raised, since there is no passage to check a number against. `employerId` is a hand
set, `null` a chosen `No employer`; `projectId` files the fact through its project; absent both, the
fact is unfiled. **404** for an employer or a project the session does not own, and nothing is saved.
**422** for an empty claim, a malformed month, or both an employer and a project on one claim.

**`POST /api/capture/prompt/dismiss`** (#116) takes `{ month }`, the author's own month as
`YYYY-MM-01`, and puts Home's monthly capture prompt away until that month ends, on every device:
it is stored on the member, in `capture_prompt_dismissals` (`04` §3.18), so it answers with or
without a profile. **200** `{ dismissedOn }`. **422** for a month that is not `YYYY-MM-01`, or one
more than a month from the server's, so a dismissal never outlasts the month it was for.

---

## 7. Renders · M1 for the English résumé

**Every `:kind` in a path below is a `:ref` since 2026-10-08** (#57): a kind names the main document
of that kind, and a tailored résumé's id names that résumé. One segment carries either, so a
tailored résumé has every route a main document has, and nothing is written twice. A ref that is
neither a kind nor one of the session's tailored résumés is `404`. A version belongs to one
document: asked for under another's ref it is `404`. A response that carried `renderKind` carries
`renderRef` and `title` beside it.

The three `/api/tailored-resumes` routes were removed on 2026-10-11 (#70): a tailored résumé is
read with its application (§9b), and every `:ref` route below still serves it. An application
makes its own with `POST /api/applications/:id/tailored-resume` (§9c, #71). A proposal for a
tailored résumé carries its `applicationId`, `null` for any other document, so Diff Review can go
back to the application it came from.

| Method | Path | M | Notes |
|---|---|---|---|
| `GET` | `/api/renders` | M1 | All five, with status. Backs Home's `Your career documents` section |
| `POST` | `/api/renders/:kind/generate` | M1 | → `202` + `proposalId` + `warnings` |
| `GET` | `/api/proposals/:id` | M1 | Poll target, then the proposal itself |
| `GET` | `/api/proposals/:id/diff` | M1 | Diff changes and, for a first version, a document preview. **Computed server-side** |
| `POST` | `/api/proposals/:id/accept` | M1 | → new version |
| `POST` | `/api/proposals/:id/dismiss` | M1 | Retained as dismissed; the stored version is byte-identical |
| `GET` | `/api/renders/:kind/download` | M1 | `?format=docx\|md\|pdf&versionId=` — **assembled on demand, never stored**, and **citations re-checked on every request** (`409` naming the fact ids). `docx` without a format. 履歴書 is `docx` only; `pdf` is the English résumé's only (#109) |
| `GET` | `/api/renders/:kind/page` | #106 | `?versionId=`, the current version without it. `{ renderKind, renderRef, title, language, tailored, applicationId, document, canGenerate, version, page, evidence }`: the page its `.docx` download would hold today, from the same inputs, **never stored**; `document` is its `GET /api/renders` row. Cited section blocks carry their `factIds`; a 履歴書's motivation and kibou sheet cells also carry them. Blocks and cells copied from the record may omit `factIds` (treated as `[]`). `evidence` is every cited fact once, `{ id, claim, provenance, employer, quote, source: { importId, filename, lineNumber } \| null }`, the employer named in the document's language and `source` null on a fact added by hand (#110). Refused at `409` on a withheld fact exactly as the download is, before anything is looked up |
| `GET` | `/api/renders/:kind/versions/:id` | M1 | One stored version as **content**, block ids included — what an edit is made from |
| `POST` | `/api/renders/:kind/versions` | M1 | A **hand edit**. Body `{ basedOnVersionId, content }` → `201` + a new version with `origin: "edited"`. Appends; never mutates (S16) |
| `GET` | `/api/renders/:kind/versions` | M1 | The version history. **Versions only** — the screen merges the dismissed proposals in, and a merged payload would hand every consumer a discriminated union to unpack (decision log, 2026-09-12) |
| `GET` | `/api/proposals?kind=` | M1 | One render's proposals, decided and undecided. The other half of the history: a **dismissed** proposal is retained and is not a version |
| `GET` | `/api/renders/:kind/diff` | M1 | `?from=&to=` — two **versions** of one render, the restore preview. `from` is the left column. Never names a proposal; proposals keep their own diff route |
| `POST` | `/api/renders/:kind/versions/:id/restore` | M1 | Creates a **new** version with `origin: "restored"`; history is never erased. Refuses at `409` for a waiting proposal (not one whose generation `failed`) or a target already current, and at `422` when the target cites a fact that can no longer be rendered (S14) |

`SentPage` carries `title`, `stamp`, `name`, `contact` lines and nonempty `sections` with their headings and
blocks. `title` is the title the file prints above the name, and is `null` for the English résumé,
which prints none; a sent copy stored before titles were kept has no `title`. The English résumé's page
also carries `headline`, its line under the name, when the profile has one, and `contact` is then the
contact line alone. A 履歴書 page also carries `sheet`: ordered line and table blocks read from its filled
`.docx`, with cell spans, column widths, alignment, size, shading and each paragraph's before- and after-spacing
in twips (`beforeTwips`, `afterTwips`). This applies to the render page, the first-version preview and sent copies;
older sent copies gain `sheet` from their stored file when read, if that file is readable. Otherwise
their stored text page is returned with `readFailure: "original_file_unreadable"`.

`:kind` ∈ `english_resume` · `rirekisho` · `shokumu_keirekisho` · `career_story_en` ·
`career_story_ja`.

Each item also carries `id` (`null` for a main document never generated), `ref` (its kind, or a
tailored résumé's id) and `tailored` (`null`, or `{ label, createdAt }`).

**A tailored résumé is generated from exactly the facts the main résumé is given**, and its job
description reaches the model as text to read (`03` §6). Its download uses the English résumé
filename described below.

**`GET /api/renders` → 200**

```json
{
  "items": [
    { "kind": "english_resume", "language": "en", "currentVersionNo": 4,
      "generatedAt": "2026-08-09T02:11:00Z", "status": "stale", "newFactsSince": 3,
      "withdrawnFactsSince": 1,
      "pendingProposalId": null },
    { "kind": "rirekisho", "language": "ja", "currentVersionNo": null,
      "generatedAt": null, "status": "never_generated", "newFactsSince": null,
      "withdrawnFactsSince": null,
      "pendingProposalId": null }
  ]
}
```

`status` ∈ `never_generated` · `up_to_date` · `stale` · `proposal_pending` · `proposal_generating`.
For a version with a recorded fact set, `newFactsSince` counts facts usable now but absent when
generation read the record; `withdrawnFactsSince` counts facts usable then but no longer usable.
The version's set is copied from its proposal when accepted and carried forward by an edit or
restore. Usable means accepted, neither Private nor Generated (§8). Either difference makes the
version `stale`, even if the usable count has not changed. Accepting a fact that is still Generated
makes nothing `stale`; confirming it does. For a version made before the set was recorded, or an
edit or restore carrying its content, `newFactsSince` keeps the usable-count fallback and
`withdrawnFactsSince` is `0`. Both fields are `null` if there is no current version.
**`never_generated` is distinct from `up_to_date`** (PRD §7).
`proposal_pending` wins over every other status, including a render with no accepted version yet —
a first generation awaiting review is not `never_generated`. While that proposal is still being
written the status is `proposal_generating` instead, with `pendingProposalId` set all the same: the
diff answers `conflict` until it lands. A proposal whose generation `failed`
is not one: it is still `pending`, but there is no diff to review, so the render reports the status
it would have without it and `pendingProposalId` is `null`.

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

**`POST /api/renders/shokumu_keirekisho/generate` → 428** on the same rule with a shorter list:
`["familyNameKanji", "givenNameKanji"]`. A 職務経歴書 is headed 氏名 in kanji and needs nothing else
from the profile — none of the restricted PII the 履歴書 requires, because 生年月日, 現住所 and 連絡先
belong to the 履歴書 it is submitted alongside (`docs/04` §3.2).

**`POST /api/renders/english_resume/generate` → 428**, before the model is called, when a job it
includes has no city or no role with a title, the parts of its header the record leaves optional.
The message names each job and what it lacks; `details.fields` is `["employers"]` and
`details.jobHeaders` is `[{ employerId, name, missing: ("city" | "role")[] }]`, which the screens
turn into links to the career timeline (`06`, 2026-10-22). The same gap refuses a version
already accepted: `GET /api/renders/:ref/download` (every format), the document page and a first
proposal's preview answer **409 `conflict`** with the same message and `details`, for a version
made before the check as for a city cleared after acceptance. Then **428** too when an employer,
project or education name in the generation spec lacks a Latin letter or contains a non-Latin letter,
or an assembled field would print Japanese script. The name check includes entries later omitted
from the file. The message names the field needing an English or Latin-script value, with
`details.fields: ["english_resume"]`. A tailored résumé is refused the same way. A download of
either, and the first-version preview of the English résumé (`GET /api/proposals/:id/diff`), answers `409 conflict` when assembly finds Japanese script, a name with non-Latin letters,
or a legacy experience heading naming no included employer (`docs/03` §6).

**`POST /api/renders/:kind/generate` → 409 conflict** while that render has a proposal waiting —
`pending` and still `generating` or `ready` — with `details.proposalId`, the same refusal the edit
and restore routes give. Accepting either of two proposals would discard the other unread. It is
checked before the profile and the facts, because it is the one refusal `Review changes` answers. A
proposal whose generation `failed` does not refuse: it has nothing to decide, and refusing on it
would leave the render with no way to try again. The edit and restore routes exclude it on the same
reading — accept itself refuses a proposal that is not `ready`, so a failed one can discard neither.
Two simultaneous requests get the same answer: a partial unique index on waiting proposals lets one
insert through, and the other is refused with the winner's `details.proposalId` (`docs/06`,
2026-09-21).

**`GET /api/proposals/:id` → 200**

When generation is paused for lack of credits, the retryable proposal has
`generationStatus: "failed"` and `error.code: "credits_exhausted"`, with the plain pause message.
Other model failures use `generation_failed`.

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

**`GET /api/proposals/:id/diff` → 200** — changes for the split view and a preview for a first
version. Two passes have already run server-side: paragraphs aligned, then tokens diffed
(`03-technical-design.md` §6.1).

```json
{
  "additions": 4,
  "removals": 1,
  "preview": null,
  "changes": [
    {
      "changeId": "chg_1",
      "target": "block",
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
      "target": "block",
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
- `target` ∈ `block` · `heading`. A `heading` change is a section's heading rewritten, added with a
  new section or removed with one: `currentBlockId` and `proposedBlockId` are null, `tokens` diff
  the heading text, and it comes before the changes to that section's blocks. A section with no
  blocks is not in the document, so its heading is not diffed.
- `rationale.kind` ∈ `heading_changed` · `from_facts` · `removed_no_support` ·
  `removed_unverified` · `from_restricted`.
- `preview` is `{ "title": string, "page": SentPage }` when the render has no current version,
  and null otherwise. The first-version screen reads `preview`; every other review reads `changes`.
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
`Content-Disposition: attachment; filename="Yosuke-Aoki-Resume-2026-08.docx"`: the profile's Latin
name, ASCII only, and the month the version was accepted in Tokyo. A tailored résumé's file is named
the same way (#107). Every other kind is `<kind>-<YYYY-MM-DD>.docx`, e.g. `shokumu-keirekisho-2026-08-12.docx`.
Assembled from stored `RenderContent` on each request; the résumé's job headers, skills, education,
certifications and languages are read from the record at the same time (`docs/03` §6). The résumé
assembly refusals above return `409 conflict`; other assembly failures → `500` with `code: "render_failed"`;
**the stored version is untouched.**

**`GET /api/renders/english_resume/download?format=pdf` → 200** · `Content-Type: application/pdf` ·
`Content-Disposition: attachment; filename="Yosuke-Aoki-Resume-2026-08.pdf"`, named as the `.docx` is.
The same document in the same layout, with selectable, tagged text and the title
`<name> – Résumé` and the author `<name>` in its properties (`docs/03` §6.3). It is refused exactly
as the `.docx` is, and also when any text holds a character the embedded Carlito cannot draw →
`409 conflict` (`The PDF cannot show “✓” (U+2713) in the Experience section. Remove it, or download
the Word file instead.`); the `.docx` and Markdown are unaffected. A tailored résumé has one too. `?format=pdf` on any other kind → `409 conflict`
(`Only the English résumé is produced as a PDF.`), before a version is read.

**A download obeys today's record, not the day the version was accepted.** Every download
re-checks the facts its stored content cites, before the 履歴書 branch and so for every kind. A
version citing a fact that is now Private, now Generated-provenance, no longer accepted, or no
longer in the record at all → `409 conflict`, with `details.facts` carrying `{ factId, problem }`
for each, and never any claim text. `409` rather than restore's `422`: restore submits content to
be made current and the content fails validation, while a download asks for a file the record's
current state will not allow. The way out is the hand-edit route, which lifts the block and
produces a version that downloads; the version that cited the fact stays stored and stays refused
(decision log, 2026-09-12).

**`GET /api/renders/rirekisho/download` is `.docx` only** — `?format=md` → `409 conflict`. The other
renders are documents built as text, and markdown is a readable form of one; a 履歴書 is a form whose
meaning is its grid, and a markdown table of it is not a 履歴書. It is also the one download assembled
from the **record** rather than from the stored version: the 学歴・職歴 and 免許・資格 tables are
derived on each request, the identity block is read from the profile row, the submission date is
stamped in Tokyo and 満N歳 computed against it, and the only generated text in the file is the two
prose cells (`docs/04` §4).

**`GET /api/renders/shokumu_keirekisho/download`** takes either format and is assembled from the
stored version like the résumé, with one addition: a **作成日 stamped in Tokyo at download**, above a
right-aligned 氏名. It is stamped rather than stored for the same reason the identity block is — a
submission date is not a claim about a career, and storing one would make an accepted version go
stale on the day after it was accepted. Both formats take it from one function, so the `.docx` and
the `.md` of one version cannot disagree about when it was submitted.

**`POST /api/renders/:kind/versions` refuses four ways and warns a fifth.** It edits the CURRENT
version and nothing else: an edit whose `basedOnVersionId` is not current → `409 conflict` with
`details.currentVersionId`, and an edit made while a proposal is pending → `409 conflict` with
`details.proposalId`, because accepting that proposal afterwards would silently discard the edit
(a proposal whose generation `failed` is excluded: it can never be accepted).
A payload that changes nothing → `409`; one that is malformed, empties the document, or has two
blocks claiming one id → `422 validation_failed`. An English résumé's edit is also `422` when it
adds, drops or re-kinds a section of the version it edits, or breaks a bound a generation is held to:
a summary of 50 words or more, a bullet over 240 characters, or more bullets under an employer than
its budget, checked only for a section the edit grew. A block citing a fact the record does not hold,
or one a generation would have been forbidden to use, → `422` with `details.facts` carrying
`{ factId, problem }` — the same shape a refused download returns, and never any claim text.

**The `201` carries `warnings`**, from the attribution instrument's three judgement findings: a
fact filed to no employer sitting under an employer heading, a fact filed to a different employer
than its heading names, and a heading naming no employer in the record. They are advisory
**because they are judgements about headings**, and an author restructuring a section by hand may
be right where the checker is wrong; refusing on them would block the edit this route exists to
serve. They arrive after the write, which is why they land on the editor's saved state rather than
beside the draft (`docs/10` Screen 6).

**`warnings`** on the `202` is an array of strings, advisory and never blocking — it never delays or
prevents the generation it is returned with. Today only 履歴書 produces one, for an unexplained gap
between 学歴・職歴 entries (`docs/04` §4); every other kind returns `[]`. The `warnings` on a hand
edit's `201` are a different set from a different check, described above, and share only the rule
that neither ever blocks.

---

## 8. Overview · M1

**`GET /api/overview` → 200** — one request backs the whole home screen, **and it costs the
database one round trip** (#58): every query below goes in one batch, beside the renders' own. It
was up to seventeen queries, each its own HTTPS request to Neon and most of them awaited in turn,
and the home screen waited for all of them.

```json
{
  "lastImportAt": "2026-08-12T08:02:00Z",
  "activeImport": null,
  "waitingImports": [],
  "latestImportSet": [],
  "tiles": {
    "employers": { "count": 4, "note": "2 current, 2 past" },
    "roles":     { "count": 6, "note": null },
    "projects":  { "count": 9, "note": "4 with measured outcomes" },
    "credentials": { "count": 12, "note": "1 expires Mar 2027" }
  },
  "factsByProvenance": { "measured": 41, "attested": 66, "generated": 7 },
  "review": { "openCandidates": 23, "documents": 2, "importId": "sdv_…", "filename": "portfolio.md" },
  "unconfirmed": { "importId": "sdv_…", "count": 3, "total": 16 },
  "flagged": 14,
  "capturePrompt": {
    "lastFactAt": "2026-08-12T08:02:00Z",
    "employer": { "id": "emp_…", "name": "Example Corp" },
    "dismissedOn": null
  },
  "documents": [],
  "canGenerate": true,
  "isEmpty": false
}
```

`tiles.credentials` sums `educations` and `certifications` — the split is storage, not interface.
`activeImport` is `null` unless a version is `queued` or `extracting`. Otherwise it is the
`GET /api/imports/:id` body for the version being read, or, between two, the next to be, plus
`filename`, the document's name, which the home screen's progress panel shows.
`waitingImports` (#93) is every other `queued` version as `{ importId, filename }`, in the order
they will be read, and `[]` when none is waiting.
`latestImportSet` (#93) is every version submitted with the newest one (same `batch_id`), in
`batch_order`, as `{ importId, filename, status, chunksTotal, chunksDone, error }`; it stays after
they finish, until the next set is submitted.
While it is not `null` the request costs a second round trip, for that body.
`factsByProvenance` counts accepted facts only; the home screen's at-a-glance strip sums it for its
`Facts` cell and notes `measured` (#111).
`review` is `null` when no candidate is waiting. Otherwise `openCandidates` is the same count
`GET /api/imports/summary` gives the sidebar, `documents` is how many source documents they sit in,
and `importId` and `filename` are the most recently imported version that holds any, which is where
the Next step opens Fact Review (#58).
`unconfirmed` is the most recently imported version holding a fact **the author accepted on its
card** while it was still Generated, or `null`. Its `count` covers only that version and `total`
every version. It is where the Next step's Confirm step opens Fact Review. A Generated fact
the importer accepted is not counted (#57): it carries an `unsure` flag, and a flag is advice, not
a step.
`flagged` is the open flags, the same number as `openFlags` in `GET /api/imports/summary`.
`documents` is the `items` of `GET /api/renders` (§7). `canGenerate` is `false` when no accepted
fact is both not Private and not Generated, and the home screen then offers no Generate.
`capturePrompt` (#116) is what the monthly capture prompt is decided from, by the client, since the
month is the author's: `lastFactAt` is when the newest fact was created, by any road and in any
state, or `null` for none; `employer` is the employer with no `ended_on`, the one started last when
there are two, named by `name_latin` or else `name_ja`, or `null` when every job has ended; and
`dismissedOn` is the member's `capture_prompt_dismissals.dismissed_on`, or `null` for none.

---

## 9. The master document · M3 (#57)

Shown as the **Career record** since #112 (`10` Screen 10); the routes keep their names.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/master-document` | The whole record as one structure. **Built on the read, by no model, and stored nowhere** |
| `GET` | `/api/master-document/download` | The same structure as Markdown, `career-record-<language>-<date>.md`, `cache-control: no-store` |

Both take **`?language=ja`** for the 日本語 master document (#59). Without it, or with any other
value, the answer is the English one: an unknown value is ignored, as an unknown filter is on
`GET /api/facts`.

```json
{
  "language": "en",
  "builtAt": "2026-10-08T03:00:00Z",
  "subjectName": "Yosuke Aoki",
  "counts": {
    "facts": 214, "usable": 180, "private": 22, "generated": 12, "keptOut": 34,
    "flags": 17, "waiting": 0, "years": 11
  },
  "employers": [
    {
      "id": "emp_2Kd9", "name": "Aozora Logistics K.K.", "alternateName": "株式会社アオゾラ物流",
      "industry": "運輸業", "startedOn": "2022-04-01", "endedOn": "2024-09-01",
      "roles": [{ "title": "Backend Engineer", "startedOn": "2022-04-01", "endedOn": "2023-09-01" }],
      "projects": [{ "id": "prj_9f2", "name": "Settlement batch", "summary": null, "facts": [] }],
      "facts": []
    }
  ],
  "independent": { "projects": [], "facts": [] },
  "educations": [],
  "certifications": []
}
```

- A fact is `{ id, claim, provenance, disclosure, technologies, flags, source, used }`. `flags` is
  the kinds still open on it; `source` is `{ importId, filename, lineNumber }` or `null` (added by
  hand); `used` is whether the current version of any document, tailored résumés included, cites it.
- `counts.keptOut` is Private or Generated. Its reasons partition the total: `counts.private`
  includes Private facts even when Generated, and `counts.generated` includes only Generated facts
  that are not Private. **`counts.flags`
  is open flags, in the unit `GET /api/imports/summary`'s `openFlags` counts** (#112): it counted
  facts with a flag, and the page and the sidebar disagreed. `counts.years` is whole years from the
  first employment or project to the last, or to today, and `null` with no dates.
- **Every accepted fact is in it, Private and Generated included.** A rejected fact is not, and a
  fact still waiting to be sorted is not; `counts.waiting` says how many those are.
- A fact sits under the employer it resolves to (`04` §3.12), then under its project. A project is
  listed where it belongs whether or not it has facts.
- **No source text**, in either route: a fact names its document and line, never the passage.
- **The download holds Private facts**, by the owner's decision (`docs/06`, 2026-10-08). Its first
  lines say so and say not to send it to an employer.
- **`language` decides names, never claims** (`docs/06`, 2026-10-10). `subjectName`, an employer's
  `name`, a role's `title`, a project's `name`, an education's `institution` and a certification's
  `name` are each the one a document of that language uses, falling back to the other where the
  record holds only one. `alternateName` is the employer's name in the other language, or `null`
  when the record holds one. Every fact, every count and the grouping are the same in both. The
  file's headings, dates and opening lines are in that language too.

---

## 9b. Applications · #70, interview entries #72 and #81, reading a posting #73, a recording by link #74 or upload #76

A job the author is looking at or has applied for (`04` §3.14), the interview entries on it
(`04` §3.15), and the recordings on an entry (`04` §3.16). **One route here reaches a model**, `POST /api/applications/read-posting`, and it
stores nothing; every other route is the author's own entry. The rules are
`src/shared/application.ts`, `src/shared/interview.ts` and `src/shared/recording.ts`, which the
screens read too.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/applications` | `{ items, today }`, newest activity first. No job description in the listing |
| `POST` | `/api/applications` | Body `{ company, position, jobDescription, postingUrl?, requirements? }` → `201` + the application, at Not applied with today as the day it was added. `422` for an empty company, position or job description, a job description over 20,000 characters, a link that is not `http(s)`, or an extra field |
| `POST` | `/api/applications/read-posting` | Body `{ jobDescription }` → `200` + `{ company, position, requirements }`, read from the text by the model. **A proposal: nothing is stored**, and the application is made by `POST /api/applications` when the author saves. `422` for text under 40 characters, over 20,000, or an extra field, with no model call. `503` when the reading fails |
| `GET` | `/api/applications/:id` | One application, with its `jobDescription`, `requirements`, and its `documents`, `choices` and `sentCopies` (§9c) |
| `PATCH` | `/api/applications/:id` | Any of `company`, `position`, `postingUrl`, `requirements`. **The job description is not editable.** Does not count as activity |
| `POST` | `/api/applications/:id/steps` | Body `{ status }`. A step moves it there and saves today under it; `rejected` or `withdrawn` closes it where it stands. `409` when it is closed, for either. **Leaving Not applied freezes its documents** (§9c) |
| `PATCH` | `/api/applications/:id/steps/:status` | Body `{ date }`. Corrects that status's date, or gives one to a step passed over. `404` for a status not in the list, `422` for a day that does not exist or is in the future, `409` for a step it has not reached |
| `POST` | `/api/applications/:id/reopen` | Back to the step it was closed at. `409` when it is not closed |
| `PUT` | `/api/applications/:id/standing` | Body `{ step, closedAs, dates }`: the standing from before a change, put back whole. **This is Undo.** `422` for a standing the changes above could not have produced: a date on a step not reached, a missing date for the step it is at, a future date. It freezes as a move does (§9c) |
| `POST` | `/api/applications/:id/interviews` | Body `{ date, round, who?, howItWent?, questions? }` → `201` + the application. `round` is `interview_1`, `interview_2`, `interview_final` or `other`; `questions` is a list of strings, each stored as its own row in the order given, blank ones dropped. **On an open application, a later round moves the step and saves its date; an earlier skipped round fills only its missing date.** The entry and standing are saved in the same transaction. `422` for a missing date, a day that does not exist or is in the future, a round not in the list, an entry with neither `howItWent` nor a question, `who` over 200 characters, `howItWent` over 10,000, a question over 1,000, more than 100 questions, or an extra field |
| `PUT` | `/api/applications/:id/interviews/:interviewId` | Body `{ date, round, who?, howItWent?, questions? }`, the entry whole → `200` + the application. **Corrects the entry in place.** `questions` is a list of `{ id?, text }`: one with the `id` of a live question stays that row, in its new place and with its new words; one the list leaves out is stamped `removed_at` and hidden from the page but kept in the export; one with no `id` is new. Blank ones are dropped. `422` for everything `POST` refuses, for an `id` that is not one of the entry's live questions, and for one given twice. `404` for an entry not on that application, or deleted. `409` when the application changed after it was read |
| `DELETE` | `/api/applications/:id/interviews/:interviewId` | → `200` + the application, without the entry. **The status and its dates are not changed.** The entry's recordings are removed with it, their rows first and their uploaded files after. `404` for an entry not on that application, or already deleted. `409` when the application changed after it was read, with nothing removed and every file still playable |
| `POST` | `/api/applications/:id/interviews/:interviewId/recordings` | Body `{ url, label? }` → `201` + the application. Attaches a link to a recording kept elsewhere to that entry. **Only the link is kept, and only `http` or `https`.** `422` for anything else in `url`, a link over 2,000 characters, a `label` over 200, or an extra field. `404` for an entry that is not on that application. `409` when the application changed after it was read |
| `POST` | `/api/applications/:id/interviews/:interviewId/recordings/audio` | **The body is the audio file itself**, not a form or JSON, with its `Content-Length`; `X-File-Name` is its name, URI-encoded, and `X-Duration-Seconds` how long it plays, when the browser could read it → `201` + the application. **The file is streamed to R2 and the row written only once it is stored.** `422` for a file over 90 MB (`<name> is <size> MB. A recording can be at most 90 MB.`), an empty one, one with no name or no declared length, and one whose first bytes are not MP3, M4A, AAC, WAV, FLAC or Ogg (`<name> is not audio this app keeps. It takes MP3, M4A, AAC, WAV, FLAC or Ogg, up to 90 MB.`), each before anything is stored. `503` when the whole file did not arrive, with nothing kept. `404` for an entry that is not on that application. `409` when the application changed while it uploaded, with the stored file deleted. A body over 100 MB is refused by Cloudflare's edge with `413` before the Worker runs |
| `GET` | `/api/applications/:id/interviews/:interviewId/recordings/:recordingId/audio` | An uploaded recording's bytes, `inline`; with `?download`, as an `attachment` under its own name. **A single `Range` is answered `206`** with its `Content-Range`, which is what seeking asks for; one past the end is `416`; any other range header gets the whole file. `Cache-Control: private, no-store`. `404` for anything but a live upload on that entry of that application of this user, a link included |
| `DELETE` | `/api/applications/:id/interviews/:interviewId/recordings/:recordingId` | → `200` + the application. **Removes the recording for good**: the link and its label, or the file's name, size, type and length, are emptied under the conflict guard, and the entry keeps a line with the day; an upload's file is then deleted from R2, and a delete that fails leaves the file unnamed and is logged by recording id. `404` for a recording not on that entry, or already removed. `409` when the application changed after it was read, with nothing removed and the file still playable |

```json
{
  "id": "app_4Hq2", "company": "Fernhill Robotics", "position": "Senior Backend Engineer",
  "postingUrl": "https://jobs.example.com/fernhill", "lastActivityAt": "2026-10-02T03:10:00Z",
  "step": "interview_2", "closedAs": null,
  "dates": { "not_applied": "2026-09-01", "applied": "2026-09-03", "resume_passed": "2026-09-12",
             "interview_1": "2026-09-24", "interview_2": "2026-10-02" },
  "daysSinceResumePassed": 28, "daysSinceFirstInterview": 16, "daysSinceClosed": null,
  "daysSinceLastActivity": 8, "quietDays": null,
  "requirements": [], "jobDescription": "…", "documents": [], "choices": [], "sentCopies": [],
  "canGenerate": true,
  "interviews": [
    { "id": "int_7Rk1", "date": "2026-10-02", "round": "interview_2", "who": "R. Halloran, VP Engineering",
      "howItWent": "A system design hour.",
      "questions": [{ "id": "ivq_2Bc8", "text": "Design the service that assigns orders to robots." }],
      "recordings": [
        { "id": "rec_9Qd3", "kind": "link", "url": "https://meet.example.com/rec/second", "label": "Their recording of the call" },
        { "id": "rec_4Tm6", "kind": "removed", "removedOn": "2026-10-05" }
      ] }
  ],
  "today": "2026-10-10"
}
```

- **A listing item is the same without `requirements`, `jobDescription`, `canGenerate`,
  `interviews`, `today` and the three document lists.** It carries
  `resume: { documents: [{ title, versionNo }], sent }`
  instead: before anything was sent, the documents on the application at their current versions;
  afterwards, the latest copy of each document sent, at the version sent, with `sent: true`.
- **`step` is one of the seven steps and `closedAs` is `rejected`, `withdrawn` or `null`.** A closed
  application keeps the step it was closed at.
- **`dates` holds a day for each status that has one.** `not_applied` is the day the job was added.
  A step passed over is absent.
- **Moving back drops the dates of the steps after the one moved to**, and saves today under that
  one. The rows are superseded, not deleted, and Undo puts them back.
- **Every figure is counted on the read**, to `today`, which is the day in Japan.
  `daysSinceResumePassed` and `daysSinceFirstInterview` count from those steps' dates and are
  `null` where the step has none. `daysSinceLastActivity` counts from `lastActivityAt`.
  **`quietDays` is that same count once it reaches 14 while the step is Applied, Résumé passed or
  an interview and the application is open, and `null` otherwise.**
- **`interviews` is every entry of the application, newest `date` first**, and of two on one day
  the one added later first. Each carries its `questions` in the order they were given. An entry
  the author deleted is not among them.
- **A corrected entry's day can change the date of its round's step** (#81). When only the
  day changes, on an open application whose step for that round is reached and still dated with
  the entry's old day, that date becomes the new day; `daysSinceFirstInterview` follows when this
  is the first-interview step,
  **unless another live entry of the same application and round shares that old day**. In that
  case the step date stays. A deleted entry does not count. A step date that no longer equals the
  entry's old day stays too. A date set by hand that happens to equal the entry's old day still
  follows the edit when no other live entry shares it; no provenance is tracked. In every other
  case a changed day or round does what saving the corrected entry new would: a
  round later than the status moves it there with the entry's day, a reached round with no date
  takes the day, and nothing moves back. A correction of the words alone never changes `step` or
  a date. Undo is `PUT …/standing`, and leaves the entry as corrected.
- **A correction that changes nothing writes nothing**, as on the other routes here: it answers
  with the application and logs nothing.
- **Deleting an entry moves nothing back.** The step it moved the application to and the date it
  saved under it stay, and are changed with the status controls if they are wrong. The row is kept
  (`04` §3.15); its recordings are removed for good, their rows emptied under the conflict guard
  and their uploaded files deleted after, as `DELETE …/recordings/:recordingId` removes one.
- **`recordings` is every recording of the entry, in the order attached.** A link is `{ id, kind:
  "link", url, label }`, `label` an empty string when none was given. An upload is `{ id, kind:
  "upload", fileName, byteSize, durationSeconds, uploadedOn }`, `durationSeconds` null when the
  browser could not read it and `uploadedOn` the day in Japan. One that was removed stays in its
  place as `{ id, kind: "removed", removedOn }`, the day in Japan it was removed, and carries
  nothing else: what described it is emptied when it is removed, not hidden.
- **An upload is reachable by its owner, signed in, and by nobody else** (S24). The session is
  required as on every route; the row is read by `user_id`, the application and the entry before
  the bucket is; the bucket has no public address. **Its type is the one the server recognised**
  from its first bytes, which is what it is played as, whatever the browser sent as
  `Content-Type`. The limits are the platform's: decision log, 2026-10-15.
- **A link is `http` or `https` and nothing else**: that scheme, a host, and no whitespace, up to
  2,000 characters. Anything else, `javascript:`, `data:`, `file:` and an address with no scheme
  included, is `422` with `That does not look like a link. It should start with https://`.
  Nothing fetches a link; it is stored, shown, and opened by the author in a new tab.
- **Removing a recording is the one thing on these routes that is gone for good** (`06`,
  2026-10-11). It is a `404` for a recording that is not on that entry of that application, for
  one already removed, and for one on a deleted entry.
- **An interview entry moves the status only forward.** On an open application, an entry for an
  earlier interview step that was skipped fills that step's missing date with the interview's day;
  the current step does not move back. An existing step date stays as it is. For `other` and on a
  closed application, the standing is unchanged. When the entry moves the step, steps it passes
  over get no date, as on any move. Undo is the same `PUT …/standing` for either kind of standing
  change, and leaves the entry in place.
- **`lastActivityAt` moves on every write here that changes `step`, `closedAs` or a date, on
  every interview entry added, corrected or deleted, whether or not it moved the status, and on
  every recording attached or removed**, so not
  on `PATCH /api/applications/:id`, and not on a write that leaves all three as they were: the same
  day saved again, the step it is already at, the standing it already has. That one answers with
  the application, writes nothing and logs nothing. The list is ordered by it.
- **A write to where an application stands is refused when the application changed after the write
  read it**: `409 conflict`, `This application was changed somewhere else. Reload it and try again.`
  That covers the step, close, date, reopen and standing routes, an interview entry added,
  corrected or deleted, and the three recording writes, and a change to a date alone counts. Nothing of the refused write is saved, the entry and its questions
  included. The check is on `lastActivityAt`, inside the same batch as the write.
- **`read-posting` answers with what the text states and nothing it does not**: `company` and
  `position` are an empty string, and `requirements` an empty list, where the text names none.
  That is a `200`, not a failure. What was read is held to the limits a saved application has (200
  characters for the company and the position; 30 requirements of 300 characters), so a proposal is
  always one `POST /api/applications` accepts. It takes the text only: the link is never sent to
  it, and nothing is fetched. A failed reading is `503 upstream_unavailable`, `The job description
  could not be read just now. Type the fields in; your text is kept.` unless credits are exhausted;
  that case uses the shared pause message and `details.reason` (§2).
- Every write answers with the application as it is afterwards. One that froze documents adds
  `frozen: [{ title, versionNo }]`, which is what the screen's notice names. Another user's
  application is `404` on every route.
- Logged: `posting_read` with the text's length, whether a company and a position were found, the
  number of requirements and the token counts, `posting_read_failed` with the length for other
  model failures, `model_credits_exhausted` with `step: "read_posting"` for exhausted credits,
  `application_created` with the id and the job description's length,
  `application_standing_set` with the id, `step`, `closedAs` and how many documents it froze, and
  `interview_added` with the two
  ids, the round, the number of questions and `movedTo`, the step it moved the application to or
  `null`, `interview_edited` with the same fields, `interview_removed` with the two ids,
  `recording_added` with the three ids and the kind, and for an upload its recognised type and
  size in bytes, `recording_upload_failed` with the two ids and the declared size, and
  `recording_removed` with the three ids and the kind. Never the company, the position, who an
  interview was with, how it went, a question, a recording's link, label or file name, or any
  other text.

---

## 9c. An application's documents and sent copies · #71

What an application is sending and what it sent (`04` §3.17). **No route here reaches a model**: a
tailored résumé is stored here and generated by `POST /api/renders/:ref/generate` (§7), like every
other document.

| Method | Path | Notes |
|---|---|---|
| `PUT` | `/api/applications/:id/documents` | Body `{ documents: kind[] }`, any of `english_resume`, `rirekisho`, `shokumu_keirekisho`, each once. The ticked set, whole: one left out is taken off. The tailored résumé is not on this list and is left alone. `409` from Applied onward, `422` for a document with no version yet or a kind that is not one of the three |
| `DELETE` | `/api/applications/:id/documents/:ref` | Takes one document off, the tailored résumé included. The document itself is untouched. `409` from Applied onward, `404` when it is not on the application |
| `POST` | `/api/applications/:id/tailored-resume` | Stores the application's tailored résumé, English, from its job description, and puts it on the application. `201`, or `200` with the one it already has, put back on if it had been taken off. **Generates nothing** |
| `POST` | `/api/applications/:id/sent-copies` | Body `{ documents: ref[] }`, a kind or the tailored résumé's id, each once. **Record another sent copy**: freezes each as a further copy dated today, with no comparison against earlier ones, and puts on the application any that was not. `201` + the application with `frozen`. `409` at Not applied, where the move does the freezing; `422` for a document with no version; `409` when a file cannot be built, with nothing saved |
| `GET` | `/api/applications/:id/sent-copies/:copyId` | One copy to read: `{ id, kind, title, versionNo, sentOn, recordedAt, filename, language, applicationId, company, page }` |
| `GET` | `/api/applications/:id/sent-copies/:copyId/download` | The stored `.docx`, byte for byte. Never a fresh one |
| `GET` | `/api/applications/:id/sent-copies/:copyId/photo` | The 写真 a 履歴書 copy was sent with, read out of its stored file, `no-store`. `404` for a copy with none, or of another kind (#117) |

- **`documents`** are the ones on the application, the tailored résumé first and then the three
  in their fixed order. Each is `{ ref, kind, tailored, title, language, currentVersionId,
  currentVersionNo, status, newFactsSince, withdrawnFactsSince, pendingProposalId }`: the fields of
  a `GET /api/renders` item (§7), with the title an application uses (`Main résumé`, `履歴書`,
  `職務経歴書`, `Tailored résumé for <company>`).
- **`choices`** are every document that could be ticked, the same shape with `onApplication`: the
  three always, and the tailored résumé once the application has one.
- **`sentCopies`** are `{ id, ref, kind, title, versionNo, sentOn, recordedAt }`, most recently
  recorded first. `title` and `versionNo` are as sent, so a company renamed since does not rename
  the copy.
- **`page`** is `{ stamp, name, contact, sections: [{ heading, blocks: [{ kind, text }] }] }`: what
  the file said, stored with it. It is never rebuilt from the record.
- **The freeze.** Whenever an application leaves Not applied for Applied or any later step, by a
  move or by `PUT …/standing` Undo, every attached document with a version and no copy yet is
  frozen, dated with the day that step saved. Documents with a copy are left alone, and no other
  change of step freezes anything. A move made by `POST …/interviews` is a move: it freezes the
  same way and answers with `frozen`. The files are built first, and one that cannot be built (a citation withheld
  since, or an English résumé job header with a gap, `409` with the download's `details`) refuses the
  move with nothing saved.
- **A corrected date and an Undo reach only the copies that move froze.** `PATCH …/steps/:status`
  moves their `sentOn` with the date. `PUT …/standing` back to Not applied from the standing that
  move saved takes them back; a copy recorded by hand, or frozen by an earlier move, stays. A copy
  taken back is `404` on both of its routes.
- **`lastActivityAt` moves** when the documents on the application change, when the tailored résumé
  is put on it, and when a copy is recorded. The same ticks saved again write nothing.
- A copy asked for under another application, or another user's, is `404`.
- Logged: `application_documents_set` with the id and the counts added and removed,
  `tailored_resume_created` with the ids and the job description's length, and
  `application_copies_recorded` with the id and the count. Never a title, a filename or any text.

---

## 10. Later milestones

| Method | Path | M | Notes |
|---|---|---|---|
| `GET` `PUT` | `/api/skills/curation` | M2 | Candidates are the distinct names in `technologies` on accepted, render-eligible facts (not Private, not Generated) ∪ `certifications.technologies`, each with `factCount` and `certificationCount`. `GET` returns `{ groups: [{ name, skills: [{ name, factCount, certificationCount, lastUsed, stale }] }], candidates: [{ name, factCount, certificationCount, lastUsed, curated, suggestedGroup }], printable: string[] }`; `stale` is computed on the read. `lastUsed` is the latest year a fact or certification naming it reaches, `"now"` while one is ongoing, or `null` (#114). `suggestedGroup` is the curated group a candidate is named beside on the most facts; failing that, the group whose skills' facts share the most employers (`effectiveEmployerId`) with the candidate's; failing that, the largest group; the earlier group on every tie. It is null only when the candidate is curated or no group exists. `printable` is what the English résumé may name in its Skills section, ranked as its uncurated line, from which the screen previews the section. `PUT` takes `{ groups: [{ name, skills: string[] }] }` and replaces the whole list; `422` for a name that is neither a candidate nor already curated, a skill listed twice, a repeated group name or a group with no skills. `[]` clears the curation |
| `GET` `PUT` | `/api/render-inclusions` | M2 | Per-render inclusion for employer, education and project entries. `GET` returns the stored rows only: a missing row means included, for every kind, which is how 履歴書 defaults to everything. `PUT` takes `{ entityType, entityId, kind, included }`, answers `404` for an entry the caller does not own, and keeps the row when an entry is included again. Deleting the entry clears its rows |
| `GET` | `/api/export` | M3 | Whole record as JSON — every entity, provenance, disclosure and evidence pointer (S15). A sent copy is exported with its page and without its file |

---

## 11. What has no endpoint, deliberately

| Not built | Why |
|---|---|
| A write on the master document | It is a view of the record. A fact is changed on its own card, and there is nothing else to keep in step |
| An explanation on any read | `Explain this` is a `POST` the author makes. No list, poll or page load reaches the model for a flag |
| Bulk "mark every flag checked", or bulk un-Private | A flag is looked at or left; clearing a list unread is not checking it |
| The app rejecting a fact | Reject is the author's action. The importer accepts and flags, and discards only a quote that is not in the document |
| Per-change accept on a proposal | Accepting 9 of 11 changes leaves the document not matching the record — the exact drift this project exists to remove |
| Bulk promotion out of Private | PRD §5: promotion is never bulk and never silent |
| Any endpoint returning a source document as a file | Source documents never render, export, or appear in any output (PRD §6.1) |
| A confidence score on a fact | Not in the API at all, so it cannot leak into the UI |
| User, role or sharing management | One user, no roles, no sharing |
