# Decision Log

Append-only. The answer to every future "why is it like this?"

---

### [2026-08-11] Name: Track Record

- **Decision:** The project is called **Track Record**; repo `track-record`.
- **Alternatives considered:** `career-ledger` (the working name it replaced), Dossier, Provenance, Throughline, Rireki (履歴), Ashiba (足場).
- **Reason:** Naming principle agreed in the kickoff session — *name the record, not the output*. The résumé is one render out of five, so a résumé-derived name would lock the product to its least interesting layer.
- **Revisit if:** Domain, npm or GitHub-handle availability turns out to be blocking — availability is **unverified**, and "track record" is a common phrase. Check before any public use.

---

### [2026-08-11] Build for one user, do not foreclose multi-user

- **Decision:** Serious side project, built for the author first. No multi-tenancy, roles, or settings surfaces in v1 — but no schema decision that assumes exactly one person exists, either.
- **Alternatives considered:** Single-user by construction (simplest, cheapest); multi-tenant from day one (product-shaped, speculative).
- **Reason:** This line is what keeps speculative complexity out while leaving the product option open. The likely wedge if it ever becomes a product is **bilingual** — very little on the market handles 履歴書 and 職務経歴書 properly alongside Western résumés.
- **Revisit if:** A second real user appears, or the project is explicitly abandoned as a product.

---

### [2026-08-11] The app owns all five renders

- **Decision:** Track Record stores career facts as structured data **and generates all five outputs itself** — English résumé, 履歴書, 職務経歴書, and the two career stories (EN/JA). AI generates the prose portions in-app. The current workflow of leaving the record and hand-prompting an assistant against the raw corpus is replaced, not wrapped.
- **Alternatives considered:**
  - *Record only* — app stores structured facts, rendering stays a manual prompting step outside the app. Rejected: the record would be all input and no output, unrewarding to maintain, and none of the three stated pains (slow updates, non-repeatable output, wholesale rewrites) would actually be fixed.
  - *Record + deterministic renders only for structured formats* — app generates 履歴書 (a rigid form) and feeds the rest. Rejected: leaves the highest-frequency artifacts (résumé, 職務経歴書) outside the system, so the loop stays half-manual.
- **Reason:** The outputs are the reason the record exists. An app that produces the record but not the documents moves the work rather than removing it.
- **Revisit if:** Generating publication-quality 職務経歴書 prose proves to need more hand-tuning than it saves — in which case the fallback is app-owned structure with a human-edited prose layer, not a return to raw prompting.

---

### [2026-08-11] All five renders are AI-generated, but every change lands through a reviewed diff

- **Decision:** The app generates all five documents, **including both career stories**. No generated output ever replaces the stored version silently. Each regeneration produces a *proposed* version; the author sees a diff against the current version, and accepts or rejects it. Every accepted version is retained and restorable.
- **Alternatives considered:**
  - *Human-authored stories, app fact-checks only* — recommended during the interview on the grounds that the stories' value lies in admitting failures an AI wouldn't volunteer. Rejected on a factual correction from the author: **the existing career stories were themselves AI-generated** from the other documents, so the premise that they are irreplaceable hand-written work was wrong.
  - *Generated first draft, then human-owned forever* — rejected as unnecessary once diff review exists; the review gate provides the same protection without freezing the document.
  - *Full regeneration with no review* — rejected: this is exactly the current pain (wholesale rewrites that silently discard prior hand-tuning).
- **Reason:** The risk was never generation itself, it was **unreviewed overwrites**. A diff-and-accept gate removes that risk while keeping the app's full authorship of all five outputs. It also converts the kickoff's third pain into a solved problem rather than a tolerated one.
- **Prior art to draw on:** Word Track Changes / Google Docs Suggesting mode (per-change accept/reject granularity, and the closest fit since three renders are `.docx`); GitHub pull-request review (the review-a-proposed-version model); Google Docs / Notion version history (restore as the safety net).
- **Known hard part, deferred to Phase 4:** diffing Japanese prose. Japanese has no inter-word spaces, so word-level diffs require a segmenter; character-level diffs on Japanese are unreadable.
- **Revisit if:** Review friction makes the author stop regenerating altogether — at which point the fix is coarser granularity (accept whole sections), not removing the gate.

---

### [2026-08-11] Capture is document ingestion, not repository access

- **Decision:** New material enters Track Record by **importing a document** — the long per-project technical case study the author already generates by running a standing prompt inside a work repository — plus **short manual capture** for work that leaves no repository trace. The app reads the imported document and proposes structured facts; the author accepts or rejects each one. **The app does not connect to any work repository, ticket system, or git host in v1.**
- **Alternatives considered:**
  - *Git / ticket integration* — automatic harvesting from commits and issues. Rejected on three grounds: (1) the repositories are client-owned and private, on a corporate network, so pointing a personal side project at them is an NDA and credential-handling problem rather than an engineering one; (2) the strongest career material (a vendor negotiation, a network diagnosis, an enterprise migration runbook) left almost no commits, so automated harvest would over-represent the least interesting work; (3) the author already has a working generator, so the app would be rebuilding it.
  - *Manual structured data entry only* — rejected: it is data entry, and data entry is what gets skipped on a busy week.
  - *The app owns the case-study generation prompt itself* — deferred, not rejected. It requires repository access, so it inherits problem (1).
- **Reason:** Capture is not actually missing today. What is missing is the step **after** capture: nothing distils the long document into reusable facts, so every render re-reads the whole corpus. Ingestion is the smallest change that closes that gap.
- **Revisit if:** The author's own repositories (personal projects, open source) become a significant share of the record — those carry no NDA constraint and could be read directly.

---

### [2026-08-11] Facts carry provenance; impact framing happens at render time

- **Decision:** Every fact in the record stores a **provenance tag** with three possible values — **Measured** (an observed number, with a pointer to the passage that proves it), **Attested** (true and done by the author, but not numeric), **Generated** (inferred or estimated by a model, not yet confirmed). **A Generated fact is never used in any render** until the author promotes it to Measured or Attested. Facts are stored plainly; résumé-style impact phrasing is applied **at render time**, not baked into storage.
- **Alternatives considered:**
  - *Store facts as already-optimised résumé prose* — which is what the author's existing generation prompt produces (it explicitly instructs the model to "sound amazing" and write like a Staff engineer). Rejected: it launders confident phrasing into the permanent record, and months later there is no way to tell which numbers were measured and which were generated.
  - *A single verified/unverified boolean* — rejected as too coarse. Most of the author's strongest material is true but non-numeric, and a binary flag pushes it into the same bucket as model invention.
- **Reason:** A résumé claim that cannot be defended under interview questioning is worse than no claim. Provenance makes each rendered bullet traceable back to the passage that proves it. Separating storage from phrasing also lets one fact render in two registers — a strong action-verb bullet for the English résumé, and the flatter factual register that 職務経歴書 convention actually rewards, where "sound amazing" would hurt.
- **Revisit if:** The three-value tag proves to be friction at capture time — the fallback is defaulting more aggressively to Attested, not removing the distinction.

---

### [2026-08-11] Confidentiality model: private sources, three-level fact disclosure, scrub-by-default

