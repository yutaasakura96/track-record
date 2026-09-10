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

---

### [2026-09-02] The OIDC provider runs as a test fixture, so the sign-in path is tested without a bypass

- **Decision:** `tests/helpers/oidc.ts` is a local OpenID Connect issuer — RSA keypair generated per run, JWKS, a discovery document, single-use authorization codes, PKCE `S256` verification and client authentication — that claims Google's endpoint origins inside the test isolate. `tests/smoke.test.ts` **no longer stubs the session resolver**: it walks `POST /api/auth/sign-in/social` → the issuer → `GET /api/auth/callback/google` → the session cookie, and every later request in the walk carries that cookie. `tests/allowlist.test.ts` runs the same path twice more, for an invited identity and for one off the list. `src/server` gained nothing; the switch is `vitest.config.ts`.
- **Why the origins are claimed rather than configured.** Issue #3 asked for "a local OIDC issuer the test configuration points at … the switch is configuration: issuer URL and client credentials". Better Auth 1.7.1's Google provider has no such switch: `google.mjs` hardcodes both the token endpoint (`https://oauth2.googleapis.com/token`) and the JWKS endpoint (`https://www.googleapis.com/oauth2/v3/certs`), and only the *authorization* endpoint is overridable through `ProviderOptions`. That left two options — a second, test-only provider registered through `genericOAuth`, which is exactly the bypass-in-shippable-code the 2026-08-30 entry refused, or claiming the origins inside the test process. The fixture claims the origins, and everything it does not own falls through to the real `fetch`, which is how the suite still reaches the Neon proxy.
- **The deployed configuration cannot reach it, by construction.** There is no URL, no port and no binding: the issuer is an object created in one test file and installed by a test-side call. A deployed Worker reaches Google, because Google is what the provider names. What *is* configuration is the client credentials and `BETTER_AUTH_URL` — which now names the origin the harness makes requests to, because Better Auth builds `redirect_uri` from it and the walk has to come back to the same application.
- **What this closes, precisely.** Of the six defects from the 2026-09-01 walk it closes **one** to automation: the missing `accounts.issuer` column (item 3), now asserted directly — after a sign-in, the account row must carry `https://accounts.google.com`. Around that it puts the whole Better Auth surface under test for the first time: the signed state cookie, the PKCE exchange, the callback, the session cookie, and `validateUserInfo` refusing an uninvited identity with **no `users` row left behind**.
- **What it does not close, contrary to the issue.** Items 2 and 4 — the sign-in form submitting a GET, and a `disabled` control with no `disabledReason` — are in `src/client` and need a browser. Item 6, `generateRender` refused by the SDK for being non-streaming, sits behind the model seam, which `11` §1 forbids any test from unstubbing. The issue expected four; one is what a server-side fixture can honestly reach. Naming it so the next reader does not assume coverage that is not there.
- **The three-scope rule now has a test.** The issuer records the `scope` parameter as the provider actually sent it, and the smoke test asserts the set is exactly `openid email profile`. That rule is a release blocker in `src/server/auth.ts` (`08` §1) and the authorization request is the only place it is observable.
- **Revisit if:** Better Auth gains a per-provider issuer URL. The fixture would then be pointed at by configuration, and the `fetch` claim could go.

---

### [2026-09-02] Checklist items 5–7 ran for the first time and found eight defects; item 8 and a green suite had said the path worked

