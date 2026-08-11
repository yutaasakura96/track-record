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
