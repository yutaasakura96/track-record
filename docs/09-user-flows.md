# 09 — User Flows

**Status:** Phase 4 · written 2026-08-12
**Trigger:** more than three screens, and the core action is multi-step.

Six flows. Each lists the steps, **what can go wrong at every step and what the author sees**, and
**what state is left behind if the author walks away**. Screens are specified in
`10-screen-specifications.md`; endpoints in `07-api-design.md`.

---

## Flow 1 · First run — there is no profile · M1

1. Author signs in with Google.
2. App calls `GET /api/profile` → `404`.
3. **Redirect to the profile form.** Nothing else in the app is reachable.
4. Author fills identity fields and saves → `PUT /api/profile`.
5. Land on the Record Overview, in its **empty state**.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 1 | Google identity not on the allowlist | `403` and a plain message: this deployment accepts one account. **No `users` row is created** |
| 1 | Google unreachable | Sign-in fails with a retry. Existing sessions are unaffected |
| 4 | Required field missing | `422`, offending fields named inline. Nothing saved |

**If abandoned:** no profile row exists, so the next sign-in returns to step 3. Nothing partial is
stored. **Every render needs a name**, which is why this gate exists (PRD §7).

---

## Flow 2 · Import a document and review its facts · M1 — the core loop

1. Overview → **Import a document** (or drop a file on the empty-state target).
2. Choose file, optionally attach it to a project → `POST /api/imports` → `202`.
3. **Fact Review screen opens immediately.** The document renders as soon as text extraction
   finishes; the rail shows skeleton cards.
4. Client polls `GET /api/imports/:id` every 1.5 s. Cards appear **incrementally** as each chunk
   completes; the progress bar advances.
5. Author works card by card: read the claim, check the marked passage, edit the claim if needed,
   set **Provenance** and **Disclosure**, then **Accept** or **Reject**.
6. When all cards are resolved, **Finish review** becomes primary.
7. **Add N facts to record** / **Finish review** → `POST /api/imports/:id/finish` → back to Overview.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | Unsupported file type or oversized file | `422` before any work begins. Named reason |
| 3 | Text extraction fails | Import marked `failed` with the reason. **The uploaded file is retained.** Retry or capture manually |
| 4 | **Zero facts extracted** | Reported as a **failure of extraction**, never as an empty success. Document retained; actions are retry or manual capture (PRD §7) |
| 4 | Anthropic unavailable mid-import | Import pauses at the failed chunk. **Chunks already completed keep their candidates.** Retry resumes from the failure, not from the start |
| 4 | A candidate's quote is not verbatim in the source | Silently discarded before the author sees it. Counted in `candidatesDiscarded`, never shown as content |
| 5 | Author sets **Measured** on a fact with no evidence | `422`: *"A Measured fact needs a passage in the source that proves it."* |
| 5 | Author accepts a **Generated** fact | **Succeeds.** It is accepted, flagged, and excluded at render time — the block is at render time, not review time |
| 5 | Author accepts a **Private** fact | Succeeds normally. The button reads `Accept · private` |

**If abandoned mid-review:** every decision already made is **already saved** — accept, reject and
edit are individual calls, not a form submitted at the end. The import stays in the list with its
progress. Returning reopens exactly where it was. Nothing is lost by closing the tab.

---

## Flow 3 · Generate the English résumé and review the diff · M1

1. Overview → the Résumé row shows `3 new facts since it was generated` → **Review proposal**.
2. `POST /api/renders/english_resume/generate` → `202`.
3. Diff Review screen opens. **The current version is fully readable throughout**; the proposed
   column shows a skeleton while generating.
4. Proposal ready → `GET /api/proposals/:id/diff` renders the split view.
5. Author steps through changes with prev/next. **Each change shows its rationale** — which facts
   produced it, or why a line was removed.
6. **Accept proposed version** → new version, dated. Or **Keep current version** → the proposal is
   retained as dismissed and the stored version is left byte-identical.
7. Result bar confirms, with **Undo**.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | No facts accepted yet | The action is **disabled with a stated reason**, not hidden, and never silently produces an empty document (PRD §7) |
| 3 | Generation fails or returns nothing usable | Error with the reason and a retry. **The current version is untouched and still readable.** Never a blank proposed column with no explanation |
| 4 | **Nothing changed** | The diff does not open. The overview reports `Already up to date with your record` |
| 4 | Nearly every line changed | Renders normally. Rejecting the whole thing remains **one action** |
| 5 | A change has no rationale | **A defect**, not a tolerated gap |
| 6 | The proposal was already decided in another tab | `409 conflict`. The screen refreshes to the decided state |
| 6 | Private facts were excluded | Footer states `N private facts in your record were not used` — that something was withheld, **never what** |

**If abandoned before deciding:** the proposal stays `pending`. The overview shows the render as
`proposal_pending`. The current version is unchanged. Re-entering resumes at the diff.

---

## Flow 4 · Re-import an updated document · M1 — the normal case, not an edge case

1. Overview or import list → **Import a document**, selecting the **same** source document.
2. `POST /api/imports` with `sourceDocumentId` → a new **version** of that document.
3. The pipeline diffs the new text against the previous version and **sends only changed and added
   passages to the model**.
