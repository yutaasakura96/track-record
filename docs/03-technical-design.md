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
| Client routing | **TanStack Router** | Type-safe, Vite-native. Three screens — a small file, not a framework |
| Client server-state | **TanStack Query** | Caching, refetch, mutation lifecycle |
| Client UI-state | **Zustand** | Selection, filters, highlighted change — never server data |
| Database | **Neon Postgres** (free tier) | Scale-to-zero, branching, no forced unpause |
| DB driver | `@neondatabase/serverless`, **HTTP mode** | Verified: supports multi-query **non-interactive** transactions via `sql.transaction([...])`. Interactive transactions would require WebSockets |
| ORM | **Drizzle** | Readable SQL migrations; schema file mirrors doc 04 |
| Auth | **Better Auth** + Google OIDC | Supplies the `user` table PRD §1 requires |
| Long-running work | **Cloudflare Workflows** | Billed only while executing; waiting on the model is free |
| Model | **Anthropic `claude-opus-5`** | Behind a six-function seam (§4) |
| Japanese segmentation | **BudouX** | 文節-scale phrases, ~15 KB, no dictionary |
| Diffing | **jsdiff `diffArrays`** | Myers, at token granularity |
| `.docx` | **`docx`** (résumé, 職務経歴書) · **`docxtemplater`** (履歴書) | Documents are built; forms are filled |

