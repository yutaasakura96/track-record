# Track Record

A structured, provenance-tracked record of one career, built from imported long-form work
documents, from which every career document is generated — English résumé, 履歴書, 職務経歴書, and a
bilingual pair of interview stories.

This file is a glossary and nothing else. It carries no implementation detail; `docs/03` and
`docs/04` own that.

## The record

**The Record**:
All seven entity types together — Profile, Employer, Role, Project, Fact, Education, Certification.
Not a synonym for the facts alone.
_Avoid_: "enters the record" as a way of saying a review gate was passed — say **is accepted**.

**Fact**:
One claim about the author's work, carrying Provenance, Disclosure and Evidence. The core object;
the only entity that arrives through the import path rather than a form.

**Employer**:
An organisation the author worked for, and the unit every render's employment sections are built
from — its name, its dates and its order come from this row and from nowhere else. One row per
employer, entered by hand. A fact is **filed under** an employer; an employer is never inferred from
the wording of a fact.
_Avoid_: company, workplace, organisation. Client is a different thing entirely — a client is
someone an employer did work for, and is not named by default.

**Role**:
A title held at an employer, with its own dates. **A promotion is a second Role**, not an edit to
the first: both were true, and 職務経歴書 shows the progression. An employer with no Role renders
without a title rather than with a guessed one.
_Avoid_: position, job, title-on-its-own.

**Project**:
A body of work, optionally at an employer. **A Project with no employer is independent**, and the
English résumé gives those their own section. A source document can be filed under one Project and,
from M3, one Employer; a fact extracted from it is filed under the document's Employer, read
through the document, unless the author set the fact's Employer by hand.
_Avoid_: engagement, assignment, case.

## Evidence and worth