4. Fact Review opens showing **only genuinely new candidates**.
5. Review and finish as in Flow 2.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 3 | The document is unchanged | Zero new candidates, reported plainly — not as an extraction failure |
| 3 | The document was restructured wholesale | Many candidates. The quote-and-claim hash guard still suppresses exact repeats of already-judged facts |
| 4 | A fact the author **rejected** last time reappears in changed text | Suppressed by the dedupe hash. Rejected stays rejected |
| 4 | Two versions state **different numbers** for the same thing | **Not detected in v1.** Known open problem, deferred to M2 (`03-technical-design.md` §11). Both facts exist and the author resolves it by hand |

**If abandoned:** identical to Flow 2. The new document version is stored either way, so the
diff-against-previous baseline is correct on the next import.

---

## Flow 5 · Restore a previous version · M2

1. Diff Review or Overview → **Version history**.
2. Accepted versions and dismissed proposals are listed, **visibly distinct**.
3. Choose a version → preview.
4. **Restore** → creates a **new** version whose content matches the old one.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 4 | — | Restoring **never erases history**. The restored content becomes `v6`; `v4` and `v5` both remain (S14) |

**If abandoned:** nothing changes. Viewing history has no side effects.

---

## Flow 6 · Quick capture — work that left no document · M3

1. Overview → **Quick capture** (hidden entirely while the record is empty — there is nothing to
   capture against yet).
2. Author types two sentences.
3. Short interrogation: when, which employer, what changed, what proves it.
4. Facts are created with provenance **Attested** by default.
5. Review and accept in the same card interface as Flow 2.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 3 | Author abandons mid-interrogation | Draft retained. **No facts are created** until accepted |
| 4 | A numeric claim with no source | Stays **Attested**, not Measured. There is no passage to point at |

**Target: under a minute for a simple entry** (S12).

---

## Flow 7 · Bootstrap the record from documents you already have · M2

**The author does not start from an empty record.** A 履歴書 already lists every employer with its
industry and dates, every school with 入学 and 卒業, and every certification with its issue date.
Typing that into forms is an hour of data entry; extracting it from the file that already exists is
one import. This flow is the difference between M3 taking an afternoon and taking a month.

1. Empty-state overview offers two paths: **Import a case study** and **I already have a 履歴書 or
   résumé**.
2. Author uploads an existing 履歴書, 職務経歴書 or résumé.
3. The pipeline runs with an **entity extraction target** instead of the fact target — extracting
   `employers`, `roles`, `educations`, `certifications` and `profiles` fields.
4. Review screen, **same card interaction as Flow 2**, but each card carries an *entity* rather
   than a fact. Fields are editable inline before accepting.
5. Accept → rows are created. Reject → nothing is created and the entity is not re-offered.
6. Author proceeds to Flow 2 for each case study, now that employers and projects exist to attach
   facts to.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 3 | The document contains the author's PII | Address, phone and date of birth populate **`profiles`** and are **never turned into facts**. PII is a per-render field rule, not a claim about a career |
| 3 | An education entry is ambiguous between 卒業 and 中退 | **Never guessed.** The card asks, with `outcome` unset until the author chooses. Rendering a withdrawal as a graduation is a misrepresentation, not a formatting slip |
| 3 | A certification has no meaningful issue date | Accepted with `issuedOn` null; it is omitted from 免許・資格, which is dated by construction |
| 3 | An employer already exists in the record | Proposed as a **match to update**, not as a duplicate to create |
| 4 | Extraction misreads a date | Editable inline before accepting, like any card |

**Entities carry no provenance or disclosure.** Those attributes belong to facts — claims about what
the author did. An employer is not a claim.

**The bootstrap document is a source document like any other.** It is retained, it proves nothing by
itself, and — per PRD §6.1 — **it never renders, exports, or appears in any output.** Importing your
own 履歴書 does not make it a thing the app can emit.

**If abandoned:** accepted entities are already saved. The import stays in the list. Returning
resumes where it left off.

---

## Flow 8 · Import several documents in one sitting · M2

1. Author selects multiple files, or drops several onto the target.
2. Each becomes its own import, queued. **Extraction runs one at a time**, not in parallel — the
   author can only review one document at a time, and parallel extraction would just spend money
   faster.
3. The import list shows each document's status. The author reviews them in any order.
4. Each document's review is Flow 2, unchanged.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | One document fails | The others are unaffected. Failure is per-import |
| 3 | The author reviews only some | Perfectly normal. Unreviewed imports stay in the list indefinitely |

**If abandoned:** every import survives independently. There is no batch that can be half-committed.

---

## Not a flow · Adopting an existing document as version 1

**Rejected.** The author has a hand-tuned résumé, and adopting it as `v1` so the first diff compares
against the real thing is a tempting idea. It does not work: that version would not be derived from
facts, so **every line in it would have no fact behind it**, and the rationale bar — which is
required on every change — would read *"Removed — no fact in your record supports it"* across the
entire document. The first diff the author ever saw would be noise.

M1's success criterion is a **by-eye** comparison of the generated résumé against the existing one.
That is a better test, and it needs no feature.

---

## Cross-cutting rules

**Nothing generated is ever applied without review.** Every regeneration is a proposal.

**No flow loses work on abandonment.** Fact decisions save individually; imports and proposals are
durable resources. Closing the tab is always safe — which matters, because this is a tool used in
short bursts between other work.

**Every disabled action states why.** `Nothing accepted yet`, `Needs promotion`. A disabled control
with no reason is not permitted (`05-design-system.md` §6).

**Failure never destroys a stored version.** In every flow above, the worst outcome of a failed
model call is that nothing new is created.
