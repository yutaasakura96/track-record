# 09 — User Flows

**Status:** Phase 4 · written 2026-08-12
**Trigger:** more than three screens, and the core action is multi-step.

Flows 1 to 8 are as first written, with Flow 2 changed on 2026-10-08; Flows 9 to 11 were added then
(issue #57). Each lists the steps, **what can go wrong at every step and what the author sees**, and
**what state is left behind if the author walks away**. Screens are specified in
`10-screen-specifications.md`; endpoints in `07-api-design.md`.

---

## Flow 1 · First run — there is no profile · M1

1. Author signs in with Google.
2. App calls `GET /api/profile` → `404`.
3. **Redirect to the profile form.** Nothing else in the app is reachable.
4. Author fills identity fields and saves → `PUT /api/profile`.
5. Land on Home, in its **empty state**.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 1 | Google identity not on the allowlist | `403` and a plain message: this deployment accepts one account. **No `users` row is created** |
| 1 | Google unreachable | Sign-in fails with a retry. Existing sessions are unaffected |
| 1 | Sign-in cannot start — the worker is down, or the page is open at an origin other than `BETTER_AUTH_URL` (`403`) | A message that names neither Google nor the network, since Google has not been contacted yet. A `403` says the address was refused; anything else says sign-in could not start, with a retry |
| 4 | Required field missing | `422`, offending fields named inline. Nothing saved |

**If abandoned:** no profile row exists, so the next sign-in returns to step 3. Nothing partial is
stored. **Every render needs a name**, which is why this gate exists (PRD §7).

---

## Flow 2 · Import a document; its facts are accepted and flagged · M1 — the core loop

**Changed 2026-10-08 (#57).** Steps 5 to 7 were "work card by card, Accept or Reject, then Finish
review". The importer now accepts every fact it finds and flags the ones worth a look, so nothing
in this flow waits on the author. The one-at-a-time review survives for facts imported before the
change, which still wait as candidates (Flow 9).

1. Home → **Import a document** (or drop a file on the empty-state target).
2. Choose file. **When the record holds at least one project**, a confirmation row offers to file
   the document under one, defaulting to none; when it holds none, the import starts on the file
   choice alone (`10-screen-specifications.md` Screen 3). → `POST /api/imports` → `202`.
3. **Fact Review screen opens immediately.** The document renders as soon as text extraction
   finishes; the rail shows the extraction progress block above the cards
   (`10-screen-specifications.md` Shared chrome).
4. Client polls `GET /api/imports/:id` every 1.5 s. Cards appear **incrementally** as each chunk
   completes; the progress block advances.
5. **Each fact arrives accepted.** The importer has set its Worth (Measured, Attested or Generated)
   and its Who (Restricted, or Private when it reads as confidential), and has flagged it where
   there is something to check. Each flag says why on the card.
6. The author reads as much or as little as they want. A card's **Change** opens the claim, Worth,
   Who and **Reject** for that one fact; the `Flagged N` pill narrows the rail to the flagged ones.
7. **Done** → `POST /api/imports/:id/finish` → back to Home. Leaving without pressing it loses
   nothing: the facts are already in the record.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | Unsupported file type or oversized file | `422` before any work begins. Named reason |
| 2 | **Filed under the wrong project, or under none** | Corrected afterwards on Screen 8: the document's project label opens a refile row, and its facts move with it (`10-screen-specifications.md` Screen 8). **Not** corrected by importing the file again, which makes a second document |
| 3 | Text extraction fails | Import marked `failed` with the reason. **The uploaded file is retained.** Retry or capture manually |
| 4 | **Zero facts extracted** | Reported as a **failure of extraction**, never as an empty success. Document retained; actions are retry or manual capture (PRD §7) |
| 4 | Anthropic unavailable mid-import | Import pauses at the failed chunk. **Chunks already completed keep their candidates.** Retry resumes from the failure, not from the start |
| 4 | A candidate's quote is not verbatim in the source | Silently discarded before the author sees it. Counted in `candidatesDiscarded`, never shown as content |
| 5 | The importer cannot tell what a fact is worth | **Kept, never dropped.** Accepted as Generated and flagged `Not sure`, with the reason. It stays out of documents until the author gives it a Worth |
| 5 | A fact names a client, a person or an internal system | Kept as **Private** and flagged `Kept private`. Making it usable is done on that fact, by hand, one at a time |
| 5 | A fact states a number | Kept at the Worth it was given and flagged `States a number`. **It can be used by the next document without being opened**; a document is still a proposal the author reads before it becomes current (Flow 3) |
| 5 | A fact likely restates one already in the record | Kept and flagged `Likely a repeat`, with the other fact shown beside it. Neither is removed |
| 6 | Author sets **Measured** on a fact with no evidence | `422`: *"A Measured fact needs a passage in the source that proves it."* |
| 6 | Author rejects a fact | It leaves the record's documents and the Flagged list, and is kept. `Undo` on its card puts it back as the importer left it |

**If abandoned at any point:** nothing is pending. Every fact found so far is in the record, and a
change the author made is already saved, because each is its own call. An import still being read
keeps reading. Returning shows the same cards.

---

## Flow 3 · Generate the English résumé and review the diff · M1

1. Home → the Next step reads `Update your Résumé (English)`, and the Résumé row shows `3 new facts`
   → **Update**, on either.
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
| 2 | No accepted fact a document may use | No Generate or Update is offered, and one line above the documents **states the reason**. Never a silently empty document (PRD §7, `10-screen-specifications.md` Screen 3) |
| 3 | Generation fails or returns nothing usable | Error with the reason and a retry. **The current version is untouched and still readable.** Never a blank proposed column with no explanation |
| 4 | **Nothing changed** | The diff does not open. The overview reports `Already up to date with your record` |
| 4 | Nearly every line changed | Renders normally. Rejecting the whole thing remains **one action** |
| 5 | A change has no rationale | **A defect**, not a tolerated gap |
| 6 | The proposal was already decided in another tab | `409 conflict`. The screen refreshes to the decided state |
| 6 | Private facts were excluded | Footer states `N private facts in your record were not used` — that something was withheld, **never what** |

**If abandoned before deciding:** the proposal stays `pending`. The overview shows the render as
`proposal_pending` (`proposal_generating` while it is still being written). The current version is unchanged. Re-entering resumes at the diff.

---

## Flow 4 · Re-import an updated document · M1 — the normal case, not an edge case

1. Documents (Screen 8) → **Re-import** on the document's own row, then confirm
   `This becomes vN of <filename>`. Home's **Import a document** always starts a new document.
2. `POST /api/imports` with `sourceDocumentId` → a new **version** of that document.
3. The pipeline diffs the new text against the previous version and **sends only changed and added
   passages to the model**.
4. Fact Review opens showing **only genuinely new candidates**.
5. Review and finish as in Flow 2.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 3 | The document is unchanged | Zero new candidates, reported plainly — not as an extraction failure |
| 3 | The new version only removes text | Nothing is sent to the model and there are zero new candidates, a success as above. Screen 8 reports the share removed as `N% changed`, never `No changes`: the document did change. The removed passages' facts stay in the record |
| 3 | The changed text only restates facts already in the record | Zero new candidates, reported plainly as a success, with the number of repeats. **Not** an extraction failure: the model found facts, and every one was already there. Counted in `candidatesSuppressed`, never shown as content |
| 3 | The document was restructured wholesale | Many candidates. The quote-and-claim hash guard still suppresses exact repeats of already-judged facts |
| 4 | A fact the author **rejected** last time reappears in changed text | Suppressed by the dedupe hash. Rejected stays rejected |
| 4 | Two versions state **different numbers** for the same thing | **Not detected in v1.** Known open problem, deferred to M2 (`03-technical-design.md` §11). Both facts exist and the author resolves it by hand |

**If abandoned:** identical to Flow 2. The new document version is stored either way, so the
diff-against-previous baseline is correct on the next import.

---

## Flow 5 · Restore a previous version · M2

1. Diff Review → **Version history**, or Home → **History** on the document's row.
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

## Flow 7 · Bootstrap the record from documents you already have · in reserve, not built

> **Not built, and not planned.** The 2026-09-06 decision-log entry made entities hand-entered
> through the S7 forms and kept this import unbuilt, in reserve, for the case where hand-entry
> hurts. The flow below is kept as the specification to reach for then.

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

## Flow 8 · Import several documents in one sitting · not built

> **Deferred, 2026-09-28.** The back-catalogue portfolios are imported one at a time through the
> Documents screen. Whether this queue, or the Message Batches path behind it, is built for the rest
> is decided once the first portfolio's token usage has been measured (decision log, 2026-09-28).

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

## Flow 9 · Check what was flagged · M3 (#57)

1. Sidebar → **Flagged**, with the number still to check beside it. → `GET /api/flags`.
2. The list is one row a flag: its kind, the fact's claim, **the reason in a sentence**, and the
   document and line it was read from. Grouped by kind: Kept private first, then Not sure, Likely a
   repeat, States a number. No model is called to show it.
3. Author reads down the list. Most rows need nothing more.
4. **Explain this** on a row → `POST /api/flags/:id/explain`. A few plain sentences appear under
   the reason: what the flag means for this fact and what to look at.
5. **Open it in `<filename>`, line N** on a row → Fact Review for that fact's document, with the fact selected and its passage
   marked (`/imports/:importId?fact=:id`). The author changes the claim, Worth or Who, or rejects it.
6. **Mark as checked** → `POST /api/flags/:id/check`. The row leaves the list and the count falls.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 1 | Nothing is flagged | An empty state saying so, in a sentence. Not an error |
| 4 | Anthropic unavailable | `503` and a line under the row: the explanation could not be written, try again. **The flag, its reason and the fact are unchanged**, and nothing was stored |
| 4 | The page is reloaded, or the fact's own card is opened | The stored explanation is shown, and the button is gone. **One model call a flag, ever** |
| 5 | The fact has no source document | The row has no link to open |
| 6 | Marked by mistake | The **Checked** pill lists it, with **Put back on the list** → `POST /api/flags/:id/uncheck` |
| 6 | Author marks a `Kept private` flag checked | The row leaves the list. **The fact is still Private.** Checking a flag changes nothing about the fact |

**If abandoned:** each mark is its own call and is saved. The list is where it was left. **Nothing
is ever required here**: a flag left unchecked blocks no document and no step on Home.

**Facts imported before 2026-10-08** still wait as candidates. Home offers **Sort them** as its
next step and their document's Fact Review offers **Sort N facts** → `POST /api/facts/sort`,
repeated until none remain: each call grades, accepts and flags twenty-five, and the count on screen
falls as it goes. Stopping partway
leaves the sorted ones sorted and the rest waiting. Reviewing them one at a time, as Flow 2 once
read, still works.

---

## Flow 10 · Read the master document · M3 (#57)

1. Sidebar → **Master document**. → `GET /api/master-document`.
2. One long page: each employer with its roles, its projects, and every accepted fact under them,
   then work under no employer, education and certifications. Each fact carries its Worth, its Who
   and any open flag, and names the document and line it came from.
3. **Download .md** → `GET /api/master-document/download` → a Markdown file of the same content.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 1 | The record holds no accepted fact | The intro says to import a document, and there is no Download. Not an error |
| 1 | Facts are still waiting to be sorted | A line saying how many are not listed yet, and to sort them from Home |
| 2 | A fact is wrong | It is not edited here. Its source link opens the fact (Flow 9, step 5) |
| 3 | The file holds Private facts | **It does, by decision.** The page says so beside the button, and the file's first lines say not to send it to an employer |

**If abandoned:** nothing was created. The page is built again from the record on the next open, so
it is never out of date and there is no second copy to keep in step.

---

## Flow 11 · Generate a résumé tailored to a job · M3 (#57)

1. Sidebar → **Tailored résumés**. The **New tailored résumé** form is at the top of the screen.
2. Author names it (the company and role) and pastes the job description, or presses **Read it from
   a text file** and chooses a `.txt` or `.md` file whose content fills the box. **Generate résumé**
   → `POST /api/tailored-resumes` → `201`.
3. The client asks for its first version → `POST /api/renders/:ref/generate`, with the new résumé's
   id as the ref. The model is given the same facts the main résumé is given, and the job
   description as text to read.
4. **Diff Review opens**, exactly as in Flow 3: the proposal is read and accepted or rejected.
5. The résumé is listed with its name, version and status. It is regenerated, edited, restored and
   downloaded like any document, under its own id. **Any number can be made.**

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | No name, no job description, or one over 20,000 characters | The button is disabled and says why. The server refuses the same with `422`. Nothing created |
| 2 | The record holds no fact a document may use | The button reads **Save**: the résumé is named and kept, and nothing is generated |
| 3 | A profile field the résumé needs is missing | The same refusal Flow 3 gives, in the same words. **The tailored résumé is kept**, so Generate is offered on its row once the cause is fixed |
| 3 | Anthropic unavailable | As Flow 3: nothing is applied, the résumé stays listed as never generated |
| 3 | The job description asks for something the record does not hold | It is not invented. A tailored résumé is written only from facts, and every block still cites the facts it rests on |
| 3 | The job description contains instructions to the model | It is passed as text to read, marked as a job description, and the rules it is read under are the system prompt's |

**If abandoned:** at step 2, nothing exists. After step 2, the named résumé exists with no version.
After step 3, the proposal waits, as every proposal does.

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

**Nothing generated is ever applied without review.** Every regeneration is a proposal. Automatic
acceptance (2026-10-08) is of **facts**, which are the document's own words with a line to check
them against. A document written from them is still read as a diff before it becomes current.

**The app never rejects a fact, and never deletes one.** It accepts and flags. Reject is the
author's action alone.

**No flow loses work on abandonment.** Fact decisions save individually; imports and proposals are
durable resources. Closing the tab is always safe — which matters, because this is a tool used in
short bursts between other work.

**Every disabled action states why.** `Nothing accepted yet`, `Needs promotion`. A disabled control
with no reason is not permitted (`05-design-system.md` §6).

**Failure never destroys a stored version.** In every flow above, the worst outcome of a failed
model call is that nothing new is created.