**Provenance**:
How much a claim is worth — one of Measured, Attested or Generated. A Postgres enum on every fact,
never optional. Since 2026-10-08 the importer sets it when it accepts a fact (#57); until then anything
a model produced started Generated. Generated never reaches a render.
_Avoid_: using this word for the pointer to the source passage — that is Evidence.

**Evidence**:
The link from a fact to the passage that proves it — a source document version, the verbatim quote,
and its offsets into that version's text. Every accepted fact has one.
_Avoid_: Provenance, citation, reference.

**Disclosure**:
What may be said and to whom — one of Public, Restricted or Private. Independent of Provenance and
equally non-optional. Private never reaches a render.
_Avoid_: Confidentiality, sensitivity, classification.

## Awaiting review

**Candidate**:
A fact the import extracted that nobody has yet ruled on. Since 2026-10-08 an import leaves none:
the importer accepts each fact as it is found (#57). The Candidates that remain are the ones
imported before, which are **sorted** in one press or reviewed one at a time — accepted, edited then
accepted, or rejected.
_Avoid_: proposed fact, suggested fact, draft fact.

**Render Proposal**:
A generated render the author has not yet ruled on. Reviewed **wholesale** as a diff against the
current version — accepted or rejected in one action. Never a version.
_Avoid_: candidate render, draft render.

**Propose**:
Reserved for renders. The import does not propose — it **extracts candidates**.

**Likely match**:
An accepted fact at the same Employer that a Candidate probably restates in other words, found by a
lexical match between the two claims each time the card is read. Shown on the Candidate's card, and
on an accepted fact's card while its `repeat` Flag is open; it never blocks Accept. Exact repeats are not likely matches — dedupe suppresses them before they become
Candidates.
_Avoid_: duplicate (a duplicate is an exact repeat), overlap as a noun for one pair.

**Grade**:
The setting of an accepted fact's Provenance. **The author's** when made by accepting it or by
re-grading it afterwards; **the importer's** when the importer accepted the fact and the author has
not re-graded it (#57). An accepted fact with no grade carries a Provenance nobody chose: the 112 facts of the
first real import, promoted by an agent's default (ADR-0002), until each is re-graded or rejected.
_Avoid_: review (a review decides status; a grade decides worth).

**Flag**:
The importer's note that an accepted fact is worth a look, with the reason in a sentence. One of
four kinds: `confidential`, `number`, `unsure`, `repeat`. **Advice, never a gate**: a flag blocks no
document and no step, and marking it checked changes nothing about the fact. What keeps a fact out
of a render is still its Provenance and Disclosure.
_Avoid_: warning, issue, review item; "flagged" for a Generated fact's amber card, which is older.

**Sort**:
Grading, accepting and flagging the Candidates left from before automatic acceptance, a batch at a
time, at the author's press. It never rejects one.

**Explain this**:
The one control that calls the model for a Flag, and only when pressed. Its answer is stored on the
Flag and read back afterwards.

**Conflict**:
A likely match whose number differs from the Candidate's (PRD §8). Resolved by the author with Accept
and Reject, never last-write-wins and never merged.

## What is written from the record

**Master document**:
Every accepted fact in the record as one readable page, Private and Generated ones included, grouped
by Employer and Project. **A view, not a file**: built on each read, stored nowhere, edited nowhere.
**One per language**, English and 日本語: the same facts, with the record named as a document of
that language names it. No claim is translated.
It is not the legacy master document the project retired, which was hand-maintained.
_Avoid_: master résumé, master copy, source of truth (the record is that).

**Main résumé**:
The English résumé tailored to no job. One per user.

**Tailored résumé**:
A résumé written toward one job description, from exactly the facts the Main résumé may use. Any
number per user; each has its own versions and proposals. The job description is never a source of
facts. Since #60 it belongs to one Application and is made from there, from that Application's job
description.
_Avoid_: custom résumé, targeted résumé; Application for the résumé itself (an Application holds
it and is not it).

## Applications

**Application**:
One job the author is looking at or has applied for. It holds the job description as posted, the
company and the position read from it, the documents for that job, its Status steps, its Sent
copies and its Interview entries. Never deleted: one added by mistake is closed as Withdrawn.
Its last activity is the time the owner last changed the application record, kept on the
Application; step and interview dates describe when events happened, not when the record changed.
**Its company is not an Employer and its position is not a Role.** Those are the record, what the
author has done; an Application names somewhere the author has not worked, in the posting's words.
Nothing in an Application is a Fact, and none of it is a source of facts.
_Avoid_: job (the posting is a job; the Application is the author's dealings with it), lead,
opportunity; tracker or pipeline for the list.

**Status step**:
One of the seven places an Application can stand, in order: Not applied, Applied, Résumé passed,
First interview, Second interview, Final interview, Offer. Each step reached carries the day it was
reached, which the author can correct; a step can be skipped and then carries no day. **Rejected
and Withdrawn are not steps**: they **close** an Application at the step it had reached, with their
own day, and a closed Application can be reopened there.
_Avoid_: stage, phase, state; status for one step (the status is where the Application stands, the
step is the place).

**Sent copy**:
A document exactly as it was sent for an Application: the file of that day, kept whole, with the day
it was sent. Frozen when the Application moves to Applied, or when the author
records another one afterwards, of any document. It is not a version and does not point at one:
later changes to the document or to the record never reach it.
_Avoid_: snapshot, attachment, submitted version (a version is a render's, and can be edited from).

**Gone quiet**:
Said of an Application whose last activity timestamp is at least 14 days old while the author is
waiting to hear back, Applied through Final interview and not closed. The mark is worked out each
time it is read, never stored, and never sent anywhere: there is no email and no notification.
_Avoid_: stale (that is a skill's or a document's word), overdue, ghosted, inactive.

**Interview entry**:
The author's note of one real interview: the day, the round, who it was with, how it went, and the
questions asked, each question its own item in order. Written by hand afterwards; no model writes
or reads it.
_Avoid_: interview story (a career story is a render), session, round for the entry (the round is
one of its fields).

**Recording**:
The audio of a real interview, on its Interview entry: an uploaded file, or a link to one kept
elsewhere. Private to the author, never sent to a model, never transcribed here. **The one thing
the author can remove**; its Interview entry keeps a line saying one was removed.
_Avoid_: take (that is Suburi's, a practice answer), transcript, attachment, video (audio only).

## Downstream

**Suburi** (`yutaasakura96/suburi`):
A separate application that **consumes what this one renders**. It takes a 履歴書, a 職務経歴書 or an
English CV back in as the document an interview answer is scored against, extracting its own
**claims** — one atomic citable assertion with a character span — from the text. Its claim is not
this repo's Fact: a Fact carries Provenance, Disclosure and Evidence and can be changed or rejected one at a time;
a claim is derived, never curated, and never deleted. The two are not synchronised and are not meant
to be. `AGENTS.md` names the machinery both repos ended up building.
Suburi is for practice and an Application is for what really happened. An Application's job
description and its questions asked can be carried across by hand; nothing sends them.
_Avoid_: treating a Suburi claim as a Fact, or the reverse.
