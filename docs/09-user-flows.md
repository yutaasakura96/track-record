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
3. Diff Review screen opens. If there is a current version, it stays readable while the proposed
   column shows a skeleton during generation.
4. Proposal ready → `GET /api/proposals/:id/diff` opens the split view for an update, or the
   document preview for a first version (`10-screen-specifications.md` Screen 2).
5. For an update, the author steps through changes with prev/next. **Each change shows its
   rationale** — supporting facts, why a line was removed, or why a heading changed.
6. **Accept** → new version, dated. Or **Keep current version** for an update / **Discard draft**
   for a first version → the proposal is retained as dismissed; any stored version is unchanged.
7. Result bar confirms, with **Undo**.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | No accepted fact a document may use | No Generate or Update is offered, and one line above the documents **states the reason**. Never a silently empty document (PRD §7, `10-screen-specifications.md` Screen 3) |
| 3 | Generation fails or returns nothing usable | Error with the reason and a retry. Any current version stays untouched and readable; the proposal area is not left blank without explanation |
| 4 | **Nothing changed** | The diff does not open. The overview reports `Already up to date with your record` |
| 4 | Nearly every line changed | Renders normally. Rejecting the whole thing remains **one action** |
| 5 | A change has no rationale | **A defect**, not a tolerated gap |
| 6 | The proposal was already decided in another tab | `409 conflict`. The screen refreshes to the decided state |
| 6 | Private facts were excluded | Footer states `N private facts in your record were not used` — that something was withheld, **never what** |

**If abandoned before deciding:** the proposal stays `pending`. The overview shows the render as
`proposal_pending` (`proposal_generating` while it is still being written). Any current version is
unchanged. Re-entering resumes at the review screen.

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

## Flow 6 · Quick capture — work that left no document · M3 (#95)

> **Rewritten 2026-10-16** (decision log, that date). It was written before #57 and had captured
> facts reviewed and accepted in the Flow 2 card interface; a captured fact now goes into the record
> on save.

1. Overview → **Quick capture** (hidden entirely while the record is empty — there is nothing to
   capture against yet). It works at phone width, where it is reached from the menu; Home itself
   keeps the wider-window message.
2. Author types a sentence or two.
3. The model splits the text into one or more claims, worded plainly like imported ones, and fills
   the month and the employer or project when the text says them.
4. Short interrogation, **only for what is missing**: when, which employer, what changed, what
   proves it.
5. The author confirms or corrects each claim and saves. The facts go **into the record** as
   accepted, provenance **Attested**, graded by the author, disclosure **Restricted** unless the
   confidential-shape check makes them **Private**. Each can still be edited or rejected on its card.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 3 | The model call fails or finds nothing | The **plain form** opens with the typed text kept: one claim, a month, an employer or project, save. Adding never depends on the model |
| 4 | Author abandons mid-interrogation | Draft retained. **No facts are created** until saved |
| 5 | A numeric claim with no source | Stays **Attested**, not Measured. There is no passage to point at |

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

## Flow 8 · Import several documents in one sitting · M3 (#93, built 2026-10-16)

> **Planned 2026-10-16** (decision log, that date), superseding the deferral of 2026-09-28. Whether
> the Message Batches path is built behind it, or extraction effort lowered, is still decided from
> the cost readout's numbers (#92, `03` §12 row 4).

1. Author selects multiple files, or drops several onto the target.
2. One row per file: its filename, the project and **the employer for that file**, each defaulted
   and changeable, as the single-file row offers them (`10` Screen 3). One `Import` starts them all.
3. Each becomes its own import, queued. **Extraction runs one at a time**, not in parallel —
   parallel extraction would just spend money faster.
4. The import list shows each document's status: waiting, reading, done or failed. Since #57 a
   finished document's facts are already in the record, with the ones worth a look flagged
   (Flow 9).

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | A file of a type that does not import, or over the size limit | Refused on its own row with the reason, before anything is sent. The others go ahead |
| 3 | One document fails | The others are unaffected. Failure is per-import, and it is retried on its own |

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

