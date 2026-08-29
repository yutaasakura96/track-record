# 02 — Product Requirements

**Status:** Phase 1 · written 2026-08-11 · no technology decisions in this document

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

| Render | Language | Nature |
|---|---|---|
| English résumé | EN | Sections: profile summary, technical skills, professional experience, projects, education, certifications |
| 履歴書 | JA | Rigid conventional format. Requires the **complete** chronological 学歴・職歴 with no unexplained gaps, and the author's PII |
| 職務経歴書 | JA | Per employer: business description + 資本金/従業員数, technical outcomes, 主な実績. Plus 経歴要約, 活かせるスキル・経験, 保有資格, 学歴, 自己PR |
| Career story (EN) | EN | Long-form interview-prep narrative, chapter-structured, ending in an anchor-facts table and a question→chapter routing map |
| キャリアストーリー (JA) | JA | Chapter-parallel with the English story — same structure, not a translation |

Every render is a **dated version**. Regenerating produces a new version; nothing is overwritten.

## 4. User stories

Priority is `MUST` / `SHOULD` / `LATER`. Milestone shows the earliest release it can appear in.

---

**S1 · Import a case study** — `MUST` · M1
> As the Author, I want to import the long technical document I generate per project, so that its content becomes reusable facts instead of prose I have to re-read.

**Acceptance:** A document is imported. The app extracts a list of candidate facts, each with a pointer to the passage it came from. No fact is accepted until reviewed (S2).

---

**S2 · Review candidate facts** — `MUST` · M1
> As the Author, I want to accept, edit or reject each candidate fact and set its provenance and disclosure, so that the record contains only claims I stand behind.

**Acceptance:** Each candidate can be accepted, edited then accepted, or rejected. Every accepted fact has a provenance value (Measured / Attested / Generated) and a disclosure value (Public / Restricted / Private). Rejecting is one action and does not re-offer the same fact on a later import of the same document.

---

**S3 · Scrub confidential material on import** — `MUST` · M1
> As the Author, I want anything categorically confidential flagged before I see it, so that a leak requires a deliberate act rather than an inattentive moment.

**Acceptance:** On import, content matching known-sensitive shapes — GUIDs, IP addresses, email addresses, employee numbers, personal names other than the author's — is marked **Private** by default. Promotion out of Private is possible but never a default, never bulk, and never silent.

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

Anything a model produces starts as **Generated**. Promotion is a deliberate act by the author.

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
| **Facts exist, no accepted facts** | Render actions are **disabled with a reason**, not hidden and not silently producing an empty document |
| **Employer with no facts** | Renders as a period of employment with description and no outcomes. Not an error; a new job legitimately looks like this |
| **Import produced zero facts** | Reported as a failure of extraction with the document retained, not as an empty success. The author can retry or capture manually |
| **No credentials** | The section is omitted from renders entirely rather than rendered empty |
| **Render never generated** | Shown as never-generated, distinct from generated-and-unchanged |

## 8. Edge cases

The ugliest case per feature, and what happens.

| Feature | Ugly case | Required behaviour |
|---|---|---|
| Import | A very large document (the existing corpus is ~2.4 MB of prose) | Must not fail, block the interface, or silently truncate. Partial progress is visible |
| Import | The **same document re-imported** after being updated at work — the normal case, since case studies are regenerated | Facts already accepted are recognised, not duplicated. Only genuinely new content is extracted. Previously rejected facts stay rejected |
| Import | Two documents assert **different numbers for the same thing** | Surfaced as a conflict for the author to resolve. Never silently last-write-wins |
| Import | The model invents a plausible fact absent from the source | Contained by design: everything model-produced starts **Generated**, and Generated never renders |
| Scrub | A confidential identifier is missed by the scrub | Mitigated, not solved: scrubbing is a default, not a guarantee. Review is the real control, and the review UI must make unreviewed material obvious |
| 履歴書 | A gap between employment periods | Warned about explicitly. The convention treats unexplained gaps as a defect |
| 履歴書 | Profile PII incomplete | Generation blocked with the missing fields named. A 履歴書 missing conventional fields is worse than none |
| Diff | Japanese prose comparison | Word-level segmentation required. Character-level diffs on Japanese are unreadable |
| Diff | A regeneration rewrites nearly everything | Still reviewable — the author must be able to reject wholesale in one action |
| Generation | The model is unavailable or returns nothing usable | Stored versions are untouched and remain readable. Failure never destroys the current version |
| Generation | `.docx` output fails to open in Word | Treated as a defect of the same severity as data loss — an unopenable render is a failed feature |
| Stories | The record changes after a story was accepted | The story is not regenerated automatically. The app reports that it is out of date against the record |
| Facts | An employer is deleted while facts reference it | Blocked, or explicitly reassigned. Facts are never silently orphaned |

## 9. Deliberately not in v1

1. **Reading work repositories, ticket systems or git history.** They are client-owned and private, and the strongest material left almost no commits.
2. **LinkedIn.** `LATER` — a copy-paste text render off the same facts, cheap once the five renders are right.
3. **The portfolio site.** Its own design, hosting and audience.
4. **The legacy master document.** Retired, not supported.
5. **Application tracking** — target company, status, per-company tailoring. Renders are dated versions instead.
6. **Multi-user anything** — accounts, sharing, roles, permission surfaces.
7. **Consistency checking as a goal.** Welcome as a side effect of provenance; not a target.
8. **A hand-maintained skills taxonomy.** Skills are derived and curated, never authored from scratch.
9. **Mobile-first design.** Capture is the only plausibly mobile activity, and it is not the bottleneck.