**Not used, deliberately:** object storage for the record (the whole corpus is ~2.4 MB; uploaded
interview recordings alone go to R2, `13` §1, decision log 2026-10-15), a staging environment,
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
├── AGENTS.md                  # project guidance
├── CLAUDE.md                  # imports AGENTS.md
├── CONTEXT.md                  # domain glossary (lazily created)
├── docs/                       # 01–13, adr/, agents/, specs/
├── design/prototype/           # visual reference only
├── local/                      # gitignored — the author's real documents
├── templates/
│   └── rirekisho.blank.docx    # 履歴書 grid, every value stripped (built by scripts/)
├── src/
│   ├── client/                 # React SPA
│   │   ├── screens/            # fact-review, diff-review, overview, flagged, master-document, applications
│   │   ├── components/
│   │   ├── components/ui/      # shadcn — owned, restyled to doc 05
│   │   ├── stores/             # Zustand — UI state only
│   │   ├── markdown/           # source documents rendered from an mdast tree, marks projected by offset
│   │   └── theme.css           # @theme — generated from 05-design-system.md
│   ├── server/
│   │   ├── index.ts            # Hono app, deny-by-default middleware
│   │   ├── routes/
│   │   ├── auth.ts             # Better Auth config
│   │   └── db/                 # Drizzle schema + migrations
│   ├── model/                  # THE SEAM — the only code that knows a model exists
│   │   ├── extract.ts
│   │   ├── generate.ts
│   │   ├── grade.ts            # the grading rules, stated once for extraction and the sort
│   │   ├── explain.ts
│   │   ├── posting.ts          # reading a pasted job posting (#73)
│   │   ├── capture.ts          # splitting a typed sentence or two into claims (#95)
│   │   └── providers/anthropic.ts
│   ├── pipeline/               # Workflow definitions
│   ├── render/                 # docx builders, markdown builder, 履歴書 template seam
│   ├── diff/                   # paragraph alignment + token diff
│   ├── overlap/                # likely matches and conflicts between claims (§5)
│   └── segment/                # BudouX wrapper
├── tests/
└── wrangler.toml
```

---

## 4. The model seam

The application touches a model in **exactly six places**. Nothing outside `src/model/` imports an
SDK or knows a provider name.

```ts
extractFacts(sourceText: string, ctx: ExtractionContext): Promise<CandidateFact[]>
generateRender(facts: Fact[], spec: RenderSpec): Promise<RenderContent>
gradeFacts(facts: GradableFact[]): Promise<Map<string, FactGrade>>
explainFlag(flag: FlagToExplain): Promise<string>
readPosting(jobDescription: string): Promise<PostingReading>
captureClaims(text: string, context: CaptureContext): Promise<CapturedClaim[]>
```

It was two until 2026-10-08 (#57). `gradeFacts` grades the facts extracted before extraction graded
them, by the same rules (§4.1), and is called only by `POST /api/facts/sort`. `explainFlag` writes
the plain-words account of one flag and is called only when the author presses `Explain this`; no
read, list or poll reaches it, and its answer is stored so a second press reads it back. It runs at
low effort: the answer is three short paragraphs about one fact.

`readPosting` is the fifth, since 2026-10-12 (#73). It takes a pasted job description and returns
the company, the position and the key requirements, and is called only by
`POST /api/applications/read-posting`, when the author presses `Read it`. **What it returns is a
proposal on a confirmation step and never a fact**: no quote, no grade, nothing stored by the call
(`06`, 2026-10-11). It runs at low effort, and its tool is asked for by the prompt and not forced,
so the call does not depend on a `tool_choice` the models after `claude-opus-5` refuse.

`captureClaims` is the sixth, since 2026-10-16 (#95). It takes what the author typed on Quick capture,
with their month and their employers and projects by id and name, and returns one plain claim per
outcome with the month and the employer or project the text names and what it leaves out (`when`,
`employer`, `change`, `proof`). It is called only by `POST /api/capture/read`, when the author
presses `Read it`. **What it returns is a proposal the author confirms, never a fact by itself**: no
quote and no grade, and nothing stored by the call. The author's save is what writes the facts,
Attested and graded by the author (`06`, 2026-10-16). An id it was not given is dropped, and what is
missing is worked out again from what survived. It runs at low effort with its tool asked for by the
prompt, as `readPosting` does; when it fails or finds nothing, the screen opens a plain form, so a
fact never waits on it.

Swapping providers is a config value plus one adapter file. The M2 bake-off this was built for was
dropped on 2026-09-21 (`docs/06`); the seam stays, so a model upgrade or a later swap stays cheap.

**The seam distinguishes calls a human is waiting on from calls nobody is watching.** Decided
2026-08-29. `ExtractionContext` carries that flag from the start, even though M1 has only one
setting for it. Interactive single-document import **streams**, so review cards appear incrementally
rather than after one long silence (`09` Flow 2). Bulk work — the M2 bootstrap flow, and
re-extraction after a parser upgrade — goes through **Message Batches at 50%**. That second half is
worth more than it looks: because a parser upgrade creates a new source document version rather than
re-extracting in place, full-corpus re-extraction is a *recurring* cost, and Batch halves it
permanently. **Nothing batched is built in M1** — where there is one document and one employer,
there is no bulk. The M1 obligation is only that the signature can express it without a rewrite.

### 4.1 Extraction contract — quote anchoring

The extractor is a **strict-schema tool call**. The model calls `extract_fact` once per candidate.
One required field is `quote`: the **verbatim** span from the source that supports the claim.

The application then locates that quote in the stored source text **by exact string match** to
derive its character offset and line number. **If the quote is not found verbatim, the candidate is
discarded before the author ever sees it.**

This inverts the trust relationship. The app does not trust a model-reported offset; it requires a
string that must already exist in a document it holds, and checks. PRD §8's *"the model invents a
plausible fact absent from the source"* becomes mechanically impossible for Measured facts rather
than merely contained by the Generated default.

> **Why not the Citations API.** Anthropic's Citations feature returns `cited_text` with exact
> character offsets and would be the natural fit. It is officially documented as **incompatible with
> structured outputs** — but on verification the incompatibility names **`output_config.format`**
> (JSON outputs) specifically, and our contract uses **strict tool use**, which the docs describe as
> a separate feature. So Citations may in fact be usable alongside it.
>
> **The decision stands regardless.** Quote anchoring verifies a returned string against a document
> we already hold, rather than trusting a reported offset — a stronger guarantee than Citations
> provides — and it is provider-portable. Citations remains available as an optional redundant check
> (`docs/specs/technical-verification.md`, item D).

**Each candidate carries the importer's grade** (decided 2026-10-08, #57): `provenance`, judged
against the quote alone, and `confidential`, `unsure` and a one-sentence `note`. They are required
fields of the same strict tool call, and the rules are one constant (`src/model/grade.ts`) that the
extraction prompt and the `gradeFacts` prompt both print, so a fact imported in September and one
imported today are judged alike. `src/pipeline/flags.ts` turns the grade into what is stored: the
provenance as given, except that a missing grade is Generated and Measured without a quote is
Attested; disclosure Private when a scrub shape matched (§7) **or** the importer read it as
confidential, and Restricted otherwise, never Public; and the flags (§5).

Until then every candidate arrived Generated and was promoted only by the author. Generated still
never reaches a render (§7), which is what keeps an ungrounded claim out of a document now that
nobody rules on each fact.

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
a prompt difference, not a data difference. For English renders, Japanese free-text fields in the
employer, project, education and certification lists are labelled for English wording or omission;
names stay verbatim. Fact claims remain in their recorded language. For an English prompt, Japanese
industry and project-summary copies are omitted from facts' contextual JSON; the labelled employer
and project lists still carry those fields.

**Never sent to the model:** source documents during *generation* (only during extraction), and any
fact whose disclosure is **Private**. Private facts are filtered before the request is built, not
after the response returns.

### 4.3 Prompt caching in the import pipeline — verified figures

Cache reads cost **0.1×** base input tokens, 5-minute cache writes **1.25×**, 1-hour writes **2×**.
Minimum cacheable prompt for `claude-opus-5` is **512 tokens**.

**Use the 1-hour TTL for the import pipeline, not the 5-minute default.** Extraction chunks run as
separate Workflow steps and may be spread over more than five minutes — especially after a retry —
so the default TTL would expire mid-import and every chunk would pay a fresh cache write. Paying 2×
once beats paying 1.25× per chunk.

**What silently invalidates the cache**, and therefore must stay byte-identical across chunks: the
`cache_control` breakpoint position, `tool_choice`, the thinking configuration, `output_config.effort`,
the presence or absence of images, and **key ordering inside `tool_use` blocks**.

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
7. Scrub and sort          → shape-based Private defaults (§7), then the importer's grade becomes
                             the stored provenance, disclosure and flags
8. Deduplicate             → drop candidates whose (quote, claim) hash matches an already-judged fact
9. Persist as ACCEPTED     → with their flags, in one batch; progress is visible as each chunk lands
10. Flag likely repeats    → once, when every chunk is in (below)
```