1. Sidebar → **Master document**, or **Open** on the first row of a tab of Home's documents.
   → `GET /api/master-document`, with `?language=ja` when the 日本語 tab is the one open (#59).
   The tabs at the top of the page change it, and the choice is the one Home keeps.
2. One long page: each employer with its roles, its projects, and every accepted fact under them,
   then work under no employer, education and certifications. Each fact carries its Worth, its Who
   and any open flag, and names the document and line it came from.
3. **Download .md** → `GET /api/master-document/download` → a Markdown file of the same content, in
   the language of the tab that is open.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 1 | The record holds nothing the page lists | The intro says to import a document, and there is no Download. Not an error |
| 1 | Facts are still waiting to be sorted | A line saying how many are not listed yet, and to sort them from Home |
| 2 | A fact is in English on the 日本語 tab, or the reverse | **It is, by decision.** A claim reads as it was written; the intro says none is translated |
| 2 | A fact is wrong | It is not edited here. Its source link opens the fact (Flow 9, step 5) |
| 3 | The file holds Private facts | **It does, by decision.** The page says so beside the button, and the file's first lines say not to send it to an employer |

**If abandoned:** nothing was created. The page is built again from the record on the next open, so
it is never out of date and there is no second copy to keep in step.

---

## Flow 11 · Open a carried-over tailored résumé · M3 (#57, #70)

1. Sidebar → **Applications** → the application made from the tailored résumé. Its page shows the
   résumé under **Résumé for this job**.
2. Generate or update it with `POST /api/renders/:ref/generate`, using its résumé id as the ref.
   Diff Review opens as in Flow 3; accepting, dismissing, editing, restoring and downloading use
   the same document routes. A refusal or an abandoned proposal leaves the existing résumé intact.

The former Tailored résumés screen and `POST /api/tailored-resumes` are gone. A new tailored
résumé is made from its application (Flow 14). See Screen 14 in `10-screen-specifications.md` for
the entry point and `07-api-design.md` §7 for the document routes.

---

## Flow 12 · Note how an interview went · M3 (#60, #72)

1. Sidebar → **Applications** → the application → **Interviews** → `Add an interview`. The form
   opens on today and on the earliest round at or after the status that has no entry yet.
2. The author sets the date and round, types who it was with and how it went, and adds the
   questions asked: one at a time with Enter, or several pasted lines at once. Nothing is written
   yet.
3. **Save interview** → `POST /api/applications/:id/interviews`, one write. The entry and its
   questions, each its own row in order, are saved together.
4. If the round is later than the status, the same write moves the application to that round with
   the entry's date. If an earlier interview round was skipped, the write fills its missing date
   without moving the status back. **Where it stands** says which change was made, with
   `Change the date` and `Undo`. When standing does not change, one line says `Interview saved.`

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | A pasted list carries bullets or numbers | They are dropped, and each line is one question |
| 3 | Neither how it went nor a question was given | `Write how it went, or add at least one question.` Nothing is written |
| 3 | The save is refused or fails | The form stays open with everything typed in it, and says why |
| 4 | The move or filled date should be taken back | `Undo` puts the standing back. The entry stays |
| 4 | An earlier interview round was skipped | Its missing date is filled; the status stays put and the first-interview figure follows that date |
| 4 | The round already has a date, is Other conversation, or the application is closed | The entry is saved and the standing is left alone |

**If abandoned:** `Cancel`, or leaving the page, discards what was typed. Nothing is saved until
**Save interview**. A saved entry is put right by Flow 12b.

---

## Flow 12b · Correct or delete an interview entry · M3 (#81)

1. On an interview's card → `Edit`. The form opens in place of the card, holding what was saved,
   each saved question in a field of its own.
2. The author changes the date, the round, who it was with, how it went or the questions: rewords
   one, removes one, adds more. Nothing is written yet.
3. **Save changes** → `PUT /api/applications/:id/interviews/:interviewId`, one write. The card
   comes back as corrected and one line says `Interview saved.`
4. A corrected day follows the step-date rule in `07` §9b. When the first-interview date changes,
   its figure follows. **Where it stands** says so, with `Change the date` and `Undo`.
5. To delete: on the card → `Delete`. The card asks once. **Delete it** →
   `DELETE /api/applications/:id/interviews/:interviewId`. The card is gone and one line says
   `Interview deleted.` The status and its dates are as they were.

| Step | What can go wrong | What the author sees |
|---|---|---|
| 3 | How it went and every question were emptied | `Write how it went, or add at least one question.` Nothing is written |
| 3, 5 | The application was changed somewhere else, or the write fails | The form or the question stays open, with what was typed, and says why |
| 4 | The step date no longer equals the entry's old day, or another live entry in the same round shares that old day | The entry is saved and that date is left alone (`07` §9b) |
| 4 | The round was changed to one later than the status | The status moves there, as for a new entry, with `Undo` |
| 5 | The entry had moved the status when it was added | Deleting it does not move the status back; the status controls do that |
| 5 | The entry has recordings | They are removed with it, uploaded files deleted from storage, and the question says so first |

**If abandoned:** `Cancel` in the form, or `Keep it` at the question, leaves the entry as it was.

---

## Flow 13 · Keep a link to a recording of an interview · M3 (#60, #74)

1. On an interview's card → `Attach a recording` → `Add a link instead`. The link form opens in place.
2. The author pastes the link and, if they like, says what it is in a few words → **Add the link**
   → `POST /api/applications/:id/interviews/:interviewId/recordings`. Only the link is kept.
3. The card shows a row: `Link`, what it is, the address. `Open` opens it in a new tab.
4. `Remove` asks once in place of the row → **Remove it** → `DELETE …/recordings/:recordingId`.
   The link is gone for good and the card keeps `A recording was removed on <date>.`

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | The text is not an `http` or `https` link | `That does not look like a link. It should start with https://` Nothing is sent |
| 2, 4 | The application was changed in another tab | The form or the question stays, and says to reload |
| 3 | The recording was taken down where it lives | The link opens to whatever is there now. The form said so when the link was added |
| 4 | Remove was pressed by mistake | `Keep it` closes the question and nothing changes |

**If abandoned:** `Cancel` discards what was typed. A removed link cannot be brought back; it is
added again.

---

## Flow 13b · Upload an audio recording of an interview · M3 (#60, #76)

1. On an interview's card → `Attach a recording`. The card says what it takes: MP3, M4A, AAC, WAV,
   FLAC or Ogg audio, up to 90 MB, stored privately.
2. **Upload audio** → the file chooser → the author picks the recording. The browser checks its
   size and its first bytes, reads how long it plays, and sends it as the body of
   `POST …/recordings/audio`.
3. A row says `Uploading <name>`, with a progress bar and `N of M MB. Keep this page open.`
4. Stored, the card lists it: `Audio`, its name, its size, how long it plays, the day, and `only
   you can play it`. `Recording uploaded.`
5. `Play` puts the player under the row; seeking reads only the part asked for. `Download` saves the
   file under its own name.
6. `Remove` asks once in place of the row → **Remove it** → `DELETE …/recordings/:recordingId`. The
   file is deleted from storage and the card keeps `A recording was removed on <date>.`

| Step | What can go wrong | What the author sees |
|---|---|---|
| 2 | The file is over 90 MB, empty, or not one of the kinds | Its name, its size or type, and the limit, in the card. Nothing is sent |
| 3 | The connection drops, or the page is closed | Closing asks first. A cut-off upload says `The upload of <name> stopped before it finished, so nothing was kept.` with `Try again`. Nothing is listed |
| 3 | The application was changed in another tab while it uploaded | The card says to reload. The file it stored is deleted |
| 6 | Remove was pressed by mistake | `Keep it` closes the question and nothing changes |

**If abandoned:** `Cancel` closes the card. A removed recording cannot be brought back; it is
uploaded again.

## Flow 14 · Choose what to send, and keep what was sent · #71

1. **Applications** → an application at Not applied. Under **Résumé for this job**, either
   **Make a tailored résumé** or tick documents under **Use a document you already have** and press
   **Use the ticked documents**. Both can be done, and several documents can be on one application.
2. **Make a tailored résumé** stores the résumé from the application's job description
   (`POST /api/applications/:id/tailored-resume`), generates it and opens Diff Review as in Flow 3.
   Accepting or keeping the current version returns to the application. A refusal to generate is
   said on the application, and the résumé stays on it to generate later. One that was taken off
   is put back as it is, and is generated only when it has neither a version nor a proposal waiting.
3. At Not applied, a document can be taken off (`Take off`) and others added. Each row is the live
   document at its current version; copies from an earlier move remain under **What you sent**.
4. **Move to Applied.** Every document on the application that has a version and no sent copy yet
   is frozen as sent, with that day's date, and the panel says which. If a file cannot be built the move is not made
   and the reason is said.
5. **What you sent** lists every copy. **Read it** opens the copy as it was sent (Screen 15);
   **Download** returns the stored file. Editing or regenerating the document afterwards, or
   changing the profile or the record, changes neither.
6. Later, **Record another sent copy**: tick any of the three documents or the tailored résumé and
   press **Record the ticked documents**. Each is frozen again, dated today, beside the earlier
   copies.

Correcting the reached step's date moves the sent date of the copies that change froze. Undo of the
move takes those copies back, and the next move freezes the documents again. An Undo that takes the
application out of Not applied, to Applied or a later step, freezes any attached document with no
sent copy, as a move does, and says which. A move or an Undo between steps from Applied onward
freezes nothing.

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