- **Decision:** Confidentiality is enforced on two separate objects.
  1. **Source documents are always private.** An imported case study is never rendered, exported, or included in any output. It exists solely to prove facts. No per-document decision exists.
  2. **Facts carry a disclosure level** — **Public** (renderable as-is to any employer), **Restricted** (renderable only in generalised form — the client becomes a category, the system becomes a description), **Private** (never renders under any circumstance: other people's names, internal identifiers, tenant/subscription/app IDs, hostnames, IP ranges, employee numbers).
  - **Ingestion scrubs by default.** On import, anything categorically Private by shape — GUIDs, IP addresses, email addresses, employee numbers, personal names other than the author's — is flagged Private without asking. Promotion is possible but never accidental.
  - **The author's own PII is a separate axis, not a tier.** Home address, phone number and date of birth are required by 履歴書 convention and must never appear in any other render. This is a per-render field rule.
  - **Client identity is not named by default.** Where the author's employer was a vendor or SI and the work was for a named client, renders describe the client by category rather than naming it, with a per-render override available.
- **Alternatives considered:**
  - *A single confidential/not-confidential flag* — rejected: it collapses "cannot be said at all" and "can be said in generalised form", and the second category covers most of the author's strongest material.
  - *Classify at render time instead of at capture* — rejected: it re-litigates the same judgment on every render and makes leaks a function of attention rather than of stored state.
  - *Name clients by default* — rejected: it is simultaneously the most impressive-sounding and least defensible detail, the most likely to be NDA-covered, and the one a hiring manager cares least about relative to what was actually built.
- **Reason:** The failure mode is asymmetric. An over-cautious résumé costs a sentence; a leaked client identifier costs a career. Defaults therefore point toward secrecy in every ambiguous case.
- **Revisit if:** A specific client relationship is confirmed in writing as disclosable, in which case the override is used for that client rather than the default being changed.

---

### [2026-08-11] v1 scope: five renders only

- **Decision:** v1 produces the **English résumé, 履歴書, 職務経歴書, and both career stories (EN/JA)** — nothing else. LinkedIn is `LATER`. The portfolio site is out. The legacy master document is **retired**, not supported.
- **Alternatives considered:** Including LinkedIn in v1 (genuinely cheap as a copy-paste text render, and the only one worth arguing about); including the portfolio site; keeping the master document in sync.
- **Reason:** Each render is a format the app must get *conventionally* correct, and 履歴書 alone is a rigid grid with non-negotiable rules. Five is already ambitious; six is where the schedule breaks and the result is five mediocre documents instead of five good ones. Maintaining the legacy master document alongside the new record means running both systems, which is how migrations die.
- **Revisit if:** All five renders reach M2 quality — LinkedIn is the first thing to add, and it should cost very little at that point.

---

### [2026-08-11] Milestones instead of dates, with one review checkpoint

- **Decision:** Success is defined by three ordered milestones (M1 one document end-to-end → M2 all five renders → M3 old workflow retired) rather than calendar targets. The operative success criterion is behavioural: **the date the author stops hand-editing the work-summary corpus.** One calendar entry exists — a **review checkpoint on 2026-11-11** — which is a scheduled question ("is this still moving?"), not a deadline.
- **Alternatives considered:**
  - *The template's 30-day / 6-month targets* — rejected: the author has no fixed weekly time budget and explicitly intends to work on this until it is right. A fantasy date in the brief is worse than no date, because the document stops being believed.
  - *No dates at all* — rejected: the project's stated shape ("until I feel it's perfect", "will continue to grow and evolve") makes *never actually used* a realistic failure mode. The checkpoint is the countermeasure.
- **Reason:** The existing hand-run workflow already produces documents today. Track Record only wins once it is in use, so every scope decision is aimed at making M1 small enough to reach. M1 deliberately excludes four of the five renders and all but one employer.
- **Revisit if:** M1 is incomplete at the November checkpoint — the response is to cut M1 smaller, not to extend it.

---

### [2026-08-11] Six record entities, only one of them expensive

- **Decision:** The record holds **Profile, Employer, Role, Project, Fact, Credential**. Only **Project** uses the heavy document-import-and-distil path; the other five are small forms. **Credential covers certifications and education together** (both are an institution, a name and a date). **Skills are not an entity** — they are derived from facts as candidates, with the author curating which appear and in what order. **Career stories are renders, not entities.**
- **Refinements added after reading the actual render contract in `local/`:**
  - **Employer** must carry 資本金 (capital) and 従業員数 (headcount) alongside a business-description paragraph and 職種 — conventional required fields of 職務経歴書 with no English-résumé equivalent, and therefore easy to omit and discover late.
  - **Project** needs an **employed vs independent** flag. The English résumé renders `PROJECTS` as a section separate from `PROFESSIONAL EXPERIENCE`, so a model that requires every project to hang off an employer cannot render it.
  - **Employment and education entries need a per-render inclusion rule.** 履歴書 convention requires the complete chronological 学歴・職歴 with no unexplained gaps, including non-software employment; the English résumé is free to be selective. The rule is explicit inclusion per render — not deletion, not hiding.
  - **Prose sections are render output, not stored entities** — `PROFILE`, 経歴要約 and 自己PR are generated from facts. 自己PR and 経歴要約 are different registers and need separate generation instructions rather than one shared summary.
- **Alternatives considered:**
  - *Skills as a first-class hand-maintained list* — rejected: it drifts immediately from the work that proves it, which is the exact problem this project exists to solve. Pure derivation was also rejected on its own, because two renders need grouping and ordering that derivation cannot supply.
  - *Separate Certification and Education entities* — rejected as an unnecessary split of identical shapes.
  - *Running all six entities through the import pipeline* — rejected: the author's stated cadences show only project work is frequent and effortful. Certifications, education, roles and employers change a few times a year and are a one-minute form.
- **Reason:** The entity list follows the update cadence, and the cadence is wildly uneven. Modelling the cheap entities as if they were expensive is the obvious over-engineering trap here.
- **Deferred to Phase 4:** the exact 履歴書 field-by-field contract, to be extracted from the actual file in `local/JAPANESE/` when the schema is written. It is a non-negotiable conventional format and guessing at it now would surface as a compliance bug late.
- **Revisit if:** A render turns out to need a field no entity carries — the field is added to an existing entity before any new entity is introduced.

---

### [2026-08-11] Renders are dated versions; applicant tracking is LATER

- **Decision:** Each render is a **dated, versioned document**. Generating a 履歴書 stamps it with the date and keeps it in version history; a later generation with different emphasis is a new version, not a replacement. v1 does **not** track which company a document was sent to, application status, or per-company tailoring rules.
- **Alternatives considered:** An **Application** entity (target company, submission date, status, per-application 自己PR and résumé variants). Deferred, not rejected.
- **Reason:** In Japanese practice 履歴書 is an artifact submitted to a specific employer on a specific day, and 自己PR is usually tuned per application — so the pressure toward per-application tracking is real. But that is applicant-tracking, a different product bolted onto this one. Dated versions retain the essential benefit (the sent document can always be found) at a fraction of the cost.
- **Revisit if:** The author starts a real job search and finds themselves tracking applications outside the app anyway.

---

### [2026-08-11] LLM provider choice deferred to Phase 4

- **Decision:** Whether the generation layer runs on Anthropic or OpenAI models is **deliberately not decided in Phase 1**. It will be settled in `03-technical-design.md`.
- **Alternatives considered:** Picking now to unblock design work.
- **Reason:** Nothing in the brief or PRD changes based on the answer. The requirement is "the app generates prose from structured facts"; the provider is an implementation detail behind that requirement.
- **Revisit if:** A Phase 1 requirement turns out to be provider-specific (e.g. a hard dependency on a feature only one vendor offers).

---

### [2026-08-11] English interface, bilingual content

- **Decision:** The application interface is in **English**. The record holds Japanese content and generates Japanese documents, but interface chrome, labels and actions are English only.
- **Alternatives considered:** A Japanese interface; a bilingual interface with a language toggle.
- **Reason:** When the chrome is also Japanese it becomes visually hard to separate interface from content — and that separation is precisely what the fact-review screen depends on. A language toggle is multi-user product scaffolding for an app with one bilingual user.
- **Revisit if:** The project acquires non-English-speaking users, at which point interface localisation is a product feature rather than a preference.

---

### [2026-08-11] Design references: one aesthetic source, two interaction sources

- **Decision:** **Linear** is the sole aesthetic reference — palette, density, typography, restraint. Every screen inherits its look from Linear and nothing else. Two products are referenced for **interaction mechanics only**, each scoped to one screen: **Grammarly's editor** for the fact-review screen (document with highlighted spans on the left, per-span cards with accept/dismiss on the right), and **GitHub pull-request review in split view** for the diff-review screen (two versions side by side, word-level marks, accept as one decision).
- **Alternatives considered:**
  - *Notion* — proposed initially and rejected: its strength is authoring long documents, and this app reviews generated output rather than authoring it. Adopting its affordances would pull in a prose editor that no requirement asks for.
  - *Three whole-app references treated equally* — rejected: mixing three aesthetics produces three apps. Separating "what it looks like" from "how it behaves" keeps one visual direction while still borrowing proven mechanics.
- **Reason:** Grammarly's editor is the closest existing analogue to the fact-review interaction, but its visual language is not what this project wants. Naming the split explicitly prevents the prototype from inheriting the wrong half.
- **Revisit if:** A render turns out to need genuine in-app prose editing — then Notion's editing surfaces become relevant again.

---

### [2026-08-12] Diff acceptance is all-or-nothing — corrects the Track Changes precedent

- **Decision:** A proposed render version is accepted or rejected **as a whole**. There is no per-change accept/reject.
- **Supersedes:** the "Prior art to draw on" note in the 2026-08-11 diff-gate entry, which cited Word Track Changes / Google Docs Suggesting mode for **per-change granularity**. That precedent is withdrawn; the review-a-whole-proposal model (GitHub pull requests) and version history as a safety net both still stand.
- **Reason:** Accepting 9 of 11 proposed changes leaves the document no longer matching the record. That is precisely the hand-tuning drift this project exists to eliminate, and the rejected changes would be re-proposed on every future regeneration. If a proposed line is wrong, the correct fix is to fix the **fact**, not to edit the render.
- **Alternatives considered:** Per-change accept (rejected, above); per-section accept (rejected — same divergence at coarser grain).
- **Revisit if:** Whole-proposal rejection becomes common because one bad line keeps blocking twenty good ones — the fix would be better fact-level editing from within the diff, not partial acceptance.

---

### [2026-08-12] Dismissed proposals are retained, but are not versions

- **Decision:** Rejecting a proposal retains it as a **dismissed proposal**, visibly distinct from the version history of accepted versions. The stored current version is left byte-identical.
- **Alternatives considered:** Discarding rejected proposals entirely (rejected — generation is not deterministic, so a dismissed draft may contain phrasing worth recovering); storing them in version history alongside accepted versions (rejected — conflates "what my résumé was" with "what was once suggested").
- **Reason:** Cheap to keep, confusing to mix.
- **Revisit if:** Dismissed proposals accumulate to the point of noise — then age them out rather than removing the concept.

---

### [2026-08-12] No confidence scores in the interface

- **Decision:** The interface displays **no model confidence score, percentage or certainty value**. Provenance (Measured / Attested / Generated) is the only trust signal shown. A confidence value may exist internally for ordering candidates; it is never rendered.
- **Alternatives considered:** Displaying the per-fact confidence the prototype introduced (`p 0.96`).
- **Reason:** It is self-undermining — a model-generated certainty number sitting beside a provenance system whose entire purpose is *not* trusting model certainty. It also adds a third trust axis to a screen that already asks the author to set two.
- **Revisit if:** Candidate ordering proves insufficient without exposing the score — expose ordering, not the number.

---

### [2026-08-12] A Generated fact can be accepted into the record; it is blocked at render time

- **Decision:** Accepting a fact whose provenance is **Generated** is permitted. It enters the record flagged and is excluded when any render is produced. The block lives at **render time**, not at review time.
- **Alternatives considered:** The prototype's stricter behaviour — the accept button disabled until the fact is promoted to Measured or Attested.
- **Reason:** At review time the author often lacks the evidence needed to verify a claim. Forcing the choice then means either discarding a useful lead or promoting something unverified — both worse than parking it. The render-time block delivers the same safety.
- **Revisit if:** Generated facts accumulate unreviewed in large numbers — the answer is better surfacing (the overview's amber "Review N →" row), not a harder gate.

---

### [2026-08-12] Dark theme only; desktop only

- **Decision:** v1 ships a **dark theme only** and is **desktop only**, minimum supported width 1280px. Below 1024px the app states that a wider window is required rather than reflowing.
- **Alternatives considered:** Light mode (rejected for v1 — the prototype has none, and a half-built one is worse than none); responsive/mobile support (rejected — the two core screens are irreducibly two-pane: source beside facts, current beside proposed).
- **Reason:** Making only the overview screen responsive would invite use on a device where the very next click fails.
- **Revisit if:** Quick capture (M3) turns out to be something the author wants to do from a phone — that single screen could ship as a separate narrow surface without making the whole app responsive.

---

### [2026-08-12] Hosted, not local-first — the LLM egress argument decides it

- **Decision:** Track Record is a **hosted web application**, not a local-only tool. The record — including NDA-bound client material and the author's PII — lives in a managed Postgres, not on the author's laptop.
- **Alternatives considered:**
  - *Local-only* — one process on the author's machine, SQLite on disk, nothing exposed to a network. Recommended in Phase 4 initially, then **withdrawn**.
  - *Local-first with encrypted sync* — deferred, not rejected. It solves backup, which is a real problem; the v1 answer to backup is Time Machine plus the S15 export.
- **Reason:** The initial local-only recommendation rested on keeping NDA material off third-party disks. That argument does not survive contact with the product: **the import pipeline sends the same case-study text to a commercial LLM API for fact extraction**, which is the core of the application and happens regardless of where the database sits. Once that egress is accepted, a managed Postgres behind authentication is the same category of exposure, not a new one. The risks that remain and are actually addressable are (1) leaking a connection string from the public repo, (2) the LLM provider's data-retention policy, and (3) weak single-user auth — all of which are handled in `03-technical-design.md` rather than by refusing to deploy.
- **Revisit if:** a future capability makes on-device extraction viable at acceptable quality, at which point local-first stops costing the product anything.

---

### [2026-08-12] Stack: Cloudflare Workers · Neon Postgres · Drizzle · Vite + React + Hono

- **Decision:** **Cloudflare Workers (paid, $5/month)** for compute and static hosting, **Cloudflare Workflows** for the import pipeline, **Neon Postgres** (free tier) for data, **Drizzle** as the ORM, and a **Vite + React SPA served as Workers static assets with a Hono API on the same Worker**. Local development runs Postgres in Docker.
- **Alternatives considered:**
  - *Next.js on Vercel* — recommended first and rejected. Vercel Hobby is $0 and zero-config, but the app has no public surface, no SEO, and nothing to server-render, so Next.js's core value does not apply; and Vercel's function-duration limits fight the requirement that extraction be incremental.
  - *Next.js on Cloudflare via the OpenNext adapter* — rejected. A translation layer between a framework built for one platform and a runtime that is not that platform, bought for framework features this app does not use.
  - *AWS or Azure* — rejected on cost shape rather than capability. Both offer a generous 12-month free tier followed by a bill for an always-on managed Postgres, which is the worst possible shape for a database used a few times a month. Avoiding that by keeping Neon means paying a hyperscaler for compute while maintaining IAM, networking and a deploy pipeline for a three-screen single-user app. Azure was additionally defensible on the author's Microsoft certifications; familiarity was judged not scarce enough to buy the complexity.
  - *Cloudflare Workers free tier* — rejected. 10 ms CPU per request is fine for I/O-bound work but not for Japanese segmentation, word-diffing, and `.docx` assembly, all of which are real CPU. It would work until it abruptly did not.
  - *Cloudflare D1 instead of Neon* — rejected. Postgres gives `jsonb`, arrays and full-text search that the fact model wants, and the author already runs a Neon project.
- **Reason:** Cloudflare is the only one of the three candidate platforms whose cost stays flat and low forever rather than expiring after twelve months, and **Cloudflare Workflows is a better answer to this application's hardest runtime problem than anything the alternatives offer**: the import pipeline is roughly 95% waiting on an LLM, Workflows bills only while code executes so waiting on a third-party API costs nothing, and durable multi-step execution survives a redeploy mid-import, retries a failed chunk without redoing the rest, and produces the incremental progress that `10-screen-specifications.md` requires. Drizzle was chosen over Prisma because its migrations are readable SQL and its TypeScript schema can be kept literally in sync with `04-database-schema.md`, so the document cannot drift from the code.
- **Known cost of this choice:** a Vite/Hono SPA is less defaulted-to by coding agents than Next.js. Judged smaller than the complexity of the OpenNext adapter.
- **Revisit if:** the app acquires a public surface (the portfolio site is explicitly a separate product), or Workers CPU limits become binding on `.docx` generation.

---

### [2026-08-12] No object storage in v1

- **Decision:** Source documents, extracted text and generated `.docx` renders are stored **in Postgres** — original bytes in `bytea`, extracted text alongside. No S3, Azure Blob or R2.
- **Alternatives considered:** Object storage for uploaded documents and generated files, which the author's initial infrastructure list assumed.
- **Reason:** The PRD puts the entire existing corpus at roughly **2.4 MB of prose**. Source documents, extracted text and generated renders together are single-digit megabytes for years. Object storage would add a second credential, a second failure mode and a second thing to back up, in order to store less data than a phone photo.
- **Revisit if:** the record starts holding binary assets that are genuinely large — scanned certificates, portfolio images. Moving to object storage is then a one-table migration.

---

### [2026-08-12] Local development shares the schema, never the data

- **Decision:** Migrations are applied to both local and production databases, so the **schema** stays in sync. **Data does not.** Local development runs Docker Postgres seeded with invented data; production is the only place the author's real record exists.
- **Alternatives considered:** Cloning production into local development, or using a Neon branch of the production database for local work — the obvious reading of "local dev should sync with the deployed stuff".
- **Reason:** The real record is NDA-bound client material plus the author's home address, phone number and date of birth. Copying it into a development database multiplies the number of places it exists for no benefit, and `CLAUDE.md` already requires that test fixtures and seed data be invented rather than sampled.
- **Revisit if:** a production data bug proves impossible to reproduce against invented data — in which case the answer is a better anonymised fixture, not a copy.

---

### [2026-08-12] Generation layer: Anthropic `claude-opus-5`, behind a two-function provider seam

- **Decision:** The generation layer runs on **Anthropic, model `claude-opus-5`**, for both fact extraction and render generation. This settles the choice deliberately deferred on 2026-08-11. The provider is reached through a **two-function seam** — `extractFacts(sourceText, context) → CandidateFact[]` and `generateRender(facts, renderSpec) → string` — and nothing else in the application knows a model exists.
- **Alternatives considered:**
  - *Claude Opus 4.8* — rejected outright. Previous generation at an identical $5 / $25 per million tokens, so choosing it buys nothing.
  - *GPT-5.6 Sol* ($5 / $30, rising to $10 / $45 on long-context requests) — rejected: costs more per output token than Opus 5 with no capability this product can name in exchange.
  - *GPT-5.6 Terra* ($2.50 / $15) — **not rejected; queued for the M2 bake-off.**
  - *Kimi K3* ($3 / $15, 1M context) — **not rejected; queued for the M2 bake-off, and the challenger most worth beating.** Moonshot published its weights publicly, which is the same insurance one layer down that story S15 (export the record) provides at the data layer — relevant because the brief intends this to be a permanent system of record maintained over years.
  - *Grok 4.5* ($2 / $6) — rejected on two concrete grounds: per-call tool billing ($5 per 1,000 calls) is a poor fit for a pipeline built on function calls, and xAI's current API data-retention and training terms have not been read by either the author or the agent. Routing NDA-bound client material through unread terms is not acceptable.
- **Reason:** At this workload the entire cost spread between the cheapest and most expensive candidate is roughly **$15 per year** — extracting the whole 2.4 MB corpus once costs about $3.00 at Opus 5 rates — so cost decides nothing and the best available output should simply be bought. Long context and strict-schema function calling are available on every candidate, so they decide nothing either. What genuinely differentiates them is **Japanese generation quality in two specific registers** (the flat factual voice 職務経歴書 rewards, and the persuasive voice of 自己PR and キャリアストーリー), which no public benchmark measures. That question is answered empirically, not by specification — and the ground truth already exists in `local/JAPANESE/`.
- **Consequence — the M2 bake-off:** when the Japanese renders are built, generate 職務経歴書 from identical facts on `claude-opus-5`, Kimi K3 and GPT-5.6 Terra, and compare each against the author's existing hand-produced document. Cost of the experiment is roughly $2.
- **Standing rule before committing to any provider:** read that provider's current API data-retention and training policy. Anthropic does not train on API inputs by default; the others must be verified rather than assumed.
- **Revisit if:** the M2 bake-off shows a challenger writes materially better Japanese — the seam makes the swap a config value and one adapter file.

---

### [2026-08-12] BudouX resolves the Japanese word-diff problem

- **Decision:** Japanese prose is segmented for diffing with **[BudouX](https://github.com/google/budoux)** (Google, ~15 KB, no runtime dependencies), which splits text at 文節-scale phrase boundaries — the exact unit `10-screen-specifications.md` §Japanese variant specifies for diff marks.
- **Alternatives considered:**
  - *`Intl.Segmenter` with `granularity: 'word'`* — built into Node and every modern browser, zero dependencies, and therefore the first thing tried. **Rejected on measured evidence:** it over-splits badly, breaking `そごう` into `そご`/`う` and `レイテンシ` into `レイ`/`テン`/`シ`. Marks on those boundaries would be close to unreadable.
  - *kuromoji.js (MeCab/IPADIC port)* — morphologically accurate, but ships a ~15 MB dictionary, which is a poor fit for a Worker and far more precision than a diff needs.
  - *Character-level diffing* — already forbidden by the PRD and the design system.
- **Reason:** Verified against the author's real 職務経歴書 in `local/JAPANESE/` — 62 long paragraphs parsed. Chunks average 7–9 characters, boundaries land at phrase scale, mixed Latin/Japanese runs stay intact, and parenthesised technology lists segment cleanly. The one observed flaw is an occasional split of `〜に|よる` where `による` is a single unit; an over-split boundary yields a slightly smaller changed span, never an unreadable one.
- **Consequence:** the "hardest known technical problem" flagged on 2026-08-11 is a library call plus a token-level diff, not a research task.
- **Revisit if:** review of real diffs shows the `〜による` class of over-split is actually distracting — the fallback is a small post-processing rule that merges known particle-plus-auxiliary pairs, not a different segmenter.

---

### [2026-08-12] Better Auth with Google OIDC; no Cloudflare Access

- **Decision:** Authentication is **Better Auth**, with **Google as the OIDC provider**, running in the Hono API on Workers with the Drizzle adapter against Neon. The application is **publicly reachable**. Cloudflare Access is not used.
- **Alternatives considered:**
  - *Cloudflare Access (Zero Trust, free to 50 users)* — recommended first and **withdrawn**. It is the stronger pure-security answer, because no unauthenticated request reaches application code at all. Rejected on two grounds: it is an internal-tools gate priced at $7/user that **cannot become product authentication**, so it would have to be ripped out precisely when the author had other priorities; and the author has shipped Better Auth with Google OIDC repeatedly, which defeats the generic "hand-rolled auth is a liability" argument that motivated the recommendation.
  - *Hand-rolled email-and-password* — not seriously considered once Better Auth was on the table.
- **Reason:** Better Auth supplies the `user` table that PRD §1's "no design decision may assume exactly one person exists" requires — every Employer, Role, Project, Fact and Credential foreign-keys to `user.id` — so the constraint is satisfied by a library that was going to be installed anyway rather than by an invented parallel table. It is also the only option of the two that survives the brief's stated product wedge.
- **Accepted cost, and its mitigation:** a publicly reachable app means an unprotected route is a real leak rather than an inconvenience. Mitigation is **deny-by-default routing** — Hono middleware requires a valid session on everything except the auth callback routes, so a forgotten route fails closed. This is asserted by test, not by convention.
- **Revisit if:** never expected; the fallback if the app is compromised is to put Access in front temporarily, which requires no code change.

---

### [2026-08-12] Publicly reachable, allowlisted sign-up, isolation tested from day one

- **Decision:** The application is reachable by the public, because the author may ship it for other users in future. **Sign-up is allowlisted to the author's Google account.** Multi-user features are not built. Every data query filters by `user_id`, and that filtering is covered by tests from the first query written.
- **Alternatives considered:** open sign-up (rejected — the database holds NDA-bound client material today, and a stranger creating an account against that deployment is not a risk worth carrying for an option that may never be exercised); keeping the app private and revisiting later (rejected by the author).
- **Reason:** "Reachable by the public" and "supports other users" are different decisions, and the brief puts the second firmly out of scope while naming perfectionism as the risk most likely to kill the project. The schema and auth layer never assume the author is alone; nothing else is built for anyone else. The one thing that genuinely changes engineering *today* is row-level isolation: a missing `where user_id = ?` is invisible in a single-user app and hands one person's career record to another in a multi-user one. Enforcing it from the first query costs nothing; retrofitting it means auditing every query ever written.
- **Revisit if:** a second real user is actually onboarded — at which point removing the allowlist is a config change and the isolation tests already exist.

---

### [2026-08-12] Re-import extracts only from changed passages; fact identity is anchored to the source quote

- **Decision:** Every import is stored as a **version of a source document**, retaining full text. On re-import, the new text is diffed against the previous version and **only changed or added passages are sent to the model**. Untouched passages are never re-read, so no fact drawn from them is ever re-proposed. As a secondary guard, every fact stores a normalised hash of the **verbatim quote** it was extracted from; a candidate whose quote and claim both match an already-judged fact is dropped before the author sees it.
- **Alternatives considered:**
  - *Compare candidate claim text against existing facts* — rejected. The model rephrases, so `Cut deploy time by 40%` and `Reduced deployment time 40%` are one fact and two strings; the author would be re-asked constantly.
  - *Semantic deduplication by embedding similarity* — rejected. It would work, but requires a vector column, an embedding model and a similarity threshold to tune, in order to answer probabilistically a question that document diffing answers **exactly**. "Which parts of this document are new" has a correct answer, not a likely one.
- **Reason:** This satisfies all three clauses of PRD §8's re-import row at once — accepted facts are not duplicated, only genuinely new content is proposed, and previously rejected facts stay rejected — without the app needing to reason about fact identity at all. It reuses the diff machinery the review screen requires anyway, and re-importing a 15%-changed document costs roughly 15% of a fresh extraction.
- **Deferred to M2 as a named open problem:** PRD §8 also requires that **two documents asserting different numbers for the same thing** be surfaced as a conflict. That needs a notion of "the same thing" across documents, which is a harder modelling problem than anything above. It is **impossible in M1** (one document, one employer), so it is recorded in `03-technical-design.md` as an open problem rather than half-solved now.
- **Revisit if:** authors of the same document reorder passages wholesale, making the diff report near-total change — in which case the quote-hash guard carries more weight and may need to become the primary mechanism.

---

### [2026-08-12] Renders are stored as structured content; `.docx` is built on download

- **Decision:** A generated render is stored as **structured content** — an ordered list of sections, each holding blocks, and **every block carries the IDs of the facts it was generated from**. `.docx` is assembled from that structure **on demand at download time** and never stored. Markdown is generated from the same structure for on-screen reading. The two career stories are stored as an ordered list of **chapters**, not as a prose blob.
- **Alternatives considered:**
  - *Store the generated `.docx` as the canonical version* — rejected. Two Word files cannot be meaningfully compared, so the entire diff-review gate (S5) would not function.
  - *Store renders as Markdown* — the obvious choice, and rejected for one specific reason: a Markdown bullet is a line of text with nowhere to record which facts produced it. Story S6 requires every rendered line to resolve to exactly one fact, and the diff screen's rationale bar must state *"From 2 measured facts · <source>, L63 and L79"*. Markdown cannot carry that mapping.
  - *Store career stories as two Markdown documents* — rejected. S11 requires EN and JA chapters to correspond one-to-one; two blobs make that unenforceable, while two chapter lists make it checkable.
- **Reason:** The author raised this as a cost question — that Word generation is token-heavy and regenerating during early iteration would be expensive and slow. **The premise does not hold in this architecture: the model never produces the `.docx`.** The model produces content; the application assembles the file deterministically in code, which costs zero tokens and takes milliseconds. What costs money is generating the words, once per regeneration, regardless of output format. For reference, a résumé regeneration is roughly 7k tokens in / 3k out — about **$0.11** — so a hundred regenerations while tuning prompts costs around **$15**, and the `.docx` assembly across all hundred costs nothing. The conclusion the author reached is correct; the reason is that a binary rebuildable in 20 ms is not worth storing, not that it saves tokens.
- **Revisit if:** a render needs formatting that cannot be expressed in the block structure — in which case the structure gains a block type, not a change of storage format.

---

### [2026-08-12] Two `.docx` strategies, because 履歴書 is a form and the others are documents

- **Decision:** The **English résumé and 職務経歴書 are built programmatically** with the `docx` npm library. **履歴書 is filled into a blank template** using `docxtemplater`, whose open-source core covers the table-row loop the 学歴・職歴 table needs. The two career stories are **not `.docx` at all** — they are read on screen.
- **Alternatives considered:**
  - *One strategy for all three* — rejected in both directions. Building 履歴書's grid programmatically means recreating dozens of table cells and hoping the result passes, against an acceptance criterion that is literally "submit it without a Japanese hiring manager noticing anything off". Templating the résumé and 職務経歴書 is worse, because their length and section count vary with the record.
  - *HTML or Markdown converted via pandoc/LibreOffice* — rejected: not runnable in a Worker.
- **Reason:** 履歴書 is a **form** — a fixed grid whose correctness is conventional and non-negotiable — so the layout should be preserved rather than reconstructed. The résumé and 職務経歴書 are **flowing documents** with nothing fixed to preserve.
- **Confidentiality note:** the 履歴書 template committed to this public repo must be the author's real file **with every value stripped** — no name, address, date of birth, and empty tables. The populated file never enters the repo.
- **Scope:** only the English résumé is required for M1. 履歴書 and 職務経歴書 are M2; the direction is recorded now because it costs nothing and prevents a wrong assumption hardening.
- **Known unknown, recorded rather than guessed:** neither `docx` nor `docxtemplater` has been verified to run on Cloudflare Workers, which is a constrained runtime and both libraries assume Node. This is roughly an hour of testing and does not block M1. Fallbacks if either fails: generate the file in the browser, or move that one step to a Node-compatible runtime.
- **Revisit if:** the Workers spike fails for both libraries.

---

### [2026-08-12] Neon branching: dev branches copy production data

- **Decision:** Development uses **Neon branches created from `main`**, carrying a full copy of the production data. The earlier "local development shares the schema, never the data" entry is **narrowed**: it still forbids committing data to the repo and still requires invented fixtures for tests, but it no longer forbids a dev branch holding the real record.
- **Alternatives considered:** a long-lived `dev` branch seeded with invented data, plus ephemeral branches off `main` used only for migration dry-runs and deleted immediately. Recommended, and **overruled by the author.**
- **Reason (author's):** it is the author's own data and the author is the only developer, so a second copy under the same account is not a meaningful increase in exposure.
- **Standing constraint that survives this:** **no database dump is ever committed to the repo**, which is public. Test fixtures and seed data remain invented, per `CLAUDE.md`.
- **Revisit if:** a second developer joins, at which point dev branches must be reseeded rather than copied.

---

### [2026-08-12] Zustand for UI state, TanStack Query for server state

- **Decision:** **Zustand** is installed from the start for client UI state. **TanStack Query** owns all server data. The boundary is explicit: Zustand holds only ephemeral interface state — which fact card is selected, which filter pill is active, which diff change is highlighted. It never holds records fetched from the API.
- **Alternatives considered:** plain React state until a screen felt awkward, then adding Zustand. Recommended on the grounds that the app's client state is per-screen and shared only between sibling components. **Overruled by the author**, whose argument is that retrofitting state management once the screen count grows costs far more than installing it now.
- **Reason:** the author's reasoning is sound, and the risk it introduces is not the library but the boundary. Server data duplicated into a client store produces two copies of the same record with no rule for which is authoritative — the exact mess the decision is meant to avoid. Writing the boundary down is what makes the choice safe.
- **Revisit if:** Zustand ends up holding anything that came from the database.

---

### [2026-08-12] Diff engine: Myers over tokens, not over lines — two-pass

- **Decision:** Diffing uses the **`diff` library (jsdiff), `diffArrays` over a token list** — the same Myers algorithm git uses, applied at word and phrase granularity instead of line granularity. Two passes: **first align paragraphs between versions by similarity, then diff tokens inside each matched pair.** Tokens are words and punctuation for English, **BudouX phrases** for Japanese.
- **Alternatives considered:**
  - *Git-style line diffing* — rejected. Git compares lines because in code a line is a meaningful unit; in prose a paragraph is one very long line, so a two-word edit would mark the whole paragraph changed.
  - *Single-pass token diff with no paragraph alignment* — rejected. An inserted sentence shifts every following token out of alignment, so the rest of the document reads as changed. The alignment pass is what allows unchanged paragraphs to render identically at full opacity, which `10-screen-specifications.md` requires.
  - *`diff-match-patch` (character-level with semantic cleanup)* — rejected: character granularity is explicitly forbidden for Japanese by the design system.
- **Reason:** the author asked for GitHub's diff model. GitHub's *interaction* model was already adopted in Phase 3; this adopts its algorithm while correcting the granularity. Verified end to end on Japanese prose — BudouX tokens through `diffArrays` produce marks on phrase spans, with a changed figure rendered as one phrase replaced rather than a scatter of single characters.
- **Revisit if:** paragraph alignment produces poor matches on heavily restructured renders — the fallback is a similarity threshold tuned against real proposals, not a different algorithm.

---

### [2026-08-12] One `facts` table holds candidates, accepted and rejected facts

- **Decision:** Candidate facts, accepted facts and rejected facts are **one table** distinguished by a `status` column (`candidate` / `accepted` / `rejected`). Rejected rows are **retained forever**.
- **Alternatives considered:** a separate `fact_candidates` table promoted into `facts` on acceptance (rejected — the quote, offsets, provenance and disclosure would have to exist on both, and deduplication would need to query two tables); deleting rejected candidates (rejected — retaining them is precisely what stops a re-import re-proposing something already judged).
- **Reason:** review is a state change on one object, not a move between two. A single table makes the unique `(user_id, dedupe_hash)` index a one-lookup answer to "have I already judged this?"
- **Revisit if:** rejected candidates grow large enough to affect index performance — the answer is a partial index, not a second table.

---

### [2026-08-12] `credentials` gains `started_on` and `expires_on`; still no seventh entity

- **Decision:** `credentials` carries `kind` (`education` / `certification`), **`started_on`** and **`expires_on`** in addition to the Phase 1 shape of institution, name and date.
- **Reason:** the 履歴書 学歴 section requires **two** dated rows per education entry — 入学 from `started_on` and 卒業 from `awarded_on` — which a single-date shape cannot produce. `expires_on` drives the overview tile's `1 expires Mar 2027` sub-note. This is exactly the case the 2026-08-11 entity decision anticipated: *"a render turns out to need a field no entity carries — the field is added to an existing entity before any new entity is introduced."* Education stays in `credentials`; no seventh entity is created.
- **Revisit if:** education acquires fields certifications cannot share at all.

---

### [2026-08-12] No separate `person` table — `users.id` is the person

- **Decision:** PRD §1's "no design decision may assume exactly one person exists" is satisfied by every record-bearing table carrying `user_id` referencing Better Auth's `users`. **No parallel `person` or `profile_owner` table is created.**
- **Alternatives considered:** a `persons` table separate from auth identity, so the record could outlive an auth provider change (rejected — it duplicates identity across two tables with no rule for which is authoritative, and an auth migration is a data migration either way).
- **Reason:** the constraint is about foreign keys existing, not about a particular table name. `profiles` holds the 履歴書 identity fields and is 1:1 with `users`, which keeps PII in one governed place.
- **Revisit if:** the app ever needs to represent a person who cannot sign in.

---

### [2026-08-12] Education and certifications are separate tables — supersedes the Phase 1 combination

- **Decision:** `credentials` is split into **`educations`** and **`certifications`**.
- **Supersedes:** the 2026-08-11 entity decision, which rejected *"Separate Certification and Education entities … as an unnecessary split of identical shapes."* The shapes turned out not to be identical. `02-product-requirements.md` §2's row *"Credential — one shape covers both"* is stale as of this entry; the PRD is a Phase 1 document and is left as written, with this entry as the correction.
- **Reason:** the split was already visible as strain in the combined table — `started_on` was meaningful for only one kind, `expires_on` for only the other, and a `kind` enum gated which columns were legal. The fields genuinely diverge: education carries faculty (学部・学科), degree, field of study and an **outcome**; a certification carries an issuing organisation, a credential ID and a verification URL. Two tables with honest columns beat one table with half its columns conditionally null.
- **`educations.outcome`** (`graduated` / `completed` / `withdrawn` / `expected`) is a correctness requirement, not decoration: 履歴書 convention requires a withdrawal to read **中退**, not 卒業. Rendering it wrong is a misrepresentation rather than a formatting slip.
- **Two LinkedIn certification fields deliberately not adopted:**
  - *Skills association* — LinkedIn attaches skills directly to a certification. Rejected: it creates a second, hand-authored source of skills alongside the derived one, which is the drift PRD §9.8 exists to prevent. `certifications.technologies` feeds the **same** candidate pool as `facts.technologies` instead, so there is still exactly one place skills come from.
  - *Media attachments* — rejected: there is no object storage, and no render displays them.
- **`credential_id` and `credential_url` are stored but not rendered in v1** — useless to the five renders, useful to the author at renewal time, and two nullable columns.
- **Consequence:** the record now has **seven** entities rather than six. The overview screen's Credentials tile counts both tables together, so no interface change follows.
- **Revisit if:** never expected.

---

### [2026-08-12] Month precision, not day precision, on every calendar column

- **Decision:** Every calendar column in the schema stores a `date` **with the day always `01`**, and the day is **never rendered**. Forms collect month and year only.
- **Alternatives considered:** full `date` precision (rejected — it implies a precision no render uses and forces the author to invent the day they started a job in 2016); a `year`/`month` integer pair (rejected — loses ordinary Postgres date sorting, comparison and arithmetic for no gain).
- **Reason:** noticed while reviewing LinkedIn's certification form, which collects month and year only. 履歴書's 学歴・職歴 and 免許・資格 tables have `年` and `月` columns and nothing finer, and the English résumé and 職務経歴書 are the same. The first draft of `04-database-schema.md` used full dates throughout, which was wrong in a way that would have surfaced as awkward data entry rather than as a bug.
- **Revisit if:** a render ever needs a day. None of the five does.

---

### [2026-08-12] Bootstrap flow: entity extraction from documents the author already holds

- **Decision:** A second extraction target is added — **entity extraction** — which proposes `employers`, `roles`, `educations`, `certifications` and `profiles` fields from an existing 履歴書, 職務経歴書 or résumé. It reuses the same import pipeline and the same card-review interaction as fact extraction; only the target schema differs. **M2.** Added as `09-user-flows.md` Flow 7.
- **Reason:** every flow written before this one assumed an empty record, which is not the author's actual starting position. The existing 履歴書 already contains four employers with industries and dates, seven education entries with 入学 and 卒業, and eighteen certifications. Typing that into forms is an hour of data entry that will be deferred and then skipped; extracting it from a file that already exists is one import. This is the difference between M3 taking an afternoon and taking a month.
- **Rules that fall out of it:**
  - **Entities carry no provenance or disclosure.** Those belong to facts — claims about what the author did. An employer is not a claim.
  - **PII extracted from a 履歴書 populates `profiles` and never becomes a fact.** The author's address is a per-render field rule, not a career claim.
  - **An ambiguous 卒業 / 中退 is never guessed** — `outcome` stays unset until the author chooses. Rendering a withdrawal as a graduation is a misrepresentation.
  - **The bootstrap document is a source document like any other** and, per PRD §6.1, never renders or exports. Importing one's own 履歴書 does not make it emittable.
- **Alternatives considered:** manual forms only (rejected — data entry is what gets skipped on a busy week, which is the same reasoning that produced the import pipeline in the first place).
- **Revisit if:** entity extraction proves less accurate than typing, in which case it becomes a pre-fill for the forms rather than a review flow.

---

### [2026-08-12] An existing hand-written render is never adopted as version 1

- **Decision:** The app does **not** import the author's existing résumé, 履歴書 or 職務経歴書 as `v1` of the corresponding render. Every render version is generated from facts. Existing documents are only ever imported as **source documents** (for entity or fact extraction), never as render versions.
- **Alternatives considered:** seeding `render_versions` with the author's current hand-tuned documents, so the first proposal diffs against the real thing rather than against nothing.
- **Reason:** a seeded version would not be derived from facts, so **no line in it would have a supporting fact**. The rationale bar is required on every change, and it would read *"Removed — no fact in your record supports it"* across the entire document. The first diff the author ever saw would be noise, on the screen the whole review gate depends on. M1's success criterion is a **by-eye** comparison of the generated résumé against the existing one — a better test that requires no feature.
- **Revisit if:** never expected. If the first generated résumé is worse than the hand-written one, the fix is a richer fact model (per the brief's riskiest assumption), not adopting the old file.

---

### [2026-08-12] Sign-up is invite-only — as the model, not as a temporary restriction

- **Decision:** Registration is **invite-only, permanently.** Open sign-up is not a later default that invite-only is holding back; opening it would be a separate decision gated on three concrete preconditions. Today the invite list is a single-address environment variable (`ALLOWED_SIGNUP_EMAILS`); when a second user exists it becomes an `invites` table at the same enforcement point, returning the same `403` and creating no `users` row.
- **Alternatives considered:**
  - *Open sign-up once the app is stable* — rejected. Every user spends the operator's Anthropic budget, so one account importing a 500-page PDF is an unbounded bill against a personal credit card. Growth here is a cost and a legal exposure before it is validation.
  - *A waitlist* — rejected as a product surface for demand that does not exist.
- **Reason (author's, verbatim in substance):** *"I don't want to suddenly have hundreds of users."*
- **Gates that must exist before open registration is even discussable:** (1) a hard per-user spend cap on model calls; (2) per-user rate limiting on the import and generate endpoints; (3) a privacy policy, terms, and an account-deletion path that actually deletes — a legal obligation once strangers store their own PII and their employers' confidential material. A fourth, product-level gate: 履歴書 and 職務経歴書 are currently assumed rather than optional, so a user with a purely Western career would be shown two renders they cannot use.
- **Revisit if:** all four gates are met **and** the author actively wants growth. Meeting the gates alone is not a trigger.

---

### [2026-08-12] One end-to-end smoke test, not an E2E suite — and agent browsing is not testing

- **Decision:** **One** Playwright test in CI, covering the critical path end to end: sign in → import → accept a fact → generate the résumé → accept the proposal → download the `.docx`, asserting a valid zip with the correct MIME type. No broader end-to-end suite. Separately, **Claude Code's browser tooling may drive manual-checklist items 5–7** as exploratory verification.
- **Supersedes:** the first draft of `11-testing-plan.md`, which stated *"explicitly acceptable for v1: no end-to-end browser tests."*
- **Alternatives considered:**
  - *No E2E at all* — recommended first and **withdrawn on the author's challenge.** It left a real hole: nothing would catch **wiring breakage** — auth middleware misconfigured, static assets not served, a route not mounted, the download endpoint returning HTML instead of a file. Every one of those passes unit and API tests and fails the moment the app is opened.
  - *Agent-driven browsing instead of Playwright* — the author's suggestion, and **rejected as a substitute** while adopted as a complement. Three different activities were being conflated: automated regression tests in CI (deterministic, free, every push), agent-driven verification during development (interactive, exploratory, costs tokens per run), and human manual checking. Agent browsing does the second well and part of the third; it cannot do the first, because CI needs determinism and zero marginal cost.
  - *A full E2E suite* — rejected: at three screens and one developer, broad E2E rots fastest and catches least.
- **Reason:** the smoke test is the cheapest possible proof that the deployed application actually works, and it fails for reasons no other test in the plan can see.
- **Revisit if:** a second smoke path is justified — it would be 履歴書 generation, which can fail in ways the résumé cannot.

---

### [2026-08-12] No test coverage target

- **Decision:** The project sets **no coverage percentage**. The eight must-have suites in `11-testing-plan.md` §2 are the target.
- **Alternatives considered:** a conventional 80% line-coverage gate.
- **Reason:** coverage measures lines executed, not failures prevented. It is possible to reach 90% while never asserting that a Private fact stays out of a résumé — which is the single assertion this project most needs. A named list of silent failures is a target that cannot be satisfied by executing code that checks nothing.
- **Revisit if:** a second developer joins, where a coverage floor has value as a social norm rather than as a quality measure.

---

### [2026-08-12] Deploy on merge to `main`; rollback and restore rehearsed before M1 is done

- **Decision:** GitHub Actions deploys on every merge to `main` — type check, tests, migrate, build, deploy, smoke-check `/api/health`. Manual `wrangler deploy` remains available. **The rollback procedure and a database point-in-time restore are each executed once, deliberately, before M1 is called done.**
- **Alternatives considered:** manual deploys only (rejected — the value of CI here is that the tests run, not that the deploy is automated); leaving rollback documented but unrehearsed (rejected — a rollback procedure nobody has run is a hypothesis, and it is exercised for the first time during the incident it was written for).
- **Reason:** migrations run before the Worker deploys, which makes backward-compatible migrations mandatory and makes rollback safe by construction — but only if the path has actually been walked once.
- **Revisit if:** CI outages start blocking urgent fixes; the manual path already exists for that case.

---

### [2026-08-12] A consolidated deferred-work register replaces scattered "later" notes

- **Decision:** `03-technical-design.md` §12 holds a **single register of every deferred item**, each with the trigger that unblocks it, grouped as M2 / M3 / gated-on-second-user / indefinite-with-a-named-fallback. Items leave the table when they ship or when a decision-log entry retires them.
- **Reason:** requested by the author when deferring rate limiting. Deferrals scattered across eight documents are functionally forgotten, and "later" without a trigger is indistinguishable from "never". The register also makes the second-user gates legible as a **group** — rate limiting, spend cap, account deletion, legal documents, error alerting and optional Japanese renders are six items that must land together, and reading them in one block makes clear that inviting a second person is a project rather than a config change.
- **Revisit if:** the register grows past roughly 30 items, at which point it wants to become GitHub issues rather than a table.

---

### [2026-08-12] Styling: Tailwind v4 with `@theme`, plus shadcn/ui used selectively

- **Decision:** **Tailwind v4**, with its `@theme` block generated from `05-design-system.md` and containing nothing else. **shadcn/ui** for a small set of components — Button, ToggleGroup (the provenance and disclosure segmented controls), ScrollArea, Progress, Tooltip, and Dialog at M2 — each **restyled to doc 05 on the day it is added.**
- **Supersedes:** the Phase 4 recommendation of CSS Modules plus a hand-written `tokens.css`, which rested on **two assumptions that are both wrong for Tailwind v4 and current shadcn**:
  1. *"Tailwind duplicates the design system into a JS config, creating a second source of truth."* False in v4. `@theme` registers CSS custom properties **as** design tokens, so `--color-card: #101113` yields both `var(--color-card)` and the `bg-card` utility from one declaration. There is no second source.
  2. *"shadcn is a component library that arrives with opinions to override."* False. shadcn **copies components into the repository**, where they are owned and edited like any other file. It is a code generator, not a runtime dependency, and it fully supports Tailwind v4 and React 19.
- **Reason (author's, and the decisive one):** most of this code will be written by agents, and models write plain CSS less reliably than Tailwind. The mechanism is concrete rather than impressionistic — plain CSS requires inventing class names, managing a separate file, avoiding collisions and remembering what already exists, which is cross-file state, and cross-file state is where models drift. Tailwind colocates styling with the element and constrains the available values.
- **The three guardrails, without which this choice is unsafe:**
  1. **`@theme` is generated from doc 05 and holds nothing else** — a utility cannot exist unless the design system defines it.
  2. **Arbitrary values are lint-banned** (`no-arbitrary-value` in `eslint-plugin-tailwindcss`, off by default and needing tuning for a known false positive on square brackets used in attribute selectors). `p-[13px]` and `text-[#fff]` are how the forbidden list dies quietly.
  3. **A shadcn component is restyled to doc 05 the day it is added.** Its defaults ship a palette and radii that contradict the design system; deferring the edit produces a half-Linear, half-shadcn interface.
- **Not taken from shadcn:** cards, panels and badges. `05-design-system.md` specifies those completely and shadcn's versions would fight it.
- **Alternatives considered:** CSS Modules + tokens + stylelint (the withdrawn recommendation); vanilla-extract or StyleX, where an off-scale value is a **type error** — the strongest possible enforcement, rejected on setup cost and kept as the escalation if drift becomes real; a conventional component library such as MUI, rejected outright.
- **Revisit if:** the interface starts reading as a generic shadcn application rather than the Linear-derived design in doc 05 — the countermeasure is the manual design-conformance checklist item, not a change of tooling.

---

### [2026-08-12] File-to-text extraction: Markdown only in M1, OOXML parsed directly, and versions are never re-extracted

- **Decision:** `.md` and `.txt` in M1, handled by `await file.text()` with **no library**. `.docx` at M2, by unzipping with `fflate` and walking `word/document.xml` directly. `.pdf` **deferred, possibly permanently.** `source_document_versions` gains an **`extractor_version`** column, and **an existing version is never re-extracted in place.**
- **Alternatives considered:**
  - *Supporting all four formats in M1* — rejected. The author's case studies are Markdown, produced by a standing prompt inside each work repository, so M1 never encounters the other three. Supporting them would mean carrying three Cloudflare Workers compatibility risks for documents M1 does not see, and it inflated the pre-M2 spike unnecessarily.
  - *`mammoth` for `.docx`* — rejected, and not on dependency weight. Parsing OOXML directly means **we control paragraph boundaries**, and paragraph boundaries are what line numbering is built on. A library that changed its paragraph handling in a minor release would silently move every line number in the record. The direct approach was verified against the author's real 履歴書 and 職務経歴書 during Phase 4.
  - *`unpdf` for `.pdf` in v1* — deferred. Every document the author holds exists as `.docx` or Markdown.
- **The `extractor_version` rule, and why it is not optional:** fact quote offsets index into `extracted_text`. If the extractor ever changes how it emits paragraphs or whitespace, every stored offset points somewhere subtly wrong — and **nothing surfaces the problem**, because the offsets still resolve to *some* text. Storing the extractor version and forbidding in-place re-extraction means a parser upgrade produces a **new** document version with fresh offsets, while the old version keeps the text its facts were verified against. Asserted by test.
- **Revisit if:** a document arrives that exists only as a PDF.

---

### [2026-08-12] Backups: accept a 6-hour restore window; export is promoted to M1

- **Decision:** Stay on Neon's **free** plan. `GET /api/export` (story S15) is promoted from `SHOULD` · M3 to **`MUST` · M1** and becomes the project's disaster-recovery mechanism.
- **What prompted it:** verification against Neon's own documentation, not a search summary. The Free plan retains **6 hours** of change history capped at 1 GB, and point-in-time restore is supported on **root branches only** — so dev branches have none. `12-deployment-devops.md` had implied an open-ended window.
- **Alternatives considered:**
  - *Automating exports off-platform* — a Cron trigger writing a weekly JSON snapshot somewhere durable. Rejected for now: it reintroduces the object storage `03-technical-design.md` deliberately removed, for a record measured in single-digit megabytes.
  - *Upgrading Neon to Launch* for a 7-day window — rejected: real monthly cost against a stated free-tier-first preference.
- **Residual risk, accepted explicitly:** six hours covers a mistake noticed immediately. Anything older is recoverable only from the most recent export, which means **the backup is worth exactly what the habit of running it is worth.**
- **Revisit if:** the record starts feeling irreplaceable — the first move is automating the export, not upgrading the database.

---

### [2026-08-12] Zero data retention declined for now, and gated on the second user

- **Decision:** **No ZDR arrangement is requested from Anthropic.** Standard API retention applies to extraction and generation requests, which carry NDA-bound client material.
- **Reason (author's):** the record is the author's own data, and the author accepts the risk on their own behalf.
- **Correction this entry records:** Anthropic's structured-outputs documentation is labelled "ZDR Eligible", which is easy to misread as meaning requests using structured outputs are automatically zero-retention. They are not — **ZDR is an organisation-level arrangement requested from Anthropic's sales team.** `claude-opus-5` is eligible; Claude Fable 5 and Claude Mythos 5 are designated Covered Models requiring 30-day retention and **cannot** use ZDR, which is a further point in favour of the model already chosen.
- **Gate:** requesting ZDR moves onto the second-user checklist in `03` §12. At that point the material sent to the model belongs to someone who has not accepted this risk, and the author's own tolerance stops being the relevant standard.
- **Revisit if:** a specific client relationship imposes a written data-handling obligation that standard retention does not satisfy — that would make ZDR a requirement rather than a preference, before any second user.

---

### [2026-08-12] Design-system enforcement is structural: `@theme { --*: initial }`

- **Decision:** The Tailwind theme is declared with **`--*: initial`**, which disables every default Tailwind theme variable, followed by the values from `05-design-system.md` and nothing else.
- **Reason:** verification found this documented capability, and it converts the design system's forbidden list from a review convention into a structural impossibility. With the default theme switched off, **`bg-red-500`, `p-7` and `rounded-xl` do not exist as utilities.** Rule 1 ("no new colors") and rule 7 ("no off-scale spacing or radii") can no longer be violated, rather than merely being caught. This directly answers the concern that motivated the earlier plain-CSS recommendation — that agents drift from a design system nobody is checking.
- **What remains human-enforced**, because no tool can check it: three font weights per screen, no emoji, green/amber/red never decorative, no disabled control without a stated reason, no confidence scores, and border style carrying meaning. These sit on the manual design-conformance checklist.
- **Revisit if:** never expected.

---

### [2026-08-12] Route enumeration for the deny-by-default test uses a project-owned registry, not Hono internals

- **Decision:** Routes are registered through a **thin project-owned wrapper** that records each route in a module-level array. The deny-by-default test reads that array.
- **Supersedes:** the original description in `08` §4 and `11` §2.1, which said the test would walk "the Hono router's registered routes".
- **Reason:** verification found that **`app.routes` is not part of Hono's documented API** — the documented surface is `get`/`post`/`all`/`on`/`use`/`route`/`basePath`/`notFound`/`onError`/`mount`/`fetch`/`request`, and `hono/dev`'s `showRoutes` is a development utility. Resting one of this project's two load-bearing security controls on an undocumented property is how a guarantee quietly stops working after a minor upgrade — **and it would still pass, because an empty route list trivially satisfies "every route returns 401".** A test that cannot fail is worse than no test, because it is believed.
- **Secondary benefit:** registering a route without going through the wrapper becomes a reviewable mistake rather than an invisible one.
- **Revisit if:** Hono documents a stable public route-introspection API.

---

### [2026-08-12] Import pipeline uses the 1-hour prompt cache TTL, not the 5-minute default

- **Decision:** Extraction requests set a **1-hour** `cache_control` TTL on the source document and system prompt.
- **Reason:** verified figures — cache reads cost 0.1× base input, 5-minute writes 1.25×, 1-hour writes 2×, and the default cache lifetime is 5 minutes. Import chunks run as separate Workflow steps and can easily span more than five minutes, especially after a retry, so the default TTL would expire mid-import and every chunk would pay a fresh cache write. **Paying 2× once beats paying 1.25× repeatedly on a cache that keeps expiring.**
- **Also recorded:** the minimum cacheable prompt for `claude-opus-5` is 512 tokens, and the cache is invalidated by changes to breakpoint position, `tool_choice`, thinking configuration, `output_config.effort`, presence or absence of images, and **key ordering inside `tool_use` blocks** — all of which must stay byte-identical across the chunks of one import.
- **Revisit if:** imports routinely complete inside five minutes, where the 5-minute TTL is cheaper.

---

### [2026-08-12] Why TypeScript and Hono rather than Go or another compiled language

- **Decision:** The API stays **TypeScript on Hono**. Go — or any compiled language — is not adopted.
- **Honest framing first:** this was **never a Hono-versus-Go comparison.** Hono followed from choosing Cloudflare Workers, which runs JavaScript and WASM; the router was a consequence, not a decision. This entry exists because the question was asked and the answer had never been written down.
- **Reason — performance is not a constraint this application has:**
  1. The import pipeline is roughly **95% waiting on an LLM**. That is I/O, and no language waits faster. The genuine CPU work is BudouX segmentation, a token diff, and `.docx` assembly over documents of a few hundred kilobytes — milliseconds either way, for one user.
  2. **V8 isolates are not the slow option.** The instinct favouring a compiled language is about steady-state throughput; what dominates real latency is cold starts, and Workers isolates start in single-digit milliseconds — faster than a containerised Go service waking on Cloud Run or Fly. Hono is a thin router and is not where time goes.
  3. **Adopting Go means reopening the hosting decision and losing what decided it.** Go on Workers means TinyGo to WASM: awkward, larger bundles, thin ecosystem. Realistically Go means Fly, Railway or Cloud Run — which forfeits **Cloudflare Workflows** (durable steps, unbilled waiting, resume after redeploy), forfeits the flat $5 with scale-to-zero, and splits one deployable unit into two. The import pipeline would be rebuilt as a job queue with a retry table, or on Temporal.
  4. **The library story is materially better in JavaScript here.** BudouX's reference implementation is JavaScript. `docx` and `docxtemplater` have no clean Go equivalent — the main Go OOXML library is commercially licensed and the alternative is hand-rolling OOXML. Go's strongest Japanese option, kagome, is a dictionary-based morphological analyser — the heavier class of tool already rejected in favour of BudouX.
  5. **One language means one type contract.** The Drizzle schema, the API and the React client share types end to end. Two languages means maintaining that boundary by hand, which for a solo developer is a standing tax.
- **Alternatives considered:** Go on Cloudflare Workers via TinyGo/WASM (rejected — ecosystem and bundle cost for no gain); Go on Fly / Railway / Cloud Run (rejected — forfeits Workflows and the cost shape, and reopens a settled decision); Rust (same objections, plus a steeper cost to a solo maintainer).
- **Revisit if:** this becomes a genuinely multi-tenant product with sustained traffic, **or** profiling shows CPU rather than model latency as the bottleneck. Neither is plausible at one user — and if it ever happens, the two-function model seam and a Postgres database mean the API layer is the **cheapest** component to rewrite.

---

### [2026-08-12] Multi-statement writes use `db.batch()`; `db.transaction()` throws on `neon-http`

- **Decision:** Every multi-statement write goes through **`db.batch([...])`**. **`db.transaction()` is never used** while the application is on the `neon-http` driver.
- **How this was settled:** by reading the **shipped driver source**, not documentation — which had left the question open. In `drizzle-orm@0.45.2`, `neon-http/session.js:151` is literally `throw new Error("No transactions support in neon-http driver")`. The same file's batch path (line 131) calls the Neon driver's `client.transaction(builtQueries, queryConfig)`, so **`db.batch([...])` executes as a genuine single non-interactive Postgres transaction and is atomic.**
- **Why this is a non-event for the design:** the constraint `db.batch` imposes — a fixed statement list decided up front, with no read-then-decide-then-write step inside the transaction — is the same constraint already recorded when the HTTP driver was chosen. The two places it matters, accepting a proposal and finishing an import, both satisfy it. Only the API call changes, not the architecture.
- **Alternatives if it had gone the other way:** the underlying `sql.transaction([...])` from `@neondatabase/serverless` directly, bypassing Drizzle; or moving to the `neon-websockets` driver, which supports interactive transactions but whose `Pool`/`Client` **cannot outlive a single request handler** in Workers.
- **This finding is version-specific.** Recheck if Drizzle's `neon-http` driver ever gains transaction support.
- **Revisit if:** a feature genuinely requires reading inside a transaction and deciding what to write next — at which point the driver, not the query, is what changes.

---

### [2026-08-21] Next.js reconsidered and rejected again — on corrected grounds

- **Decision:** The client stays a **Vite + React SPA with a Hono API**. Next.js is not adopted, in any configuration.
- **Why this entry exists:** the 2026-08-12 stack entry rejected Next.js partly on grounds that **have since been withdrawn as inaccurate**, and a decision resting on a bad argument is worth re-deciding even when the outcome is unchanged.
- **What was withdrawn:** that entry described the OpenNext adapter as "a translation layer … and a standing source of works-locally-breaks-deployed." **That is not supported by the current state.** Cloudflare publishes an official Next.js framework guide, and the support matrix is nearly complete — App Router, Pages Router, Route Handlers, React Server Components, SSR, SSG, ISR, Server Actions, response streaming and middleware are all supported; only Node.js middleware is not. Next.js 15 and 16 are supported. "It does not work well on Cloudflare" is no longer a valid objection.
- **A middle option was raised by the author and taken seriously: Hono mounted inside Next.js**, at a catch-all route handler. It is coherent, and it **removes the strongest objection** — the route registry and deny-by-default middleware survive intact, because they depend on Hono owning the API surface, not on Vite. It was briefly recommended.
- **Why it was rejected anyway, on the author's instinct that it "feels weird" — which was correct:** it means running a server-rendering framework whose entire value proposition is bypassed twice. The API is bypassed because Hono owns it; the UI is bypassed because every screen is client-side interactive behind authentication. The result carries Next.js, the OpenNext adapter, and a custom worker wrapper for the Workflow exports, in order to ship what is functionally a single-page application.
- **The fluency argument, weighed properly rather than assumed:** the flip to Next.js rested on "agents write Next.js better", the same argument that won for Tailwind. Measured, the delta here is **roughly twenty lines of routing setup instead of file-system conventions** — React components, the Hono router and the data layer are identical either way. That is not comparable to plain CSS versus Tailwind, where the gap was large *and* the tool actively enforced the design system. The precedent was over-applied.
- **Also corrected:** shadcn/ui is not a reason to choose Next.js. It is a code generator that works with Vite + React.
- **The governing principle, recorded because this question will recur:** *choose the smallest thing that spans the requirements.* Every gap between what a framework assumes and what is being built resurfaces later as configuration, and configuration is where "works locally, breaks deployed" lives. More importantly — the hard parts of this project are Japanese phrase-level diffing, quote-anchored extraction, 履歴書 fidelity and four-point confidentiality. **None of them is a frontend framework problem.** The stack should be boring so that attention goes to the parts that are not.
- **Revisit if:** the portfolio site (explicitly a separate product) is ever merged into this application, which would introduce a genuine public, SEO-sensitive surface.

---

### [2026-08-21] TanStack Router for client routing

- **Decision:** **TanStack Router** handles client-side routing.
- **Note on provenance:** this had **not** been decided before. `TanStack Query` (server state) was chosen on 2026-08-12 and is a different library; the two were briefly conflated. Recorded here so the log does not imply a decision that was never made.
- **Alternatives considered:** React Router v7 (equally fine; the choice is close to arbitrary at three screens); Next.js file-system routing (see the entry above).
- **Reason:** type-safe, Vite-native, and small. Three screens plus the M2 forms do not need more.
- **Revisit if:** never expected.

---

### [2026-08-21] The stack is frozen

- **Decision:** The stack below is **settled**. Changing any part of it now requires a decision-log entry naming a **triggering problem** — something that does not work, or a requirement that cannot be met — **not a preference, a comparison, or a newer alternative.**

  Cloudflare Workers (paid) · Cloudflare Workflows · Hono · React + Vite · TanStack Router · TanStack Query · Zustand · Tailwind v4 · shadcn/ui · Neon Postgres · Drizzle · Better Auth with Google OIDC · Anthropic `claude-opus-5` · BudouX · jsdiff · `docx` · `docxtemplater` · `fflate`

- **Alternatives surveyed and closed:** Next.js in three configurations (see above); Go and other compiled languages (2026-08-12); Python with Django or FastAPI — **rejected because it forfeits the entire infrastructure plan**: Python does not run on Cloudflare Workers with these libraries, so leaving Cloudflare means losing Workflows (which is why the import pipeline is nine steps rather than a job queue, a retry table and a dead-letter mechanism), losing $5/month flat with scale-to-zero, and reopening roughly twenty settled entries plus two verification rounds — in exchange for a better `.docx` library. Svelte, Vue, Nuxt and Astro — rejected as frontend-only changes that alter nothing about the API, data, pipelines or infrastructure; Astro is additionally built for content sites, while the two core screens are heavy stateful interaction. VoidZero — not a framework; it is the company behind Vite, Rolldown, Oxc and Vitest, all of which this stack already uses.
- **Reason:** `01-project-brief.md` names **perfectionism as the second-order risk most likely to kill this project** — "never actually used" as a realistic failure mode. Re-evaluating an already-verified stack is precisely what that failure looks like from the inside, and the cost of continuing to choose now exceeds the difference between the options. Two verification rounds, 53 prior decisions and two resolved spikes all rest on this stack; each re-litigation risks invalidating work that is finished.
- **This freeze is not permanent and not bureaucratic.** Its only function is to convert "I could use X" from an open question re-litigated late at night into a closed one that needs a reason to reopen.
- **Revisit if:** a triggering problem appears. The November 2026 checkpoint asks whether the project is still moving — **not** whether the stack is still optimal.

---

### [2026-08-29] The AWS alternative was surveyed and does not reopen the freeze

- **Decision:** A full AWS design — CloudFront + Lambda Function URL + Aurora Serverless v2 over the RDS Data API + Step Functions + S3 with versioning and Object Lock, and **no VPC anywhere** — was worked out in detail and is **closed**. The stack frozen on 2026-08-21 stands unchanged.
- **What motivated it:** immutable evidence storage (S3 Object Lock makes a source document physically incapable of being overwritten, and the S3 version ID becomes the anchor fact offsets reference), IAM-based credentials (no long-lived API key to leak from a public repo or rotate), and vendor API stability over a decade.
- **Why none of it clears the bar:** the freeze requires a **triggering problem** — something that does not work, or a requirement that cannot be met. Immutability is a *strengthening* of an invariant the code already holds (a source document version is never re-extracted in place), not a repair of a broken one. IAM is a better credential model, not a response to a leak. Stability is a comparison. All three are preferences, which is exactly what the freeze exists to exclude.
- **Cost was a tie, not a saving:** ~$6–26/month against the current $5 plus the same model tokens — bought at the price of roughly ten IaC components to maintain instead of one Worker, plus cold-start stacking (Lambda cold start on top of Aurora resume from zero) on a project whose named failure mode is *"never actually used."*
- **What to reach for instead, if immutability is the part worth having:** **Cloudflare R2 supports bucket locks** — retention policies preventing overwrite and deletion, for a period or indefinitely. Narrower than S3 (no governance/compliance split, no legal hold) but it covers the core requirement with no new vendor and no egress fees. That is the move, not a platform migration.
- **Two findings kept, independent of platform:** a monthly automated restore drill (see `12` §5) and splitting model calls by whether a human is waiting (see `03` §4). Both are recorded as separate decisions of the same date.
- **The exploration document** is archived outside this repository. It is not needed to act on this entry.
- **Revisit if:** the triggering-problem bar is met — not because the comparison is revisited.

---

### [2026-08-29] A monthly restore drill, because an untested export is not a backup

- **Decision:** A scheduled monthly job loads the most recent `GET /api/export` output into a scratch database and asserts per-table row counts and referential integrity across every foreign key. Failing loudly is the point. **Passing it once is an M1 exit criterion**, alongside the rollback rehearsal (`12` §4).
- **Reason:** the 2026-08-12 entry accepted Neon Free's **six-hour** restore window and promoted `GET /api/export` to M1 as the recovery path for anything older. That makes the export the *only* thing standing between a Wednesday discovery of a Monday corruption and total loss — and it had never been restored. The drill is what turns an accepted risk into a tested one.
- **Not decided:** automating the export itself nightly. The manual export plus a proven restore path is enough while the record is small; `12` §5 already names automation as the first thing to revisit if the record starts feeling irreplaceable.
- **Independent of platform.** This surfaced during the AWS survey (same date) and was kept when that was closed.

---

### [2026-08-29] The model seam distinguishes calls a human is waiting on from calls nobody is watching

- **Decision:** `ExtractionContext` carries that flag from the first commit, though M1 has only one setting for it. Interactive import **streams** so review cards appear incrementally (`09` Flow 2). Bulk work — the M2 bootstrap flow and post-parser-upgrade re-extraction — goes through **Message Batches at 50%**. **No batch path is built in M1.**
- **Reason:** the rule that a parser upgrade creates a new source document version rather than re-extracting in place makes full-corpus re-extraction a **recurring** cost, not a one-off, so Batch halves it permanently rather than once. Building it in M1 would be speculative — one document and one employer is not bulk — but a seam that cannot express "nobody is waiting" has to be reopened to add it later. The cost now is a parameter; the cost later is a signature change through every caller.
- **Independent of platform.** Surfaced during the AWS survey (same date) and kept when that was closed.

---

### [2026-08-30] Pure Next.js — Hono removed entirely — evaluated for the first time and rejected on a verified incompatibility

- **Decision:** The stack is unchanged: **Vite + React SPA with a Hono API**. The configuration examined here — **Next.js owning the API through Route Handlers, with Hono removed from the project entirely** — is closed.
- **Why this entry exists:** the 2026-08-12 and 2026-08-21 entries both compared Vite + Hono against *Hono mounted inside Next.js*. **Pure Next.js was never evaluated.** It is the strongest form of the Next.js case — one framework, one dev server, no second API layer, and none of the redundancy that correctly sank the hybrid — so citing the earlier rejections against it would have been answering a question that was not asked.
- **The finding that closes it: on Cloudflare, none of Better Auth's three middleware options satisfies deny-by-default.**
  - *`getSessionCookie()`* — an optimistic cookie check with no database call. Better Auth's own documentation annotates it `// THIS IS NOT SECURE!` and directs real checks to each page or route. That is **per-route opt-in**, which `07-api-design.md` §Authentication explicitly forbids.
  - *`auth.api.getSession()` inside middleware* — the correct check. It requires `runtime: "nodejs"` in the middleware config, and `@opennextjs/opennextjs-cloudflare` **fails the build** when it detects Node.js middleware — an explicit guard in `build.ts` that logs and calls `process.exit(1)`. Not a limitation to configure around.
  - *`betterFetch` to `/api/auth/get-session` from edge middleware* — supported, secure, and the remaining path. It is an HTTP round-trip from the Worker back to itself on **every protected request**, to validate a session the same isolate could have checked in process.
- **A second, quieter loss:** `11-testing-plan.md` §2.1 asserts deny-by-default by reading a **module-level route registry populated by a registration wrapper**. That works because Hono routes are *registered* — an interceptable function call. Next.js routes are *files*; there is nothing to intercept. The test degrades to walking the filesystem for `route.ts` and importing each to infer its methods — inference in place of registration, weakening the proof of an invariant `CLAUDE.md` lists as expensive to fix.
- **What pure Next.js does not remove:** Cloudflare Workflows still requires a custom Worker entry exporting the Workflow classes. The Worker does not go away; OpenNext is added above it.
- **How this rejection differs from the two before it:** those rested on redundancy and on the governing principle. This one does not. It is a **verified incompatibility** between the proposed configuration and an invariant already asserted by test — the triggering-problem bar the 2026-08-21 freeze asks for, met and pointing at staying.
- **Verification is version-specific.** Checked 2026-08-30 against Better Auth's Next.js integration documentation and the `opennextjs-cloudflare` build source.
- **Revisit if:** OpenNext Cloudflare gains Node.js middleware support. Pure Next.js would then be merely redundant rather than incompatible — at which point the 2026-08-21 reasoning governs again and the answer is still no, but for softer reasons.

---

### [2026-08-30] Import progress and chunk checkpoints are rows, not workflow-engine state

- **Decision:** `source_document_versions` gains `chunks_total`, `chunks_done`, `candidates_discarded` and `changed_region_share`; a new `import_chunks` table holds one row per chunk of changed text, carrying offsets into `extracted_text`, a status of `pending`/`done`/`failed`, and a reason on failure. `04-database-schema.md` §3.6 and §3.6b are updated to match.
- **Reason:** `07-api-design.md` §5 already specifies `GET /api/imports/:id` returning `chunksTotal`, `chunksDone`, `candidatesDiscarded` and `changedRegionShare`, and `11-testing-plan.md` §2.7 already requires that a failure on chunk 7 of 12 keeps chunks 1–6 and that retry resumes at chunk 7. Neither was expressible against the schema as written — the polling endpoint had nothing to read and the resume guarantee had nowhere to remember what had already succeeded. The columns are the contract catching up with the endpoints, not new scope.
- **Why rows rather than Workflow instance state:** the resume guarantee is then true of the *pipeline*, not of the engine running it, so it is asserted by the same over-HTTP tests as everything else rather than requiring a Workflow harness. It also holds when the Workflow binding is absent, which is the case in test and in local development.
- **The chunk body is not stored.** `import_chunks` carries offsets, so no step returns text and the 1 MiB step-result cap is structurally unreachable (`03` §5).
- **`candidates_discarded` is a count and stays one.** No column holds discarded candidate text, in the database or in a log line.

---

### [2026-08-30] The import pipeline is one function; the Workflow is an adapter over it

- **Decision:** The pipeline lives in `src/pipeline/import.ts` as `runImport(deps)`, taking a step-runner. `ImportWorkflow` (`src/pipeline/workflow.ts`) is the production adapter, wrapping each step in `step.do`. When the `IMPORT_WORKFLOW` binding is absent — tests, and local development without a Workflows-capable dev server — the same function runs inline behind `ctx.waitUntil`.
- **Reason:** every durability guarantee the pipeline makes is already a database row (see the entry above), so the step runner controls *retry and checkpoint granularity*, not correctness. Making it a parameter means the pipeline is exercised by ordinary API tests, and the Workflow adapter carries no logic that could drift from what is tested.
- **What is not claimed:** the adapter itself is not covered by an automated test. It is ten lines of `step.do` calls and is verified by the one end-to-end smoke path (`11` §2.9).
- **Revisit if:** a step ever needs to `sleep` or wait on an external event, which the inline runner cannot express.

---

### [2026-08-30] A render proposal row exists from the moment generation starts

- **Decision:** `render_proposals` gains `generation_status` (`generating` · `ready` · `failed`) and `generation_error`. The row is inserted when generation begins, with `content` as `{ "sections": [] }`, and `GET /api/proposals/:id` polls it. `04-database-schema.md` §3.10 is updated to match.
- **Reason:** `07-api-design.md` §7 already specifies `POST /api/renders/:kind/generate` returning `202` **with a `proposalId` to poll**, and `10-screen-specifications.md` already specifies a *Generating* state (proposed column skeletal, current column fully readable) and a *Generation failed* state that states a reason. Neither was expressible: the row did not exist until generation finished, so there was nothing to poll, and a failure had nowhere to record why.
- **`status` and `generation_status` are two different questions.** `status` is the author's decision — pending, accepted, dismissed. `generation_status` is whether the model has answered yet. Collapsing them would make "dismissed while still generating" unrepresentable and put a machine state into a column the author owns.
- **This is what keeps the failure rule true.** A failed generation writes `generation_status = 'failed'` and a reason on the proposal; it touches no `render_versions` row and does not move `renders.current_version_id`, so the stored version is byte-identical and readable afterwards (`11` §2.7).

---

### [2026-08-30] The arbitrary-value ban is a project-owned script, not `eslint-plugin-tailwindcss`

- **Decision:** `npm run lint` runs `scripts/check-design-tokens.mjs`. It fails the build on any arbitrary Tailwind value (`p-[13px]`, `text-[#fff]`) anywhere under `src/client`, and on any raw colour literal outside `theme.css`. Comments are excluded, so prose about the rules does not trip them.
- **Reason:** `05-design-system.md` §8b names `no-arbitrary-value` from `eslint-plugin-tailwindcss`, and that route does not open. The project is on **TypeScript 7**, and `typescript-eslint` declares a peer range of `>=4.8.4 <6.1.0` — installing it needs `--legacy-peer-deps`, which is a silent bet that a parser written for TypeScript 5 keeps handling TypeScript 7 syntax. Without that parser, ESLint cannot read a `.tsx` file at all, so there is no configuration in which the named rule runs. Separately, the plugin's Tailwind v4 support was not verified.
- **What is not lost:** the rule that matters is enforced, in CI, on every file — and it is enforced more strictly than the plugin would, because it also bans raw colour literals, which `--*: initial` cannot reach (an inline `style` attribute bypasses Tailwind entirely). The 2026-08-30 client work found exactly one legitimate exception, the 16px app mark's gradient, and it became an `@utility` rather than a suppression.
- **What is lost:** everything else ESLint would have caught. There is no linting of TypeScript itself in this repository; `tsc --noEmit` under `strict` plus `noUncheckedIndexedAccess`, `noUnusedLocals` and `noUnusedParameters` is what stands in its place.
- **Revisit when:** `typescript-eslint` supports TypeScript 7. At that point the script may stay — it costs nothing and covers the inline-style case — but the rest of ESLint becomes available.

---

### [2026-08-30] The M1 smoke test runs against the Hono app, not a browser — and the browser gap is named

- **Decision:** `tests/smoke.test.ts` walks the whole critical path — signed-out 401 → session → profile → employer → import → extract → promote → accept → generate → diff → accept → download `.docx` — through the real application, with only the session resolver and the model seam stubbed. **The Playwright test `11-testing-plan.md` §2.9 specifies is not built.**
- **Reason:** a browser-level test needs a signed-in session, and the only way to get one without a real Google round-trip is a test-only authentication path. In an application that is **publicly reachable**, holds the author's PII and NDA-bound client material, and whose entire access control is one allowlisted identity, a sign-in bypass that exists in shippable code is a worse risk than the wiring bug it would catch. It is precisely the shape of thing that survives into production because it is only used in CI.
- **What is covered anyway:** four of the six failures §2.9 names — a route not mounted, auth middleware misconfigured, the download endpoint returning the wrong content type, and the path breaking between stages — all fail this test.
- **What is not covered, stated plainly:** static assets not being served, and the SPA failing to mount. Both are single-request failures visible the instant the application is opened, and both are on the manual checklist (`11` §3) until the gap is closed.
- **How to close it:** run the OIDC provider as a fixture rather than bypassing authentication — a local issuer the deployed configuration points at only in a test environment, so the application's own sign-in path is exercised end to end and no bypass exists in the code. That is the shape to build; it was not built here.
- **Revisit before:** the first invited second user, at the latest. A wiring break that only the author would notice is tolerable while the author is the only user.

---

### [2026-08-30] An export restores the record, not the documents the record was read from

- **Decision:** `scripts/restore-drill.mjs` restores `source_document_versions` as **evidence stubs** — the row, its version number, its extractor version and its counts, with `import_status = 'failed'` and a stated reason where the text used to be. Facts keep `quote`, `quote_start`, `quote_end` and `line_number`. The drill reports how many stubs it made. `12-deployment-devops.md` §5 now says this in the document that promises the backup.
- **Reason:** two rules that were each obviously right pointed in opposite directions and had never been read together. PRD §6.1: *"An imported case study is never emitted, exported or included in any output."* PRD S15 and the 2026-08-12 promotion: the export *"is the project's actual disaster-recovery mechanism."* Building the drill is what forced the question — a `NOT NULL extracted_text` with nothing to put in it.
- **Which rule wins, and why:** §6.1. The corpus is not at risk in the way the record is. The case studies are the author's own files, written in the author's own repositories, and they can be re-imported; the record — the accepted facts, the promotions, the disclosures, the accepted render versions — exists nowhere else and is the thing six hours of Neon retention does not cover. Putting NDA-bound client prose into a JSON file the author saves to a laptop, to protect something that is not lost, would be a poor trade.
- **What this costs:** after a restore from export alone, a fact's quote cannot be re-verified against its source until the original file is re-imported. The offsets are preserved and index into the version they were derived from, so a re-import of the *same* file under the *same* extractor version re-establishes the evidence exactly.
- **Revisit if:** the corpus ever stops being reproducible from the author's own machines — for example if a case study is written only inside this application. That would make the source document a primary artefact rather than an input, and the trade above would change.

---

### [2026-09-01] The first real browser run found six bugs a green suite could not

- **Decision:** The M1 vertical tracer is only complete when a **browser** has walked it. `tests/smoke.test.ts` passing is necessary and not sufficient, and issue #1 stays open until a `.docx` has been downloaded from a signed-in session.
- **What happened:** the suite reported 80/80 green while the application could not be signed into at all, and while the render path had never once produced a document. Six defects were found in the first browser walk, every one of them invisible to the suite:
  1. The Vite proxy key `"/api"` matched as a prefix and swallowed `/api.ts`, the client's own API module, so the SPA never mounted. Fixed by anchoring on `"^/api/"`.
  2. The sign-in button submitted a GET form to `/api/auth/sign-in/google`, which Better Auth does not expose; social sign-in is `POST /sign-in/social`.
  3. The `accounts` table had no `issuer` column. Better Auth 1.7.1 looks an account up by `(issuer, accountId)`, and the Drizzle adapter mapped the unknown field to nothing, emitting `where ( = $1 …)` — a SQL syntax error surfaced as a generic 500 on the OAuth callback (migration `0003`).
  4. A `disabled` control without a `disabledReason` threw the `docs/05` §6 invariant during sign-in.
  5. `useProfile` modelled the first-run 404 as an error. React Query resets a query holding no data to `pending` on every refetch, so `isLoading` went true again, the gate unmounted the form, the form remounted and refetched — an unbreakable loop. A missing profile is now `null`, which is data.
  6. `generateRender` called `client.messages.create` with `max_tokens: 32000`. The SDK refuses a non-streaming request that could exceed ten minutes, so **every** generation failed before reaching the API — and `asModelError` reported it as "The model service could not be reached", which pointed at the network. Extraction had always streamed with the identical `max_tokens`.
- **Why the suite could not see any of them:** three are browser-only by nature (bundler config, module graph, React render loop). The other three sit behind seams the suite deliberately stubs — the session resolver and the model seam — which is exactly the gap the 2026-08-30 entry above named and accepted. That entry called the risk "a wiring break that only the author would notice"; the actual cost was that **no** stage of the product had been exercised by a real request.
- **What this changes:** nothing in the stubbing decision, which remains correct for the reasons given. What changes is the acceptance bar. A milestone that claims a path works is not closed on a green suite; it is closed on a walk. The manual checklist in `11` §3 is the mechanism and it was not run before #1 was first considered done.
- **Second-order finding:** error mapping that collapses distinct failures into one reassuring sentence cost roughly an hour. `asModelError`'s fallback branch reported an SDK-side refusal — a bug in our own call — as an unreachable service. A mapper that cannot distinguish "they are down" from "we called it wrong" sends every future debugger to the wrong place.
- **Revisit when:** the OIDC-provider-as-fixture work in the 2026-08-30 entry is built. That closes items 2–4 and 6 to automation; items 1 and 5 need a browser regardless.

---

### [2026-09-02] Development and the test suite get separate databases, and two guards keep them apart

- **Decision:** the docker-compose Postgres holds `track_record_dev` and `track_record_test`. `.dev.vars.example` points `DATABASE_URL` at the former; `TEST_DATABASE_URL` defaults to the latter. `npm run db:up` runs `scripts/ensure-databases.mjs`, which creates whichever is missing. `tests/global-setup.ts` refuses to run if `TEST_DATABASE_URL` and the `DATABASE_URL` in `.dev.vars` name the same database on the same server, and — once connected — if `current_database()` is not the database it aimed at.
- **Reason:** the suite drops and rebuilds `public` on every run (`11` §1), and it was pointed at the database the dev worker used. Running the suite therefore destroyed the signed-in session, the profile, the imported documents, the accepted facts and every accepted render version. This happened three times during the 2026-09-01 walk (issue #4). The drop is right; sharing one database was not.
- **What made it expensive beyond the lost rows:** it made "run the suite before committing" cost a Google sign-in and a re-entered profile, which is exactly the habit that has to be cheap. A guard that is annoying to satisfy is a guard that stops being run.
- **Why two guards and not one.** The first compares configuration and needs no connection, so it fires before anything can be dropped. It cannot see past the URL. The Neon HTTP proxy sits between the URL and the database, so the second asks the connection what it actually reached. Both failures are silent and total; both checks are one comparison and one round trip.
- **The proxy's `PG_CONNECTION_STRING` is an auth backend, not a query target.** The image creates `neon_control_plane.endpoints` in the database it names and looks roles up there; the database each query runs against comes from the connection string the *client* sends, so one proxy serves both. It now points at the `postgres` maintenance database: the proxy's own bookkeeping does not belong in an application database, and naming either of ours would mean the proxy could not start until the databases existed.
- **What this exposed:** the dev database had been getting its schema as a side effect of the suite running against it. Separating them removed that, so `npm run db:migrate:local` applies the committed migrations to `track_record_dev` over psql. `npm run db:migrate` (drizzle-kit) cannot: it drives the `@neondatabase/serverless` driver, which reaches a local Postgres only through the proxy's WebSocket port, and that port is not published.
- **Revisit if:** CI ever runs the suite somewhere a `.dev.vars` exists, which would make the first guard load-bearing rather than a local convenience. It is written to pass when the file is absent.
- **The guards fail closed, after review.** The first pass returned early on any input it could not parse — an unreadable `TEST_DATABASE_URL`, a `DATABASE_URL` set to a placeholder — and fell through to the drop. That is the failure mode the guard exists to prevent, reintroduced inside the guard. Unreadable input now refuses; only a genuinely absent dev URL is silent, which is CI. The suite also refuses to aim at `track_record_dev` by name, so an exported `TEST_DATABASE_URL` cannot walk past a missing `.dev.vars`.