**Step 9 accepts every fact that reaches it** (decided 2026-10-08, #57). Nothing waits as a
candidate and nothing is rejected by the pipeline. Step 6 is the one place a candidate is not kept,
and it is not a judgement about the claim: a quote that is not in the document is the invented fact
§4.1 exists to keep out. A fact is flagged when it is confidential, when its claim states a number its
quote does not, when the importer was unsure of it or graded it Generated, and when it likely repeats another. A
flag is a row with a reason (`04` §3.13); it gates nothing.

**A number** is a figure as the flag reads one (`unsourcedNumber`, `src/pipeline/flags.ts`, with
patterns of its own so the career record's bolding is unchanged): a year followed by a word or a
counter (`2023 tickets`) is a quantity, a number keeps its scale (`five hundred`, `$2.5M`, `10k`),
each end of a range counts (`30-40%`), and a compound's next word is its noun (`5-person`); but
not a year alone, a digit inside a word or after a word and a hyphen (`COVID-19`), a version or
address, or a technology's own digits, so `in 2023`, `S3` and `Java 17` flag nothing; a kanji figure with its counter (三割, 五名) counts. It
is flagged unless the quote holds the same complete quantity: the same number on its own (`1,200`
and `１２００` match `1200`; `140` does not match `40`, nor `5` the `5` of `one in 5` or `$5`), the same
scale or none (`5 million` is not `5`), and the same unit or counter with an immediately attached
rate or comparison (`3カ月` is not `3カ国`, `5` is not `5%`, `5 users per month` is not
`5 users per year`). A plain descriptive word from a short list (`active`, `senior`)
may be inserted within the phrase on either side (`5 million active users` sources `5 million users`);
a word that changes the quantity never does. Any other word before the unit may stand in the claim
only when the passage uses it as a whole word (`5 clinic reports` from a passage about the clinic's
5 reports), and never in the passage alone (`5 reports` is not `5 hospital reports`); a percentage's
`of` reads through determiners to its unit and attached rate (`5% of all clinic reports` is not
`5% of all clinic revenue`).
A predicate after the unit does not change the quantity, and with no unit the first word after the
number stands for one and the clause after it is not compared (`a team of 5 shipped the app` sources
`a team of 5 shipped the mobile app`). A ratio (`one in 5`, `3 out of 5`, `2/5`) is
one figure, and neither of its numbers sources a plain count; a year after `in` dates a count and is
no denominator (`top 3 in 2022` sources `top 3`). It is also
flagged when there is no quote (issue #115).

**Facts imported before this still wait as candidates.** `POST /api/facts/sort` grades them through
`gradeFacts`, twenty-five to a call, accepts them and writes the same flags; the client asks
again until none are left. A fact the model returns no grade for, or a grade missing a field, is
accepted as Generated and flagged. A fact the author ruled on or edited during the call is left
alone (`07` §6). It never loosens a disclosure the author already set.

> ### Two verified platform constraints that shape this pipeline
>
> **1 · A Workflow step result is capped at 1 MiB.** Steps therefore **pass IDs, never text.** No
> step returns the uploaded file, the extracted text, a chunk body, or a generated render; each step
> re-reads what it needs from Postgres by ID. `ReadableStream<Uint8Array>` is the documented escape
> hatch if a large binary return ever becomes unavoidable.
>
> **2 · Multi-statement writes use `db.batch([...])`, never `db.transaction()`.**
> **Verified against `drizzle-orm@0.45.2` source, not documentation:** `db.transaction()` on the
> `neon-http` driver **throws** — `neon-http/session.js:151` is literally
> `throw new Error("No transactions support in neon-http driver")`. The same file's **batch** path
> (line 131) calls the Neon driver's `client.transaction(builtQueries, queryConfig)`, so
> **`db.batch([...])` executes as a genuine single non-interactive transaction** and is atomic.
>
> This matches the constraint the driver imposes anyway: every multi-statement write must be a
> **fixed sequence of statements**, not a read → decide-in-JavaScript → write loop. Accepting a
> proposal (insert version → update `current_version_id` → mark proposal accepted) and finishing an
> import both qualify.
>
> If a future feature genuinely needs an interactive transaction, the driver moves to
> `neon-websockets` — and note that in Workers a WebSocket `Pool`/`Client` **cannot outlive a single
> request handler**.

**Step 3 is the answer to PRD §8's re-import row** — all three clauses at once. Accepted facts are
not duplicated, only genuinely new content is extracted, and rejected facts stay rejected, without
the app ever reasoning about fact identity. A 15%-changed document costs roughly 15% of a fresh
extraction.

**One document is read at a time, per user** (#93, `09` Flow 8). An upload stores its version as
`queued` and asks the queue (`src/pipeline/queue.ts`) to start the next; so does a retry, and so
does the end of every run, done or failed. The queue is the `import_status` column and nothing
else: one conditional `update` claims the oldest `queued` version as `extracting` when none is,
and the partial unique index `sdv_one_extracting_uq` refuses a second claim that races it. There
is no batch row, so every import survives on its own. On the Workflow path the next document gets
a Workflow of its own, started from a `start-next` step of the one before. Its instance ID is the
version ID; uploads, `start-next`, Home and Documents reads attempt to restore a missing instance
for an `extracting` row, and restart one that is complete or errored (`ensureWorkflow`). Recovery
is best effort: a Workflow API error is logged without content and the next poll tries again. It
does not fail a status read or an upload or retry whose rows are already saved. A launch that fails
marks its version `failed` and advances the queue. A run that throws past its steps marks its
version `failed` (`Extraction stopped before it finished.`) rather than leaving it `extracting`,
which would hold every import behind it. A retry requeues only a `failed` version.

**Zero facts extracted is a failure, not an empty success** (PRD §7). The document is retained and
the author can retry or capture manually.

**Two M3 additions, specified 2026-09-28** (decision log, 2026-09-28). Both are built, the second
by #36 and the first by #35:

- **A document can carry an employer, set at import and changeable after it.** A fact's employer is
  **read through its document**, not copied onto it: step 9 still persists every candidate with no
  employer of its own, and the fact resolves to its document's employer. Changing the document's
  employer therefore moves every fact that reads through it, with no copy to fall behind. **A fact
  whose employer the author set by hand on its card keeps it**, including a hand-set `No employer`.
  When a document's employer and its project's differ, the document's wins. Every place that
  resolves a fact's employer (the render, Version Edit, the attribution check and the overlap
  matcher) reads the same order: the fact's hand-set employer, then its document's, then its
  project's (decision log, 2026-09-28). The order is one SQL definition, shared by the Worker and
  the attribution script (`04` §3.12).
- **Since 2026-10-08 the overlap check below also writes a flag.** A fact accepted on arrival has no
  open card to compute a match on, so step 10 runs the same matcher over the version's new facts and
  stores a `repeat` flag on each that has a match, with a reason that says when the number differs.
  The flag stores that a pair exists; which facts make the pair is still computed on the read, for a
  candidate and for an accepted fact whose `repeat` flag is open. A fact is not matched against
  facts read from the same version of the same document. The check runs again for a fact whose claim
  or employer is edited, for a document that is refiled and for a project moved to another employer.
  Every write that changes which accepted facts stand beside each other (those, the end of an
  import, a sort, a reject and an undo) then settles the flags: one whose pair is gone (the other
  fact rejected, returned to candidate, reworded or filed elsewhere) is marked checked, one the
  system closed that way is reopened when its pair returns, and a reason that no longer says
  whether the numbers differ is rewritten. A flag the author marked checked is never reopened
  (`src/server/services/repeats.ts`).
- **Overlap with facts already in the record is flagged, not deduplicated · built (#36).** Step 8 only catches
  exact repeats. The same claim in other words, from a different document, has a different hash. A
  candidate is shown the existing facts at the same employer that likely say the same thing, and a
  likely match with a different number is marked as a conflict (PRD §8). The author settles it with
  Accept and Reject. It is built **before the first portfolio is reviewed**, so that review is the
  first to use it.
  **"Likely the same" is a lexical match between claims, computed on read and stored nowhere**
  (decided 2026-09-28). `src/overlap/` scores a candidate's claim against each accepted fact's
  claim at the same employer by weighted shared words (Latin words stemmed, Japanese as kanji and
  katakana pairs, plus named technologies), with numbers compared separately: a match is a
  conflict when both carry numbers and neither's set contains the other's. It compares claims and
  never quotes, because both sides were stated plainly by the same extraction prompt. It is not a
  model call: what a candidate is compared with changes with every accept, reject, claim edit and
  employer pick, so a stored judgement would go stale, and a call on read cannot sit in a list that
  polls. **Known limit:** a restatement in the other language shares only numbers and technology
  names and is missed. A model confirming the lexical shortlist is the upgrade if that bites.

### 5.1 Turning an uploaded file into text

| Format | How | Milestone |
|---|---|---|
| `.md`, `.markdown`, `.txt` | `await file.text()` — **no library**. `plaintext-1` | **M1** |
| `.docx` | Unzip with **PizZip**, read `word/document.xml`, walk `w:p` elements into paragraphs (`src/pipeline/docx.ts`). `docx-1` | M3, #94 |
| `.pdf` | `unpdf`, a serverless build of PDF.js, **proved on workerd** (decision log, 2026-10-16). Printed lines are joined into paragraphs by the rule `src/pipeline/pdf.ts` states; a PDF with no text layer is refused. `pdf-1` | M3, #94 |

**M1 needs `.md` and `.txt` only.** The author's case studies are Markdown, produced by a standing
prompt inside each work repository. Supporting four formats in M1 would mean carrying three Workers
compatibility risks for a document type M1 never sees.

**Word and PDF are in scope from 2026-10-16** (decision log, that date): some of the author's
documents are Word, and the author asked for the import to take more than one kind. Other types
(`.doc`, `.rtf`, `.odt`, `.pages`, HTML, images) are refused with a reason naming the ones that
work. Each format stamps its own `extractor_version`.

**PizZip, not `fflate`, unzips a `.docx`.** It is already a dependency, and the 履歴書 render has
run it on workerd since 2026-09-08; `fflate` would have been a second zip library proved for the same
job. **The `docx-1` rule:** every `w:p` in `word/document.xml` is one line, in document order and
table cells included, and an empty paragraph is an empty line. `w:t` is the text, `w:tab` a tab,
`w:br` a line break (a page or column break is nothing). Tracked deletions, the old location of a
tracked move (`w:moveFrom`; its new location, `w:moveTo`, is read), field codes, paragraph and run
properties, and the `mc:Fallback` copy of a text box are not read; nor are headers, footers,
footnotes or comments. The text is the document with its tracked changes accepted: a paragraph
whose mark is a tracked deletion or the old side of a move (`w:pPr/w:rPr/w:del`, `w:moveFrom`)
ends no line of its own, what is left of its text joins the paragraph after it, and a paragraph
deleted whole contributes nothing.

**The `pdf-1` rule.** A PDF's line breaks are where the layout ran out of width, not paragraphs. A
page's printed lines are read in content order; pieces on one baseline have a space when their
positions leave a gap wider than one fifth of the font size, and touching pieces join directly. A
paragraph ends at a page end, at a blank line, or where the gap to the next baseline is more than
1.5 times the larger font size of the two lines.
Its lines are joined by one space, or by nothing beside Japanese or after a hyphen, which is kept.
Each paragraph is one line of the text. **A quote across a wrapped line therefore anchors as the
sentence reads**, with a space where the print broke; a quote that keeps the printed break is not
verbatim and is discarded, as §4.1 says of any other near miss.

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
queued proposal → generate → RenderContent → English language/name check → ready proposal
                → diff(current, proposed) → split-view review
                → accept  → new version, dated, retained forever
                → reject  → dismissed proposal, retained but NOT in version history
```

An English output whose headings or blocks exceed the 5% Japanese-script limit (excluding names
held only in Japanese), or whose checked record-name mentions differ, is generated once more. If
the second attempt also fails, the proposal is marked failed with a plain reason and no content is
offered for review. Japanese renders do not use this check (`src/render/language.ts`).

The name check requires a recorded employer name as a whole word in each named résumé experience
heading, a school name in each education row, and an independent project name in each project row.
Each keyed career-story chapter must contain its recorded employer name. Generic section titles do
not require a name. The check also rejects near-miss spellings in headings and rows, including a
longer name that contains another recorded name.
Prose checks longer names in name-like context; names shorter than six characters are checked
only immediately after `joined`, `at`, `for`, `with`, `left` or `from`. Ordinary prose words are
left alone. A `Date` label followed by a year, date or date range is not treated as a misspelling
of a short name such as `Data`.

Accept is **all-or-nothing** (decision log, 2026-08-12). `.docx` is assembled from the stored
`RenderContent` **on download**, never stored. The document reader uses the same inputs as that
version's download to assemble its page without building the file (`10` Screen 17), except a
履歴書's: its template is filled and the page's form read back out of the filled file
(`src/render/sheet.ts`), so the screen cannot set out a form the file does not.

**A tailored résumé runs through this pipeline unchanged** (2026-10-08, #57). It is a `renders` row
of kind `english_resume` carrying a job description, addressed by its own id where a main document
is addressed by its kind (`src/server/services/render-ref.ts`), so generate, diff, accept, history,
edit, restore and download are the routes every document has. It is given exactly the facts the
main résumé is given. The job description is printed in the prompt between tags, named as text to
read and not a source of facts, with the rule that a skill the job asks for and no fact states is
not written.

**The English résumé is laid out from the record, and the model writes only its summary and bullets**
(#107). A generation requires a nonempty model-written `summary` section; output without it is
refused. A version stores that section and one section of bullets per employer, keyed
`employer:<id>` like a story's chapters, plus `project:<id>` for an independent project. On download
`src/render/resume.ts` joins them by id to what the record holds today: each job's company, city,
`Mon YYYY – Present` dates and every title held there, the skills curation, the education past
secondary school (a vocational programme and a row with no level included, by the rule in
`src/shared/education.ts`), the current technical certifications and a Languages line. The
`.docx` (`src/render/resume-docx.ts`), the PDF (`src/render/resume-pdf.ts`, §6.3), the Markdown and
a sent copy's page are written from that one assembled document. The per-employer bullet budget is computed from the record and printed in the
prompt. Before the model call, every employer, project and education name in the generation spec
must contain a Latin letter and no non-Latin letters; this includes entries the file later omits.
Assembly also refuses Japanese script in any printed field and names with non-Latin letters. A
version from before #107 may hold a heading-led `experience` section; when present, its groups are
joined to employers by the attribution check's name resolution. A group naming no included employer
prevents download instead of printing a model-written job heading. Legacy versions remain editable
under their stored section shape, including versions without an `experience` section.

**The master document is not in this pipeline.** `GET /api/master-document` reads the record in one
batch and groups it (employer, then project, then fact); no model is called, nothing is stored and
there is no version. It lists every accepted fact, Private and Generated included, and no source
text. `src/render/master-document.ts` writes the same structure as Markdown for the download.
`?language=ja` names the record as a Japanese document does, by the renders' `nameInLanguage`, and
changes no claim (#59).

### 6.1 The diff engine

Two passes, because one pass is unreadable:

1. **Align paragraphs** between the current and proposed versions by similarity, not by position.
   Unmatched blocks are genuine additions or removals. Without this, a single inserted sentence
   shifts everything after it and the whole document reads as changed.
2. **Diff tokens inside each matched pair** using jsdiff `diffArrays` — Myers, the same algorithm
   git uses, at word granularity instead of line granularity.

Visible section headings are compared by section key before that section's blocks. A changed,
added or removed heading becomes its own change; headings of sections with no blocks are omitted.

**Tokens:** words and punctuation for English; **BudouX phrases** for Japanese.

**Alignment keys:** English blocks are compared on the same words. Japanese blocks are compared on
**character bigrams**, not phrases: a phrase carries its particle, so a short bullet that changes one
particle loses half its phrase matches and would show as a whole line out and another in. One Jaccard
threshold, 0.4, serves both (decision log 2026-10-25). What is shown stays phrases.

**Alignment scope:** a block pairs only with a block in the same employer group. In an `experience`
section the opening paragraphs align first and each pair of groups aligns its own rows and bullets;
any other section is one group. A block moved to another employer is a removal and an addition.

**Location:** every change names the section heading it sits under and, in an `experience` section,
the opening paragraph of its employer group, so a 職務経歴書 bullet can be placed without opening
the document.

Verified end to end on the author's real 職務経歴書 prose:

```
ベンダー依存の既存システムを[+イベント駆動型の]内製プラットフォームへ置き換える
DX推進に従事し、レイテンシを[-40%削減しました。][+55%削減しました。]
```

Marks land on phrase spans. A changed figure is one phrase replaced, not a scatter of characters.

**Every change must carry a rationale** (`10-screen-specifications.md`): block changes use their
`factIds` to explain the supporting facts or removal; heading changes explain that the heading is
written with its section and has no fact to cite. A change with no explanation is a defect.

### 6.2 How the 履歴書 template reaches the runtime

§30 draws the line: documents are built, forms are filled. The English résumé is assembled
paragraph by paragraph; the 履歴書 is `templates/rirekisho.blank.docx` with its placeholders
substituted. That template is a binary file, and a Worker has no filesystem to read it from.

**It is a `Data` module.** `[[rules]] type = "Data", globs = ["**/*.docx"], fallthrough = true` in
`wrangler.toml` makes `import template from "…/rirekisho.blank.docx"` an `ArrayBuffer`, emitted
beside the bundle as its own module rather than inlined into the JavaScript. `fallthrough` keeps
wrangler's implicit default rules — notably `.bin` as `Data` — in play. Verified against the
installed wrangler's own config schema and by a `--dry-run` build, which carries the 13,864-byte
module alongside the entry point.

**The suite needs the same rule stated a second time.** `@cloudflare/vitest-pool-workers` reads
module rules from its own options, not from `wrangler.toml`, unless it is pointed at that file —
which would also pull in bindings the suite deliberately replaces. So `vitest.config.ts` carries
`modulesRules: [{ type: "Data", include: ["**/*.docx"], fallthrough: true }]`. Without it Vite tries
to parse the `.docx` as JavaScript and the import fails before workerd sees it.

`src/render/rirekisho-template.ts` owns the `ArrayBuffer`, placeholder shape and
`fillRirekishoTemplate()`; it calls `src/render/rirekisho-layout.ts` before and after the fill.
`docs/04` §4 owns the template and page-layout contract. Deriving the rows remains the render's job.

### 6.3 The English résumé's PDF

**PDF is the résumé's default download, Word the second** (#109, `06` 2026-10-22). The 履歴書 and
the 職務経歴書 have one too since #117 (§6.4); the two stories do not, and `?format=pdf` on either is
`409`. Like the `.docx` it is assembled on each request from the same assembled document and never
stored; a sent copy keeps the `.docx`.

**Built with `pdf-lib` and `@pdf-lib/fontkit`**, pure JavaScript with no filesystem, canvas or
browser. The suite builds and reads back every PDF inside workerd (`tests/resume-pdf.test.ts`,
`tests/resume-download.test.ts`), which is the proof that it runs where the route runs.

**Set from the `.docx`'s numbers, not a copy of them.** `src/render/resume-docx.ts` exports the page
sizes, margin, sizes, colours, line pitch, paragraph spacing, bullet indent and rule, and the PDF
lays out lines and pages itself from those: wrapping at spaces and splitting an oversized token at
character boundaries without adding a hyphen or losing text, dates right-aligned on the first line,
keep-with-next chains reserving the whole following block when it has three lines or fewer or its
first two lines when it can split, paragraphs of three lines or fewer kept whole, and the larger of
one paragraph's space-after and the next one's
space-before, as Word does. Checked against Word 16.114's own PDF of the same `.docx`: the same
line breaks, the same page break, every baseline within 0.2 pt.

**Carlito, embedded whole.** `templates/fonts/` holds Carlito Regular, Bold and Italic (SIL OFL 1.1,
`OFL.txt` beside them), imported as `Data` modules like the 履歴書 template (§6.2; a `**/*.ttf` rule in
`wrangler.toml` and in `vitest.config.ts`). Carlito is metric-compatible with the `.docx`'s Calibri,
so lines break in the same places, and it covers every Latin letter a name can hold. They are not
subset: `pdf-lib`'s subsets drew most letters as nothing in Preview and Quick Look. A file is about
0.9 MB. Ligatures are off, as Word leaves them. There is no fallback font: a character Carlito has no glyph for (a ✓, a ★,
an emoji) refuses the PDF with `409`, naming the character and where it sits and pointing to the
Word file, rather than drawing a blank the `.docx` would print.

**Tagged, so the text copies in reading order.** The content is drawn top to bottom, and the file
carries a structure tree (`Document` › `H1` name, `P`, `H2` headings, `L` › `LI` › `Lbl`/`LBody`
bullets; the heading rules are artifacts). Without it Preview's copy took the right-aligned dates for
a second column and gave them back after each job's bullets. The structure tree is
`src/render/pdf-tags.ts`, shared with the Japanese PDFs.

### 6.4 The Japanese documents: typography, PDFs and file names

#117 (`06` 2026-10-25). The 職務経歴書 and the Japanese story left the generic `toDocx` for their own
renderer, and the 履歴書 and the 職務経歴書 download as a PDF by default, with Word beside it. The
English story still takes `toDocx`.

**One document, four outputs.** `src/render/japanese.ts` assembles the 職務経歴書 or the story from
the version and the record; the `.docx` (`src/render/japanese-docx.ts`), the PDF
(`src/render/japanese-pdf.ts`), the Markdown and the page on the screen are all set from it. Its one
addition to the content is **each employer's header, from the record**. A 職務経歴 group still opens
with one paragraph (§4.2), which the register now asks to be the employer's name and nothing else;
the paragraph is joined to an employer by the attribution check's name resolution and printed as a
header: 会社名 in bold, 雇用形態 beside it, the period at the right margin, and the roles held there
on the line under it, all as the record holds them on the day of the download. A version written
before #117, whose opener also carries a period and roles in the model's words, resolves the same
way. A paragraph naming no employer prints as written. The 職務経歴書's 作成日 reads
`2026年10月23日現在` (`src/render/identity.ts`).

**Typography.** Every run names BIZ UDPGothic for its ASCII, high-ANSI, East Asian and
complex-script text and is marked `ja-JP`; `word/fontTable.xml` carries an entry for the face (its
Japanese name, character set 80, a sans-serif PANOSE) for a Word without it to substitute by, and no
part names Times New Roman. Headings are black, bold, 12 pt, over a 0.75 pt rule; the body is
10.5 pt on A4 with 20 mm margins; every line height is exact (1.5 × the size), so Word and the PDF
break lines and pages from the same numbers. Bullets are `・` with a one-character hang.

**The faces.** `templates/fonts/` holds BIZ UDPGothic Regular and Bold and BIZ UDMincho Regular
(Morisawa, SIL OFL 1.1, `OFL-BIZUDPGothic.txt` and `OFL-BIZUDMincho.txt` beside them), `Data`
modules by the same `**/*.ttf` rule as Carlito. Each is cut down from the published face by
`scripts/build-japanese-fonts.py`: the CP932 repertoire (JIS X 0208 with the NEC and IBM extensions,
so 髙 and 﨑 are kept) plus the Latin, punctuation and symbol blocks, no hinting, and no GSUB, GPOS or
vertical metrics. Whole, the three would have taken the Worker past its 10 MiB limit; cut, the
Worker is 7.6 MiB gzipped.

**A face is cut again for each file** (`src/render/font-subset.ts`). `pdf-lib`'s own subsetting draws
these faces blank in Preview, Quick Look and Ghostscript, as it drew Carlito. Instead every glyph
keeps its id and the outline of each one the page does not draw is emptied, so `cmap`, the widths
and `pdf-lib`'s layout are untouched and only the needed outlines travel. A two-page 職務経歴書 is
about 200 KB; a 履歴書 about 300 KB. A character the face does not hold refuses the PDF with `409`,
naming it and where it sits, as the résumé's does; the Word file still prints it.

**Japanese line breaking** (`src/render/pdf-text.ts`). A line may break between any two Japanese
characters except where 禁則 forbids it (never before `、。」` or a small kana, never after `「（`);
a run of Latin letters and digits is a word and is kept whole.

**The 職務経歴書's PDF** is laid out as the résumé's is: exact line heights, keep-with-next chains,
three-line paragraphs kept whole, the larger of space-after and space-before. It is tagged
(`H1` title, `H2` headings, `H3` each employer's header, `L` › `LI` bullets), and the period is drawn
after its company, so copied text reads `会社名 雇用形態 期間`.

**The 履歴書's PDF is drawn from its filled `.docx`** (`src/render/rirekisho-pdf.ts`), the same bytes
the Word download hands over and the screen reads its form out of (`src/render/sheet.ts`). It reads
the grid, row height rules, spans, vertical merges, borders, fills, vertical alignment, paragraph
alignment and spacing, run sizes and weights, and a picture in a cell, and places rows as Word does:
a row that does not fit starts the next page, which repeats the table's 年 / 月 header row as an
artifact. MS Mincho is drawn in BIZ UDMincho, fixed-pitch as MS Mincho is, so a cell wraps where the
layout model (`src/render/rirekisho-layout.ts`) counts it; MS Gothic in BIZ UDPGothic; bold Mincho,
which has no bold face here, is stroked as Word emboldens it. It is tagged as a table of rows of
cells in reading order.

**File names** are `履歴書_森山健二_20261023.pdf`: the document, the author's kanji name, and the
day it is built, which is the date it prints. The header carries it as RFC 6266 `filename*`, with an
ASCII `rirekisho_Kenji-Moriyama_20261023.pdf` beside it (`src/server/http/disposition.ts`, shared
with recordings). The Japanese story and the Markdown downloads follow the same pattern; the English
story keeps its old name. A sent copy keeps the name it was stored under.

---

## 7. Confidentiality enforcement points

Confidentiality is enforced in **four** places, deliberately redundantly.

| # | Point | Rule |
|---|---|---|
| 1 | **Ingestion scrub** | GUIDs, IP addresses, email addresses, employee numbers and personal names other than the author's are marked **Private** by default, without asking. Since 2026-10-08 the importer's reading (`confidential`) marks a fact Private too. The shape match is a floor: the importer can add to it and cannot take from it |
| 2 | **Generation input** | Private facts are filtered out **before the request is built**. They never leave the database |
| 3 | **Render output** | Generated-provenance facts are excluded at render time. A Generated fact may be *accepted* into the record; the block lives here |
| 4 | **Logs** | **Server logs never contain source text, fact claims, or render content.** Log IDs and counts only |

Point 4 exists because logs are otherwise a second, un-governed copy of NDA-bound client material
sitting in Cloudflare's log retention. It covers what #57 added: the importer's note on a fact, an
explanation, and a job description are logged as an id and a count, never as text.

**Automatic acceptance (#57) removed the review that used to stand before points 2 and 3, and
loosened neither.** A fact reaches a document only if it is accepted, not Private and not Generated,
exactly as before; what changed is who sets those values first. Making a Private fact usable is
still one fact at a time, by the author's hand, with no bulk action and no default.

**The master document is the one output that holds Private facts**, by the owner's decision
(`docs/06`, 2026-10-08). It is the author's own copy of their record, as the JSON export is, it says
so in its first lines and beside the download button, and it is never an input to a render.

**Source documents never render, export, or appear in any output** (PRD §6.1). They exist to prove
facts.

**The author's own PII** — home address, phone, date of birth — is a **per-render field rule**, not
a disclosure tier. It populates 履歴書 and appears in no other render. This is enforced in the
render spec, not by fact disclosure. The English résumé may use only its separate, opt-in
`resume_phone` field; it never reads the 履歴書 `phone` (`docs/04` §3.2).

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

**The governing rule: a failure never destroys stored content or overwrites an accepted render;
retryable import and proposal failures record their status.**

| Failure | What the author sees | What is logged |
|---|---|---|
| Model unavailable / unusable response | Stated reason + retry. Current version untouched and readable | Provider, status, workflow step, chunk index. **No content** |
| Model credits exhausted | Plain pause reason + retry; import and proposal keep retryable `failed` states (`07` §5, §7). Accepted render untouched | `model_credits_exhausted` with step, and import identifiers (`12` §9). **No content** |
| Import extracts zero facts | Reported as an extraction *failure*, document retained. Retry or capture manually | Document ID, byte size, chunk count |
| Deduplication drops every candidate of a re-import | Zero new candidates, reported as a success with the number of repeats. **Not** the zero-facts failure above | Count only, per import |
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
| 1 | **Cross-document numeric conflicts** — PRD §8 requires two documents asserting different numbers for the same thing to be surfaced. Needs a notion of "the same thing" across documents | **Closed 2026-09-28 by #36.** Surfaced as a flag on the Fact Review card and settled by Accept and Reject (§5). "The same thing" is a lexical match between claims at the same employer, computed on read (§5). Its known limit is a restatement in the other language |
| 2 | **`docx` / `docxtemplater` on Workers** — both assume Node | **Closed 2026-09-08.** Both run on workerd unmodified, under the suite and under `wrangler dev`. `docx` is exercised end to end by `smoke.test.ts`; `docxtemplater` by `rirekisho-template.test.ts`, which fills the committed 履歴書 template. No fallback needed |
| 3 | **Workers CPU budget for `.docx` assembly and long diffs** — **verified**: paid plan gives 30 s CPU per invocation, raisable to **5 minutes** via `limits.cpu_ms`; subrequests 10,000, raisable to 10M. Generous, but a high ceiling does not prove our code fits under it | Measure during M1 |
| 3b | **Anthropic strict-schema complexity limits** — ~24 optional parameters combined across all strict schemas per request, plus internal compiled-grammar limits, returning `400 "Schema is too complex for compilation."` | Headroom, not a risk — **provided extraction stays one small, mostly-required strict tool** |
| 4 | **Paragraph-alignment quality** on heavily restructured renders | Tune the similarity threshold against real proposals |
| 5 | **Japanese generation quality by provider** | **Closed 2026-09-21 without a bake-off.** Anthropic stays the only provider (`docs/06`); quality is judged by eye against `local/JAPANESE/` |

---

## 12. Deferred work register

Everything deliberately postponed, in one place, each with **the trigger that unblocks it** rather
than a vague "later". Scattered deferrals get forgotten; a register gets read.

### Deferred to M2

| # | Item | Trigger / note |
|---|---|---|
| 2 | **Provider bake-off** — Opus 5 vs Kimi K3 vs GPT-5.6 Terra on Japanese renders | **Dropped 2026-09-21** (`docs/06`). Anthropic stays the only provider |
| 4 | **The Message Batches path**, and a lower extraction effort | Decided from the numbers `npm run measure:import` prints for one portfolio imported at today's setting (#92; `06`, 2026-10-16), in an entry of its own. The multi-file queue (`09` Flow 8) left this row on 2026-10-16 and was built by #93 |
| 5 | **`docx` / `docxtemplater` Workers spike** | **Done 2026-09-08** (`docs/06`). Both libraries run on workerd; 履歴書 work is no longer gated on it |
| 5b | **`.docx` text extraction** via `fflate` + OOXML walk | Built by #94 with `.pdf` (`06`, 2026-10-16): some of the author's documents are Word |

### Deferred to M3

| # | Item | Trigger / note |
|---|---|---|
| 8 | **Quick capture** — free text in, Attested facts out | S12. **Built by #95** (`06`, 2026-10-16), at phone width as well as desktop: `captureClaims` (§4), `POST /api/capture` (`07` §6) |

**Promoted out of M3 into M1:** `GET /api/export` (S15), formerly row 9. Neon's free plan retains a
**6-hour** restore window, so the export is the disaster-recovery mechanism rather than a
convenience.

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

**Not built at all in v1:** multi-user features, LinkedIn, the portfolio site.
Application tracking stood in this list until 2026-10-11, when it came into scope (#60, decision
log; `02` §3a). Its technical design is written by the issues that build it, #70 to #77; a phone
layout exists for its screens and, from #95, for Quick capture. The document reader also opens at
phone width (`10` Screen 17).

The responsive boundary is specified in `10` Responsive behaviour. The desktop panes are built
**fluid** (no fixed page widths, panes flex).
