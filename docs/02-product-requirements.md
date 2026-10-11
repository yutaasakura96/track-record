# 02 — Product Requirements

**Status:** Phase 1 · written 2026-08-11 · no technology decisions in this document · Applications (S20 to S24, §3a) added 2026-10-11 (#60, #69)

---

## 1. User types

**One: the Author.** Sole user, full access to everything, no roles, no permission surfaces, no sharing.

The single constraint this imposes on everything downstream: **no design decision may assume exactly one person exists.** Records belong to a person; that person just happens to always be the same one in v1. No multi-tenancy is built, and none is foreclosed.

## 2. The record

Seven entity types. Only **Project** uses the expensive import path; the rest are short forms filled a few times a year.

| Entity | What one row is | Notes |
|---|---|---|
| **Profile** | The author | 履歴書 identity fields incl. PII. Render-gated (§6) |
| **Employer** | A company worked for | Name, business description, period, employment type, **資本金**, **従業員数** — the last two are 職務経歴書 conventions with no English equivalent |
| **Role** | A title held at an employer | Title, period, 職種. Multiple roles per employer |
| **Project** | A discrete piece of work | **Employed or independent.** Independent projects have no employer — the English résumé renders them as a separate `PROJECTS` section |
| **Fact** | One claim, with evidence | The core object. Carries provenance and disclosure (§5, §6) |
| **Education** | A school attended | Institution, 学部・学科, degree, start and end, and an **outcome** (卒業 / 修了 / 中退 / expected) |
| **Certification** | A licence or certification held | Name, issuing organisation, issue and expiry dates, credential ID and URL |

**Skills are not stored.** They are derived from facts as candidates; the author curates which appear and in what order (§4, story 9).

**Career stories are not stored as records.** They are renders (§3).

## 3. The five renders

Five kinds. Since 2026-10-08 the English résumé can also be **tailored**: any number of résumés of
that kind, each written toward one job description (S19). The untailored one is the main résumé.
The master document (S18) is not a render: no model writes it, and it has no versions.
Since 2026-10-11 a tailored résumé belongs to one application (§3a, S21).

| Render | Language | Nature |
|---|---|---|
| English résumé | EN | Sections: profile summary, technical skills, professional experience, projects, education, certifications |
| 履歴書 | JA | Rigid conventional format. Requires the **complete** chronological 学歴・職歴 with no unexplained gaps, and the author's PII |
| 職務経歴書 | JA | Per employer: business description + 資本金/従業員数, technical outcomes, 主な実績. Plus 経歴要約, 活かせるスキル・経験, 保有資格, 学歴, 自己PR |
| Career story (EN) | EN | Long-form interview-prep narrative, chapter-structured, ending in an anchor-facts table and a question→chapter routing map |
| キャリアストーリー (JA) | JA | Chapter-parallel with the English story — same structure, not a translation |

Every render is a **dated version**. Regenerating produces a new version; nothing is overwritten.

## 3a. Applications

Added 2026-10-11 (#60; decision log, that date). A résumé is written to apply for a job, and the
record of applying was being kept outside the app. **An application is one job the author is
looking at or has applied for**, and it is not part of the record of §2: nothing in it is a fact
about the author, and nothing in it is a source of one.

| An application holds | What it is |
|---|---|
| **The job** | The job description as pasted, an optional link to the posting, and the company, the position and the key requirements read from the text and confirmed by the author |
| **The résumé for the job** | A tailored résumé made from the job description, or documents the record already has (main résumé, 履歴書, 職務経歴書), or several together |
| **Where it stands** | One of seven steps in order: Not applied, Applied, Résumé passed, First interview, Second interview, Final interview, Offer. Rejected and Withdrawn close it at the step it had reached |
| **What was sent** | Each sent copy of each document, including a later copy of the same document: the file exactly as it was on that day, which later changes never reach |
| **How the interviews went** | One entry an interview: the day, the round, who it was with, how it went, the questions asked |
| **Recordings** | On an interview entry: an audio file, or a link to a recording kept elsewhere |

**Event dates here are days**, not months: the figures an application shows are counts of days. The
record's periods stay months (§2). Each application also keeps one last-activity timestamp: when
the owner last changed how it is going, independent of the dates of the events recorded there. A
status change, an added or corrected date, an interview entry and a document added or recorded as
sent count; editing the company, position, link or requirements does not.

**Applications is the one area that works on a phone** (S20). Every other screen stays desktop
only.

## 4. User stories

Priority is `MUST` / `SHOULD` / `LATER`. Milestone shows the earliest release it can appear in.

---

**S1 · Import a case study** — `MUST` · M1
> As the Author, I want to import the long technical document I generate per project, so that its content becomes reusable facts instead of prose I have to re-read.

**Acceptance:** A document is imported. The app extracts a list of facts, each with a pointer to the passage it came from, and grades each: Measured, Attested or Generated, and confidential or not (§5). **Every fact it extracts is accepted into the record**, and the ones worth a look are flagged with the reason (S17). The app never rejects a fact on its own. The one thing it discards is a fact whose quoted passage is not in the document, which is how an invented fact is kept out.

**Changed 2026-10-08 (#57).** A fact used to wait as a candidate until the author accepted it (S2). The first portfolio produced over a thousand candidates, and reviewing each by hand was the afternoon this tool exists to remove.

---

**S2 · Change or reject any fact** — `MUST` · M1
> As the Author, I want to edit, re-grade or reject any fact and set who may read it, so that the record contains only claims I stand behind.

**Acceptance:** Any fact can be edited, re-graded, re-disclosed or rejected on its card, at any time. Every accepted fact has a provenance value (Measured / Attested / Generated) and a disclosure value (Public / Restricted / Private). Rejecting is one action and does not re-offer the same fact on a later import of the same document. A grade records whether the author or the importer set it.

**Changed 2026-10-08 (#57).** This was a review of every candidate before it entered the record. It is now the author's control over a record the importer fills. Facts imported before the change still wait as candidates: they can be sorted in one action, which grades, accepts and flags each, or reviewed one at a time as before.

---

**S3 · Scrub confidential material on import** — `MUST` · M1
> As the Author, I want anything categorically confidential flagged before I see it, so that a leak requires a deliberate act rather than an inattentive moment.

**Acceptance:** On import, content matching known-sensitive shapes — GUIDs, IP addresses, email addresses, employee numbers, personal names other than the author's — is marked **Private** by default. So is a fact the importer reads as naming a client, a person or an internal system, whatever its shape (added 2026-10-08, #57). Each is flagged with the reason. A matched shape is a floor: nothing the importer says makes that fact less than Private. Promotion out of Private is possible but never a default, never bulk, and never silent: it is one fact at a time, by the author's hand.

---

**S4 · Generate the English résumé** — `MUST` · M1
> As the Author, I want the English résumé generated from accepted facts alone, so that producing it costs a click instead of an afternoon.

**Acceptance:** The résumé is generated using only facts whose provenance is Measured or Attested and whose disclosure permits it. No Generated-provenance fact appears. The output is a `.docx` matching the existing document's section structure.

---

**S5 · Review every change as a diff** — `MUST` · M1
> As the Author, I want to see what a regeneration would change before it takes effect, so that prior tuning is never silently discarded.

**Acceptance:** Regeneration produces a *proposal*, not a replacement. The author sees the current version and the proposed version compared, and accepts or rejects. Rejecting leaves the stored version byte-identical. **Japanese renders diff at word level, not character level** — Japanese has no inter-word spaces, so a character diff is unreadable.

---

**S6 · Trace any line back to its evidence** — `MUST` · M1
> As the Author, I want to click any line in a generated document and see the fact behind it and the passage that proves that fact, so that I can defend every claim in an interview.

**Acceptance:** Every rendered claim resolves to exactly one fact. Every Measured fact resolves to a passage in a source document. Attested facts resolve to the fact record itself and are visibly marked as having no numeric evidence.

---

**S7 · Maintain employers, roles, credentials and profile** — `MUST` · M2
> As the Author, I want to record a new employer, role, certification or qualification in about a minute, so that the low-frequency parts of my record stay current without ceremony.

**Acceptance:** Each is a plain form. No document import, no fact extraction, no diff review — these are entered, not derived. Saving is immediate.

---

**S8 · Generate 履歴書** — `MUST` · M2
> As the Author, I want a conventionally correct 履歴書, so that I can submit it without a Japanese hiring manager noticing anything off.

**Acceptance:** The output follows the conventional format exactly. The 学歴・職歴 table is **complete and chronological**, including non-software employment. The app **warns on unexplained gaps** between consecutive entries. PII fields are populated. The document is dated.

---

**S9 · Curate the skills section** — `SHOULD` · M2
> As the Author, I want the app to propose skills from my facts and let me choose and order them, so that the section is presentable without being hand-maintained and drifting.

**Acceptance:** Candidates are derived from technologies appearing across accepted facts. The author selects and orders them into groups. A curated skill that no longer appears in any fact is flagged, not removed.

---

**S10 · Generate 職務経歴書** — `MUST` · M2
> As the Author, I want the 職務経歴書 generated per employer with the conventional metadata, so that the format reads as native rather than translated.

**Acceptance:** Each employer renders with business description, 資本金 and 従業員数, technical outcomes and 主な実績. Prose uses the flatter factual register the format expects — **not** the impact-maximising register of the English résumé, from the same underlying facts.

---

**S11 · Generate both career stories** — `MUST` · M2
> As the Author, I want the EN and JA career stories generated and kept chapter-parallel, so that interview prep stays in sync with the record.

**Acceptance:** Both stories generate. Chapters correspond one-to-one between languages. Each ends with an anchor-facts table and a question→chapter routing map. The JA version is written in Japanese, **not translated from the English**. Both are subject to the diff gate (S5).

---

**S12 · Capture work that left no document** — `MUST` · M3
> As the Author, I want to record an achievement by typing a couple of sentences and answering follow-up questions, so that the work that produces no repository trace still enters the record.

**Acceptance:** Free text in, structured fact out, via a short interrogation — when, which employer, what changed, what proves it. Under a minute for a simple entry. The resulting facts default to **Attested** provenance.

---

**S13 · Control what appears in which render** — `SHOULD` · M2
> As the Author, I want to say that an entry appears in 履歴書 but not in the English résumé, so that I can satisfy the completeness convention without padding a Western résumé.

**Acceptance:** Employment, education and project entries carry a per-render inclusion setting. Excluding from a render never deletes or hides the record. 履歴書 defaults to including everything.

---

**S14 · Restore a previous version** — `SHOULD` · M2
> As the Author, I want to go back to a document version I accepted earlier, so that a bad accept is recoverable.

**Acceptance:** Every accepted version is retained with its date and restorable. Restoring creates a new version rather than erasing history.

---

**S16 · Edit a document by hand** — `MUST` · M2
> As the Author, I want to change a stored version directly, so that a correction the generator will not produce does not require spending a generation or reaching into the database.

**Acceptance:** An edit produces a **new version** pointing at the one it was made from; nothing is mutated and nothing is deleted, so the version edited stays readable and downloadable. Structural edits are supported — a block added, removed or reordered — because both real edits were structural. A block may not cite a fact the record does not hold, nor one a generation would have been forbidden to use. An edit **does not** settle staleness: it consumes no facts. An edit is refused while a proposal is waiting, because accepting that proposal afterwards would silently discard it.

**Added 2026-09-11**, after two hand edits in one day were applied with SQL because no route existed. It is `MUST` rather than `SHOULD` because the alternative is not "the author waits" — it is the author writing to the database directly, which is how a version with no provenance gets created.

---

**S17 · Check what was flagged, when I want to** — `MUST` · M3
> As the Author, I want the facts worth checking shown as a list with the reason for each, so that I look at the few that need me and not at every fact.

**Acceptance:** Four things are flagged: a fact kept Private as confidential, a claim that states a number, a fact the importer was unsure of, and a fact that likely repeats one already in the record. **Every flag says why**, in a sentence. A flag is advice: nothing waits on it, and a flagged fact that is neither Private nor Generated is used by the next document unopened. The author opens a flagged fact only by choosing to, and marks a flag checked when they have looked. **`Explain this`** on a flag asks the AI to explain it in plain words; it is the only thing on the list that calls the AI, it does so only when pressed, and the answer is kept so that a second press costs nothing.

---

**S18 · Read everything in one document** — `MUST` · M3
> As the Author, I want one long document holding everything I have ever done, from every source I imported, so that I can read my whole record and know every résumé is drawn from it.

**Acceptance:** The master document lists every accepted fact, grouped by employer and project, with each fact's worth and disclosure, and the roles, education and certifications. It includes what a résumé leaves out: Private facts, Generated facts, and facts no document has used. It is **a view generated from the record** each time it is opened, by no AI call, and stored nowhere, so there is one source of truth; it cannot be edited, and a fact is changed on its own card. It can be downloaded in full, Private facts included, and the file says so in its first lines. It holds no source-document text. **There is one for English and one for Japanese** (#59), opened from the top of that language's tab on Home: the same facts, with the record's names, the headings and the dates as a document of that language writes them, and no claim translated.

---

**S19 · Tailor a résumé to a job** — `MUST` · M3
> As the Author, I want to paste or upload a job description and get a résumé written for that job, so that applying does not mean rewriting my résumé by hand each time.

**Acceptance:** The untailored English résumé is the **main résumé**. A tailored résumé is a document of its own, written toward one job description from the same facts by the same rules: no Private fact, no Generated fact, nothing the record does not state. The job description decides what leads and what is left out; it is never a source of facts. Any number can be made. Each is a proposal read as a diff (S5), with its own versions, history and download. English only until the language split (#59).

**S17 to S19 added 2026-10-08 (#57).**

**Changed 2026-10-11 (#60).** A tailored résumé is made from an application and lives inside it
(S21), from that application's job description; the separate Tailored résumés screen goes, and each
résumé already made is carried over as an application. What a tailored résumé is and what it may
use are unchanged. Still English only: the language split of #59 did not add a tailored 職務経歴書,
and neither does #60.

---

**S20 · Keep track of each job I apply for** — `MUST` · #60
> As the Author, I want each job I am looking at kept as one entry with where it stands, so that I know what I applied for, when, and what I am still waiting on, without a spreadsheet beside the app.

**Acceptance:** A job is added by pasting its job description, with an optional link to the posting. The job is saved as **Not applied**. Its status is one of seven steps, in order: Not applied, Applied, Résumé passed, First interview, Second interview, Final interview, Offer. **Rejected** and **Withdrawn** close an application at the step it had reached, and a closed one can be reopened. Setting a step **saves that day's date**, the date can be corrected to any day up to today, and the last change can be undone. A step a company never went through is skipped and has no date unless one is added. The application shows **how many days since the résumé passed and since the first interview**, each only when that step has a date, and how many since the last change. Its one last-activity timestamp is updated by a status change, an added or corrected date, an added interview entry, and a document added or recorded as sent. Editing the company, position, link or requirements does not update it, and neither does a save that changes nothing. The list shows every application, **newest activity first** by that timestamp, with a filter by status. An application whose last activity was **14 or more days ago while the author is waiting to hear back** (Applied through Final interview, not closed) is marked **gone quiet**; nothing is emailed and nothing is sent to anyone. Event dates still govern the résumé-passed and first-interview figures; on a closed application the third figure counts from its close date. A status has no colour of its own. **An application is never deleted**; one added by mistake is marked Withdrawn. One user can never read or change another's applications. **The Applications screens work at phone width**; no other screen does.

---

**S21 · Send the right résumé for a job, and keep what I sent** — `MUST` · #60
> As the Author, I want to choose the résumé for each job and have the copy I sent kept exactly as it was, so that months later I can read what that company has in front of them.

**Acceptance:** From an application the author makes a **tailored résumé** from its job description (S19, unchanged: the same facts, the same rules, read as a diff before it becomes a version), or picks documents the record already has: the main résumé, 履歴書, 職務経歴書. **An application can hold several**; a Japanese application sends 履歴書 and 職務経歴書 together. Tailoring is English only. When the application moves to **Applied**, every document on it that has no sent copy yet is **frozen as sent**, automatically, with that day's date, and the application says which were frozen. From Applied onward the application offers one explicit action, **Record another sent copy**: the author picks any document (one not yet on the application, one already sent, or a tailored résumé made after Applied) and it is frozen as a further sent copy with that day's date, always. Nothing is compared, and the application does not work out whether a document has changed since it was sent. **A sent copy is the file as it was that day**: it can be read and downloaded, it cannot be edited, and a later version of the document, or a later change to the record, the name or the address, does not change it. The list row names only the latest sent copy of each document, the most recently recorded; the application lists every copy with its date.

---

**S22 · Note how each interview went** — `MUST` · #60
> As the Author, I want to write down each interview while I remember it, so that the questions I was really asked and how I answered are there the next time.

**Acceptance:** One entry an interview: the date, the round (first, second, final, or another conversation), who it was with, how it went, and **the questions asked as a list**, each question its own item, in order. Several pasted lines become several questions. An entry needs how it went or at least one question. **Saving an entry for a later round than the application's status moves the status to that round**, with the interview's date, says so, and offers Undo. It can be written on a phone (S20). No AI reads or writes an interview entry.

---

**S23 · Have the posting read for me** — `MUST` · #60
> As the Author, I want the company, the position and the key requirements filled in from the job description I paste, so that adding a job is a paste and a check, not retyping.

**Acceptance:** The pasted text is read and **the company, the position and the key requirements are proposed** on a confirmation step. Every field can be corrected, a requirement added or removed, and **nothing is saved until the author saves**. When the reading fails, or the company and position cannot be found, the same step opens with the fields empty to type in and says so: **adding a job never depends on the AI**. The link is only stored. What is read describes the job. It is never a fact about the author, and a job description is never a source of facts (S19).

---

**S24 · Keep a recording with its interview** — `MUST` · #60
> As the Author, I want to keep the audio of an interview with my notes on it, whatever I have, so that I can hear what was actually said.

**Acceptance:** On an interview entry the author adds **a link** to a recording kept elsewhere (http or https only; only the link is kept), or **uploads an audio file**. Audio only: no video, and **no transcript**. An uploaded recording is private: only its owner, signed in, can play or download it, and it plays with seeking. Size and type limits are enforced and explained. **A recording can be removed for good**, the one thing in the app that can be; removing asks once, and the interview keeps a line saying a recording was removed and when. A recording is never sent to an AI. Recordings are not in the exported record (S15), and the Backup panel says so. A link is available first; upload waits on file storage only the owner can set up.

---

**Suburi hand-off (part of S20, #77).** Two buttons at the foot of an application, and nothing wired between the apps: **download the job description** as a text file holding that text only, and **copy the questions asked**, every question from every interview entry of that application, one a line.

**S20 to S24 added 2026-10-11 (#60).** They sit outside M1 to M3, which are about the record and its documents; the build order is #70 to #77.

---

**S15 · Export the record** — `MUST` · M1
> As the Author, I want to export the entire record in an open format, so that my career data is not trapped in an application I might stop maintaining.

**Acceptance:** One action produces the full record — every entity, fact, provenance value, disclosure value and evidence pointer — in a documented, human-readable format.

**Promoted from `SHOULD` · M3 to `MUST` · M1 on 2026-08-12.** Verification established that Neon's
free plan retains only a **6-hour** point-in-time restore window, so this export is the project's
actual disaster-recovery mechanism, not merely a portability feature.

---

## 5. Provenance and disclosure

Two independent attributes on every fact. Neither is optional.

**Provenance** — how much the claim is worth:

| Value | Meaning | Renders? |
|---|---|---|
| **Measured** | An observed number, with a pointer to the passage proving it | Yes |
| **Attested** | True and done by the author, but not numeric | Yes |
| **Generated** | Inferred or estimated by a model, not confirmed | **Never** |

**The importer grades each fact it extracts, against the passage it quoted** (decided 2026-10-08, #57). Measured when the passage states the number, Attested when it states the work with no number, Generated when the claim says more than the passage does. A fact it returns no grade for is Generated. Generated still never renders, so a fact the importer could not ground stays out of every document until the author grades it. The author can re-grade any fact, and the record keeps whether a grade is the author's or the importer's.

This replaces the rule of 2026-08-11, that anything a model produces starts Generated and is promoted only by the author. That rule made every fact wait for a ruling; it survives for a fact captured without a passage (S12) and for the facts the importer is not sure of.

**Disclosure** — what may be said, and to whom:

| Value | Meaning |
|---|---|
| **Public** | Renderable as-is to any employer |
| **Restricted** | Renderable only in generalised form — the client becomes a category, the system becomes a description |
| **Private** | Never renders. Other people's names, internal identifiers, credentials, hostnames, IP ranges, employee numbers |

**Client identity is not named by default** where the employer was a vendor or SI and the work was for a named client. A per-render override exists.

## 6. Confidentiality rules

1. **Source documents never render.** An imported case study is never emitted, exported or included in any output. It exists to prove facts.
2. **The author's own PII is a per-render field rule, not a disclosure tier.** Address, phone and date of birth are required by 履歴書 convention and must appear in **no other render**.
3. **Defaults point toward secrecy** in every ambiguous case. The failure is asymmetric: an over-cautious résumé costs a sentence, a leaked client identifier costs a career.
4. **Facts are stored plainly; impact framing is applied at render time.** The same fact renders as a strong action-verb bullet in English and in a flat factual register in 職務経歴書.

## 7. Empty states

Empty states are requirements, not afterthoughts.

| State | Behaviour |
|---|---|
| **No profile** | First run goes to the profile form. Nothing else is reachable until identity exists — every render needs a name |
| **No employers, no facts** | The record view explains the loop in one screen — import a document, review the facts, generate a document — with import as the only action |
| **Facts exist, no accepted facts** | Render actions are **not offered, and the reason is stated once** beside the documents; never an empty document produced silently. They were to be disabled with a reason each, which on Home was the same reason five times in tooltips (decision log, 2026-10-05) |
| **Employer with no facts** | Renders as a period of employment with description and no outcomes. Not an error; a new job legitimately looks like this |
| **Import produced zero facts** | Reported as a failure of extraction with the document retained, not as an empty success. The author can retry or capture manually |
| **No credentials** | The section is omitted from renders entirely rather than rendered empty |
| **Render never generated** | Shown as never-generated, distinct from generated-and-unchanged |
| **No applications** | The list says what an application will hold, with adding a job as the only action |
| **Application with no résumé** | Its next step is choosing one. Moving to Applied without one is allowed and freezes nothing; a sent document can be recorded afterwards |
| **Application with no interview** | The interviews section says what to note after each one |
| **Document never generated** | It cannot be picked for an application, and the reason is stated beside it |

## 8. Edge cases

The ugliest case per feature, and what happens.

| Feature | Ugly case | Required behaviour |
|---|---|---|
| Import | A very large document (the existing corpus is ~2.4 MB of prose) | Must not fail, block the interface, or silently truncate. Partial progress is visible |
| Import | The **same document re-imported** after being updated at work — the normal case, since case studies are regenerated | Facts already accepted are recognised, not duplicated. Only genuinely new content is extracted. Previously rejected facts stay rejected |
| Import | Two documents assert **different numbers for the same thing** | Surfaced as a conflict for the author to resolve. Never silently last-write-wins. **Decided 2026-09-28:** the candidate's review card shows the existing facts at the same employer that likely say the same thing, and marks a likely match whose number differs as a conflict. The author resolves it with Accept and Reject; there is no merge. "Likely the same" is a lexical match between the two claims, computed when the card is read (`03` §5, decided 2026-09-28). **Since 2026-10-08** a fact is accepted on arrival, so the same check raises a `Likely a repeat` flag (S17) whose reason says when the number differs; both facts are kept, and the pair is shown on the flagged fact's card |
| Import | A per-employer portfolio **restates a fact already accepted from the narrative** (the 2026-09-04 import) | **The portfolio's fact wins.** The author accepts it and rejects the narrative fact, so the citation is the primary case study. The rejected fact is retained, as every rejection is. The same card flag above is where the pair meets |
| Import | A per-employer portfolio's hundreds of facts all belong to **one employer** | The employer is chosen once, at import, and every extracted fact is filed under it. Any one fact can still be refiled on its card. The document's employer can be changed later, and its facts follow it, except one whose employer was set by hand (decided 2026-09-28) |
| Import | The model invents a plausible fact absent from the source | Contained by design: a fact whose quoted passage is not in the document is discarded before it is stored, and a claim that says more than its passage is graded **Generated**, which never renders |
| Scrub | A confidential identifier is missed by the scrub | Mitigated, not solved: scrubbing is a default, not a guarantee. Since 2026-10-08 the importer's own reading is a second net, told to err toward Private, and every document is still a proposal the author reads before it becomes a version. Neither is a guarantee either; a Restricted fact is written without the client's name whatever it holds |
| 履歴書 | A gap between employment periods | Warned about explicitly. The convention treats unexplained gaps as a defect |
| 履歴書 | Profile PII incomplete | Generation blocked with the missing fields named. A 履歴書 missing conventional fields is worse than none |
| Diff | Japanese prose comparison | Word-level segmentation required. Character-level diffs on Japanese are unreadable |
| Diff | A regeneration rewrites nearly everything | Still reviewable — the author must be able to reject wholesale in one action |
| Generation | The model is unavailable or returns nothing usable | Stored versions are untouched and remain readable. Failure never destroys the current version |
| Generation | `.docx` output fails to open in Word | Treated as a defect of the same severity as data loss — an unopenable render is a failed feature |
| Stories | The record changes after a story was accepted | The story is not regenerated automatically. The app reports that it is out of date against the record |
| Facts | An employer is deleted while facts reference it | Blocked, or explicitly reassigned. Facts are never silently orphaned |
| Applications | A company **skips a step**, or never says the résumé passed | Any step can be set from any other. A skipped step has no date, and a figure counted from it is not shown rather than guessed |
| Applications | A step was noted **days after it happened** | The event date is corrected, so figures based on that step follow it. The correction updates last activity, so list order and gone quiet follow the correction time |
| Applications | The status is **moved back** to an earlier step | Allowed. The later steps no longer show as reached; nothing is deleted, and sent copies stay |
| Applications | The document is **regenerated or edited after it was sent** | The sent copy does not change. If the newer file is sent too, the author records it as a further sent copy |
| Applications | The posting cannot be read, or the text is not a job description | The fields open empty to type in. Nothing is saved from a failed reading |
| Applications | An interview is noted for a round **earlier than or equal to** the status, or on a closed application | The entry is saved and the status is left alone. On an open application, an earlier round that was skipped and has no date takes the interview's date (decision log, 2026-10-12) |
| Applications | A **job description over 20,000 characters** | Refused with the limit named, as a tailored résumé's is today |
| Recordings | An upload is **interrupted** | No half-file is listed as a recording. The author is told and can try again |
| Recordings | A linked recording is **taken down** where it lives | It is gone here too; the app keeps only the link, and says so when the link is added |

## 9. Deliberately not in v1

1. **Reading work repositories, ticket systems or git history.** They are client-owned and private, and the strongest material left almost no commits.
2. **LinkedIn.** `LATER` — a copy-paste text render off the same facts, cheap once the five renders are right.
3. **The portfolio site.** Its own design, hosting and audience.
4. **The legacy master document.** Retired, not supported. The master document of S18 is not that file: it is a view generated from the record, with nothing to maintain beside it.
5. **Application tracking beyond S20 to S24.** Tracking itself came into scope on 2026-10-11 (#60, decision log). Still not built: **emails, reminders or notifications** about an application; **reading job boards** or a posting from its link (the link is only stored); **video** recordings; **transcripts** of a recording; **a tailored 職務経歴書**; and **any connection to Suburi in code**.
6. **Multi-user anything** — accounts, sharing, roles, permission surfaces.
7. **Consistency checking as a goal.** Welcome as a side effect of provenance; not a target.
8. **A hand-maintained skills taxonomy.** Skills are derived and curated, never authored from scratch.
9. **Mobile-first design.** Capture is the only plausibly mobile activity, and it is not the bottleneck. **One exception since 2026-10-11:** the Applications screens work at phone width, because noting an interview straight after it is a phone job (S20). Nothing else does.