- **Decision:** the M1 acceptance bar gains a second half. A green suite plus `11` §3 item 8 establishes that the path **runs**; items 5–7 establish that the screens can be **used**, and they are not optional. Issue #1 stays open until they pass. Five of the eight defects are fixed here (#5, #9, #10, #11, #12); #6, #7 and #8 are held because each needs a decision, not a patch.
- **What happened.** The 2026-09-01 entry closed on a walk that reached a downloaded `.docx`. That walk ran item 8 — the bundle serves, the SPA mounts, the button reaches Google — and item 8 passed. Items 5, 6 and 7 had still never been run. Running them on 2026-09-02, against the same session, produced eight issues (#5–#12), every one invisible to the 103-test suite:
  1. **#5 — `mark-base` never set a `color`.** Chrome's UA rule is `mark { background-color: Mark; color: MarkText }`, and `MarkText` computes to **black** even with `color-scheme: dark` on the root. Three of six mark variants set only a background, so every unselected evidence passage rendered at **1.05:1**. On diff review that meant 9 of 10 proposed résumé lines could not be read — on the screen whose only purpose is reading every change before accepting it.
  2. **#9 — the provenance label column was 60px** and `Generated` needs 67.33px, so two of three labels broke mid-word. `Attested` fits at exactly 60px, which is why the defect read as arbitrary rather than as a wrong width.
  3. **#10 — all three sidebar rows were `to: "/"`,** so two lied about where they went and the active test `path === to` marked **all three active at once**.
  4. **#11 — fact review requested `/api/source-documents//versions/1/text`** on every load, before the import status resolved. Four 404s per load in the console and the worker log, in the one place a real 404 would need to be noticed.
  5. **#12 — first generation promised a download that did not exist.** "Your current version is untouched and still downloadable" is true on a regeneration and false on the first one, which is the moment the author knows least about what the application is doing.
  6. **#6 — scroll sync is wrong in one direction and absent in the other.** `mark.offsetTop` is measured from `<body>`, since no ancestor of the pane is positioned, so every selection lands `pane.offsetTop` = 80px too high — 24% instead of the specified 34%. And clicking a passage never scrolls its card into view: the rail is 622px over 3410px of content, so the selected card is usually off-screen with nothing to say where.
  7. **#7 — the generated `.docx` carries the subject's name nowhere.** It opens, it is structurally sound, and the body has no contact block while `docProps/core.xml` reads `Un-named`. The router gates the entire application on collecting a name *because* "every render needs a name to put on it"; the name reaches the prompt and nothing else.
  8. **#8 — fact review is not keyboard-operable.** 0 of 11 marks and 0 of 11 cards are focusable, so the selection that drives the whole screen has no keyboard path. The `radiogroup`s have no roving tabindex and no `onKeyDown`, giving **104 tab stops** on one screen.
- **Why a green suite and a passing item 8 still left the review screens unusable.** They answer a different question. Item 8 and §2.9 ask whether the path *runs* — does the bundle serve, does the SPA mount, does a request reach the next stage. Every check in §2 asks whether the data is *correct* — is the quote verbatim, is the Private fact absent, is the 履歴書 field there. **Nothing in either asks whether the rendered result can be read, reached or operated**, and that is the entire content of items 5–7. #5 is the cleanest case: the pipeline extracted the right passages, stored the right offsets, and painted them in a colour no one could see. Every assertion in §2 was true of that screen.
- **Why no test could have caught these, specifically.** `11` §4 rules out screenshot diffing, so rendered colour has no automated home in this project at all. Contrast ratio, scroll offset as a fraction of a viewport, tab-stop count, and copy that contradicts the state it is shown in are all properties of the *rendered output*, and the suite stops at the DOM the components would produce. This is not the seam gap the 2026-08-30 entry named and accepted — unstubbing the session and the model resolver would have changed none of these eight.
- **The defect class, which is the transferable finding.** Three of the five fixed were an **omission**, not a wrong value: an absent `color`, an absent `enabled`, an absent second `to`. `scripts/check-design-tokens.mjs` was built on 2026-08-30 to ban values that are *written and wrong* — arbitrary utilities, raw colour literals — and a checker that matches on what is present is structurally blind to what is missing. `npm run lint` reported `design tokens: clean` against a screen rendering black on black. The script gains `mark-needs-color`, its **first rule asserting that a declaration exists**: `@utility mark-base` must declare a `color`. The rule is deliberately narrow — every `<mark>` in the client carries `mark-base`, so one declaration there puts the UA default out of reach whatever a variant forgets. The broader "every mark-targeting utility declares a colour" is the wrong shape twice: it would demand a colour from variants that correctly inherit one, and still miss the plain `bg-add-idle` the diff pane puts on a `<mark>`.
- **The fix for #5 is `color: inherit`, not a token.** A mark is a highlight, not a recolouring; it should take the colour of the prose around it unless a variant states otherwise, and the three variants that carry a colour of their own still win. `docs/05` §1 specifies a text colour for exactly those three, which is the same statement read the other way. Measured after: 1.05:1 → **8.75:1**.
- **#9 needed a new width, so it went into `docs/05` first.** `--spacing-label: 80px`, composed from the scale as 40 + 40, added to §3 with the measurement that forced it. The alternative — letting the column size to its content — loses the alignment the fixed width exists to create.
- **#10 is fixed by making `to` the thing that decides.** A row is navigable if and only if it has a route; the rows M1 has not built are disabled `<span>`s stating why (`docs/05` §6). The bug was two separate lies sharing one cause, and a row that cannot have a `to` cannot be marked active by a test on `to`.
- **What is held, and why it is not laziness.** #6 needs a decision about what the rail does when selection moves and whether the pane becomes its own offset parent; #7 needs a decision about *where the name lives* — fixed scaffolding the renderer writes, which `EMIT_RENDER_TOOL`'s `factIds: []` escape hatch already anticipates, or a prompt instruction the model may drop; #8 needs a decision about what the focusable unit on fact review is. Each is a design question with a wrong answer that would be expensive to unpick, and #7 in particular is the product's actual output being wrong.
- **Verification.** Every fix was confirmed in the browser against `track_record_dev`, not by reading the diff — computed colour and contrast, label box heights and note alignment, the rendered `href`/`aria-disabled` of each nav row, the network log showing one request per load instead of five, and both branches of the generating copy. That is what the 2026-09-01 entry asked for and it is the only reason these were found at all.

---

### [2026-09-03] The three held defects were decisions, and all three come down to who owns a thing

- **Decision:** #6, #7 and #8 are answered as follows. **#7 — the identity block is fixed scaffolding the renderer writes, assembled at download and never stored.** **#6 — scroll geometry stops depending on the offset-parent chain rather than being made to depend on it correctly, and a selection carries the half it came from; the originating half holds still.** **#8 — the card is the focusable unit and the rail is the keyboard surface; the document follows.** Each is recorded below with what was rejected. #5, #9, #10, #11 and #12 are closed on GitHub against 6d6b974.

#### #7 — where the name lives

- **The alternative was a prompt instruction**, and `EMIT_RENDER_TOOL`'s `factIds: []` escape hatch does anticipate a block written from no fact. It is rejected on two grounds. The weaker one is reliability: the identity gate in `router.tsx` promises that every render carries a name, and a promise a model may drop, translate or misspell is not a guarantee.
- **The stronger ground is the PII rule, and it is what settles it.** `docs/04` §3.2 makes `date_of_birth`, `phone`, `postal_code`, `address`, `contact_*` and `photo` readable only by the 履歴書 spec. For a model to *write* a contact block it must be *sent* the profile — so a prompt-written header means the four non-履歴書 renders receive PII they may never use, and the rule becomes something the model is asked to respect rather than something the code enforces. Composing the header in `src/render/identity.ts` means those columns never enter a generation request at all. That is the same discipline as enforcement point 2 for Private facts (`docs/03` §7): filtered before the request is built, not out of the response afterwards.
- **Read the other way, the same rule is why the English résumé carries an email and not a phone number.** `name_latin`, the kanji name and `email` are not on the restricted list; `phone` is. `HEADER_FIELDS` in `identity.ts` is that list expressed as code, and `renderIdentity` in `routes/renders.ts` selects exactly three columns, so a restricted column cannot reach a render even by a later mistake.
- **The header is assembled on download, not stored in `RenderContent`.** A version stores what was generated *from the record*, and a phone number or a corrected surname is not a claim about a career. Storing it would make every accepted version stale the moment the profile is edited, and the remedy would be a regeneration with nothing to review. Downloads are already built fresh on every request and never stored (`docs/03` §6); the header belongs on that side of the line. `toMarkdown` and `toDocx` take the same `RenderIdentity`, so the two formats of one version cannot disagree about whose document it is.
- **`docProps/core.xml` was the other half of the defect** and is fixed at the same seam: `new Document` now receives `title`, `creator` and `lastModifiedBy`. It read `Un-named` — the library's placeholder — on a file whose properties therefore disowned its author.
- **This one gets a test, and the other two cannot have one.** A missing name in an assembled document is a property of bytes, not of rendered pixels, so it has an automated home where contrast ratio and tab-stop count do not. `tests/renders.test.ts` gains two: the download carries the name and the email, and the résumé carries none of `phone`, `address`, `postal_code` or `date_of_birth` — which is the second half of `docs/11` §2.3, previously specified and never asserted.
- **What is deliberately not done.** 履歴書 takes the full conventional identity block — 氏名・ふりがな・生年月日・現住所・連絡先 — and it is `buildable: false`. It gets the name alone for now, and `identity.ts` says so rather than modelling a partial version of a block whose incompleteness is the whole defect it would introduce.

#### #6 — scroll sync in both directions

- **The pane does not become its own offset parent.** `position: relative` on the pane would fix the arithmetic today and would leave a scroll calculation silently depending on a declaration in a file that never mentions scrolling — and it would break again the moment any intermediate wrapper gained `position: relative`, because that wrapper would become the offset parent instead. `src/client/scroll.ts` measures with `getBoundingClientRect`, which is relative to the viewport and depends on no ancestor at all. Measured after: the specified **34.0%**, against 24% before; the old `offsetTop` formula wanted scroll 285 where 205 is correct.
- **What the rail does is: follow the other half, and only when it has to.** `revealInBand` leaves a card that is already fully visible exactly where it is and brings one that is not to the same 34% band the document uses. A reader scrolling the rail is therefore never overruled for a card they can already see, and there is one band rule on the screen rather than two.
- **The larger half of this decision is that a selection carries its origin.** `docs/10` already specified it and the implementation ignored it: "clicking a mark selects its card and scrolls the rail to it. Selecting a card scrolls the document." Each half follows the *other*. Scrolling the half that was just clicked in yanks the passage — or the Accept button — out from under the pointer that chose it, so `selectionOrigin` is now part of the selection in the store, and the originating half holds still. `null` means neither half asked, and both follow.
- **What this fixed that was not arithmetic.** The document → rail direction did not exist at all. On the 2026-09-02 data the rail shows 622px of 2663: clicking a passage left its card 898px below the fold with nothing to say where it had gone.

#### #8 — the focusable unit on fact review

- **The card, not the mark.** Choosing which passage to look at is a traversal of the fact list, and the fact list is the rail; the document is the evidence view and follows. Making all 11 marks focusable would have doubled the cost of reaching the same 11 facts and given the keyboard two routes to one selection. The marks stay a pointer shortcut and add no tab stops.
- **One roving tab stop for the rail, arrows to move between facts, and selection follows focus.** `onFocusCapture` rather than `onFocus`, so focus landing on any control *inside* a card selects it too — which is separately what the issue observed: tabbing to a card's Accept button never moved the source pane. Arrow keys move card to card only when the card itself holds focus; inside the claim editor they move the caret and inside a segmented control they belong to the radio group.
- **`SegmentedControl` becomes an actual radio group** — roving tabindex, Arrow/Home/End, selection following focus as the pattern specifies. It was `role="radiogroup"` with `role="radio"` children and neither behaviour, which is worse than no ARIA: it told a screen reader to expect arrow keys that did nothing.
- **Result: 103 tab stops to 60**, of which 44 came from the radio groups alone and the rest from collapsing the rail to one. The remainder is structural — eleven cards with a claim editor, two groups and two buttons each — and the fix for that is not more keyboard plumbing.
- **Resolved cards are now selectable too.** They had no `onClick` at all, so on the 2026-09-02 record — where all 11 facts are accepted — *no* card on the screen could select anything, by mouse or otherwise. The two card states now share one focus handle.

#### Also fixed here

- **#13, filed while closing #12.** `diff-review.tsx`'s `Failed` state carried the identical defect and was outside #12's scope: on a first generation it said "your current version is unchanged and still readable" and offered a **Download the current version** button, both false. It branches on the same `basedOnVersionNo === null`, and the download link is removed rather than relabelled — there is nothing to download.

#### Verification, and one honest gap

- **Every decision above was checked in the browser against `track_record_dev`**, per the 2026-09-01 entry: the intercepted scroll target and the resulting band as a percentage of the pane, the rail's scroll call and the selected card's rectangle inside it, `aria-checked`/`tabIndex` across a segmented control before and after a key, the assembled `.docx` unzipped in the page to read `docProps/core.xml` and the body runs, and both branches of the `Failed` copy.
- **The gap: this Browser pane does not deliver keystrokes to the page.** No `keydown` reaches the document from the pane's key action, fronted or hidden, so the key handlers were exercised with dispatched `KeyboardEvent`s — which genuinely run them and everything downstream — and the tab-stop count is computed from `tabIndex` and contenteditable rather than walked with 60 presses of Tab. Smooth scrolling is also unreliable there, so scroll targets were read from the intercepted `scrollTo` call and applied. **`docs/11` §3 item 7 is not signed off by this session**; what is established is that the handlers do what they are written to do.
- **Two hand edits to `track_record_dev`, both restored, both stated because the walk's data is the fixture.** All 11 facts were set to `candidate` to reproduce the open-card screen the tab-stop count was measured on, and restored from a `pg_dump` snapshot afterwards — provenance and disclosure included, since arrowing a radio group writes to the database. `render_proposals.generation_status` and `based_on_version_id` were flipped to reach the `Failed` state's two branches, and set back. This is the same technique #12 was verified with on 2026-09-03.
- **`docs/11` §3 items 5 and 6 now pass; item 7 does not, for the reason above. Issue #1 stays open.**

---

### [2026-09-03] `11` §3 items 1 and 7 ran on surfaces that could actually run them; issue #1 is reopened and the bar it now waits on is not a checklist item

- **Decision:** issue #1 is **reopened**, not superseded. `docs/11` §3 items **1 and 7 now pass**, so the checklist half of the M1 bar is met in full; **items 2, 3 and 4 are not part of the M1 bar at all** and this entry says why. What #1 now waits on is its own Further Notes — the generated English résumé beside the hand-produced one — which is a judgement the author makes and no agent can make for them.

#### The log and GitHub had been disagreeing for two days

- **#1 was closed 2026-09-01T12:47** — the day *before* the walk that found #5–#12 — and both entries since state plainly that it stays open. Neither noticed it was already closed. The disagreement was real and it was invisible from either side alone.
- **Reopening was the cheaper resolution, and it is not a stretch of the issue's terms.** The close rested on a green suite plus item 8, which is exactly the evidence the 2026-09-02 entry concluded does not establish what it was taken to establish; the close is a casualty of its own finding rather than a policy that later changed. Moving the bar to a second issue instead would have relitigated a decision taken twice in 48 hours on grounds of tidiness, and left two artifacts explaining each other. #1's Further Notes already set a bar no test can reach — "finished when a generated English résumé can be put beside the hand-produced one and judged" — so it was never a pure build ticket.

#### Items 2, 3 and 4 are not runnable at M1, and that is a property of the milestone

- 履歴書 (item 2), 職務経歴書 (item 3) and both career stories (item 4) are `buildable: false` in `src/render/spec.ts`, and the overview renders them as **Never generated** with Generate disabled. Those three items have nothing to open, print or read. They are not outstanding work against M1; they arrive with the renders. `docs/11` §3 gains a line saying so, because "never been run" and "cannot be run yet" are different states and the table did not distinguish them.

#### Item 7 — the keyboard pass, walked rather than computed

- **The 2026-09-03 gap is confirmed, not assumed.** A capture-phase `keydown` listener in the Claude Code Browser pane recorded `[]` for a Tab press and `document.activeElement` never left `BODY`. That pane also renders the app's minimum-width gate, so fact review is not even on screen there. It cannot run this item, and the reason is now measured rather than reported.
- **The surface that works is Chrome driven over CDP, with one precondition: a real click first.** Before any click, Tab produced nothing there either; after one click into the page, every key arrived with `isTrusted: true`. That precondition is the whole difference between this session and the last one.
- **All six checks pass.** Tab from the last filter pill lands on card 0's article and exactly one card is tabbable. Arrow moves card to card and the document follows to the specified band — **34.0%** measured at cards 0, 1, 4 and 5; card 2 lands at 47.2% because the pane is already at `scrollTop` 412 of a maximum 412 and the document is too short to place it lower, which is the clamp working rather than the band failing. Each of a card's five controls holds `aria-current` on its own card. Tab out of the Worth group lands on the Who group's checked radio, skipping the two unchecked siblings. Arrow inside a group moved Attested → Generated, carried `aria-checked` and the roving `tabIndex` with it, and **persisted to the database** — the write path is real, not just the ARIA.
- **60 tab stops, walked with 65 real presses.** The count matches the 2026-09-03 figure; the *composition* does not, and the difference is worth having. That entry accounted for the rail's one roving stop. In a continuous forward walk that stop never materialises — selection follows focus, so the tabbable card is always the one just passed — and the sixtieth stop is instead the **source pane's scroll container**, which Chrome makes focusable because it holds no focusable children. That stop is not a defect: it is the keyboard's only way to scroll the source document. The article stop is real on fresh entry into the rail, which is where it was observed. Same total, different sixty.
- **A first count of 62 was wrong and the error is instructive.** Three consecutive stops on one card's claim editor turned out to be `focusin` refiring at a tool-call boundary. Re-walking in a single uninterrupted run gave 60 with zero refocus events. A tab-stop count taken across batch boundaries is not a tab-stop count.

#### The standing constraint this session found, which will outlive it

- **A hidden tab does not animate smooth scrolling, and the app scrolls smoothly.** With `document.visibilityState === "hidden"`, `pane.scrollTo({behavior: "smooth"})` is a silent no-op: instrumenting the call showed the app asking for `top: 0` and `top: 762.27` — both arithmetically correct against the pane geometry — while `scrollTop` stayed at 169. Direct assignment and `behavior: "auto"` both worked on the same element in the same moment, which is what isolates it. **Any future check of scroll behaviour needs the window genuinely in front**, and a scroll that appears not to happen in a background window is evidence of nothing. This is the same root cause as React Query pausing its polling while the pane is hidden.

#### Item 1 — the release blocker, in real Microsoft Word

- **It opens clean.** A freshly downloaded `resume-2026-09-02.docx` (9,424 bytes) opened in Microsoft Word for Mac with **no repair prompt and no unreadable-content warning** — one page, 189 words, `Accessibility: Good to go`.
- **The identity block renders as specified**: a centred title, then the name centred and bold, then the email centred beneath it. `Résumé` renders with its accents intact.
- **Word's own Properties dialog reads `Title: Résumé (English)` and `Author: Taro Yamada`.** That is the half of #7 that mattered most and the only place it could be confirmed — the defect was that Word showed the `docx` library's `Un-named` placeholder, and a reader of `docProps/core.xml` would have believed the fix either way.
- **The PII rule holds in the artifact, not just in the type.** A scan of every `<w:t>` run in the body found no phone number, no `〒`, and no date of birth. `HEADER_FIELDS` is doing what `identity.ts` says it does.

#### What #1 still waits on, and why this session could not do it

- Every applicable checklist item now passes: **1, 5, 6, 7 and 8**. What remains is the comparison #1 calls its deliverable, and it is **not reachable from this data**. `track_record_dev` holds an invented fixture — an invented person at an invented employer — so the generated résumé has no hand-produced counterpart to sit beside. Reaching that comparison means importing the author's real case studies, which is an act with its own consequences and is the author's to start. The bar is no longer "can the screens be used"; it is the question the project was built to answer.

#### The dev database was changed and restored, and one column deliberately was not

- All 11 facts were set to `candidate` to reach the open-card screen the tab-stop count needs, and restored from a `pg_dump` snapshot taken first. A `pg_dump` diff afterwards is byte-identical across every business column — provenance, disclosure, status, `resolved_at`, claim, quote and offsets.
- **`facts.updated_at` on `fct_97DyfaC5mBYOOIoE` was left at its new value.** That row genuinely was written when its Worth control was arrowed from Attested to Generated and back. Resetting an audit column to hide a write that happened would put a false statement in the database to make a diff look tidy, which is the wrong trade.

---

### [2026-09-04] The comparison #1 was built to reach was run against real career material; the fact layer held the nuance and lost the shape

- **Decision:** issue #1 is **closed**. Its Further Notes set the bar — "finished when a generated English résumé can be put beside the hand-produced one and judged" — and that judgement has now been made against the author's real material rather than an invented fixture. The riskiest assumption in `docs/01` is **answered in the affirmative**, with one structural qualification recorded below that is M2 work already scoped, not a reopening.

#### What was run, and what the numbers were

- One real source document was imported through the real route, the real chunker, the real model seam and real `claude-opus-5` calls: **9 chunks, 112 candidates, 0 discarded**. The chunk count matched what `TARGET_CHUNK_CHARS` predicts for the file, so the planner has now been confirmed against a document nobody wrote for it.
- **Zero discards across 112 candidates is the result worth keeping.** Quote anchoring is the guard that stands between a model-invented claim and the record, and on real prose it never fired. The `docs/11` §2.2 cases are all still worth having — they are the adversarial half — but the base rate on genuine input is now measured rather than assumed.
- The ingestion scrub classified **112 `restricted`, 0 `private`, 0 client-identifying**. That is the correct answer for a first-person career narrative, and it is *not* evidence that the shape-based scrub works on the per-employer portfolios, which carry the embedded network and configuration material the `SHAPES` list exists for. That case is untested.
- The generated `.docx` is 13,574 bytes, passes a zip integrity check, and carries its title and author in `docProps/core.xml`. **A scan of every body run found the name and the email present and phone, postal code, date of birth and address absent** — so the `HEADER_FIELDS` rule from the 2026-09-03 entry now holds against a profile with real values in the restricted columns, not only against a fixture.

#### The judgement: nuance held, shape did not, and they fail in different places

- **The failure condition `docs/01` names did not occur.** The worry was that the record would keep a flattened outcome and lose "the reasoning, the false starts and the judgment". The generated résumé carries a multi-bullet account of a misattributed failure, its detection gap, the author catching it themselves, publishing the postmortem, and installing a structural check — an episode of professional judgement that the **hand-produced résumé does not contain at all**. On the one question the project exists to answer, the structured record outperformed the loop it replaces.
- **What degraded is editorial compression, and it is measurable.** Against the hand-produced document: **58 experience bullets versus 30, averaging 126 characters versus 192, with 33% carrying a number versus 57%.** Nearly twice the bullets at two-thirds the length and half the quantification rate.
- **The cause is a pair of rules pulling the same direction and nothing pulling back.** `EXTRACTION_SYSTEM_PROMPT` says "One claim per call. A sentence carrying two distinct outcomes is two calls." `RESUME_REGISTER` says "Keep each bullet to one sentence." So material is atomised on the way in and never re-fused on the way out; a hand-written bullet welding a diagnosis to its measurement to its consequence arrives as three thin ones. **The information survived. The welding did not.**
- **This matters because it aims the contingency plan at the wrong target.** #1 says "If the generated version is worse, the response is a richer fact model — not more renders, and not a better prompt." That prescription does not fit what was found: the facts are not impoverished, the composition is. A richer fact model would not close this gap.

#### The finding to act on first: the employer structure is inference, not architecture

- The generated résumé has correctly ordered, correctly titled, dated employer sections. **`employers`, `projects`, `roles`, `certifications` and `educations` are all empty, and no fact carries an `employer_id` or a `project_id`.** The grouping was reconstructed by the model from the claim prose, because this particular source happens to name its employers inside the sentences that became claims.
- **That is luck, and it is load-bearing.** `RESUME_REGISTER` asks for "one section per employer, most recent first"; `collectRenderInputs` supplies `spec.employers` as an empty array and every `RenderFact` without an `employer` key. A source that discusses one employer without renaming it in every claim gives that instruction nothing to stand on.
- **It is already cracking where the inference runs out.** The generated employment dates are less precise than the hand-produced ones at exactly the employer whose end date no row carries. Dates are a property of an employer entity; the model can only infer them from prose that mentions them.
- **The fix is entity extraction and the bootstrap flow**, both already out of scope for M1 by #1's own Out of Scope list. This entry does not move them; it records that the M1 output *looks* like it has employer structure and does not, so that a later reader does not mistake a working résumé for a working data model.
- The same root cause explains the two smaller gaps: certifications appear as a count rather than a list, and there is no education section. Those are unpopulated entity tables, not lost facts.

#### Two findings outside the comparison

- **The provider passes no `thinking` parameter, and on `claude-opus-5` that no longer means what it meant.** Omitting it on Opus 4.8 ran without thinking; on Opus 5 it runs **adaptive thinking at effort `high`**, which is the dominant cost term in every import. Nobody chose this — it changed under the code when `ANTHROPIC_MODEL` became `claude-opus-5`. It is left on deliberately for now, because lowering it to save money would degrade extraction quality and confound the very measurement this entry reports. **It wants an explicit decision before the first bulk import**, not a default inherited from a model migration.
- **The seam streams and discards `usage` entirely, so there is no cost telemetry anywhere in the system.** The 1-hour cache breakpoint on the extraction system prompt is a deliberate, reasoned choice in `providers/anthropic.ts`, and whether it pays off has never been observed. The fixed prefix measures **933 tokens** against Opus 5's 512-token minimum, so it should be caching — but that is arithmetic, not a `cache_read_input_tokens` reading. A pipeline whose only spending credential is the model key should be able to say what a run cost.
- **The Vite dev server serves `local/` over `/@fs/`.** This is documented Vite behaviour governed by `server.fs.allow`, it is dev-only, and it is not a production exposure. It is recorded because this repository's premise is confidentiality and the gitignored directory being fetchable from any page in the dev browser should be a decision rather than an accident.

#### The dev database now holds the real record, and the fixture moved to a snapshot

- **The fixture was not separable from the real record.** `track_record_dev` has one `users` row and it is the author's own; the invented name was a `profiles` value on that row and all 11 fixture facts carried that same `user_id`. Co-existence would have fed invented facts at an invented employer into the generation the comparison depends on, and printed the invented name on the document being judged — so "keeping the fixture" would have required mutating it anyway.
- A `pg_dump` snapshot was taken first and the record tables were then truncated, leaving `users`, `accounts` and `sessions` intact. **The fixture's home is the snapshot, not the live database**, and restoring it is how `docs/11` §3 items 5, 6 and 7 are re-run — the same technique the 2026-09-02 and 2026-09-03 entries used twice.
- **One caveat is recorded because it is a claim about truth, not a mechanical step.** All 112 facts were promoted to `attested` in one pass, on the reasoning that a self-authored case study asserts its own claims. `measured` was not used and the API would have refused it without evidence rows. The record therefore says Attested for facts the author has not personally graded, and the provenance of this import is an agent's default rather than the author's judgement until re-reviewed.
- **`docs/11` §3 is unchanged by this entry.** Item 1 remains signed off only for the file the 2026-09-03 entry opened; the document produced here has been checked for zip integrity and properties, which is not the same as Word opening it, and item 1 is a human check by the table's own terms.

### [2026-09-04] The seam reports what each call cost, and the cache breakpoint stops being arithmetic

- **Decision:** both model calls now report a `ModelUsage` — input, output, cache-creation and cache-read tokens — and both persist it. Extraction lands on the `import_chunks` row it already owns; generation lands on the `render_proposals` row that already exists from the moment generation starts. The previous entry recorded that the seam "streams and discards `usage` entirely"; that is no longer true.

#### Why this went first, ahead of the `thinking` decision

- The previous entry left four things open and named the `thinking` parameter as wanting "an explicit decision before the first bulk import". That decision cannot be made well without numbers. The question is not "is adaptive thinking at effort `high` expensive in principle" but "what is it costing per import here", and nothing in the system could answer it.
- Telemetry is also the cheaper half. Both call sites already had the data in hand: extraction iterates stream events and threw the final message away, generation already called `finalMessage()` and read only the tool block.
- **The two API facts this rests on were verified against the current documentation rather than recalled**, because the reason item 3 exists at all is that this behaviour changed under the code during a model migration. Confirmed: on `claude-opus-5`, omitting `thinking` runs adaptive — unlike Opus 4.8/4.7, where omitting it meant no thinking — and `output_config.effort` defaults to `high`. The previous entry's reading of the situation is correct.

#### What the shape of the change protects

- **`finalMessage()`, not a hand-rolled accumulation.** The totals could have been assembled from `message_start` plus `message_delta`, and that is the documented wire shape. It would also be reimplementing what the SDK already guarantees, in the one file that exists to keep provider detail out of everything above it.
- **The four columns are nullable, and null means "not recorded" — never "cost nothing".** A version is never re-extracted in place, so every chunk row written before today keeps a null forever. That includes all nine chunks of the real import the previous entry reports: **the 112-fact run stays unmeasured and cannot be measured retroactively.** These columns answer questions about future imports only.
- **Generation reports usage BEFORE the unusable-response check.** A call that returns the wrong shape still ran and is still billed. Reporting after the check would have made the broken imports look like the cheap ones.
- **A failed call reports nothing.** The SDK's error does not carry usage, and writing a zero row would understate the bill in exactly the situation — a retry loop — where the bill is worst.
- **`ModelUsage`'s four keys are deliberately the four column names**, so the mapping at both call sites is a spread and there is no translation layer to drift.
- Token counts are counts. They carry no claim, no quote and no source text, so `import_chunk_done` now logs them without touching the rule in `docs/03` §7.

#### One testing-plan exception, taken deliberately

- `tests/usage.test.ts` asserts on columns rather than through the API, which `docs/11` §2 otherwise rules out. **The exception is that here the stored row IS the deliverable.** No screen and no endpoint reports token counts, so there is no higher seam to observe, and asserting through the API would have meant inventing a surface for the test's benefit. What the test protects is narrow and real: the way this silently reverts is a refactor that drops the callback, and no other test would notice.
- Writing it surfaced the render-time provenance gate doing its job — an accepted fact still at the extraction default of Generated leaves nothing to generate from, and the request is refused with `precondition_failed`. That is `docs/02`'s block working, observed from the outside rather than asserted about.

#### What this does not do

- **It records tokens, not money.** No prices are stored and no cost is computed. Rate cards change and models change; the durable quantity is the count, and a price belongs wherever someone is reading a report, not in a row that will outlive the rate.
- **Nothing surfaces it yet.** Reading a run's cost today means a SQL query or the log line. Whether that earns a screen is a separate question and no screen specification calls for one.
- **The `thinking` decision is still open**, and is now answerable: the next real import produces the numbers it needs. The 1-hour cache breakpoint likewise stays a reasoned choice until a `cache_read_input_tokens` reading confirms it — the 933-versus-512-token arithmetic is unchanged, but arithmetic is what this entry exists to stop relying on.

---

### [2026-09-06] Three guards in front of the first bulk import, and the scrub finally met the material it was written for

- **Decision:** the `thinking` parameter is now stated in the code rather than inherited from a model default, the dev server no longer serves the repository root, and `SHAPES` gains four entries after a dry run measured what it was missing. None of these changes what the system produces. All three close a gap between what the code does and what anyone reading it would believe it does. Two ADRs were written alongside them, in a new `docs/adr/`.

#### Thinking and effort are written down, and the level is still open

- Both call sites in `providers/anthropic.ts` now send `thinking: {type: "adaptive"}` and `output_config: {effort: "high"}`. These are the values that were already running. On `claude-opus-5` an absent `thinking` runs adaptive and an absent effort runs at `high`, which is what the 2026-09-04 entry recorded and what the current API reference confirms.
- **The defect was never the cost. It was that nobody chose it.** Adaptive thinking at effort `high` arrived when `ANTHROPIC_MODEL` moved to Opus 5, silently, because the same absent parameter meant no thinking at all on Opus 4.8. Writing the values down costs nothing and stops the next model change from moving them the same way.
- **Lowering `effort` is still an open decision and still wants numbers.** The previous entry made it answerable by recording token counts per call. The next real import produces them. This entry deliberately does not pre-empt that.

#### The dev server's file scope, where the smaller finding led to a larger one

- `vite.config.ts` now names `server.fs.allow` as `src` and `node_modules`, by absolute path. Naming it turns off Vite's workspace search, so the repository root leaves the served scope entirely instead of being denied file by file. `server.fs.deny` is deliberately left alone, because overriding it would drop Vite's own defaults for `.env`, keys, certificates and `.git`.
- **`.dev.vars` mattered more than `local/` did.** The 2026-09-04 entry recorded that `local/` was fetchable over `/@fs/`. Fixing it surfaced the reason: Vite walks up for a lockfile, finds `package-lock.json` at the repository root, and serves everything under it. That includes `.dev.vars`, which holds `DATABASE_URL`, `ANTHROPIC_API_KEY` and `BETTER_AUTH_SECRET`. Vite's default deny list covers `.env` and `.env.*` and has never heard of `.dev.vars`, which is a Cloudflare convention.
- **Verified in the browser rather than reasoned about.** With the dev server running, `.dev.vars`, `local/README.md` and `docs/06-decision-log.md` all return 403 over `/@fs/`, `src/shared/calendar.ts` still returns 200, and the application loads with every module served and no console error. The only failing requests are the two API calls, because the Worker was not running.

#### The scrub, run against the portfolios it exists for

- The 2026-09-04 entry recorded that 112 restricted and 0 client-identifying was the correct answer for a first-person narrative and was not evidence about the per-employer portfolios. Those portfolios have now been scanned: **10 documents, 4,405 paragraphs, across the four employer folders.**
- **The guard is not vacuous on this material. 170 paragraphs came back Private before the change.** IPv4 fired 282 times, the ticket-key shape 72, IPv6 9, email 3, UNC path 2. GUID and employee-number never fired at all.
- **It also had four countable gaps**, ranked by how often each appeared in text no existing shape caught: drive-letter paths such as `C:\` at 63, cloud resource identifiers at 26, URLs at 22, and hostnames on an internal suffix at 17. The UNC shape catches `\\server\share` and walks straight past `C:\`, which is the form these documents actually use and the one carrying a client's directory structure.
- **Four shapes were added, and one of them is deliberately narrower than the finding.** Drive-letter path, internal-suffix hostname, cloud resource identifier, and URL naming an explicit port. The URL shape is scoped to a port rather than matching every URL, because a public postmortem link is exactly the kind of evidence a résumé should be able to cite, and marking it Private would mean it never renders. A port is the signal that separates an internal service endpoint from a published page.
- **The measured effect is 170 Private paragraphs becoming 229.** Two controls confirm the narrowing works: a plain outcome sentence and a public documentation URL both stay Restricted.
- **Two limits on what this establishes.** It scanned raw document text, not extracted quotes, so it says what the guard can see in the material rather than what it will see in a candidate. And the IPv4 shape cannot tell an address from a four-part version string, so some of those 282 are false positives, in the direction `scrub.ts` already argues for.
- **It is not retroactive.** The scrub runs at ingestion, so the 112 facts already in `track_record_dev` keep the disclosure they were given. The widened list governs the next import.

#### What is written down, and what is not verified

- **`docs/adr/` now exists**, with ADR-0001 recording why facts stay atomic while bullets are welded at render time, and ADR-0002 recording why the first real import is Attested by an agent's default with a re-review gate before M3. Both were written because a future reader would look at the code and reasonably conclude a mistake had been made.
- **The four new shapes have API-level tests that have not been run.** `tests/import.test.ts` gains one case per shape, each on its own invented document so the shared fixture's offsets and line numbers stay where the tests above them assert they are. The suite needs Postgres and the Docker daemon was not running. What was verified is narrower and was verified directly: `scrub()` returns Private for all four invented quotes and Restricted for both controls.

---

### [2026-09-06] The entity layer is entered rather than inferred, and the résumé's employer sections stop being luck

- **Decision:** issue #14's M2 entity layer is built. Employers, roles, projects, education and certifications each have a full CRUD surface and a form; facts carry an `employer_id` set from the fact list; and `RenderSpec.employers` now carries the roles held at each employer. The 2026-09-04 entry recorded that the M1 résumé *looked* as though it had employer structure and did not. It has one now, and it is rows rather than prose.

#### What the model is no longer allowed to infer

- **Employer names, role titles and every employment date come from the Employers list in the generation prompt and from nowhere else**, stated as a rule in `buildGenerationPrompt` and again in `RESUME_REGISTER`. The register previously asked for "one section per employer, most recent first" against a `spec.employers` that was an empty array — an instruction with nothing behind it. It now names the list as the source of the section's name, order and dates.
- **A fact is grouped by the employer id it carries, and a fact carrying none must not be placed under one.** `RenderFact.employer` gained an `id` so the grouping is a join rather than a match on a name that happens to appear in a claim.
- **Roles are what give a section its title.** An employer with no role renders untitled rather than with a guessed one, which is the honest failure. A role with neither a Latin nor a Japanese title is dropped from the spec entirely — it still bounds nothing the employer row does not already say.

#### Five decisions taken in the grilling session, and what each cost

- **Entities are hand-entered.** One career has a handful of employers and that number does not grow; facts arrive in hundreds per import. The forms were a `MUST` for M2 regardless, so this cost nothing extra and carries no extraction risk. **No entity extraction was built and none is planned.**
- **Forms for all five types, fact linkage for employers only.** Once one CRUD surface existed the other four were nearly free — they are the same four handlers with a different schema. Facts have no `role_id` in `docs/04` and did not gain one: a role hangs off an employer, so linking a fact to an employer already places it under the right roles. Project linkage waits for 職務経歴書, the only render that needs it.
- **The 112 existing facts are linked from the fact list, not by re-importing.** A source document version is never re-extracted in place, so re-importing to gain a foreign key would create a new version and orphan 112 accept decisions. The employer picker is therefore on the *resolved* card as well as the candidate one, and a test asserts that filing an already-accepted fact leaves it accepted.
- **The 履歴書 bootstrap import stays unbuilt**, in reserve as decided.
- **Facts stay atomic.** The bullet-composition gap belongs in `RESUME_REGISTER` and is not touched here (ADR-0001).

#### Deletion, which is where the "never silently orphaned" rule became code

- `DELETE /api/employers/:id` answers **`409 conflict`** when facts, roles or projects reference it, with `details` carrying the three counts. The `on delete restrict` foreign keys would have refused it anyway — as a database error nobody could act on. The counts are read first so the refusal can say what is in the way.
- **The conflict body carries counts and never content.** A test asserts the message does not contain the claim of the fact blocking the delete.
- **Another user's employer answers `404`, not `409`.** A conflict there would confirm the row exists and report how much hangs off it, which is the same leak a `403` would be.
- Roles, educations and certifications delete without a conflict check, because nothing references them. Projects still have no `DELETE`, per `docs/07` §4 — reassignment is the offered path.

#### The linkage rule the isolation test now protects

- **A fact whose `employerId` points at another user's employer is refused with `404`, and the fact is left untouched.** This is a new place to get "every query filters by `user_id`" wrong, and it is the one the issue named. The same check covers creating and moving a role.
- `/api/roles`, `/api/educations` and `/api/certifications` joined the collection sweep that asserts one user's marker never appears in another's response.

#### One rule that was nearly lost to a Zod detail

- The education outcome rule — **`ended_on` is null only when the outcome is 卒業見込** — is a rule about the finished row, not about the fields a request names. A PATCH therefore validates its own fields against the loose schema and the *resulting row* against the strict one.
- Writing it that way surfaced the defect: `.partial()` does not exist on a refined schema, so `educationBody.partial()` threw and the endpoint answered **500 instead of 422**. The fields and the rule between them are now separate schemas. The test that caught it asserts the rule holds when an outcome is edited onto a row that has no end date — the path a form actually takes when a course finishes.

#### What is verified, and what is not

- **The suite is green: 128 tests, 13 files, against real Postgres.** That includes the four scrub cases the 2026-09-06 entry above recorded as written but never run — the Docker daemon was started this session and they pass.
- **`npm run build` passes**, design-token check included. The five forms use no arbitrary Tailwind value.
- **The `/record` screen was walked in a browser against the dev record.** An employer saved and rendered with month-precision dates and no day; Roles' **Add** was disabled with its stated reason until an employer existed, then enabled; a role saved and rendered under its employer; and deleting that employer answered the `409` in place, reading *"This employer has 1 role attached"* — singular, from the same count the API returns. The role and the employer were then deleted and the dev record left exactly as found: 0 employers, 0 roles, 256 facts, none filed.
- **The employer picker is on all 112 accepted cards of the first real import, every one reading "Unfiled".** That is the 2026-09-04 finding rendered as an interface: the facts exist, they are accepted, and nothing says where any of them happened. Filing them is now a select on the card rather than a re-import.
- **The sign-in that made this possible failed twice first, and the second failure was mine.** Better Auth rejected the callback with `state_mismatch` and then `state_security_mismatch`; the state row was in `verifications` and unexpired, so the failure was the browser-side cookie, overwritten by overlapping sign-in attempts. What made them overlap was `npm run build` rewriting `dist/`, which the Worker serves through its `ASSETS` binding, so wrangler hot-reloaded mid-flow. **Do not build or run the suite while an OAuth round trip is open.**
- **The numeric definition of done is not met yet and could not be.** #14 asks for the English résumé to be regenerated once employers and roles carry the structure, and compared against the hand-produced document — specifically that the employment dates stop being less precise. That needs the author's real entities entered through the forms and a real model call. The plumbing is in place and tested; the comparison is the next session's work, and the issue should not be closed before it is run.

---

### [2026-09-06] The comparison #14 was built to reach was run; the dates came from rows and the bullets did not improve

- **Decision:** issue #14's numeric definition of done is **met**, and the issue can be closed. The English résumé was regenerated through the real route with a real `claude-opus-5` call, against the author's own entities entered through the API, and compared against the hand-produced document with the same measurement the 2026-09-04 entry used. The employer sections stop being inference. The bullet-composition gap does not close, and on one of its three measures it moves the wrong way.

#### What was entered, and how

- **Four employers and six roles**, hand-entered through `POST /api/employers` and `POST /api/roles` from the signed-in browser — the entities are hand-entered by decision, and this is that decision being exercised for the first time on real material rather than on a walk-through row. Two employers carry more than one role, so the promotion-is-a-second-row rule (`docs/04` §3.4) is exercised too.
- **90 of the 112 accepted facts were filed** through `PATCH /api/facts/:id`, one request each, against the real route and the real ownership check. All 112 were still `accepted` afterwards, which is the property the linkage test asserts and which is why re-importing was refused as the path to a foreign key.
- **22 facts were left unfiled on purpose.** They are training, certifications, language ability, the degree, independent projects and statements that span the whole career. None of them happened *at* an employer, and filing them under one to make a section look fuller would be the same inference this issue exists to remove. This number matters below.
- **Neither educations nor certifications were entered**, though the forms exist. `collectRenderInputs` puts neither in `RenderSpec`, so entering them could not have changed this render and would only have moved a second variable during a measurement.

#### The dates, which is the bar the issue actually set

- **The M1 render's employer headings carried eight date endpoints and two of them were year-only.** One was the start of the oldest employment; the other was the end date of the employer the 2026-09-04 entry singled out — "the generated employment dates are less precise than the hand-produced ones at exactly the employer whose end date no row carries."
- **This render carries eight endpoints and none is year-only.** Every one is month-precision and every one is character-for-character the value in the employer or role row.
- **The end date in question exists in no fact.** Zero of the 112 accepted claims contain it in any form; the claim that mentions leaving that employer gives a reason and no date. The M1 render printed a bare year because a bare year was all the prose could support. This render prints the month, and the only place the month exists is the row.
- **One employer's name appears in zero of the 112 accepted claims**, and all three industry labels appear in zero. All four render anyway, with the industry attached. That is the cleanest available proof that the section names are a join and not a reconstruction: the model could not have inferred what it was never given.
- **The two hand-maintained documents disagree with each other by one month on one employment start date.** The table was taken as authoritative, so the generated document now differs from the hand-produced résumé at that endpoint. That is a disagreement between two hand records, surfaced by having a single structured one — not a loss of precision.
- **One judgement call is recorded rather than buried.** The employment table names one role at one employer; a promotion part-way through is documented elsewhere in the same material and is dated only as "around" a month. Two rows were entered, using that month. A future reader comparing the table to the rows will find one more role than the table shows, and this is why.

#### Grouping, checked rather than eyeballed

- **82 fact references across the experience bullets, none under the wrong employer, and no unfiled fact used in an employer section.** The rule the entity layer added — a fact carrying no employer must not be placed under one — held on the first real run.

#### The bullets, which did not improve, and one measure that got worse

- Against the hand-produced document's **30 bullets averaging 191 characters with 57% carrying a number**:
  - **M1 (2026-09-04): 58 bullets, 125 characters, 33% numeric.**
  - **This render: 52 bullets, 130 characters, 25% numeric.**
- **Bullet count moved 10% toward the target, length moved 3%, and quantification moved 8 points away from it.** The issue predicted employer structure would not close this gap. It did not, and on the numeric measure it made the printed document worse.
- **The cause of the quantification drop is measurable and is not the model.** The 22 unfiled facts are **73% numeric** against the filed facts' **42%** — certification counts, a test score, degree years, personal-project metrics. In M1 every accepted fact competed for the experience section, so that dense numeric material was printed there. Now the section holds employer work only, which is correct, and the densest numbers left it.
- **They left the document, not just the section.** The register defines four sections — summary, experience, projects, skills — and independent projects are the only home outside experience. The training facts that appeared in the M1 render are absent from this one. **The register has nowhere to put a career fact that did not happen at an employer and is not a project**, and that was invisible while everything was an experience bullet.
- This does not change ADR-0001's prescription; it adds a second, separate one. Welding bullets is a `RESUME_REGISTER` change. Education and certifications sections are a register change plus the two entity tables reaching `RenderSpec`, which `collectRenderInputs` does not do today.

#### What the call cost

- One generation call: **17,337 input, 6,751 output, 1,583 cache-creation and 0 cache-read tokens.** First use of this prefix, so a zero read is expected rather than a finding. The extraction breakpoint the 2026-09-04 entry wanted a reading for is a different call and still has none — the next import produces it.

#### What was not done

- **The proposal was left pending, not accepted.** It is a proposal for the author to judge, and accepting it is a judgement about the author's own career document rather than a step in a comparison. The record still holds one accepted version.
- **The suite was not run and nothing was built during this session**, per the previous entry's rule: the Worker serves `dist/` through its `ASSETS` binding and a build hot-reloads it under an open session. The employer, role and fact-linkage code was unchanged by this session, so there is nothing here a green suite would have told us.

---

### [2026-09-06] Bullets are welded from several facts, and a career fact that happened nowhere finally has somewhere to go

- **Decision:** issue #15's two render-layer changes are built and measured. Bullet composition is a `RESUME_REGISTER` change, exactly as ADR-0001 predicted; education and certification sections are a register change plus two tables reaching `RenderSpec`. Against the hand-produced document's **30 bullets averaging 191 characters with 57% carrying a number**, the experience section moved from **52 / 130 / 25%** to **29 / 230 / 38%**. Count is on target, quantification recovered 13 of the 32 points it was short, and length overshot by 39 characters.

#### The measurement, and why it is trustworthy

- The same three numbers as 2026-09-04 and the entry above: blocks of kind `bullet` in the section keyed `experience`, their mean character length, and the share matching `/\d/`.
- The script was validated before it was used. Run against the previous proposal it returns **52 / 130 / 25%** — the recorded figures, to the digit. Run against the hand-produced document's own bulleted paragraphs it returns **30 / 192 / 57%**, which is the recorded target with one character of rounding. Neither number was taken on trust.

#### Composition

- The register now says a bullet is written from several facts and usually should be; that facts arrive atomic because review needs them atomic, and putting them back together is the document's job rather than the record's; that welding never crosses an employer or joins unrelated work; and that a number carried by any contributing fact must survive into the finished bullet, because dropping it is a defect rather than concision.
- **24 of the 29 bullets were composed from more than one fact**, against 20 of 52 before. Fact references rose from 82 to 88 while bullet count nearly halved.
- **The register was told the target shape** — about 30 bullets of about 190 characters — and told in the same breath that the shape is reached by composing and never by padding. That is tuning a register to the author's own house style, which is what a register is for, but a future reader should know the number was given rather than discovered.
- **Length overshot: 230 against 191.** Welding is easier to overdo than to underdo, and the instruction that permits a second sentence "when it carries the result" is the obvious suspect. This is the one measure that now misses the target from the wrong side.
- **Quantification improved but is still 19 points short.** Composition lifts it mechanically — a numeric fact welded to a non-numeric one produces a numeric bullet — and 38% is roughly what that mechanism alone predicts. Closing the rest is not a register problem; the remaining non-numeric bullets are non-numeric because the facts behind them carry no number.

#### The facts that had left the document

- `collectRenderInputs` now puts `educations` and `certifications` in `RenderSpec`, and the register defines a section for each. Both tables and all eight routes already existed; nothing reached a render.
- **Four education rows and seventeen certification rows were entered through `POST /api/educations` and `POST /api/certifications`**, one request each, against the real routes.
- The generated document carries **three education rows and fifteen certification rows**. The difference is the register, not the record: it omits schooling below university level, and it keeps the certifications section technical, so the two entered rows that are not technical certifications do not appear in it. One of the two is a language qualification, which the register sends to the summary, and that is where it appeared.
- **An education's outcome is data, never inference.** The prompt spells the enum out in words and says in as many words that a course left unfinished is never written as a completion. A withdrawal rendered as a graduation is a misrepresentation, not a formatting slip, and this is the one place a model's instinct to phrase things kindly would produce one.

#### Four things the entry surfaced that the record could not hold

- **One 学歴 row could not be entered at all.** `educations.startedOn` is `notNull`, and the author's own table records that row as a graduation month with no matching entry month. The row is real, it is in the hand-maintained document, and there is no honest value for the column, so it was left out rather than invented. A 履歴書 render built today would be missing a line the author's own 履歴書 has.
- **The two hand-maintained documents disagree about where a completed non-degree course belongs** — one files it as education, the other under 免許・資格 — and about the month it finished, by one month. It was entered as an education, because the outcome enum already has a value for a course that is not a degree, and the finishing month was taken from the table, following the precedent set one entry above. A 履歴書 register will need to print a completed non-degree education under 免許・資格 to match the hand document.
- **They also disagree about an outcome.** One records a course as left unfinished; the other presents the same course as a plain degree line. The table was taken as authoritative, so the generated résumé now states plainly what the hand-produced résumé softens. That is the structured record refusing to blur something, which is the point of having one, and it is the author's call whether to keep it.
- **A row entered in both tables printed twice.** Entering the same course as an education and as a certification produced two rows in one document. The certification row was deleted. Nothing in the schema prevents this, because the two tables have no relationship to each other; the render is where it becomes visible.
- **Issuers absent from the source table were supplied from the certifying body's own name**, never guessed. `issuingOrganization` is `notNull` and the author's table names an award without naming who awards it.

#### The invariants, checked rather than assumed

- **Zero unfiled facts used in an employer section, and zero facts placed under a heading naming a different employer**, across 88 fact references. The rule the entity layer added held again, under a register that now actively encourages welding — which was the obvious way for it to break.
- **The suite is green: 128 tests, 13 files.** Run before the model call and after the code changes, with no OAuth round trip open.

#### What the call cost

- One generation call: **17,337 input, 7,431 output, 3,629 cache-creation and 0 cache-read tokens.**
- **The uncached input is identical to the previous call's, to the token.** That is the expected shape rather than a coincidence: the facts block did not change, and the register and the two new lists landed in the cached prefix, where cache-creation rose from 1,583 to 3,629. Cache reads are zero again because the prefix changed, which is the third generation in a row to produce no reading for the breakpoint. A second generation with an unchanged prompt is the only thing that will.

#### What was not done

- **The proposal was left pending again.** The record still holds one accepted version, from 2026-09-04. Accepting is a judgement about the author's own career document.
- **The register was not re-tuned after the overshoot, and no second generation was run.** One call was authorised and one was made. Correcting a 39-character overshoot costs another call, and the number it would move is already known and recorded.

---

### [2026-09-06] The register's length overshoot was blamed on the wrong line, and the cache breakpoint finally read

- **Decision:** the second-sentence permission is tightened, `educations.started_on` becomes nullable, and the register is told to print a qualification recorded in both lists only once. Two generations were run back to back on an unchanged prompt. The tightening did **not** close the length overshoot, and the measurement says why the previous entry's suspect was wrong. The cache breakpoint produced its first reading in four generations.

#### The length overshoot: the recorded suspect was not the cause

- The previous entry named the instruction permitting a second sentence "when it carries the result" as the obvious suspect for 230 characters against a 191 target. It was tightened to a budget — a second sentence is the exception, two or three bullets in a document of thirty — and the result moved almost nothing.
- Against the hand-produced document's **30 / 191 / 57%**:
  - **composition, before the tweak: 29 / 230 / 38%**
  - **tweak, run 1: 29 / 226 / 45%**
  - **tweak, run 2: 30 / 225 / 40%**
- **The permission was never being used. Zero of the 29 bullets in the pre-tweak render had a second sentence.** Tightening an instruction the model was already obeying could not have reduced anything, and did not: 230 → 225 is a 2% move against a 20% overshoot. The suspect was recorded from reading the register rather than from counting the document, and counting the document refutes it.
- **The overshoot is a small number of very long single sentences, not many slightly long ones.** The longest bullet runs **384, 469 and 395 characters** across the three renders, and **9 to 10 of about 30 bullets exceed 250 characters**. A mean of 225 with a maximum of 469 is a tail, and the register currently bounds neither: it gives a target mean and a sentence count, and a single sentence has no length limit. **The next attempt should bound the bullet, not the sentence.**

#### What two runs on one register bought, which no previous entry had

- Every earlier number in this log is a single sample, and differences between them were read as effects. **Two generations on a byte-identical prompt give the first variance reading:** count 29 → 30, mean 226 → 225, numeric 45% → 40%.
- **Length is stable and quantification is not.** One character of spread on the mean means the 225 is a real property of this register. Five points of spread on the numeric share means **the apparent 38% → 45% jump in run 1 was mostly noise**, and the honest reading of the tweak's effect on quantification is "no measurable change, ±5 points".
- This is a standing caution for every number above: a difference of a few points between two renders generated from different prompts is within the noise of two renders generated from the same one.
- Quantification remains roughly 15 points short of 57%, which is the previous entry's finding unchanged and its recorded cause — the facts behind the remaining bullets carry no number — untouched by anything here.

#### The 学歴 row that could not be entered

- **`educations.started_on` is nullable**, migration `0005_education_start_optional`. The author's 学歴 table records 中学校 as a graduation month with no entry month, which is 履歴書 convention rather than a gap in the record. `notNull` did not produce the missing value; it kept a real row out, and a 履歴書 built from the record would have been short a line.
- **Nullable is not dateless.** A row still needs one endpoint, enforced in `credentials.ts` on the resulting row rather than on the fields a PATCH names, following the precedent the outcome rule set. A row with neither date answers **422** naming `startedOn`.
- **The nulls-last trap, which was live in two places.** Postgres sorts nulls LAST in `ASC`, so a row carrying only a graduation month sorted to the *bottom* of a chronological 学歴 list — the author's oldest schooling printed last. Both the render service and `GET /api/educations` now order on `coalesce(started_on, ended_on)`. The second one was missed on the first pass and caught by listing the rows back rather than by reading the code.
- The row was entered through the real route and the list now reads oldest-first in exactly the author's own 学歴 order, five rows.

#### One thing the new row surfaced that no one asked about

- **The register's "omit schooling below university level" is ambiguous, and the model moved the line when the list changed.** With three education rows it omitted high school. With the middle-school row added it *included* high school and omitted middle school — it drew the boundary one level lower rather than applying a fixed rule. The English render is not where this matters, but the instruction is doing less work than it appears to.
- **Run 2 printed the education section in reverse chronological order**, against a register that says "in the order that list gives" and a list that is oldest first. Run 1 obeyed. One compliance wobble in two samples, on an instruction that is stated plainly.

#### The duplicate guard, which is written and has not been exercised

- The register now says a qualification appearing in both the Education and Certifications lists is one qualification recorded twice, and is written once under education.
- **It caught nothing, because there is nothing to catch.** The duplicate the previous entry found was deleted from the record in that session, so no duplicate reached these renders. The certifications section went from 15 rows to 14 for that reason and not because of this line — an attribution that was made and then checked against the table, which holds no such row.
- The count that *is* explained: 16 certifications, minus a driving licence and a language qualification the register routes elsewhere, is 14. **The line is a render-time guard with no test behind it.** Nothing in the schema prevents the duplicate, because the two tables have no relationship, and the next duplicate entered is the first thing that will exercise it.

#### The cache breakpoint, after three generations of zeroes

- **Generation 1: 17,337 input, 7,541 output, 3,775 cache-creation, 0 cache-read.** The prefix changed — the register tweak and the new education row both land in it — so a zero read is the expected shape.
- **Generation 2, prompt untouched: 17,337 input, 7,513 output, 0 cache-creation, 3,775 cache-read.** The 1-hour breakpoint reads back exactly what the previous call wrote, to the token. **This is the first cache read this project has recorded**, and it is the reading the 2026-09-04 entry asked for.
- The extraction breakpoint still has none. The next import produces it.

#### The invariants, checked on both runs

- **88 and 90 fact references across the experience bullets; zero unfiled facts used in an employer section, zero facts placed under a heading naming a different employer, zero ids the record does not hold.** Held under a register that actively encourages welding, on two independent samples.
- **The suite is green: 129 tests, 13 files**, one more than the previous entry — the new case asserts a graduation-only row is accepted and a dateless one is refused. `npm run build` passes. Both were run with no OAuth round trip open; the session was a minted cookie throughout.

#### What was not done

- **The register was not re-tuned after the overshoot survived the tweak.** Two calls were authorised and two were made. What the next attempt needs is now specific — a per-bullet length bound rather than a sentence count — and it is one register change and one generation.
- **Both proposals were left pending.** The record still holds one accepted version, from 2026-09-04, and now four pending proposals. Accepting is a judgement about the author's own career document.

### [2026-09-06] The bullet was bounded rather than the sentence, and the schooling rule turned out to be unanswerable from the data

- **Decision:** `RESUME_REGISTER` gains a per-bullet length bound and an instruction on what to cut when a bullet exceeds it. One generation was run. **The overshoot closed: 225 → 190 characters against a 191 target.** The previous entry's prediction — bound the bullet, not the sentence — was correct, and this is the first register change in the sequence whose effect is larger than the noise band. The education-boundary finding recorded in that entry is superseded: the model is not applying a rule loosely, it is being asked a question the record cannot answer.

#### The bound, and what it moved

- Against the hand-produced document's **30 / 191 / 57%**, and the previous best of **30 / 225 / 40%**:
  - **bullet bound: 33 / 190 / 39%**
- **Mean length is on target for the first time.** 225 → 190 against 191, a 35-character move where the sentence tightening moved 5. The tail came with it: the longest bullet ran **395 → 287** characters, and bullets over 250 went **9 → 5**.
- **Quantification did not move: 40% → 39%**, comfortably inside the ±5-point noise band. This is the expected result and not a disappointment — the recorded cause is that the facts behind the remaining bullets carry no number, and nothing here touched that.

#### What the bound cost, which was bullet count and not composition

- **Count rose 30 → 33 against a target of 30**, which is outside the ±1 noise band and therefore a real effect. The register explicitly says not to split an over-long bullet into two, and three splits happened anyway.
- **Nothing was dropped to achieve it.** Fact references held at **90, identical to the previous run**, so the three extra bullets are a redistribution rather than a loss. Facts per bullet went 3.00 → 2.73, and the shape of the change is precise: **the two 5-fact bullets disappeared and the 2-fact bullets went 5 → 8, while all three 6-fact bullets survived.** The heaviest welds were trimmed at the edges, which is the mechanism the instruction asked for. The welding that ADR 0001 argued for is intact.
- The honest cost, then, is three bullets of count in exchange for 35 characters of mean and 108 characters off the tail. Whether that trade is right is the author's call on reading the document, not a number.

#### How the model treats a stated number, which is worth knowing before writing the next one

- **The ceiling was stated at 240 characters and the longest bullet came back at 287** — overshot by 20%. A stated bound is not a hard limit and should not be written as if the next one will be obeyed exactly.
- **But the mean landed exactly on the stated 190.** The mean instruction had been in the register all along and was being missed by 18%; adding a per-item bound is what made it bind. The reading is that **a mean is not something the model can check while writing, and a per-bullet ceiling is** — the ceiling works by giving each bullet a local test, and the mean then falls out. This is the transferable lesson for the 履歴書 and 職務経歴書 registers: bound the item, state the aggregate as shape.

#### The schooling rule: the previous entry's diagnosis was wrong, and the data is the reason

- The previous entry recorded that the model "moved the boundary when the list changed" and read the instruction as behaving like a preference. **A third sample says otherwise, and the record explains it.** The render again kept 高校 and dropped 中学校 — four education rows printed from five.
- **The row it kept is `San Beda College Alabang`, and the row it dropped is `Westfield Science Oriented School`.** Both are pre-university, both carry an empty `degree`. The register says to omit schooling below university level. **`educations` has no column stating level** — it holds institution, faculty, degree, field of study, dates and outcome, and nothing else — so the only signal available is the institution's name, and one of these two names contains the word "College".
- **The instruction is not ambiguous; it is unanswerable.** It asks the model to classify a row by a property the row does not carry, and the model does the only thing it can, which is read the name. This is not fixed by rewording the register. It is fixed by the record carrying the level, or by the register naming the rows rather than the category — and the first is the one that survives a second user.
- Filed as a finding, not a change. Nothing was edited here.

#### The ordering wobble did not recur

- The education section printed **oldest first, in the order the list gives**, matching the `coalesce(started_on, ended_on)` ordering the previous entry fixed. Run 2 was the only disobedience; the count is now one wobble in three samples on that instruction.

#### The cache breakpoint, and the invariants

- **17,337 input, 7,453 output, 4,004 cache-creation, 0 cache-read.** A zero read is the expected shape: the register changed and it lands in the prefix. The 4,004 against the previous 3,775 is the three added lines. **The extraction breakpoint still has no reading.**
- **90 fact references, zero unknown ids, zero unfiled facts used in an employer section, zero facts placed under a heading naming a different employer.** Held again, on a register that now asks the model to cut facts out of bullets — the cutting did not corrupt the attribution of what remained.
- **The suite is green: 129 tests, 13 files.** `npm run build` passes, design tokens clean. Both run against a minted cookie with no OAuth round trip open.

#### The measurement script, still not committed

- Rebuilt from the definition in the log and **validated against all four prior proposals before being trusted** — it reproduces 52/130/25%, 29/230/38%, 29/226/45% and 30/225/40% exactly, and the recorded longest-bullet figures with them. That validation is the reason the 190 is believable.
- It still lives in a scratchpad. **Every session that wants this number rebuilds it**, and the rebuild is only safe because the log records enough prior readings to check it against. A committed script would be cheaper and would remove the chance of a session measuring something subtly different, but it would also be the first piece of comparison scaffolding to enter the repository, and nothing has decided that it belongs there.

#### What was not done

- **The five pending proposals were left pending**, and there are now five. Accepting one is a judgement about the author's own career document.
- **The bullet count was not chased.** The obvious next move is to strengthen the do-not-split instruction, but that is a second change on top of an unmeasured one, and the count overshoot is three bullets against a length win of 35 characters. The register is left where it is until the author reads the document.

### [2026-09-06] The record carries the schooling level, and a field reached the payload without reaching the model

- **Decision:** `educations` gains a `level` column, and `RESUME_REGISTER` selects education rows by it instead of asking the model to classify an institution by its name. **The previous entry's finding is now closed: the education section prints three rows against the hand-produced document's three, and the set matches exactly.** Both pre-university rows are gone, and neither the register nor the model had to read a name to do it.

#### The column

- `education_level` is an enum of `secondary_lower`, `secondary_upper`, `vocational`, `tertiary`, `postgraduate`. **Stage-neutral rather than 中学校/高校/大学**, because most of this record's schooling is not Japanese and a Japanese ladder would be the wrong label at the point the row is stored. The 履歴書 register maps a rung to Japanese wording where Japanese wording belongs.
- `vocational` is a rung rather than a track on purpose. A completed non-degree programme is what `13` §6 needs to print under 免許・資格, and that is a question about level and outcome together — a `below_university` boolean cannot answer it.
- **Nullable in the database, required by `credentials.ts` on every row the API accepts.** The same split `started_on` uses, for the same reason: a migration cannot classify rows that already exist. Migration 0006 adds the column and classifies nothing; the five dev rows were classified by hand and the statement was not committed, because it maps real institution names.
- **A row with no level is PRINTED, never dropped.** Losing a real education to a missing classification is the worse failure, and the wording sent to the model says so in as many words.

#### The defect, which is the more useful half of this entry

- The column was added to the schema, to the API, to `RenderSpec` and to the payload `render.ts` builds. **The type check passed, the suite was green, and the field still never reached the model.** `buildGenerationPrompt` hand-formats the education line, and it was not updated.
- The register had already been rewritten to say "each entry states its level". So the model was **told to read a field it could not see**, and did the only honest thing available: it printed all five rows and wrote **"level not stated"** into two of them. That string reached a real document. The failure was not the model's.
- **TypeScript cannot see this class of bug.** The payload is built inside `.map()`, and an object literal returned from a callback carries an excess property to a typed destination without an excess-property check. `level: e.level` compiled cleanly against a `RenderSpec` that had no `level`.
- It was caught by reading the rendered output, not by any check in the repository. **One generation, ~$0.55, was spent producing the evidence.**

#### What now catches it

- `tests/prompt.test.ts` is new, and `buildGenerationPrompt` had **no test at all** before it — which is the reason a payload field could vanish silently on the way to the model.
- It asserts the level reaches the prompt TEXT for all five rungs and for null, that the two below-university rungs are distinguished from the three that are kept, and that the pre-existing 中退 wording still survives.
- **Verified as a negative control:** with the level removed from the prompt line, three of its four tests fail. The fourth is the outcome invariant and correctly still passes.
- The general rule this encodes: **a field is not delivered when it reaches the payload, only when it reaches the prompt string.** Every future `RenderSpec` field needs a line here.

#### The measurement, and a caveat that changes how the noise band should be read

- Against the hand-produced **30 / 191 / 57%**, and the previous best of **33 / 190 / 39%**:
  - **level column: 31 / 195 / 35%**
- **Nothing in this change touches experience bullets**, and the experience section still moved: count 33 → 31, mean 190 → 195. Both are outside the ±1 band.
- **The ±1 band was measured on a BYTE-IDENTICAL prompt, and does not transfer to a changed one.** Three runs across three prompts now read 33/190, 33/183 and 31/195 — a spread of 2 bullets and 12 characters from changes aimed at a different section entirely. The honest reading is that **an edit anywhere in the prefix perturbs the whole document**, and any comparison across two different prompts carries roughly ±2 count and ±6 mean before it means anything.
- This retires nothing already recorded — the 225 → 190 move was 35 characters and stays far outside even the wider band — but it means **a future single-sample difference of 2 bullets is not a result.**
- Quantification 39% → 35% is inside even the narrow band and is the expected non-result; the cause remains that the facts behind those bullets carry no number.

#### A finding that is not in any thread, and was not changed

- **Every generated render prints education oldest-first. The hand-produced document prints it newest-first.** The register says "in the order that list gives" and the list is ordered `coalesce(started_on, ended_on)` ascending, so the renders have been obeying the instruction exactly and the instruction disagrees with the document.
- Not changed here. The query ordering is load-bearing for a different reason (nulls sorting last would bury the oldest row) and must not be touched; this is a presentation instruction, and reversing it silently would also spend the track record of an instruction the log is counting wobbles against. **Filed for the author.**

#### Invariants and cost

- **Cache-read is 0 again, as expected** — the register and the prompt formatter both land in the prefix. Cache-creation 4,004 → 4,107. **The extraction breakpoint still has no reading.**
- The suite is green: **134 tests, 14 files**, up from 129/13. `npm run build` passes, design tokens clean. No OAuth round trip was open; the API was reached with a minted cookie throughout.
- **Two generations were run, ~$1.10, and one of them bought only the defect.** That is the honest price of shipping the register change and the prompt formatter separately.

#### The measurement script, rebuilt and validated again

- Rebuilt from the definition in this log and **validated against all four prior proposals before any new number was trusted** — 52/130/25%, 29/230/38%, 29/226/45% and 30/225/40%, reproduced exactly, along with the recorded longest-bullet, over-250 and facts-per-bullet figures.
- Still not committed, and still rebuilt from scratch every session.

#### What was not done

- **The bullet count was still not chased**, and it moved on its own to 31. It remains the author's call on reading a document.
- **There are now six pending proposals**, none accepted. Two of them were produced by this session.

---

### [2026-09-07] The schema doc catches up with the schema, and the 履歴書 rule for a missing entry month is stated

- **Decision:** `docs/04-database-schema.md` is brought back in step with `src/server/db/schema.ts`. No code changed and no generation was spent.
- **Reason:** `docs/` is the source of truth, and it had been behind the last two schema changes. The doc listed neither the `education_level` enum nor the `level` column, and its `educations.started_on` row still read **Null: no** although migration `0005` made it nullable. A source of truth that lags the code teaches the next session the wrong shape of the record.

#### What was corrected

- **§2** gains `create type education_level as enum ('secondary_lower', 'secondary_upper', 'vocational', 'tertiary', 'postgraduate')`.
- **§3.8** gains a `level` row, and `started_on` moves to **Null: yes**. Both carry the reasoning the log already holds: the nullable-in-database / required-by-`credentials.ts` split, the stage-neutral enum, `vocational` as a rung rather than a track, and the rule that **a row with no level is printed, never dropped**.
- **The index note** now says the queries order on `coalesce(started_on, ended_on)` rather than on `started_on`, which is the thing that keeps a graduation-month-only row from sorting last.
- **`docs/10` §Screen 4** now says Education carries a required level, not only an outcome. It is the interface contract, and the form grew a required field.

#### The one thing here that is a decision rather than a sync

- The 履歴書 rule in §4 said **two** rows per `educations` record, an 入学 from `started_on` and a closing row from `ended_on`. Since `0005` that is not always possible. It now reads: **a record whose `started_on` is null contributes the closing row only** — no 入学 row with a guessed month, and the record is not dropped.
- This follows from what `0005` was for (the author's 中学校 is recorded as a graduation month with no entry month, which is 履歴書 convention rather than a gap) and from the rule already stated for a missing `level`: print what the record has, never drop a real row. **No 履歴書 render exists yet**, so this is a spec statement ahead of the code and the cheapest possible thing to supersede if the author reads it differently.

#### What was checked and found clean

- Every `pgTable` in the schema was compared column-by-column against its §3 section. **`educations` was the only table out of step**; the other differences were the combined sections (`3.6`, `3.10`, `3.11`) and the Better Auth tables the doc deliberately does not enumerate.
- No other doc asserted the old `started_on` nullability or was missing the level.

#### What was not done

- **The education ordering thread is still open and still the author's.** Renders print oldest-first, the hand-produced document prints newest-first, and the query ordering must not be touched. Nothing here touched it.
- **Six pending render proposals, none accepted.**

---

### [2026-09-07] The order a document reads in is a property of the document, and the résumé had been disagreeing with itself

- **Decision:** each render kind states the direction it reads its dated lists in. `RenderDefinition` gains `chronology`, the English résumé states `newest_first`, and `collectRenderInputs` applies it to employers, education and certifications at the render boundary. No query was reordered and no generation was spent.
- **Reason:** the open thread was recorded as the renders printing education oldest-first while the hand-produced document prints it newest-first — a disagreement between the generated document and the author's. It is smaller and more decidable than that. **The résumé disagreed with itself.**

#### The finding that decided it

- `employers` is queried `desc(started_on)`. `certifications` is queried `desc(issued_on)`. `educations` is queried ascending, on the coalesce. The register says **"in the order that list gives"** for all three.
- So one document was printing experience newest-first, certifications newest-first and education oldest-first, and had been since education reached the spec on 2026-09-06. The question was never which convention an English résumé follows. It was whether one document may order two of its lists one way and the third the other.
- The direction had been living in the queries, where it was three independent decisions nobody had ever seen side by side. It is one decision, and it belongs to the render.

#### Why the reversal is at the boundary and not in the query

- **The education query ordering stays exactly as it was.** It orders on `coalesce(started_on, ended_on)` so a row carrying only a graduation month sorts by the date it has. Flipping that query to `desc` would put that row at the wrong end again — nulls change which end they sort to, the coalesce does not. `inDocumentOrder` reverses the finished list instead, which keeps the coalesce and inverts only the `id` tie-break.
- **The register line was not touched either.** "In the order that list gives" is what keeps the model out of sorting dates. Asking it to sort newest-first would buy nothing and add a way to get a date wrong.

#### What the other four kinds state

- **`rirekisho` states `oldest_first`.** That is not a new decision: `docs/02` §101 and `docs/04` §4 already require the 学歴・職歴 table to be complete and chronological. Recording it here means the 履歴書 gets the right order from the day it becomes buildable, including for employers and certifications, whose queries run the other way.
- **`shokumu_keirekisho` and both career stories state `null`.** A 職務経歴書 is written 編年体 or 逆編年体 and nothing in this project has chosen; a career story's direction is a question about the story. `null` is the same placeholder the empty register already is. A test asserts that a **buildable** kind states a direction, so a kind cannot become generatable while its direction is still unstated.

#### Found and not fixed

- **`certifications` is ordered `desc(issued_on)`, and `issued_on` is nullable.** Postgres sorts nulls FIRST in `desc`, so a certification with no issue date currently leads the résumé's certifications list. The education query has a coalesce for exactly this class of problem and this query has nothing. Not touched here, because it is a different question — where an undated qualification belongs — and it wants the author, not a default.

#### What was corrected in the docs

- `docs/04` §3.6's index note said **"every render lists employers in reverse chronological order"**, which contradicted §4 of the same file, where the 履歴書's 職歴 block is ascending. It now says the direction belongs to the document.
- §3.8's and §3.9's index notes say the same thing from the other side: ascending is canonical, and the résumé reads the index backwards.

#### What was verified

- **137 tests across 14 files, up from 135; type check and build green.** Two tests were added: the résumé's education and certification lists both arrive newest-first with the graduation-month-only row at the month it has, and every buildable kind states a direction.
- **The assertion is on the payload the model is given, not on what the model writes**, which is why this cost no generation. A rendered document has not been produced from the new order, and doing so costs one.

#### What was not done

- **Six pending render proposals, none accepted.** Unchanged.
- **Quantification at 35% against the hand document's 57%**, still a fact-layer shortage rather than a register problem.
- **The measurement script is still uncommitted.**

---

### [2026-09-07] An undated certification reads last, and the placement is the document's rather than the query's

- **Decision:** `inDocumentOrder` takes an optional accessor for a list's date, and moves the rows carrying none to the end of the document's list. `certifications` passes it. No query was reordered, no register changed and no generation was spent.
- **Reason:** `certifications` is queried `desc(issued_on)` and `issued_on` is nullable. Postgres sorts nulls FIRST in `desc`, so **an undated licence had been leading the résumé's certifications list** — filed as found-and-not-fixed on 2026-09-07 because where an undated qualification belongs wanted an answer rather than a default.

#### The answer, and the reason it is the tail

- In a list ordered by date, **position is a claim about when**. A row with no date makes no such claim, so leading with it lets an absence displace the most recent real certification from the one position in that list a reader weighs. The tail asserts least and displaces nothing.
- **Never dropped, in the résumé.** This is the same posture the `level` rule already states for `educations`: print the row, and do not let missing data speak for it.
- **The 履歴書 is the exception and was already decided.** `docs/04` §4 omits a null-`issued_on` row from 免許・資格, because that table is 年 / 月 / 名称 and has nowhere to put it. That is a register rule for a render that does not exist yet; until it does, the tail is where the row does least damage.

#### Why the fix is at the boundary and not in the query — the transferable half

- **Null placement does not survive a reversal.** Nulls sort first in `desc` and last in `asc`, so `nulls last` in the query would read correctly for the résumé and put the undated row at the HEAD of the 履歴書's ascending list. The identical defect, mirrored.
- So the rule has to be applied **after** `inDocumentOrder` reverses, not before. This is the same shape as the 2026-09-07 chronology entry and is worth stating as a rule: **anything that depends on which end of a list a row lands at belongs to the document, not to the query.** The query owns the canonical order; the boundary owns everything about how the document reads it.
- `certifications` is **the only list reaching a render whose sort key can be null.** `employers.started_on` is `not null`, and `credentials.ts` refuses an education carrying neither a start nor an end, so its coalesce can never be null either. The accessor is optional for that reason and is passed by exactly one caller.

#### What was rejected: a coalesce onto `expires_on`

- `educations` answers this class of problem with `coalesce(started_on, ended_on)`, and the obvious echo is `coalesce(issued_on, expires_on)`. It is wrong. Education's fallback is a **near miss for the same event** — a graduation month is months from the entry month it stands in for. An expiry is typically **years** after the issue it would stand in for, and most certifications have none at all. It would place an undated certification later than every dated one on the strength of a number that means something else. A guess dressed as data is worse than an admitted absence.

#### What was verified

- **139 tests across 14 files, up from 137. Type check and build green, design tokens clean.**
- Two tests were added: the résumé reads an undated licence behind both dated ones, and `inDocumentOrder` keeps an undated row at the tail in **both** directions — the second is the one that would catch a future 履歴書 inheriting the mirrored defect.
- **Verified as a negative control.** With the accessor removed from the call site, the résumé test fails with the undated licence at the head of the list. The nulls-first behaviour was confirmed against the real database rather than assumed from the documentation.
- The assertion is on the payload the model is given, not on what the model writes, which is why this cost nothing.

#### What was not done

- **The API list route was left alone.** `GET /api/certifications` still orders `desc(issued_on)` and still leads with an undated row. A management list has a different job from a document — an incomplete row surfaced first is arguably where it should be, because that screen exists to complete it. Named here so the divergence is deliberate rather than overlooked.
- **The query was not normalised to ascending.** `educations` is queried ascending and reversed at the boundary; `employers` and `certifications` are queried descending and are not. Both work, but `docs/04`'s phrase "reads the same index backwards" describes only the first. Tidying it touches two more queries for no behaviour, and is not worth doing on the way past.
- **Six pending render proposals, none accepted.** Unchanged, and still the oldest thread here.
- **The new ordering still has not been seen in a rendered document.** Both the chronology change and this one are asserted on the payload. Confirming them costs one generation.
- **The measurement script is still uncommitted.**

---

### [2026-09-08] The measurement script enters the repository, and the oldest reading in this log turns out to be one character out

- **Decision:** the comparison instrument is committed. `src/render/metrics.ts` holds the definition, `scripts/measure-render.mjs` is the CLI, `npm run measure` runs it, and `tests/render-metrics.test.ts` pins what it counts. No generation was spent.
- **Reason:** every register decision recorded since 2026-09-04 is argued against three numbers, and until now the thing producing them was **rebuilt from prose in this log at the start of every session**. Four entries record the rebuild and record it being validated against prior readings before it was trusted. That is a manual safety net over a growing corpus, and it frays: it depends on the log continuing to record enough readings, and on each session bothering to run them.

#### The objection that turned out not to hold

- The open question was recorded as whether **comparison scaffolding belongs in the repository at all**, since it would be the first of its kind. It would not have been. **`scripts/restore-drill.mjs` is already committed non-product scaffolding** — a monthly operations drill that no route calls — and `scripts/ensure-databases.mjs` with it. The precedent was set on 2026-08-29 and this is the second instance, not the first.

#### Where it lives, and why it is split in two

- **The definition is `src/render/metrics.ts`, and it has no imports at all.** That is what lets `node` load it directly for the CLI, and it is why the module declares its own structural input type instead of importing `RenderContent`. The test passes a real `RenderContent` value into it, and that assignability is the coupling check — the two shapes cannot drift without the type checker saying so.
- `src/` rather than `scripts/` for the definition, deliberately, because **`src` and `tests` are the only trees `tsc --noEmit` and the suite both reach.** An instrument that is not type-checked and not tested is the thing this entry exists to stop. **It costs nothing to ship: the client bundle is byte-identical after the change** — same filename hash, same size — because nothing imports it.
- The CLI stays in `scripts/`, untyped, alongside its neighbours, and reaches the database through **psql rather than the application's driver** — the same reason the restore drill does: a measurement is an operations task and must not depend on the Worker being able to run.

#### The output contract, which is a reason to commit rather than a detail

- **It prints numbers and never text.** Not the longest bullet, not a sample, not an excerpt in an error message. A render is built from the author's real career record, `local/` material and NDA-bound client names reach it, and "logs never contain render content" does not stop applying because the output is called a measurement.
- **An ad-hoc script rebuilt each session has no such contract**, and nothing stopped a rebuild from printing the longest bullet to a terminal to see what it was. Committing the instrument is what makes the rule enforceable.
- It reads `track_record_dev` and never `track_record_test`, which is dropped and rebuilt by every run of the suite and holds invented fixtures.

#### What it counts, now stated once

- Blocks of kind `bullet` in the section keyed `experience`: **count, mean character length, and the share matching `/\d/`** — the same three numbers as every entry since 2026-09-04. Underneath them the longest bullet, bullets over 250 characters, fact references, facts per bullet and multi-fact bullets.
- **`--markdown` reads a hand-written document as bullet LINES**, which is how the 30 / 191 / 57% target every comparison runs against was produced. An ASCII marker must be followed by a space or `*emphasis*` opening a line would count; `•` and `・` need not be, because a Japanese document writes ・項目 with nothing between and a 職務経歴書 will be measured here too.
- **The digit rule is crude on purpose.** It counts `two thirds` as unquantified, and it has counted it that way in every reading this log holds. A better rule would make the next reading incomparable with all of them.

#### The validation, and the one figure that does not reproduce

- All **eight** stored proposals were measured in generation order. **Seven reproduce the recorded reading to the digit**: 52 / 130 / 25%, 29 / 230 / 38%, 29 / 226 / 45%, 30 / 225 / 40%, 33 / 190 / 39%, 33 / 183 / 36% and 31 / 195 / 35%.
- **The oldest does not.** 2026-09-04 records **58 bullets averaging 126 characters**; the instrument reads **58 / 125 / 33%**, and the exact mean is **125.379**, which rounds to 125 under any convention. The count and the quantified share match.
- **That reading predates the script.** The 2026-09-06 entry says as much from the other side: it validated against 52 / 130 / 25% and describes the hand document coming back as 192 characters, "the recorded target with one character of rounding", where **191** has been used in every comparison since. The same entry carries the same ±1 imprecision on both its figures.
- **Nothing was edited.** This log is append-only, and a one-character correction to a superseded baseline is not worth a supersession — it is worth knowing that **the only reading that does not reproduce is the only one taken before there was an instrument.** That is the argument for committing it, made by the data rather than by me.

#### What it deliberately does not do

- **None of the attribution invariants.** Unknown fact ids, unfiled facts used in an employer section, facts placed under a heading naming a different employer — those are questions about the record as well as the render, and they are still checked by hand.
- **It does not fetch.** There is no mode that generates, and no mode that reaches the API. It reads a proposal already stored, a JSON file, or a document.

#### What was verified

- **149 tests across 15 files, up from 139. Type check and build green, design tokens clean, client bundle unchanged.**
- Ten new cases pin the definition against invented fixtures: which blocks count, which sections count, how each figure rounds, that an empty section returns zeros rather than `NaN`, that a written-out quantity counts as carrying no number, and that the line reader takes ASCII, `・` and numbered markers while leaving prose alone.
- The CLI was run end to end against an invented JSON fixture and against the dev database.

#### What was not done

- **Six pending render proposals, none accepted.** Unchanged, and now the oldest open thread by a wide margin.
- **The chronology work still has not been seen in a rendered document.** Both 2026-09-07 entries are asserted on the payload. Confirming them costs one generation.
- **Quantification at 35% against the hand document's 57%**, still a fact-layer shortage rather than a register problem.

---

### [2026-09-08] The chronology is read in a written document at last, and the undated rule turns out to be unexercisable against this record

- **Decision:** the two 2026-09-07 chronology changes are **confirmed in a generated document**. One generation was spent, with approval, against the author's own record through the real route. The undated-certification rule is **not** confirmed, and the reason is stronger than "not yet": this record cannot exercise it.
- **Reason:** every ordering decision since 2026-09-07 was asserted on the `RenderSpec` payload. That establishes what the model is handed and says nothing about what it writes back, and a model free to reorder a list it is given would have defeated the fix silently. It no longer can.

#### What the document reads

Positions and dates only; the ordering was derived programmatically rather than by eye, and no prose left the database.

- **Experience: 4 employer headings of 4, strictly non-increasing by start month.** Every employer in the record reached the document.
- **Certifications: 14 rows, strictly non-increasing at MONTH precision.** Year precision would not have been evidence — seven rows share two months — so the document order was matched back to `issued_on` per row.
- **Education: 3 rows, newest-first.** The list is queried `asc(coalesce(started_on, ended_on))` and reversed at the boundary, and it arrives descending, which is the whole of the 2026-09-07 chronology fix. The one document now reads all three of its dated lists in one direction.

#### The undated rule could not be reached, and the entry that stated it was reading a fixture

- **No certification in the record carries a null `issued_on`.** All sixteen are dated. The driving licence — the row the 2026-09-07 entry describes as leading the list — carries an issue date, and its `created_at` and `updated_at` are the same instant. **It has never been edited, so it was never undated.**
- The undated licence in that entry was therefore **the test fixture**, not this record. The fix is real, the tests pin it in both directions, and the negative control that entry records was genuine. What is not true is that entry's present tense about the live list — `GET /api/certifications` does not lead with an undated row, because there is no undated row to lead with. Stated here rather than edited there.
- **Confirming the rule against real data would require inventing a certification in the author's record.** That is not a thing to do for a green check, so the rule stays payload-and-fixture-proven, and is marked here as unexercisable rather than pending.
- **The null-`started_on` education rule is unexercised for the same class of reason.** The one such row is `secondary_lower`, and the register omits every entry below university level before the rule could apply.

#### Two certifications are absent from the document, and both absences are instructed

- Sixteen certifications reach the payload — `render_inclusions` is **empty**, so nothing is configured out, and `collectRenderInputs` filters none. Fourteen rows appear. **The gap is the register doing what it says**, not the model dropping rows: `spec.ts` tells it a driving licence is not a technical certification, and that a language qualification belongs in "summary" if anywhere.
- **Both instructions were obeyed.** The licence appears nowhere in the document, and the language qualification was verified present in the summary rather than merely gone. Checking that the row moved rather than vanished is the part worth keeping — an omission and a relocation look identical from a row count.

#### The register did not move

- **31 bullets / 192 mean characters / 35% carrying a number**, against the immediately preceding proposal's **31 / 195 / 35%**. The payload changed, so the ±2 and ±6 band applies, and the reading sits well inside it. **Reordering the lists did not disturb the prose**, which is the result to want.
- **17,337 input tokens — identical to both 2026-09-06 generations.** Reordering a list changes where its rows sit and not how many tokens they cost. 7,281 output, 4,107 cache-creation, **0 cache-read**: the last generation was two days ago and the 1-hour breakpoint had long expired, so a zero read is arithmetic rather than a finding.

#### A count this log has had wrong since 2026-09-06

- The last three entries say **six** pending proposals. There were **seven**. With this generation there are now **eight pending and one accepted, nine in total** — and the 2026-09-08 entry's "all eight stored proposals were measured" counted the accepted one to reach eight. Corrected here, not there.

#### What was verified

- No code changed this session, so the suite stands where 2026-09-08 left it at **149 tests across 15 files**. Nothing here is a code claim; the evidence is a stored proposal and the record it was generated from.
- The generation completed `ready` with a null error, no warnings, and `privateFactCount` and `generatedFactCount` both **0** — the render-time disclosure block had nothing to withhold on this pass.

#### What was not done

- **Eight pending render proposals, none accepted.** Still the oldest thread here, and still a judgement about the author's own career document.
- **The attribution invariants were not checked.** Unknown fact ids, unfiled facts under an employer heading, and facts placed under the wrong employer are unchanged by this entry and still checked by hand.
- **Quantification at 35% against the hand document's 57%**, still a fact-layer shortage rather than a register problem.
- **`GET /api/certifications` was left alone**, and its divergence from the document is now moot in practice for want of an undated row.

---

### [2026-09-08] Spike #5 closes, and half of it was already being answered by the suite on every run

- **Decision:** the `docx` / `docxtemplater` Workers spike is **done, and both libraries run on workerd unmodified.** No fallback is needed — not building in the browser, not moving the step to a Node-compatible runtime. `docs/03` §11 row 2 and §12 row 5 are marked closed. **履歴書 work is no longer gated on a spike.**
- **Reason:** §12 row 5 listed the spike as due *before* 履歴書 work starts, which made it the first thing to do on the top agent-actionable thread. It was scoped at ~1 hour on the belief that neither library had been verified on a constrained runtime.

#### `docx` was already verified, and the docs had not noticed

- **The suite runs inside workerd** — `vitest.config.ts` uses `@cloudflare/vitest-pool-workers` with `nodejs_compat` and the deployed compatibility date. It is not a Node harness that stands in for one.
- `smoke.test.ts` downloads a real `.docx` through the route, and `renders.test.ts` asserts it is a zip with the Word MIME type. **`docx` has therefore been exercised on workerd on every suite run since M1**, months before the spike it was waiting for.
- **A stale open-problem row is not free.** It kept a milestone behind a prerequisite that the test suite had already discharged, and nothing in the repository would have said so. Worth remembering the next time a row here says "unverified": check what the suite already runs before scoping a spike to find out.
- What genuinely remained was **`docxtemplater`, which was not installed and had never been run at all.** That is the whole of what this session tested.

#### What was actually run

Two runtimes, because passing in one would not have answered the question.

- **In the suite** — a `docx`-built template carrying `{name}` and `{birth}`, fed to PizZip and Docxtemplater, rendered, and read back out of `word/document.xml`. Placeholders gone, values in, output a zip by its local file header. Passed first attempt.
- **Under `wrangler dev`** — the same round trip in a throwaway single-file Worker with its own config, on a real request. **This is the half the suite cannot answer**: the test pool and `wrangler` are different bundlers, and a library that survives Vite's pre-bundling can still fail wrangler's. It did not. Both are gone now; the scratch Worker was deleted.

#### One finding that the 履歴書 render has to act on

- **PizZip's `generate` STOREs by default.** On a two-line template that was **25,930 bytes uncompressed against 8,513 with `compression: "DEFLATE"`** — a `.docx` three times the size it needs to be. It opens perfectly well, so nothing would ever complain.
- The 履歴書 render **must pass `compression: "DEFLATE"`**. Pinned by a test rather than left as a sentence here, because a sentence in this log is exactly the kind of thing that gets read after the bug.

#### The spike test was kept rather than thrown away

- `tests/docxtemplater.test.ts` — two cases, and **it has no consumer**, which is unusual enough to say why. The 履歴書 is form-filled rather than built (`docs/03` §30) and no code fills a form yet, so the test stands in for the render until the render exists.
- It is a **runtime-compatibility guard, not a library test**. `renders.test.ts` declines to unzip a `.docx` to check its contents on the grounds that that tests the `docx` library; this asks a different question — whether the library is *available on this runtime* — which a compatibility-date or `nodejs_compat` change can silently answer differently between now and M3.
- **Delete it once the 履歴書 render exercises the path for real.** Said here so the instruction outlives the comment in the file.
- `docxtemplater@3.69.3` and `pizzip@3.2.0` are now dependencies. **`tests/docxtemplater.test.ts` is the only file in `src`, `tests` or `scripts` that imports either**, so neither reaches the Worker bundle or the client bundle — the client build is `index-BemTM3to.js`, 364.40 kB, recorded here so a later session can tell whether adding the render moved it.

#### What was verified

- **151 tests across 16 files, up from 149 across 15** — the two new cases and their file. `npm run build` green: design tokens clean, type check clean, client build clean.
- The `npm audit` moderate findings are pre-existing and unrelated — `drizzle-kit` → `esbuild` dev-server, unchanged by this session's two dependencies.

#### What was not done

- **No 履歴書 render, no `templates/` directory and no `rirekisho.blank.docx`.** `RENDER_DEFINITIONS.rirekisho` is still `buildable: false` with an empty register. The spike removes the technical gate; the blank grid still has to take its structure from the author's real 履歴書 with every value stripped, which is the next piece of M3 and is not a spike.
- **Eight pending render proposals, none accepted.** Unchanged and still the oldest thread. No generation was spent this session.
- **The attribution invariants are still checked by hand** — unknown fact ids, unfiled facts under an employer heading, facts under the wrong employer. Still the obvious second instrument, and still costs no generation.
- **The two 履歴書 rules stated ahead of the code** — the null-`started_on` record and the null-`issued_on` certification — remain unexercisable until the render exists.

---

### [2026-09-09] The 履歴書 grid is stripped into a template, and seven details of the field contract were wrong

- **Decision:** `templates/rirekisho.blank.docx` exists, built by a committed script from the
  author's own 履歴書 with every value removed. `docs/04` §4 is **corrected in place** on seven
  points — it is a contract, not a log, and a wrong contract is worse than a stale one.
- **Reason:** `docs/03` §12 names the 履歴書 risk as a rigid grid whose errors are invisible to the
  author and obvious to a Japanese reader. The answer that doc gives is *fill a template rather
  than rebuild the grid*, which requires the real grid. The spike of 2026-09-08 removed the
  technical gate; this is the piece that was actually left.

#### What the field contract had wrong

Extracted 2026-08-12, re-read against the same file this session. The structure was broadly right
and the details were not.

- **The identity label is 名前, not 氏名.** Kept as the author wrote it.
- **`以上` is centred, not right-aligned.**
- **Identity rows 2 and 3 have no label cell.** Both span the label column; 電話 and Email are
  prefixes inside the value string and 生年月日 has no label at all. The contract modelled all
  three as label/value pairs.
- **The 学歴・職歴 column header is 学歴・職歴, not 内容**, and it is a real first row the
  contract's numbered steps did not include.
- **免許・資格 rows end in a verb** — 取得 by default, 修了 for courses, confirmed by the author.
  The contract said "年 / 月 / 名称" and specified no suffix. This is exactly the §12 failure:
  a table of bare names opens fine and reads as wrong.
- **退社 rows put the reason first** — `<leaving_reason_ja>` + employer + 退社. The contract said
  the row "carries" the reason without fixing the order.
- **現住所 is three lines, not two** — kana, 〒, then a street address that may carry a building
  name and room number on a second line. Handled with one `{address}` placeholder and
  `linebreaks: true`, so no second column is needed and an author without a building name gets no
  blank line.

#### One rule moves from unexercisable to live

- 2026-09-08 recorded the **null-`started_on` education rule** as unexercised, because the only such
  row is `secondary_lower` and the register drops everything below university level. **That is a
  fact about the English résumé, not about the rule.** 履歴書 is required to be complete, so the row
  reaches this table and the rule fires on the first render. The author's own file already opens
  学歴 with a closing row that has no 入学 above it.
- The null-`issued_on` certification rule is **unchanged** and still unexercisable: every
  certification in the record is dated, and inventing one to turn a check green is not a thing to do.

#### Two gates, because the interesting failures here are silent

The build script is committed for the same reason `npm run measure` is — the stripping becomes
auditable, and a guard beats a promise in a commit message. It reads `local/`, so it runs only on
the author's machine.

- **A PII gate.** Every remaining text node must be form furniture or a placeholder; anything else
  aborts the build. **It earned its place immediately.** The first version of the script mis-sliced
  the table spans, dropped the `<w:tbl>` open tags, and applied every edit to the wrong table — the
  output kept the author's real employers, schools, certifications and self-PR. Reviewing the
  output caught it; the gate is what makes catching it automatic rather than lucky.
- **A schema gate.** `<w:tblPr>` children must follow the CT_TblPrBase sequence. Setting the table
  layout to `fixed` by anchoring the insert on `<w:tblW>` put `tblLayout` before `tblBorders`,
  which is invalid and surfaces only as *"Word found unreadable content"*. The correct position was
  settled empirically — by reading what the `docx` library emits — rather than from memory.

#### The one deliberate departure from the source

- **Column layout is `fixed`; the author's file is autofit.** Under autofit a long certification
  name widens the 年 and 月 columns away from the widths the author's own document shows. Under
  substitution, fixed is the *more* faithful choice, which is why it is not filed as a liberty.
- Everything else is preserved: A4, 12.7 mm margins, five tables at 9360 twips, borders, fonts,
  `MS Mincho` / `MS Gothic`, and the ideographic spacing in `履 歴 書`.

#### What was verified

- The template renders through PizZip and Docxtemplater with invented data: **17 rows expand to 21**,
  no placeholder survives, the address line-break emits one `<w:br/>`, and every XML part parses.
- The committed script reproduces the reviewed file **byte for byte**, and every non-directory zip
  entry is DEFLATE.
- The photo is **not** filled. It is an anchored 35.1 × 34.1 mm image — near-square, not the
  conventional 30 × 40 mm — and docxtemplater needs a separate image module to place one. The cell
  ships empty and the dependency has not been chosen. A known gap, recorded rather than hidden.

#### What was not done

- **No 履歴書 render.** `RENDER_DEFINITIONS.rirekisho` is still `buildable: false`. How the Worker
  loads the template at runtime — a wrangler `Data` module rule is the obvious candidate — is a
  render decision and was not taken here, which is also why no suite test loads the binary yet.
- **`tests/docxtemplater.test.ts` still stands**, and still has no consumer. It is deleted when the
  render exercises the path for real, which this template does not yet do.
- **Eight pending render proposals, none accepted.** Unchanged, and now much the oldest thread.
- **The attribution invariants are still checked by hand.** Still the obvious second instrument,
  still costs no generation.

### [2026-09-09] The template becomes a module the runtime can load, and the guard test finds its consumer

- **Decision:** `templates/rirekisho.blank.docx` is imported as a wrangler **`Data` module**, and
  `src/render/rirekisho-template.ts` is the seam that holds the import, the placeholder shape and
  the one function that fills it. `tests/rirekisho-template.test.ts` drives that seam inside
  workerd against the committed binary.
- **Reason:** this was the one undecided piece left by 2026-09-09's template entry, and it is the
  piece everything downstream sits on. A Worker has no filesystem; a template it cannot load is a
  template it does not have.

#### The candidate was right, and checking it was not wasted

- A `Data` module rule was the obvious candidate and it is the correct one. It was **not** taken on
  that basis: it was checked against the installed wrangler's own config schema and then against a
  `--dry-run` build, which emits the 13,864-byte `.docx` **beside** the entry point rather than
  inlining it into the JavaScript. The binary stays a binary.
- Checking turned up the part memory would have missed. Wrangler warns that a rule without
  `fallthrough` **silently shadows its implicit defaults** — the rule as first written would have
  taken `.bin` as `Data` away from any later use. `fallthrough = true` is not decoration.

#### The rule has to be stated twice, and that is not duplication to remove

`@cloudflare/vitest-pool-workers` takes module rules from its own options. It reads them from
`wrangler.toml` only when pointed at that file, which would also pull in the bindings the suite
deliberately replaces — the test database among them. So `vitest.config.ts` states the rule a second
time. Without it the import fails in **Vite**, before workerd is ever reached: *"the content
contains invalid JS syntax… add `**/*.docx` to `assetsInclude`"*, which is Vite offering the wrong
answer, since an asset URL is not an `ArrayBuffer`. The two statements are one fact about two build
paths, and a test that loads the template is what keeps them honest.

#### What the test asserts, and why each one

- **The binary reaches the runtime.** An `ArrayBuffer` whose first four bytes are a zip local
  header. This is the Data-module guard: if either rule is dropped, this fails first.
- **The template's placeholder set equals the fill function's field set**, compared both ways. A
  placeholder nothing supplies renders as an empty cell; a field no placeholder carries is silently
  discarded. Both are invisible in the output, which is this document's whole failure mode.
- **The three loops expand and no placeholder survives.**
- **The address's second line is one `<w:br/>`** — the reason `linebreaks: true` is not optional.
- **Every entry it writes is DEFLATE**, read from the zip's central directory rather than from the
  library that wrote it.
- **The form furniture is still there** after filling — 名前, ふりがな, 学歴, 職歴, 以上, 免許.

Every value in the fixture is invented and visibly so.

#### The stand-in test goes

`tests/docxtemplater.test.ts` was a runtime-compatibility guard with no consumer, standing in for
the render. Its condition for deletion was a render exercising the path for real; the author called
it met, and it is: `src/` now imports both libraries, and the new test drives them on workerd
against the committed template rather than one the test builds for itself. A weaker duplicate of a
guard is not a second guard. `docs/03` §11 row 2 now names the test that actually exercises
`docxtemplater`.

#### What was not done

- **Still no 履歴書 render.** `RENDER_DEFINITIONS.rirekisho` remains `buildable: false` with an
  empty register. This session built the mechanism under it, not the document.
- **Eight pending render proposals, none accepted.** Unchanged, and older every session.

---

### [2026-09-09] The 履歴書 rows are derived, and five details of the field contract were wrong

- **Decision:** `src/render/rirekisho-rows.ts` composes the three loop bodies —
  `gakureki`, `shokureki`, `shikaku` — from narrow projections of `educations`,
  `employers` and `certifications`. `tests/rirekisho-rows.test.ts` holds it to
  `docs/04` §4, and §4 itself is corrected in five places, in place, because it is a
  contract rather than a log.
- **Reason:** this half of the 履歴書 costs no generation and is decidable entirely from
  the record and the author's own file. Building it first separates what can be
  test-driven from what needs a register and a model call.

#### The contract was re-read against the source document, and it moved

§4 was extracted on 2026-08-12 and re-read on 2026-09-09 when the grid was stripped. It
was read a third time here, against the rows rather than the layout, and five details
were wrong or missing. Each is a claim about wording that no test could have caught,
because nothing was composing wording yet.

1. **The 入社 row carries the 職種, not a business note.** §4 said
   `name_ja` + `industry_ja` + business note. The author's file reads
   `employer　industry　<職種>として入社`, and `business_description` is empty on every
   employer in the record. `roles.shokushu_ja` of the role held **on entry** is the third
   element — on entry, because that is the clause the sentence makes.
2. **`outcome = 'expected'` prints `入学（在学中）` and no closing row.** §4 described only
   the null-`started_on` case. This is its mirror, it is equally live, and the author's
   file already carries such a row: the `ended_on` on an expected record is an
   expectation, not an event.
3. **免許・資格 has two sources, not one.** §4 said one row per certification. A finished
   vocational education prints here too — which is what the `education_level` enum's own
   comment says (2026-09-06) and what the author's file does. The consequence is that the
   verb stops being a judgement: a certification takes 取得, a vocational education takes
   修了.
4. **The column headers, both centred bands and 以上 are template furniture.** §4 listed
   them as numbered items of the table, which reads as though the render composes them.
   The template carries them; a render that emitted them would print each twice.
5. **The separator is U+3000.** Not stated anywhere. The source is inconsistent — two rows
   use an ASCII space, one omits the separator after a full-width bracket — and the render
   normalises, because an ASCII space sits visibly narrow beside the rest in `MS Mincho`.

#### A null 退職理由 supplies nothing

Every employer in the record has `leaving_reason_ja` null, and the author's own file puts
`一身上の都合により` on every 退社 row. The tempting default is that string. It is refused:
it asserts a **voluntary** departure, and asserting that about a contract that simply ended
is a false statement on a document that is signed. The row renders `employer + を退社` and
the author supplies the reason to the record if they want it on the page. Author's call,
2026-09-09.

#### What the test holds

Twenty-six cases, every fixture invented and visibly so. The ones that matter are the ones
whose breach is invisible to the author and obvious to a Japanese reader: a 中退 printed as
卒業; a 免許・資格 row that stops at the name; a 退社 row with the reason trailing; a record
dropped for having no entry month; the 職歴 table grouped by employer instead of
interleaved by date, which two overlapping employments would expose. It also asserts the
render emits none of the furniture the template already holds.

#### What was not done

- **Still no 履歴書 render.** `RENDER_DEFINITIONS.rirekisho` remains `buildable: false`.
  The rows exist; the prose blocks — 志望動機・特技・アピールポイントなど and 本人希望欄 —
  need a register and a generation, and that has not been spent.
- The 写真 cell still ships empty; no image module has been chosen.
- **Eight pending render proposals, none accepted.** Unchanged, and older again.

---

### [2026-09-09] The 履歴書 is assembled around the rows, and the flip to `buildable` is refused

- **Decision:** `src/render/rirekisho.ts` assembles the whole form — the identity block, the
  submission date, 満N歳, the three tables and the two prose cells — and
  `src/server/services/rirekisho.ts` reads what it needs out of the database.
  `GET /api/renders/rirekisho/download` fills the committed template instead of building a
  document. `RENDER_DEFINITIONS.rirekisho.buildable` **stays `false`**.
- **Reason:** everything the 履歴書 takes from the record is now decidable and testable
  without a model. What is left is the register, and the register is what costs money.

#### Why the flip is refused, and what it is waiting for

Flipping `buildable` would make `POST /api/renders/rirekisho/generate` reachable, and two
things behind it are not ready. The register is `""`, so the first author who pressed the
button would spend a generation on an empty prompt. And `GET /api/proposals/:id/diff`
passes `diffRenders` the literal `language: "en"` — the option's type admits nothing else
— so a Japanese proposal would be diffed with English word rules and no BudouX. The flip
is one line and it belongs in the same commit as the register, not before it.

#### Four decisions §4 does not cover

1. **The submission date is stamped in Tokyo.** The Worker's clock is UTC, which is
   yesterday in Japan for nine hours of every day. The date a 履歴書 carries is the date it
   is handed over, and the zone is fixed rather than taken from the runtime.
2. **A gap is three uncovered months.** §4 requires a warning for an unexplained gap and
   does not say how wide one is. One is wrong: 3月卒業 followed by 4月入社 is the ordinary
   transition. Two is wrong: leaving in June and starting in September is an ordinary job
   change. Three is where a reader starts to read the space as something to ask about. A
   judgement, and the one number in this work most likely to want the author's opinion.
3. **The name cells join with U+3000.** §4 states the rule for the rows of the three
   tables. The 名前 and ふりがな cells are not rows, so this is an extension rather than a
   transcription — made for the same reason, that an ASCII space sits visibly narrow in
   `MS Mincho`, and 名前 is the most-read cell on the page.
4. **A 履歴書 is produced as `.docx` only.** `?format=md` on the other renders is a
   readable text form of a document that was built as text. A form has no such thing: its
   meaning is the grid. The route answers `409` rather than emitting a markdown table that
   is not a 履歴書.

`address_kana` is **not** on the blocking list, because §4 does not put it there. An empty
ふりがな over 現住所 is a blank line; an empty 現住所 is a defective document. The eight
fields §4 names are the list, and `REQUIRED_PROFILE_FIELDS` is now their single source —
the spec imports it rather than restating it, which is how the old three-field list drifted
out of agreement with the contract unnoticed.

#### The PII rule gets its second enforcement point

`src/render/identity.ts` declines to model 履歴書 and says why: the other four renders must
never be able to reach `date_of_birth`, `phone`, `postal_code`, `address` or `contact_*`.
`collectRirekishoProfile` is the only query in the codebase that names those columns, and
its select list is the enforcement — `photo` and everything else the form has no cell for
are never read. The 履歴書's own type is separate from `RenderIdentity` for the same
reason: a shared identity type carrying these fields is how one of them eventually reaches
an English résumé.

#### What the test holds

Twenty-four cases. The ones that matter: 満N歳 computed against the submission date rather
than stored, including the 29 February birth and the day the age turns over; the Tokyo
stamp, asserted against a UTC instant that falls on the previous day; 同上 with an empty 〒
beside it; the gap threshold from both sides, and two overlapping employments treated as
one covered stretch rather than a gap; and the whole chain filling the committed template,
with an assertion that **no placeholder survives into the output**.

#### What was not done

- **No register, no generation, no flip.** Unchanged from the last entry and now the only
  thing between the record and a 履歴書.
- The 写真 cell still ships empty; no image module has been chosen.
- The 連絡先 row's ふりがな has no placeholder — recorded in §4 rather than fixed, because
  fixing it means regenerating the template on the author's machine.
- **Eight pending render proposals, none accepted.** Older again.

### [2026-09-10] The attribution invariants enter the repository, and the accepted baseline turns out to carry two misfiled facts

The second committed instrument, built the same way as the first and for the same reason.
`npm run measure` answers whether a render's bullets are the right SHAPE. This answers
whether they are attached to the right FACTS — three invariants that had been checked by
hand at the end of every generation, against a record that grows with every import. A hand
check that must be repeated is a hand check that will eventually be skipped, and the
skipped run is the one that matters.

The split is deliberately the same: `src/render/attribution.ts` is the definition, with no
imports so that Node can load it directly and a test asserting a real `RenderContent`
satisfies its structural input; `scripts/check-attribution.mjs` is the thing you run.
Exit status is 1 when anything is found, so it can be a check and not only a report.

    npm run check:attribution -- --latest
    npm run check:attribution -- --proposal prp_H8t4

#### What it checks, and the fourth thing it reports

1. **unknown-fact** — a block cites a fact id the record does not contain.
2. **unfiled-fact** — a fact filed to no employer is used under an employer heading.
3. **misfiled-fact** — a fact is used under a heading naming a DIFFERENT employer.

`unresolved-heading` is not an invariant about the render. It reports a group whose
employer the checker could not identify, and it exists because the alternative is checking
nothing there and saying nothing about it. Silence is the one failure mode a checker must
not have, and this finding is what turned a clean-looking baseline into a reported one.

#### The heading is the anchor, because nothing else is

`RenderContent` carries no employer ids. The experience section is a flat run of blocks in
which a `paragraph` opens a group and the bullets after it belong to it, and the only thing
naming the employer is the paragraph's own prose. So the heading is matched against the
record's employer names — which is the invariant exactly as it was checked by hand, a fact
sitting under a heading that names someone else.

Matching runs in **two passes, and the order carries the argument**. The exact name is
tried first, so a heading writing the legal name in full is never loosened and two
employers differing only in corporate form stay distinct. Only when that finds nothing does
a normalised pass run — corporate form and separating punctuation removed — which is what
lifts a heading writing 架空商事 where the record stores 架空商事株式会社. Normalisation can
therefore only ADD an answer where there was none; it can never overturn one. A tie does
not fall through to it: two employers named equally well in one heading is a genuine
ambiguity, and normalising can only blur the thing that would have told them apart.

Whitespace is **collapsed, never removed**. Both rules were run over every proposal in the
dev database and resolved exactly the same groups, and removing whitespace would let a
short name match across a word boundary — finding `abc` inside `lab candidate`. Equal
recall at strictly less risk is not a trade-off.

#### What the first run found

Every one of the eight pending proposals is clean: four employer groups resolved, no
unknown, unfiled or misfiled fact among 128–138 fact references each.

The **currently accepted 09-03 baseline is not**. It reports two misfiled facts and one
unresolved heading. The two sit in adjacent bullets and both cite facts filed to the same
other employer, which reads as a group-boundary error rather than two independent slips —
a run of bullets that ended up under the neighbouring heading. It is worth stating plainly
that this is the render currently standing as the baseline, and that it had passed the hand
check.

The unresolved heading is a true negative rather than a matcher failure: that heading names
its employer in no form the record holds, under either pass.

#### What is deliberately not checked

- **Whether a cited fact is ACCEPTED.** A render should draw only on accepted facts, but
  "cited a candidate fact" and "cited an id that does not exist" are different faults, and
  folding them together would make the first look like data corruption. The record the
  instrument builds carries every fact whatever its status, so `unknown-fact` means
  genuinely unknown.
- **Provenance and disclosure.** Generated-provenance and Private-disclosure facts never
  reaching a render is enforced at render time, which is the right place for it. A checker
  running afterwards would be a second, weaker copy of a rule that already holds.
- **Anything about the bullets themselves.** That is `npm run measure`.

#### The output contract

Ids and counts, never text — no bullet, no heading, no fact claim, not in an error message
either. Renders are built from the author's real career record, and the rule that logs
never contain render content does not stop applying because the output is a diagnostic.
The same contract the measurement script carries, for the same reason.

A fact's EFFECTIVE employer is its own, or its project's when it is filed to a project
rather than straight to an employer. That hop is resolved in SQL so the definition module
stays a pure function of what it is given. The record query filters by `user_id` like every
other query in the codebase; an operations script is not an exception, and a proposal is
always checked against its own user's record — `--user` cannot override that, because a
check against the wrong record would come back clean.

#### What was not done

- **The two misfiled facts in the baseline are reported, not fixed.** Which employer those
  bullets belong under is a question about the record, and the answer is the author's.
- **No register, no generation, no flip.** Unchanged, and still the only thing between the
  record and a 履歴書.
- **Eight pending render proposals, none accepted.** Older again — though they are now the
  only renders known to satisfy the invariants.

### [2026-09-10] The composition-era résumé is accepted, and the three finalists turned out to differ less than the figures implied

`english_resume` is at version 2, from `prp_i4pd` (09-07). The 09-03 render had stood as the
baseline since it was accepted; seven proposals remain pending and are now superseded rather
than undecided.

**The reading settled it, not the measurement.** The three finalists were put side by side
and read in full, and about four fifths of their bullets are identical or differ by a single
word. Whole runs are verbatim across all three, and the shortest employer section is the same
two bullets three times. The figures the log records — count, mean, share carrying a number —
had implied three distinct documents. They were three renderings of one.

What actually separated them:

1. **The systematic twenty characters were a formatting defect, not content.** The two longer
   proposals print a single-role employer's date range twice, once beside the role and again
   after it. The accepted proposal does not. It is the weaker of the two formats for a
   two-role employer, though, where it gives no overall span and the others do. The format
   wanted is the accepted one plus an overall span where there is more than one role — a
   generator behaviour to fix in the register work, and independent of which proposal won.
2. **One proposal welds two unrelated items into its closing bullet**, which the register
   forbids in as many words. The accepted one keeps them as separate bullets, one of them
   very short.
3. **The accepted proposal names no client sector; the other two do.** That is a disclosure
   decision rather than a stylistic one — `facts.is_client_identifying` exists because this
   distinction is load-bearing — and the accepted proposal is the one that does not make it
   on the author's behalf.
4. It also preserves a progression the other two flatten into a plain statement of the later
   role.

#### Carried forward rather than done

- **One bullet exists only in the proposal that was not accepted** and has no equivalent in
  the accepted version. It was judged the strongest single line in any of the three. Moving
  it across is a hand edit against the accepted version, not a regeneration.
- Two passages in the accepted version were put to the author and deliberately left alone:
  a pair presenting a failure alongside the control built to prevent its recurrence, and a
  line stating an age at a promotion. Both are choices to confirm, not defects to fix.

#### The attribution finding closes itself

The superseded baseline was the one render reporting misfiled facts. The accepted version is
clean under `npm run check:attribution`, as were all eight pending proposals. So the two
misfiled facts were a property of that render's grouping rather than of the record, and
accepting a clean render retires the question rather than leaving it open.

---

### [2026-09-11] The two hand edits land as version 3, and a hand edit has no route

`english_resume` is at version 3. Version 2 is unchanged and still readable; the two edits the
previous entry carried forward are applied, and both were decided by reading rather than by
measuring.

**The transplanted bullet is half of what was carried forward.** The line judged strongest in
any of the three finalists exists only in a proposal that was not accepted, and its fact carries
two clauses. The accepted version already renders the second of them, on a neighbouring bullet
whose own fact overlaps it. Pasting the line in as it stood would have said the same thing twice
within two bullets, so only the clause the accepted version never says was inserted, as a bullet
of its own directly after the one that carries the other clause. Citing the one fact behind it is
correct: the block renders part of that claim, and no other fact is involved.

**Age at promotion comes off the English résumé.** The line stating it was left alone for the
author to confirm and has been cut down to the progression and its span. Age on an English
résumé is off-convention where that document is read, invites a bias the render has no reason to
invite, and the span the bullet already states carries the trajectory without it. The 履歴書 carries date of
birth by construction and is the document where that belongs — the two renders having different
conventions is the reason they are different renders. The fact stops being cited by that block,
because the block no longer renders its claim.

**The pair presenting a failure alongside its control stays exactly as it is.** The admission is
only legible as a strength because the control follows it immediately and quantifies what it
bought. Shortening the failure to make the control carry more weight would leave the control
measuring something the reader can no longer see.

#### What the edits cost, measured

31 / 192 / 35% before, 32 / 187 / 31% after. Both edits removed digits: the age was one, and the
transplanted bullet spells its interval out the way the rest of the register spells small numbers
out. The share carrying a number is a digit test and always has been, so it reads the loss
correctly and there is nothing to fix in the test. Writing the new bullet with a numeral to hold
the percentage up would be gaming an instrument, and the cause of the shortfall against the hand
document's 57% is unchanged and recorded: the facts behind these bullets carry no numbers.

#### A hand edit has no route, and that is now visible

Version 3 was written with SQL, the way the restore drill reaches the database, because there is
no endpoint that edits a version. `POST /api/proposals/:id/accept` is the only writer of
`render_versions`, and it needs a proposal. This is the first time the record needed a change
that no generation produced, and the shape of the answer is already in the schema — restoring
creates a new version rather than erasing one, and so did this. A manual-edit route is a real
gap rather than a chore, but it is not M1's: the two edits owed are applied, and the next one
would be the third occasion, not the first.

Both instruments were run against the edited content before it was written and both pass:
attribution clean at 135 fact references across 58 blocks, four employer groups resolved.

---

### [2026-09-11] The 履歴書 register is written, Japanese diffing lands, and `buildable` flips

- **Decision:** `RENDER_DEFINITIONS.rirekisho.register` is written, `diffRenders` takes
  `language: "en" | "ja"` and segments Japanese with BudouX, and
  `RENDER_DEFINITIONS.rirekisho.buildable` is **`true`**. One commit, as the 2026-09-09 entry
  said it had to be.
- **Reason:** both things that entry refused the flip for are gone. The register is not empty,
  so the first press of the button is not a generation spent on nothing; and
  `GET /api/proposals/:id/diff` now passes `RENDER_LANGUAGE[kind]` instead of the literal
  `"en"`, so a Japanese proposal is reviewed with phrase tokens rather than English word rules.

#### The register refuses to write a 志望動機, and says so

The cell is headed 志望動機・特技・アピールポイントなど, and the record answers two of those
three headings. It holds no job posting, no company and no role being applied for — nothing a
motivation could be *for*. A model told to write one anyway would invent the target, which is
the single thing that cell must not contain, and it would do it in the register's own confident
voice.

So the register writes 特技 and アピールポイント from the facts and stops. The omission travels
back to the author as a warning on the generation response, beside the unexplained-gap warnings
and through the same channel: `MOTIVATION_NOTICE`, unconditional, listed after any gap so that a
finding about *this* record is read first. A silent half-answer would read as a model that
forgot its instruction.

**The cell is bounded at about 300 characters over two or three paragraphs.** A judgement, like
`GAP_MONTHS`: the prose rows carry no fixed height, so the cell grows to fit and the form is two
pages with no explicit page break. A long cell does not overflow — it pushes the layout apart.

#### BudouX enters through `Parser`, not through the convenience loader

`loadDefaultJapaneseParser()` returns an `HTMLProcessingParser`, whose module statically imports
a DOM implementation for a capability nothing here uses. `new Parser(jaModel)` is the same
segmenter — verified to produce identical output on the same input — without that edge of the
import graph. Confirmed rather than assumed: a `wrangler deploy --dry-run` bundle contains no
`linkedom`, no `DOMParser` and no `HTMLProcessingParser`.

**A correction to the 2026-08-12 entry, which called BudouX dependency-free.** That is true of
the segmenter and no longer true of the published package: `budoux@0.9.1` declares three runtime
dependencies, all of them for the CLI and the HTML processor. The original claim is why the
entry point matters rather than why it does not.

The wrapper lives at `src/segment/`, where `docs/03` §3 already put it. Its whole contract is
that the pieces concatenate back to the input, the same contract `tokenize` holds for English —
a segmenter that dropped or normalised a character would quietly rewrite the document on the
review screen. Asserted in both directions on both texts.

#### Two smaller things the flip exposed

**The prompt's language instruction was garbled** — it read "Use the call it "English" register
throughout", which survived because English was the only answer any buildable render could
produce. It now reads "Write the document in Japanese." for a Japanese render, and a test asserts
both. The same file's education line has its own entry (2026-09-06) for the same reason: this is
hand-formatted prompt text, and nothing but an assertion on the text can see it.

**`profiles.desired_role_note` reaches `RenderSpec` and the prompt**, which is what 本人希望欄 is
seeded from. It is printed only when the author has written one — four of the five renders have
no cell to put a preference in — and the register writes it with no `factIds`, because a
preference the author typed is not a fact drawn from the record. Where none is written, the cell
is 貴社規定に従います。, which is the conventional answer rather than an empty cell.

#### What the flip exposed on the review screen

Making a second render generable turned three things from unreachable into wrong, all of them
invisible while the English résumé was the only document that could produce a proposal.

- **The review screen was titled `Résumé (English)` in literal text**, and would have put that
  heading over a 履歴書. It now reads `RENDER_TITLE[proposal.renderKind]`, as does the footer
  line that says what accepting replaces.
- **`warnings` on the proposal response was `[] as string[]`** — a declared field that was always
  empty. The gap warnings existed and reached the 202 from
  `POST /api/renders/:kind/generate`, which is a response the author may never see; the screen
  where the decision is actually taken had nothing. Both responses now call
  `rirekishoWarnings`, one definition so the two cannot drift, and the review screen renders them
  above the line about restorable versions.

That second one is the more interesting failure: the warning was built, tested and correct, and
still could not reach a human. A finding that arrives only on a response nobody reads is not an
advisory, it is a comment.

#### What was not done

- **No generation has been spent.** The path is open and unpressed; the register's first real
  output is unread, and what it produces is the next thing to look at.
- The 写真 cell still ships empty, and the 連絡先 ふりがな row still prints a bare label. Both
  are recorded in `docs/04` §4 and both need the template regenerated on the author's machine.
